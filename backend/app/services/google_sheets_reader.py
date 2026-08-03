"""Backend-only, read-only Google Sheets REST client.

The client accepts registry source keys rather than caller-supplied Google
identifiers or ranges. It obtains a short-lived OAuth token using either
keyless Vercel Workload Identity Federation or the legacy signed
service-account JWT flow, then performs metadata-first, bounded
``values:batchGet`` reads.
"""

from __future__ import annotations

from base64 import urlsafe_b64encode
from dataclasses import dataclass
import json
import random
import time
from typing import Callable, Mapping, Protocol, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from .sheet_sync_config import GoogleSheetsConfig
from .sheet_sync_config import (
    GOOGLE_CLOUD_PLATFORM_SCOPE,
    GOOGLE_IAM_CREDENTIALS_ORIGIN,
    GOOGLE_OAUTH_TOKEN_URI,
    GOOGLE_SHEETS_KEY_AUTH_MODE,
    GOOGLE_SHEETS_READONLY_SCOPE,
    GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE,
    GOOGLE_STS_TOKEN_URI,
)
from .sheet_sync_registry import (
    SheetSourceDefinition,
    cell_range_bounds,
    get_sheet_source,
)


SHEETS_API_ORIGIN = "https://sheets.googleapis.com"
_TRANSIENT_STATUS_CODES = frozenset({429, 500, 502, 503, 504})
_VALUE_RENDER_OPTIONS = frozenset({"UNFORMATTED_VALUE", "FORMATTED_VALUE", "FORMULA"})
_MAX_BATCH_RANGES = 10
_MAX_BATCH_CELLS = 10_000
_MAX_RESPONSE_BYTES = 2_000_000
_MAX_RETRY_DELAY_SECONDS = 4.0


class GoogleSheetsReaderError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class GoogleSheetsConfigurationError(GoogleSheetsReaderError):
    pass


class GoogleSheetsAccessError(GoogleSheetsReaderError):
    pass


class GoogleSheetsTemporaryError(GoogleSheetsReaderError):
    pass


class GoogleSheetsResponseError(GoogleSheetsReaderError):
    pass


@dataclass(frozen=True)
class TransportResponse:
    status_code: int
    body: bytes
    headers: Mapping[str, str]


class HttpTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout_seconds: float,
    ) -> TransportResponse: ...


class UrllibHttpTransport:
    """Small standard-library transport with a hard response-size limit."""

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        timeout_seconds: float,
    ) -> TransportResponse:
        request = Request(url, data=body, headers=dict(headers), method=method)
        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                payload = response.read(_MAX_RESPONSE_BYTES + 1)
                if len(payload) > _MAX_RESPONSE_BYTES:
                    raise GoogleSheetsResponseError(
                        "google_response_too_large",
                        "Google Sheets response exceeded the configured limit",
                    )
                return TransportResponse(
                    status_code=int(response.status),
                    body=payload,
                    headers={key.casefold(): value for key, value in response.headers.items()},
                )
        except HTTPError as exc:
            payload = exc.read(_MAX_RESPONSE_BYTES + 1)
            if len(payload) > _MAX_RESPONSE_BYTES:
                payload = b""
            return TransportResponse(
                status_code=int(exc.code),
                body=payload,
                headers={key.casefold(): value for key, value in exc.headers.items()},
            )
        except URLError as exc:
            raise OSError("Google transport request failed") from exc


@dataclass(frozen=True)
class SheetMetadata:
    spreadsheet_id: str
    title: str
    locale: str | None
    time_zone: str | None
    sheet_ids: Mapping[str, int]


@dataclass(frozen=True)
class SheetRangeRead:
    source: SheetSourceDefinition
    values: tuple[tuple[object, ...], ...]


@dataclass(frozen=True)
class SpreadsheetBatchRead:
    metadata: SheetMetadata
    ranges: tuple[SheetRangeRead, ...]
    request_count: int


def _base64url(value: bytes) -> str:
    return urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


class GoogleSheetsRestReader:
    def __init__(
        self,
        config: GoogleSheetsConfig,
        *,
        transport: HttpTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
        clock: Callable[[], float] = time.time,
        oidc_token: str | None = None,
    ):
        self._config = config
        self._transport = transport or UrllibHttpTransport()
        self._sleeper = sleeper
        self._jitter = jitter
        self._clock = clock
        self._oidc_token = (oidc_token or "").strip()
        self._cached_access_token: str | None = None
        self._access_token_expires_at = 0.0

    def read_source(
        self,
        source_key: str,
        *,
        value_render_option: str = "UNFORMATTED_VALUE",
    ) -> SheetRangeRead:
        batches = self.read_sources(
            [source_key],
            value_render_option=value_render_option,
        )
        return batches[0].ranges[0]

    def read_sources(
        self,
        source_keys: Sequence[str],
        *,
        value_render_option: str = "UNFORMATTED_VALUE",
    ) -> tuple[SpreadsheetBatchRead, ...]:
        self._require_configured()
        if value_render_option not in _VALUE_RENDER_OPTIONS:
            raise GoogleSheetsConfigurationError(
                "invalid_render_option",
                "Google Sheets render option is not approved",
            )
        if not source_keys:
            raise GoogleSheetsConfigurationError(
                "empty_source_selection",
                "At least one approved source is required",
            )
        if len(source_keys) > _MAX_BATCH_RANGES:
            raise GoogleSheetsConfigurationError(
                "too_many_ranges",
                "Google Sheets request exceeds the approved range limit",
            )

        sources: list[SheetSourceDefinition] = []
        seen_keys: set[str] = set()
        for source_key in source_keys:
            if source_key in seen_keys:
                continue
            seen_keys.add(source_key)
            source = get_sheet_source(source_key)
            self._ensure_source_allowed(source)
            sources.append(source)
        if sum(source.bounded_cell_count for source in sources) > _MAX_BATCH_CELLS:
            raise GoogleSheetsConfigurationError(
                "too_many_cells",
                "Google Sheets request exceeds the approved cell limit",
            )

        grouped: dict[str, list[SheetSourceDefinition]] = {}
        for source in sources:
            grouped.setdefault(source.spreadsheet_id, []).append(source)

        token = self._get_access_token()
        batches: list[SpreadsheetBatchRead] = []
        for spreadsheet_id, spreadsheet_sources in grouped.items():
            metadata_payload = self._fetch_metadata(spreadsheet_id, token)
            metadata = self._validate_metadata(
                metadata_payload,
                spreadsheet_id,
                spreadsheet_sources,
            )
            values_payload = self._fetch_values(
                spreadsheet_id,
                spreadsheet_sources,
                value_render_option,
                token,
            )
            ranges = self._validate_values(values_payload, spreadsheet_sources)
            batches.append(
                SpreadsheetBatchRead(
                    metadata=metadata,
                    ranges=ranges,
                    request_count=2,
                )
            )
        return tuple(batches)

    def _require_configured(self) -> None:
        if not self._config.enabled or not self._config.configured:
            raise GoogleSheetsConfigurationError(
                self._config.status_code,
                "Google Sheets synchronization is not configured",
            )
        if not self._config.service_account_email:
            raise GoogleSheetsConfigurationError(
                "missing_credentials",
                "Google Sheets synchronization is not configured",
            )
        if (
            self._config.authentication_mode == GOOGLE_SHEETS_KEY_AUTH_MODE
            and not self._config.private_key
        ):
            raise GoogleSheetsConfigurationError(
                "missing_credentials",
                "Google Sheets synchronization is not configured",
            )
        if self._config.authentication_mode == GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE:
            if not (
                self._config.project_number
                and self._config.workload_identity_pool_id
                and self._config.workload_identity_provider_id
            ):
                raise GoogleSheetsConfigurationError(
                    "missing_workload_identity_configuration",
                    "Google Sheets synchronization is not configured",
                )
            if not self._oidc_token or len(self._oidc_token) > 12_000 or self._oidc_token.count(".") != 2:
                raise GoogleSheetsConfigurationError(
                    "missing_vercel_oidc_token",
                    "A Vercel OIDC token is required for Google Sheets access",
                )
        elif self._config.authentication_mode != GOOGLE_SHEETS_KEY_AUTH_MODE:
            raise GoogleSheetsConfigurationError(
                "unsupported_authentication_mode",
                "Google Sheets authentication mode is not approved",
            )
        if not (1 <= self._config.max_attempts <= 5):
            raise GoogleSheetsConfigurationError(
                "invalid_retry_configuration",
                "Google Sheets retry configuration is invalid",
            )
        if not (1.0 <= self._config.request_timeout_seconds <= 30.0):
            raise GoogleSheetsConfigurationError(
                "invalid_timeout_configuration",
                "Google Sheets timeout configuration is invalid",
            )
        if self._config.token_uri != GOOGLE_OAUTH_TOKEN_URI:
            raise GoogleSheetsConfigurationError(
                "invalid_token_endpoint",
                "Google OAuth token endpoint is not approved",
            )
        if self._config.scopes != (GOOGLE_SHEETS_READONLY_SCOPE,):
            raise GoogleSheetsConfigurationError(
                "invalid_google_scope",
                "Google Sheets OAuth scope is not approved",
            )

    def _ensure_source_allowed(self, source: SheetSourceDefinition) -> None:
        if source.spreadsheet_id not in self._config.allowed_spreadsheet_ids:
            raise GoogleSheetsAccessError(
                "spreadsheet_not_runtime_allowed",
                "Approved source is not enabled in server configuration",
            )

    def _get_access_token(self) -> str:
        now = self._clock()
        if self._cached_access_token and now < self._access_token_expires_at - 60:
            return self._cached_access_token

        if self._config.authentication_mode == GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE:
            access_token, expires_in = self._get_oidc_access_token()
        else:
            access_token, expires_in = self._get_key_access_token(int(now))
        self._cached_access_token = access_token
        self._access_token_expires_at = now + max(60.0, min(float(expires_in), 3600.0))
        return access_token

    def _get_key_access_token(self, issued_at: int) -> tuple[str, float]:
        assertion = self._create_signed_assertion(issued_at)
        body = urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                "assertion": assertion,
            }
        ).encode("ascii")
        payload = self._request_json(
            "POST",
            self._config.token_uri,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=body,
            request_kind="oauth",
        )
        access_token = payload.get("access_token")
        expires_in = payload.get("expires_in", 3600)
        if not isinstance(access_token, str) or not access_token or not isinstance(expires_in, (int, float)):
            raise GoogleSheetsAccessError(
                "invalid_oauth_response",
                "Google authentication returned an invalid response",
            )
        return access_token, float(expires_in)

    def _get_oidc_access_token(self) -> tuple[str, float]:
        audience = (
            f"//iam.googleapis.com/projects/{self._config.project_number}/locations/global/"
            f"workloadIdentityPools/{self._config.workload_identity_pool_id}/providers/"
            f"{self._config.workload_identity_provider_id}"
        )
        sts_body = urlencode(
            {
                "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
                "audience": audience,
                "scope": GOOGLE_CLOUD_PLATFORM_SCOPE,
                "requested_token_type": "urn:ietf:params:oauth:token-type:access_token",
                "subject_token": self._oidc_token,
                "subject_token_type": "urn:ietf:params:oauth:token-type:jwt",
            }
        ).encode("ascii")
        sts_payload = self._request_json(
            "POST",
            GOOGLE_STS_TOKEN_URI,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            body=sts_body,
            request_kind="oauth",
        )
        federated_token = sts_payload.get("access_token")
        if not isinstance(federated_token, str) or not federated_token:
            raise GoogleSheetsAccessError(
                "invalid_sts_response",
                "Google identity federation returned an invalid response",
            )

        service_account = quote(self._config.service_account_email or "", safe="@.")
        impersonation_url = (
            f"{GOOGLE_IAM_CREDENTIALS_ORIGIN}/v1/projects/-/serviceAccounts/"
            f"{service_account}:generateAccessToken"
        )
        impersonation_payload = self._request_json(
            "POST",
            impersonation_url,
            headers={
                "Authorization": f"Bearer {federated_token}",
                "Content-Type": "application/json",
            },
            body=json.dumps(
                {
                    "scope": list(self._config.scopes),
                    "lifetime": "3600s",
                },
                separators=(",", ":"),
            ).encode("utf-8"),
            request_kind="oauth",
        )
        access_token = impersonation_payload.get("accessToken")
        if not isinstance(access_token, str) or not access_token:
            raise GoogleSheetsAccessError(
                "invalid_impersonation_response",
                "Google service-account impersonation returned an invalid response",
            )
        return access_token, 3600.0

    def _create_signed_assertion(self, issued_at: int) -> str:
        header = {"alg": "RS256", "typ": "JWT"}
        claims = {
            "iss": self._config.service_account_email,
            "scope": " ".join(self._config.scopes),
            "aud": self._config.token_uri,
            "iat": issued_at,
            "exp": issued_at + 3600,
        }
        encoded_header = _base64url(
            json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        encoded_claims = _base64url(
            json.dumps(claims, separators=(",", ":"), sort_keys=True).encode("utf-8")
        )
        signing_input = f"{encoded_header}.{encoded_claims}".encode("ascii")
        try:
            private_key = serialization.load_pem_private_key(
                self._config.private_key.encode("utf-8"),
                password=None,
            )
            signature = private_key.sign(signing_input, padding.PKCS1v15(), hashes.SHA256())
        except (AttributeError, TypeError, ValueError) as exc:
            raise GoogleSheetsConfigurationError(
                "invalid_private_key",
                "Google service-account private key could not be loaded",
            ) from exc
        return f"{signing_input.decode('ascii')}.{_base64url(signature)}"

    def _fetch_metadata(self, spreadsheet_id: str, token: str) -> Mapping[str, object]:
        fields = (
            "spreadsheetId,properties(title,locale,timeZone),"
            "sheets(properties(sheetId,title,hidden,gridProperties(rowCount,columnCount)))"
        )
        url = (
            f"{SHEETS_API_ORIGIN}/v4/spreadsheets/{quote(spreadsheet_id, safe='')}?"
            + urlencode({"fields": fields})
        )
        return self._request_json(
            "GET",
            url,
            headers={"Authorization": f"Bearer {token}"},
            body=None,
            request_kind="sheets",
        )

    def _fetch_values(
        self,
        spreadsheet_id: str,
        sources: Sequence[SheetSourceDefinition],
        value_render_option: str,
        token: str,
    ) -> Mapping[str, object]:
        query_items: list[tuple[str, str]] = [
            ("ranges", source.full_a1_range) for source in sources
        ]
        query_items.extend(
            [
                ("majorDimension", "ROWS"),
                ("valueRenderOption", value_render_option),
                ("dateTimeRenderOption", "SERIAL_NUMBER"),
            ]
        )
        url = (
            f"{SHEETS_API_ORIGIN}/v4/spreadsheets/{quote(spreadsheet_id, safe='')}/values:batchGet?"
            + urlencode(query_items)
        )
        return self._request_json(
            "GET",
            url,
            headers={"Authorization": f"Bearer {token}"},
            body=None,
            request_kind="sheets",
        )

    def _validate_metadata(
        self,
        payload: Mapping[str, object],
        spreadsheet_id: str,
        sources: Sequence[SheetSourceDefinition],
    ) -> SheetMetadata:
        if payload.get("spreadsheetId") != spreadsheet_id:
            raise GoogleSheetsResponseError(
                "spreadsheet_identity_mismatch",
                "Google metadata did not match the approved spreadsheet",
            )
        properties = payload.get("properties")
        sheets = payload.get("sheets")
        if not isinstance(properties, dict) or not isinstance(sheets, list):
            raise GoogleSheetsResponseError(
                "invalid_metadata_response",
                "Google Sheets metadata response was invalid",
            )

        sheet_properties: dict[str, Mapping[str, object]] = {}
        for sheet in sheets:
            if not isinstance(sheet, dict) or not isinstance(sheet.get("properties"), dict):
                continue
            item = sheet["properties"]
            title = item.get("title")
            if isinstance(title, str):
                sheet_properties[title] = item

        sheet_ids: dict[str, int] = {}
        for source in sources:
            item = sheet_properties.get(source.sheet_name)
            if item is None:
                raise GoogleSheetsAccessError(
                    "approved_tab_missing",
                    "An approved Google Sheets tab is unavailable",
                )
            grid = item.get("gridProperties")
            sheet_id = item.get("sheetId")
            if not isinstance(grid, dict) or not isinstance(sheet_id, int):
                raise GoogleSheetsResponseError(
                    "invalid_tab_metadata",
                    "Google Sheets tab metadata was invalid",
                )
            start_column, start_row, end_column, end_row = cell_range_bounds(source.cell_range)
            row_count = grid.get("rowCount")
            column_count = grid.get("columnCount")
            if (
                not isinstance(row_count, int)
                or not isinstance(column_count, int)
                or start_row < 1
                or start_column < 1
                or end_row > row_count
                or end_column > column_count
            ):
                raise GoogleSheetsAccessError(
                    "approved_range_outside_grid",
                    "An approved Google Sheets range is unavailable",
                )
            sheet_ids[source.sheet_name] = sheet_id

        title = properties.get("title")
        if not isinstance(title, str):
            raise GoogleSheetsResponseError(
                "invalid_spreadsheet_title",
                "Google Sheets metadata response was invalid",
            )
        locale = properties.get("locale")
        time_zone = properties.get("timeZone")
        return SheetMetadata(
            spreadsheet_id=spreadsheet_id,
            title=title,
            locale=locale if isinstance(locale, str) else None,
            time_zone=time_zone if isinstance(time_zone, str) else None,
            sheet_ids=dict(sheet_ids),
        )

    def _validate_values(
        self,
        payload: Mapping[str, object],
        sources: Sequence[SheetSourceDefinition],
    ) -> tuple[SheetRangeRead, ...]:
        if payload.get("spreadsheetId") != sources[0].spreadsheet_id:
            raise GoogleSheetsResponseError(
                "spreadsheet_values_identity_mismatch",
                "Google values did not match the approved spreadsheet",
            )
        value_ranges = payload.get("valueRanges")
        if not isinstance(value_ranges, list) or len(value_ranges) != len(sources):
            raise GoogleSheetsResponseError(
                "invalid_batch_values_response",
                "Google Sheets values response did not match the approved ranges",
            )
        result: list[SheetRangeRead] = []
        for source, value_range in zip(sources, value_ranges):
            if not isinstance(value_range, dict):
                raise GoogleSheetsResponseError(
                    "invalid_range_response",
                    "Google Sheets returned an invalid range",
                )
            values = value_range.get("values", [])
            if not isinstance(values, list) or any(not isinstance(row, list) for row in values):
                raise GoogleSheetsResponseError(
                    "invalid_values_shape",
                    "Google Sheets returned invalid row data",
                )
            returned_range = value_range.get("range")
            if not isinstance(returned_range, str) or not self._range_matches(source, returned_range):
                raise GoogleSheetsResponseError(
                    "range_identity_mismatch",
                    "Google values did not match the approved range",
                )
            start_column, start_row, end_column, end_row = cell_range_bounds(source.cell_range)
            maximum_rows = end_row - start_row + 1
            maximum_columns = end_column - start_column + 1
            if (
                len(values) > maximum_rows
                or any(len(row) > maximum_columns for row in values)
                or sum(len(row) for row in values) > source.bounded_cell_count
            ):
                raise GoogleSheetsResponseError(
                    "range_response_too_large",
                    "Google Sheets returned more cells than the approved range",
                )
            allowed_value_types = (str, int, float, bool, type(None))
            if any(
                not isinstance(value, allowed_value_types)
                for row in values
                for value in row
            ):
                raise GoogleSheetsResponseError(
                    "invalid_cell_value",
                    "Google Sheets returned an invalid cell value",
                )
            result.append(
                SheetRangeRead(
                    source=source,
                    values=tuple(tuple(value for value in row) for row in values),
                )
            )
        return tuple(result)

    @staticmethod
    def _range_matches(source: SheetSourceDefinition, returned_range: str) -> bool:
        if "!" not in returned_range:
            return False
        returned_sheet, returned_cells = returned_range.rsplit("!", 1)
        if returned_sheet.startswith("'") and returned_sheet.endswith("'"):
            returned_sheet = returned_sheet[1:-1].replace("''", "'")
        return returned_sheet == source.sheet_name and returned_cells.upper() == source.cell_range

    def _request_json(
        self,
        method: str,
        url: str,
        *,
        headers: Mapping[str, str],
        body: bytes | None,
        request_kind: str,
    ) -> Mapping[str, object]:
        for attempt in range(self._config.max_attempts):
            try:
                response = self._transport.request(
                    method,
                    url,
                    headers=headers,
                    body=body,
                    timeout_seconds=self._config.request_timeout_seconds,
                )
            except (OSError, TimeoutError):
                if attempt + 1 >= self._config.max_attempts:
                    raise GoogleSheetsTemporaryError(
                        "google_request_unavailable",
                        "Google Sheets is temporarily unavailable",
                    ) from None
                self._sleep_before_retry(attempt, None)
                continue

            if len(response.body) > _MAX_RESPONSE_BYTES:
                raise GoogleSheetsResponseError(
                    "google_response_too_large",
                    "Google Sheets response exceeded the configured limit",
                )
            if 200 <= response.status_code < 300:
                try:
                    payload = json.loads(response.body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise GoogleSheetsResponseError(
                        "invalid_google_json",
                        "Google returned an invalid response",
                    ) from None
                if not isinstance(payload, dict):
                    raise GoogleSheetsResponseError(
                        "invalid_google_payload",
                        "Google returned an invalid response",
                    )
                return payload

            if response.status_code in _TRANSIENT_STATUS_CODES:
                if attempt + 1 >= self._config.max_attempts:
                    raise GoogleSheetsTemporaryError(
                        "google_retry_limit_exceeded",
                        "Google Sheets remained temporarily unavailable",
                    )
                self._sleep_before_retry(attempt, response.headers.get("retry-after"))
                continue
            if response.status_code in {401, 403}:
                raise GoogleSheetsAccessError(
                    "google_authentication_failed" if request_kind == "oauth" else "google_sheet_access_denied",
                    "Google authentication or sheet access was denied",
                )
            if request_kind == "oauth":
                raise GoogleSheetsAccessError(
                    "google_authentication_failed",
                    "Google authentication or sheet access was denied",
                )
            raise GoogleSheetsResponseError(
                "google_request_rejected",
                "Google rejected the Sheets request",
            )
        raise GoogleSheetsTemporaryError(
            "google_retry_limit_exceeded",
            "Google Sheets remained temporarily unavailable",
        )

    def _sleep_before_retry(self, attempt: int, retry_after: str | None) -> None:
        exponential = min(_MAX_RETRY_DELAY_SECONDS, 0.25 * (2**attempt))
        server_delay = 0.0
        if retry_after:
            try:
                server_delay = min(_MAX_RETRY_DELAY_SECONDS, max(0.0, float(retry_after)))
            except ValueError:
                server_delay = 0.0
        delay = min(
            _MAX_RETRY_DELAY_SECONDS,
            max(exponential, server_delay) + min(0.25, max(0.0, self._jitter()) * 0.25),
        )
        self._sleeper(delay)

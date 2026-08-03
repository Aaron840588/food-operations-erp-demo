import base64
import json
import unittest
from decimal import Decimal
from urllib.parse import parse_qs, urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.services.google_sheets_reader import (
    GoogleSheetsAccessError,
    GoogleSheetsConfigurationError,
    GoogleSheetsRestReader,
    GoogleSheetsTemporaryError,
    TransportResponse,
)
from app.services.sheet_sync_config import (
    GOOGLE_CLOUD_PLATFORM_SCOPE,
    GOOGLE_IAM_CREDENTIALS_ORIGIN,
    GOOGLE_OAUTH_TOKEN_URI,
    GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE,
    GOOGLE_SHEETS_READONLY_SCOPE,
    GOOGLE_STS_TOKEN_URI,
    GoogleSheetsConfig,
    load_google_sheets_config,
)
from app.services.sheet_sync_normalization import (
    HeaderValidationError,
    ValueNormalizationError,
    canonical_value,
    normalize_header,
    normalize_money,
    normalize_source_row,
    parse_source_rows,
)
from app.services.sheet_sync_registry import (
    AUDITED_SPREADSHEET_IDS,
    PARTNER_INVENTORY_SPREADSHEET_ID,
    V1_SOURCES,
    get_sheet_source,
    is_exact_registered_range,
)


class FakeTransport:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def request(self, method, url, *, headers, body, timeout_seconds):
        self.calls.append({
            "method": method,
            "url": url,
            "headers": dict(headers),
            "body": body,
            "timeout_seconds": timeout_seconds,
        })
        if not self.outcomes:
            raise AssertionError("Unexpected transport request")
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def json_response(payload, status=200, headers=None):
    return TransportResponse(
        status_code=status,
        body=json.dumps(payload).encode("utf-8"),
        headers=headers or {},
    )


def metadata_payload(include_rte=True):
    sheets = [
        {
            "properties": {
                "sheetId": 111,
                "title": "SKUs",
                "hidden": False,
                "gridProperties": {"rowCount": 500, "columnCount": 20},
            }
        }
    ]
    if include_rte:
        sheets.append({
            "properties": {
                "sheetId": 222,
                "title": "RTE Food Info",
                "hidden": False,
                "gridProperties": {"rowCount": 500, "columnCount": 20},
            }
        })
    return {
        "spreadsheetId": PARTNER_INVENTORY_SPREADSHEET_ID,
        "properties": {
            "title": "Partner Inventory Management",
            "locale": "en_PH",
            "timeZone": "Asia/Manila",
        },
        "sheets": sheets,
    }


def values_payload(include_rte=True):
    ranges = [
        {
            "range": "SKUs!A4:F200",
            "majorDimension": "ROWS",
            "values": [["SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"]],
        }
    ]
    if include_rte:
        ranges.append({
            "range": "'RTE Food Info'!B5:H200",
            "majorDimension": "ROWS",
            "values": [[
                "SKU",
                "Product Name",
                "Category",
                "Cost/Unit",
                "H+H Price",
                "Reseller's Price",
                "Profit Margin",
            ]],
        })
    return {
        "spreadsheetId": PARTNER_INVENTORY_SPREADSHEET_ID,
        "valueRanges": ranges,
    }


class SheetSyncRegistryTests(unittest.TestCase):
    def test_v1_registry_contains_only_bounded_partner_sources(self):
        self.assertEqual(set(V1_SOURCES), {"partner_skus", "partner_rte_food_info"})
        for source in V1_SOURCES.values():
            self.assertEqual(source.spreadsheet_id, PARTNER_INVENTORY_SPREADSHEET_ID)
            self.assertLessEqual(source.bounded_cell_count, 2_000)
            self.assertTrue(
                is_exact_registered_range(source.spreadsheet_id, source.full_a1_range)
            )
            self.assertTrue(all(mapping.approval_mode == "manual_review" for mapping in source.mappings))
        eligible = {
            mapping.destination_field
            for source in V1_SOURCES.values()
            for mapping in source.mappings
            if mapping.auto_apply_eligible
        }
        self.assertEqual(eligible, {"retail_price", "reseller_price"})
        self.assertFalse(
            is_exact_registered_range(
                PARTNER_INVENTORY_SPREADSHEET_ID,
                "'SKUs'!A1:Z9999",
            )
        )


class SheetSyncConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.private_key = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")

    def valid_environment(self):
        return {
            "GOOGLE_SHEETS_SYNC_ENABLED": "true",
            "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL": "hh-sync@test-project.iam.gserviceaccount.com",
            "GOOGLE_SHEETS_PRIVATE_KEY": self.private_key.replace("\n", "\\n"),
            "GOOGLE_SHEETS_PROJECT_ID": "test-project",
            "GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS": ",".join(sorted(AUDITED_SPREADSHEET_IDS)),
        }

    def test_missing_or_explicitly_disabled_configuration_is_safe(self):
        disabled = load_google_sheets_config({})
        self.assertFalse(disabled.enabled)
        self.assertFalse(disabled.configured)
        self.assertEqual(disabled.status_code, "disabled_by_configuration")
        self.assertNotIn("private_key", disabled.public_status())

    def test_valid_configuration_normalizes_private_key_without_exposing_it(self):
        configured = load_google_sheets_config(self.valid_environment())
        self.assertTrue(configured.configured)
        self.assertIn("\n", configured.private_key)
        self.assertNotIn("BEGIN PRIVATE KEY", repr(configured))
        self.assertNotIn("BEGIN PRIVATE KEY", json.dumps(configured.public_status()))

    def test_unaudited_runtime_spreadsheet_disables_configuration(self):
        env = self.valid_environment()
        env["GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS"] += ",arbitrary-sheet-id"
        configured = load_google_sheets_config(env)
        self.assertFalse(configured.configured)
        self.assertEqual(configured.status_code, "unaudited_spreadsheet_in_allowlist")

    def test_keyless_vercel_oidc_configuration_does_not_require_a_private_key(self):
        configured = load_google_sheets_config({
            "GOOGLE_SHEETS_SYNC_ENABLED": "true",
            "GOOGLE_SHEETS_AUTH_MODE": GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE,
            "GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL": "hh-sync@test-project.iam.gserviceaccount.com",
            "GOOGLE_SHEETS_PROJECT_ID": "test-project",
            "GOOGLE_SHEETS_PROJECT_NUMBER": "123456789012",
            "GOOGLE_SHEETS_WORKLOAD_IDENTITY_POOL_ID": "hh-vercel",
            "GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER_ID": "hh-hub",
            "GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS": ",".join(sorted(AUDITED_SPREADSHEET_IDS)),
        })
        self.assertTrue(configured.configured)
        self.assertEqual(configured.authentication_mode, GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE)
        self.assertIsNone(configured.private_key)
        self.assertEqual(configured.public_status()["authentication_mode"], "vercel_oidc")


class SheetSyncNormalizationTests(unittest.TestCase):
    def test_header_normalization_handles_spacing_and_curly_apostrophes(self):
        self.assertEqual(normalize_header("  Reseller’s\u00a0  Price  "), "reseller's price")

    def test_duplicate_identifiers_are_reported_and_never_selected(self):
        source = get_sheet_source("partner_skus")
        parsed = parse_source_rows(
            [
                ["SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"],
                ["YP-IND-SW-SWT", "Yema", "Indulge", "Sweet", 1, ""],
                ["PPZ-FL-SW-SVR", "Pizza Full", "Full", "Sandwich", 1, ""],
                ["PPZ-FL-SW-SVR", "Pizza Half", "Half", "Sandwich", 1, ""],
                ["", "Missing ID", "Full", "Sandwich", 1, ""],
                ["not a valid sku", "Invalid ID", "Full", "Sandwich", 1, ""],
                [],
            ],
            source,
        )
        self.assertEqual([row.identifier for row in parsed.rows], ["YP-IND-SW-SWT"])
        self.assertEqual(parsed.duplicate_identifiers["PPZ-FL-SW-SVR"], (6, 7))
        self.assertEqual(parsed.missing_identifier_rows, (8,))
        self.assertEqual(parsed.invalid_identifier_rows, (9,))
        self.assertEqual(parsed.blank_rows, (10,))

    def test_missing_or_renamed_mapped_header_is_rejected(self):
        source = get_sheet_source("partner_rte_food_info")
        with self.assertRaises(HeaderValidationError):
            parse_source_rows(
                [["SKU", "Product Name", "Category", "Cost", "Retail", "Wholesale", "Margin"]],
                source,
            )

    def test_money_is_decimal_safe_and_invalid_formats_are_rejected(self):
        self.assertEqual(normalize_money(250), Decimal("250"))
        self.assertEqual(normalize_money("250.00"), Decimal("250.00"))
        self.assertEqual(normalize_money("₱ 1,250.00"), Decimal("1250.00"))
        self.assertEqual(canonical_value(Decimal("250.00")), "250")
        for invalid in ("$250.00", "-1", "=A1", True):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    normalize_money(invalid)

    def test_required_value_and_integer_types_are_normalized_strictly(self):
        source = get_sheet_source("partner_skus")
        parsed = parse_source_rows(
            [
                ["SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"],
                ["YP-IND-SW-SWT", "  Yema   Spread ", "Indulge", "Sweet", "2.0", ""],
            ],
            source,
        )
        normalized = normalize_source_row(parsed.rows[0], source)
        self.assertEqual(normalized.values["product.product_name"], "Yema Spread")
        self.assertEqual(normalized.values["product.pack_qty"], 2)

        blank_name = parse_source_rows(
            [
                ["SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"],
                ["YP-IND-SW-SWT", "", "Indulge", "Sweet", 1, ""],
            ],
            source,
        )
        with self.assertRaises(ValueNormalizationError):
            normalize_source_row(blank_name.rows[0], source)

        malformed_quantity = parse_source_rows(
            [
                ["SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"],
                ["YP-IND-SW-SWT", "Yema", "Indulge", "Sweet", "1,2", ""],
            ],
            source,
        )
        with self.assertRaises(ValueNormalizationError):
            normalize_source_row(malformed_quantity.rows[0], source)


class GoogleSheetsReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.private_key = key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode("ascii")

    def make_config(self, allowed_ids=None, **overrides):
        values = {
            "enabled": True,
            "configured": True,
            "status_code": "configured",
            "service_account_email": "hh-sync@test-project.iam.gserviceaccount.com",
            "private_key": self.private_key,
            "project_id": "test-project",
            "allowed_spreadsheet_ids": frozenset(
                {PARTNER_INVENTORY_SPREADSHEET_ID} if allowed_ids is None else allowed_ids
            ),
            "request_timeout_seconds": 5.0,
            "max_attempts": 3,
        }
        values.update(overrides)
        return GoogleSheetsConfig(**values)

    @staticmethod
    def decode_jwt_part(value):
        value += "=" * (-len(value) % 4)
        return json.loads(base64.urlsafe_b64decode(value.encode("ascii")))

    def test_metadata_first_batch_read_uses_signed_readonly_jwt_and_exact_ranges(self):
        transport = FakeTransport([
            json_response({"access_token": "test-token", "expires_in": 3600}),
            json_response(metadata_payload()),
            json_response(values_payload()),
        ])
        reader = GoogleSheetsRestReader(
            self.make_config(),
            transport=transport,
            sleeper=lambda _seconds: None,
            clock=lambda: 1_800_000_000,
        )

        batches = reader.read_sources(["partner_skus", "partner_rte_food_info"])
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0].request_count, 2)
        self.assertEqual([item.source.key for item in batches[0].ranges], [
            "partner_skus",
            "partner_rte_food_info",
        ])
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(transport.calls[0]["url"], GOOGLE_OAUTH_TOKEN_URI)
        self.assertNotIn("values:batchGet", transport.calls[1]["url"])
        self.assertIn("values:batchGet", transport.calls[2]["url"])
        self.assertEqual(transport.calls[1]["headers"]["Authorization"], "Bearer test-token")

        token_form = parse_qs(transport.calls[0]["body"].decode("ascii"))
        assertion = token_form["assertion"][0]
        _header, claims, _signature = assertion.split(".")
        decoded_claims = self.decode_jwt_part(claims)
        self.assertEqual(decoded_claims["scope"], GOOGLE_SHEETS_READONLY_SCOPE)
        self.assertEqual(decoded_claims["aud"], GOOGLE_OAUTH_TOKEN_URI)
        self.assertEqual(decoded_claims["exp"] - decoded_claims["iat"], 3600)

        query = parse_qs(urlparse(transport.calls[2]["url"]).query)
        self.assertEqual(query["ranges"], ["'SKUs'!A4:F200", "'RTE Food Info'!B5:H200"])
        self.assertEqual(query["valueRenderOption"], ["UNFORMATTED_VALUE"])

    def test_vercel_oidc_uses_sts_and_service_account_impersonation_without_a_key(self):
        transport = FakeTransport([
            json_response({"access_token": "federated-token", "expires_in": 3600}),
            json_response({"accessToken": "sheets-token", "expireTime": "2027-01-15T08:00:00Z"}),
            json_response(metadata_payload(include_rte=False)),
            json_response(values_payload(include_rte=False)),
        ])
        config = self.make_config(
            authentication_mode=GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE,
            private_key=None,
            project_number="123456789012",
            workload_identity_pool_id="hh-vercel",
            workload_identity_provider_id="hh-hub",
        )
        reader = GoogleSheetsRestReader(
            config,
            transport=transport,
            oidc_token="header.payload.signature",
        )

        result = reader.read_source("partner_skus")
        self.assertEqual(result.source.key, "partner_skus")
        self.assertEqual(transport.calls[0]["url"], GOOGLE_STS_TOKEN_URI)
        sts_form = parse_qs(transport.calls[0]["body"].decode("ascii"))
        self.assertEqual(sts_form["scope"], [GOOGLE_CLOUD_PLATFORM_SCOPE])
        self.assertEqual(sts_form["subject_token"], ["header.payload.signature"])
        self.assertEqual(
            sts_form["audience"],
            [
                "//iam.googleapis.com/projects/123456789012/locations/global/"
                "workloadIdentityPools/hh-vercel/providers/hh-hub"
            ],
        )
        self.assertTrue(transport.calls[1]["url"].startswith(GOOGLE_IAM_CREDENTIALS_ORIGIN))
        self.assertEqual(
            transport.calls[1]["headers"]["Authorization"],
            "Bearer federated-token",
        )
        impersonation_body = json.loads(transport.calls[1]["body"])
        self.assertEqual(impersonation_body["scope"], [GOOGLE_SHEETS_READONLY_SCOPE])
        self.assertEqual(transport.calls[2]["headers"]["Authorization"], "Bearer sheets-token")

    def test_runtime_allowlist_rejects_before_transport_or_signing(self):
        transport = FakeTransport([])
        reader = GoogleSheetsRestReader(
            self.make_config(allowed_ids=frozenset()),
            transport=transport,
        )
        with self.assertRaises(GoogleSheetsAccessError) as failure:
            reader.read_source("partner_skus")
        self.assertEqual(failure.exception.code, "spreadsheet_not_runtime_allowed")
        self.assertEqual(transport.calls, [])

    def test_unapproved_token_endpoint_or_scope_is_rejected_before_transport(self):
        for override in (
            {"token_uri": "https://example.com/token"},
            {"scopes": ("https://www.googleapis.com/auth/drive",)},
        ):
            with self.subTest(override=override):
                transport = FakeTransport([])
                reader = GoogleSheetsRestReader(self.make_config(**override), transport=transport)
                with self.assertRaises(GoogleSheetsConfigurationError):
                    reader.read_source("partner_skus")
                self.assertEqual(transport.calls, [])

    def test_transient_metadata_failure_retries_with_a_cap(self):
        sleeps = []
        transport = FakeTransport([
            json_response({"access_token": "test-token", "expires_in": 3600}),
            json_response({"error": "quota"}, status=429, headers={"retry-after": "0"}),
            json_response(metadata_payload(include_rte=False)),
            json_response(values_payload(include_rte=False)),
        ])
        reader = GoogleSheetsRestReader(
            self.make_config(),
            transport=transport,
            sleeper=sleeps.append,
            jitter=lambda: 0,
        )
        result = reader.read_source("partner_skus")
        self.assertEqual(result.source.key, "partner_skus")
        self.assertEqual(len(sleeps), 1)
        self.assertLessEqual(sleeps[0], 4.0)
        self.assertEqual(len(transport.calls), 4)

    def test_missing_approved_tab_stops_before_values_read(self):
        transport = FakeTransport([
            json_response({"access_token": "test-token", "expires_in": 3600}),
            json_response(metadata_payload(include_rte=False)),
        ])
        reader = GoogleSheetsRestReader(self.make_config(), transport=transport)
        with self.assertRaises(GoogleSheetsAccessError) as failure:
            reader.read_source("partner_rte_food_info")
        self.assertEqual(failure.exception.code, "approved_tab_missing")
        self.assertEqual(len(transport.calls), 2)

    def test_retry_exhaustion_returns_safe_error_without_google_body(self):
        transport = FakeTransport([
            json_response({"access_token": "test-token", "expires_in": 3600}),
            json_response({"error": "super-secret-google-detail"}, status=503),
            TimeoutError("sensitive timeout"),
            json_response({"error": "super-secret-google-detail"}, status=503),
        ])
        reader = GoogleSheetsRestReader(
            self.make_config(),
            transport=transport,
            sleeper=lambda _seconds: None,
            jitter=lambda: 0,
        )
        with self.assertRaises(GoogleSheetsTemporaryError) as failure:
            reader.read_source("partner_skus")
        self.assertEqual(failure.exception.code, "google_retry_limit_exceeded")
        self.assertNotIn("secret", str(failure.exception).casefold())


if __name__ == "__main__":
    unittest.main()

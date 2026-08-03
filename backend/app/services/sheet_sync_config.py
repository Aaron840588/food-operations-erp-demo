"""Safe server-side configuration for the controlled Sheets reader."""

from __future__ import annotations

from dataclasses import dataclass, field
import os
import re
from typing import Mapping

from .sheet_sync_registry import AUDITED_SPREADSHEET_IDS


GOOGLE_OAUTH_TOKEN_URI = "https://oauth2.googleapis.com/token"
GOOGLE_STS_TOKEN_URI = "https://sts.googleapis.com/v1/token"
GOOGLE_IAM_CREDENTIALS_ORIGIN = "https://iamcredentials.googleapis.com"
GOOGLE_SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
GOOGLE_SHEETS_KEY_AUTH_MODE = "service_account_key"
GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE = "vercel_oidc"
_SERVICE_ACCOUNT_EMAIL_RE = re.compile(
    r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.iam\.gserviceaccount\.com$"
)
_WORKLOAD_ID_RE = re.compile(r"^[a-z][a-z0-9\-]{3,31}$")


@dataclass(frozen=True)
class GoogleSheetsConfig:
    enabled: bool
    configured: bool
    status_code: str
    service_account_email: str | None = None
    private_key: str | None = field(default=None, repr=False)
    project_id: str | None = None
    project_number: str | None = None
    workload_identity_pool_id: str | None = None
    workload_identity_provider_id: str | None = None
    authentication_mode: str = GOOGLE_SHEETS_KEY_AUTH_MODE
    allowed_spreadsheet_ids: frozenset[str] = field(default_factory=frozenset)
    token_uri: str = GOOGLE_OAUTH_TOKEN_URI
    scopes: tuple[str, ...] = (GOOGLE_SHEETS_READONLY_SCOPE,)
    request_timeout_seconds: float = 10.0
    max_attempts: int = 3

    def public_status(self) -> dict[str, object]:
        """Return owner-safe status data without credential material."""
        return {
            "enabled": self.enabled,
            "configured": self.configured,
            "status_code": self.status_code,
            "approved_spreadsheet_count": len(self.allowed_spreadsheet_ids),
            "service_account_configured": bool(self.service_account_email),
            "authentication_mode": self.authentication_mode,
        }


def _is_truthy(value: str | None) -> bool:
    return (value or "").strip().casefold() in {"1", "true", "yes", "on"}


def _normalize_private_key(value: str) -> str:
    # Vercel stores multiline secrets with escaped newlines in many setups.
    return value.replace("\\r\\n", "\n").replace("\\n", "\n").strip()


def _parse_allowed_ids(value: str) -> frozenset[str]:
    return frozenset(part.strip() for part in value.split(",") if part.strip())


def load_google_sheets_config(
    environ: Mapping[str, str] | None = None,
) -> GoogleSheetsConfig:
    env = os.environ if environ is None else environ
    if not _is_truthy(env.get("GOOGLE_SHEETS_SYNC_ENABLED")):
        return GoogleSheetsConfig(
            enabled=False,
            configured=False,
            status_code="disabled_by_configuration",
            authentication_mode="disabled",
        )

    email = (env.get("GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL") or "").strip()
    private_key = _normalize_private_key(env.get("GOOGLE_SHEETS_PRIVATE_KEY") or "")
    project_id = (env.get("GOOGLE_SHEETS_PROJECT_ID") or "").strip()
    project_number = (env.get("GOOGLE_SHEETS_PROJECT_NUMBER") or "").strip()
    pool_id = (env.get("GOOGLE_SHEETS_WORKLOAD_IDENTITY_POOL_ID") or "").strip()
    provider_id = (env.get("GOOGLE_SHEETS_WORKLOAD_IDENTITY_PROVIDER_ID") or "").strip()
    authentication_mode = (
        env.get("GOOGLE_SHEETS_AUTH_MODE")
        or (GOOGLE_SHEETS_KEY_AUTH_MODE if private_key else GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE)
    ).strip().casefold()
    allowed_ids = _parse_allowed_ids(env.get("GOOGLE_SHEETS_ALLOWED_SPREADSHEET_IDS") or "")

    if authentication_mode not in {
        GOOGLE_SHEETS_KEY_AUTH_MODE,
        GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE,
    }:
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="unsupported_authentication_mode",
            authentication_mode=authentication_mode,
        )

    required_auth_present = (
        bool(private_key)
        if authentication_mode == GOOGLE_SHEETS_KEY_AUTH_MODE
        else bool(project_number and pool_id and provider_id)
    )
    if not email or not project_id or not allowed_ids or not required_auth_present:
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="missing_required_configuration",
            authentication_mode=authentication_mode,
            service_account_email=email or None,
            allowed_spreadsheet_ids=frozenset(
                spreadsheet_id
                for spreadsheet_id in allowed_ids
                if spreadsheet_id in AUDITED_SPREADSHEET_IDS
            ),
        )

    if not _SERVICE_ACCOUNT_EMAIL_RE.fullmatch(email):
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="invalid_service_account_email",
            authentication_mode=authentication_mode,
        )

    if authentication_mode == GOOGLE_SHEETS_KEY_AUTH_MODE and not (
        private_key.startswith("-----BEGIN PRIVATE KEY-----")
        and private_key.endswith("-----END PRIVATE KEY-----")
    ):
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="invalid_private_key_format",
            authentication_mode=authentication_mode,
        )

    if authentication_mode == GOOGLE_SHEETS_VERCEL_OIDC_AUTH_MODE and (
        not project_number.isdigit()
        or not _WORKLOAD_ID_RE.fullmatch(pool_id)
        or not _WORKLOAD_ID_RE.fullmatch(provider_id)
    ):
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="invalid_workload_identity_configuration",
            authentication_mode=authentication_mode,
        )

    unknown_ids = allowed_ids - AUDITED_SPREADSHEET_IDS
    if unknown_ids:
        return GoogleSheetsConfig(
            enabled=True,
            configured=False,
            status_code="unaudited_spreadsheet_in_allowlist",
            authentication_mode=authentication_mode,
        )

    return GoogleSheetsConfig(
        enabled=True,
        configured=True,
        status_code="configured",
        service_account_email=email,
        private_key=private_key or None,
        project_id=project_id,
        project_number=project_number or None,
        workload_identity_pool_id=pool_id or None,
        workload_identity_provider_id=provider_id or None,
        authentication_mode=authentication_mode,
        allowed_spreadsheet_ids=allowed_ids,
    )

"""Owner-only controlled Google Sheets review API."""

from __future__ import annotations

from collections import Counter
import os
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from .. import auth, models, schemas
from ..database import get_db
from ..services.google_sheets_reader import (
    GoogleSheetsAccessError,
    GoogleSheetsConfigurationError,
    GoogleSheetsResponseError,
    GoogleSheetsTemporaryError,
)
from ..services.sheet_sync_config import load_google_sheets_config
from ..services.sheet_sync_registry import V1_SOURCES
from ..services.sheet_sync_service import (
    AUTO_APPLY_MAX_PRICE_CHANGE_PCT,
    AUTO_APPLY_PRICE_FIELDS,
    AUTO_CHECK_INTERVAL_MINUTES,
    SheetSyncConflictError,
    SheetSyncWorkflowError,
    decode_json_field,
    get_price_auto_apply_enabled,
    get_recent_owner_poll_run,
    review_change,
    run_manual_check,
    set_price_auto_apply_enabled,
)


router = APIRouter(prefix="/sheet-sync", tags=["Google Sheets Sync"])


def _vercel_oidc_token(request: Request) -> str | None:
    """Read the short-lived request token, with local Vercel CLI fallback."""
    return request.headers.get("x-vercel-oidc-token") or os.environ.get("VERCEL_OIDC_TOKEN")


def require_owner(
    current_user: models.User = Depends(auth.get_current_user),
) -> models.User:
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    return current_user


def _serialize_run(run: models.SheetSyncRun) -> schemas.SheetSyncRunOut:
    return schemas.SheetSyncRunOut(
        public_id=run.public_id,
        trigger_type=run.trigger_type,
        status=run.status,
        source_keys=list(decode_json_field(run.source_keys_json)),
        summary=dict(decode_json_field(run.summary_json)),
        requested_by_username=run.requested_by.username if run.requested_by else None,
        started_at=run.started_at,
        completed_at=run.completed_at,
        error_code=run.error_code,
        error_message=run.error_message,
    )


def _serialize_change(
    db: Session,
    change: models.SheetSyncChange,
    *,
    include_events: bool,
) -> schemas.SheetSyncChangeOut:
    events: list[schemas.SheetSyncChangeEventOut] = []
    if include_events:
        event_rows = db.query(models.SheetSyncChangeEvent).filter(
            models.SheetSyncChangeEvent.change_id == change.id
        ).order_by(models.SheetSyncChangeEvent.created_at.asc(), models.SheetSyncChangeEvent.id.asc()).all()
        events = [
            schemas.SheetSyncChangeEventOut(
                event_type=event.event_type,
                actor_username=event.actor.username if event.actor else None,
                payload=dict(decode_json_field(event.event_payload_json)),
                created_at=event.created_at,
            )
            for event in event_rows
        ]
    return schemas.SheetSyncChangeOut(
        public_id=change.public_id,
        run_public_id=change.run.public_id,
        source_key=change.source.source_key,
        source_name=change.source.display_name,
        sheet_name=change.source.sheet_name,
        source_row_number=change.source_row_number,
        stable_identifier=change.stable_identifier,
        source_header=change.source_header,
        destination_entity=change.destination_entity,
        destination_field=change.destination_field,
        raw_source_value=decode_json_field(change.raw_source_value_json),
        previous_value=decode_json_field(change.previous_value_json),
        proposed_value=decode_json_field(change.proposed_value_json),
        risk_level=change.risk_level,
        approval_mode=change.approval_mode,
        status=change.status,
        detected_at=change.detected_at,
        decided_at=change.decided_at,
        applied_at=change.applied_at,
        decided_by_username=change.decided_by.username if change.decided_by else None,
        applied_by_username=change.applied_by.username if change.applied_by else None,
        resolution_note=change.resolution_note,
        error_code=change.error_code,
        error_message=change.error_message,
        events=events,
    )


def _workflow_http_error(error: SheetSyncWorkflowError) -> HTTPException:
    if error.code in {"change_not_found", "source_not_found"}:
        return HTTPException(status_code=404, detail=str(error))
    if isinstance(error, SheetSyncConflictError) or error.code in {
        "change_already_resolved",
        "destination_changed",
        "destination_missing",
    }:
        return HTTPException(status_code=409, detail=str(error))
    return HTTPException(status_code=400, detail=str(error))


def _status_payload(db: Session) -> dict[str, object]:
    config = load_google_sheets_config()
    auto_apply_enabled = get_price_auto_apply_enabled(db)
    return {
        **config.public_status(),
        "auto_apply_prices_enabled": auto_apply_enabled,
        "auto_apply_eligible_fields": sorted(AUTO_APPLY_PRICE_FIELDS),
        "auto_apply_max_price_change_pct": float(AUTO_APPLY_MAX_PRICE_CHANGE_PCT * 100),
        "auto_check_interval_minutes": AUTO_CHECK_INTERVAL_MINUTES,
        "approved_sources": [
            {
                "key": source.key,
                "display_name": source.display_name,
                "sheet_name": source.sheet_name,
                "range": source.cell_range,
                "identifier_header": source.identifier_header,
                "fields": [
                    {
                        "source_header": mapping.source_header,
                        "destination_field": mapping.destination_field,
                        "risk_level": mapping.risk_level,
                        "approval_mode": (
                            "auto_apply"
                            if auto_apply_enabled and mapping.auto_apply_eligible
                            else "manual_review"
                        ),
                        "auto_apply_eligible": mapping.auto_apply_eligible,
                    }
                    for mapping in source.mappings
                ],
            }
            for source in V1_SOURCES.values()
        ],
    }


@router.get("/status", response_model=schemas.SheetSyncConfigStatusOut)
def get_sheet_sync_status(
    db: Session = Depends(get_db),
    _owner: models.User = Depends(require_owner),
):
    return _status_payload(db)


@router.patch("/settings", response_model=schemas.SheetSyncConfigStatusOut)
def update_sheet_sync_settings(
    payload: schemas.SheetSyncSettingsUpdateRequest,
    db: Session = Depends(get_db),
    _owner: models.User = Depends(require_owner),
):
    set_price_auto_apply_enabled(
        db,
        enabled=payload.auto_apply_prices_enabled,
    )
    return _status_payload(db)


@router.get("/runs", response_model=list[schemas.SheetSyncRunOut])
def list_sheet_sync_runs(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
    _owner: models.User = Depends(require_owner),
):
    runs = db.query(models.SheetSyncRun).order_by(
        models.SheetSyncRun.started_at.desc(),
        models.SheetSyncRun.id.desc(),
    ).limit(limit).all()
    return [_serialize_run(run) for run in runs]


@router.post("/check", response_model=schemas.SheetSyncRunOut)
def check_sheet_updates(
    payload: schemas.SheetSyncCheckRequest,
    request: Request,
    db: Session = Depends(get_db),
    owner: models.User = Depends(require_owner),
):
    try:
        run = run_manual_check(
            db,
            actor_user_id=owner.id,
            source_keys=payload.source_keys,
            oidc_token=_vercel_oidc_token(request),
        )
        return _serialize_run(run)
    except GoogleSheetsConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GoogleSheetsTemporaryError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (GoogleSheetsAccessError, GoogleSheetsResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except SheetSyncWorkflowError as error:
        raise _workflow_http_error(error) from error


@router.post("/auto-check", response_model=schemas.SheetSyncRunOut)
def auto_check_sheet_updates(
    request: Request,
    db: Session = Depends(get_db),
    owner: models.User = Depends(require_owner),
):
    if not get_price_auto_apply_enabled(db):
        raise _workflow_http_error(
            SheetSyncWorkflowError(
                "auto_apply_disabled",
                "Automatic Google Sheets price updates are not enabled.",
            )
        )
    recent_run = get_recent_owner_poll_run(db)
    if recent_run is not None:
        return _serialize_run(recent_run)
    try:
        run = run_manual_check(
            db,
            actor_user_id=owner.id,
            source_keys=["partner_rte_food_info"],
            trigger_type="owner_poll",
            require_auto_apply=True,
            oidc_token=_vercel_oidc_token(request),
        )
        return _serialize_run(run)
    except GoogleSheetsConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GoogleSheetsTemporaryError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except (GoogleSheetsAccessError, GoogleSheetsResponseError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except SheetSyncWorkflowError as error:
        raise _workflow_http_error(error) from error


@router.get("/changes", response_model=schemas.SheetSyncQueueOut)
def list_sheet_sync_changes(
    status: str | None = Query(default=None, max_length=30),
    limit: int = Query(default=100, ge=1, le=250),
    db: Session = Depends(get_db),
    _owner: models.User = Depends(require_owner),
):
    allowed_statuses = {
        "pending", "accepted", "rejected", "ignored", "applied", "failed", "conflict"
    }
    if status is not None and status not in allowed_statuses:
        raise HTTPException(status_code=422, detail="Unsupported Sheet change status")
    query = db.query(models.SheetSyncChange)
    if status:
        query = query.filter(models.SheetSyncChange.status == status)
    changes = query.order_by(
        models.SheetSyncChange.detected_at.desc(),
        models.SheetSyncChange.id.desc(),
    ).limit(limit).all()
    all_counts = Counter(
        status_value
        for (status_value,) in db.query(models.SheetSyncChange.status).all()
    )
    counts = {candidate: int(all_counts.get(candidate, 0)) for candidate in sorted(allowed_statuses)}
    return schemas.SheetSyncQueueOut(
        counts=counts,
        changes=[_serialize_change(db, change, include_events=False) for change in changes],
    )


@router.get("/changes/{change_public_id}", response_model=schemas.SheetSyncChangeOut)
def get_sheet_sync_change(
    change_public_id: str,
    db: Session = Depends(get_db),
    _owner: models.User = Depends(require_owner),
):
    change = db.query(models.SheetSyncChange).filter(
        models.SheetSyncChange.public_id == change_public_id
    ).first()
    if change is None:
        raise HTTPException(status_code=404, detail="Sheet change was not found")
    return _serialize_change(db, change, include_events=True)


@router.post("/changes/{change_public_id}/review", response_model=schemas.SheetSyncChangeOut)
def review_sheet_sync_change(
    change_public_id: str,
    payload: schemas.SheetSyncReviewRequest,
    db: Session = Depends(get_db),
    owner: models.User = Depends(require_owner),
):
    try:
        change = review_change(
            db,
            change_public_id=change_public_id,
            action=payload.action,
            actor_user_id=owner.id,
            resolution_note=payload.resolution_note,
        )
        return _serialize_change(db, change, include_events=True)
    except SheetSyncWorkflowError as error:
        raise _workflow_http_error(error) from error

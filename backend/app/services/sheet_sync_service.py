"""Controlled Google Sheets detection and apply workflow.

Only code-defined sources and fields are accepted. Detection stores immutable
snapshots and proposed changes. Structural master-data fields always require
owner review; the two explicitly eligible product price fields can be applied
automatically after the owner enables that narrow mode.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
from typing import Iterable, Mapping, Sequence
from uuid import uuid4

from sqlalchemy.orm import Session

from .. import models
from .google_sheets_reader import GoogleSheetsRestReader, GoogleSheetsReaderError
from .master_data_service import (
    MasterDataValidationError,
    SHEET_SYNC_PRODUCT_FIELDS,
    apply_product_updates,
)
from .sheet_sync_config import load_google_sheets_config
from .sheet_sync_normalization import (
    HeaderValidationError,
    MappedSourceRow,
    SheetNormalizationError,
    ValueNormalizationError,
    normalize_source_row,
    parse_source_rows,
)
from .sheet_sync_registry import (
    V1_SOURCES,
    SheetFieldMapping,
    SheetSourceDefinition,
    get_sheet_source,
)


REVIEWABLE_STATUSES = frozenset({"pending", "conflict"})
REVIEW_ACTIONS = frozenset({"accept", "reject", "ignore"})
AUTO_APPLY_PRICE_FIELDS = frozenset({"retail_price", "reseller_price"})
AUTO_CHECK_INTERVAL_MINUTES = 5
AUTO_APPLY_MAX_PRICE_CHANGE_PCT = Decimal("0.25")


class SheetSyncWorkflowError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class SheetSyncConflictError(SheetSyncWorkflowError):
    pass


def _json_default(value: object) -> object:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    raise TypeError(f"Unsupported audit value type: {type(value).__name__}")


def _json_dumps(value: object) -> str:
    return json.dumps(
        value,
        default=_json_default,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )


def _json_loads(value: str) -> object:
    return json.loads(value)


def _hash_payload(value: object) -> str:
    return hashlib.sha256(_json_dumps(value).encode("utf-8")).hexdigest()


def _utcnow_naive() -> datetime:
    # Existing SQLAlchemy models use timezone-naive UTC database timestamps.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _safe_error_message(error: Exception) -> str:
    if isinstance(error, GoogleSheetsReaderError):
        return str(error)
    if isinstance(error, SheetSyncWorkflowError):
        return str(error)
    return "The synchronization run could not be completed."


def _mapping_for_field(
    source: SheetSourceDefinition,
    destination_field: str,
) -> SheetFieldMapping:
    for mapping in source.mappings:
        if (
            mapping.destination_entity == "product"
            and mapping.destination_field == destination_field
        ):
            return mapping
    raise SheetSyncWorkflowError(
        "mapping_not_approved",
        "The proposed destination field is no longer approved.",
    )


def _normalized_current_value(mapping: SheetFieldMapping, value: object) -> object:
    if value is None:
        return None
    if mapping.expected_type == "money":
        try:
            return Decimal(str(value)).quantize(Decimal("0.01"))
        except (InvalidOperation, ValueError):
            return value
    if mapping.expected_type == "non_negative_integer":
        try:
            return int(value)
        except (TypeError, ValueError):
            return value
    if mapping.expected_type == "string":
        return " ".join(str(value).split()).strip()
    return value


def _values_match(
    mapping: SheetFieldMapping,
    current_value: object,
    proposed_value: object,
) -> bool:
    current = _normalized_current_value(mapping, current_value)
    proposed = _normalized_current_value(mapping, proposed_value)
    return current == proposed


def _price_change_is_safe_for_auto_apply(
    mapping: SheetFieldMapping,
    current_value: object,
    proposed_value: object,
) -> bool:
    if not mapping.auto_apply_eligible or mapping.expected_type != "money":
        return False
    try:
        current = Decimal(str(current_value))
        proposed = Decimal(str(proposed_value))
    except (InvalidOperation, TypeError, ValueError):
        return False
    if current <= 0 or proposed <= 0:
        return False
    return abs(proposed - current) / current <= AUTO_APPLY_MAX_PRICE_CHANGE_PCT


def _destination_version(product: models.ProductSKU) -> str:
    state = {
        "sku": product.sku,
        "product_name": product.product_name,
        "category": product.category,
        "size": product.size,
        "pack_qty": product.pack_qty,
        "retail_price": str(product.retail_price),
        "reseller_price": str(product.reseller_price),
        "last_updated": product.last_updated.isoformat() if product.last_updated else None,
    }
    return _hash_payload(state)


def _raw_row_payload(
    header_row: Sequence[object],
    row: Sequence[object],
) -> dict[str, object | None]:
    payload: dict[str, object | None] = {}
    for index, header in enumerate(header_row):
        label = str(header).strip() or f"column_{index + 1}"
        payload[label] = row[index] if index < len(row) else None
    return payload


def _ensure_registry_rows(db: Session) -> dict[str, models.SheetSyncSource]:
    registered_keys = set(V1_SOURCES)
    db.query(models.SheetSyncSource).filter(
        ~models.SheetSyncSource.source_key.in_(registered_keys)
    ).update({models.SheetSyncSource.is_active: False}, synchronize_session=False)

    result: dict[str, models.SheetSyncSource] = {}
    for source in V1_SOURCES.values():
        source_row = db.query(models.SheetSyncSource).filter(
            models.SheetSyncSource.source_key == source.key
        ).first()
        if source_row is None:
            source_row = models.SheetSyncSource(source_key=source.key)
            db.add(source_row)
        source_row.display_name = source.display_name
        source_row.spreadsheet_id = source.spreadsheet_id
        source_row.sheet_name = source.sheet_name
        source_row.cell_range = source.cell_range
        source_row.is_active = True
        db.flush()

        approved_mapping_keys = {
            (mapping.source_header, mapping.destination_entity, mapping.destination_field)
            for mapping in source.mappings
        }
        for mapping_row in db.query(models.SheetSyncMapping).filter(
            models.SheetSyncMapping.source_id == source_row.id
        ).all():
            mapping_row.is_active = (
                mapping_row.source_header,
                mapping_row.destination_entity,
                mapping_row.destination_field,
            ) in approved_mapping_keys

        for mapping in source.mappings:
            mapping_row = db.query(models.SheetSyncMapping).filter(
                models.SheetSyncMapping.source_id == source_row.id,
                models.SheetSyncMapping.source_header == mapping.source_header,
                models.SheetSyncMapping.destination_entity == mapping.destination_entity,
                models.SheetSyncMapping.destination_field == mapping.destination_field,
            ).first()
            if mapping_row is None:
                mapping_row = models.SheetSyncMapping(
                    source_id=source_row.id,
                    source_header=mapping.source_header,
                    destination_entity=mapping.destination_entity,
                    destination_field=mapping.destination_field,
                )
                db.add(mapping_row)
            mapping_row.expected_type = mapping.expected_type
            mapping_row.risk_level = mapping.risk_level
            if not mapping.auto_apply_eligible:
                mapping_row.approval_mode = "manual_review"
            elif mapping_row.approval_mode not in {"manual_review", "auto_apply"}:
                mapping_row.approval_mode = "manual_review"
            mapping_row.is_active = True
        result[source.key] = source_row
    db.flush()
    return result


def _approval_modes_for_source(
    db: Session,
    *,
    source: SheetSourceDefinition,
    source_row: models.SheetSyncSource,
) -> dict[str, str]:
    rows = db.query(models.SheetSyncMapping).filter(
        models.SheetSyncMapping.source_id == source_row.id,
        models.SheetSyncMapping.is_active.is_(True),
    ).all()
    stored_modes = {
        (row.source_header, row.destination_entity, row.destination_field): row.approval_mode
        for row in rows
    }
    return {
        mapping.destination_key: (
            "auto_apply"
            if mapping.auto_apply_eligible
            and stored_modes.get(
                (
                    mapping.source_header,
                    mapping.destination_entity,
                    mapping.destination_field,
                )
            ) == "auto_apply"
            else "manual_review"
        )
        for mapping in source.mappings
    }


def get_price_auto_apply_enabled(db: Session) -> bool:
    """Return true only when every eligible price mapping is explicitly enabled."""
    eligible = [
        (source.key, mapping)
        for source in V1_SOURCES.values()
        for mapping in source.mappings
        if mapping.auto_apply_eligible
    ]
    if not eligible:
        return False

    rows = db.query(models.SheetSyncMapping, models.SheetSyncSource).join(
        models.SheetSyncSource,
        models.SheetSyncSource.id == models.SheetSyncMapping.source_id,
    ).filter(
        models.SheetSyncSource.source_key.in_([source_key for source_key, _mapping in eligible]),
        models.SheetSyncMapping.is_active.is_(True),
    ).all()
    modes = {
        (
            source_row.source_key,
            mapping_row.source_header,
            mapping_row.destination_entity,
            mapping_row.destination_field,
        ): mapping_row.approval_mode
        for mapping_row, source_row in rows
    }
    return all(
        modes.get(
            (
                source_key,
                mapping.source_header,
                mapping.destination_entity,
                mapping.destination_field,
            )
        ) == "auto_apply"
        for source_key, mapping in eligible
    )


def set_price_auto_apply_enabled(
    db: Session,
    *,
    enabled: bool,
) -> bool:
    """Persist the owner's narrow auto-apply preference for reviewed price fields."""
    registry_rows = _ensure_registry_rows(db)
    for source in V1_SOURCES.values():
        source_row = registry_rows[source.key]
        for mapping in source.mappings:
            mapping_row = db.query(models.SheetSyncMapping).filter(
                models.SheetSyncMapping.source_id == source_row.id,
                models.SheetSyncMapping.source_header == mapping.source_header,
                models.SheetSyncMapping.destination_entity == mapping.destination_entity,
                models.SheetSyncMapping.destination_field == mapping.destination_field,
            ).one()
            mapping_row.approval_mode = (
                "auto_apply"
                if enabled and mapping.auto_apply_eligible
                else "manual_review"
            )

    if not enabled:
        db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.status == "pending",
            models.SheetSyncChange.approval_mode == "auto_apply",
            models.SheetSyncChange.destination_entity == "product",
            models.SheetSyncChange.destination_field.in_(tuple(AUTO_APPLY_PRICE_FIELDS)),
        ).update(
            {models.SheetSyncChange.approval_mode: "manual_review"},
            synchronize_session=False,
        )
    db.commit()
    return get_price_auto_apply_enabled(db)


def get_recent_owner_poll_run(
    db: Session,
) -> models.SheetSyncRun | None:
    """Throttle duplicate browser tabs without hiding a genuinely stale Sheet."""
    cutoff = _utcnow_naive() - timedelta(minutes=AUTO_CHECK_INTERVAL_MINUTES - 1)
    return db.query(models.SheetSyncRun).filter(
        models.SheetSyncRun.trigger_type == "owner_poll",
        models.SheetSyncRun.started_at >= cutoff,
    ).order_by(
        models.SheetSyncRun.started_at.desc(),
        models.SheetSyncRun.id.desc(),
    ).first()


def _add_change_event(
    db: Session,
    change: models.SheetSyncChange,
    event_type: str,
    *,
    actor_user_id: int | None,
    payload: Mapping[str, object] | None = None,
) -> None:
    db.add(
        models.SheetSyncChangeEvent(
            change_id=change.id,
            event_type=event_type,
            actor_user_id=actor_user_id,
            event_payload_json=_json_dumps(dict(payload or {})),
        )
    )


def _find_duplicate_rows(parsed) -> dict[int, str]:
    return {
        row_number: identifier
        for identifier, row_numbers in parsed.duplicate_identifiers.items()
        for row_number in row_numbers
    }


def _create_snapshot(
    db: Session,
    *,
    run: models.SheetSyncRun,
    source_row: models.SheetSyncSource,
    row_number: int,
    identifier: str | None,
    raw_payload: Mapping[str, object | None],
    normalized_payload: Mapping[str, object | None] | None,
    validation_status: str,
    errors: Sequence[str] = (),
) -> models.SheetSyncSnapshot:
    snapshot = models.SheetSyncSnapshot(
        run_id=run.id,
        source_id=source_row.id,
        stable_identifier=identifier,
        row_number=row_number,
        raw_payload_json=_json_dumps(dict(raw_payload)),
        normalized_payload_json=_json_dumps(dict(normalized_payload or {})),
        payload_hash=_hash_payload(
            {
                "raw": dict(raw_payload),
                "normalized": dict(normalized_payload or {}),
                "validation_status": validation_status,
                "errors": list(errors),
            }
        ),
        validation_status=validation_status,
        validation_errors_json=_json_dumps(list(errors)),
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _queue_product_changes(
    db: Session,
    *,
    run: models.SheetSyncRun,
    source: SheetSourceDefinition,
    source_row: models.SheetSyncSource,
    snapshot: models.SheetSyncSnapshot,
    mapped_row: MappedSourceRow,
    normalized_values: Mapping[str, object | None],
    product: models.ProductSKU,
    actor_user_id: int,
    approval_modes: Mapping[str, str],
) -> tuple[int, int, int, tuple[str, ...]]:
    detected = 0
    unchanged = 0
    suppressed = 0
    auto_apply_candidates: list[str] = []
    version = _destination_version(product)
    for mapping in source.mappings:
        proposed = normalized_values.get(mapping.destination_key)
        if proposed is None:
            continue
        current = getattr(product, mapping.destination_field)
        if _values_match(mapping, current, proposed):
            unchanged += 1
            continue

        proposed_json = _json_dumps(proposed)
        unresolved = db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.source_id == source_row.id,
            models.SheetSyncChange.stable_identifier == mapped_row.identifier,
            models.SheetSyncChange.destination_entity == mapping.destination_entity,
            models.SheetSyncChange.destination_field == mapping.destination_field,
            models.SheetSyncChange.status.in_(tuple(REVIEWABLE_STATUSES)),
        ).all()
        matching_unresolved = next(
            (candidate for candidate in unresolved if candidate.proposed_value_json == proposed_json),
            None,
        )
        if matching_unresolved is not None:
            if (
                matching_unresolved.status == "pending"
                and matching_unresolved.destination_version != version
            ):
                matching_unresolved.status = "conflict"
                matching_unresolved.error_code = "destination_changed"
                matching_unresolved.error_message = "The H+H record changed after detection."
                _add_change_event(
                    db,
                    matching_unresolved,
                    "conflict",
                    actor_user_id=actor_user_id,
                    payload={"detected_in_run": run.public_id},
                )
            current_mode = approval_modes.get(mapping.destination_key, "manual_review")
            if (
                matching_unresolved.status == "pending"
                and current_mode == "auto_apply"
                and mapping.auto_apply_eligible
                and _price_change_is_safe_for_auto_apply(mapping, current, proposed)
            ):
                matching_unresolved.approval_mode = "auto_apply"
                auto_apply_candidates.append(matching_unresolved.public_id)
            suppressed += 1
            continue

        fingerprint = _hash_payload(
            {
                "source": source.key,
                "identifier": mapped_row.identifier,
                "field": mapping.destination_key,
                "previous": _normalized_current_value(mapping, current),
                "proposed": proposed,
                "destination_version": version,
            }
        )
        if db.query(models.SheetSyncChange.id).filter(
            models.SheetSyncChange.fingerprint == fingerprint
        ).first():
            suppressed += 1
            continue

        approval_mode = approval_modes.get(mapping.destination_key, "manual_review")
        if approval_mode == "auto_apply" and not _price_change_is_safe_for_auto_apply(
            mapping,
            current,
            proposed,
        ):
            approval_mode = "manual_review"
        change = models.SheetSyncChange(
            public_id=str(uuid4()),
            fingerprint=fingerprint,
            run_id=run.id,
            source_id=source_row.id,
            snapshot_id=snapshot.id,
            stable_identifier=mapped_row.identifier,
            source_row_number=mapped_row.row_number,
            source_header=mapping.source_header,
            destination_entity=mapping.destination_entity,
            destination_field=mapping.destination_field,
            raw_source_value_json=_json_dumps(mapped_row.raw_values.get(mapping.destination_key)),
            previous_value_json=_json_dumps(_normalized_current_value(mapping, current)),
            proposed_value_json=proposed_json,
            destination_version=version,
            risk_level=mapping.risk_level,
            approval_mode=approval_mode,
            status="pending",
        )
        db.add(change)
        db.flush()
        _add_change_event(
            db,
            change,
            "detected",
            actor_user_id=actor_user_id,
            payload={"run_public_id": run.public_id},
        )
        if approval_mode == "auto_apply":
            auto_apply_candidates.append(change.public_id)
        detected += 1
    return detected, unchanged, suppressed, tuple(auto_apply_candidates)


def run_manual_check(
    db: Session,
    *,
    actor_user_id: int,
    source_keys: Iterable[str] | None = None,
    reader: GoogleSheetsRestReader | None = None,
    trigger_type: str = "manual",
    require_auto_apply: bool = False,
    oidc_token: str | None = None,
) -> models.SheetSyncRun:
    if trigger_type not in {"manual", "owner_poll"}:
        raise SheetSyncWorkflowError("invalid_trigger_type", "Sheet check trigger is not supported.")
    if require_auto_apply and not get_price_auto_apply_enabled(db):
        raise SheetSyncWorkflowError(
            "auto_apply_disabled",
            "Automatic Google Sheets price updates are not enabled.",
        )

    selected_keys = tuple(dict.fromkeys(source_keys or V1_SOURCES.keys()))
    if not selected_keys:
        raise SheetSyncWorkflowError("empty_source_selection", "Select at least one approved source.")
    for source_key in selected_keys:
        get_sheet_source(source_key)

    registry_rows = _ensure_registry_rows(db)
    approval_modes = {
        source_key: _approval_modes_for_source(
            db,
            source=V1_SOURCES[source_key],
            source_row=registry_rows[source_key],
        )
        for source_key in selected_keys
    }
    run = models.SheetSyncRun(
        public_id=str(uuid4()),
        trigger_type=trigger_type,
        status="running",
        source_keys_json=_json_dumps(selected_keys),
        summary_json="{}",
        requested_by_user_id=actor_user_id,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run_id = run.id

    counters = {
        "sources_checked": 0,
        "rows_received": 0,
        "valid_rows": 0,
        "invalid_rows": 0,
        "duplicate_rows": 0,
        "missing_identifier_rows": 0,
        "blank_rows": 0,
        "missing_targets": 0,
        "changes_detected": 0,
        "changes_suppressed": 0,
        "unchanged_fields": 0,
        "auto_apply_candidates": 0,
        "auto_applied": 0,
        "auto_conflicts": 0,
        "auto_failed": 0,
        "source_errors": [],
    }
    auto_apply_candidate_ids: list[str] = []

    try:
        sheet_reader = reader or GoogleSheetsRestReader(
            load_google_sheets_config(),
            oidc_token=oidc_token,
        )
        batches = sheet_reader.read_sources(selected_keys)
        products = {
            product.sku.upper(): product
            for product in db.query(models.ProductSKU).all()
        }

        for batch in batches:
            for range_read in batch.ranges:
                source = range_read.source
                source_row = registry_rows[source.key]
                values = range_read.values
                counters["sources_checked"] += 1
                if not values:
                    counters["source_errors"].append(
                        {"source_key": source.key, "code": "empty_approved_range"}
                    )
                    continue
                try:
                    parsed = parse_source_rows(values, source)
                except HeaderValidationError:
                    counters["source_errors"].append(
                        {"source_key": source.key, "code": "invalid_headers"}
                    )
                    continue

                unique_by_row = {row.row_number: row for row in parsed.rows}
                duplicates_by_row = _find_duplicate_rows(parsed)
                missing_rows = set(parsed.missing_identifier_rows)
                invalid_identifier_rows = set(parsed.invalid_identifier_rows)
                blank_rows = set(parsed.blank_rows)
                counters["duplicate_rows"] += len(duplicates_by_row)
                counters["missing_identifier_rows"] += len(missing_rows)
                counters["blank_rows"] += len(blank_rows)

                header = values[0]
                for offset, row_values in enumerate(values[1:], start=1):
                    row_number = source.header_row + offset
                    counters["rows_received"] += 1
                    raw_payload = _raw_row_payload(header, row_values)
                    if row_number in blank_rows:
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=None,
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="blank",
                        )
                        continue
                    if row_number in missing_rows:
                        counters["invalid_rows"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=None,
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="missing_identifier",
                            errors=("Stable SKU identifier is blank.",),
                        )
                        continue
                    if row_number in invalid_identifier_rows:
                        counters["invalid_rows"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=None,
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="invalid",
                            errors=("Stable SKU identifier has an invalid format.",),
                        )
                        continue
                    if row_number in duplicates_by_row:
                        counters["invalid_rows"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=duplicates_by_row[row_number],
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="duplicate",
                            errors=("Duplicate stable SKU; row excluded from change detection.",),
                        )
                        continue

                    mapped_row = unique_by_row.get(row_number)
                    if mapped_row is None:
                        counters["invalid_rows"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=None,
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="invalid",
                            errors=("Row could not be mapped safely.",),
                        )
                        continue
                    try:
                        normalized = normalize_source_row(mapped_row, source)
                    except (ValueNormalizationError, SheetNormalizationError) as exc:
                        counters["invalid_rows"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=mapped_row.identifier,
                            raw_payload=raw_payload,
                            normalized_payload=None,
                            validation_status="invalid",
                            errors=(str(exc),),
                        )
                        continue

                    product = products.get(mapped_row.identifier)
                    if product is None:
                        counters["invalid_rows"] += 1
                        counters["missing_targets"] += 1
                        _create_snapshot(
                            db,
                            run=run,
                            source_row=source_row,
                            row_number=row_number,
                            identifier=mapped_row.identifier,
                            raw_payload=raw_payload,
                            normalized_payload=normalized.values,
                            validation_status="invalid",
                            errors=("Matching H+H product SKU was not found; creation is not allowed.",),
                        )
                        continue

                    counters["valid_rows"] += 1
                    snapshot = _create_snapshot(
                        db,
                        run=run,
                        source_row=source_row,
                        row_number=row_number,
                        identifier=mapped_row.identifier,
                        raw_payload=raw_payload,
                        normalized_payload=normalized.values,
                        validation_status="valid",
                    )
                    detected, unchanged, suppressed, auto_candidates = _queue_product_changes(
                        db,
                        run=run,
                        source=source,
                        source_row=source_row,
                        snapshot=snapshot,
                        mapped_row=mapped_row,
                        normalized_values=normalized.values,
                        product=product,
                        actor_user_id=actor_user_id,
                        approval_modes=approval_modes[source.key],
                    )
                    counters["changes_detected"] += detected
                    counters["unchanged_fields"] += unchanged
                    counters["changes_suppressed"] += suppressed
                    auto_apply_candidate_ids.extend(auto_candidates)

        has_detection_errors = bool(counters["source_errors"] or counters["invalid_rows"])
        counters["auto_apply_candidates"] = len(dict.fromkeys(auto_apply_candidate_ids))
        run.summary_json = _json_dumps(counters)
        db.commit()

        for change_public_id in dict.fromkeys(auto_apply_candidate_ids):
            try:
                review_change(
                    db,
                    change_public_id=change_public_id,
                    action="accept",
                    actor_user_id=actor_user_id,
                    resolution_note="Applied automatically from the owner-approved Google Sheets price sync.",
                    automated=True,
                )
                counters["auto_applied"] += 1
            except SheetSyncConflictError:
                counters["auto_conflicts"] += 1
            except SheetSyncWorkflowError:
                counters["auto_failed"] += 1

        completed_run = db.query(models.SheetSyncRun).filter(
            models.SheetSyncRun.id == run_id
        ).one()
        completed_run.status = (
            "completed_with_errors"
            if has_detection_errors
            or counters["auto_conflicts"]
            or counters["auto_failed"]
            else "completed"
        )
        completed_run.summary_json = _json_dumps(counters)
        completed_run.completed_at = _utcnow_naive()
        db.commit()
        db.refresh(completed_run)
        return completed_run
    except Exception as error:
        db.rollback()
        failed_run = db.query(models.SheetSyncRun).filter(
            models.SheetSyncRun.id == run.id
        ).first()
        if failed_run is not None:
            failed_run.status = "failed"
            failed_run.completed_at = _utcnow_naive()
            failed_run.error_code = getattr(error, "code", "sync_run_failed")
            failed_run.error_message = _safe_error_message(error)
            failed_run.summary_json = _json_dumps(counters)
            db.commit()
        raise


def _mark_conflict(
    db: Session,
    change: models.SheetSyncChange,
    *,
    actor_user_id: int,
    code: str,
    message: str,
) -> None:
    change.status = "conflict"
    change.error_code = code
    change.error_message = message
    _add_change_event(
        db,
        change,
        "conflict",
        actor_user_id=actor_user_id,
        payload={"code": code},
    )
    db.commit()


def review_change(
    db: Session,
    *,
    change_public_id: str,
    action: str,
    actor_user_id: int,
    resolution_note: str | None = None,
    automated: bool = False,
) -> models.SheetSyncChange:
    if action not in REVIEW_ACTIONS:
        raise SheetSyncWorkflowError("invalid_review_action", "Review action is not supported.")
    if automated and action != "accept":
        raise SheetSyncWorkflowError(
            "invalid_automatic_action",
            "Automatic Sheet handling may only accept approved price changes.",
        )
    change = db.query(models.SheetSyncChange).filter(
        models.SheetSyncChange.public_id == change_public_id
    ).first()
    if change is None:
        raise SheetSyncWorkflowError("change_not_found", "Sheet change was not found.")
    if change.status not in REVIEWABLE_STATUSES:
        raise SheetSyncWorkflowError(
            "change_already_resolved",
            "This Sheet change has already been resolved.",
        )

    if action in {"reject", "ignore"}:
        change.status = "rejected" if action == "reject" else "ignored"
        change.decided_at = _utcnow_naive()
        change.decided_by_user_id = actor_user_id
        change.resolution_note = (resolution_note or "").strip() or None
        change.error_code = None
        change.error_message = None
        _add_change_event(
            db,
            change,
            change.status,
            actor_user_id=actor_user_id,
            payload={"resolution_note": change.resolution_note or ""},
        )
        db.commit()
        db.refresh(change)
        return change

    if change.status == "conflict":
        raise SheetSyncConflictError(
            "explicit_conflict_resolution_required",
            "This proposal conflicts with a newer H+H value. Reject or ignore it, then run a new check.",
        )
    if change.destination_entity != "product" or change.destination_field not in SHEET_SYNC_PRODUCT_FIELDS:
        raise SheetSyncWorkflowError(
            "destination_not_approved",
            "The proposed destination is not approved for Sheet synchronization.",
        )

    source_row = db.query(models.SheetSyncSource).filter(
        models.SheetSyncSource.id == change.source_id
    ).first()
    if source_row is None:
        raise SheetSyncWorkflowError("source_not_found", "The approved Sheet source is unavailable.")
    source = get_sheet_source(source_row.source_key)
    mapping = _mapping_for_field(source, change.destination_field)
    if mapping.source_header != change.source_header:
        raise SheetSyncWorkflowError(
            "mapping_not_approved",
            "The proposed source mapping is no longer approved.",
        )
    if automated and (
        change.approval_mode != "auto_apply"
        or not mapping.auto_apply_eligible
        or change.destination_field not in AUTO_APPLY_PRICE_FIELDS
    ):
        raise SheetSyncWorkflowError(
            "automatic_destination_not_approved",
            "This Sheet field is not approved for automatic application.",
        )

    product = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku == change.stable_identifier
    ).with_for_update().first()
    if product is None:
        _mark_conflict(
            db,
            change,
            actor_user_id=actor_user_id,
            code="destination_missing",
            message="The destination product no longer exists.",
        )
        raise SheetSyncConflictError("destination_missing", "The destination product no longer exists.")
    if _destination_version(product) != change.destination_version:
        _mark_conflict(
            db,
            change,
            actor_user_id=actor_user_id,
            code="destination_changed",
            message="The H+H product changed after this proposal was detected.",
        )
        raise SheetSyncConflictError(
            "destination_changed",
            "The H+H product changed after this proposal was detected.",
        )

    previous_value = _json_loads(change.previous_value_json)
    if not _values_match(
        mapping,
        getattr(product, change.destination_field),
        previous_value,
    ):
        _mark_conflict(
            db,
            change,
            actor_user_id=actor_user_id,
            code="destination_value_changed",
            message="The destination field changed after detection.",
        )
        raise SheetSyncConflictError(
            "destination_value_changed",
            "The destination field changed after detection.",
        )

    # Persist the owner's decision before applying so the accepted action is
    # still auditable if the validated business mutation subsequently fails.
    change.status = "accepted"
    change.decided_at = _utcnow_naive()
    change.decided_by_user_id = actor_user_id
    change.resolution_note = (resolution_note or "").strip() or None
    _add_change_event(
        db,
        change,
        "accepted",
        actor_user_id=actor_user_id,
        payload={
            "resolution_note": change.resolution_note or "",
            "decision_source": "automatic_price_sync" if automated else "owner_review",
        },
    )
    db.commit()

    try:
        change = db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.public_id == change_public_id
        ).first()
        product = db.query(models.ProductSKU).filter(
            models.ProductSKU.sku == change.stable_identifier
        ).with_for_update().first()
        if product is None or _destination_version(product) != change.destination_version:
            _mark_conflict(
                db,
                change,
                actor_user_id=actor_user_id,
                code="destination_changed_during_apply",
                message="The H+H product changed while this proposal was being applied.",
            )
            raise SheetSyncConflictError(
                "destination_changed_during_apply",
                "The H+H product changed while this proposal was being applied.",
            )

        proposed_value = _json_loads(change.proposed_value_json)
        apply_product_updates(
            product,
            {change.destination_field: proposed_value},
            permitted_fields=SHEET_SYNC_PRODUCT_FIELDS,
        )
        db.flush()
        db.refresh(product)
        new_destination_version = _destination_version(product)

        # Multiple fields from one Sheet row share the same detected product
        # version. Rebase still-pending siblings after this controlled mutation
        # so retail and reseller prices can apply sequentially without treating
        # each other as an external Hub edit.
        sibling_changes = db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.id != change.id,
            models.SheetSyncChange.stable_identifier == change.stable_identifier,
            models.SheetSyncChange.status == "pending",
            models.SheetSyncChange.destination_version == change.destination_version,
        ).all()
        for sibling in sibling_changes:
            sibling.destination_version = new_destination_version

        # Costing caches may contain retail-price/margin projections for the
        # changed product; invalidate them inside the same application path as
        # the normal owner edit endpoint.
        from ..routers.costing import clear_costing_cache

        clear_costing_cache()
        change.status = "applied"
        change.applied_at = _utcnow_naive()
        change.applied_by_user_id = actor_user_id
        change.error_code = None
        change.error_message = None
        _add_change_event(
            db,
            change,
            "applied",
            actor_user_id=actor_user_id,
            payload={
                "destination_version_before": change.destination_version,
                "destination_version_after": new_destination_version,
                "decision_source": "automatic_price_sync" if automated else "owner_review",
            },
        )
        db.commit()
        db.refresh(change)
        return change
    except SheetSyncConflictError:
        raise
    except (MasterDataValidationError, ValueError, TypeError) as error:
        db.rollback()
        change = db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.public_id == change_public_id
        ).first()
        change.status = "failed"
        change.error_code = "validated_apply_failed"
        change.error_message = "The accepted product update failed validation."
        _add_change_event(
            db,
            change,
            "failed",
            actor_user_id=actor_user_id,
            payload={"error_type": type(error).__name__},
        )
        db.commit()
        raise SheetSyncWorkflowError(
            "validated_apply_failed",
            "The accepted product update failed validation.",
        ) from error


def decode_json_field(value: str) -> object:
    """Serializer helper for owner-only API responses."""
    return _json_loads(value)

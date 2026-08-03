"""Normalized customer preorders with public intake and controlled fulfillment.

Public access is deliberately limited to opaque-token catalog/submission routes.
All management routes use the database-authoritative H+H user dependency. V1
does not reserve stock: inventory is deducted only when the existing Market
Event POS transaction commits during fulfillment.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import logging
import re
import secrets
from typing import Dict, Optional

logger = logging.getLogger("hh_backend.preorders")

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from .. import auth, models, schemas
from ..database import get_db
from ..services.database_login_rate_limiter import DatabaseLoginRateLimiter
from .market_events import record_market_event_sale


router = APIRouter(prefix="/preorders", tags=["Preorders"])

CURRENT_LINEUP_CATEGORIES = (
    "Sweet", "Savory", "Sandwich", "Spreads & Sauces", "Sandwiches & Salads", "Spreads", "Sandwiches", "General"
)
PUBLIC_TOKEN_MIN_LENGTH = 32
PUBLIC_TOKEN_MAX_LENGTH = 64
MAX_TOTAL_UNITS = 100
MAX_TOTAL_AMOUNT = Decimal("100000.00")
MAX_FULFILLMENT_HORIZON_DAYS = 180
STAFF_FULFILLMENT_STATUSES = {"Confirmed", "Preparing", "Ready"}

OWNER_STATUS_TRANSITIONS = {
    "Pending": {"Confirmed", "Cancelled"},
    "Confirmed": {"Preparing", "Cancelled"},
    "Preparing": {"Ready", "Cancelled"},
    "Ready": {"Cancelled", "No-show"},
    "Fulfilled": set(),
    "Cancelled": set(),
    "No-show": set(),
}
STAFF_STATUS_TRANSITIONS = {
    "Confirmed": {"Preparing"},
    "Preparing": {"Ready"},
    "Ready": {"No-show"},
}
PAYMENT_STATUS_TRANSITIONS = {
    "Unpaid": {"Partial", "Paid", "Receivable"},
    "Partial": {"Paid", "Receivable", "Refunded"},
    "Paid": {"Refunded"},
    "Receivable": {"Partial", "Paid", "Refunded"},
    "Refunded": set(),
}

# These use the existing database-shared limiter table so warm serverless
# instances do not each get an independent submission allowance. The generic
# limiter names an attempt a "failure"; here it is intentionally used as a
# bounded request counter, and duplicate idempotent replays are excluded.
_submission_client_limiter = DatabaseLoginRateLimiter(
    scope="preorder_client",
    max_failures=12,
    window_seconds=15 * 60,
    lock_seconds=15 * 60,
)
_submission_form_limiter = DatabaseLoginRateLimiter(
    scope="preorder_form",
    max_failures=150,
    window_seconds=15 * 60,
    lock_seconds=15 * 60,
)

_STAFF_ASSIGNMENT_SEPARATOR = re.compile(r"[,;|\r\n]+")
_PUBLIC_REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_MONEY_QUANTUM = Decimal("0.01")


def _money(value: object) -> Decimal:
    return Decimal(str(value or 0)).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def _json_dump(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _json_load(value: Optional[str], fallback):
    try:
        loaded = json.loads(value or "")
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback
    return loaded


def _bounded_extension(value: Dict[str, object]) -> str:
    encoded = _json_dump(value)
    if len(encoded.encode("utf-8")) > 4096:
        raise HTTPException(status_code=422, detail="Extension data must be 4 KB or smaller.")
    return encoded


def _token_hash(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def _new_form_token(db: Session) -> tuple[str, str, str]:
    for _ in range(5):
        raw_token = secrets.token_urlsafe(32)
        token_hash = _token_hash(raw_token)
        exists = db.query(models.PreorderForm.id).filter(
            models.PreorderForm.token_hash == token_hash
        ).first()
        if not exists:
            return raw_token, token_hash, raw_token[-8:]
    raise HTTPException(status_code=503, detail="Could not allocate a secure public form token.")


def _new_public_reference(db: Session) -> str:
    for _ in range(5):
        suffix = "".join(secrets.choice(_PUBLIC_REFERENCE_ALPHABET) for _ in range(16))
        reference = f"HH-{suffix}"
        exists = db.query(models.Preorder.id).filter(
            models.Preorder.public_reference == reference
        ).first()
        if not exists:
            return reference
    raise HTTPException(status_code=503, detail="Could not allocate a public preorder reference.")


def _form_for_public_token_inner(db: Session, raw_token: str) -> models.PreorderForm:
    if raw_token.lower() == "default":
        default_hash = _token_hash("default")
        form = db.query(models.PreorderForm).options(
            joinedload(models.PreorderForm.event)
        ).filter(models.PreorderForm.token_hash == default_hash).first()

        if not form:
            form = db.query(models.PreorderForm).options(
                joinedload(models.PreorderForm.event)
            ).filter(models.PreorderForm.is_enabled == True).order_by(models.PreorderForm.id.asc()).first()

        if not form:
            form = models.PreorderForm(
                name="Default Customer Pre-Order Form",
                token_hash=default_hash,
                token_hint="default",
                is_enabled=True,
                event_id=None,
                fulfillment_methods_json=_json_dump(["Pickup", "Delivery"]),
                payment_preferences_json=_json_dump(["Cash", "GCash", "BPI / Bank Transfer"]),
                extension_json=_json_dump({}),
            )
            db.add(form)
            try:
                db.commit()
                db.refresh(form)
            except Exception as seed_err:
                logger.warning(f"Auto-seed default preorder form commit failed: {seed_err}")
                db.rollback()
                form = db.query(models.PreorderForm).filter(models.PreorderForm.token_hash == default_hash).first()

        if not form:
            raise HTTPException(status_code=404, detail="Preorder form not found.")
        return form

    if not PUBLIC_TOKEN_MIN_LENGTH <= len(raw_token) <= PUBLIC_TOKEN_MAX_LENGTH:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    form = db.query(models.PreorderForm).options(
        joinedload(models.PreorderForm.event)
    ).filter(models.PreorderForm.token_hash == _token_hash(raw_token)).first()
    if not form:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    return form


def _form_for_public_token(db: Session, raw_token: str) -> models.PreorderForm:
    try:
        return _form_for_public_token_inner(db, raw_token)
    except HTTPException:
        raise
    except Exception as err:
        db.rollback()
        try:
            from ..database import engine
            models.Base.metadata.create_all(bind=engine)
            return _form_for_public_token_inner(db, raw_token)
        except HTTPException:
            raise
        except Exception as retry_err:
            logger.error(f"Error fetching public preorder form: {retry_err}")
            raise HTTPException(status_code=404, detail="Preorder form not found.")


def _usable_form_event(form: models.PreorderForm) -> Optional[models.MarketEvent]:
    event = form.event
    if event and (event.is_deleted or event.status in {"Completed", "Cancelled"}):
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    return event


def _event_for_management(db: Session, event_id: int) -> models.MarketEvent:
    event = db.query(models.MarketEvent).filter(
        models.MarketEvent.id == event_id,
        models.MarketEvent.is_deleted == False,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Market Event not found.")
    if event.status in {"Completed", "Cancelled"}:
        raise HTTPException(status_code=409, detail="Completed or cancelled events cannot accept preorders.")
    return event


def _staff_assignment_tokens(staff_assigned: str) -> set[str]:
    return {
        token.strip().casefold()
        for token in _STAFF_ASSIGNMENT_SEPARATOR.split(staff_assigned or "")
        if token.strip()
    }


def _staff_is_assigned(event: Optional[models.MarketEvent], user: models.User) -> bool:
    username = (user.username or "").strip().casefold()
    return bool(
        event
        and username
        and not event.is_deleted
        and event.status == "Active"
        and username in _staff_assignment_tokens(event.staff_assigned)
    )


def _require_preorder_access(preorder: models.Preorder, user: models.User) -> None:
    if user.role == "owner":
        return
    if user.role != "staff":
        raise HTTPException(
            status_code=403,
            detail="Unauthorized access to preorder record.",
        )
    if preorder.event_id is not None and not _staff_is_assigned(preorder.event, user):
        raise HTTPException(
            status_code=403,
            detail="Market Event is not assigned to this staff account.",
        )


def _add_audit(
    db: Session,
    *,
    action: str,
    actor: models.User,
    form_id: Optional[int] = None,
    preorder_id: Optional[int] = None,
    payload: Optional[Dict[str, object]] = None,
) -> None:
    db.add(models.PreorderAuditEvent(
        form_id=form_id,
        preorder_id=preorder_id,
        action=action,
        actor_user_id=actor.id,
        actor_username_snapshot=actor.username,
        payload_json=_json_dump(payload or {}),
    ))


def _add_history(
    db: Session,
    preorder: models.Preorder,
    *,
    action: str,
    source: str,
    from_status: Optional[str],
    to_status: str,
    from_payment_status: Optional[str],
    to_payment_status: str,
    actor: Optional[models.User] = None,
    note: Optional[str] = None,
    payload: Optional[Dict[str, object]] = None,
) -> None:
    latest_sequence = db.query(func.max(models.PreorderStatusHistory.sequence_number)).filter(
        models.PreorderStatusHistory.preorder_id == preorder.id
    ).scalar()
    db.add(models.PreorderStatusHistory(
        preorder_id=preorder.id,
        sequence_number=int(latest_sequence or 0) + 1,
        action=action,
        source=source,
        from_status=from_status,
        to_status=to_status,
        from_payment_status=from_payment_status,
        to_payment_status=to_payment_status,
        actor_user_id=actor.id if actor else None,
        actor_username_snapshot=actor.username if actor else None,
        note=note,
        payload_json=_json_dump(payload or {}),
    ))


def _item_out(item: models.PreorderItem) -> schemas.PreorderItemOut:
    return schemas.PreorderItemOut(
        id=item.id,
        sku=item.sku,
        product_name=item.product_name_snapshot,
        size=item.size_snapshot,
        quantity=item.quantity,
        unit_price=_money(item.unit_price_snapshot),
        line_total=_money(item.line_total_snapshot),
    )


def _form_out(
    form: models.PreorderForm,
    *,
    raw_token: Optional[str] = None,
) -> schemas.PreorderFormOut:
    event = form.event
    return schemas.PreorderFormOut(
        id=form.id,
        name=form.name,
        public_token=raw_token,
        token_hint=form.token_hint,
        is_enabled=form.is_enabled,
        event_id=form.event_id,
        event_name=event.name if event else None,
        event_date=event.event_date if event else None,
        event_location=event.location if event else None,
        allowed_fulfillment_methods=_json_load(form.fulfillment_methods_json, []),
        payment_preferences=_json_load(form.payment_preferences_json, []),
        extension=_json_load(form.extension_json, {}),
        created_by_username=form.created_by.username if form.created_by else None,
        updated_by_username=form.updated_by.username if form.updated_by else None,
        created_at=form.created_at,
        updated_at=form.updated_at,
    )


def _summary_out(preorder: models.Preorder) -> schemas.PreorderSummaryOut:
    return schemas.PreorderSummaryOut(
        id=preorder.id,
        public_reference=preorder.public_reference,
        form_id=preorder.form_id,
        form_name=preorder.form.name,
        event_id=preorder.event_id,
        event_name=preorder.event.name if preorder.event else None,
        customer_name=preorder.customer_name,
        contact_email=preorder.contact_email,
        contact_phone=preorder.contact_phone,
        requested_fulfillment_date=preorder.requested_fulfillment_date,
        requested_fulfillment_time=preorder.requested_fulfillment_time,
        fulfillment_method=preorder.fulfillment_method,
        status=preorder.status,
        payment_status=preorder.payment_status,
        total_amount=_money(preorder.total_amount),
        total_units=sum(item.quantity for item in preorder.items),
        created_at=preorder.created_at,
        updated_at=preorder.updated_at,
    )


def _detail_out(
    preorder: models.Preorder,
    *,
    include_internal_history: bool,
) -> schemas.PreorderDetailOut:
    history = []
    audit_events = []
    if include_internal_history:
        history = [
            schemas.PreorderStatusHistoryOut(
                id=entry.id,
                sequence_number=entry.sequence_number,
                action=entry.action,
                source=entry.source,
                from_status=entry.from_status,
                to_status=entry.to_status,
                from_payment_status=entry.from_payment_status,
                to_payment_status=entry.to_payment_status,
                actor_username=entry.actor_username_snapshot,
                note=entry.note,
                payload=_json_load(entry.payload_json, {}),
                created_at=entry.created_at,
            )
            for entry in preorder.status_history
        ]
        audit_events = [
            schemas.PreorderAuditEventOut(
                id=entry.id,
                action=entry.action,
                actor_username=entry.actor_username_snapshot,
                payload=_json_load(entry.payload_json, {}),
                created_at=entry.created_at,
            )
            for entry in preorder.audit_events
        ]

    summary = _summary_out(preorder).model_dump()
    return schemas.PreorderDetailOut(
        **summary,
        delivery_address=preorder.delivery_address,
        notes=preorder.notes,
        payment_preference=preorder.payment_preference,
        extension=_json_load(preorder.extension_json, {}),
        fulfillment_sale_id=preorder.fulfillment_sale_id,
        fulfillment_client_reference=preorder.fulfillment_client_reference,
        fulfilled_at=preorder.fulfilled_at,
        items=[_item_out(item) for item in preorder.items],
        status_history=history,
        audit_events=audit_events,
    )


def _public_receipt(preorder: models.Preorder) -> schemas.PublicPreorderReceiptOut:
    return schemas.PublicPreorderReceiptOut(
        public_reference=preorder.public_reference,
        status=preorder.status,
        payment_status=preorder.payment_status,
        total_amount=_money(preorder.total_amount),
        requested_fulfillment_date=preorder.requested_fulfillment_date,
        requested_fulfillment_time=preorder.requested_fulfillment_time,
        fulfillment_method=preorder.fulfillment_method,
        submitted_at=preorder.created_at,
        items=[_item_out(item) for item in preorder.items],
    )


def _preorder_query(db: Session):
    return db.query(models.Preorder).options(
        joinedload(models.Preorder.form),
        joinedload(models.Preorder.event),
        selectinload(models.Preorder.items),
        selectinload(models.Preorder.status_history),
        selectinload(models.Preorder.audit_events),
    )


def _request_fingerprint(form_id: int, payload: schemas.PublicPreorderCreate) -> str:
    quantities: Dict[str, int] = defaultdict(int)
    for item in payload.items:
        quantities[item.sku] += item.quantity
    normalized = {
        "form_id": form_id,
        "customer_name": payload.customer_name,
        "contact_email": payload.contact_email,
        "contact_phone": payload.contact_phone,
        "requested_fulfillment_date": payload.requested_fulfillment_date.isoformat(),
        "requested_fulfillment_time": payload.requested_fulfillment_time.isoformat(),
        "fulfillment_method": payload.fulfillment_method,
        "delivery_address": payload.delivery_address,
        "notes": payload.notes,
        "payment_preference": payload.payment_preference,
        "items": [{"sku": sku, "quantity": quantities[sku]} for sku in sorted(quantities)],
        "extension": payload.extension,
    }
    return hashlib.sha256(_json_dump(normalized).encode("utf-8")).hexdigest()


def _client_key(request: Request, form: models.PreorderForm) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    socket_host = request.client.host if request.client else "unknown"
    return f"{form.id}:{forwarded or socket_host}"


def _count_public_submission_attempt(db: Session, request: Request, form: models.PreorderForm) -> None:
    client_key = _client_key(request, form)
    retry_after = max(
        _submission_client_limiter.retry_after(db, client_key),
        _submission_form_limiter.retry_after(db, str(form.id)),
    )
    if retry_after:
        raise HTTPException(
            status_code=429,
            detail="Too many preorder submissions. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )

    # Count the attempt before starting the order transaction. A rejected SKU,
    # excessive total, or other business validation must still consume quota.
    _submission_client_limiter.record_failure(db, client_key)
    _submission_form_limiter.record_failure(db, str(form.id))


@router.post("/forms", response_model=schemas.PreorderFormOut, status_code=201)
def create_preorder_form(
    payload: schemas.PreorderFormCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner),
):
    if payload.event_id is not None:
        _event_for_management(db, payload.event_id)

    raw_token, token_hash, token_hint = _new_form_token(db)
    form = models.PreorderForm(
        name=payload.name,
        token_hash=token_hash,
        token_hint=token_hint,
        is_enabled=payload.is_enabled,
        event_id=payload.event_id,
        fulfillment_methods_json=_json_dump(payload.allowed_fulfillment_methods),
        payment_preferences_json=_json_dump(payload.payment_preferences),
        extension_json=_bounded_extension(payload.extension),
        created_by_user_id=current_user.id,
        updated_by_user_id=current_user.id,
    )
    db.add(form)
    try:
        db.flush()
        _add_audit(
            db,
            action="form_created",
            actor=current_user,
            form_id=form.id,
            payload={"enabled": form.is_enabled, "event_id": form.event_id},
        )
        db.commit()
        db.refresh(form)
    except Exception:
        db.rollback()
        raise
    return _form_out(form, raw_token=raw_token)


@router.get("/forms", response_model=list[schemas.PreorderFormOut])
def list_preorder_forms(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner),
):
    del current_user
    forms = db.query(models.PreorderForm).options(
        joinedload(models.PreorderForm.event),
        joinedload(models.PreorderForm.created_by),
        joinedload(models.PreorderForm.updated_by),
    ).order_by(models.PreorderForm.created_at.desc()).all()
    return [_form_out(form) for form in forms]


@router.patch("/forms/{form_id}", response_model=schemas.PreorderFormOut)
def update_preorder_form(
    form_id: int,
    payload: schemas.PreorderFormUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner),
):
    form = db.query(models.PreorderForm).filter(
        models.PreorderForm.id == form_id
    ).with_for_update().first()
    if not form:
        raise HTTPException(status_code=404, detail="Preorder form not found.")

    fields = payload.model_fields_set
    if not fields:
        raise HTTPException(status_code=422, detail="At least one form field is required.")

    changed: Dict[str, object] = {}
    if "name" in fields and payload.name is not None and payload.name != form.name:
        form.name = payload.name
        changed["name"] = payload.name
    if "event_id" in fields and payload.event_id != form.event_id:
        if payload.event_id is not None:
            _event_for_management(db, payload.event_id)
        form.event_id = payload.event_id
        changed["event_id"] = payload.event_id
    if "allowed_fulfillment_methods" in fields and payload.allowed_fulfillment_methods is not None:
        encoded = _json_dump(payload.allowed_fulfillment_methods)
        if encoded != form.fulfillment_methods_json:
            form.fulfillment_methods_json = encoded
            changed["allowed_fulfillment_methods"] = payload.allowed_fulfillment_methods
    if "payment_preferences" in fields and payload.payment_preferences is not None:
        encoded = _json_dump(payload.payment_preferences)
        if encoded != form.payment_preferences_json:
            form.payment_preferences_json = encoded
            changed["payment_preferences"] = payload.payment_preferences
    if "extension" in fields and payload.extension is not None:
        encoded = _bounded_extension(payload.extension)
        if encoded != form.extension_json:
            form.extension_json = encoded
            changed["extension_updated"] = True
    if "is_enabled" in fields and payload.is_enabled is not None and payload.is_enabled != form.is_enabled:
        if payload.is_enabled and form.event_id is not None:
            _event_for_management(db, form.event_id)
        form.is_enabled = payload.is_enabled
        changed["is_enabled"] = payload.is_enabled

    if not changed:
        raise HTTPException(status_code=409, detail="The preorder form already has those values.")
    form.updated_by_user_id = current_user.id
    _add_audit(
        db,
        action="form_updated",
        actor=current_user,
        form_id=form.id,
        payload=changed,
    )
    try:
        db.commit()
        db.refresh(form)
    except Exception:
        db.rollback()
        raise
    return _form_out(form)


@router.post("/forms/{form_id}/rotate-token", response_model=schemas.PreorderFormOut)
def rotate_preorder_form_token(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner),
):
    form = db.query(models.PreorderForm).filter(
        models.PreorderForm.id == form_id
    ).with_for_update().first()
    if not form:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    raw_token, token_hash, token_hint = _new_form_token(db)
    form.token_hash = token_hash
    form.token_hint = token_hint
    form.updated_by_user_id = current_user.id
    _add_audit(
        db,
        action="form_token_rotated",
        actor=current_user,
        form_id=form.id,
        payload={"token_hint": token_hint},
    )
    try:
        db.commit()
        db.refresh(form)
    except Exception:
        db.rollback()
        raise
    return _form_out(form, raw_token=raw_token)


@router.get(
    "/public/forms/{public_token}/catalog",
    response_model=schemas.PublicPreorderCatalogOut,
)
@router.get(
    "/public/{public_token}",
    response_model=schemas.PublicPreorderCatalogOut,
)
def get_public_preorder_catalog(
    public_token: str,
    db: Session = Depends(get_db),
):
    try:
        form = _form_for_public_token(db, public_token)
        if not form.is_enabled:
            raise HTTPException(status_code=404, detail="Preorder form not found.")
        event = _usable_form_event(form)
        ext = _json_load(form.extension_json, {})
        disabled_skus = set(ext.get("disabled_skus", []))

        products = db.query(models.ProductSKU).filter(
            or_(models.ProductSKU.is_active == True, models.ProductSKU.is_active.is_(None)),
            models.ProductSKU.category.in_(CURRENT_LINEUP_CATEGORIES),
            models.ProductSKU.retail_price > 0,
        ).order_by(
            models.ProductSKU.category.asc(),
            models.ProductSKU.product_name.asc(),
            models.ProductSKU.size.asc(),
        ).all()
        products = [p for p in products if p.sku not in disabled_skus]
        return schemas.PublicPreorderCatalogOut(
            form_name=form.name,
            event=(
                schemas.PublicPreorderEventOut(
                    name=event.name,
                    event_date=event.event_date,
                    location=event.location,
                )
                if event
                else None
            ),
            allowed_fulfillment_methods=_json_load(form.fulfillment_methods_json, []),
            payment_preferences=_json_load(form.payment_preferences_json, []),
            products=[
                schemas.PublicPreorderCatalogProductOut(
                    sku=product.sku,
                    product_name=product.product_name,
                    category=product.category,
                    size=product.size,
                    retail_price=_money(product.retail_price),
                )
                for product in products
            ],
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Failed to fetch public preorder catalog for token {public_token}: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Catalog load error: {str(exc)}")


@router.post(
    "/public/forms/{public_token}/submissions",
    response_model=schemas.PublicPreorderReceiptOut,
    status_code=201,
)
@router.post(
    "/public/{public_token}",
    response_model=schemas.PublicPreorderReceiptOut,
    status_code=201,
)
def submit_public_preorder(
    public_token: str,
    payload: schemas.PublicPreorderCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    form = _form_for_public_token(db, public_token)
    fingerprint = _request_fingerprint(form.id, payload)

    existing = _preorder_query(db).filter(
        models.Preorder.form_id == form.id,
        models.Preorder.submission_reference == payload.submission_reference,
    ).first()
    if existing:
        if existing.submission_fingerprint != fingerprint:
            raise HTTPException(
                status_code=409,
                detail="Submission reference was already used for different preorder details.",
            )
        return _public_receipt(existing)

    if not form.is_enabled:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    event = _usable_form_event(form)
    _count_public_submission_attempt(db, request, form)

    today = date.today()
    if payload.requested_fulfillment_date < today:
        raise HTTPException(status_code=422, detail="Requested fulfillment date cannot be in the past.")
    if payload.requested_fulfillment_date > today + timedelta(days=MAX_FULFILLMENT_HORIZON_DAYS):
        raise HTTPException(status_code=422, detail="Requested fulfillment date is too far in the future.")
    if payload.requested_fulfillment_time.tzinfo is not None:
        raise HTTPException(status_code=422, detail="Requested fulfillment time must be local time without an offset.")

    allowed_methods = _json_load(form.fulfillment_methods_json, [])
    if payload.fulfillment_method not in allowed_methods:
        raise HTTPException(status_code=422, detail="That fulfillment method is not available for this form.")
    allowed_preferences = _json_load(form.payment_preferences_json, [])
    if payload.payment_preference and allowed_preferences and payload.payment_preference not in allowed_preferences:
        raise HTTPException(status_code=422, detail="That payment preference is not available for this form.")
    extension_json = _bounded_extension(payload.extension)
    form_extension = _json_load(form.extension_json, {})
    disabled_skus = set(form_extension.get("disabled_skus", []))

    requested_by_sku: Dict[str, int] = defaultdict(int)
    for item in payload.items:
        requested_by_sku[item.sku] += item.quantity
    explicitly_disabled = sorted(set(requested_by_sku) & disabled_skus)
    if explicitly_disabled:
        raise HTTPException(
            status_code=422,
            detail=f"Unavailable product selection: {', '.join(explicitly_disabled)}.",
        )
    total_units = sum(requested_by_sku.values())
    if total_units > MAX_TOTAL_UNITS:
        raise HTTPException(status_code=422, detail=f"A preorder may contain at most {MAX_TOTAL_UNITS} units.")

    products = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku.in_(sorted(requested_by_sku)),
        or_(models.ProductSKU.is_active == True, models.ProductSKU.is_active.is_(None)),
        models.ProductSKU.category.in_(CURRENT_LINEUP_CATEGORIES),
        models.ProductSKU.retail_price > 0,
    ).with_for_update().all()
    products_by_sku = {product.sku: product for product in products}
    unavailable = sorted(set(requested_by_sku) - set(products_by_sku))
    if unavailable:
        raise HTTPException(
            status_code=422,
            detail=f"Unavailable product selection: {', '.join(unavailable)}.",
        )

    snapshot_rows = []
    total_amount = Decimal("0.00")
    for sku in sorted(requested_by_sku):
        product = products_by_sku[sku]
        quantity = requested_by_sku[sku]
        unit_price = _money(product.retail_price)
        line_total = (unit_price * quantity).quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)
        total_amount += line_total
        snapshot_rows.append((product, quantity, unit_price, line_total))
    total_amount = total_amount.quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)
    if total_amount <= 0:
        raise HTTPException(status_code=422, detail="Preorder total must be greater than zero.")
    if total_amount > MAX_TOTAL_AMOUNT:
        raise HTTPException(status_code=422, detail="Preorder total exceeds the supported limit.")

    public_reference = _new_public_reference(db)
    preorder = models.Preorder(
        public_reference=public_reference,
        form_id=form.id,
        event_id=event.id if event else None,
        submission_reference=payload.submission_reference,
        submission_fingerprint=fingerprint,
        fulfillment_client_reference=f"PREORDER-{public_reference}",
        customer_name=payload.customer_name,
        contact_email=payload.contact_email,
        contact_phone=payload.contact_phone,
        requested_fulfillment_date=payload.requested_fulfillment_date,
        requested_fulfillment_time=payload.requested_fulfillment_time,
        fulfillment_method=payload.fulfillment_method,
        delivery_address=payload.delivery_address,
        notes=payload.notes,
        payment_preference=payload.payment_preference,
        status="Pending",
        payment_status="Unpaid",
        total_amount=total_amount,
        extension_json=extension_json,
    )
    db.add(preorder)
    try:
        db.flush()
        for product, quantity, unit_price, line_total in snapshot_rows:
            db.add(models.PreorderItem(
                preorder_id=preorder.id,
                sku=product.sku,
                product_name_snapshot=product.product_name,
                size_snapshot=product.size,
                quantity=quantity,
                unit_price_snapshot=unit_price,
                line_total_snapshot=line_total,
            ))
        _add_history(
            db,
            preorder,
            action="submitted_publicly",
            source="public",
            from_status=None,
            to_status="Pending",
            from_payment_status=None,
            to_payment_status="Unpaid",
            payload={"form_id": form.id, "event_id": preorder.event_id},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        replay = _preorder_query(db).filter(
            models.Preorder.form_id == form.id,
            models.Preorder.submission_reference == payload.submission_reference,
        ).first()
        if replay and replay.submission_fingerprint == fingerprint:
            return _public_receipt(replay)
        if replay:
            raise HTTPException(
                status_code=409,
                detail="Submission reference was already used for different preorder details.",
            )
        raise HTTPException(status_code=409, detail="Preorder could not be created safely; please retry.")
    except Exception:
        db.rollback()
        raise

    created = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
    return _public_receipt(created)


def _assigned_active_event_ids(db: Session, user: models.User) -> list[int]:
    events = db.query(models.MarketEvent).filter(
        models.MarketEvent.status == "Active",
        models.MarketEvent.is_deleted == False,
    ).all()
    return [event.id for event in events if _staff_is_assigned(event, user)]


def _locked_preorder(db: Session, preorder_id: int) -> models.Preorder:
    preorder = db.query(models.Preorder).filter(
        models.Preorder.id == preorder_id
    ).with_for_update().first()
    if not preorder:
        raise HTTPException(status_code=404, detail="Preorder not found.")
    return preorder


def _fulfillment_access(preorder: models.Preorder, user: models.User) -> None:
    if user.role == "owner":
        return
    if (
        user.role != "staff"
        or preorder.status not in {"Ready", "Fulfilled"}
        or not _staff_is_assigned(preorder.event, user)
    ):
        raise HTTPException(
            status_code=403,
            detail="Staff fulfillment is limited to Ready preorders for assigned active Market Events.",
        )


def _validate_current_snapshot_prices(db: Session, preorder: models.Preorder) -> None:
    # Match the existing POS lock order and hold both the event and product rows
    # until ``record_market_event_sale`` commits. This closes the gap where a
    # sheet sync could otherwise change a retail price after preflight but before
    # the sale snapshot and allocation deduction are committed.
    db.query(models.MarketEvent.id).filter(
        models.MarketEvent.id == preorder.event_id
    ).with_for_update().first()
    skus = [item.sku for item in preorder.items]
    products = db.query(models.ProductSKU).filter(
        models.ProductSKU.sku.in_(skus)
    ).with_for_update().all()
    products_by_sku = {product.sku: product for product in products}
    for item in preorder.items:
        product = products_by_sku.get(item.sku)
        if (
            not product
            or not product.is_active
            or product.category not in CURRENT_LINEUP_CATEGORIES
        ):
            raise HTTPException(
                status_code=409,
                detail=f"SKU {item.sku} is no longer in the active public lineup.",
            )
        if _money(product.retail_price) != _money(item.unit_price_snapshot):
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Price for SKU {item.sku} changed after submission. "
                    "Cancel and recreate the preorder before POS fulfillment."
                ),
            )


def _verify_sale_matches_preorder(
    preorder: models.Preorder,
    sale: models.MarketEventSale,
) -> None:
    if (
        sale.event_id != preorder.event_id
        or sale.client_reference != preorder.fulfillment_client_reference
        or not sale.is_preorder
        or sale.preorder_customer_name != preorder.customer_name
    ):
        raise HTTPException(
            status_code=409,
            detail="Existing POS sale does not match this preorder; owner review is required.",
        )
    if preorder.fulfillment_sale_id not in {None, sale.id}:
        raise HTTPException(
            status_code=409,
            detail="Preorder is already linked to a different POS sale.",
        )

    expected = {
        item.sku: (item.quantity, _money(item.unit_price_snapshot))
        for item in preorder.items
    }
    actual_quantities: Dict[str, int] = defaultdict(int)
    actual_prices: Dict[str, set[Decimal]] = defaultdict(set)
    for item in sale.items:
        actual_quantities[item.sku] += item.quantity
        actual_prices[item.sku].add(_money(item.price_snapshot))
    if set(expected) != set(actual_quantities):
        raise HTTPException(
            status_code=409,
            detail="Existing POS sale items do not match this preorder; owner review is required.",
        )
    for sku, (quantity, price) in expected.items():
        if actual_quantities[sku] != quantity or actual_prices[sku] != {price}:
            raise HTTPException(
                status_code=409,
                detail="Existing POS sale items do not match this preorder; owner review is required.",
            )
    if _money(sale.total_amount) != _money(preorder.total_amount):
        raise HTTPException(
            status_code=409,
            detail="Existing POS sale total does not match this preorder; owner review is required.",
        )


def _payment_change_allowed(current: str, desired: str) -> bool:
    return desired == current or desired in PAYMENT_STATUS_TRANSITIONS.get(current, set())


def _clear_rejected_fulfillment_intent(
    db: Session,
    preorder_id: int,
    actor: models.User,
    *,
    reason_code: str,
) -> None:
    """Clear a known-safe failed attempt while preserving crash recovery.

    The intent is cleared only when the deterministic sale is confirmed absent.
    If the POS commit did happen but its response failed, the intent remains for
    the next request to recover and link that sale without another deduction.
    """
    db.rollback()
    failed = _locked_preorder(db, preorder_id)
    committed_sale = db.query(models.MarketEventSale.id).filter(
        models.MarketEventSale.event_id == failed.event_id,
        models.MarketEventSale.client_reference == failed.fulfillment_client_reference,
    ).first()
    if (
        not committed_sale
        and failed.status == "Ready"
        and failed.fulfillment_payment_status_intent is not None
    ):
        failed.fulfillment_payment_status_intent = None
        failed.updated_by_user_id = actor.id
        _add_history(
            db,
            failed,
            action="pos_fulfillment_rejected",
            source="internal",
            from_status=failed.status,
            to_status=failed.status,
            from_payment_status=failed.payment_status,
            to_payment_status=failed.payment_status,
            actor=actor,
            payload={"reason_code": reason_code},
        )
        _add_audit(
            db,
            action="pos_fulfillment_rejected",
            actor=actor,
            preorder_id=failed.id,
            payload={"event_id": failed.event_id, "reason_code": reason_code},
        )
        db.commit()
        return
    db.rollback()


def _link_fulfillment_sale(
    db: Session,
    preorder: models.Preorder,
    sale: models.MarketEventSale,
    *,
    desired_payment_status: str,
    actor: models.User,
    note: Optional[str],
    recovery: bool,
) -> schemas.PreorderDetailOut:
    _verify_sale_matches_preorder(preorder, sale)
    if preorder.status == "Fulfilled":
        if preorder.fulfillment_sale_id != sale.id:
            raise HTTPException(status_code=409, detail="Fulfilled preorder has an inconsistent POS link.")
        loaded = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
        return _detail_out(loaded, include_internal_history=actor.role == "owner")
    if preorder.status != "Ready":
        raise HTTPException(status_code=409, detail="Only Ready preorders can be fulfilled.")
    if not _payment_change_allowed(preorder.payment_status, desired_payment_status):
        raise HTTPException(
            status_code=409,
            detail=f"Payment state cannot move from {preorder.payment_status} to {desired_payment_status}.",
        )

    from_status = preorder.status
    from_payment = preorder.payment_status
    preorder.status = "Fulfilled"
    preorder.payment_status = desired_payment_status
    preorder.fulfillment_sale_id = sale.id
    preorder.fulfilled_at = datetime.utcnow()
    preorder.updated_by_user_id = actor.id
    action = "pos_fulfillment_recovered" if recovery else "pos_fulfilled"
    _add_history(
        db,
        preorder,
        action=action,
        source="internal",
        from_status=from_status,
        to_status="Fulfilled",
        from_payment_status=from_payment,
        to_payment_status=desired_payment_status,
        actor=actor,
        note=note,
        payload={"sale_id": sale.id, "event_id": preorder.event_id},
    )
    _add_audit(
        db,
        action=action,
        actor=actor,
        preorder_id=preorder.id,
        payload={
            "sale_id": sale.id,
            "event_id": preorder.event_id,
            "payment_status": desired_payment_status,
        },
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    loaded = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
    return _detail_out(loaded, include_internal_history=actor.role == "owner")


@router.get("", response_model=schemas.PreorderListOut)
def list_preorders(
    q: Optional[str] = Query(default=None, min_length=1, max_length=100),
    status: Optional[schemas.PreorderStatus] = None,
    payment_status: Optional[schemas.PreorderPaymentStatus] = None,
    fulfillment_method: Optional[schemas.PreorderFulfillmentMethod] = None,
    event_id: Optional[int] = Query(default=None, gt=0),
    requested_from: Optional[date] = None,
    requested_to: Optional[date] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if requested_from and requested_to and requested_from > requested_to:
        raise HTTPException(status_code=422, detail="requested_from must not be after requested_to.")

    query = db.query(models.Preorder).options(
        joinedload(models.Preorder.form),
        joinedload(models.Preorder.event),
    )
    if current_user.role == "staff":
        assigned_event_ids = _assigned_active_event_ids(db, current_user)
        if event_id is not None and event_id not in assigned_event_ids:
            raise HTTPException(status_code=403, detail="Market Event is not assigned to this staff account.")
        query = query.filter(
            or_(
                models.Preorder.event_id.is_(None),
                models.Preorder.event_id.in_(assigned_event_ids or [-1]),
            )
        )
    elif current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Preorder access is not available for this role.")

    if q:
        escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        search = f"%{escaped}%"
        query = query.filter(or_(
            models.Preorder.public_reference.ilike(search, escape="\\"),
            models.Preorder.customer_name.ilike(search, escape="\\"),
            models.Preorder.contact_email.ilike(search, escape="\\"),
            models.Preorder.contact_phone.ilike(search, escape="\\"),
        ))
    if status:
        query = query.filter(models.Preorder.status == status)
    if payment_status:
        query = query.filter(models.Preorder.payment_status == payment_status)
    if fulfillment_method:
        query = query.filter(models.Preorder.fulfillment_method == fulfillment_method)
    if event_id is not None:
        query = query.filter(models.Preorder.event_id == event_id)
    if requested_from:
        query = query.filter(models.Preorder.requested_fulfillment_date >= requested_from)
    if requested_to:
        query = query.filter(models.Preorder.requested_fulfillment_date <= requested_to)

    total = query.order_by(None).count()
    rows = query.order_by(
        models.Preorder.requested_fulfillment_date.asc(),
        models.Preorder.requested_fulfillment_time.asc(),
        models.Preorder.created_at.desc(),
    ).offset((page - 1) * page_size).limit(page_size).all()
    return schemas.PreorderListOut(
        items=[_summary_out(row) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/{preorder_id}/assign-event", response_model=schemas.PreorderDetailOut)
def assign_preorder_event(
    preorder_id: int,
    payload: schemas.PreorderEventAssignmentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_owner),
):
    preorder = _locked_preorder(db, preorder_id)
    if preorder.status != "Pending" or preorder.fulfillment_sale_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Event assignment is immutable after a preorder leaves Pending.",
        )
    event = _event_for_management(db, payload.event_id)
    if preorder.event_id == event.id:
        raise HTTPException(status_code=409, detail="Preorder is already assigned to that Market Event.")

    previous_event_id = preorder.event_id
    preorder.event_id = event.id
    preorder.updated_by_user_id = current_user.id
    note = (payload.note or "").strip() or None
    _add_history(
        db,
        preorder,
        action="event_assigned",
        source="internal",
        from_status=preorder.status,
        to_status=preorder.status,
        from_payment_status=preorder.payment_status,
        to_payment_status=preorder.payment_status,
        actor=current_user,
        note=note,
        payload={"from_event_id": previous_event_id, "to_event_id": event.id},
    )
    _add_audit(
        db,
        action="event_assigned",
        actor=current_user,
        preorder_id=preorder.id,
        payload={"from_event_id": previous_event_id, "to_event_id": event.id},
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    loaded = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
    return _detail_out(loaded, include_internal_history=True)


@router.post("/{preorder_id}/transition", response_model=schemas.PreorderDetailOut)
@router.patch("/{preorder_id}/status", response_model=schemas.PreorderDetailOut)
def transition_preorder(
    preorder_id: int,
    payload: schemas.PreorderTransitionRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    preorder = _locked_preorder(db, preorder_id)
    _require_preorder_access(preorder, current_user)
    if preorder.fulfillment_payment_status_intent:
        raise HTTPException(
            status_code=409,
            detail="A POS fulfillment attempt is in progress; retry fulfillment before another transition.",
        )

    from_status = preorder.status
    from_payment = preorder.payment_status
    to_status = payload.status or from_status
    to_payment = payload.payment_status or from_payment
    changed = False

    if payload.status is not None and payload.status != from_status:
        transitions = (
            OWNER_STATUS_TRANSITIONS
            if current_user.role == "owner"
            else STAFF_STATUS_TRANSITIONS
        )
        if payload.status not in transitions.get(from_status, set()):
            raise HTTPException(
                status_code=409,
                detail=f"Status cannot move from {from_status} to {payload.status}.",
            )
        if payload.status == "Confirmed":
            if preorder.event_id is not None:
                _event_for_management(db, preorder.event_id)
        changed = True

    if payload.payment_status is not None and payload.payment_status != from_payment:
        if current_user.role != "owner":
            raise HTTPException(status_code=403, detail="Only owners can change preorder payment state outside POS fulfillment.")
        if payload.payment_status not in PAYMENT_STATUS_TRANSITIONS.get(from_payment, set()):
            raise HTTPException(
                status_code=409,
                detail=f"Payment state cannot move from {from_payment} to {payload.payment_status}.",
            )
        changed = True

    if not changed:
        raise HTTPException(status_code=409, detail="Preorder already has the requested state.")

    preorder.status = to_status
    preorder.payment_status = to_payment
    preorder.updated_by_user_id = current_user.id
    action = (
        "status_and_payment_transition"
        if to_status != from_status and to_payment != from_payment
        else "status_transition" if to_status != from_status else "payment_transition"
    )
    _add_history(
        db,
        preorder,
        action=action,
        source="internal",
        from_status=from_status,
        to_status=to_status,
        from_payment_status=from_payment,
        to_payment_status=to_payment,
        actor=current_user,
        note=payload.note,
    )
    _add_audit(
        db,
        action=action,
        actor=current_user,
        preorder_id=preorder.id,
        payload={
            "from_status": from_status,
            "to_status": to_status,
            "from_payment_status": from_payment,
            "to_payment_status": to_payment,
        },
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    loaded = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
    return _detail_out(loaded, include_internal_history=current_user.role == "owner")


@router.post("/{preorder_id}/fulfill", response_model=schemas.PreorderDetailOut)
def fulfill_preorder(
    preorder_id: int,
    payload: schemas.PreorderFulfillmentRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    preorder = _locked_preorder(db, preorder_id)
    _fulfillment_access(preorder, current_user)
    if preorder.event_id is None:
        raise HTTPException(status_code=409, detail="Assign a Market Event before POS fulfillment.")

    existing_sale = db.query(models.MarketEventSale).options(
        selectinload(models.MarketEventSale.items)
    ).filter(
        models.MarketEventSale.event_id == preorder.event_id,
        models.MarketEventSale.client_reference == preorder.fulfillment_client_reference,
    ).first()
    if existing_sale:
        desired = preorder.fulfillment_payment_status_intent or (
            "Paid" if existing_sale.preorder_payment_status == "Paid" else "Receivable"
        )
        return _link_fulfillment_sale(
            db,
            preorder,
            existing_sale,
            desired_payment_status=desired,
            actor=current_user,
            note=payload.note,
            recovery=preorder.status != "Fulfilled",
        )

    if preorder.status == "Fulfilled":
        raise HTTPException(status_code=409, detail="Fulfilled preorder is missing its deterministic POS sale.")
    if preorder.status != "Ready":
        raise HTTPException(status_code=409, detail="Only Ready preorders can be fulfilled.")
    if payload.payment_status != "Paid" and payload.cash_received is not None:
        raise HTTPException(status_code=422, detail="Cash received cannot be recorded for a receivable fulfillment.")
    if not _payment_change_allowed(preorder.payment_status, payload.payment_status):
        raise HTTPException(
            status_code=409,
            detail=f"Payment state cannot move from {preorder.payment_status} to {payload.payment_status}.",
        )
    if (
        preorder.fulfillment_payment_status_intent is not None
        and preorder.fulfillment_payment_status_intent != payload.payment_status
    ):
        raise HTTPException(
            status_code=409,
            detail="A prior POS fulfillment attempt used a different payment-state intent.",
        )

    if preorder.fulfillment_payment_status_intent is None:
        preorder.fulfillment_payment_status_intent = payload.payment_status
        preorder.updated_by_user_id = current_user.id
        _add_history(
            db,
            preorder,
            action="pos_fulfillment_started",
            source="internal",
            from_status=preorder.status,
            to_status=preorder.status,
            from_payment_status=preorder.payment_status,
            to_payment_status=preorder.payment_status,
            actor=current_user,
            note=payload.note,
            payload={"event_id": preorder.event_id, "payment_status_intent": payload.payment_status},
        )
        _add_audit(
            db,
            action="pos_fulfillment_started",
            actor=current_user,
            preorder_id=preorder.id,
            payload={"event_id": preorder.event_id, "payment_status_intent": payload.payment_status},
        )
        try:
            db.commit()
        except Exception:
            db.rollback()
            raise

    try:
        _validate_current_snapshot_prices(db, preorder)
    except HTTPException:
        _clear_rejected_fulfillment_intent(
            db,
            preorder_id,
            current_user,
            reason_code="price_preflight",
        )
        raise
    sale_payload = schemas.MarketEventSaleCreate(
        payment_method=payload.payment_method,
        items=[
            schemas.MarketEventSaleItemCreate(sku=item.sku, quantity=item.quantity)
            for item in preorder.items
        ],
        client_reference=preorder.fulfillment_client_reference,
        cash_received=payload.cash_received,
        payment_reference=(payload.payment_reference or "").strip() or None,
        is_preorder=True,
        preorder_customer_name=preorder.customer_name,
        preorder_payment_status="Paid" if payload.payment_status == "Paid" else "Unpaid",
        preorder_fulfillment_status="Picked Up",
    )
    try:
        sale_output = record_market_event_sale(
            preorder.event_id,
            sale_payload,
            db,
            current_user,
        )
    except HTTPException:
        # Known POS validation failures occur before its commit. Clear the
        # persisted intent so an owner can adjust/cancel instead of leaving the
        # preorder permanently in an in-progress state.
        _clear_rejected_fulfillment_intent(
            db,
            preorder_id,
            current_user,
            reason_code="pos_validation",
        )
        raise

    linked = _locked_preorder(db, preorder_id)
    sale = db.query(models.MarketEventSale).options(
        selectinload(models.MarketEventSale.items)
    ).filter(models.MarketEventSale.id == sale_output.id).first()
    if not sale:
        raise HTTPException(status_code=503, detail="POS sale committed but could not be reloaded; retry fulfillment.")
    desired = linked.fulfillment_payment_status_intent or payload.payment_status
    return _link_fulfillment_sale(
        db,
        linked,
        sale,
        desired_payment_status=desired,
        actor=current_user,
        note=payload.note,
        recovery=False,
    )


@router.get("/{preorder_id}", response_model=schemas.PreorderDetailOut)
def get_preorder_detail(
    preorder_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    preorder = _preorder_query(db).filter(models.Preorder.id == preorder_id).first()
    if not preorder:
        raise HTTPException(status_code=404, detail="Preorder not found.")
    _require_preorder_access(preorder, current_user)
    return _detail_out(preorder, include_internal_history=current_user.role == "owner")


@router.patch("/{preorder_id}/items", response_model=schemas.PreorderDetailOut)
def update_preorder_items(
    preorder_id: int,
    payload: schemas.PreorderItemsUpdateRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    preorder = _locked_preorder(db, preorder_id)
    _require_preorder_access(preorder, current_user)
    if preorder.status in {"Fulfilled", "Cancelled"}:
        raise HTTPException(status_code=409, detail="Fulfilled or cancelled orders cannot be modified.")

    if not payload.items:
        raise HTTPException(status_code=422, detail="Preorder must contain at least one item.")

    skus = [item.sku.upper() for item in payload.items]
    product_map = {
        p.sku.upper(): p
        for p in db.query(models.ProductSKU).filter(models.ProductSKU.sku.in_(skus)).all()
    }

    db.query(models.PreorderItem).filter(models.PreorderItem.preorder_id == preorder.id).delete()

    total_amount = Decimal("0.00")
    total_units = 0

    for item_input in payload.items:
        product = product_map.get(item_input.sku.upper())
        if not product:
            raise HTTPException(status_code=404, detail=f"Product with SKU '{item_input.sku}' not found.")
        
        unit_price = _money(product.retail_price)
        line_total = unit_price * item_input.quantity
        total_amount += line_total
        total_units += item_input.quantity

        db.add(models.PreorderItem(
            preorder_id=preorder.id,
            sku=product.sku,
            product_name_snapshot=product.product_name,
            size_snapshot=product.size,
            unit_price_snapshot=unit_price,
            line_total_snapshot=line_total,
            quantity=item_input.quantity,
        ))

    preorder.total_amount = total_amount
    preorder.updated_by_user_id = current_user.id
    preorder.updated_at = datetime.now()

    _add_audit(
        db,
        action="update_items",
        actor=current_user,
        form_id=preorder.form_id,
        preorder_id=preorder.id,
        payload={"new_item_count": len(payload.items), "total_amount": float(total_amount)},
    )

    db.commit()
    loaded = _preorder_query(db).filter(models.Preorder.id == preorder.id).first()
    return _detail_out(loaded, include_internal_history=current_user.role == "owner")


@router.get("/forms/{form_id}/disabled-skus", response_model=list[str])
def get_form_disabled_skus(
    form_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    form = db.query(models.PreorderForm).filter(models.PreorderForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    ext = _json_load(form.extension_json, {})
    return ext.get("disabled_skus", [])


@router.patch("/forms/{form_id}/disabled-skus", response_model=list[str])
def update_form_disabled_skus(
    form_id: int,
    payload: schemas.PreorderFormDisabledSkusRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    form = db.query(models.PreorderForm).filter(models.PreorderForm.id == form_id).first()
    if not form:
        raise HTTPException(status_code=404, detail="Preorder form not found.")
    ext = _json_load(form.extension_json, {})
    ext["disabled_skus"] = list(set(payload.disabled_skus))
    form.extension_json = _json_dump(ext)
    form.updated_by_user_id = current_user.id
    form.updated_at = datetime.now()
    db.commit()
    return ext["disabled_skus"]

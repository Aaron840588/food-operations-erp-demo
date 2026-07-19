from collections import defaultdict
from datetime import datetime
import re
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth, models, schemas
from ..database import get_db
from ..services.proof_images import InvalidProofImage, normalize_proof_image

router = APIRouter(prefix="/timesheets", tags=["Timesheets"])


def _parse_machine_timestamp(values: dict) -> datetime | None:
    normalized = {str(key).strip().lower().replace("_", " "): str(value).strip() for key, value in values.items()}
    timestamp = next((value for key, value in normalized.items() if key in {"datetime", "date time", "timestamp", "time stamp", "punch time"}), "")
    if not timestamp:
        date_value = next((value for key, value in normalized.items() if key in {"date", "attendance date", "punch date"}), "")
        time_value = next((value for key, value in normalized.items() if key in {"time", "attendance time", "punch time"}), "")
        timestamp = f"{date_value} {time_value}".strip()
    for pattern in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M"):
        try:
            return datetime.fromisoformat(timestamp) if pattern is None else datetime.strptime(timestamp, pattern)
        except ValueError:
            continue
    slash_timestamp = re.fullmatch(
        r"(\d{1,2})/(\d{1,2})/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?",
        timestamp,
        flags=re.IGNORECASE,
    )
    if slash_timestamp:
        first, second, year, hour, minute, second_value, meridiem = slash_timestamp.groups()
        first_number, second_number = int(first), int(second)
        if first_number <= 12 and second_number <= 12:
            return None
        month, day = (second_number, first_number) if first_number > 12 else (first_number, second_number)
        hour_number = int(hour)
        if meridiem:
            if not 1 <= hour_number <= 12:
                return None
            hour_number = hour_number % 12 + (12 if meridiem.upper() == "PM" else 0)
        try:
            return datetime(int(year), month, day, hour_number, int(minute), int(second_value or 0))
        except ValueError:
            return None
    return None


def _machine_identity(values: dict) -> tuple[str, str]:
    normalized = {str(key).strip().lower().replace("_", " "): str(value).strip() for key, value in values.items()}
    machine_id = next((value for key, value in normalized.items() if key in {"id", "user id", "employee id", "enroll id", "pin", "no."}), "")
    name = next((value for key, value in normalized.items() if key in {"name", "employee name", "user name", "username"}), "")
    return machine_id, name or machine_id


@router.get("", response_model=schemas.TimesheetPage)
def get_timesheets(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    query = db.query(models.TimesheetEntry)
    if current_user.role != "owner":
        query = query.filter(models.TimesheetEntry.employee_user_id == current_user.id)
    total = query.count()
    items = query.order_by(
        models.TimesheetEntry.work_date.desc(), models.TimesheetEntry.clock_in.desc()
    ).offset(offset).limit(limit).all()
    return schemas.TimesheetPage(items=items, total=total, limit=limit, offset=offset)


@router.post("/manual", response_model=schemas.TimesheetEntryOut)
def create_manual_timesheet(payload: schemas.TimesheetManualCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    if payload.clock_in.date().isoformat() != payload.work_date:
        raise HTTPException(status_code=400, detail="Work date must match the clock-in date.")
    if payload.clock_out and payload.clock_out < payload.clock_in:
        raise HTTPException(status_code=400, detail="Clock-out cannot be before clock-in.")
    existing = db.query(models.TimesheetEntry).filter(
        models.TimesheetEntry.client_reference == payload.client_reference,
        models.TimesheetEntry.employee_user_id == current_user.id,
    ).first()
    if existing:
        return existing
    try:
        proof_image_data, proof_image_type = normalize_proof_image(payload.proof_image_data, payload.proof_image_type)
    except InvalidProofImage as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    entry = models.TimesheetEntry(
        client_reference=payload.client_reference,
        employee_user_id=current_user.id,
        employee_name=payload.employee_name.strip() if current_user.role == "owner" and payload.employee_name else current_user.username,
        work_date=payload.work_date,
        clock_in=payload.clock_in,
        clock_out=payload.clock_out,
        source="manual",
        review_status="Pending",
        proof_image_data=proof_image_data,
        proof_image_type=proof_image_type,
        notes=payload.notes,
        imported_by_user_id=current_user.id,
    )
    db.add(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.query(models.TimesheetEntry).filter(
            models.TimesheetEntry.client_reference == payload.client_reference,
            models.TimesheetEntry.employee_user_id == current_user.id,
        ).first()
        if existing:
            return existing
        raise
    db.refresh(entry)
    return entry


@router.get("/{entry_id}/proof", response_model=schemas.TimesheetProofOut)
def get_timesheet_proof(
    entry_id: int,
    response: Response,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    entry = db.query(models.TimesheetEntry).filter(models.TimesheetEntry.id == entry_id).first()
    if not entry or (current_user.role != "owner" and entry.employee_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="Timesheet proof not found")
    if not entry.proof_image_data or not entry.proof_image_type:
        raise HTTPException(status_code=404, detail="Timesheet proof not found")
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return schemas.TimesheetProofOut(data_url=entry.proof_image_data, mime_type=entry.proof_image_type)


@router.post("/import", response_model=List[schemas.TimesheetEntryOut], dependencies=[Depends(auth.require_owner)])
def import_machine_timesheets(payload: schemas.TimesheetImportCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.require_owner)):
    grouped: dict[tuple[str, str], list[datetime]] = defaultdict(list)
    names: dict[tuple[str, str], str] = {}
    invalid_rows: list[int] = []
    for row_number, row in enumerate(payload.rows, start=2):
        timestamp = _parse_machine_timestamp(row.values)
        machine_id, name = _machine_identity(row.values)
        if timestamp and (machine_id or name):
            key = (machine_id or name, timestamp.date().isoformat())
            grouped[key].append(timestamp)
            names[key] = name
        else:
            invalid_rows.append(row_number)
    if invalid_rows:
        examples = ", ".join(str(row) for row in invalid_rows[:5])
        suffix = "…" if len(invalid_rows) > 5 else ""
        raise HTTPException(
            status_code=400,
            detail=(
                f"Import stopped before saving because row(s) {examples}{suffix} have a missing identity, "
                "invalid timestamp, or an ambiguous numeric date. Use YYYY-MM-DD or an unambiguous date."
            ),
        )
    if not grouped:
        raise HTTPException(status_code=400, detail="No valid Deli attendance rows found. Export a CSV with ID/Name and Date + Time columns.")
    created = []
    users = {user.username.lower(): user for user in db.query(models.User).all()}
    for (machine_id, work_date), punches in grouped.items():
        punches.sort()
        employee = users.get(names[(machine_id, work_date)].lower()) or users.get(machine_id.lower())
        existing = db.query(models.TimesheetEntry).filter(
            models.TimesheetEntry.source == "machine",
            models.TimesheetEntry.machine_employee_id == machine_id,
            models.TimesheetEntry.work_date == work_date,
        ).first()
        if existing:
            existing.clock_in, existing.clock_out = punches[0], punches[-1] if len(punches) > 1 else None
            created.append(existing)
            continue
        entry = models.TimesheetEntry(
            employee_user_id=employee.id if employee else None,
            employee_name=names[(machine_id, work_date)],
            machine_employee_id=machine_id,
            work_date=work_date,
            clock_in=punches[0],
            clock_out=punches[-1] if len(punches) > 1 else None,
            source="machine",
            review_status="Approved",
            imported_by_user_id=current_user.id,
        )
        db.add(entry)
        created.append(entry)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        resolved = []
        for machine_id, work_date in grouped:
            existing = db.query(models.TimesheetEntry).filter(
                models.TimesheetEntry.source == "machine",
                models.TimesheetEntry.machine_employee_id == machine_id,
                models.TimesheetEntry.work_date == work_date,
            ).first()
            if existing:
                resolved.append(existing)
        if len(resolved) == len(grouped):
            return resolved
        raise
    for entry in created:
        db.refresh(entry)
    return created


@router.patch("/{entry_id}/review", response_model=schemas.TimesheetEntryOut, dependencies=[Depends(auth.require_owner)])
def review_manual_timesheet(entry_id: int, payload: schemas.TimesheetReviewUpdate, db: Session = Depends(get_db)):
    entry = db.query(models.TimesheetEntry).filter(models.TimesheetEntry.id == entry_id).first()
    if not entry:
        raise HTTPException(status_code=404, detail="Timesheet entry not found")
    entry.review_status = payload.review_status
    db.commit()
    db.refresh(entry)
    return entry

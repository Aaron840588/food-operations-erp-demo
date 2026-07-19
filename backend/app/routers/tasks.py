from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from .. import models, schemas, auth

router = APIRouter(prefix="/tasks", tags=["Tasks & Maintenance"])

# ----------------------------------------------------
# CLEANING TASK LOGS
# ----------------------------------------------------
@router.get("/cleaning", response_model=List[schemas.CleaningTaskOut])
def get_cleaning_tasks(db: Session = Depends(get_db)):
    """
    Returns list of all cleaning tasks and their status.
    """
    return db.query(models.CleaningTask).all()

@router.post("/cleaning/{task_id}/complete", dependencies=[Depends(auth.get_current_user)])
def complete_cleaning_task(task_id: int, date_done: str, remarks: str = None, db: Session = Depends(get_db)):
    """
    Logs that a cleaning task was completed on a specific date.
    """
    task = db.query(models.CleaningTask).filter(models.CleaningTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found")
        
    if date_done == "undo" or date_done == "" or date_done is None:
        task.last_done_date = None
    else:
        task.last_done_date = date_done
    if remarks is not None:
        task.remarks = remarks
    db.commit()
    return {"message": f"Cleaning task '{task.task_name}' marked completed on {date_done}."}


# ----------------------------------------------------
# MAINTENANCE ASSET CHECKLISTS
# ----------------------------------------------------
@router.get("/maintenance", response_model=List[schemas.MaintenanceAssetOut])
def get_maintenance_assets(area: str = None, db: Session = Depends(get_db)):
    """
    Returns list of all kitchen and production equipment assets.
    Optionally filters by area (e.g. 'Production Area', 'Kitchen', 'CR').
    """
    query = db.query(models.MaintenanceAsset)
    if area:
        query = query.filter(models.MaintenanceAsset.area == area)
    return query.all()

@router.put("/maintenance/{item_id}", response_model=schemas.MaintenanceAssetOut, dependencies=[Depends(auth.get_current_user)])
def update_maintenance_item(item_id: int, payload: schemas.MaintenanceAssetBase, db: Session = Depends(get_db)):
    """
    Updates the condition, remarks, or replacement date of an asset.
    """
    item = db.query(models.MaintenanceAsset).filter(models.MaintenanceAsset.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Maintenance asset item not found")

    item.area = payload.area
    item.item_name = payload.item_name
    if payload.style_or_kind is not None:
        item.style_or_kind = payload.style_or_kind
    if payload.condition is not None:
        item.condition = payload.condition
    if payload.remarks is not None:
        item.remarks = payload.remarks
    if payload.replacement_date is not None:
        item.replacement_date = payload.replacement_date

    db.commit()
    db.refresh(item)
    return item


@router.post("/cleaning", response_model=schemas.CleaningTaskOut)
def create_cleaning_task(
    payload: schemas.CleaningTaskCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Creates a new cleaning task. Requires Owner access.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    task = models.CleaningTask(
        task_name=payload.task_name,
        frequency=payload.frequency
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/cleaning/{task_id}")
def delete_cleaning_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Deletes an existing cleaning task. Requires Owner access.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    task = db.query(models.CleaningTask).filter(models.CleaningTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Cleaning task not found")
    db.delete(task)
    db.commit()
    return {"message": f"Successfully deleted cleaning task '{task.task_name}'."}


@router.post("/maintenance", response_model=schemas.MaintenanceAssetOut)
def create_maintenance_asset(
    payload: schemas.MaintenanceAssetCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Creates a new maintenance asset item. Requires Owner access.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    asset = models.MaintenanceAsset(
        area=payload.area,
        item_name=payload.item_name,
        style_or_kind=payload.style_or_kind,
        condition="OK"
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/maintenance/{item_id}")
def delete_maintenance_asset(
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user)
):
    """
    Deletes an existing maintenance asset item. Requires Owner access.
    """
    if current_user.role != "owner":
        raise HTTPException(status_code=403, detail="Owner access required")
    asset = db.query(models.MaintenanceAsset).filter(models.MaintenanceAsset.id == item_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Maintenance asset not found")
    db.delete(asset)
    db.commit()
    return {"message": f"Successfully deleted maintenance asset '{asset.item_name}'."}

from sqlalchemy.orm import Session
from datetime import datetime
from .. import models

class FifoService:
    @staticmethod
    def deduct_raw_ingredients_fifo(raw_requirements: dict, user_id: int, plan_id: int, plan_date: str, db: Session):
        """
        Deducts raw materials from active ingredient batches in FIFO order (by expiry_date asc, nulls last)
        and synchronizes the primary raw_ingredients.available_stock field.
        """
        for raw_id, amount_needed in raw_requirements.items():
            raw_ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == raw_id).first()
            if not raw_ing:
                continue

            # 1. Update primary available stock (keep backward compatibility)
            raw_ing.available_stock = max(0.0, (raw_ing.available_stock or 0.0) - amount_needed)

            # 2. Query active batches for this ingredient
            # Sort by expiry_date ASC, nulls last, then by id ASC
            batches = db.query(models.IngredientBatch)\
                .filter(models.IngredientBatch.raw_ingredient_id == raw_id, models.IngredientBatch.quantity > 0)\
                .order_by(models.IngredientBatch.expiry_date.asc(), models.IngredientBatch.id.asc())\
                .all()

            # Handle nulls last sorting manually if sqlite doesn't sort nulls last by default
            # (SQLite sorts NULLs first by default in ASC order. We sort them nulls last)
            null_expiry_batches = [b for b in batches if not b.expiry_date]
            valued_expiry_batches = [b for b in batches if b.expiry_date]
            sorted_batches = sorted(valued_expiry_batches, key=lambda x: x.expiry_date) + null_expiry_batches

            remaining = amount_needed
            deducted_details = []

            for batch in sorted_batches:
                if remaining <= 0:
                    break
                
                if batch.quantity >= remaining:
                    # Deduct fully from this batch
                    deducted_details.append(f"{remaining}{raw_ing.unit} from batch {batch.batch_code}")
                    batch.quantity = round(batch.quantity - remaining, 2)
                    remaining = 0
                else:
                    # Drain this batch
                    deducted_details.append(f"{batch.quantity}{raw_ing.unit} from batch {batch.batch_code}")
                    remaining -= batch.quantity
                    batch.quantity = 0.0

            # If there are no batches or we have a remaining deficit, check/create a fallback batch
            if remaining > 0:
                # Create a fallback batch to account for overflow/deficit (representing negative stock)
                fallback = models.IngredientBatch(
                    raw_ingredient_id=raw_id,
                    batch_code="BATCH-OVERFLOW-DEFICIT",
                    quantity=-remaining,
                    expiry_date=None
                )
                db.add(fallback)
                deducted_details.append(f"{remaining}{raw_ing.unit} from fallback overflow batch")

            # 3. Log main inventory transaction
            notes_str = f"Consumed in production run for plan #{plan_id} dated {plan_date}. FIFO Deductions: {', '.join(deducted_details)}."
            tx = models.InventoryTransaction(
                raw_ingredient_id=raw_id,
                transaction_type="consume",
                qty=float(-amount_needed),
                user_id=user_id,
                batch_reference=f"PLAN-{plan_id}",
                notes=notes_str
            )
            db.add(tx)

    @staticmethod
    def adjust_ingredient_batches_on_manual(raw_ingredient_id: int, old_stock: float, new_stock: float, user_id: int, db: Session):
        """
        Synchronizes ingredient batches when available_stock is manually updated via web inventory adjustments.
        """
        raw_ing = db.query(models.RawIngredient).filter(models.RawIngredient.id == raw_ingredient_id).first()
        if not raw_ing:
            return
            
        diff = new_stock - old_stock
        if diff == 0:
            return
            
        if diff > 0:
            # Stock increased: Create a new manual batch record
            batch_code = f"BATCH-MANUAL-IN-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
            new_batch = models.IngredientBatch(
                raw_ingredient_id=raw_ingredient_id,
                batch_code=batch_code,
                quantity=diff,
                expiry_date=None
            )
            db.add(new_batch)
        else:
            # Stock decreased: Deduct from existing batches in FIFO order
            batches = db.query(models.IngredientBatch)\
                .filter(models.IngredientBatch.raw_ingredient_id == raw_ingredient_id, models.IngredientBatch.quantity > 0)\
                .order_by(models.IngredientBatch.expiry_date.asc(), models.IngredientBatch.id.asc())\
                .all()

            null_expiry_batches = [b for b in batches if not b.expiry_date]
            valued_expiry_batches = [b for b in batches if b.expiry_date]
            sorted_batches = sorted(valued_expiry_batches, key=lambda x: x.expiry_date) + null_expiry_batches

            remaining = abs(diff)
            for batch in sorted_batches:
                if remaining <= 0:
                    break
                if batch.quantity >= remaining:
                    batch.quantity = round(batch.quantity - remaining, 2)
                    remaining = 0
                else:
                    remaining -= batch.quantity
                    batch.quantity = 0.0

            if remaining > 0:
                # Deduct from first found batch even if it goes negative (or create overflow)
                first_batch = db.query(models.IngredientBatch).filter(models.IngredientBatch.raw_ingredient_id == raw_ingredient_id).first()
                if first_batch:
                    first_batch.quantity = round(first_batch.quantity - remaining, 2)
                else:
                    fallback = models.IngredientBatch(
                        raw_ingredient_id=raw_ingredient_id,
                        batch_code="BATCH-MANUAL-DEFICIT",
                        quantity=-remaining,
                        expiry_date=None
                    )
                    db.add(fallback)

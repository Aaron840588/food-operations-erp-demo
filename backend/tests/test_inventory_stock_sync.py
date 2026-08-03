import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import main as main_module
from app import models, schemas
from app.database import Base, sync_warehouse_stock_for_main_facility


class InventoryStockSyncTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)

        with self.Session() as db:
            owner = models.User(
                id=1,
                username="owner",
                hashed_password="test-only",
                role="owner",
                is_active=True,
            )
            product = models.ProductSKU(
                sku="PP-IND-SVR",
                product_name="Pesto with Pili Sauce",
                category="Spreads & Sauces",
                size="Individual",
                retail_price=495,
                reseller_price=400,
                warehouse_stock=10,
            )
            ingredient = models.RawIngredient(
                id=1,
                name="Pili",
                category="Food",
                unit="g",
                price=500,
                net_weight=1000,
                cost_per_gram_unit=0.5,
                available_stock=100,
                reorder_level=10,
            )
            warehouse = models.Warehouse(
                id=1,
                name="Main Facility",
                is_active=True,
            )
            recipe = models.Recipe(
                sku="PP-IND-SVR",
                yield_weight=1777,
                portion_size=222,
                notes="Owner-edited Pesto formula",
            )
            db.add_all([owner, product, ingredient, warehouse, recipe])
            db.flush()
            db.add_all([
                models.RecipeItem(
                    recipe_id=recipe.id,
                    ingredient_type="raw",
                    raw_ingredient_id=ingredient.id,
                    base_qty=321,
                    base_unit="grams",
                ),
                models.WarehouseStock(
                    warehouse_id=1,
                    sku=product.sku,
                    quantity=10,
                ),
                models.WarehouseStock(
                    warehouse_id=1,
                    raw_ingredient_id=ingredient.id,
                    quantity=100,
                ),
                models.IngredientBatch(
                    raw_ingredient_id=ingredient.id,
                    batch_code="OPENING-PILI",
                    quantity=100,
                    expiry_date=None,
                ),
                models.DiscountTier(
                    min_subtotal=0,
                    discount_percentage=10,
                ),
            ])
            db.commit()

        self.owner = models.User(
            id=1,
            username="owner",
            hashed_password="test-only",
            role="owner",
            is_active=True,
        )

    def tearDown(self):
        self.engine.dispose()

    def _read_balances(self):
        with self.Session() as db:
            product = db.get(models.ProductSKU, "PP-IND-SVR")
            ingredient = db.get(models.RawIngredient, 1)
            product_mirror = db.query(models.WarehouseStock).filter_by(
                warehouse_id=1,
                sku="PP-IND-SVR",
            ).one()
            ingredient_mirror = db.query(models.WarehouseStock).filter_by(
                warehouse_id=1,
                raw_ingredient_id=1,
            ).one()
            return {
                "product": product.warehouse_stock,
                "ingredient": ingredient.available_stock,
                "product_mirror": product_mirror.quantity,
                "ingredient_mirror": ingredient_mirror.quantity,
                "transactions": db.query(models.InventoryTransaction).count(),
                "batch_total": sum(
                    batch.quantity
                    for batch in db.query(models.IngredientBatch).filter_by(
                        raw_ingredient_id=1
                    ).all()
                ),
            }

    def test_owner_edited_pesto_recipe_survives_repeated_startup_initialization(self):
        with patch.object(main_module, "SessionLocal", self.Session), patch.object(
            main_module,
            "run_startup_migrations",
            return_value=None,
        ):
            main_module.seed_default_users()
            main_module.sync_warehouse_stocks_on_startup()
            main_module.seed_default_users()
            main_module.sync_warehouse_stocks_on_startup()

        with self.Session() as db:
            recipe = db.query(models.Recipe).filter_by(sku="PP-IND-SVR").one()
            items = db.query(models.RecipeItem).filter_by(recipe_id=recipe.id).all()
            self.assertEqual(recipe.yield_weight, 1777)
            self.assertEqual(recipe.portion_size, 222)
            self.assertEqual(recipe.notes, "Owner-edited Pesto formula")
            self.assertEqual(len(items), 1)
            self.assertEqual(items[0].raw_ingredient_id, 1)
            self.assertEqual(items[0].base_qty, 321)

    def test_bulk_sync_uses_a_bounded_number_of_selects(self):
        select_statements = []

        def collect_selects(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.lstrip().upper().startswith("SELECT"):
                select_statements.append(statement)

        event.listen(self.engine, "before_cursor_execute", collect_selects)
        try:
            with self.Session() as db:
                sync_warehouse_stock_for_main_facility(db)
                db.rollback()
        finally:
            event.remove(self.engine, "before_cursor_execute", collect_selects)

        self.assertLessEqual(len(select_statements), 4)

    def test_sync_helper_never_rolls_back_the_callers_transaction(self):
        with self.Session() as db, patch.object(
            db,
            "rollback",
            wraps=db.rollback,
        ) as rollback, patch.object(
            db,
            "flush",
            side_effect=RuntimeError("forced flush failure"),
        ):
            with self.assertRaises(RuntimeError):
                sync_warehouse_stock_for_main_facility(db, sku="PP-IND-SVR")
            rollback.assert_not_called()

        # The session context owns cleanup after the helper propagates failure.

    def test_product_manual_adjustment_commits_legacy_mirror_and_ledger_together(self):
        with self.Session() as db:
            main_module.update_product_sku(
                "PP-IND-SVR",
                schemas.ProductSKUUpdate(warehouse_stock=15),
                db,
                self.owner,
            )

        balances = self._read_balances()
        self.assertEqual(balances["product"], 15)
        self.assertEqual(balances["product_mirror"], 15)
        self.assertEqual(balances["transactions"], 1)

    def test_product_manual_adjustment_rolls_back_when_mirror_sync_fails(self):
        with self.Session() as db, patch.object(
            main_module,
            "sync_warehouse_stock_for_main_facility",
            side_effect=RuntimeError("mirror unavailable"),
        ):
            with self.assertRaises(HTTPException) as context:
                main_module.update_product_sku(
                    "PP-IND-SVR",
                    schemas.ProductSKUUpdate(warehouse_stock=15),
                    db,
                    self.owner,
                )
            self.assertEqual(context.exception.status_code, 500)

        balances = self._read_balances()
        self.assertEqual(balances["product"], 10)
        self.assertEqual(balances["product_mirror"], 10)
        self.assertEqual(balances["transactions"], 0)

    def test_raw_manual_adjustment_commits_legacy_mirror_batch_and_ledger_together(self):
        with self.Session() as db:
            main_module.update_raw_ingredient(
                1,
                schemas.RawIngredientUpdate(available_stock=125),
                db,
                self.owner,
            )

        balances = self._read_balances()
        self.assertEqual(balances["ingredient"], 125)
        self.assertEqual(balances["ingredient_mirror"], 125)
        self.assertEqual(balances["batch_total"], 125)
        self.assertEqual(balances["transactions"], 1)

    def test_raw_manual_adjustment_rolls_back_when_mirror_sync_fails(self):
        with self.Session() as db, patch.object(
            main_module,
            "sync_warehouse_stock_for_main_facility",
            side_effect=RuntimeError("mirror unavailable"),
        ):
            with self.assertRaises(HTTPException) as context:
                main_module.update_raw_ingredient(
                    1,
                    schemas.RawIngredientUpdate(available_stock=125),
                    db,
                    self.owner,
                )
            self.assertEqual(context.exception.status_code, 500)

        balances = self._read_balances()
        self.assertEqual(balances["ingredient"], 100)
        self.assertEqual(balances["ingredient_mirror"], 100)
        self.assertEqual(balances["batch_total"], 100)
        self.assertEqual(balances["transactions"], 0)

    def test_batch_intake_commits_legacy_mirror_batch_and_ledger_together(self):
        with self.Session() as db:
            main_module.intake_ingredient_batch(
                schemas.IngredientBatchCreate(
                    raw_ingredient_id=1,
                    batch_code="RECEIPT-PILI-001",
                    quantity=25,
                    expiry_date="2026-12-31",
                ),
                db,
                self.owner,
            )

        balances = self._read_balances()
        self.assertEqual(balances["ingredient"], 125)
        self.assertEqual(balances["ingredient_mirror"], 125)
        self.assertEqual(balances["batch_total"], 125)
        self.assertEqual(balances["transactions"], 1)

    def test_batch_intake_rolls_back_when_mirror_sync_fails(self):
        with self.Session() as db, patch.object(
            main_module,
            "sync_warehouse_stock_for_main_facility",
            side_effect=RuntimeError("mirror unavailable"),
        ):
            with self.assertRaises(HTTPException) as context:
                main_module.intake_ingredient_batch(
                    schemas.IngredientBatchCreate(
                        raw_ingredient_id=1,
                        batch_code="RECEIPT-PILI-001",
                        quantity=25,
                        expiry_date="2026-12-31",
                    ),
                    db,
                    self.owner,
                )
            self.assertEqual(context.exception.status_code, 500)

        balances = self._read_balances()
        self.assertEqual(balances["ingredient"], 100)
        self.assertEqual(balances["ingredient_mirror"], 100)
        self.assertEqual(balances["batch_total"], 100)
        self.assertEqual(balances["transactions"], 0)


if __name__ == "__main__":
    unittest.main()

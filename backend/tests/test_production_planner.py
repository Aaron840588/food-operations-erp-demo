import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool


os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base
from app.routers.production import (
    create_and_complete_production_plan,
    create_production_plan,
    get_production_catalog,
    run_production_forecast,
)


class ProductionPlannerTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.user = models.User(
            username="owner",
            hashed_password="test-only",
            role="owner",
            is_active=True,
        )
        self.warehouse = models.Warehouse(
            id=1,
            name="Main Facility",
            is_active=True,
        )
        self.db.add_all([self.user, self.warehouse])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_raw(
        self,
        name="Ingredient",
        *,
        stock=100.0,
        price=20.0,
        net_weight=100.0,
        unit="g",
    ):
        raw = models.RawIngredient(
            name=name,
            category="Other / uncategorized",
            unit=unit,
            price=price,
            net_weight=net_weight,
            cost_per_gram_unit=price / net_weight,
            available_stock=stock,
            reorder_level=0,
        )
        self.db.add(raw)
        self.db.flush()
        self.db.add(
            models.WarehouseStock(
                warehouse_id=self.warehouse.id,
                raw_ingredient_id=raw.id,
                quantity=stock,
            )
        )
        self.db.add(
            models.IngredientBatch(
                raw_ingredient_id=raw.id,
                batch_code=f"BATCH-{raw.id}",
                quantity=stock,
            )
        )
        self.db.commit()
        return raw

    def add_product(
        self,
        sku,
        *,
        name=None,
        category="Pasta Tub",
        stock=0,
        active=True,
    ):
        product = models.ProductSKU(
            sku=sku,
            product_name=name or sku,
            category=category,
            size="170g",
            retail_price=130,
            reseller_price=110.5,
            warehouse_stock=stock,
            is_active=active,
        )
        self.db.add(product)
        self.db.add(
            models.WarehouseStock(
                warehouse_id=self.warehouse.id,
                sku=sku,
                quantity=stock,
            )
        )
        self.db.commit()
        return product

    def add_recipe(
        self,
        sku,
        *,
        raw_lines=None,
        sub_lines=None,
        yield_weight=1.0,
        portion_size=1.0,
        yield_unit="g",
        portion_unit="g",
    ):
        recipe = models.Recipe(
            sku=sku,
            yield_weight=yield_weight,
            yield_unit=yield_unit,
            portion_size=portion_size,
            portion_unit=portion_unit,
        )
        self.db.add(recipe)
        self.db.flush()
        for raw, quantity, unit in raw_lines or []:
            self.db.add(
                models.RecipeItem(
                    recipe_id=recipe.id,
                    ingredient_type="raw",
                    raw_ingredient_id=raw.id,
                    base_qty=quantity,
                    base_unit=unit,
                )
            )
        for sub_sku, quantity, unit in sub_lines or []:
            self.db.add(
                models.RecipeItem(
                    recipe_id=recipe.id,
                    ingredient_type="sku",
                    sub_sku=sub_sku,
                    base_qty=quantity,
                    base_unit=unit,
                )
            )
        self.db.commit()
        return recipe

    def forecast_payload(self, sku, quantity=1):
        return schemas.ProductionForecastIn(
            items=[
                schemas.ForecastItem(
                    sku=sku,
                    quantity=quantity,
                    outlet="General Stock",
                )
            ]
        )

    def plan_payload(self, sku, *, quantity=1, plan_date="2026-07-27"):
        return schemas.ProductionPlanCreate(
            plan_date=plan_date,
            targets=[
                schemas.ProductionTargetCreate(
                    sku=sku,
                    outlet="General Stock",
                    target_qty=quantity,
                )
            ],
        )

    def test_forecast_rejects_unknown_inactive_and_empty_recipe_targets(self):
        with self.assertRaises(HTTPException) as unknown:
            run_production_forecast(
                self.forecast_payload("DOES-NOT-EXIST"),
                self.db,
            )
        self.assertEqual(unknown.exception.status_code, 422)

        inactive = self.add_product("INACTIVE", active=False)
        raw = self.add_raw("Inactive ingredient")
        self.add_recipe(inactive.sku, raw_lines=[(raw, 1, "g")])
        with self.assertRaises(HTTPException) as inactive_error:
            run_production_forecast(
                self.forecast_payload(inactive.sku),
                self.db,
            )
        self.assertEqual(inactive_error.exception.status_code, 422)
        self.assertIn("inactive", inactive_error.exception.detail.lower())

        empty = self.add_product("EMPTY")
        self.add_recipe(empty.sku)
        with self.assertRaises(HTTPException) as empty_error:
            run_production_forecast(
                self.forecast_payload(empty.sku),
                self.db,
            )
        self.assertEqual(empty_error.exception.status_code, 422)
        self.assertIn("empty recipe", empty_error.exception.detail.lower())

    def test_forecast_rejects_recipe_cycles(self):
        self.add_product("CYCLE-A")
        self.add_product("CYCLE-B")
        self.add_recipe(
            "CYCLE-A",
            sub_lines=[("CYCLE-B", 1, "g")],
        )
        self.add_recipe(
            "CYCLE-B",
            sub_lines=[("CYCLE-A", 1, "g")],
        )

        with self.assertRaises(HTTPException) as raised:
            run_production_forecast(
                self.forecast_payload("CYCLE-A"),
                self.db,
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn(
            "CYCLE-A -> CYCLE-B -> CYCLE-A",
            raised.exception.detail,
        )

    def test_forecast_returns_scaled_quantities_with_subrecipes_first(self):
        raw = self.add_raw("Basil", stock=100)
        self.add_product("SUB", name="Pesto Base")
        self.add_recipe(
            "SUB",
            raw_lines=[(raw, 10, "g")],
            yield_weight=10,
            portion_size=2,
        )
        self.add_product("PASTA", name="Pesto Pasta")
        self.add_recipe(
            "PASTA",
            sub_lines=[("SUB", 2, "g")],
            yield_weight=2,
            portion_size=1,
        )

        forecast = run_production_forecast(
            self.forecast_payload("PASTA", quantity=4),
            self.db,
        )

        self.assertEqual(
            [recipe.target_sku for recipe in forecast.scaled_recipes],
            ["SUB", "PASTA"],
        )
        sub_sheet, parent_sheet = forecast.scaled_recipes
        self.assertEqual(sub_sheet.scaled_ingredients[0].base_qty, 4)
        self.assertEqual(parent_sheet.scaled_ingredients[0].base_qty, 4)
        self.assertEqual(forecast.material_checklist[0].total_needed, 4)

    def test_catalog_includes_valid_pasta_and_excludes_non_producible_gifts(self):
        raw = self.add_raw("Pasta ingredient")
        pasta = self.add_product("TPP-SL-PASTA", name="Tuna Pesto Pasta")
        self.add_recipe(pasta.sku, raw_lines=[(raw, 1, "g")])
        gift = self.add_product(
            "GS-1",
            name="Gift Set",
            category="Gift Sets & Packages",
        )
        self.add_recipe(gift.sku, raw_lines=[(raw, 1, "g")])
        self.add_product("NO-BOM", name="No Recipe")

        catalog = get_production_catalog(self.db)

        self.assertEqual([item["sku"] for item in catalog], ["TPP-SL-PASTA"])
        self.assertEqual(catalog[0]["units_per_batch"], 1)

    def test_catalog_includes_chili_asian_pasta_with_gram_based_bay_leaf(self):
        bay_leaf = self.add_raw("Bay Leaf", unit="grams")
        chili_oil = self.add_product(
            "CGO-IND-SVR",
            name="Chili Garlic Oil",
            category="Savory",
        )
        self.add_recipe(
            chili_oil.sku,
            raw_lines=[(bay_leaf, 8, "grams")],
            yield_weight=508,
            portion_size=100,
        )
        pasta = self.add_product(
            "CAP-SL-PASTA",
            name="Chili Asian Pasta",
        )
        self.add_recipe(
            pasta.sku,
            sub_lines=[(chili_oil.sku, 5, "g")],
            yield_weight=510,
            portion_size=170,
        )

        catalog_skus = {item["sku"] for item in get_production_catalog(self.db)}

        self.assertIn("CGO-IND-SVR", catalog_skus)
        self.assertIn("CAP-SL-PASTA", catalog_skus)

    def test_draft_is_upserted_instead_of_stranded(self):
        raw = self.add_raw()
        product = self.add_product("PASTA")
        self.add_recipe(product.sku, raw_lines=[(raw, 1, "g")])

        first = create_production_plan(
            self.plan_payload(product.sku, quantity=2),
            self.db,
        )
        second = create_production_plan(
            self.plan_payload(product.sku, quantity=5),
            self.db,
        )

        self.assertEqual(first.id, second.id)
        self.assertEqual(
            self.db.query(models.ProductionPlan).count(),
            1,
        )
        self.assertEqual(second.targets[0].target_qty, 5)

    def test_atomic_completion_updates_legacy_and_mirror_stock_once(self):
        raw = self.add_raw(stock=100)
        product = self.add_product("PASTA", stock=0)
        self.add_recipe(
            product.sku,
            raw_lines=[(raw, 10, "g")],
            yield_weight=1,
            portion_size=1,
        )
        payload = self.plan_payload(product.sku, quantity=2)

        completed = create_and_complete_production_plan(
            payload,
            self.db,
            self.user,
        )
        retried = create_and_complete_production_plan(
            payload,
            self.db,
            self.user,
        )

        self.assertEqual(completed.id, retried.id)
        self.assertEqual(retried.status, "completed")
        self.db.refresh(raw)
        self.db.refresh(product)
        self.assertEqual(raw.available_stock, 80)
        self.assertEqual(product.warehouse_stock, 2)
        raw_mirror = self.db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == 1,
            models.WarehouseStock.raw_ingredient_id == raw.id,
        ).one()
        product_mirror = self.db.query(models.WarehouseStock).filter(
            models.WarehouseStock.warehouse_id == 1,
            models.WarehouseStock.sku == product.sku,
        ).one()
        self.assertEqual(raw_mirror.quantity, 80)
        self.assertEqual(product_mirror.quantity, 2)
        self.assertEqual(
            self.db.query(models.ProductionBatch).count(),
            1,
        )
        self.assertEqual(
            self.db.query(models.InventoryTransaction).count(),
            2,
        )

    def test_mirror_sync_failure_rolls_back_entire_completion(self):
        raw = self.add_raw(stock=100)
        product = self.add_product("PASTA", stock=0)
        self.add_recipe(
            product.sku,
            raw_lines=[(raw, 10, "g")],
            yield_weight=1,
            portion_size=1,
        )

        with patch(
            "app.routers.production.sync_warehouse_stock_for_main_facility",
            side_effect=RuntimeError("mirror unavailable"),
        ):
            with self.assertRaisesRegex(RuntimeError, "mirror unavailable"):
                create_and_complete_production_plan(
                    self.plan_payload(product.sku, quantity=2),
                    self.db,
                    self.user,
                )

        self.db.expire_all()
        raw_after = self.db.query(models.RawIngredient).filter_by(id=raw.id).one()
        product_after = (
            self.db.query(models.ProductSKU).filter_by(sku=product.sku).one()
        )
        self.assertEqual(raw_after.available_stock, 100)
        self.assertEqual(product_after.warehouse_stock, 0)
        self.assertEqual(
            self.db.query(models.ProductionPlan).count(),
            0,
        )
        self.assertEqual(
            self.db.query(models.ProductionBatch).count(),
            0,
        )
        self.assertEqual(
            self.db.query(models.InventoryTransaction).count(),
            0,
        )


if __name__ == "__main__":
    unittest.main()

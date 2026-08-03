import os
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base
from app.main import update_raw_ingredient
from app.routers.costing import (
    get_profit_margin_analysis,
    get_sku_cost_details,
    preview_sku_recipe_cost,
)
from app.routers.production import explode_sku_requirements
from app.services.costing_service import CostingService


class CostingUnitNormalizationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        CostingService.clear_costing_cache()

    def tearDown(self):
        CostingService.clear_costing_cache()
        self.db.close()
        self.engine.dispose()

    def add_raw(self, name, price, net_weight, unit="g", stored_cost=None):
        raw = models.RawIngredient(
            name=name,
            category="Food",
            unit=unit,
            price=price,
            net_weight=net_weight,
            cost_per_gram_unit=(
                stored_cost
                if stored_cost is not None
                else price / net_weight
            ),
            available_stock=0.0,
            reorder_level=-1.0,
        )
        self.db.add(raw)
        self.db.flush()
        return raw

    def add_product(self, sku, name, retail_price=270.0, category="Sweet"):
        product = models.ProductSKU(
            sku=sku,
            product_name=name,
            category=category,
            size="Indulge",
            retail_price=retail_price,
            reseller_price=retail_price * 0.9,
            cost_per_unit=0.0,
            labor_cost=0.0,
            utility_cost=0.0,
            warehouse_stock=0,
        )
        self.db.add(product)
        self.db.flush()
        return product

    def test_sweet_tablea_legacy_mapping_no_longer_creates_13268_batch(self):
        product = self.add_product(
            "ST-IND-SWT",
            "Sweet Tablea with Peanuts Spread",
        )
        product.labor_cost = 37.50
        product.utility_cost = 3.28

        # This is the exact conflicting pair in the imported catalog.  The BOM
        # points to the P13/1 g legacy row, while its mass-priced source is
        # P1200/1000 g (P1.20/g).
        tablea_legacy = self.add_raw("Tablea", 13.0, 1.0, "g", 13.0)
        tablea_canonical = self.add_raw(
            "Tablea chopped",
            1200.0,
            1000.0,
            "grams",
            1.2,
        )

        ingredient_rows = [
            ("Skim Milk", 235.0, 1000.0, 250.0),
            ("Coconut oil", 1825.0, 16000.0, 800.0),
            ("Water", 80.0, 10000.0, 350.0),
            ("Washed Sugar", 90.0, 1000.0, 850.0),
            ("Salt", 100.0, 1000.0, 20.0),
            ("Glucose", 90.0, 750.0, 160.0),
            ("VH Semi sweet chopped", 305.0, 1000.0, 0.0),
            ("ground roasted peanuts", 100.0, 1000.0, 180.0),
        ]
        recipe_items = []
        for name, price, net_weight, quantity in ingredient_rows:
            raw = self.add_raw(name, price, net_weight, "grams")
            recipe_items.append(models.RecipeItem(
                ingredient_type="raw",
                raw_ingredient_id=raw.id,
                base_qty=quantity,
                base_unit="grams",
            ))
        recipe_items.insert(7, models.RecipeItem(
            ingredient_type="raw",
            raw_ingredient_id=tablea_legacy.id,
            base_qty=1000.0,
            base_unit="grams",
        ))

        recipe = models.Recipe(
            sku=product.sku,
            yield_weight=2760.0,
            yield_unit="g",
            portion_size=250.0,
            portion_unit="g",
            ingredients=recipe_items,
        )
        self.db.add(recipe)
        self.db.commit()

        # Prove the fixture reproduces the reported P13,268.50 defect when the
        # stale per-unit field is multiplied directly by BOM grams.
        legacy_batch_cost = sum(
            item.base_qty * item.raw_ingredient.cost_per_gram_unit
            for item in recipe.ingredients
        )
        self.assertAlmostEqual(legacy_batch_cost, 13268.50)

        self.assertTrue(CostingService.reconcile_legacy_sweet_tablea_recipe(self.db))
        self.db.commit()
        self.db.expire_all()
        recipe = self.db.query(models.Recipe).filter_by(sku=product.sku).one()
        migrated_tablea_line = next(
            item for item in recipe.ingredients
            if item.raw_ingredient_id == tablea_canonical.id
        )
        self.assertEqual(migrated_tablea_line.raw_ingredient.name, "Tablea chopped")
        self.assertFalse(CostingService.reconcile_legacy_sweet_tablea_recipe(self.db))

        details = get_sku_cost_details(product.sku, self.db)
        tablea_line = next(
            item for item in details.ingredients
            if item.raw_ingredient_name == "Tablea chopped"
        )
        self.assertEqual(tablea_line.raw_ingredient_id, tablea_canonical.id)
        self.assertAlmostEqual(tablea_line.calculated_cost, 1200.0)
        self.assertAlmostEqual(details.calculated_batch_cost, 1468.50)
        self.assertAlmostEqual(details.calculated_portion_cost, 133.50)

        preview = preview_sku_recipe_cost(
            product.sku,
            schemas.RecipeUpdate(
                yield_weight=recipe.yield_weight,
                yield_unit=recipe.yield_unit,
                portion_size=recipe.portion_size,
                portion_unit=recipe.portion_unit,
                ingredients=[schemas.RecipeItemCreate(
                    ingredient_type=item.ingredient_type,
                    raw_ingredient_id=item.raw_ingredient_id,
                    sub_sku=item.sub_sku,
                    base_qty=item.base_qty,
                    base_unit=item.base_unit,
                ) for item in recipe.ingredients],
            ),
            self.db,
        )
        self.assertAlmostEqual(preview.calculated_batch_cost, 1468.50)
        self.assertAlmostEqual(preview.calculated_portion_cost, 133.50)

        raw_requirements = {}
        scaled_recipes = []
        raw_map = {raw.id: raw for raw in self.db.query(models.RawIngredient).all()}
        explode_sku_requirements(
            self.db,
            product.sku,
            11,
            raw_requirements,
            scaled_recipes,
            {recipe.sku: recipe},
            {product.sku: product},
            raw_map,
        )
        production_tablea_line = next(
            item for item in scaled_recipes[0]["scaled_ingredients"]
            if item.raw_ingredient_id == tablea_canonical.id
        )
        self.assertAlmostEqual(production_tablea_line.calculated_cost, 1200.0)

        analysis = get_profit_margin_analysis(self.db)
        # The recipe math is now correct, but a spread without an explicit jar
        # and label source must remain visibly incomplete instead of receiving
        # an invented packaging default.
        self.assertEqual(analysis[0]["cost_status"], "missing_cost_input")
        self.assertIn("zero quantity", analysis[0]["cost_status_message"].lower())
        self.assertAlmostEqual(analysis[0]["food_cost"], 133.50)
        self.assertAlmostEqual(analysis[0]["total_cost"], 174.28)
        self.assertGreater(analysis[0]["net_profit"], 0.0)

    def test_kg_pack_gram_bom_and_mixed_yield_units_are_normalized(self):
        product = self.add_product(
            "COCOA-100G",
            "Cocoa Portion",
            retail_price=130.0,
            category="Sandwiches & Salads",
        )
        # Simulate the historical database trigger's value (P600 per kg),
        # which must not be multiplied directly by 1000 recipe grams.
        cocoa = self.add_raw("Cocoa", 600.0, 1.0, "kg", stored_cost=600.0)
        recipe = models.Recipe(
            sku=product.sku,
            yield_weight=1.0,
            yield_unit="kg",
            portion_size=100.0,
            portion_unit="g",
            ingredients=[models.RecipeItem(
                ingredient_type="raw",
                raw_ingredient_id=cocoa.id,
                base_qty=1000.0,
                base_unit="g",
            )],
        )
        self.db.add(recipe)
        self.db.commit()

        costs = CostingService.compute_all_sku_costs_in_memory(self.db)
        details = get_sku_cost_details(product.sku, self.db)

        self.assertAlmostEqual(details.calculated_batch_cost, 600.0)
        self.assertAlmostEqual(details.ingredients[0].calculated_cost, 600.0)
        self.assertAlmostEqual(costs[product.sku], 60.0)
        self.assertAlmostEqual(details.calculated_portion_cost, 60.0)

        raw_requirements = {}
        scaled_recipes = []
        explode_sku_requirements(
            self.db,
            product.sku,
            10,
            raw_requirements,
            scaled_recipes,
            {recipe.sku: recipe},
            {product.sku: product},
            {cocoa.id: cocoa},
        )
        self.assertAlmostEqual(raw_requirements[cocoa.id], 1.0)
        self.assertAlmostEqual(
            scaled_recipes[0]["scaled_ingredients"][0].calculated_cost,
            600.0,
        )

    def test_correctly_configured_tablea_kg_row_is_not_replaced_by_legacy_alias(self):
        product = self.add_product("ST-IND-SWT", "Configured Tablea")
        configured_tablea = self.add_raw(
            "Tablea",
            1000.0,
            1.0,
            "kg",
            stored_cost=1000.0,
        )
        self.add_raw("Tablea chopped", 1200.0, 1000.0, "g", stored_cost=1.2)
        self.db.add(models.Recipe(
            sku=product.sku,
            yield_weight=1000.0,
            yield_unit="g",
            portion_size=100.0,
            portion_unit="g",
            ingredients=[models.RecipeItem(
                ingredient_type="raw",
                raw_ingredient_id=configured_tablea.id,
                base_qty=1000.0,
                base_unit="g",
            )],
        ))
        self.db.commit()

        self.assertFalse(CostingService.reconcile_legacy_sweet_tablea_recipe(self.db))
        details = get_sku_cost_details(product.sku, self.db)

        self.assertAlmostEqual(details.calculated_batch_cost, 1000.0)
        self.assertAlmostEqual(details.calculated_portion_cost, 100.0)

    def test_edited_single_gram_tablea_price_is_respected(self):
        product = self.add_product("ST-IND-SWT", "Edited Tablea")
        edited_tablea = self.add_raw(
            "Tablea",
            0.80,
            1.0,
            "g",
            stored_cost=0.80,
        )
        self.add_raw("Tablea chopped", 1200.0, 1000.0, "g", stored_cost=1.2)
        self.db.add(models.Recipe(
            sku=product.sku,
            yield_weight=1000.0,
            yield_unit="g",
            portion_size=100.0,
            portion_unit="g",
            ingredients=[models.RecipeItem(
                ingredient_type="raw",
                raw_ingredient_id=edited_tablea.id,
                base_qty=1000.0,
                base_unit="g",
            )],
        ))
        self.db.commit()

        self.assertFalse(CostingService.reconcile_legacy_sweet_tablea_recipe(self.db))
        details = get_sku_cost_details(product.sku, self.db)

        self.assertAlmostEqual(details.calculated_batch_cost, 800.0)
        self.assertAlmostEqual(details.calculated_portion_cost, 80.0)

    def test_raw_ingredient_price_update_refreshes_stored_unit_cost(self):
        self.db.add(models.Warehouse(id=1, name="Main Facility"))
        owner = models.User(
            username="cost-owner",
            hashed_password="hashed-password",
            role="owner",
            is_active=True,
        )
        raw = self.add_raw("Updated Cocoa", 100.0, 1000.0, "g", 0.1)
        product = self.add_product(
            "UPDATED-COCOA",
            "Updated Cocoa Portion",
            retail_price=100.0,
        )
        self.db.add(models.Recipe(
            sku=product.sku,
            yield_weight=1000.0,
            yield_unit="g",
            portion_size=100.0,
            portion_unit="g",
            ingredients=[models.RecipeItem(
                ingredient_type="raw",
                raw_ingredient_id=raw.id,
                base_qty=1000.0,
                base_unit="g",
            )],
        ))
        self.db.add(owner)
        self.db.commit()

        CostingService.set_analysis_cache([{"stale": True}])
        response = update_raw_ingredient(
            raw.id,
            schemas.RawIngredientUpdate(price=300.0, net_weight=1500.0),
            self.db,
            owner,
        )

        self.db.refresh(raw)
        self.assertAlmostEqual(raw.cost_per_gram_unit, 0.2)
        self.assertAlmostEqual(response["cost_per_gram_unit"], 0.2)
        self.db.refresh(product)
        self.assertAlmostEqual(product.cost_per_unit, 20.0)
        self.assertIsNone(CostingService.get_analysis_cache())


if __name__ == "__main__":
    unittest.main()

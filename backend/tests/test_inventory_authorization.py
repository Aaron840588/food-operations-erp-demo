import os
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import auth, models
from app.database import Base, get_db
from app.main import app
from app.services.costing_service import CostingService


class InventoryAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.session_factory = sessionmaker(bind=self.engine)
        self.current_user = models.User(
            id=1,
            username="owner",
            role="owner",
            is_active=True,
        )

        with self.session_factory() as db:
            db.add(models.ProductSKU(
                sku="AUTH-SKU",
                product_name="Authorization Product",
                category="Sandwiches & Salads",
                size="Solo",
                retail_price=130,
                reseller_price=117,
                cost_override=44,
                cost_per_unit=45,
                labor_cost=5,
                utility_cost=3,
                warehouse_stock=10,
            ))
            db.add(models.RawIngredient(
                name="Authorization Ingredient",
                category="Food",
                unit="g",
                price=200,
                net_weight=1000,
                cost_per_gram_unit=0.2,
                available_stock=100,
                reorder_level=10,
            ))
            db.commit()

        def override_db():
            db = self.session_factory()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[auth.get_current_user] = lambda: self.current_user
        self.client = TestClient(app)
        CostingService.clear_costing_cache()

    def tearDown(self):
        CostingService.clear_costing_cache()
        app.dependency_overrides.clear()
        self.client.close()
        self.engine.dispose()

    def become_staff(self):
        self.current_user = models.User(
            id=2,
            username="staff",
            role="staff",
            is_active=True,
        )

    def test_staff_catalog_reads_redact_costs_while_owner_retains_them(self):
        owner_product = self.client.get("/products").json()[0]
        self.assertEqual(owner_product["cost_override"], 44)
        self.assertEqual(owner_product["cost_per_unit"], 45)
        self.assertEqual(owner_product["labor_cost"], 5)
        self.assertEqual(owner_product["utility_cost"], 3)

        owner_raw = self.client.get("/raw-ingredients").json()[0]
        self.assertEqual(owner_raw["price"], 200)
        self.assertEqual(owner_raw["cost_per_gram_unit"], 0.2)

        self.become_staff()
        staff_product = self.client.get("/products").json()[0]
        for field in ("cost_override", "cost_per_unit", "labor_cost", "utility_cost"):
            self.assertNotIn(field, staff_product)
        self.assertEqual(staff_product["retail_price"], 130)
        self.assertEqual(staff_product["reseller_price"], 117)
        self.assertEqual(staff_product["warehouse_stock"], 10)

        staff_raw = self.client.get("/raw-ingredients").json()[0]
        self.assertNotIn("price", staff_raw)
        self.assertNotIn("cost_per_gram_unit", staff_raw)
        self.assertEqual(staff_raw["available_stock"], 100)

    def test_staff_can_adjust_stock_but_cannot_change_catalog_or_cost_fields(self):
        self.become_staff()

        product_stock = self.client.put(
            "/products/AUTH-SKU",
            json={"warehouse_stock": 12},
        )
        self.assertEqual(product_stock.status_code, 200)
        self.assertEqual(product_stock.json()["warehouse_stock"], 12)
        self.assertNotIn("cost_per_unit", product_stock.json())

        forbidden_product = self.client.put(
            "/products/AUTH-SKU",
            json={"retail_price": 999},
        )
        self.assertEqual(forbidden_product.status_code, 403)

        raw_stock = self.client.put(
            "/raw-ingredients/1",
            json={"available_stock": 120},
        )
        self.assertEqual(raw_stock.status_code, 200)
        self.assertEqual(raw_stock.json()["available_stock"], 120)
        self.assertNotIn("price", raw_stock.json())

        forbidden_raw = self.client.put(
            "/raw-ingredients/1",
            json={"price": 999},
        )
        self.assertEqual(forbidden_raw.status_code, 403)

        with self.session_factory() as db:
            product = db.get(models.ProductSKU, "AUTH-SKU")
            ingredient = db.get(models.RawIngredient, 1)
            self.assertEqual(product.warehouse_stock, 12)
            self.assertEqual(product.retail_price, 130)
            self.assertEqual(ingredient.available_stock, 120)
            self.assertEqual(ingredient.price, 200)

    def test_costing_gift_and_overhead_routes_are_owner_only(self):
        for path in ("/costing/analysis", "/gift-sets", "/gift-sets/overhead-rates"):
            owner_response = self.client.get(path)
            self.assertEqual(owner_response.status_code, 200, path)

        self.become_staff()
        for path in ("/costing/analysis", "/gift-sets", "/gift-sets/overhead-rates"):
            staff_response = self.client.get(path)
            self.assertEqual(staff_response.status_code, 403, path)

        # The dashboard calls the costing helper internally rather than through
        # the owner-only HTTP router, so the staff operations dashboard remains usable.
        dashboard_response = self.client.get("/dashboard/summary")
        self.assertEqual(dashboard_response.status_code, 200)
        self.assertEqual(dashboard_response.json()["viewer_role"], "staff")


if __name__ == "__main__":
    unittest.main()

import os
import unittest
from datetime import datetime

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import auth, models
from app.database import Base, get_db
from app.main import app
from app.services.cost_snapshot_service import build_unit_cost_snapshots
from app.services.costing_service import CostingService
from app.services.owner_dashboard_service import _business_category


class OwnerWeeklyDashboardTests(unittest.TestCase):
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

    def _add_product(self):
        product = models.ProductSKU(
            sku="WEEKLY-YP-01",
            product_name="Weekly Yema Spread",
            category="Sweet",
            size="Indulge",
            retail_price=100.0,
            reseller_price=80.0,
            cost_override=20.0,
            cost_per_unit=20.0,
            labor_cost=5.0,
            utility_cost=2.0,
            warehouse_stock=30,
            is_active=True,
        )
        return product

    def test_owner_weekly_summary_calculates_channels_costs_and_comparable_days(self):
        db = self.session_factory()
        product = self._add_product()
        partner = models.ConsignmentPartner(
            name="Weekly Partner",
            discount_rate=0.10,
            collection_frequency="Weekly",
            minimum_order_amount=1000.0,
        )
        db.add_all([product, partner])
        db.flush()

        delivery = models.ConsignmentDelivery(
            partner_id=partner.id,
            delivery_date="2026-07-27",
            is_paid=False,
        )
        delivery.items.append(models.ConsignmentItem(
            sku=product.sku,
            qty_delivered=2,
            units_sold=1,
            qty_pulled_out=0,
            reseller_price_snapshot=80.0,
            cost_per_unit_snapshot=20.0,
            food_cost_snapshot=20.0,
            labor_cost_snapshot=5.0,
            utility_cost_snapshot=2.0,
            total_cost_snapshot=27.0,
            cost_status_snapshot="ok",
            store_price_snapshot=100.0,
        ))
        paid_delivery = models.ConsignmentDelivery(
            partner_id=partner.id,
            delivery_date="2026-07-01",
            is_paid=True,
        )
        paid_delivery.items.append(models.ConsignmentItem(
            sku=product.sku,
            qty_delivered=10,
            units_sold=10,
            qty_pulled_out=0,
            reseller_price_snapshot=80.0,
            cost_per_unit_snapshot=20.0,
            food_cost_snapshot=20.0,
            labor_cost_snapshot=5.0,
            utility_cost_snapshot=2.0,
            total_cost_snapshot=27.0,
            cost_status_snapshot="ok",
            store_price_snapshot=100.0,
        ))

        current_order = models.ResellerOrder(
            reseller_name="Current Wholesale",
            order_date="2026-07-28",
            subtotal=200.0,
            discount_amount=0.0,
            tax_amount=0.0,
            grand_total=200.0,
            is_paid=False,
        )
        current_order.items.append(models.ResellerOrderItem(
            sku=product.sku,
            quantity=2,
            price_snapshot=100.0,
            food_cost_snapshot=20.0,
            labor_cost_snapshot=5.0,
            utility_cost_snapshot=2.0,
            total_cost_snapshot=27.0,
            cost_status_snapshot="ok",
        ))

        previous_order = models.ResellerOrder(
            reseller_name="Previous Wholesale",
            order_date="2026-07-21",
            subtotal=100.0,
            discount_amount=0.0,
            tax_amount=0.0,
            grand_total=100.0,
            is_paid=True,
        )
        previous_order.items.append(models.ResellerOrderItem(
            sku=product.sku,
            quantity=1,
            price_snapshot=100.0,
            food_cost_snapshot=20.0,
            labor_cost_snapshot=5.0,
            utility_cost_snapshot=2.0,
            total_cost_snapshot=27.0,
            cost_status_snapshot="ok",
        ))

        event = models.MarketEvent(
            name="Ready Weekend Market",
            event_date="2026-08-01",
            location="Test Hall",
            staff_assigned="Ana",
            status="Active",
            total_expenses=10.0,
            is_deleted=False,
        )
        event.allocations.append(models.MarketEventAllocation(
            sku=product.sku,
            quantity=3,
        ))
        db.add_all([delivery, paid_delivery, current_order, previous_order, event])
        db.flush()
        market_sale = models.MarketEventSale(
            event_id=event.id,
            payment_method="Cash",
            subtotal_amount=100.0,
            total_amount=100.0,
            discount_amount=0.0,
            manual_discount_amount=0.0,
            promotion_discount_amount=0.0,
            change_given=0.0,
            tip_amount=0.0,
            timestamp=datetime(2026, 7, 28, 10, 0),
        )
        market_sale.items.append(models.MarketEventSaleItem(
            sku=product.sku,
            quantity=1,
            price_snapshot=100.0,
            food_cost_snapshot=20.0,
            labor_cost_snapshot=5.0,
            utility_cost_snapshot=2.0,
            total_cost_snapshot=27.0,
            cost_status_snapshot="ok",
        ))
        db.add(market_sale)
        db.commit()
        db.close()

        response = self.client.get(
            "/dashboard/summary",
            params={
                "period": "custom",
                "date_from": "2026-07-27",
                "date_to": "2026-08-02",
            },
        )

        self.assertEqual(response.status_code, 200)
        weekly = response.json()["owner_weekly"]
        try:
            from zoneinfo import ZoneInfo
            manila_today = datetime.now(ZoneInfo("Asia/Manila")).strftime("%Y-%m-%d")
        except Exception:
            manila_today = datetime.now().strftime("%Y-%m-%d")
        expected_data_through = min("2026-08-02", manila_today)
        self.assertEqual(weekly["period"]["data_through"], expected_data_through)
        self.assertEqual(weekly["period"]["previous_start"], "2026-07-20")
        self.assertIn("2026-07-", weekly["period"]["previous_end"])
        self.assertEqual(weekly["kpis"]["weekly_net_sales"]["value"], 380.0)
        self.assertEqual(weekly["kpis"]["weekly_net_sales"]["previous_value"], 100.0)
        self.assertEqual(weekly["kpis"]["weekly_food_cost"]["value"], 80.0)
        self.assertEqual(weekly["kpis"]["contribution_profit"]["value"], 262.0)
        self.assertEqual(weekly["kpis"]["pending_collectibles"]["value"], 280.0)
        self.assertEqual(
            {row["channel"]: row["net_sales"] for row in weekly["sales_by_channel"]},
            {"Consignment": 80.0, "Wholesale": 200.0, "Market Events": 100.0},
        )
        self.assertEqual(weekly["product_analysis"][0]["units_sold"], 4)
        self.assertEqual(weekly["confidence"]["status"], "estimated")
        self.assertIn(
            "Sheet sync setup required",
            {alert["type"] for alert in weekly["alerts"]},
        )

    def test_reseller_checkout_records_immutable_component_snapshots(self):
        db = self.session_factory()
        db.add(self._add_product())
        db.commit()
        db.close()

        response = self.client.post(
            "/resellers/orders",
            json={
                "reseller_name": "Snapshot Buyer",
                "order_date": "2026-07-29",
                "items": [{"sku": "WEEKLY-YP-01", "quantity": 2}],
                "tax_rate": 0,
            },
        )

        self.assertEqual(response.status_code, 200)
        db = self.session_factory()
        item = db.query(models.ResellerOrderItem).one()
        self.assertEqual(item.food_cost_snapshot, 20.0)
        self.assertEqual(item.labor_cost_snapshot, 5.0)
        self.assertEqual(item.utility_cost_snapshot, 2.0)
        self.assertEqual(item.total_cost_snapshot, 27.0)
        self.assertEqual(item.cost_status_snapshot, "ok")
        db.close()

    def test_ingredient_price_change_is_a_dashboard_alert(self):
        db = self.session_factory()
        ingredient = models.RawIngredient(
            name="Butter",
            category="Dairy",
            unit="g",
            price=100.0,
            net_weight=1000.0,
            cost_per_gram_unit=0.1,
            available_stock=1000.0,
            reorder_level=100.0,
        )
        db.add(ingredient)
        db.commit()
        ingredient_id = ingredient.id
        db.close()

        update_response = self.client.put(
            f"/raw-ingredients/{ingredient_id}",
            json={"price": 120.0},
        )
        self.assertEqual(update_response.status_code, 200)

        summary_response = self.client.get(
            "/dashboard/summary",
            params={
                "period": "custom",
                "date_from": "2026-07-27",
                "date_to": "2026-08-02",
            },
        )
        self.assertEqual(summary_response.status_code, 200)
        alerts = summary_response.json()["owner_weekly"]["alerts"]
        price_alert = next(alert for alert in alerts if alert["type"] == "Ingredient price increase")
        self.assertIn("Butter", price_alert["message"])
        self.assertIn("20.0%", price_alert["message"])
        supplier_alert = next(alert for alert in alerts if alert["type"] == "Supplier links missing")
        self.assertIn("1 of 1", supplier_alert["message"])

    def test_zero_cost_recipe_input_blocks_profit_confidence(self):
        db = self.session_factory()
        product = models.ProductSKU(
            sku="ZERO-INPUT-01",
            product_name="Zero Input Product",
            category="Sandwiches & Salads",
            size="Full",
            retail_price=200.0,
            reseller_price=150.0,
            warehouse_stock=5,
            is_active=True,
        )
        ingredient = models.RawIngredient(
            name="Unpriced Bread",
            category="Bread",
            unit="g",
            price=0.0,
            net_weight=500.0,
            cost_per_gram_unit=0.0,
            available_stock=500.0,
            reorder_level=50.0,
        )
        db.add_all([product, ingredient])
        db.flush()
        recipe = models.Recipe(
            sku=product.sku,
            yield_weight=100.0,
            yield_unit="g",
            portion_size=100.0,
            portion_unit="g",
        )
        recipe.ingredients.append(models.RecipeItem(
            ingredient_type="raw",
            raw_ingredient_id=ingredient.id,
            base_qty=50.0,
            base_unit="g",
        ))
        db.add(recipe)
        db.commit()

        snapshot = build_unit_cost_snapshots(db, [product])[product.sku]
        self.assertEqual(snapshot.status, "missing_cost_input")
        self.assertIn("Unpriced Bread", snapshot.status_message or "")
        db.close()

    def test_sandwich_sku_wins_over_generic_savory_category(self):
        product = models.ProductSKU(
            sku="PCLB-HF-SW-SVR",
            product_name="Pesto Chicken Labneh",
            category="Savory",
            size="Half",
            retail_price=150.0,
            reseller_price=120.0,
            warehouse_stock=0,
            is_active=True,
        )
        self.assertEqual(_business_category(product), "Sandwiches & Salads")


if __name__ == "__main__":
    unittest.main()

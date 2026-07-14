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


class DashboardAuthorizationTests(unittest.TestCase):
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

    def tearDown(self):
        app.dependency_overrides.clear()
        self.client.close()
        self.engine.dispose()

    def test_staff_summary_omits_finance_while_owner_retains_it(self):
        owner_response = self.client.get("/dashboard/summary")
        self.assertEqual(owner_response.status_code, 200)
        owner_payload = owner_response.json()
        self.assertEqual(owner_payload["viewer_role"], "owner")
        self.assertIn("combined_sales", owner_payload["analytics"])
        self.assertIn("combined_cogs", owner_payload["analytics"])
        self.assertIn("combined_net_profit", owner_payload["analytics"])
        self.assertIn("total_unpaid_ar", owner_payload)
        self.assertIn("top_margins", owner_payload)
        self.assertIn("category_averages", owner_payload)

        self.current_user = models.User(
            id=2,
            username="staff",
            role="staff",
            is_active=True,
        )
        staff_response = self.client.get("/dashboard/summary")
        self.assertEqual(staff_response.status_code, 200)
        staff_payload = staff_response.json()
        self.assertEqual(staff_payload["viewer_role"], "staff")

        for key in (
            "raw_inventory_value",
            "consignment_sales",
            "reseller_sales",
            "market_sales",
            "combined_sales",
            "consignment_net_profit",
            "combined_cogs",
            "combined_net_profit",
            "combined_costing_complete",
        ):
            self.assertNotIn(key, staff_payload["analytics"])

        for key in (
            "low_margin_products",
            "unpaid_deliveries",
            "total_unpaid_ar",
            "top_margins",
            "low_margins",
            "category_averages",
        ):
            self.assertNotIn(key, staff_payload)

        for key in (
            "low_stock",
            "expiring_batches",
            "today_plan",
            "cleaning_summary",
            "waste_trend",
        ):
            self.assertIn(key, staff_payload)

    def test_staff_analytics_endpoint_omits_monetary_metrics(self):
        owner_response = self.client.get("/dashboard/analytics")
        self.assertEqual(owner_response.status_code, 200)
        self.assertIn("combined_sales", owner_response.json())
        self.assertIn("consignment_net_profit", owner_response.json())

        self.current_user = models.User(
            id=2,
            username="staff",
            role="staff",
            is_active=True,
        )
        staff_response = self.client.get("/dashboard/analytics")
        self.assertEqual(staff_response.status_code, 200)
        staff_payload = staff_response.json()
        self.assertEqual(
            set(staff_payload),
            {
                "raw_items_count",
                "consignment_partners_count",
                "consignment_efficiency_rate",
                "consignment_waste_percentage",
            },
        )

    def test_market_event_analytics_is_owner_only(self):
        owner_response = self.client.get("/market-events/analytics/summary")
        self.assertEqual(owner_response.status_code, 200)

        self.current_user = models.User(
            id=2,
            username="staff",
            role="staff",
            is_active=True,
        )
        staff_response = self.client.get("/market-events/analytics/summary")
        self.assertEqual(staff_response.status_code, 403)

    def test_update_consignment_partner(self):
        db = self.session_factory()
        partner = models.ConsignmentPartner(
            name="Seeded Test Partner",
            discount_rate=0.10,
            collection_frequency="Weekly",
            minimum_order_amount=1500.00,
            is_active=True
        )
        db.add(partner)
        db.commit()
        db.refresh(partner)
        partner_id = partner.id
        db.close()

        payload = {
            "name": "Updated Partner",
            "discount_rate": 0.12,
            "collection_frequency": "Monthly",
            "minimum_order_amount": 2000.00,
            "is_active": False
        }
        response = self.client.put(f"/consignment/partners/{partner_id}", json=payload)
        self.assertEqual(response.status_code, 200)
        res_data = response.json()
        self.assertEqual(res_data["name"], "Updated Partner")
        self.assertEqual(res_data["is_active"], False)


if __name__ == "__main__":
    unittest.main()

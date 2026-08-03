import hashlib
import os
import unittest
from datetime import date, timedelta
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import auth, models, schemas
from app.database import Base, get_db
from app.routers import preorders
from app.routers.market_events import record_market_event_sale


class PreorderApiTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.owner = models.User(
            username="owner",
            hashed_password="test-only",
            role="owner",
            is_active=True,
        )
        self.staff = models.User(
            username="alice",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        self.other_staff = models.User(
            username="malice",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        self.product = models.ProductSKU(
            sku="PRE-SPREAD-01",
            product_name="Public Spread",
            category="Spreads & Sauces",
            size="200g",
            retail_price=Decimal("125.50"),
            reseller_price=Decimal("90.00"),
            cost_per_unit=Decimal("50.00"),
            warehouse_stock=20,
            is_active=True,
        )
        self.inactive_product = models.ProductSKU(
            sku="PRE-INACTIVE-01",
            product_name="Inactive Spread",
            category="Spreads & Sauces",
            size="200g",
            retail_price=99,
            reseller_price=80,
            warehouse_stock=10,
            is_active=False,
        )
        self.excluded_product = models.ProductSKU(
            sku="PRE-EXCLUDED-01",
            product_name="Excluded Product",
            category="Gift Sets",
            size="Box",
            retail_price=500,
            reseller_price=400,
            warehouse_stock=5,
            is_active=True,
        )
        self.zero_price_product = models.ProductSKU(
            sku="PRE-ZERO-01",
            product_name="Unpriced Sandwich",
            category="Sandwiches & Salads",
            size="Half",
            retail_price=Decimal("0.00"),
            reseller_price=Decimal("0.00"),
            warehouse_stock=10,
            is_active=True,
        )
        self.db.add_all([
            self.owner,
            self.staff,
            self.other_staff,
            self.product,
            self.inactive_product,
            self.excluded_product,
            self.zero_price_product,
        ])
        self.db.commit()

        self.current_user = self.owner
        app = FastAPI()
        app.include_router(preorders.router)

        def override_db():
            yield self.db

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[auth.get_current_user] = lambda: self.current_user
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        self.db.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def add_event(self, name="Preorder Event", assigned="alice", quantity=10):
        event = models.MarketEvent(
            name=name,
            event_date=(date.today() + timedelta(days=1)).isoformat(),
            location="Test Market",
            staff_assigned=assigned,
            status="Active",
            is_deleted=False,
        )
        event.allocations.append(models.MarketEventAllocation(
            sku=self.product.sku,
            quantity=quantity,
        ))
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def create_form(self, event=None, enabled=True):
        response = self.client.post(
            "/preorders/forms",
            json={
                "name": "Customer preorder",
                "event_id": event.id if event else None,
                "is_enabled": enabled,
                "allowed_fulfillment_methods": ["Pickup", "Delivery"],
                "payment_preferences": ["Cash", "GCash"],
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def submission_payload(self, reference="public-submit-001", quantity=2):
        return {
            "submission_reference": reference,
            "customer_name": "Mobile Customer",
            "contact_phone": "+63 917 123 4567",
            "requested_fulfillment_date": (date.today() + timedelta(days=1)).isoformat(),
            "requested_fulfillment_time": "10:30:00",
            "fulfillment_method": "Pickup",
            "payment_preference": "Cash",
            "items": [{"sku": self.product.sku, "quantity": quantity}],
        }

    def submit(self, token, reference="public-submit-001", quantity=2):
        return self.client.post(
            f"/preorders/public/{token}",
            json=self.submission_payload(reference, quantity),
        )

    def move_to_ready(self, preorder_id):
        for status in ("Confirmed", "Preparing", "Ready"):
            response = self.client.post(
                f"/preorders/{preorder_id}/transition",
                json={"status": status},
            )
            self.assertEqual(response.status_code, 200, response.text)

    def test_owner_token_is_hashed_and_public_catalog_is_minimized(self):
        event = self.add_event()
        created = self.create_form(event)
        raw_token = created["public_token"]
        self.assertGreaterEqual(len(raw_token), 32)
        form = self.db.query(models.PreorderForm).filter(
            models.PreorderForm.id == created["id"]
        ).one()
        self.assertEqual(form.token_hash, hashlib.sha256(raw_token.encode("utf-8")).hexdigest())
        self.assertNotEqual(form.token_hash, raw_token)

        owner_list = self.client.get("/preorders/forms")
        self.assertEqual(owner_list.status_code, 200)
        self.assertIsNone(owner_list.json()[0]["public_token"])

        catalog = self.client.get(f"/preorders/public/{raw_token}")
        self.assertEqual(catalog.status_code, 200, catalog.text)
        body = catalog.json()
        self.assertEqual(body["stock_reservation_mode"], "none_until_pos_fulfillment")
        self.assertEqual([product["sku"] for product in body["products"]], [self.product.sku])
        self.assertEqual(
            set(body["products"][0]),
            {"sku", "product_name", "category", "size", "retail_price"},
        )
        self.assertNotIn("staff_assigned", body["event"])
        self.assertNotIn("warehouse_stock", body["products"][0])

        rotated = self.client.post(f"/preorders/forms/{form.id}/rotate-token")
        self.assertEqual(rotated.status_code, 200, rotated.text)
        self.assertNotEqual(rotated.json()["public_token"], raw_token)
        self.assertEqual(
            self.client.get(f"/preorders/public/{raw_token}").status_code,
            404,
        )

    def test_public_submission_uses_server_prices_and_is_idempotent(self):
        created = self.create_form()
        token = created["public_token"]
        response = self.submit(token)
        self.assertEqual(response.status_code, 201, response.text)
        body = response.json()
        self.assertEqual(body["total_amount"], "251.00")
        self.assertFalse(body["stock_reserved"])
        self.assertEqual(body["status"], "Pending")
        self.assertRegex(body["public_reference"], r"^HH-[23456789A-HJ-NP-Z]{16}$")

        preorder = self.db.query(models.Preorder).one()
        self.assertEqual(preorder.total_amount, Decimal("251.00"))
        self.assertEqual(preorder.items[0].unit_price_snapshot, Decimal("125.50"))
        self.assertEqual(preorder.items[0].line_total_snapshot, Decimal("251.00"))
        self.assertEqual(preorder.status_history[0].source, "public")
        self.assertIsNone(preorder.status_history[0].actor_user_id)
        self.assertEqual(self.product.warehouse_stock, 20)

        replay = self.submit(token)
        self.assertEqual(replay.status_code, 201, replay.text)
        self.assertEqual(replay.json()["public_reference"], body["public_reference"])
        self.assertEqual(self.db.query(models.Preorder).count(), 1)
        self.assertEqual(self.db.query(models.PreorderItem).count(), 1)

        conflict = self.submit(token, quantity=3)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(self.db.query(models.Preorder).count(), 1)

        invalid_delivery = self.submission_payload("public-submit-002", 1)
        invalid_delivery.update({
            "fulfillment_method": "Delivery",
            "delivery_address": "",
        })
        invalid = self.client.post(
            f"/preorders/public/{token}",
            json=invalid_delivery,
        )
        self.assertEqual(invalid.status_code, 422)

    def test_zero_price_products_are_not_publicly_orderable(self):
        created = self.create_form()
        token = created["public_token"]

        catalog = self.client.get(f"/preorders/public/{token}")
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertNotIn(
            self.zero_price_product.sku,
            [product["sku"] for product in catalog.json()["products"]],
        )

        payload = self.submission_payload("public-zero-price-001", 1)
        payload["items"] = [{"sku": self.zero_price_product.sku, "quantity": 1}]
        response = self.client.post(f"/preorders/public/{token}", json=payload)
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(self.db.query(models.Preorder).count(), 0)

    def test_owner_and_exact_assigned_staff_transition_scope(self):
        assigned = self.add_event(assigned="BOB, ALIce; carol|dave\nEve")
        other = self.add_event(name="Other Event", assigned="malice")
        assigned_form = self.create_form(assigned)
        other_form = self.create_form(other)
        first = self.submit(assigned_form["public_token"], "staff-order-001", 1)
        second = self.submit(other_form["public_token"], "staff-order-002", 1)
        self.assertEqual(first.status_code, 201, first.text)
        self.assertEqual(second.status_code, 201, second.text)
        first_id = self.db.query(models.Preorder).filter(
            models.Preorder.public_reference == first.json()["public_reference"]
        ).one().id

        confirmed = self.client.post(
            f"/preorders/{first_id}/transition",
            json={"status": "Confirmed"},
        )
        self.assertEqual(confirmed.status_code, 200, confirmed.text)

        self.current_user = self.staff
        staff_list = self.client.get("/preorders")
        self.assertEqual(staff_list.status_code, 200, staff_list.text)
        self.assertEqual([row["id"] for row in staff_list.json()["items"]], [first_id])
        detail = self.client.get(f"/preorders/{first_id}")
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()["status_history"], [])
        self.assertEqual(detail.json()["audit_events"], [])

        preparing = self.client.post(
            f"/preorders/{first_id}/transition",
            json={"status": "Preparing"},
        )
        self.assertEqual(preparing.status_code, 200, preparing.text)
        denied_payment = self.client.post(
            f"/preorders/{first_id}/transition",
            json={"payment_status": "Paid"},
        )
        self.assertEqual(denied_payment.status_code, 403)

        self.current_user = self.other_staff
        self.assertEqual(self.client.get(f"/preorders/{first_id}").status_code, 403)
        self.assertEqual(
            self.client.post(
                f"/preorders/{first_id}/transition",
                json={"status": "Ready"},
            ).status_code,
            403,
        )

        self.current_user = self.owner
        owner_detail = self.client.get(f"/preorders/{first_id}")
        self.assertEqual(owner_detail.status_code, 200)
        self.assertGreaterEqual(len(owner_detail.json()["status_history"]), 3)
        self.assertGreaterEqual(len(owner_detail.json()["audit_events"]), 2)

    def test_pos_fulfillment_is_deterministic_and_deducts_once(self):
        event = self.add_event(quantity=5)
        form = self.create_form(event)
        response = self.submit(form["public_token"], "fulfill-order-001", 2)
        preorder = self.db.query(models.Preorder).filter(
            models.Preorder.public_reference == response.json()["public_reference"]
        ).one()
        self.move_to_ready(preorder.id)

        self.current_user = self.staff
        fulfilled = self.client.post(
            f"/preorders/{preorder.id}/fulfill",
            json={
                "payment_method": "Cash",
                "payment_status": "Paid",
                "cash_received": "300.00",
            },
        )
        self.assertEqual(fulfilled.status_code, 200, fulfilled.text)
        self.assertEqual(fulfilled.json()["status"], "Fulfilled")
        self.assertEqual(fulfilled.json()["payment_status"], "Paid")
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        allocation = self.db.query(models.MarketEventAllocation).filter(
            models.MarketEventAllocation.event_id == event.id
        ).one()
        self.assertEqual(allocation.quantity, 3)
        self.assertEqual(self.product.warehouse_stock, 20)

        replay = self.client.post(
            f"/preorders/{preorder.id}/fulfill",
            json={
                "payment_method": "Cash",
                "payment_status": "Paid",
                "cash_received": "300.00",
            },
        )
        self.assertEqual(replay.status_code, 200, replay.text)
        self.assertEqual(replay.json()["fulfillment_sale_id"], fulfilled.json()["fulfillment_sale_id"])
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        self.db.refresh(allocation)
        self.assertEqual(allocation.quantity, 3)

    def test_recovery_links_existing_sale_and_price_drift_blocks_before_pos(self):
        event = self.add_event(quantity=6)
        form = self.create_form(event)
        first = self.submit(form["public_token"], "recovery-order-001", 2)
        recovery_preorder = self.db.query(models.Preorder).filter(
            models.Preorder.public_reference == first.json()["public_reference"]
        ).one()
        self.move_to_ready(recovery_preorder.id)
        recovery_preorder.fulfillment_payment_status_intent = "Receivable"
        self.db.commit()

        sale = record_market_event_sale(
            event.id,
            schemas.MarketEventSaleCreate(
                payment_method="GCash",
                items=[schemas.MarketEventSaleItemCreate(sku=self.product.sku, quantity=2)],
                client_reference=recovery_preorder.fulfillment_client_reference,
                is_preorder=True,
                preorder_customer_name=recovery_preorder.customer_name,
                preorder_payment_status="Unpaid",
                preorder_fulfillment_status="Picked Up",
            ),
            self.db,
            self.owner,
        )
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)

        recovered = self.client.post(
            f"/preorders/{recovery_preorder.id}/fulfill",
            json={"payment_method": "GCash", "payment_status": "Receivable"},
        )
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["fulfillment_sale_id"], sale.id)
        self.assertEqual(recovered.json()["status"], "Fulfilled")
        self.assertEqual(recovered.json()["payment_status"], "Receivable")
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        allocation = self.db.query(models.MarketEventAllocation).filter(
            models.MarketEventAllocation.event_id == event.id
        ).one()
        self.assertEqual(allocation.quantity, 4)

        second = self.submit(form["public_token"], "price-drift-order-001", 1)
        drift_preorder = self.db.query(models.Preorder).filter(
            models.Preorder.public_reference == second.json()["public_reference"]
        ).one()
        self.move_to_ready(drift_preorder.id)
        self.product.retail_price = 130
        self.db.commit()
        blocked = self.client.post(
            f"/preorders/{drift_preorder.id}/fulfill",
            json={"payment_method": "GCash", "payment_status": "Paid"},
        )
        self.assertEqual(blocked.status_code, 409, blocked.text)
        self.assertIn("Price", blocked.json()["detail"])
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        self.db.refresh(drift_preorder)
        self.assertIsNone(drift_preorder.fulfillment_payment_status_intent)
        self.db.refresh(allocation)
        self.assertEqual(allocation.quantity, 4)


if __name__ == "__main__":
    unittest.main()

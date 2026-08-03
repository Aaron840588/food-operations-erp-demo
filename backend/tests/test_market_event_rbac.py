import unittest
from decimal import Decimal

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import auth, models
from app.database import Base, get_db
from app.routers import market_events


class MarketEventRbacTests(unittest.TestCase):
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
            sku="RBAC-SKU",
            product_name="RBAC Spread",
            category="Spreads & Sauces",
            size="200g",
            retail_price=100,
            reseller_price=80,
            cost_per_unit=30,
            warehouse_stock=20,
            is_active=True,
        )
        self.db.add_all([self.owner, self.staff, self.other_staff, self.product])
        self.db.commit()

        self.current_user = self.owner
        app = FastAPI()
        app.include_router(market_events.router)

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

    def add_event(
        self,
        name,
        status="Active",
        staff_assigned="alice",
        quantity=2,
    ):
        event = models.MarketEvent(
            name=name,
            event_date="2026-07-22",
            location="Test Bazaar",
            staff_assigned=staff_assigned,
            notes="Operational note",
            status=status,
            is_deleted=False,
            initial_cash_balance=500,
            actual_closing_cash=450,
            cash_adjustments=25,
            cash_adjustments_notes="Owner adjustment",
            total_expenses=40,
            expense_notes="Owner expense",
            cash_expenses=Decimal("40.00"),
            cash_refunds=Decimal("10.00"),
            gcash_sales=Decimal("200.00"),
            bpi_sales=Decimal("100.00"),
        )
        event.allocations.append(
            models.MarketEventAllocation(
                sku=self.product.sku,
                quantity=quantity,
                wasted_quantity=1,
                waste_reason="Owner closeout note",
            )
        )
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def test_staff_list_and_detail_are_limited_to_exact_assigned_active_events(self):
        assigned = self.add_event(
            "Assigned Active",
            staff_assigned="BOB, ALIce; carol|dave\nEve",
        )
        substring_only = self.add_event("Substring Active", staff_assigned="malice")
        assigned_draft = self.add_event("Assigned Draft", status="Draft", staff_assigned="alice")
        assigned_completed = self.add_event(
            "Assigned Completed Report",
            status="Completed",
            staff_assigned="alice",
        )

        self.current_user = self.staff
        response = self.client.get("/market-events")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(event["id"] for event in response.json()), {assigned.id, assigned_draft.id})

        detail = self.client.get(f"/market-events/{assigned.id}")
        self.assertEqual(detail.status_code, 200)
        payload = detail.json()
        self.assertEqual(payload["estimated_revenue"], 200)
        self.assertIsNone(payload["estimated_cost"])
        self.assertIsNone(payload["potential_profit"])
        self.assertFalse(payload["financials_visible"])
        self.assertFalse(payload["costing_complete"])
        self.assertIsNone(payload["initial_cash_balance"])
        self.assertIsNone(payload["opening_float"])
        self.assertIsNone(payload["actual_closing_cash"])
        self.assertIsNone(payload["cash_adjustments"])
        self.assertIsNone(payload["cash_adjustments_notes"])
        self.assertIsNone(payload["total_expenses"])
        self.assertIsNone(payload["expense_notes"])
        self.assertIsNone(payload["cash_expenses"])
        self.assertIsNone(payload["cash_refunds"])
        self.assertIsNone(payload["gcash_sales"])
        self.assertIsNone(payload["bpi_sales"])
        self.assertIsNone(payload["cash_sales"])
        self.assertIsNone(payload["ending_cashbox_balance"])
        self.assertIsNone(payload["digital_sales_total"])
        self.assertIsNone(payload["payment_breakdown"])
        self.assertEqual(payload["food_waste_quantity"], 0)
        self.assertEqual(payload["food_leftover_quantity"], 0)
        self.assertIsNone(payload["food_waste_cost"])
        self.assertEqual(payload["allocations"][0]["retail_price"], 100)
        self.assertEqual(payload["allocations"][0]["current_stock"], 20)
        self.assertIsNone(payload["allocations"][0]["cost_per_unit"])
        self.assertEqual(payload["allocations"][0]["wasted_quantity"], 0)
        self.assertEqual(payload["allocations"][0]["waste_reason"], "")

        self.assertEqual(self.client.get(f"/market-events/{substring_only.id}").status_code, 403)
        self.assertEqual(self.client.get(f"/market-events/{assigned_draft.id}").status_code, 200)
        self.assertEqual(self.client.get(f"/market-events/{assigned_completed.id}").status_code, 403)

        self.current_user = self.other_staff
        other_staff_response = self.client.get("/market-events")
        self.assertEqual(other_staff_response.status_code, 200)
        self.assertEqual(
            [event["id"] for event in other_staff_response.json()],
            [substring_only.id],
        )

        self.current_user = self.owner
        owner_response = self.client.get("/market-events")
        self.assertEqual(owner_response.status_code, 200)
        self.assertEqual(len(owner_response.json()), 4)
        owner_payload = next(item for item in owner_response.json() if item["id"] == assigned.id)
        self.assertEqual(owner_payload["estimated_revenue"], 200)
        self.assertEqual(owner_payload["estimated_cost"], 60)
        self.assertEqual(owner_payload["initial_cash_balance"], 500)
        self.assertTrue(owner_payload["financials_visible"])

    def test_event_administration_and_sale_undo_are_owner_only(self):
        active_event = self.add_event("Assigned Active")
        draft_event = self.add_event("Owner Draft", status="Draft")
        self.current_user = self.staff

        valid_create = {
            "name": "Staff Created Event",
            "event_date": "2026-07-23",
            "location": "Staff Bazaar",
            "status": "Draft",
            "allocations": [{"sku": self.product.sku, "quantity": 1}],
        }
        create_res = self.client.post("/market-events", json=valid_create)
        self.assertEqual(create_res.status_code, 200)

        checks = [
            self.client.delete(f"/market-events/{draft_event.id}"),
            self.client.get("/market-events/analytics/summary"),
            self.client.delete(f"/market-events/{active_event.id}/sales/999/undo"),
        ]
        self.assertTrue(all(response.status_code == 403 for response in checks))

        self.current_user = self.owner
        owner_update = self.client.put(
            f"/market-events/{active_event.id}",
            json={"notes": "owner edit"},
        )
        self.assertEqual(owner_update.status_code, 200)
        self.assertEqual(owner_update.json()["notes"], "owner edit")
        self.assertEqual(self.client.get("/market-events/analytics/summary").status_code, 200)

    def test_assigned_staff_checkout_is_idempotent_and_keeps_pos_fields(self):
        assigned = self.add_event("Cashier Event", staff_assigned="Alice, bob", quantity=2)
        unassigned = self.add_event("Other Cashier", staff_assigned="malice", quantity=2)
        inactive = self.add_event("Inactive Cashier", status="Draft", staff_assigned="alice", quantity=2)
        self.current_user = self.staff
        payload = {
            "payment_method": "Cash",
            "cash_received": "150.00",
            "payment_reference": "cash-drawer-7",
            "client_reference": "rbac-sale-ref-001",
            "items": [{"sku": self.product.sku, "quantity": 1}],
        }

        first = self.client.post(f"/market-events/{assigned.id}/sales", json=payload)
        replay = self.client.post(f"/market-events/{assigned.id}/sales", json=payload)

        self.assertEqual(first.status_code, 200)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["id"], first.json()["id"])
        sale = first.json()
        self.assertEqual(sale["total_amount"], 100)
        self.assertEqual(sale["cashier_username"], "alice")
        self.assertEqual(Decimal(str(sale["cash_received"])), Decimal("150.00"))
        self.assertEqual(Decimal(str(sale["change_given"])), Decimal("50.00"))
        self.assertEqual(sale["payment_method"], "Cash")
        self.assertEqual(sale["payment_reference"], "cash-drawer-7")
        self.assertEqual(sale["items"][0]["price_snapshot"], 100)
        self.assertNotIn("cost_per_unit", sale["items"][0])
        self.assertNotIn("profit", sale)

        self.db.expire_all()
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=assigned.id,
            sku=self.product.sku,
        ).one()
        self.assertEqual(allocation.quantity, 1)
        self.assertEqual(
            self.db.query(models.MarketEventSale).filter_by(event_id=assigned.id).count(),
            1,
        )

        sales_response = self.client.get(f"/market-events/{assigned.id}/sales")
        self.assertEqual(sales_response.status_code, 200)
        self.assertEqual(sales_response.json()[0]["cash_received"], sale["cash_received"])
        self.assertEqual(sales_response.json()[0]["change_given"], sale["change_given"])
        self.assertEqual(sales_response.json()[0]["payment_reference"], "cash-drawer-7")

        blocked_unassigned = self.client.post(
            f"/market-events/{unassigned.id}/sales",
            json={**payload, "client_reference": "rbac-sale-ref-002"},
        )
        blocked_inactive = self.client.post(
            f"/market-events/{inactive.id}/sales",
            json={**payload, "client_reference": "rbac-sale-ref-003"},
        )
        self.assertEqual(blocked_unassigned.status_code, 403)
        self.assertEqual(blocked_inactive.status_code, 400)
        self.assertEqual(self.client.get(f"/market-events/{unassigned.id}/sales").status_code, 403)
        self.assertEqual(
            self.client.put(
                f"/market-events/{unassigned.id}/sales/{sale['id']}/preorder",
                json={"preorder_fulfillment_status": "Picked Up"},
            ).status_code,
            403,
        )


if __name__ == "__main__":
    unittest.main()

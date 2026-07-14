import os
import unittest

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base
from app.routers.market_events import (
    create_market_event,
    delete_market_event,
    get_all_market_events,
    record_market_event_sale,
    undo_market_event_sale,
    update_market_event,
    update_market_event_preorder,
)


class MarketEventStockTests(unittest.TestCase):
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
        self.db.add_all([
            self.user,
            models.Warehouse(id=1, name="Main Facility"),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_product(self, sku, stock, price=100):
        product = models.ProductSKU(
            sku=sku,
            product_name=f"Product {sku}",
            category="Spreads & Sauces",
            size="Sampler",
            retail_price=price,
            reseller_price=price * 0.9,
            warehouse_stock=stock,
        )
        self.db.add(product)
        self.db.add(models.WarehouseStock(
            warehouse_id=1,
            sku=sku,
            quantity=stock,
        ))
        self.db.commit()
        return product

    def add_event(self, status, allocations):
        event = models.MarketEvent(
            name="Audit Market",
            event_date="2026-07-13",
            location="Test Venue",
            status=status,
            is_deleted=False,
        )
        for sku, quantity in allocations:
            event.allocations.append(models.MarketEventAllocation(
                sku=sku,
                quantity=quantity,
            ))
        self.db.add(event)
        self.db.commit()
        self.db.refresh(event)
        return event

    def test_activation_over_allocation_rolls_back_every_deduction(self):
        first = self.add_product("A-SKU", 2)
        second = self.add_product("B-SKU", 1)
        event = self.add_event("Draft", [("A-SKU", 1), ("B-SKU", 2)])

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(status="Active"),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(event)
        self.db.refresh(first)
        self.db.refresh(second)
        self.assertEqual(event.status, "Draft")
        self.assertEqual(first.warehouse_stock, 2)
        self.assertEqual(second.warehouse_stock, 1)
        self.assertEqual(self.db.query(models.InventoryTransaction).count(), 0)
        mirrors = {
            stock.sku: stock.quantity
            for stock in self.db.query(models.WarehouseStock).all()
        }
        self.assertEqual(mirrors, {"A-SKU": 2, "B-SKU": 1})

    def test_create_active_event_cannot_bypass_stock_guard(self):
        product = self.add_product("A-SKU", 1)
        payload = schemas.MarketEventCreate(
            name="Direct Active Event",
            event_date="2026-07-13",
            location="Test Venue",
            status="Active",
            allocations=[
                schemas.MarketEventAllocationCreate(sku="A-SKU", quantity=2),
            ],
        )

        with self.assertRaises(HTTPException) as raised:
            create_market_event(payload, self.db, self.user)

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 1)
        self.assertEqual(self.db.query(models.MarketEvent).count(), 0)
        self.assertEqual(self.db.query(models.MarketEventAllocation).count(), 0)
        self.assertEqual(self.db.query(models.InventoryTransaction).count(), 0)

    def test_activation_requires_nonempty_positive_allocations(self):
        event = self.add_event("Draft", [])

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(status="Active"),
                self.db,
                self.user,
            )
        self.assertEqual(raised.exception.status_code, 422)

        with self.assertRaises(ValidationError):
            schemas.MarketEventAllocationCreate(sku="A-SKU", quantity=0)

    def test_active_allocations_are_immutable_and_close_restores_original_stock(self):
        product = self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 3)])

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(
                    allocations=[
                        schemas.MarketEventAllocationCreate(sku="A-SKU", quantity=5),
                    ],
                ),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 409)
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 3)
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 7)

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(status="Completed"),
            self.db,
            self.user,
        )

        self.db.refresh(product)
        mirror = self.db.query(models.WarehouseStock).filter_by(
            warehouse_id=1,
            sku="A-SKU",
        ).one()
        self.assertEqual(product.warehouse_stock, 10)
        self.assertEqual(mirror.quantity, 10)

    def test_illegal_status_values_and_transitions_are_rejected(self):
        event = self.add_event("Draft", [])

        with self.assertRaises(ValidationError):
            schemas.MarketEventUpdate(status="Paused")

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(status="Completed"),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(event)
        self.assertEqual(event.status, "Draft")

    def test_sale_schema_rejects_empty_and_nonpositive_items(self):
        with self.assertRaises(ValidationError):
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                items=[],
                client_reference="empty-sale-ref",
            )

        with self.assertRaises(ValidationError):
            schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=-1)

    def test_oversell_rolls_back_prior_allocation_deductions_and_sale_rows(self):
        self.add_product("A-SKU", 8)
        self.add_product("B-SKU", 9)
        event = self.add_event("Active", [("A-SKU", 2), ("B-SKU", 1)])
        payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            client_reference="oversell-ref-001",
            items=[
                schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=1),
                schemas.MarketEventSaleItemCreate(sku="B-SKU", quantity=2),
            ],
        )

        with self.assertRaises(HTTPException) as raised:
            record_market_event_sale(event.id, payload, self.db, self.user)

        self.assertEqual(raised.exception.status_code, 409)
        allocations = {
            allocation.sku: allocation.quantity
            for allocation in self.db.query(models.MarketEventAllocation).all()
        }
        self.assertEqual(allocations, {"A-SKU": 2, "B-SKU": 1})
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 0)
        self.assertEqual(self.db.query(models.MarketEventSaleItem).count(), 0)

    def test_sale_consumes_duplicate_sku_allocation_rows_safely(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 1), ("A-SKU", 2)])
        payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            client_reference="duplicate-rows-001",
            items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=2)],
        )

        sale = record_market_event_sale(event.id, payload, self.db, self.user)

        remaining = [
            allocation.quantity
            for allocation in self.db.query(models.MarketEventAllocation)
            .filter_by(event_id=event.id, sku="A-SKU")
            .order_by(models.MarketEventAllocation.id.asc())
            .all()
        ]
        self.assertEqual(remaining, [0, 1])
        self.assertEqual(sale.items[0].quantity, 2)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        self.assertEqual(self.db.query(models.MarketEventSaleItem).count(), 1)

    def test_duplicate_client_reference_returns_original_sale_once(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 3)])
        payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            client_reference="stable-checkout-ref-001",
            items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=1)],
        )

        first = record_market_event_sale(event.id, payload, self.db, self.user)
        event.status = "Completed"
        self.db.commit()
        replay = record_market_event_sale(event.id, payload, self.db, self.user)

        self.assertEqual(replay.id, first.id)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        self.assertEqual(self.db.query(models.MarketEventSaleItem).count(), 1)
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 2)
        markers = self.db.query(models.InventoryTransaction).filter_by(
            transaction_type=models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
        ).all()
        self.assertEqual(len(markers), 1)
        self.assertEqual(markers[0].qty, 0)

    def test_successful_sale_and_undo_atomically_restore_event_stock(self):
        product = self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 3)])
        payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            client_reference="sale-undo-ref-001",
            items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=2)],
        )

        sale = record_market_event_sale(event.id, payload, self.db, self.user)

        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 1)
        self.assertEqual(sale.total_amount, 200)
        self.assertEqual(len(sale.items), 1)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 1)
        self.assertEqual(self.db.query(models.MarketEventSaleItem).count(), 1)
        self.assertEqual(
            self.db.query(models.InventoryTransaction).filter_by(
                transaction_type=models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
            ).count(),
            1,
        )
        self.db.refresh(product)
        mirror = self.db.query(models.WarehouseStock).filter_by(
            warehouse_id=1,
            sku="A-SKU",
        ).one()
        self.assertEqual(product.warehouse_stock, 7)
        self.assertEqual(mirror.quantity, 7)

        undo_market_event_sale(event.id, sale.id, self.db)

        self.db.expire_all()
        restored = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(restored.quantity, 3)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 0)
        self.assertEqual(self.db.query(models.MarketEventSaleItem).count(), 0)
        self.assertEqual(
            self.db.query(models.InventoryTransaction).filter_by(
                transaction_type=models.MARKET_SALE_IDEMPOTENCY_TRANSACTION_TYPE,
            ).count(),
            0,
        )
        restored_product = self.db.query(models.ProductSKU).filter_by(sku="A-SKU").one()
        restored_mirror = self.db.query(models.WarehouseStock).filter_by(
            warehouse_id=1,
            sku="A-SKU",
        ).one()
        self.assertEqual(restored_product.warehouse_stock, 7)
        self.assertEqual(restored_mirror.quantity, 7)

    def test_staff_event_response_redacts_costs_but_keeps_operations_data(self):
        product = self.add_product("A-SKU", 7)
        product.cost_per_unit = 25
        staff = models.User(
            username="staff",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        self.db.add(staff)
        self.db.commit()
        self.add_event("Active", [("A-SKU", 2)])

        staff_event = get_all_market_events(self.db, staff)[0]
        owner_event = get_all_market_events(self.db, self.user)[0]

        self.assertEqual(staff_event.estimated_revenue, 200)
        self.assertIsNone(staff_event.estimated_cost)
        self.assertIsNone(staff_event.potential_profit)
        self.assertIsNone(staff_event.allocations[0].cost_per_unit)
        self.assertFalse(staff_event.financials_visible)
        self.assertEqual(owner_event.estimated_cost, 50)
        self.assertEqual(owner_event.potential_profit, 150)
        self.assertTrue(owner_event.financials_visible)

    def test_active_event_cannot_be_deleted(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 2)])

        with self.assertRaises(HTTPException) as raised:
            delete_market_event(event.id, self.db)

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(event)
        self.assertFalse(event.is_deleted)

    def test_cash_closeout_calculations_and_preorders(self):
        # 1. Test cash closeout updates and calculations on creation
        payload = schemas.MarketEventCreate(
            name="Pop-Up Cash Test",
            event_date="2026-07-13",
            location="Bazaar Tent",
            status="Draft",
            initial_cash_balance=1500.0,
            cash_adjustments=200.0,
            cash_adjustments_notes="Change addition",
            allocations=[
                schemas.MarketEventAllocationCreate(sku="A-SKU", quantity=5),
            ]
        )
        self.add_product("A-SKU", 10)
        event = create_market_event(payload, self.db, self.user)
        self.assertEqual(event.initial_cash_balance, 1500.0)
        self.assertEqual(event.cash_adjustments, 200.0)
        self.assertEqual(event.cash_adjustments_notes, "Change addition")

        # 2. Test preorder checkout recording
        # Activate the event
        update_market_event(event.id, schemas.MarketEventUpdate(status="Active"), self.db, self.user)

        sale_payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=2)],
            client_reference="CLIENT-REF-UUID-12345",
            is_preorder=True,
            preorder_customer_name="Jane Doe",
            preorder_payment_status="Paid",
            preorder_fulfillment_status="Pending"
        )
        sale = record_market_event_sale(event.id, sale_payload, self.db, self.user)
        self.assertTrue(sale.is_preorder)
        self.assertEqual(sale.preorder_customer_name, "Jane Doe")
        self.assertEqual(sale.preorder_payment_status, "Paid")
        self.assertEqual(sale.preorder_fulfillment_status, "Pending")

        # 3. Test preorder payment status update (Do not double count / duplicate)
        update_payload = schemas.MarketEventSaleUpdate(
            preorder_payment_status="Paid",
            preorder_fulfillment_status="Picked Up"
        )
        updated_sale = update_market_event_preorder(event.id, sale.id, update_payload, self.db, self.user)
        self.assertEqual(updated_sale.preorder_fulfillment_status, "Picked Up")
        
        # Verify that SKU allocations were deducted once
        alloc_qty = self.db.query(models.MarketEventAllocation).filter_by(event_id=event.id, sku="A-SKU").first().quantity
        # Allocated 5 initially, checked out 2 as preorder -> remaining should be 3
        self.assertEqual(alloc_qty, 3)


if __name__ == "__main__":
    unittest.main()

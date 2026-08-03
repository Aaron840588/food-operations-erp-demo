import os
import unittest
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base
from app.routers.market_events import (
    compute_event_stats,
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

    def test_active_allocations_can_be_edited_and_syncs_warehouse_stock(self):
        product = self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 3)])

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="A-SKU",
                        remaining_quantity=5,
                    ),
                ],
            ),
            self.db,
            self.user,
        )

        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 5)
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 5)

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(status="Completed", actual_closing_cash=300),
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

    def test_active_edit_requires_explicit_remaining_and_shortage_is_atomic(self):
        product = self.add_product("A-SKU", 2)
        event = self.add_event("Active", [("A-SKU", 1)])

        with self.assertRaises(HTTPException) as legacy_error:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(
                    allocations=[
                        schemas.MarketEventAllocationCreate(
                            sku="A-SKU",
                            quantity=2,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )
        self.assertEqual(legacy_error.exception.status_code, 422)

        with self.assertRaises(HTTPException) as shortage_error:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(
                    allocations=[
                        schemas.MarketEventAllocationUpdate(
                            sku="A-SKU",
                            remaining_quantity=4,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )
        self.assertEqual(shortage_error.exception.status_code, 409)
        self.db.expire_all()
        self.assertEqual(
            self.db.query(models.ProductSKU).filter_by(sku="A-SKU").one().warehouse_stock,
            2,
        )
        self.assertEqual(
            self.db.query(models.MarketEventAllocation)
            .filter_by(event_id=event.id, sku="A-SKU")
            .one()
            .quantity,
            1,
        )
        self.assertEqual(self.db.query(models.InventoryTransaction).count(), 0)

    def test_inactive_existing_allocations_can_only_be_retained_or_reduced(self):
        product = self.add_product("LEGACY-SKU", 2)
        event = self.add_event("Active", [("LEGACY-SKU", 3)])
        product.is_active = False
        self.db.commit()

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="LEGACY-SKU",
                        remaining_quantity=3,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(
            self.db.query(models.MarketEventAllocation)
            .filter_by(event_id=event.id, sku="LEGACY-SKU")
            .one()
            .quantity,
            3,
        )

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="LEGACY-SKU",
                        remaining_quantity=2,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 3)

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(
                    allocations=[
                        schemas.MarketEventAllocationUpdate(
                            sku="LEGACY-SKU",
                            remaining_quantity=3,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("may only be retained or reduced", raised.exception.detail)

    def test_inactive_draft_allocation_can_be_reduced_but_not_increased(self):
        product = self.add_product("LEGACY-DRAFT", 1)
        event = self.add_event("Draft", [("LEGACY-DRAFT", 4)])
        product.is_active = False
        self.db.commit()

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                allocations=[
                    schemas.MarketEventAllocationCreate(
                        sku="LEGACY-DRAFT",
                        quantity=2,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(
            self.db.query(models.MarketEventAllocation)
            .filter_by(event_id=event.id, sku="LEGACY-DRAFT")
            .one()
            .quantity,
            2,
        )

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(
                    allocations=[
                        schemas.MarketEventAllocationCreate(
                            sku="LEGACY-DRAFT",
                            quantity=3,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("may only be retained or reduced", raised.exception.detail)

    def test_active_edit_preserves_sold_rows_and_uses_remaining_balance(self):
        product = self.add_product("A-SKU", 10)
        event = self.add_event("Active", [("A-SKU", 2)])
        record_market_event_sale(
            event.id,
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                cash_received=200,
                expected_subtotal=100,
                client_reference="preserve-sold-row-001",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="A-SKU",
                        quantity=1,
                    ),
                ],
            ),
            self.db,
            self.user,
        )

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(allocations=[]),
            self.db,
            self.user,
        )
        self.db.expire_all()
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 0)
        self.assertEqual(
            self.db.query(models.ProductSKU).filter_by(sku="A-SKU").one().warehouse_stock,
            11,
        )

        update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="A-SKU",
                        remaining_quantity=3,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.db.expire_all()
        self.assertEqual(
            self.db.query(models.MarketEventAllocation)
            .filter_by(event_id=event.id, sku="A-SKU")
            .one()
            .quantity,
            3,
        )
        self.assertEqual(
            self.db.query(models.ProductSKU).filter_by(sku="A-SKU").one().warehouse_stock,
            8,
        )

    def test_event_update_requires_owner_or_explicitly_assigned_active_staff(self):
        self.add_product("A-SKU", 5)
        event = self.add_event("Active", [("A-SKU", 1)])
        event.staff_assigned = "alice"
        alice = models.User(
            username="alice",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        bob = models.User(
            username="bob",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        self.db.add_all([alice, bob])
        self.db.commit()

        with self.assertRaises(HTTPException) as unassigned_error:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(notes="unauthorized"),
                self.db,
                bob,
            )
        self.assertEqual(unassigned_error.exception.status_code, 403)

        updated = update_market_event(
            event.id,
            schemas.MarketEventUpdate(notes="authorized"),
            self.db,
            alice,
        )
        self.assertEqual(updated.notes, "authorized")
        with self.assertRaises(HTTPException) as assignment_error:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(staff_assigned="alice, bob"),
                self.db,
                alice,
            )
        self.assertEqual(assignment_error.exception.status_code, 403)

        draft = self.add_event("Draft", [("A-SKU", 1)])
        draft.staff_assigned = "alice"
        self.db.commit()
        with self.assertRaises(HTTPException) as draft_error:
            update_market_event(
                draft.id,
                schemas.MarketEventUpdate(notes="not allowed"),
                self.db,
                alice,
            )
        self.assertEqual(draft_error.exception.status_code, 403)

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
            cash_received=500,
            expected_subtotal=300,
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
            cash_received=500,
            expected_subtotal=200,
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
            cash_received=500,
            expected_subtotal=100,
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

    def test_cash_sale_requires_sufficient_tender_and_returns_server_change(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 2)])

        with self.assertRaises(HTTPException) as raised:
            record_market_event_sale(
                event.id,
                schemas.MarketEventSaleCreate(
                    payment_method="Cash",
                    cash_received=50,
                    expected_subtotal=100,
                    client_reference="insufficient-cash-ref",
                    items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=1)],
                ),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 422)
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 2)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 0)

        sale = record_market_event_sale(
            event.id,
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                cash_received=150,
                expected_subtotal=100,
                client_reference="sufficient-cash-ref",
                items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=1)],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(sale.cash_received, 150)
        self.assertEqual(sale.change_given, 50)

    def test_subtotal_mismatch_and_invalid_manual_discount_do_not_mutate_stock(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 2)])

        with self.assertRaises(ValidationError):
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="A-SKU",
                        quantity=1,
                    ),
                ],
                client_reference="invalid-discount-ref",
                expected_subtotal=100,
                discount_type="PERCENTAGE",
                discount_value=101,
            )

        with self.assertRaises(HTTPException) as mismatch_error:
            record_market_event_sale(
                event.id,
                schemas.MarketEventSaleCreate(
                    payment_method="Cash",
                    cash_received=200,
                    expected_subtotal=99,
                    client_reference="subtotal-mismatch-001",
                    items=[
                        schemas.MarketEventSaleItemCreate(
                            sku="A-SKU",
                            quantity=1,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )
        self.assertEqual(mismatch_error.exception.status_code, 409)
        self.assertEqual(
            mismatch_error.exception.detail["code"],
            "SALE_SUBTOTAL_MISMATCH",
        )
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 2)
        self.assertEqual(self.db.query(models.MarketEventSale).count(), 0)

    def test_fixed_promotions_manual_discount_and_tip_are_snapshotted(self):
        for sku, price in (
            ("GCP-A", 100),
            ("GCP-B", 100),
            ("TPP-A", 150),
            ("BMC-A", 150),
            ("OTHER-A", 80),
        ):
            self.add_product(sku, 10, price=price)

        cases = [
            (
                "CLASSIC_DUO",
                [("GCP-A", 1), ("GCP-B", 1)],
                Decimal("200.00"),
                Decimal("35.00"),
                Decimal("165.00"),
            ),
            (
                "SIGNATURE_DUO",
                [("TPP-A", 1), ("BMC-A", 1)],
                Decimal("300.00"),
                Decimal("55.00"),
                Decimal("245.00"),
            ),
            (
                "COMBO_DUO",
                [("GCP-A", 1), ("TPP-A", 1)],
                Decimal("250.00"),
                Decimal("40.00"),
                Decimal("210.00"),
            ),
            (
                "B1T1",
                [("GCP-A", 1), ("OTHER-A", 1)],
                Decimal("180.00"),
                Decimal("80.00"),
                Decimal("100.00"),
            ),
        ]

        for index, (
            promotion_code,
            items,
            subtotal,
            promotion_discount,
            net,
        ) in enumerate(cases, start=1):
            event = self.add_event("Active", items)
            sale = record_market_event_sale(
                event.id,
                schemas.MarketEventSaleCreate(
                    payment_method="GCash",
                    expected_subtotal=subtotal,
                    promotion_code=promotion_code,
                    client_reference=f"promotion-snapshot-{index}",
                    items=[
                        schemas.MarketEventSaleItemCreate(
                            sku=sku,
                            quantity=quantity,
                        )
                        for sku, quantity in items
                    ],
                ),
                self.db,
                self.user,
            )
            self.assertEqual(sale.subtotal_amount, subtotal)
            self.assertEqual(
                sale.promotion_discount_amount,
                promotion_discount,
            )
            self.assertEqual(sale.total_amount, net)
            self.assertEqual(sale.promotion_code, promotion_code)
            self.assertIn(f'"code":"{promotion_code}"', sale.promotion_snapshot)

        discount_event = self.add_event(
            "Active",
            [("GCP-A", 1), ("GCP-B", 1)],
        )
        discounted_sale = record_market_event_sale(
            discount_event.id,
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                cash_received=200,
                tip_amount=10,
                expected_subtotal=200,
                promotion_code="CLASSIC_DUO",
                discount_type="FIXED",
                discount_value=5,
                client_reference="promotion-manual-tip-001",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="GCP-A",
                        quantity=1,
                    ),
                    schemas.MarketEventSaleItemCreate(
                        sku="GCP-B",
                        quantity=1,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(discounted_sale.subtotal_amount, Decimal("200.00"))
        self.assertEqual(
            discounted_sale.promotion_discount_amount,
            Decimal("35.00"),
        )
        self.assertEqual(
            discounted_sale.manual_discount_amount,
            Decimal("5.00"),
        )
        self.assertEqual(discounted_sale.discount_amount, Decimal("40.00"))
        self.assertEqual(discounted_sale.total_amount, Decimal("160.00"))
        self.assertEqual(discounted_sale.tip_amount, Decimal("10.00"))
        self.assertEqual(discounted_sale.change_given, Decimal("30.00"))

        persisted = self.db.query(models.MarketEventSale).filter_by(
            id=discounted_sale.id
        ).one()
        self.assertEqual(persisted.total_amount, Decimal("160.00"))
        self.assertEqual(persisted.discount_amount, Decimal("40.00"))

    def test_complimentary_pautang_and_mixed_accounting_are_explicit(self):
        self.add_product("A-SKU", 10)

        complimentary_event = self.add_event("Active", [("A-SKU", 1)])
        complimentary = record_market_event_sale(
            complimentary_event.id,
            schemas.MarketEventSaleCreate(
                payment_method="Complimentary / Gift",
                expected_subtotal=100,
                client_reference="complimentary-sale-001",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="A-SKU",
                        quantity=1,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(complimentary.subtotal_amount, Decimal("100.00"))
        self.assertEqual(complimentary.discount_amount, Decimal("100.00"))
        self.assertEqual(complimentary.total_amount, Decimal("0.00"))
        self.assertFalse(complimentary.is_collected)

        pautang_event = self.add_event("Active", [("A-SKU", 2)])
        with self.assertRaises(HTTPException) as customer_error:
            record_market_event_sale(
                pautang_event.id,
                schemas.MarketEventSaleCreate(
                    payment_method="Pautang",
                    expected_subtotal=100,
                    client_reference="pautang-no-customer",
                    items=[
                        schemas.MarketEventSaleItemCreate(
                            sku="A-SKU",
                            quantity=1,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )
        self.assertEqual(customer_error.exception.status_code, 422)

        pautang = record_market_event_sale(
            pautang_event.id,
            schemas.MarketEventSaleCreate(
                payment_method="Pautang",
                customer_name="Customer One",
                expected_subtotal=100,
                client_reference="pautang-customer-001",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="A-SKU",
                        quantity=1,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(pautang.customer_name, "Customer One")
        self.assertEqual(pautang.total_amount, Decimal("100.00"))
        self.assertIsNone(pautang.cash_received)
        self.assertFalse(pautang.is_collected)
        accounting = compute_event_stats(pautang_event, self.db, True)
        self.assertEqual(accounting.payment_breakdown["Pautang"], 100)
        self.assertEqual(accounting.cash_sales, 0)
        self.assertEqual(accounting.estimated_revenue, 100)

        with self.assertRaises(HTTPException) as mixed_error:
            record_market_event_sale(
                pautang_event.id,
                schemas.MarketEventSaleCreate(
                    payment_method="Mixed",
                    expected_subtotal=100,
                    client_reference="mixed-without-tenders-001",
                    items=[
                        schemas.MarketEventSaleItemCreate(
                            sku="A-SKU",
                            quantity=1,
                        ),
                    ],
                ),
                self.db,
                self.user,
            )
        self.assertEqual(mixed_error.exception.status_code, 422)
        remaining = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=pautang_event.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(remaining.quantity, 1)

    def test_successful_sale_and_undo_atomically_restore_event_stock(self):
        product = self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 3)])
        payload = schemas.MarketEventSaleCreate(
            payment_method="Cash",
            cash_received=500,
            expected_subtotal=200,
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

    def test_staff_event_response_redacts_financials_but_keeps_pos_data(self):
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
        event = self.add_event("Active", [("A-SKU", 2)])
        event.staff_assigned = "STAFF"
        event.initial_cash_balance = 300
        event.cash_expenses = 10
        self.db.commit()

        staff_event = get_all_market_events(self.db, staff)[0]
        owner_event = get_all_market_events(self.db, self.user)[0]

        self.assertEqual(staff_event.estimated_revenue, 200)
        self.assertIsNone(staff_event.estimated_cost)
        self.assertIsNone(staff_event.potential_profit)
        self.assertIsNone(staff_event.allocations[0].cost_per_unit)
        self.assertEqual(staff_event.allocations[0].retail_price, 100)
        self.assertEqual(staff_event.allocations[0].current_stock, 7)
        self.assertIsNone(staff_event.opening_float)
        self.assertIsNone(staff_event.cash_sales)
        self.assertIsNone(staff_event.ending_cashbox_balance)
        self.assertIsNone(staff_event.digital_sales_total)
        self.assertIsNone(staff_event.payment_breakdown)
        self.assertIsNone(staff_event.food_waste_cost)
        self.assertFalse(staff_event.financials_visible)
        self.assertEqual(owner_event.estimated_cost, 50)
        self.assertEqual(owner_event.potential_profit, 150)
        self.assertTrue(owner_event.financials_visible)

    def test_closeout_derives_cashbox_waste_and_reconciled_digital_totals(self):
        product = self.add_product("A-SKU", 20)
        product.cost_per_unit = 20
        event = self.add_event("Active", [("A-SKU", 6)])
        event.initial_cash_balance = 500
        self.db.commit()

        for index, payment_method in enumerate(
            ["Cash", "Cash", "GCash", "BPI / Bank Transfer", "Card"],
            start=1,
        ):
            record_market_event_sale(
                event.id,
                schemas.MarketEventSaleCreate(
                    payment_method=payment_method,
                    cash_received=500 if payment_method == "Cash" else None,
                    tip_amount=(
                        25
                        if index == 1
                        else 30
                        if payment_method == "GCash"
                        else None
                    ),
                    expected_subtotal=100,
                    client_reference=f"closeout-payment-{index}",
                    items=[schemas.MarketEventSaleItemCreate(sku="A-SKU", quantity=1)],
                ),
                self.db,
                self.user,
            )

        result = update_market_event(
            event.id,
            schemas.MarketEventUpdate(
                status="Completed",
                actual_closing_cash=650,
                cash_expenses=50,
                cash_refunds=25,
                gcash_sales=150,
                bpi_sales=0,
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="A-SKU",
                        quantity=1,
                        wasted_quantity=1,
                        waste_reason="Damaged / Leaked",
                    ),
                ],
            ),
            self.db,
            self.user,
        )

        self.assertEqual(result.cash_sales, 200)
        self.assertEqual(result.total_tips, 55)
        # Only the PHP 25 Cash tip belongs in the physical drawer. The PHP 30
        # GCash tip remains in total tips but must not inflate expected cash.
        self.assertEqual(result.ending_cashbox_balance, 650)
        self.assertEqual(result.payment_breakdown["GCash"], 100)
        self.assertEqual(result.payment_breakdown["BPI / Bank Transfer"], 100)
        self.assertEqual(result.payment_breakdown["Card"], 100)
        # Entered GCash overrides its POS amount; explicit zero BPI remains zero.
        # Card is included from the POS ledger; explicit BPI zero remains zero.
        self.assertEqual(result.digital_sales_total, 250)
        self.assertEqual(result.food_waste_quantity, 1)
        self.assertEqual(result.food_leftover_quantity, 0)
        self.assertEqual(result.food_waste_cost, 20)
        self.assertEqual(result.estimated_revenue, 475)
        self.assertEqual(result.estimated_cost, 120)
        self.assertEqual(result.potential_profit, 305)
        waste_entry = self.db.query(models.InventoryTransaction).filter_by(
            transaction_type="waste",
            sku="A-SKU",
        ).one()
        self.assertEqual(waste_entry.qty, -1)
        self.assertEqual(
            self.db.query(models.InventoryTransaction).filter_by(
                transaction_type="manual_adjustment",
                sku="A-SKU",
                qty=0,
            ).count(),
            0,
        )

    def test_closeout_rejects_invalid_waste_without_changing_stock(self):
        product = self.add_product("A-SKU", 8)
        event = self.add_event("Active", [("A-SKU", 1)])

        for wasted_quantity, waste_reason in ((2, "Spoiled"), (1, "")):
            with self.assertRaises(HTTPException) as raised:
                update_market_event(
                    event.id,
                    schemas.MarketEventUpdate(
                        status="Completed",
                        allocations=[
                            schemas.MarketEventAllocationUpdate(
                                sku="A-SKU",
                                quantity=1,
                                wasted_quantity=wasted_quantity,
                                waste_reason=waste_reason,
                            ),
                        ],
                    ),
                    self.db,
                    self.user,
                )
            self.assertEqual(raised.exception.status_code, 422)
            self.db.refresh(event)
            self.db.refresh(product)
            self.assertEqual(event.status, "Active")
            self.assertEqual(product.warehouse_stock, 8)
            allocation = self.db.query(models.MarketEventAllocation).filter_by(
                event_id=event.id,
                sku="A-SKU",
            ).one()
            self.assertEqual(allocation.quantity, 1)
            self.assertEqual(allocation.wasted_quantity, 0)

    def test_draft_active_sale_closeout_lifecycle_moves_each_unit_once(self):
        product = self.add_product("A-SKU", 20)
        created = create_market_event(
            schemas.MarketEventCreate(
                name="Lifecycle Market",
                event_date="2026-07-27",
                location="Test Venue",
                status="Draft",
                allocations=[
                    schemas.MarketEventAllocationCreate(
                        sku="A-SKU",
                        quantity=10,
                    ),
                ],
            ),
            self.db,
            self.user,
        )

        update_market_event(
            created.id,
            schemas.MarketEventUpdate(status="Active"),
            self.db,
            self.user,
        )
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 10)

        sale = record_market_event_sale(
            created.id,
            schemas.MarketEventSaleCreate(
                payment_method="Cash",
                cash_received=300,
                tip_amount=5,
                expected_subtotal=200,
                client_reference="full-lifecycle-sale-001",
                items=[
                    schemas.MarketEventSaleItemCreate(
                        sku="A-SKU",
                        quantity=2,
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(sale.total_amount, Decimal("200.00"))
        allocation = self.db.query(models.MarketEventAllocation).filter_by(
            event_id=created.id,
            sku="A-SKU",
        ).one()
        self.assertEqual(allocation.quantity, 8)

        completed = update_market_event(
            created.id,
            schemas.MarketEventUpdate(
                status="Completed",
                actual_closing_cash=205,
                allocations=[
                    schemas.MarketEventAllocationUpdate(
                        sku="A-SKU",
                        wasted_quantity=1,
                        waste_reason="Damaged",
                    ),
                ],
            ),
            self.db,
            self.user,
        )
        self.assertEqual(completed.status, "Completed")
        self.db.expire_all()
        self.assertEqual(
            self.db.query(models.ProductSKU).filter_by(sku="A-SKU").one().warehouse_stock,
            17,
        )
        self.assertEqual(
            self.db.query(models.WarehouseStock)
            .filter_by(warehouse_id=1, sku="A-SKU")
            .one()
            .quantity,
            17,
        )

        with self.assertRaises(HTTPException) as undo_error:
            undo_market_event_sale(created.id, sale.id, self.db)
        self.assertEqual(undo_error.exception.status_code, 409)
        self.assertEqual(
            self.db.query(models.MarketEventSale).filter_by(id=sale.id).count(),
            1,
        )

    def test_active_event_cannot_be_deleted_without_reconciliation(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 2)])

        with self.assertRaises(HTTPException) as raised:
            delete_market_event(event.id, self.db)

        self.db.refresh(event)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertFalse(event.is_deleted)

    def test_completion_requires_a_physical_cash_count(self):
        self.add_product("A-SKU", 7)
        event = self.add_event("Active", [("A-SKU", 2)])

        with self.assertRaises(HTTPException) as raised:
            update_market_event(
                event.id,
                schemas.MarketEventUpdate(status="Completed"),
                self.db,
                self.user,
            )

        self.assertEqual(raised.exception.status_code, 422)
        self.assertIn("physical closing cash", raised.exception.detail)
        self.db.refresh(event)
        self.assertEqual(event.status, "Active")

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
            cash_received=500,
            expected_subtotal=200,
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

    def test_create_recurring_market_events(self):
        # Create a weekly recurring event series (3 occurrences)
        payload = schemas.MarketEventCreate(
            name="Recurring Weekly Market",
            event_date="2026-07-20",
            location="Elbi",
            status="Draft",
            initial_cash_balance=1000.0,
            allocations=[
                schemas.MarketEventAllocationCreate(sku="A-SKU", quantity=2),
            ],
            recurrence="weekly",
            recurrence_count=3
        )
        self.add_product("A-SKU", 10)
        
        event = create_market_event(payload, self.db, self.user)
        self.assertEqual(event.name, "Recurring Weekly Market")
        self.assertEqual(event.event_date, "2026-07-20")
        
        # Verify that three events exist in the database with this name
        events = self.db.query(models.MarketEvent).filter_by(
            name="Recurring Weekly Market",
            is_deleted=False
        ).order_by(models.MarketEvent.event_date).all()
        
        self.assertEqual(len(events), 3)
        
        # Check first event
        self.assertEqual(events[0].event_date, "2026-07-20")
        self.assertEqual(len(events[0].allocations), 1)
        self.assertEqual(events[0].allocations[0].sku, "A-SKU")
        self.assertEqual(events[0].allocations[0].quantity, 2)
        
        # Check second event
        self.assertEqual(events[1].event_date, "2026-07-27")
        self.assertEqual(events[1].status, "Draft")
        self.assertEqual(len(events[1].allocations), 0)
        
        # Check third event
        self.assertEqual(events[2].event_date, "2026-08-03")
        self.assertEqual(events[2].status, "Draft")
        self.assertEqual(len(events[2].allocations), 0)


if __name__ == "__main__":
    unittest.main()

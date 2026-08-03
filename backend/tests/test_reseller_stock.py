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
from app.routers.reseller import create_reseller_order


class ResellerStockTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.user = models.User(
            username="owner",
            hashed_password="test-only",
            role="owner",
            is_active=True,
        )
        self.db.add_all([
            self.user,
            models.Warehouse(id=1, name="Main Facility"),
            models.DiscountTier(min_subtotal=0, discount_percentage=10),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_product(self, stock):
        product = models.ProductSKU(
            sku="TEST-SKU",
            product_name="Test Product",
            category="Spreads & Sauces",
            size="Sampler",
            retail_price=100,
            reseller_price=90,
            warehouse_stock=stock,
        )
        self.db.add(product)
        self.db.add(models.WarehouseStock(
            warehouse_id=1,
            sku="TEST-SKU",
            quantity=stock,
        ))
        self.db.commit()
        return product

    def payload(self, quantity):
        return schemas.ResellerOrderCreate(
            reseller_name="Audit Customer",
            order_date="2026-07-13",
            items=[schemas.ResellerOrderItemCreate(sku="TEST-SKU", quantity=quantity)],
        )

    def test_zero_stock_order_is_rejected_without_writes(self):
        product = self.add_product(0)

        with self.assertRaises(HTTPException) as raised:
            create_reseller_order(self.payload(1), self.db, self.user)

        self.assertEqual(raised.exception.status_code, 409)
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 0)
        self.assertEqual(self.db.query(models.ResellerOrder).count(), 0)
        self.assertEqual(self.db.query(models.ResellerOrderItem).count(), 0)
        self.assertEqual(self.db.query(models.InventoryTransaction).count(), 0)
        self.assertEqual(self.db.query(models.ProductionBatch).count(), 0)

    def test_successful_order_updates_all_linked_records_once(self):
        product = self.add_product(1)

        order = create_reseller_order(self.payload(1), self.db, self.user)

        self.db.refresh(product)
        warehouse_stock = self.db.query(models.WarehouseStock).filter_by(
            warehouse_id=1,
            sku="TEST-SKU",
        ).one()
        self.assertEqual(product.warehouse_stock, 0)
        self.assertEqual(warehouse_stock.quantity, 0)
        self.assertAlmostEqual(order.grand_total, 90.0)
        self.assertEqual(self.db.query(models.ResellerOrder).count(), 1)
        self.assertEqual(self.db.query(models.ResellerOrderItem).count(), 1)
        self.assertEqual(self.db.query(models.InventoryTransaction).count(), 1)
        self.assertEqual(self.db.query(models.ProductionBatch).count(), 1)

    def test_owner_manual_discount_is_explicit_and_bounded(self):
        self.add_product(1)
        payload = self.payload(1)
        payload.manual_discount_percentage = 20

        order = create_reseller_order(payload, self.db, self.user)

        self.assertEqual(order.discount_percentage, 20)
        self.assertAlmostEqual(order.grand_total, 80.0)

        with self.assertRaises(ValidationError):
            schemas.ResellerOrderCreate(
                reseller_name="Audit Customer",
                order_date="2026-07-13",
                items=[schemas.ResellerOrderItemCreate(sku="TEST-SKU", quantity=1)],
                manual_discount_percentage=101,
            )

    def test_staff_cannot_override_discount_and_stock_is_unchanged(self):
        product = self.add_product(1)
        staff = models.User(
            username="staff",
            hashed_password="test-only",
            role="staff",
            is_active=True,
        )
        self.db.add(staff)
        self.db.commit()
        payload = self.payload(1)
        payload.manual_discount_percentage = 20

        with self.assertRaises(HTTPException) as raised:
            create_reseller_order(payload, self.db, staff)

        self.assertEqual(raised.exception.status_code, 403)
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 1)
        self.assertEqual(self.db.query(models.ResellerOrder).count(), 0)

    def test_notes_cannot_override_discount_and_tax_is_bounded(self):
        self.add_product(1)
        payload = self.payload(1)
        payload.notes = "OVERRIDE_DISCOUNT:100"

        order = create_reseller_order(payload, self.db, self.user)

        self.assertEqual(order.discount_percentage, 10)
        self.assertAlmostEqual(order.grand_total, 90.0)

        with self.assertRaises(ValidationError):
            schemas.ResellerOrderCreate(
                reseller_name="Audit Customer",
                order_date="2026-07-13",
                items=[schemas.ResellerOrderItemCreate(sku="TEST-SKU", quantity=1)],
                tax_rate=-1,
            )


if __name__ == "__main__":
    unittest.main()

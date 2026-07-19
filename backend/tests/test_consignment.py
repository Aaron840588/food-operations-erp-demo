import os
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base
from app.routers.consignment import record_consignment_delivery


class ConsignmentTests(unittest.TestCase):
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
            models.ConsignmentPartner(id=1, name="Store A"),
        ])
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_product(self, sku, stock):
        product = models.ProductSKU(
            sku=sku,
            product_name="Test Product " + sku,
            category="Spreads & Sauces",
            size="Sampler",
            retail_price=100,
            reseller_price=90,
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

    def test_record_consignment_delivery_insufficient_stock_fails(self):
        self.add_product("SKU-1", 5)
        payload = schemas.ConsignmentDeliveryCreate(
            partner_id=1,
            delivery_date="2026-07-16",
            dr_number="DR-101",
            items=[schemas.ProductionTargetBase(sku="SKU-1", target_qty=10, outlet="Consignment")]
        )

        with self.assertRaises(HTTPException) as raised:
            record_consignment_delivery(payload, self.db, self.user)

        self.assertEqual(raised.exception.status_code, 400)
        self.assertIn("Insufficient stock", raised.exception.detail)

    def test_record_consignment_delivery_success(self):
        product = self.add_product("SKU-1", 15)
        payload = schemas.ConsignmentDeliveryCreate(
            partner_id=1,
            delivery_date="2026-07-16",
            dr_number="DR-101",
            items=[schemas.ProductionTargetBase(sku="SKU-1", target_qty=10, outlet="Consignment")]
        )

        delivery = record_consignment_delivery(payload, self.db, self.user)

        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 5)
        self.assertEqual(self.db.query(models.ConsignmentDelivery).count(), 1)
        self.assertEqual(self.db.query(models.ConsignmentItem).count(), 1)

if __name__ == "__main__":
    unittest.main()

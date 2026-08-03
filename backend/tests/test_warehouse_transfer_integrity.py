import os
import unittest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models, schemas
from app.database import Base, sync_warehouse_stock_for_main_facility
from app.main import transfer_warehouse_inventory


class WarehouseTransferIntegrityTests(unittest.TestCase):
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

        self.wh1 = models.Warehouse(id=1, name="Main Facility")
        self.wh2 = models.Warehouse(id=2, name="Secondary Warehouse")

        self.product = models.ProductSKU(
            sku="SKU-TRANSFER-TEST",
            product_name="Transfer Test Spread",
            category="Spreads & Sauces",
            size="240g",
            retail_price=200,
            reseller_price=150,
            warehouse_stock=20,
        )

        self.ingredient = models.RawIngredient(
            id=10,
            name="Test Sugar",
            category="Ingredients",
            unit="kg",
            price=50.0,
            net_weight=1000.0,
            available_stock=50,
        )

        self.db.add_all([
            self.owner,
            self.wh1,
            self.wh2,
            self.product,
            self.ingredient,
        ])
        self.db.commit()

        # Initial sync
        sync_warehouse_stock_for_main_facility(self.db, sku=self.product.sku)
        sync_warehouse_stock_for_main_facility(self.db, raw_ingredient_id=self.ingredient.id)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def test_main_facility_as_transfer_source(self):
        """A. Main Facility (WH1) -> Secondary (WH2) transfer"""
        payload = schemas.WarehouseTransferRequest(
            source_warehouse_id=1,
            destination_warehouse_id=2,
            item_type="product",
            sku="SKU-TRANSFER-TEST",
            quantity=5,
        )
        res = transfer_warehouse_inventory(payload, self.owner, self.db)
        self.assertIn("Successfully transferred 5", res["detail"])

        self.product = self.db.query(models.ProductSKU).filter_by(sku="SKU-TRANSFER-TEST").first()
        wh1_stock = self.db.query(models.WarehouseStock).filter_by(warehouse_id=1, sku="SKU-TRANSFER-TEST").first()
        wh2_stock = self.db.query(models.WarehouseStock).filter_by(warehouse_id=2, sku="SKU-TRANSFER-TEST").first()

        # ProductSKU.warehouse_stock must be 15
        self.assertEqual(self.product.warehouse_stock, 15)
        # Main Facility warehouse_stocks row must equal ProductSKU.warehouse_stock (15)
        self.assertEqual(wh1_stock.quantity, 15)
        # Secondary warehouse must have 5
        self.assertEqual(wh2_stock.quantity, 5)

        # Confirm audit ledger
        tx_logs = self.db.query(models.InventoryTransaction).filter_by(sku="SKU-TRANSFER-TEST").all()
        self.assertEqual(len(tx_logs), 2)  # 1 deduction (-5), 1 addition (+5)

    def test_main_facility_as_transfer_destination(self):
        """B. Secondary (WH2) -> Main Facility (WH1) transfer"""
        # First put 10 units in WH2
        wh2_stock = models.WarehouseStock(warehouse_id=2, sku="SKU-TRANSFER-TEST", quantity=10)
        self.db.add(wh2_stock)
        self.db.commit()

        payload = schemas.WarehouseTransferRequest(
            source_warehouse_id=2,
            destination_warehouse_id=1,
            item_type="product",
            sku="SKU-TRANSFER-TEST",
            quantity=4,
        )
        res = transfer_warehouse_inventory(payload, self.owner, self.db)
        self.assertIn("Successfully transferred 4", res["detail"])

        self.product = self.db.query(models.ProductSKU).filter_by(sku="SKU-TRANSFER-TEST").first()
        wh1_stock = self.db.query(models.WarehouseStock).filter_by(warehouse_id=1, sku="SKU-TRANSFER-TEST").first()

        # ProductSKU.warehouse_stock increases from 20 to 24
        self.assertEqual(self.product.warehouse_stock, 24)
        # Synchronized WH1 stock equals 24
        self.assertEqual(wh1_stock.quantity, 24)

    def test_insufficient_stock_rejection(self):
        """E. Insufficient stock transfer rejection"""
        payload = schemas.WarehouseTransferRequest(
            source_warehouse_id=1,
            destination_warehouse_id=2,
            item_type="product",
            sku="SKU-TRANSFER-TEST",
            quantity=999,  # Only 20 available
        )
        with self.assertRaises(HTTPException) as ctx:
            transfer_warehouse_inventory(payload, self.owner, self.db)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("Insufficient stock", ctx.exception.detail)

        # Verify stock remains unchanged at 20
        self.product = self.db.query(models.ProductSKU).filter_by(sku="SKU-TRANSFER-TEST").first()
        self.assertEqual(self.product.warehouse_stock, 20)


if __name__ == "__main__":
    unittest.main()

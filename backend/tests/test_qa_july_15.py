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
from app.routers.consignment import record_consignment_delivery
from app.routers.reseller import create_reseller_order, delete_reseller_order
from app.routers.market_events import create_market_event
from app.routers.costing import update_sku_recipe

class QAJuly15Tests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()
        self.user_owner = models.User(
            username="owner",
            hashed_password="hashed-password",
            role="owner",
            is_active=True,
        )
        self.db.add(self.user_owner)
        self.db.add(models.Warehouse(id=1, name="Main Facility"))
        self.db.commit()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_product(self, sku, stock, price=100.0):
        product = models.ProductSKU(
            sku=sku,
            product_name="Product " + sku,
            category="Spreads & Sauces",
            size="Indulge",
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

    def test_consignment_stock_deduction_and_insufficient_stock(self):
        # 1. Setup product and partner
        self.add_product("SKU-CONS", 10, 100.0)
        partner = models.ConsignmentPartner(id=1, name="Partner Store")
        self.db.add(partner)
        self.db.commit()

        # 2. Insufficient stock should fail
        payload_fail = schemas.ConsignmentDeliveryCreate(
            partner_id=1,
            delivery_date="2026-07-16",
            dr_number="DR-FAIL",
            items=[schemas.ProductionTargetBase(sku="SKU-CONS", target_qty=12, outlet="Consignment")]
        )
        with self.assertRaises(HTTPException) as context:
            record_consignment_delivery(payload_fail, self.db, self.user_owner)
        self.assertEqual(context.exception.status_code, 400)

        # 3. Successful deduction
        payload_success = schemas.ConsignmentDeliveryCreate(
            partner_id=1,
            delivery_date="2026-07-16",
            dr_number="DR-SUCCESS",
            items=[schemas.ProductionTargetBase(sku="SKU-CONS", target_qty=3, outlet="Consignment")]
        )
        delivery = record_consignment_delivery(payload_success, self.db, self.user_owner)
        self.assertEqual(delivery.dr_number, "DR-SUCCESS")

        # Verify stock deducted
        product = self.db.query(models.ProductSKU).filter_by(sku="SKU-CONS").one()
        self.assertEqual(product.warehouse_stock, 7)

        # Verify transaction logged
        tx = self.db.query(models.InventoryTransaction).filter_by(sku="SKU-CONS").one()
        self.assertEqual(tx.qty, -3.0)

    def test_market_event_creation(self):
        self.add_product("SKU-MKT", 15, 100.0)
        payload = schemas.MarketEventCreate(
            name="Weekend Bazaar",
            event_date="2026-07-16",
            location="BGC",
            allocations=[schemas.MarketEventAllocationCreate(sku="SKU-MKT", quantity=5)]
        )
        event = create_market_event(payload, self.db, self.user_owner)
        self.assertEqual(event.name, "Weekend Bazaar")
        self.assertEqual(len(event.allocations), 1)
        self.assertEqual(event.allocations[0].quantity, 5)

    def test_full_recipe_replacement(self):
        product = self.add_product("SKU-REC", 5, 100.0)
        # Add basic recipe
        recipe = models.Recipe(sku="SKU-REC", yield_weight=100.0, portion_size=10.0)
        self.db.add(recipe)
        self.db.commit()

        payload = schemas.RecipeUpdate(
            yield_weight=200.0,
            yield_unit="g",
            portion_size=20.0,
            portion_unit="g",
            notes="Updated recipe",
            ingredients=[]
        )
        updated = update_sku_recipe("SKU-REC", payload, self.db, self.user_owner)
        self.assertEqual(updated.yield_weight, 200.0)
        self.assertEqual(updated.portion_size, 20.0)

    def test_order_invoice_data_and_vat_inclusive(self):
        self.add_product("SKU-RESELL", 10, 100.0)
        # Create reseller order with 18% manual discount
        payload = schemas.ResellerOrderCreate(
            reseller_name="John Reseller",
            order_date="2026-07-16",
            items=[schemas.ResellerOrderItemCreate(sku="SKU-RESELL", quantity=1)],
            tax_rate=12.0,
            manual_discount_percentage=18
        )
        order = create_reseller_order(payload, self.db, self.user_owner)
        
        # Subtotal: 100
        # Discount: 18% of 100 = 18.0
        # Discounted subtotal: 82.0
        # Grand Total: 82.0 (VAT-inclusive!)
        # Tax component: 82.0 * 12 / 112 = 8.7857
        self.assertAlmostEqual(order.subtotal, 100.0)
        self.assertAlmostEqual(order.discount_percentage, 18.0)
        self.assertAlmostEqual(order.discount_amount, 18.0)
        self.assertAlmostEqual(order.grand_total, 82.0)
        self.assertAlmostEqual(order.tax_amount, 82.0 * 12 / 112)

    def test_delete_reseller_order_restores_stock(self):
        product = self.add_product("SKU-DEL", 10, 100.0)
        payload = schemas.ResellerOrderCreate(
            reseller_name="John Reseller",
            order_date="2026-07-16",
            items=[schemas.ResellerOrderItemCreate(sku="SKU-DEL", quantity=3)],
            tax_rate=12.0
        )
        order = create_reseller_order(payload, self.db, self.user_owner)
        
        # Stock should be 7
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 7)
        
        # Delete order
        res = delete_reseller_order(order.id, self.db, self.user_owner)
        self.assertIn("Successfully deleted", res["message"])
        
        # Stock should be restored to 10
        self.db.refresh(product)
        self.assertEqual(product.warehouse_stock, 10)
        
        # Verify transaction logged
        tx = self.db.query(models.InventoryTransaction).filter_by(sku="SKU-DEL", transaction_type="sales_return").one()
        self.assertEqual(tx.qty, 3.0)

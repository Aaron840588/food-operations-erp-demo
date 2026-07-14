import os
import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-only-jwt-secret-at-least-32-bytes")

from app import models
from app.database import Base
from app.routers.costing import get_profit_margin_analysis
from app.routers.market_events import compute_event_stats, get_market_events_analytics
from app.services.costing_service import CostingService


class FinancialValidityTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        CostingService.clear_costing_cache()

    def tearDown(self):
        CostingService.clear_costing_cache()
        self.db.close()
        self.engine.dispose()

    def add_product(self, sku="TEST-SKU", cost=0):
        product = models.ProductSKU(
            sku=sku,
            product_name="Test Product",
            category="Sandwich",
            size="Solo",
            retail_price=130,
            reseller_price=117,
            cost_per_unit=cost,
            labor_cost=0,
            utility_cost=0,
            warehouse_stock=10,
        )
        self.db.add(product)
        self.db.commit()
        return product

    def add_event_with_sale(self, status="Active", cost=0):
        product = self.add_product(cost=cost)
        event = models.MarketEvent(
            name="Audit Event",
            event_date="2026-07-13",
            location="Test Venue",
            status=status,
        )
        event.allocations.append(models.MarketEventAllocation(
            sku=product.sku,
            quantity=9,
        ))
        self.db.add(event)
        self.db.flush()
        sale = models.MarketEventSale(
            event_id=event.id,
            payment_method="Cash",
            total_amount=130,
        )
        sale.items.append(models.MarketEventSaleItem(
            sku=product.sku,
            quantity=1,
            price_snapshot=130,
        ))
        self.db.add(sale)
        self.db.commit()
        self.db.refresh(event)
        return event

    def test_missing_recipe_is_not_reported_as_valid_zero_cost(self):
        self.add_product()

        analysis = get_profit_margin_analysis(self.db)

        self.assertEqual(len(analysis), 1)
        self.assertEqual(analysis[0]["cost_status"], "missing_recipe")
        self.assertEqual(analysis[0]["cost_status_message"], "Recipe missing")

    def test_cost_above_selling_price_requires_review(self):
        product = self.add_product()
        product.cost_override = 150
        self.db.commit()

        analysis = get_profit_margin_analysis(self.db)

        self.assertEqual(analysis[0]["cost_status"], "invalid_cost")
        self.assertEqual(analysis[0]["cost_status_message"], "Cost exceeds selling price")

    def test_active_event_card_uses_actual_labels_and_flags_missing_cost(self):
        event = self.add_event_with_sale(status="Active", cost=0)

        result = compute_event_stats(event, self.db)

        self.assertEqual(result.metrics_basis, "actual")
        self.assertFalse(result.costing_complete)
        self.assertEqual(result.estimated_revenue, 130)
        self.assertEqual(result.estimated_cost, 0)
        self.assertEqual(result.allocations[0].quantity, 9)

    def test_analytics_excludes_sales_until_event_is_completed(self):
        self.add_event_with_sale(status="Active", cost=25)

        result = get_market_events_analytics(self.db)

        self.assertEqual(result["overall"]["total_completed_events"], 0)
        self.assertEqual(result["overall"]["total_revenue"], 0)
        self.assertEqual(result["overall"]["total_units_sold"], 0)
        self.assertEqual(result["recommendations"], [])

    def test_completed_event_with_missing_cost_suppresses_profit_confidence(self):
        self.add_event_with_sale(status="Completed", cost=0)

        result = get_market_events_analytics(self.db)

        self.assertEqual(result["overall"]["total_revenue"], 130)
        self.assertFalse(result["overall"]["costing_complete"])
        self.assertIsNone(result["recommendations"][0]["expected_profit"])


if __name__ == "__main__":
    unittest.main()

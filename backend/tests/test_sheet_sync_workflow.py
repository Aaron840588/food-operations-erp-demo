import unittest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models
from app.database import Base
from app.services.google_sheets_reader import (
    SheetMetadata,
    SheetRangeRead,
    SpreadsheetBatchRead,
)
from app.services.sheet_sync_registry import get_sheet_source
from app.services.sheet_sync_service import (
    SheetSyncConflictError,
    SheetSyncWorkflowError,
    get_price_auto_apply_enabled,
    review_change,
    run_manual_check,
    set_price_auto_apply_enabled,
)


class FakeSheetReader:
    def __init__(self, *range_reads):
        self.range_reads = tuple(range_reads)
        self.calls = []

    def read_sources(self, source_keys):
        self.calls.append(tuple(source_keys))
        selected = tuple(
            range_read
            for range_read in self.range_reads
            if range_read.source.key in source_keys
        )
        return (
            SpreadsheetBatchRead(
                metadata=SheetMetadata(
                    spreadsheet_id=selected[0].source.spreadsheet_id,
                    title="Partner Inventory Management",
                    locale="en_PH",
                    time_zone="Asia/Manila",
                    sheet_ids={item.source.sheet_name: index + 1 for index, item in enumerate(selected)},
                ),
                ranges=selected,
                request_count=2,
            ),
        )


def rte_range(*rows):
    source = get_sheet_source("partner_rte_food_info")
    return SheetRangeRead(
        source=source,
        values=(
            (
                "SKU",
                "Product Name",
                "Category",
                "Cost/Unit",
                "H+H Price",
                "Reseller's Price",
                "Profit Margin",
            ),
            *rows,
        ),
    )


def sku_range(*rows):
    source = get_sheet_source("partner_skus")
    return SheetRangeRead(
        source=source,
        values=(
            ("SKU", "Product Name", "Size", "Category", "Pack QTY", "Notes"),
            *rows,
        ),
    )


class SheetSyncWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.db = sessionmaker(bind=self.engine)()
        self.owner = models.User(
            username="owner",
            hashed_password="test-only",
            role="owner",
            is_active=True,
        )
        self.product = models.ProductSKU(
            sku="YP-IND-SWT",
            product_name="Yema Spread",
            category="Spreads & Sauces",
            size="Indulge",
            retail_price=250,
            reseller_price=200,
            pack_qty=1,
            warehouse_stock=10,
        )
        self.db.add_all([self.owner, self.product])
        self.db.commit()
        self.db.refresh(self.owner)
        self.db.refresh(self.product)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def make_price_reader(self, retail=270, reseller=210):
        return FakeSheetReader(
            rte_range(
                (
                    "YP-IND-SWT",
                    "Yema Spread",
                    "Sweet Spread",
                    100,
                    retail,
                    reseller,
                    0.5,
                )
            )
        )

    def test_manual_check_creates_only_meaningful_owner_review_changes(self):
        run = run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(),
        )

        self.assertEqual(run.status, "completed")
        changes = self.db.query(models.SheetSyncChange).order_by(
            models.SheetSyncChange.destination_field
        ).all()
        self.assertEqual(
            [change.destination_field for change in changes],
            ["reseller_price", "retail_price"],
        )
        self.assertTrue(all(change.status == "pending" for change in changes))
        self.assertEqual(self.db.query(models.SheetSyncSnapshot).count(), 1)
        self.assertEqual(self.db.query(models.SheetSyncChangeEvent).count(), 2)
        self.db.refresh(self.product)
        self.assertEqual(self.product.retail_price, 250)
        self.assertEqual(self.product.reseller_price, 200)

    def test_owner_enabled_price_sync_applies_both_prices_with_full_audit(self):
        self.assertTrue(
            set_price_auto_apply_enabled(self.db, enabled=True)
        )
        self.assertTrue(get_price_auto_apply_enabled(self.db))

        run = run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(),
            trigger_type="owner_poll",
            require_auto_apply=True,
        )

        self.db.refresh(self.product)
        self.assertEqual(self.product.retail_price, 270)
        self.assertEqual(self.product.reseller_price, 210)
        self.assertEqual(run.trigger_type, "owner_poll")
        self.assertIn('"auto_applied":2', run.summary_json)
        changes = self.db.query(models.SheetSyncChange).order_by(
            models.SheetSyncChange.destination_field
        ).all()
        self.assertTrue(all(change.approval_mode == "auto_apply" for change in changes))
        self.assertTrue(all(change.status == "applied" for change in changes))
        for change in changes:
            event_types = [
                event_type
                for (event_type,) in self.db.query(
                    models.SheetSyncChangeEvent.event_type
                ).filter(
                    models.SheetSyncChangeEvent.change_id == change.id
                ).order_by(models.SheetSyncChangeEvent.id).all()
            ]
            self.assertEqual(event_types, ["detected", "accepted", "applied"])

    def test_auto_price_setting_never_auto_applies_structural_fields(self):
        set_price_auto_apply_enabled(self.db, enabled=True)
        run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_skus"],
            reader=FakeSheetReader(
                sku_range(
                    ("YP-IND-SWT", "Renamed Yema", "Solo", "Sweet", 2, ""),
                )
            ),
        )

        changes = self.db.query(models.SheetSyncChange).all()
        self.assertGreater(len(changes), 0)
        self.assertTrue(all(change.approval_mode == "manual_review" for change in changes))
        self.assertTrue(all(change.status == "pending" for change in changes))
        self.db.refresh(self.product)
        self.assertEqual(self.product.product_name, "Yema Spread")
        self.assertEqual(self.product.pack_qty, 1)

    def test_large_price_jump_stays_in_review_even_when_auto_prices_are_on(self):
        set_price_auto_apply_enabled(self.db, enabled=True)
        run = run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(retail=2500, reseller=2000),
            trigger_type="owner_poll",
            require_auto_apply=True,
        )

        changes = self.db.query(models.SheetSyncChange).all()
        self.assertEqual(len(changes), 2)
        self.assertTrue(all(change.approval_mode == "manual_review" for change in changes))
        self.assertTrue(all(change.status == "pending" for change in changes))
        self.assertIn('"auto_applied":0', run.summary_json)
        self.db.refresh(self.product)
        self.assertEqual(self.product.retail_price, 250)
        self.assertEqual(self.product.reseller_price, 200)

    def test_automatic_check_is_blocked_until_owner_enables_prices(self):
        with self.assertRaises(SheetSyncWorkflowError) as failure:
            run_manual_check(
                self.db,
                actor_user_id=self.owner.id,
                source_keys=["partner_rte_food_info"],
                reader=self.make_price_reader(),
                trigger_type="owner_poll",
                require_auto_apply=True,
            )
        self.assertEqual(failure.exception.code, "auto_apply_disabled")
        self.assertEqual(self.db.query(models.SheetSyncRun).count(), 0)

    def test_repeated_check_is_idempotent_for_unresolved_changes(self):
        for _ in range(2):
            run_manual_check(
                self.db,
                actor_user_id=self.owner.id,
                source_keys=["partner_rte_food_info"],
                reader=self.make_price_reader(),
            )

        self.assertEqual(self.db.query(models.SheetSyncRun).count(), 2)
        self.assertEqual(self.db.query(models.SheetSyncSnapshot).count(), 2)
        self.assertEqual(self.db.query(models.SheetSyncChange).count(), 2)
        latest_run = self.db.query(models.SheetSyncRun).order_by(
            models.SheetSyncRun.id.desc()
        ).first()
        self.assertIn('"changes_suppressed":2', latest_run.summary_json)

    def test_duplicate_and_missing_destination_rows_are_excluded(self):
        reader = FakeSheetReader(
            sku_range(
                ("YP-IND-SWT", "Yema A", "Indulge", "Sweet", 1, ""),
                ("YP-IND-SWT", "Yema B", "Indulge", "Sweet", 1, ""),
                ("UNKNOWN-SKU", "Unknown", "Full", "Sandwich", 1, ""),
            )
        )
        run = run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_skus"],
            reader=reader,
        )

        self.assertEqual(run.status, "completed_with_errors")
        snapshots = self.db.query(models.SheetSyncSnapshot).order_by(
            models.SheetSyncSnapshot.row_number
        ).all()
        self.assertEqual(
            [snapshot.validation_status for snapshot in snapshots],
            ["duplicate", "duplicate", "invalid"],
        )
        self.assertEqual(self.db.query(models.SheetSyncChange).count(), 0)

    def test_accept_applies_via_validated_master_service_and_keeps_sale_snapshot(self):
        sale = models.MarketEventSale(
            event_id=1,
            cashier_id=self.owner.id,
            payment_method="Cash",
            total_amount=250,
        )
        # Avoid requiring a full event graph for this focused historical-price
        # assertion by creating the event and allocation directly.
        event = models.MarketEvent(
            id=1,
            name="Past Market",
            event_date="2026-07-01",
            location="Test",
            status="Completed",
        )
        sale.items.append(
            models.MarketEventSaleItem(
                sku=self.product.sku,
                quantity=1,
                price_snapshot=250,
            )
        )
        self.db.add_all([event, sale])
        self.db.commit()

        run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(),
        )
        change = self.db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.destination_field == "retail_price"
        ).one()
        applied = review_change(
            self.db,
            change_public_id=change.public_id,
            action="accept",
            actor_user_id=self.owner.id,
            resolution_note="Approved tracker price",
        )

        self.assertEqual(applied.status, "applied")
        self.db.refresh(self.product)
        self.assertEqual(self.product.retail_price, 270)
        historical_item = self.db.query(models.MarketEventSaleItem).one()
        self.assertEqual(historical_item.price_snapshot, 250)
        event_types = [
            event_type
            for (event_type,) in self.db.query(models.SheetSyncChangeEvent.event_type).filter(
                models.SheetSyncChangeEvent.change_id == applied.id
            ).order_by(models.SheetSyncChangeEvent.id).all()
        ]
        self.assertEqual(event_types, ["detected", "accepted", "applied"])

    def test_destination_change_creates_conflict_and_never_overwrites(self):
        run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(),
        )
        change = self.db.query(models.SheetSyncChange).filter(
            models.SheetSyncChange.destination_field == "retail_price"
        ).one()
        self.product.retail_price = 260
        self.db.commit()

        with self.assertRaises(SheetSyncConflictError):
            review_change(
                self.db,
                change_public_id=change.public_id,
                action="accept",
                actor_user_id=self.owner.id,
            )
        self.db.refresh(change)
        self.db.refresh(self.product)
        self.assertEqual(change.status, "conflict")
        self.assertEqual(self.product.retail_price, 260)

    def test_reject_and_ignore_are_append_only_review_events(self):
        run_manual_check(
            self.db,
            actor_user_id=self.owner.id,
            source_keys=["partner_rte_food_info"],
            reader=self.make_price_reader(),
        )
        changes = self.db.query(models.SheetSyncChange).order_by(
            models.SheetSyncChange.destination_field
        ).all()
        rejected = review_change(
            self.db,
            change_public_id=changes[0].public_id,
            action="reject",
            actor_user_id=self.owner.id,
            resolution_note="Wrong tracker value",
        )
        ignored = review_change(
            self.db,
            change_public_id=changes[1].public_id,
            action="ignore",
            actor_user_id=self.owner.id,
        )
        self.assertEqual(rejected.status, "rejected")
        self.assertEqual(ignored.status, "ignored")
        self.db.refresh(self.product)
        self.assertEqual(self.product.retail_price, 250)
        self.assertEqual(self.product.reseller_price, 200)


if __name__ == "__main__":
    unittest.main()

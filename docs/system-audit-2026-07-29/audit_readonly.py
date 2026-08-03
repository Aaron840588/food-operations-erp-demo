"""Read-only production data-integrity audit for H+H Hub.

The script loads the repository's configured database connection, starts a
read-only transaction, runs aggregate reconciliation queries, and writes a
bounded JSON snapshot with no customer contact details or credentials.

Usage:
    python docs/system-audit-2026-07-29/audit_readonly.py
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
if str(REPOSITORY_ROOT) not in sys.path:
    sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.app.database import engine
from backend.app.models import Base, ProductSKU
from backend.app.services.cost_snapshot_service import build_unit_cost_snapshots


OUTPUT_PATH = Path(__file__).with_name("data_snapshot.json")


def json_value(value: Any) -> Any:
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    return value


def rows(connection, sql: str, **parameters: Any) -> list[dict[str, Any]]:
    result = connection.execute(text(sql), parameters)
    return [
        {key: json_value(value) for key, value in row.items()}
        for row in result.mappings().all()
    ]


def scalar(connection, sql: str, **parameters: Any) -> Any:
    return json_value(connection.execute(text(sql), parameters).scalar())


def run_audit() -> dict[str, Any]:
    snapshot: dict[str, Any] = {
        "generated_at": datetime.now().astimezone().isoformat(),
        "scope": "Configured live database, aggregate read-only reconciliation",
        "contains_customer_contact_data": False,
        "checks": {},
    }

    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            if connection.dialect.name == "postgresql":
                connection.execute(text("SET TRANSACTION READ ONLY"))

            inspector = inspect(connection)
            database_tables = set(inspector.get_table_names())
            model_tables = set(Base.metadata.tables)
            schema_drift = {
                "missing_tables_in_database": sorted(model_tables - database_tables),
                "extra_tables_in_database": sorted(database_tables - model_tables),
                "column_differences": [],
            }
            for table_name in sorted(model_tables & database_tables):
                model_columns = set(Base.metadata.tables[table_name].columns.keys())
                database_columns = {
                    column["name"] for column in inspector.get_columns(table_name)
                }
                missing_columns = sorted(model_columns - database_columns)
                extra_columns = sorted(database_columns - model_columns)
                if missing_columns or extra_columns:
                    schema_drift["column_differences"].append(
                        {
                            "table": table_name,
                            "missing_database_columns": missing_columns,
                            "extra_database_columns": extra_columns,
                        }
                    )

            snapshot["database"] = {
                "dialect": connection.dialect.name,
                "table_count": len(database_tables),
                "schema_drift": schema_drift,
                "row_counts": {
                    table_name: scalar(
                        connection,
                        f'SELECT COUNT(*) FROM "{table_name}"',
                    )
                    for table_name in sorted(database_tables)
                },
            }

            snapshot["checks"]["catalog"] = {
                "product_status_by_category": rows(
                    connection,
                    """
                    SELECT category, is_active, COUNT(*) AS product_count
                    FROM product_skus
                    GROUP BY category, is_active
                    ORDER BY category, is_active DESC
                    """,
                ),
                "active_products_with_unrecognized_source_category": rows(
                    connection,
                    """
                    SELECT sku, product_name, category
                    FROM product_skus
                    WHERE is_active = TRUE
                      AND LOWER(TRIM(category)) NOT IN (
                        'sweet', 'savory', 'spreads & sauces', 'spreads',
                        'sauces', 'savory spreads', 'sweet spreads',
                        'sandwiches & salads', 'sandwiches',
                        'sandwiches/salads', 'salads', 'salad', 'sandwich',
                        'pasta', 'pastas', 'pasta tub', 'pasta tubs',
                        'ready to eat', 'rte', 'dessert', 'desserts',
                        'drinks', 'drink', 'cold brew', 'bakes & pasta',
                        'pasta & bakes', 'savory bakes', 'addon', 'add-on',
                        'add_on', 'packaging', 'package', 'giftset',
                        'gift_set', 'gift-set', 'gift', 'bundle', 'set'
                      )
                    ORDER BY category, sku
                    """,
                ),
                "active_products_missing_recipe": rows(
                    connection,
                    """
                    SELECT p.sku, p.product_name, p.category
                    FROM product_skus p
                    LEFT JOIN recipes r ON r.sku = p.sku
                    WHERE p.is_active = TRUE AND r.id IS NULL
                    ORDER BY p.category, p.sku
                    """,
                ),
                "active_nonpositive_price_products": rows(
                    connection,
                    """
                    SELECT sku, product_name, category, size, retail_price,
                           reseller_price, warehouse_stock
                    FROM product_skus
                    WHERE is_active = TRUE
                      AND retail_price <= 0
                    ORDER BY category, sku
                    """,
                ),
                "category_precedence_misclassification_candidates": rows(
                    connection,
                    """
                    SELECT sku, product_name, category, size
                    FROM product_skus
                    WHERE is_active = TRUE
                      AND LOWER(TRIM(category)) IN ('sweet', 'savory')
                      AND (
                        UPPER(sku) LIKE '%-SW-%'
                        OR LOWER(product_name) LIKE '%sandwich%'
                      )
                    ORDER BY category, sku
                    """,
                ),
                "invalid_product_financial_values": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN retail_price <= 0 THEN 1 ELSE 0 END) AS nonpositive_retail_price,
                      SUM(CASE WHEN reseller_price < 0 THEN 1 ELSE 0 END) AS negative_reseller_price,
                      SUM(CASE WHEN cost_per_unit < 0 THEN 1 ELSE 0 END) AS negative_cost_per_unit,
                      SUM(CASE WHEN labor_cost < 0 THEN 1 ELSE 0 END) AS negative_labor_cost,
                      SUM(CASE WHEN utility_cost < 0 THEN 1 ELSE 0 END) AS negative_utility_cost,
                      SUM(CASE WHEN warehouse_stock < 0 THEN 1 ELSE 0 END) AS negative_warehouse_stock,
                      SUM(CASE WHEN density_multiplier <= 0 THEN 1 ELSE 0 END) AS nonpositive_density_multiplier
                    FROM product_skus
                    """,
                ),
                "active_products_zero_or_missing_cost": rows(
                    connection,
                    """
                    SELECT sku, product_name, category, retail_price, cost_per_unit,
                           labor_cost, utility_cost
                    FROM product_skus
                    WHERE is_active = TRUE
                      AND COALESCE(cost_override, cost_per_unit, 0) <= 0
                    ORDER BY category, sku
                    """,
                ),
                "recipe_shape_issues": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN yield_weight <= 0 THEN 1 ELSE 0 END) AS nonpositive_yields,
                      SUM(CASE WHEN portion_size IS NOT NULL AND portion_size <= 0 THEN 1 ELSE 0 END) AS nonpositive_portions
                    FROM recipes
                    """,
                ),
                "recipe_item_shape_issues": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN base_qty <= 0 THEN 1 ELSE 0 END) AS nonpositive_quantities,
                      SUM(CASE WHEN ingredient_type NOT IN ('raw', 'sku') THEN 1 ELSE 0 END) AS invalid_types,
                      SUM(CASE WHEN ingredient_type = 'raw' AND raw_ingredient_id IS NULL THEN 1 ELSE 0 END) AS raw_missing_reference,
                      SUM(CASE WHEN ingredient_type = 'sku' AND sub_sku IS NULL THEN 1 ELSE 0 END) AS sku_missing_reference,
                      SUM(CASE WHEN raw_ingredient_id IS NOT NULL AND sub_sku IS NOT NULL THEN 1 ELSE 0 END) AS dual_reference
                    FROM recipe_items
                    """,
                ),
                "direct_recipe_cycles": rows(
                    connection,
                    """
                    SELECT r.sku, ri.id AS recipe_item_id
                    FROM recipes r
                    JOIN recipe_items ri ON ri.recipe_id = r.id
                    WHERE ri.ingredient_type = 'sku' AND ri.sub_sku = r.sku
                    ORDER BY r.sku
                    """,
                ),
            }
            orm_session = Session(bind=connection)
            active_products = orm_session.query(ProductSKU).filter(
                ProductSKU.is_active.is_(True)
            ).all()
            cost_snapshots = build_unit_cost_snapshots(
                orm_session,
                active_products,
            )
            snapshot["checks"]["catalog"]["computed_cost_status"] = {
                "status_counts": {
                    status: sum(
                        1
                        for item in cost_snapshots.values()
                        if item.status == status
                    )
                    for status in sorted(
                        {item.status for item in cost_snapshots.values()}
                    )
                },
                "non_ok_products": [
                    {
                        "sku": product.sku,
                        "product_name": product.product_name,
                        "category": product.category,
                        "retail_price": json_value(product.retail_price),
                        "food_cost": cost_snapshots[product.sku].food_cost,
                        "total_cost": cost_snapshots[product.sku].total_cost,
                        "status": cost_snapshots[product.sku].status,
                        "message": cost_snapshots[product.sku].status_message,
                    }
                    for product in sorted(active_products, key=lambda item: item.sku)
                    if cost_snapshots[product.sku].status != "ok"
                ],
            }
            orm_session.close()

            snapshot["checks"]["ingredients"] = {
                "invalid_values": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN price < 0 THEN 1 ELSE 0 END) AS negative_price,
                      SUM(CASE WHEN net_weight <= 0 THEN 1 ELSE 0 END) AS nonpositive_net_weight,
                      SUM(CASE WHEN cost_per_gram_unit < 0 THEN 1 ELSE 0 END) AS negative_unit_cost,
                      SUM(CASE WHEN available_stock < 0 THEN 1 ELSE 0 END) AS negative_stock,
                      SUM(CASE WHEN reorder_level < 0 THEN 1 ELSE 0 END) AS negative_reorder_level
                    FROM raw_ingredients
                    """,
                ),
                "zero_price_or_weight": rows(
                    connection,
                    """
                    SELECT id, name, category, unit, price, net_weight, cost_per_gram_unit
                    FROM raw_ingredients
                    WHERE price = 0 OR net_weight <= 0
                    ORDER BY category, name
                    """,
                ),
                "zero_priced_recipe_inputs": rows(
                    connection,
                    """
                    SELECT i.id, i.name, i.available_stock,
                           COUNT(DISTINCT r.sku) AS affected_product_count
                    FROM raw_ingredients i
                    JOIN recipe_items ri ON ri.raw_ingredient_id = i.id
                    JOIN recipes r ON r.id = ri.recipe_id
                    WHERE i.price = 0
                    GROUP BY i.id, i.name, i.available_stock
                    ORDER BY affected_product_count DESC, i.name
                    """,
                ),
                "zero_priced_recipe_input_impact": rows(
                    connection,
                    """
                    SELECT COUNT(DISTINCT i.id) AS zero_priced_inputs,
                           COUNT(DISTINCT r.sku) AS affected_products,
                           COUNT(*) AS affected_recipe_links
                    FROM raw_ingredients i
                    JOIN recipe_items ri ON ri.raw_ingredient_id = i.id
                    JOIN recipes r ON r.id = ri.recipe_id
                    WHERE i.price = 0
                    """,
                ),
                "normalized_duplicate_names": rows(
                    connection,
                    """
                    SELECT LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g')) AS normalized_name,
                           COUNT(*) AS duplicate_count
                    FROM raw_ingredients
                    GROUP BY LOWER(REGEXP_REPLACE(TRIM(name), '\\s+', ' ', 'g'))
                    HAVING COUNT(*) > 1
                    ORDER BY duplicate_count DESC, normalized_name
                    """,
                ),
                "missing_supplier_links": scalar(
                    connection,
                    "SELECT COUNT(*) FROM raw_ingredients WHERE supplier_id IS NULL",
                ),
                "supplier_count": scalar(connection, "SELECT COUNT(*) FROM suppliers"),
            }

            snapshot["checks"]["inventory"] = {
                "warehouse_identity": rows(
                    connection,
                    """
                    SELECT id, name, is_active
                    FROM warehouses
                    ORDER BY id
                    """,
                ),
                "duplicate_stock_rows": rows(
                    connection,
                    """
                    SELECT warehouse_id, raw_ingredient_id, sku, COUNT(*) AS row_count
                    FROM warehouse_stocks
                    GROUP BY warehouse_id, raw_ingredient_id, sku
                    HAVING COUNT(*) > 1
                    ORDER BY row_count DESC, warehouse_id
                    """,
                ),
                "invalid_stock_subjects": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN raw_ingredient_id IS NULL AND sku IS NULL THEN 1 ELSE 0 END) AS missing_subject,
                      SUM(CASE WHEN raw_ingredient_id IS NOT NULL AND sku IS NOT NULL THEN 1 ELSE 0 END) AS dual_subject,
                      SUM(CASE WHEN quantity < 0 THEN 1 ELSE 0 END) AS negative_quantity
                    FROM warehouse_stocks
                    """,
                ),
                "main_product_mirror_drift": rows(
                    connection,
                    """
                    SELECT p.sku, p.warehouse_stock AS product_quantity,
                           COALESCE(ws.quantity, 0) AS main_warehouse_quantity,
                           COALESCE(ws.quantity, 0) - p.warehouse_stock AS difference
                    FROM product_skus p
                    LEFT JOIN warehouse_stocks ws
                      ON ws.warehouse_id = 1 AND ws.sku = p.sku
                    WHERE ws.id IS NULL OR ABS(COALESCE(ws.quantity, 0) - p.warehouse_stock) > 0.0001
                    ORDER BY ABS(COALESCE(ws.quantity, 0) - p.warehouse_stock) DESC, p.sku
                    """,
                ),
                "main_ingredient_mirror_drift": rows(
                    connection,
                    """
                    SELECT i.id, i.name, i.available_stock AS ingredient_quantity,
                           COALESCE(ws.quantity, 0) AS main_warehouse_quantity,
                           COALESCE(ws.quantity, 0) - i.available_stock AS difference
                    FROM raw_ingredients i
                    LEFT JOIN warehouse_stocks ws
                      ON ws.warehouse_id = 1 AND ws.raw_ingredient_id = i.id
                    WHERE ws.id IS NULL OR ABS(COALESCE(ws.quantity, 0) - i.available_stock) > 0.0001
                    ORDER BY ABS(COALESCE(ws.quantity, 0) - i.available_stock) DESC, i.id
                    """,
                ),
                "batch_balance_drift": rows(
                    connection,
                    """
                    WITH batch_totals AS (
                      SELECT raw_ingredient_id, SUM(quantity) AS batch_quantity
                      FROM ingredient_batches
                      GROUP BY raw_ingredient_id
                    )
                    SELECT i.id, i.name, i.available_stock,
                           COALESCE(b.batch_quantity, 0) AS batch_quantity,
                           COALESCE(b.batch_quantity, 0) - i.available_stock AS difference
                    FROM raw_ingredients i
                    LEFT JOIN batch_totals b ON b.raw_ingredient_id = i.id
                    WHERE ABS(COALESCE(b.batch_quantity, 0) - i.available_stock) > 0.0001
                    ORDER BY ABS(COALESCE(b.batch_quantity, 0) - i.available_stock) DESC, i.id
                    """,
                ),
                "transaction_subject_issues": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN raw_ingredient_id IS NULL AND sku IS NULL THEN 1 ELSE 0 END) AS missing_subject,
                      SUM(CASE WHEN raw_ingredient_id IS NOT NULL AND sku IS NOT NULL THEN 1 ELSE 0 END) AS dual_subject,
                      SUM(CASE WHEN qty = 0 THEN 1 ELSE 0 END) AS zero_quantity
                    FROM inventory_transactions
                    WHERE transaction_type <> 'market_sale_idempotency'
                    """,
                ),
                "zero_quantity_business_ledger_rows": rows(
                    connection,
                    """
                    SELECT transaction_type, COUNT(*) AS row_count,
                           MIN(created_at) AS first_seen,
                           MAX(created_at) AS last_seen
                    FROM inventory_transactions
                    WHERE qty = 0
                      AND transaction_type <> 'market_sale_idempotency'
                    GROUP BY transaction_type
                    ORDER BY transaction_type
                    """,
                ),
                "transaction_types": rows(
                    connection,
                    """
                    SELECT transaction_type, COUNT(*) AS transaction_count,
                           MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
                    FROM inventory_transactions
                    GROUP BY transaction_type
                    ORDER BY transaction_count DESC, transaction_type
                    """,
                ),
            }

            snapshot["checks"]["market_events"] = {
                "status_counts": rows(
                    connection,
                    """
                    SELECT status, is_deleted, COUNT(*) AS event_count
                    FROM market_events
                    GROUP BY status, is_deleted
                    ORDER BY status, is_deleted
                    """,
                ),
                "date_or_status_issues": rows(
                    connection,
                    """
                    SELECT id, name, event_date, status, is_deleted
                    FROM market_events
                    WHERE event_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
                      OR status NOT IN ('Draft', 'Active', 'Completed', 'Cancelled')
                    ORDER BY id
                    """,
                ),
                "events_without_allocations": rows(
                    connection,
                    """
                    SELECT e.id, e.name, e.event_date, e.status
                    FROM market_events e
                    LEFT JOIN market_event_allocations a ON a.event_id = e.id
                    WHERE COALESCE(e.is_deleted, FALSE) = FALSE
                    GROUP BY e.id, e.name, e.event_date, e.status
                    HAVING COUNT(a.id) = 0
                    ORDER BY e.event_date, e.id
                    """,
                ),
                "allocation_balance_issues": rows(
                    connection,
                    """
                    SELECT a.event_id, a.sku,
                           a.quantity AS remaining_booth_quantity,
                           a.wasted_quantity AS wasted_quantity
                    FROM market_event_allocations a
                    WHERE a.quantity < 0
                       OR a.wasted_quantity < 0
                       OR a.wasted_quantity > a.quantity
                    ORDER BY a.event_id, a.sku
                    """,
                ),
                "duplicate_allocation_skus": rows(
                    connection,
                    """
                    SELECT event_id, sku, COUNT(*) AS row_count
                    FROM market_event_allocations
                    GROUP BY event_id, sku
                    HAVING COUNT(*) > 1
                    ORDER BY event_id, sku
                    """,
                ),
                "duplicate_sale_client_references": rows(
                    connection,
                    """
                    SELECT event_id, client_reference, COUNT(*) AS row_count
                    FROM market_event_sales
                    WHERE client_reference IS NOT NULL
                    GROUP BY event_id, client_reference
                    HAVING COUNT(*) > 1
                    ORDER BY event_id, client_reference
                    """,
                ),
                "missing_sale_client_reference": scalar(
                    connection,
                    "SELECT COUNT(*) FROM market_event_sales WHERE client_reference IS NULL OR TRIM(client_reference) = ''",
                ),
                "sale_total_reconciliation": rows(
                    connection,
                    """
                    WITH item_totals AS (
                      SELECT sale_id, SUM(quantity * price_snapshot) AS item_subtotal
                      FROM market_event_sale_items
                      GROUP BY sale_id
                    )
                    SELECT s.id, s.event_id, s.subtotal_amount,
                           COALESCE(i.item_subtotal, 0) AS item_subtotal,
                           s.discount_amount, s.total_amount, s.tip_amount,
                           COALESCE(i.item_subtotal, 0) - COALESCE(s.subtotal_amount, 0) AS subtotal_difference,
                           COALESCE(s.subtotal_amount, 0) - COALESCE(s.discount_amount, 0) - COALESCE(s.total_amount, 0) AS total_difference
                    FROM market_event_sales s
                    LEFT JOIN item_totals i ON i.sale_id = s.id
                    WHERE ABS(COALESCE(i.item_subtotal, 0) - COALESCE(s.subtotal_amount, 0)) > 0.009
                       OR ABS(COALESCE(s.subtotal_amount, 0) - COALESCE(s.discount_amount, 0) - COALESCE(s.total_amount, 0)) > 0.009
                    ORDER BY s.id
                    """,
                ),
                "invalid_sale_items": rows(
                    connection,
                    """
                    SELECT
                      SUM(CASE WHEN quantity <= 0 THEN 1 ELSE 0 END) AS nonpositive_quantity,
                      SUM(CASE WHEN price_snapshot < 0 THEN 1 ELSE 0 END) AS negative_price
                    FROM market_event_sale_items
                    """,
                ),
                "payment_methods": rows(
                    connection,
                    """
                    SELECT payment_method, COUNT(*) AS sale_count,
                           SUM(total_amount) AS net_sales
                    FROM market_event_sales
                    GROUP BY payment_method
                    ORDER BY sale_count DESC, payment_method
                    """,
                ),
                "cash_tender_issues": rows(
                    connection,
                    """
                    SELECT id, event_id, total_amount, tip_amount,
                           cash_received, change_given, is_preorder,
                           preorder_payment_status
                    FROM market_event_sales
                    WHERE payment_method = 'Cash'
                      AND (COALESCE(is_preorder, FALSE) = FALSE OR preorder_payment_status = 'Paid')
                      AND (
                        cash_received IS NULL
                        OR cash_received + 0.009 < total_amount + COALESCE(tip_amount, 0)
                        OR ABS(COALESCE(change_given, 0) - (cash_received - total_amount - COALESCE(tip_amount, 0))) > 0.009
                      )
                    ORDER BY id
                    """,
                ),
                "preorder_sale_shape_issues": rows(
                    connection,
                    """
                    SELECT id, event_id, preorder_payment_status, preorder_fulfillment_status
                    FROM market_event_sales
                    WHERE is_preorder = TRUE
                      AND (
                        preorder_customer_name IS NULL
                        OR TRIM(preorder_customer_name) = ''
                        OR preorder_payment_status NOT IN ('Paid', 'Unpaid')
                        OR preorder_fulfillment_status NOT IN ('Pending', 'Picked Up')
                      )
                    ORDER BY id
                    """,
                ),
                "orphan_idempotency_markers": rows(
                    connection,
                    """
                    SELECT t.id, t.batch_reference, t.notes AS recorded_sale_id
                    FROM inventory_transactions t
                    LEFT JOIN market_event_sales s
                      ON t.notes ~ '^\\d+$' AND s.id = CAST(t.notes AS INTEGER)
                    WHERE t.transaction_type = 'market_sale_idempotency'
                      AND s.id IS NULL
                    ORDER BY t.id
                    """,
                ),
                "sales_without_idempotency_marker": rows(
                    connection,
                    """
                    SELECT s.id, s.event_id, s.client_reference
                    FROM market_event_sales s
                    LEFT JOIN inventory_transactions t
                      ON t.transaction_type = 'market_sale_idempotency'
                     AND t.notes ~ '^\\d+$'
                     AND s.id = CAST(t.notes AS INTEGER)
                    WHERE t.id IS NULL
                    ORDER BY s.id
                    """,
                ),
            }

            snapshot["checks"]["preorders"] = {
                "form_status": rows(
                    connection,
                    """
                    SELECT id, name, is_enabled, event_id, created_at, updated_at
                    FROM preorder_forms
                    ORDER BY id
                    """,
                ),
                "status_counts": rows(
                    connection,
                    """
                    SELECT status, payment_status, COUNT(*) AS preorder_count
                    FROM preorders
                    GROUP BY status, payment_status
                    ORDER BY status, payment_status
                    """,
                ),
                "total_reconciliation": rows(
                    connection,
                    """
                    WITH item_totals AS (
                      SELECT preorder_id, SUM(line_total_snapshot) AS item_total
                      FROM preorder_items
                      GROUP BY preorder_id
                    )
                    SELECT p.id, p.public_reference, p.total_amount,
                           COALESCE(i.item_total, 0) AS item_total,
                           COALESCE(i.item_total, 0) - p.total_amount AS difference
                    FROM preorders p
                    LEFT JOIN item_totals i ON i.preorder_id = p.id
                    WHERE ABS(COALESCE(i.item_total, 0) - p.total_amount) > 0.009
                    ORDER BY p.id
                    """,
                ),
                "item_reconciliation": rows(
                    connection,
                    """
                    SELECT id, preorder_id, sku, quantity, unit_price_snapshot,
                           line_total_snapshot,
                           quantity * unit_price_snapshot - line_total_snapshot AS difference
                    FROM preorder_items
                    WHERE quantity <= 0
                       OR unit_price_snapshot < 0
                       OR line_total_snapshot < 0
                       OR ABS(quantity * unit_price_snapshot - line_total_snapshot) > 0.009
                    ORDER BY id
                    """,
                ),
                "fulfillment_link_issues": rows(
                    connection,
                    """
                    SELECT id, public_reference, status, fulfillment_sale_id, fulfilled_at
                    FROM preorders
                    WHERE (status = 'Fulfilled' AND (fulfillment_sale_id IS NULL OR fulfilled_at IS NULL))
                       OR (status <> 'Fulfilled' AND (fulfillment_sale_id IS NOT NULL OR fulfilled_at IS NOT NULL))
                    ORDER BY id
                    """,
                ),
                "missing_history_or_audit": rows(
                    connection,
                    """
                    SELECT p.id, p.public_reference,
                           COUNT(DISTINCT h.id) AS history_count,
                           COUNT(DISTINCT a.id) AS audit_count
                    FROM preorders p
                    LEFT JOIN preorder_status_history h ON h.preorder_id = p.id
                    LEFT JOIN preorder_audit_events a ON a.preorder_id = p.id
                    GROUP BY p.id, p.public_reference
                    HAVING COUNT(DISTINCT h.id) = 0 OR COUNT(DISTINCT a.id) = 0
                    ORDER BY p.id
                    """,
                ),
                "history_sequence_gaps": rows(
                    connection,
                    """
                    SELECT preorder_id, MIN(sequence_number) AS first_sequence,
                           MAX(sequence_number) AS last_sequence,
                           COUNT(*) AS history_count
                    FROM preorder_status_history
                    GROUP BY preorder_id
                    HAVING MIN(sequence_number) <> 1
                       OR MAX(sequence_number) <> COUNT(*)
                    ORDER BY preorder_id
                    """,
                ),
            }

            snapshot["checks"]["production"] = {
                "plan_status_counts": rows(
                    connection,
                    """
                    SELECT status, COUNT(*) AS plan_count,
                           MIN(plan_date) AS earliest_date,
                           MAX(plan_date) AS latest_date
                    FROM production_plans
                    GROUP BY status
                    ORDER BY status
                    """,
                ),
                "invalid_plan_values": rows(
                    connection,
                    """
                    SELECT id, plan_date, status
                    FROM production_plans
                    WHERE plan_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
                       OR status NOT IN ('draft', 'forecasted', 'completed')
                    ORDER BY id
                    """,
                ),
                "plans_without_targets": rows(
                    connection,
                    """
                    SELECT p.id, p.plan_date, p.status
                    FROM production_plans p
                    LEFT JOIN production_targets t ON t.plan_id = p.id
                    GROUP BY p.id, p.plan_date, p.status
                    HAVING COUNT(t.id) = 0
                    ORDER BY p.plan_date
                    """,
                ),
                "target_issues": rows(
                    connection,
                    """
                    SELECT t.id, t.plan_id, t.sku, t.outlet, t.target_qty,
                           p.is_active, CASE WHEN r.id IS NULL THEN TRUE ELSE FALSE END AS missing_recipe
                    FROM production_targets t
                    JOIN product_skus p ON p.sku = t.sku
                    LEFT JOIN recipes r ON r.sku = t.sku
                    WHERE t.target_qty <= 0 OR p.is_active = FALSE OR r.id IS NULL
                    ORDER BY t.plan_id, t.id
                    """,
                ),
                "batch_issues": rows(
                    connection,
                    """
                    SELECT b.id, b.batch_date, b.sku, b.qty_produced, b.qty_delivered,
                           b.actual_yield, b.staff_hours, p.is_active
                    FROM production_batches b
                    LEFT JOIN product_skus p ON p.sku = b.sku
                    WHERE b.batch_date !~ '^\\d{4}-\\d{2}-\\d{2}$'
                       OR b.qty_produced < 0
                       OR b.qty_delivered < 0
                       OR b.sku IS NULL
                       OR p.sku IS NULL
                    ORDER BY b.id
                    """,
                ),
                "completed_plan_batch_coverage": rows(
                    connection,
                    """
                    SELECT p.id, p.plan_date, t.sku, SUM(t.target_qty) AS target_qty,
                           COALESCE(SUM(b.qty_produced), 0) AS produced_qty
                    FROM production_plans p
                    JOIN production_targets t ON t.plan_id = p.id
                    LEFT JOIN production_batches b
                      ON b.batch_date = p.plan_date AND b.sku = t.sku
                    WHERE p.status = 'completed'
                    GROUP BY p.id, p.plan_date, t.sku
                    HAVING COALESCE(SUM(b.qty_produced), 0) <> SUM(t.target_qty)
                    ORDER BY p.plan_date, t.sku
                    """,
                ),
            }

            snapshot["checks"]["partner_sales"] = {
                "consignment_balance_issues": rows(
                    connection,
                    """
                    SELECT id, delivery_id, sku, qty_delivered, units_sold,
                           qty_pulled_out,
                           qty_delivered - units_sold - qty_pulled_out AS unaccounted
                    FROM consignment_items
                    WHERE qty_delivered < 0
                       OR units_sold < 0
                       OR qty_pulled_out < 0
                       OR units_sold + qty_pulled_out > qty_delivered
                    ORDER BY id
                    """,
                ),
                "consignment_payment_shape_issues": rows(
                    connection,
                    """
                    SELECT id, delivery_date, is_paid, payment_date
                    FROM consignment_deliveries
                    WHERE (is_paid = TRUE AND payment_date IS NULL)
                       OR (is_paid = FALSE AND payment_date IS NOT NULL)
                    ORDER BY id
                    """,
                ),
                "reseller_order_total_reconciliation": rows(
                    connection,
                    """
                    WITH item_totals AS (
                      SELECT order_id, SUM(quantity * price_snapshot) AS item_subtotal
                      FROM reseller_order_items
                      GROUP BY order_id
                    )
                    SELECT o.id, o.subtotal, COALESCE(i.item_subtotal, 0) AS item_subtotal,
                           o.discount_amount, o.tax_amount, o.grand_total,
                           COALESCE(i.item_subtotal, 0) - o.subtotal AS subtotal_difference,
                           o.subtotal - o.discount_amount + o.tax_amount - o.grand_total AS total_difference
                    FROM reseller_orders o
                    LEFT JOIN item_totals i ON i.order_id = o.id
                    WHERE ABS(COALESCE(i.item_subtotal, 0) - o.subtotal) > 0.009
                       OR ABS(o.subtotal - o.discount_amount + o.tax_amount - o.grand_total) > 0.009
                    ORDER BY o.id
                    """,
                ),
                "reseller_item_issues": rows(
                    connection,
                    """
                    SELECT id, order_id, sku, quantity, price_snapshot
                    FROM reseller_order_items
                    WHERE quantity <= 0 OR price_snapshot < 0
                    ORDER BY id
                    """,
                ),
            }

            snapshot["checks"]["sheet_sync"] = {
                "table_counts": {
                    table_name: scalar(
                        connection,
                        f'SELECT COUNT(*) FROM "{table_name}"',
                    )
                    for table_name in (
                        "sheet_sync_sources",
                        "sheet_sync_mappings",
                        "sheet_sync_runs",
                        "sheet_sync_snapshots",
                        "sheet_sync_changes",
                        "sheet_sync_change_events",
                    )
                },
                "run_status_counts": rows(
                    connection,
                    """
                    SELECT status, COUNT(*) AS run_count, MAX(started_at) AS latest_started_at
                    FROM sheet_sync_runs
                    GROUP BY status
                    ORDER BY status
                    """,
                ),
                "change_status_counts": rows(
                    connection,
                    """
                    SELECT status, approval_mode, COUNT(*) AS change_count,
                           MAX(detected_at) AS latest_detected_at
                    FROM sheet_sync_changes
                    GROUP BY status, approval_mode
                    ORDER BY status, approval_mode
                    """,
                ),
            }

            if connection.dialect.name == "postgresql":
                snapshot["checks"]["database_security"] = {
                    "public_table_rls": rows(
                        connection,
                        """
                        SELECT c.relname AS table_name,
                               c.relrowsecurity AS rls_enabled,
                               c.relforcerowsecurity AS rls_forced
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public' AND c.relkind = 'r'
                        ORDER BY c.relname
                        """,
                    ),
                    "policies": rows(
                        connection,
                        """
                        SELECT schemaname, tablename, policyname, permissive, roles, cmd
                        FROM pg_policies
                        WHERE schemaname = 'public'
                        ORDER BY tablename, policyname
                        """,
                    ),
                    "anon_authenticated_grants": rows(
                        connection,
                        """
                        SELECT grantee, table_name, privilege_type
                        FROM information_schema.role_table_grants
                        WHERE table_schema = 'public'
                          AND grantee IN ('anon', 'authenticated')
                        ORDER BY grantee, table_name, privilege_type
                        """,
                    ),
                }
        finally:
            transaction.rollback()

    return snapshot


if __name__ == "__main__":
    audit = run_audit()
    OUTPUT_PATH.write_text(
        json.dumps(audit, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    print(f"Wrote read-only audit snapshot to {OUTPUT_PATH}")

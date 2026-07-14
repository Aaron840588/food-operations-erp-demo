-- Database Schema for Happy Noether Food Inventory System (SQLite version)

PRAGMA foreign_keys = ON;

-- 0. Security and Identity
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    hashed_password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    is_active INTEGER DEFAULT 1
);

-- 0.1 Suppliers Directory
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    contact_person TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1. Raw Ingredients Inventory
CREATE TABLE IF NOT EXISTS raw_ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    category TEXT,
    unit TEXT NOT NULL, -- e.g., 'grams', 'pcs', 'ml'
    price REAL NOT NULL, -- Purchase price
    net_weight REAL NOT NULL, -- Weight/volume of pack (e.g. 1000 for 1kg)
    cost_per_gram_unit REAL DEFAULT 0.0, -- Calculate as price / net_weight
    available_stock REAL DEFAULT 0.0,
    reorder_level REAL DEFAULT 0.0,
    shop TEXT, -- Where purchased
    brand TEXT,
    remarks TEXT,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Product Stock Keeping Units (SKUs)
CREATE TABLE IF NOT EXISTS product_skus (
    sku TEXT PRIMARY KEY, -- e.g., 'YP-IND-SWT'
    product_name TEXT NOT NULL,
    category TEXT NOT NULL, -- e.g., 'spread', 'sauce', 'sandwich', 'pasta', 'dessert', 'pastry', 'drink'
    size TEXT NOT NULL, -- e.g., 'Indulge', 'Sampler', 'Solo', 'Full', 'Half'
    retail_price REAL NOT NULL, -- SRP
    reseller_price REAL NOT NULL, -- Discounted rate for partners/resellers
    pack_qty INTEGER DEFAULT 1, -- Pack size quantity, e.g. 2s, 4s, 5s (default 1)
    storage_life TEXT,
    serving_requirement TEXT,
    cost_override REAL DEFAULT NULL, -- Manual override cost per unit
    cost_per_unit REAL DEFAULT 0.0, -- Cached costing
    labor_cost REAL DEFAULT 0.0,
    utility_cost REAL DEFAULT 3.28,
    warehouse_stock INTEGER DEFAULT 0,
    density_multiplier REAL DEFAULT 1.0,
    is_active INTEGER DEFAULT 1,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Recipes (Bill of Materials)
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE REFERENCES product_skus(sku) ON DELETE CASCADE,
    yield_weight REAL NOT NULL, -- Batch output in grams or pieces
    yield_unit TEXT DEFAULT 'g', -- 'g' or 'pcs'
    portion_size REAL, -- Portion size (e.g. 250g or 1pc)
    portion_unit TEXT DEFAULT 'g',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Recipe Items (BOM Ingredients)
CREATE TABLE IF NOT EXISTS recipe_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_type TEXT NOT NULL, -- 'raw' or 'sku'
    raw_ingredient_id INTEGER REFERENCES raw_ingredients(id) ON DELETE SET NULL, -- if type is 'raw'
    sub_sku TEXT REFERENCES product_skus(sku) ON DELETE SET NULL, -- if type is 'sku'
    base_qty REAL NOT NULL, -- Weight or pieces in base recipe
    base_unit TEXT NOT NULL
);

-- 5. Overhead and Labor Configuration
CREATE TABLE IF NOT EXISTS overhead_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL, -- 'utility' or 'labor'
    particular TEXT NOT NULL UNIQUE, -- e.g., 'Electricity Overall', 'Water', 'Che', 'Aimee'
    cost_per_month REAL DEFAULT 0.0,
    cost_per_day REAL DEFAULT 0.0,
    hourly_rate REAL DEFAULT 0.0,
    notes TEXT
);

-- 6. Production Plans & Targets
CREATE TABLE IF NOT EXISTS production_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_date TEXT UNIQUE NOT NULL, -- YYYY-MM-DD
    status TEXT DEFAULT 'draft', -- 'draft', 'forecasted', 'completed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_targets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    outlet TEXT NOT NULL, -- e.g., 'AA Mart', 'ECM', 'UPOU Day 2', 'Warehouse'
    target_qty INTEGER NOT NULL
);

-- 7. Actual Production & Yield Log
CREATE TABLE IF NOT EXISTS production_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_date TEXT NOT NULL,
    sku TEXT REFERENCES product_skus(sku) ON DELETE SET NULL,
    qty_produced INTEGER NOT NULL,
    qty_delivered INTEGER NOT NULL,
    actual_yield REAL,
    staff_hours REAL,
    notes TEXT
);

-- 8. Consignment Partners & Deliveries
CREATE TABLE IF NOT EXISTS consignment_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL, -- e.g. 'Likhang Laguna', 'Pinana Calauan', 'Artisan'
    discount_rate REAL DEFAULT 0.1000, -- Default 10%
    collection_frequency TEXT DEFAULT 'Weekly',
    minimum_order_amount REAL DEFAULT 1500.00
);

CREATE TABLE IF NOT EXISTS consignment_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL REFERENCES consignment_partners(id) ON DELETE CASCADE,
    delivery_date TEXT NOT NULL, -- YYYY-MM-DD
    dr_number TEXT,
    is_paid INTEGER DEFAULT 0, -- 0 = false, 1 = true
    payment_date TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consignment_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id INTEGER NOT NULL REFERENCES consignment_deliveries(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    qty_delivered INTEGER NOT NULL,
    units_sold INTEGER DEFAULT 0,
    qty_pulled_out INTEGER DEFAULT 0,
    reseller_price_snapshot REAL NOT NULL, -- Reseller price at delivery time
    cost_per_unit_snapshot REAL NOT NULL, -- Cached food cost per unit at delivery time
    store_price_snapshot REAL NOT NULL, -- Store price at delivery time
    notes TEXT
);

-- 9. Reseller Orders (Direct Sales with Tiered Discounts)
CREATE TABLE IF NOT EXISTS reseller_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reseller_name TEXT NOT NULL,
    order_date TEXT NOT NULL, -- YYYY-MM-DD
    subtotal REAL DEFAULT 0.00,
    discount_percentage REAL DEFAULT 0.00,
    discount_amount REAL DEFAULT 0.00,
    tax_rate REAL DEFAULT 12.00,
    tax_amount REAL DEFAULT 0.00,
    grand_total REAL DEFAULT 0.00,
    is_paid INTEGER DEFAULT 0, -- 0 = false, 1 = true
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reseller_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES reseller_orders(id) ON DELETE CASCADE,
    sku TEXT NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    price_snapshot REAL NOT NULL
);

-- 10. Maintenance & Cleaning Task Tracker
CREATE TABLE IF NOT EXISTS maintenance_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    area TEXT NOT NULL, -- e.g., 'Production Area', 'Kitchen', 'CR'
    item_name TEXT NOT NULL,
    style_or_kind TEXT,
    condition TEXT DEFAULT 'OK', -- e.g., 'OK', 'Needs Repair', 'Needs Replacement'
    remarks TEXT,
    replacement_date TEXT, -- YYYY-MM-DD
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cleaning_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name TEXT NOT NULL UNIQUE,
    frequency TEXT DEFAULT 'Daily', -- 'Daily', 'Weekly', 'Monthly'
    last_done_date TEXT, -- YYYY-MM-DD
    remarks TEXT
);

-- 11. Transactional Inventory Ledger
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sku TEXT REFERENCES product_skus(sku) ON DELETE CASCADE,
    raw_ingredient_id INTEGER REFERENCES raw_ingredients(id) ON DELETE CASCADE,
    transaction_type TEXT NOT NULL, -- 'receive', 'consume', 'production_add', 'consignment_deduct', 'waste', 'manual_adjustment'
    qty REAL NOT NULL,
    batch_reference TEXT,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

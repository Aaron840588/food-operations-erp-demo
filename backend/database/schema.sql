-- Database Schema for Happy Noether Food Inventory System

DROP TABLE IF EXISTS inventory_transactions CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS cleaning_tasks CASCADE;
DROP TABLE IF EXISTS maintenance_assets CASCADE;
DROP TABLE IF EXISTS reseller_order_items CASCADE;
DROP TABLE IF EXISTS reseller_orders CASCADE;
DROP TABLE IF EXISTS consignment_items CASCADE;
DROP TABLE IF EXISTS consignment_deliveries CASCADE;
DROP TABLE IF EXISTS consignment_partners CASCADE;
DROP TABLE IF EXISTS recipe_items CASCADE;
DROP TABLE IF EXISTS recipes CASCADE;
DROP TABLE IF EXISTS raw_ingredients CASCADE;
DROP TABLE IF EXISTS category_overhead_rates CASCADE;
DROP TABLE IF EXISTS product_skus CASCADE;
DROP TABLE IF EXISTS gift_set_items CASCADE;
DROP TABLE IF EXISTS gift_sets CASCADE;

-- 0. Security and Identity
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL UNIQUE,
    hashed_password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'staff', -- 'owner', 'staff'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 0.1 Suppliers Directory
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 1. Raw Ingredients Inventory
CREATE TABLE IF NOT EXISTS raw_ingredients (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    category VARCHAR(100),
    unit VARCHAR(50) NOT NULL, -- e.g., 'grams', 'pcs', 'ml'
    price NUMERIC(10, 2) NOT NULL, -- Purchase price
    net_weight NUMERIC(10, 2) NOT NULL, -- Weight/volume of pack (e.g. 1000 for 1kg)
    cost_per_gram_unit NUMERIC(12, 6) DEFAULT 0.0, -- Calculated price / net_weight
    available_stock NUMERIC(10, 2) DEFAULT 0.0,
    reorder_level NUMERIC(10, 2) DEFAULT 0.0,
    shop VARCHAR(255), -- Where purchased
    brand VARCHAR(255),
    remarks TEXT,
    supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to auto-calculate cost_per_gram_unit for raw ingredients
CREATE OR REPLACE FUNCTION update_raw_ingredient_cost()
RETURNS TRIGGER AS $$
BEGIN
    NEW.cost_per_gram_unit := CASE WHEN NEW.net_weight > 0 THEN NEW.price / NEW.net_weight ELSE 0.0 END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_raw_ingredient_cost
BEFORE INSERT OR UPDATE ON raw_ingredients
FOR EACH ROW EXECUTE FUNCTION update_raw_ingredient_cost();


-- 2. Product Stock Keeping Units (SKUs)
CREATE TABLE IF NOT EXISTS product_skus (
    sku VARCHAR(100) PRIMARY KEY, -- e.g., 'YP-IND-SWT'
    product_name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL, -- e.g., 'spread', 'sauce', 'sandwich', 'pasta', 'dessert', 'pastry', 'drink'
    size VARCHAR(50) NOT NULL, -- e.g., 'Indulge', 'Sampler', 'Solo', 'Full', 'Half'
    retail_price NUMERIC(10, 2) NOT NULL, -- SRP
    reseller_price NUMERIC(10, 2) NOT NULL, -- Discounted rate for partners/resellers
    pack_qty INT DEFAULT 1, -- Pack size quantity, e.g. 2s, 4s, 5s (default 1)
    storage_life VARCHAR(100),
    serving_requirement VARCHAR(255),
    cost_override NUMERIC(10, 4) DEFAULT NULL, -- Manual override cost per unit
    cost_per_unit NUMERIC(10, 4) DEFAULT 0.0, -- Cached costing
    labor_cost NUMERIC(10, 4) DEFAULT 0.0000,
    utility_cost NUMERIC(10, 4) DEFAULT 3.2800,
    warehouse_stock INT DEFAULT 0,
    density_multiplier NUMERIC(10, 4) DEFAULT 1.0000,
    is_active BOOLEAN DEFAULT TRUE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- 3. Recipes (Bill of Materials)
CREATE TABLE IF NOT EXISTS recipes (
    id SERIAL PRIMARY KEY,
    sku VARCHAR(100) UNIQUE REFERENCES product_skus(sku) ON DELETE CASCADE,
    yield_weight NUMERIC(10, 2) NOT NULL, -- Batch output in grams or pieces
    yield_unit VARCHAR(50) DEFAULT 'g', -- 'g' or 'pcs'
    portion_size NUMERIC(10, 2), -- Portion size (e.g. 250g or 1pc)
    portion_unit VARCHAR(50) DEFAULT 'g',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Recipe Items (BOM Ingredients)
CREATE TABLE IF NOT EXISTS recipe_items (
    id SERIAL PRIMARY KEY,
    recipe_id INT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    ingredient_type VARCHAR(50) NOT NULL, -- 'raw' or 'sku'
    raw_ingredient_id INT REFERENCES raw_ingredients(id) ON DELETE SET NULL, -- if type is 'raw'
    sub_sku VARCHAR(100) REFERENCES product_skus(sku) ON DELETE SET NULL, -- if type is 'sku'
    base_qty NUMERIC(12, 4) NOT NULL, -- Weight or pieces in base recipe
    base_unit VARCHAR(50) NOT NULL
);


-- 5. Overhead and Labor Configuration
CREATE TABLE IF NOT EXISTS overhead_configs (
    id SERIAL PRIMARY KEY,
    category VARCHAR(50) NOT NULL, -- 'utility' or 'labor'
    particular VARCHAR(100) NOT NULL UNIQUE, -- e.g., 'Electricity Overall', 'Water', 'Che', 'Aimee'
    cost_per_month NUMERIC(10, 2) DEFAULT 0.0,
    cost_per_day NUMERIC(10, 2) DEFAULT 0.0,
    hourly_rate NUMERIC(10, 2) DEFAULT 0.0,
    notes TEXT
);


-- 6. Production Plans & Targets
CREATE TABLE IF NOT EXISTS production_plans (
    id SERIAL PRIMARY KEY,
    plan_date DATE UNIQUE NOT NULL,
    status VARCHAR(50) DEFAULT 'draft', -- 'draft', 'forecasted', 'completed'
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS production_targets (
    id SERIAL PRIMARY KEY,
    plan_id INT NOT NULL REFERENCES production_plans(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    outlet VARCHAR(100) NOT NULL, -- e.g., 'AA Mart', 'ECM', 'UPOU Day 2', 'Warehouse'
    target_qty INT NOT NULL
);

-- 7. Actual Production & Yield Log
CREATE TABLE IF NOT EXISTS production_batches (
    id SERIAL PRIMARY KEY,
    batch_date DATE NOT NULL,
    sku VARCHAR(100) REFERENCES product_skus(sku) ON DELETE SET NULL,
    qty_produced INT NOT NULL,
    qty_delivered INT NOT NULL,
    actual_yield NUMERIC(10, 2),
    staff_hours NUMERIC(10, 2),
    notes TEXT
);


-- 8. Consignment Partners & Deliveries
CREATE TABLE IF NOT EXISTS consignment_partners (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE NOT NULL, -- e.g. 'Likhang Laguna', 'Pinana Calauan', 'Artisan'
    discount_rate NUMERIC(5, 4) DEFAULT 0.1000, -- Default 10%
    collection_frequency VARCHAR(100) DEFAULT 'Weekly',
    minimum_order_amount NUMERIC(10, 2) DEFAULT 1500.00
);

CREATE TABLE IF NOT EXISTS consignment_deliveries (
    id SERIAL PRIMARY KEY,
    partner_id INT NOT NULL REFERENCES consignment_partners(id) ON DELETE CASCADE,
    delivery_date DATE NOT NULL,
    dr_number VARCHAR(100),
    is_paid BOOLEAN DEFAULT FALSE,
    payment_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS consignment_items (
    id SERIAL PRIMARY KEY,
    delivery_id INT NOT NULL REFERENCES consignment_deliveries(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    qty_delivered INT NOT NULL,
    units_sold INT DEFAULT 0,
    qty_pulled_out INT DEFAULT 0,
    reseller_price_snapshot NUMERIC(10, 2) NOT NULL, -- Reseller price at delivery time
    cost_per_unit_snapshot NUMERIC(10, 2) NOT NULL, -- Cached food cost per unit at delivery time
    store_price_snapshot NUMERIC(10, 2) NOT NULL, -- Store price at delivery time
    notes TEXT
);


-- 9. Reseller Orders (Direct Sales with Tiered Discounts)
CREATE TABLE IF NOT EXISTS reseller_orders (
    id SERIAL PRIMARY KEY,
    reseller_name VARCHAR(100) NOT NULL,
    order_date DATE NOT NULL,
    subtotal NUMERIC(10, 2) DEFAULT 0.00,
    discount_percentage NUMERIC(5, 2) DEFAULT 0.00,
    discount_amount NUMERIC(10, 2) DEFAULT 0.00,
    tax_rate NUMERIC(5, 2) DEFAULT 12.00,
    tax_amount NUMERIC(10, 2) DEFAULT 0.00,
    grand_total NUMERIC(10, 2) DEFAULT 0.00,
    is_paid BOOLEAN DEFAULT FALSE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reseller_order_items (
    id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES reseller_orders(id) ON DELETE CASCADE,
    sku VARCHAR(100) NOT NULL REFERENCES product_skus(sku) ON DELETE CASCADE,
    quantity INT NOT NULL,
    price_snapshot NUMERIC(10, 2) NOT NULL
);


-- 10. Maintenance & Cleaning Task Tracker
CREATE TABLE IF NOT EXISTS maintenance_assets (
    id SERIAL PRIMARY KEY,
    area VARCHAR(100) NOT NULL, -- e.g., 'Production Area', 'Kitchen', 'CR'
    item_name VARCHAR(255) NOT NULL,
    style_or_kind VARCHAR(255),
    condition VARCHAR(100) DEFAULT 'OK', -- e.g., 'OK', 'Needs Repair', 'Needs Replacement'
    remarks TEXT,
    replacement_date DATE,
    last_checked TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS cleaning_tasks (
    id SERIAL PRIMARY KEY,
    task_name VARCHAR(255) NOT NULL UNIQUE,
    frequency VARCHAR(50) DEFAULT 'Daily', -- 'Daily', 'Weekly', 'Monthly'
    last_done_date DATE,
    remarks TEXT
);

-- 11. Transactional Inventory Ledger
CREATE TABLE IF NOT EXISTS inventory_transactions (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    sku VARCHAR(100) REFERENCES product_skus(sku) ON DELETE CASCADE,
    raw_ingredient_id INT REFERENCES raw_ingredients(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL, -- 'receive', 'consume', 'production_add', 'consignment_deduct', 'waste', 'manual_adjustment'
    qty NUMERIC(10, 2) NOT NULL,
    batch_reference VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

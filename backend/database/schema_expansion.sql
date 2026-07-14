-- Schema expansion for Gift Sets & Dynamic Overhead rates
CREATE TABLE IF NOT EXISTS gift_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(255) NOT NULL UNIQUE,
    retail_price REAL NOT NULL,
    reseller_price REAL NOT NULL,
    packaging_cost REAL DEFAULT 0.0,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS gift_set_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gift_set_id INTEGER NOT NULL,
    sku VARCHAR(100) NOT NULL,
    quantity INTEGER NOT NULL,
    FOREIGN KEY(gift_set_id) REFERENCES gift_sets(id) ON DELETE CASCADE,
    FOREIGN KEY(sku) REFERENCES product_skus(sku) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS category_overhead_rates (
    category VARCHAR(100) PRIMARY KEY,
    labor_cost_per_unit REAL DEFAULT 0.0,
    utility_cost_per_unit REAL DEFAULT 0.0
);

-- Insert default category rates if not exist
INSERT OR IGNORE INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit) VALUES
('spreads', 22.50, 3.28),
('sauces', 22.50, 3.28),
('sandwiches', 6.30, 3.28),
('pasta', 10.23, 3.28),
('pastries', 5.00, 3.28),
('drinks', 5.00, 3.28);

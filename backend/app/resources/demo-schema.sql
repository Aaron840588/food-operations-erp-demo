-- Isolated fictional SQLite schema. Never apply to the production PostgreSQL database.
PRAGMA foreign_keys=OFF;

CREATE TABLE category_overhead_rates (
	category VARCHAR(100) NOT NULL, 
	labor_cost_per_unit FLOAT, 
	utility_cost_per_unit FLOAT, 
	PRIMARY KEY (category)
)

;
CREATE INDEX ix_category_overhead_rates_category ON category_overhead_rates (category);

CREATE TABLE cleaning_tasks (
	id INTEGER NOT NULL, 
	task_name VARCHAR(255) NOT NULL, 
	frequency VARCHAR(50), 
	last_done_date VARCHAR(10), 
	remarks TEXT, 
	PRIMARY KEY (id), 
	UNIQUE (task_name)
)

;
CREATE INDEX ix_cleaning_tasks_id ON cleaning_tasks (id);

CREATE TABLE consignment_partners (
	id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	discount_rate FLOAT, 
	collection_frequency VARCHAR(100), 
	minimum_order_amount FLOAT, 
	is_active BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE UNIQUE INDEX ix_consignment_partners_name ON consignment_partners (name);
CREATE INDEX ix_consignment_partners_id ON consignment_partners (id);

CREATE TABLE discount_tiers (
	id INTEGER NOT NULL, 
	min_subtotal FLOAT NOT NULL, 
	discount_percentage FLOAT NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (min_subtotal)
)

;
CREATE INDEX ix_discount_tiers_id ON discount_tiers (id);

CREATE TABLE gift_sets (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	retail_price FLOAT NOT NULL, 
	reseller_price FLOAT NOT NULL, 
	packaging_cost FLOAT, 
	notes TEXT, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_gift_sets_id ON gift_sets (id);
CREATE UNIQUE INDEX ix_gift_sets_name ON gift_sets (name);

CREATE TABLE login_rate_limits (
	id INTEGER NOT NULL, 
	scope VARCHAR(20) NOT NULL, 
	identifier_hash VARCHAR(64) NOT NULL, 
	failures INTEGER NOT NULL, 
	window_started_at DATETIME NOT NULL, 
	locked_until DATETIME, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_login_rate_limits_scope_identifier UNIQUE (scope, identifier_hash)
)

;
CREATE INDEX ix_login_rate_limits_id ON login_rate_limits (id);

CREATE TABLE maintenance_assets (
	id INTEGER NOT NULL, 
	area VARCHAR(100) NOT NULL, 
	item_name VARCHAR(255) NOT NULL, 
	style_or_kind VARCHAR(255), 
	condition VARCHAR(100), 
	remarks TEXT, 
	replacement_date VARCHAR(10), 
	last_checked DATETIME, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_maintenance_assets_id ON maintenance_assets (id);

CREATE TABLE market_events (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	event_date VARCHAR(10) NOT NULL, 
	location VARCHAR(255) NOT NULL, 
	staff_assigned VARCHAR(255), 
	notes TEXT, 
	status VARCHAR(50), 
	is_deleted BOOLEAN, 
	initial_cash_balance FLOAT NOT NULL, 
	actual_closing_cash FLOAT, 
	cash_adjustments FLOAT NOT NULL, 
	cash_adjustments_notes TEXT NOT NULL, 
	total_expenses FLOAT NOT NULL, 
	expense_notes TEXT NOT NULL, 
	cash_expenses NUMERIC(12, 2) NOT NULL, 
	cash_refunds NUMERIC(12, 2) NOT NULL, 
	gcash_sales NUMERIC(12, 2), 
	bpi_sales NUMERIC(12, 2), 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_market_events_event_date ON market_events (event_date);
CREATE INDEX ix_market_events_id ON market_events (id);
CREATE INDEX ix_market_events_name ON market_events (name);

CREATE TABLE overhead_configs (
	id INTEGER NOT NULL, 
	category VARCHAR(50) NOT NULL, 
	particular VARCHAR(100) NOT NULL, 
	cost_per_month FLOAT, 
	cost_per_day FLOAT, 
	hourly_rate FLOAT, 
	notes TEXT, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_overhead_configs_id ON overhead_configs (id);
CREATE UNIQUE INDEX ix_overhead_configs_particular ON overhead_configs (particular);

CREATE TABLE product_skus (
	sku VARCHAR(100) NOT NULL, 
	product_name VARCHAR(255) NOT NULL, 
	category VARCHAR(100) NOT NULL, 
	size VARCHAR(50) NOT NULL, 
	retail_price FLOAT NOT NULL, 
	reseller_price FLOAT NOT NULL, 
	pack_qty INTEGER, 
	storage_life VARCHAR(100), 
	serving_requirement VARCHAR(255), 
	cost_override FLOAT, 
	cost_per_unit FLOAT, 
	labor_cost FLOAT NOT NULL, 
	utility_cost FLOAT NOT NULL, 
	warehouse_stock INTEGER, 
	density_multiplier FLOAT, 
	is_active BOOLEAN NOT NULL, 
	last_updated DATETIME, 
	PRIMARY KEY (sku), 
	CONSTRAINT check_positive_warehouse_stock CHECK (warehouse_stock >= 0)
)

;
CREATE INDEX ix_product_skus_sku ON product_skus (sku);
CREATE INDEX ix_product_skus_product_name ON product_skus (product_name);

CREATE TABLE production_plans (
	id INTEGER NOT NULL, 
	plan_date VARCHAR(10) NOT NULL, 
	status VARCHAR(50), 
	created_at DATETIME, 
	PRIMARY KEY (id)
)

;
CREATE UNIQUE INDEX ix_production_plans_plan_date ON production_plans (plan_date);
CREATE INDEX ix_production_plans_id ON production_plans (id);

CREATE TABLE reseller_orders (
	id INTEGER NOT NULL, 
	reseller_name VARCHAR(100) NOT NULL, 
	order_date VARCHAR(10) NOT NULL, 
	subtotal FLOAT, 
	discount_percentage FLOAT, 
	discount_amount FLOAT, 
	tax_rate FLOAT, 
	tax_amount FLOAT, 
	grand_total FLOAT, 
	is_paid BOOLEAN, 
	notes TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_reseller_orders_id ON reseller_orders (id);

CREATE TABLE sheet_sync_sources (
	id INTEGER NOT NULL, 
	source_key VARCHAR(100) NOT NULL, 
	display_name VARCHAR(255) NOT NULL, 
	spreadsheet_id VARCHAR(128) NOT NULL, 
	sheet_name VARCHAR(255) NOT NULL, 
	cell_range VARCHAR(64) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_sheet_sync_sources_id ON sheet_sync_sources (id);
CREATE UNIQUE INDEX ix_sheet_sync_sources_source_key ON sheet_sync_sources (source_key);

CREATE TABLE suppliers (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	contact_person VARCHAR(255), 
	email VARCHAR(255), 
	phone VARCHAR(50), 
	address TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_suppliers_id ON suppliers (id);
CREATE UNIQUE INDEX ix_suppliers_name ON suppliers (name);

CREATE TABLE users (
	id INTEGER NOT NULL, 
	username VARCHAR(100) NOT NULL, 
	hashed_password VARCHAR(255) NOT NULL, 
	role VARCHAR(50) NOT NULL, 
	is_active BOOLEAN, 
	hourly_rate FLOAT NOT NULL, 
	PRIMARY KEY (id)
)

;
CREATE UNIQUE INDEX ix_users_username ON users (username);
CREATE INDEX ix_users_id ON users (id);

CREATE TABLE warehouses (
	id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	location VARCHAR(255), 
	is_active BOOLEAN, 
	PRIMARY KEY (id)
)

;
CREATE INDEX ix_warehouses_id ON warehouses (id);
CREATE UNIQUE INDEX ix_warehouses_name ON warehouses (name);

CREATE TABLE consignment_deliveries (
	id INTEGER NOT NULL, 
	partner_id INTEGER NOT NULL, 
	delivery_date VARCHAR(10) NOT NULL, 
	dr_number VARCHAR(100), 
	is_paid BOOLEAN, 
	payment_date VARCHAR(10), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(partner_id) REFERENCES consignment_partners (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_consignment_deliveries_id ON consignment_deliveries (id);
CREATE INDEX ix_consignment_deliveries_delivery_date ON consignment_deliveries (delivery_date);

CREATE TABLE gift_set_items (
	id INTEGER NOT NULL, 
	gift_set_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	quantity INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(gift_set_id) REFERENCES gift_sets (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_gift_set_items_sku ON gift_set_items (sku);
CREATE INDEX ix_gift_set_items_id ON gift_set_items (id);
CREATE INDEX ix_gift_set_items_gift_set_id ON gift_set_items (gift_set_id);

CREATE TABLE market_event_allocations (
	id INTEGER NOT NULL, 
	event_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	quantity INTEGER NOT NULL, 
	wasted_quantity INTEGER NOT NULL, 
	waste_reason VARCHAR(255), 
	PRIMARY KEY (id), 
	FOREIGN KEY(event_id) REFERENCES market_events (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_market_event_allocations_id ON market_event_allocations (id);

CREATE TABLE market_event_sales (
	id INTEGER NOT NULL, 
	event_id INTEGER NOT NULL, 
	cashier_id INTEGER, 
	client_reference VARCHAR(64), 
	payment_method VARCHAR(100) NOT NULL, 
	subtotal_amount NUMERIC(12, 2) NOT NULL, 
	discount_type VARCHAR(20), 
	discount_value NUMERIC(12, 2), 
	manual_discount_amount NUMERIC(12, 2) NOT NULL, 
	promotion_code VARCHAR(50), 
	promotion_discount_amount NUMERIC(12, 2) NOT NULL, 
	promotion_snapshot TEXT, 
	discount_amount NUMERIC(12, 2) NOT NULL, 
	total_amount NUMERIC(12, 2) NOT NULL, 
	cash_received NUMERIC(12, 2), 
	change_given NUMERIC(12, 2) NOT NULL, 
	tip_amount NUMERIC(12, 2) NOT NULL, 
	payment_reference VARCHAR(100), 
	customer_name VARCHAR(255), 
	timestamp DATETIME, 
	is_preorder BOOLEAN NOT NULL, 
	preorder_customer_name VARCHAR(255), 
	preorder_payment_status VARCHAR(50), 
	preorder_fulfillment_status VARCHAR(50), 
	PRIMARY KEY (id), 
	CONSTRAINT uq_market_event_sale_client_reference UNIQUE (event_id, client_reference), 
	FOREIGN KEY(event_id) REFERENCES market_events (id) ON DELETE CASCADE, 
	FOREIGN KEY(cashier_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_market_event_sales_cashier_id ON market_event_sales (cashier_id);
CREATE INDEX ix_market_event_sales_id ON market_event_sales (id);

CREATE TABLE preorder_forms (
	id INTEGER NOT NULL, 
	name VARCHAR(120) NOT NULL, 
	token_hash VARCHAR(64) NOT NULL, 
	token_hint VARCHAR(12) NOT NULL, 
	is_enabled BOOLEAN NOT NULL, 
	event_id INTEGER, 
	fulfillment_methods_json TEXT NOT NULL, 
	payment_preferences_json TEXT NOT NULL, 
	extension_json TEXT NOT NULL, 
	created_by_user_id INTEGER, 
	updated_by_user_id INTEGER, 
	created_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	updated_at DATETIME DEFAULT (CURRENT_TIMESTAMP) NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT check_preorder_form_token_hash CHECK (length(token_hash) = 64), 
	CONSTRAINT check_preorder_form_name CHECK (length(trim(name)) > 0), 
	FOREIGN KEY(event_id) REFERENCES market_events (id) ON DELETE RESTRICT, 
	FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_preorder_forms_is_enabled ON preorder_forms (is_enabled);
CREATE INDEX ix_preorder_forms_updated_by_user_id ON preorder_forms (updated_by_user_id);
CREATE INDEX ix_preorder_forms_created_by_user_id ON preorder_forms (created_by_user_id);
CREATE INDEX ix_preorder_forms_id ON preorder_forms (id);
CREATE INDEX ix_preorder_forms_event_id ON preorder_forms (event_id);
CREATE UNIQUE INDEX ix_preorder_forms_token_hash ON preorder_forms (token_hash);

CREATE TABLE production_batches (
	id INTEGER NOT NULL, 
	batch_date VARCHAR(10) NOT NULL, 
	sku VARCHAR(100), 
	qty_produced INTEGER NOT NULL, 
	qty_delivered INTEGER NOT NULL, 
	actual_yield FLOAT, 
	staff_hours FLOAT, 
	notes TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE SET NULL
)

;
CREATE INDEX ix_production_batches_id ON production_batches (id);
CREATE INDEX ix_production_batches_sku ON production_batches (sku);
CREATE INDEX ix_production_batches_batch_date ON production_batches (batch_date);

CREATE TABLE production_targets (
	id INTEGER NOT NULL, 
	plan_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	outlet VARCHAR(100) NOT NULL, 
	target_qty INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(plan_id) REFERENCES production_plans (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_production_targets_sku ON production_targets (sku);
CREATE INDEX ix_production_targets_id ON production_targets (id);

CREATE TABLE push_subscriptions (
	id INTEGER NOT NULL, 
	user_id INTEGER, 
	endpoint TEXT NOT NULL, 
	p256dh VARCHAR(255) NOT NULL, 
	auth VARCHAR(255) NOT NULL, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL, 
	UNIQUE (endpoint)
)

;
CREATE INDEX ix_push_subscriptions_id ON push_subscriptions (id);
CREATE INDEX ix_push_subscriptions_user_id ON push_subscriptions (user_id);

CREATE TABLE raw_ingredients (
	id INTEGER NOT NULL, 
	name VARCHAR(255) NOT NULL, 
	category VARCHAR(100), 
	unit VARCHAR(50) NOT NULL, 
	price FLOAT NOT NULL, 
	net_weight FLOAT NOT NULL, 
	cost_per_gram_unit FLOAT, 
	available_stock FLOAT, 
	reorder_level FLOAT, 
	shop VARCHAR(255), 
	brand VARCHAR(255), 
	remarks TEXT, 
	last_updated DATETIME, 
	supplier_id INTEGER, 
	PRIMARY KEY (id), 
	CONSTRAINT check_positive_available_stock CHECK (available_stock >= 0.0), 
	FOREIGN KEY(supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL
)

;
CREATE UNIQUE INDEX ix_raw_ingredients_name ON raw_ingredients (name);
CREATE INDEX ix_raw_ingredients_supplier_id ON raw_ingredients (supplier_id);
CREATE INDEX ix_raw_ingredients_id ON raw_ingredients (id);

CREATE TABLE recipes (
	id INTEGER NOT NULL, 
	sku VARCHAR(100), 
	yield_weight FLOAT NOT NULL, 
	yield_unit VARCHAR(50), 
	portion_size FLOAT, 
	portion_unit VARCHAR(50), 
	notes TEXT, 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	UNIQUE (sku), 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_recipes_id ON recipes (id);

CREATE TABLE refresh_tokens (
	id INTEGER NOT NULL, 
	token VARCHAR(255) NOT NULL, 
	username VARCHAR(255) NOT NULL, 
	expires_at DATETIME NOT NULL, 
	created_at DATETIME, 
	is_revoked BOOLEAN, 
	PRIMARY KEY (id), 
	FOREIGN KEY(username) REFERENCES users (username) ON DELETE CASCADE
)

;
CREATE UNIQUE INDEX ix_refresh_tokens_token ON refresh_tokens (token);
CREATE INDEX ix_refresh_tokens_id ON refresh_tokens (id);
CREATE INDEX ix_refresh_tokens_username ON refresh_tokens (username);

CREATE TABLE reseller_order_items (
	id INTEGER NOT NULL, 
	order_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	quantity INTEGER NOT NULL, 
	price_snapshot FLOAT NOT NULL, 
	food_cost_snapshot FLOAT, 
	labor_cost_snapshot FLOAT, 
	utility_cost_snapshot FLOAT, 
	total_cost_snapshot FLOAT, 
	cost_status_snapshot VARCHAR(30), 
	cost_snapshot_recorded_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(order_id) REFERENCES reseller_orders (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_reseller_order_items_id ON reseller_order_items (id);
CREATE INDEX ix_reseller_order_items_order_id ON reseller_order_items (order_id);
CREATE INDEX ix_reseller_order_items_sku ON reseller_order_items (sku);

CREATE TABLE sheet_sync_mappings (
	id INTEGER NOT NULL, 
	source_id INTEGER NOT NULL, 
	source_header VARCHAR(255) NOT NULL, 
	destination_entity VARCHAR(100) NOT NULL, 
	destination_field VARCHAR(100) NOT NULL, 
	expected_type VARCHAR(50) NOT NULL, 
	risk_level VARCHAR(20) NOT NULL, 
	approval_mode VARCHAR(30) NOT NULL, 
	is_active BOOLEAN NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sheet_sync_mapping_definition UNIQUE (source_id, source_header, destination_entity, destination_field), 
	CONSTRAINT check_sheet_sync_mapping_approval CHECK (approval_mode IN ('manual_review', 'auto_apply')), 
	FOREIGN KEY(source_id) REFERENCES sheet_sync_sources (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_sheet_sync_mappings_id ON sheet_sync_mappings (id);
CREATE INDEX ix_sheet_sync_mappings_source_id ON sheet_sync_mappings (source_id);

CREATE TABLE sheet_sync_runs (
	id INTEGER NOT NULL, 
	public_id VARCHAR(36) NOT NULL, 
	trigger_type VARCHAR(30) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	source_keys_json TEXT NOT NULL, 
	summary_json TEXT NOT NULL, 
	requested_by_user_id INTEGER, 
	started_at DATETIME NOT NULL, 
	completed_at DATETIME, 
	error_code VARCHAR(100), 
	error_message TEXT, 
	PRIMARY KEY (id), 
	CONSTRAINT check_sheet_sync_run_status CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed')), 
	FOREIGN KEY(requested_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_sheet_sync_runs_status ON sheet_sync_runs (status);
CREATE UNIQUE INDEX ix_sheet_sync_runs_public_id ON sheet_sync_runs (public_id);
CREATE INDEX ix_sheet_sync_runs_requested_by_user_id ON sheet_sync_runs (requested_by_user_id);
CREATE INDEX ix_sheet_sync_runs_id ON sheet_sync_runs (id);

CREATE TABLE timesheet_entries (
	id INTEGER NOT NULL, 
	client_reference VARCHAR(64), 
	employee_user_id INTEGER, 
	employee_name VARCHAR(100) NOT NULL, 
	machine_employee_id VARCHAR(100), 
	work_date VARCHAR(10) NOT NULL, 
	clock_in DATETIME, 
	clock_out DATETIME, 
	source VARCHAR(20) NOT NULL, 
	review_status VARCHAR(20) NOT NULL, 
	proof_image_data TEXT, 
	proof_image_type VARCHAR(50), 
	notes TEXT, 
	imported_by_user_id INTEGER, 
	production_plan_id INTEGER, 
	approved_hourly_rate FLOAT, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(employee_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(imported_by_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(production_plan_id) REFERENCES production_plans (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_timesheet_entries_id ON timesheet_entries (id);
CREATE INDEX ix_timesheet_entries_imported_by_user_id ON timesheet_entries (imported_by_user_id);
CREATE UNIQUE INDEX ix_timesheet_entries_client_reference ON timesheet_entries (client_reference);
CREATE INDEX ix_timesheet_entries_work_date ON timesheet_entries (work_date);
CREATE INDEX ix_timesheet_entries_employee_name ON timesheet_entries (employee_name);
CREATE INDEX ix_timesheet_entries_employee_user_id ON timesheet_entries (employee_user_id);
CREATE INDEX ix_timesheet_entries_machine_employee_id ON timesheet_entries (machine_employee_id);
CREATE INDEX ix_timesheet_entries_production_plan_id ON timesheet_entries (production_plan_id);

CREATE TABLE consignment_items (
	id INTEGER NOT NULL, 
	delivery_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	qty_delivered INTEGER NOT NULL, 
	units_sold INTEGER, 
	qty_pulled_out INTEGER, 
	reseller_price_snapshot FLOAT NOT NULL, 
	cost_per_unit_snapshot FLOAT NOT NULL, 
	food_cost_snapshot FLOAT, 
	labor_cost_snapshot FLOAT, 
	utility_cost_snapshot FLOAT, 
	total_cost_snapshot FLOAT, 
	cost_status_snapshot VARCHAR(30), 
	cost_snapshot_recorded_at DATETIME, 
	store_price_snapshot FLOAT NOT NULL, 
	notes TEXT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(delivery_id) REFERENCES consignment_deliveries (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_consignment_items_id ON consignment_items (id);

CREATE TABLE ingredient_batches (
	id INTEGER NOT NULL, 
	raw_ingredient_id INTEGER NOT NULL, 
	batch_code VARCHAR(100) NOT NULL, 
	quantity FLOAT, 
	expiry_date VARCHAR(10), 
	created_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(raw_ingredient_id) REFERENCES raw_ingredients (id) ON DELETE CASCADE
)

;
CREATE INDEX ix_ingredient_batches_raw_ingredient_id ON ingredient_batches (raw_ingredient_id);
CREATE INDEX ix_ingredient_batches_id ON ingredient_batches (id);
CREATE INDEX ix_ingredient_batches_expiry_date ON ingredient_batches (expiry_date);

CREATE TABLE ingredient_price_history (
	id INTEGER NOT NULL, 
	raw_ingredient_id INTEGER NOT NULL, 
	previous_price FLOAT NOT NULL, 
	new_price FLOAT NOT NULL, 
	previous_net_weight FLOAT NOT NULL, 
	new_net_weight FLOAT NOT NULL, 
	previous_unit_cost FLOAT NOT NULL, 
	new_unit_cost FLOAT NOT NULL, 
	changed_by_user_id INTEGER, 
	source VARCHAR(50) NOT NULL, 
	changed_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(raw_ingredient_id) REFERENCES raw_ingredients (id) ON DELETE CASCADE, 
	FOREIGN KEY(changed_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_ingredient_price_history_changed_by_user_id ON ingredient_price_history (changed_by_user_id);
CREATE INDEX ix_ingredient_price_history_raw_ingredient_id ON ingredient_price_history (raw_ingredient_id);
CREATE INDEX ix_ingredient_price_history_changed_at ON ingredient_price_history (changed_at);
CREATE INDEX ix_ingredient_price_history_id ON ingredient_price_history (id);

CREATE TABLE inventory_transactions (
	id INTEGER NOT NULL, 
	user_id INTEGER, 
	sku VARCHAR(100), 
	raw_ingredient_id INTEGER, 
	transaction_type VARCHAR(50) NOT NULL, 
	qty FLOAT NOT NULL, 
	batch_reference VARCHAR(100), 
	notes TEXT, 
	created_at DATETIME, 
	warehouse_id INTEGER, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE, 
	FOREIGN KEY(raw_ingredient_id) REFERENCES raw_ingredients (id) ON DELETE CASCADE, 
	FOREIGN KEY(warehouse_id) REFERENCES warehouses (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_inventory_transactions_raw_ingredient_id ON inventory_transactions (raw_ingredient_id);
CREATE INDEX ix_inventory_transactions_warehouse_id ON inventory_transactions (warehouse_id);
CREATE INDEX ix_inventory_transactions_user_id ON inventory_transactions (user_id);
CREATE INDEX ix_inventory_transactions_id ON inventory_transactions (id);
CREATE INDEX ix_inventory_transactions_sku ON inventory_transactions (sku);

CREATE TABLE market_event_sale_items (
	id INTEGER NOT NULL, 
	sale_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	quantity INTEGER NOT NULL, 
	price_snapshot NUMERIC(12, 2) NOT NULL, 
	food_cost_snapshot FLOAT, 
	labor_cost_snapshot FLOAT, 
	utility_cost_snapshot FLOAT, 
	total_cost_snapshot FLOAT, 
	cost_status_snapshot VARCHAR(30), 
	cost_snapshot_recorded_at DATETIME, 
	PRIMARY KEY (id), 
	FOREIGN KEY(sale_id) REFERENCES market_event_sales (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_market_event_sale_items_id ON market_event_sale_items (id);
CREATE INDEX ix_market_event_sale_items_sku ON market_event_sale_items (sku);

CREATE TABLE preorders (
	id INTEGER NOT NULL, 
	public_reference VARCHAR(24) NOT NULL, 
	form_id INTEGER NOT NULL, 
	event_id INTEGER, 
	submission_reference VARCHAR(64) NOT NULL, 
	submission_fingerprint VARCHAR(64) NOT NULL, 
	fulfillment_client_reference VARCHAR(64) NOT NULL, 
	customer_name VARCHAR(120) NOT NULL, 
	contact_email VARCHAR(254), 
	contact_phone VARCHAR(50), 
	requested_fulfillment_date DATE NOT NULL, 
	requested_fulfillment_time TIME NOT NULL, 
	fulfillment_method VARCHAR(20) NOT NULL, 
	delivery_address TEXT, 
	notes TEXT, 
	payment_preference VARCHAR(100), 
	status VARCHAR(20) NOT NULL, 
	payment_status VARCHAR(20) NOT NULL, 
	total_amount NUMERIC(12, 2) NOT NULL, 
	fulfillment_payment_status_intent VARCHAR(20), 
	extension_json TEXT NOT NULL, 
	fulfillment_sale_id INTEGER, 
	updated_by_user_id INTEGER, 
	created_at DATETIME NOT NULL, 
	updated_at DATETIME NOT NULL, 
	fulfilled_at DATETIME, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_preorder_form_submission_reference UNIQUE (form_id, submission_reference), 
	CONSTRAINT check_preorder_status CHECK (status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')), 
	CONSTRAINT check_preorder_payment_status CHECK (payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')), 
	CONSTRAINT check_preorder_fulfillment_method CHECK (fulfillment_method IN ('Pickup', 'Delivery')), 
	CONSTRAINT check_preorder_total_positive CHECK (total_amount > 0), 
	CONSTRAINT check_preorder_submission_fingerprint CHECK (length(submission_fingerprint) = 64), 
	CONSTRAINT check_preorder_public_reference CHECK (length(public_reference) >= 12), 
	CONSTRAINT check_preorder_contact_present CHECK (((contact_email IS NOT NULL AND length(trim(contact_email)) > 0) OR (contact_phone IS NOT NULL AND length(trim(contact_phone)) > 0))), 
	CONSTRAINT check_preorder_delivery_address CHECK ((fulfillment_method = 'Pickup' OR (delivery_address IS NOT NULL AND length(trim(delivery_address)) > 0))), 
	CONSTRAINT check_preorder_fulfillment_intent CHECK ((fulfillment_payment_status_intent IS NULL OR fulfillment_payment_status_intent IN ('Paid', 'Receivable'))), 
	CONSTRAINT check_preorder_fulfillment_link CHECK (((status = 'Fulfilled' AND fulfillment_sale_id IS NOT NULL AND fulfilled_at IS NOT NULL) OR (status <> 'Fulfilled' AND fulfillment_sale_id IS NULL AND fulfilled_at IS NULL))), 
	FOREIGN KEY(form_id) REFERENCES preorder_forms (id) ON DELETE RESTRICT, 
	FOREIGN KEY(event_id) REFERENCES market_events (id) ON DELETE RESTRICT, 
	FOREIGN KEY(fulfillment_sale_id) REFERENCES market_event_sales (id) ON DELETE RESTRICT, 
	FOREIGN KEY(updated_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_preorders_created_at ON preorders (created_at);
CREATE INDEX ix_preorders_event_id ON preorders (event_id);
CREATE INDEX ix_preorders_payment_status ON preorders (payment_status);
CREATE UNIQUE INDEX ix_preorders_public_reference ON preorders (public_reference);
CREATE INDEX ix_preorders_customer_name ON preorders (customer_name);
CREATE INDEX ix_preorders_form_id ON preorders (form_id);
CREATE INDEX ix_preorders_contact_email ON preorders (contact_email);
CREATE INDEX ix_preorders_updated_by_user_id ON preorders (updated_by_user_id);
CREATE INDEX ix_preorders_fulfillment_method ON preorders (fulfillment_method);
CREATE INDEX ix_preorders_contact_phone ON preorders (contact_phone);
CREATE UNIQUE INDEX ix_preorders_fulfillment_sale_id ON preorders (fulfillment_sale_id);
CREATE UNIQUE INDEX ix_preorders_fulfillment_client_reference ON preorders (fulfillment_client_reference);
CREATE INDEX ix_preorders_id ON preorders (id);
CREATE INDEX ix_preorders_requested_fulfillment_date ON preorders (requested_fulfillment_date);
CREATE INDEX ix_preorders_status ON preorders (status);

CREATE TABLE recipe_items (
	id INTEGER NOT NULL, 
	recipe_id INTEGER NOT NULL, 
	ingredient_type VARCHAR(50) NOT NULL, 
	raw_ingredient_id INTEGER, 
	sub_sku VARCHAR(100), 
	base_qty FLOAT NOT NULL, 
	base_unit VARCHAR(50) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(recipe_id) REFERENCES recipes (id) ON DELETE CASCADE, 
	FOREIGN KEY(raw_ingredient_id) REFERENCES raw_ingredients (id) ON DELETE SET NULL, 
	FOREIGN KEY(sub_sku) REFERENCES product_skus (sku) ON DELETE SET NULL
)

;
CREATE INDEX ix_recipe_items_id ON recipe_items (id);
CREATE INDEX ix_recipe_items_sub_sku ON recipe_items (sub_sku);
CREATE INDEX ix_recipe_items_raw_ingredient_id ON recipe_items (raw_ingredient_id);

CREATE TABLE sheet_sync_snapshots (
	id INTEGER NOT NULL, 
	run_id INTEGER NOT NULL, 
	source_id INTEGER NOT NULL, 
	stable_identifier VARCHAR(255), 
	row_number INTEGER NOT NULL, 
	raw_payload_json TEXT NOT NULL, 
	normalized_payload_json TEXT NOT NULL, 
	payload_hash VARCHAR(64) NOT NULL, 
	validation_status VARCHAR(30) NOT NULL, 
	validation_errors_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_sheet_sync_snapshot_row UNIQUE (run_id, source_id, row_number), 
	CONSTRAINT check_sheet_sync_snapshot_validation_status CHECK (validation_status IN ('valid', 'invalid', 'duplicate', 'missing_identifier', 'blank')), 
	FOREIGN KEY(run_id) REFERENCES sheet_sync_runs (id) ON DELETE CASCADE, 
	FOREIGN KEY(source_id) REFERENCES sheet_sync_sources (id) ON DELETE RESTRICT
)

;
CREATE INDEX ix_sheet_sync_snapshots_id ON sheet_sync_snapshots (id);
CREATE INDEX ix_sheet_sync_snapshots_payload_hash ON sheet_sync_snapshots (payload_hash);
CREATE INDEX ix_sheet_sync_snapshots_stable_identifier ON sheet_sync_snapshots (stable_identifier);
CREATE INDEX ix_sheet_sync_snapshots_source_id ON sheet_sync_snapshots (source_id);
CREATE INDEX ix_sheet_sync_snapshots_run_id ON sheet_sync_snapshots (run_id);

CREATE TABLE warehouse_stocks (
	id INTEGER NOT NULL, 
	warehouse_id INTEGER NOT NULL, 
	raw_ingredient_id INTEGER, 
	sku VARCHAR(100), 
	quantity FLOAT, 
	PRIMARY KEY (id), 
	FOREIGN KEY(warehouse_id) REFERENCES warehouses (id) ON DELETE CASCADE, 
	FOREIGN KEY(raw_ingredient_id) REFERENCES raw_ingredients (id) ON DELETE CASCADE, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE CASCADE
)

;
CREATE INDEX ix_warehouse_stocks_raw_ingredient_id ON warehouse_stocks (raw_ingredient_id);
CREATE INDEX ix_warehouse_stocks_sku ON warehouse_stocks (sku);
CREATE INDEX ix_warehouse_stocks_id ON warehouse_stocks (id);

CREATE TABLE preorder_audit_events (
	id INTEGER NOT NULL, 
	form_id INTEGER, 
	preorder_id INTEGER, 
	action VARCHAR(50) NOT NULL, 
	actor_user_id INTEGER, 
	actor_username_snapshot VARCHAR(100) NOT NULL, 
	payload_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT check_preorder_audit_single_subject CHECK (((form_id IS NOT NULL AND preorder_id IS NULL) OR (form_id IS NULL AND preorder_id IS NOT NULL))), 
	FOREIGN KEY(form_id) REFERENCES preorder_forms (id) ON DELETE RESTRICT, 
	FOREIGN KEY(preorder_id) REFERENCES preorders (id) ON DELETE RESTRICT, 
	FOREIGN KEY(actor_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_preorder_audit_events_actor_user_id ON preorder_audit_events (actor_user_id);
CREATE INDEX ix_preorder_audit_events_created_at ON preorder_audit_events (created_at);
CREATE INDEX ix_preorder_audit_events_preorder_id ON preorder_audit_events (preorder_id);
CREATE INDEX ix_preorder_audit_events_id ON preorder_audit_events (id);
CREATE INDEX ix_preorder_audit_events_form_id ON preorder_audit_events (form_id);
CREATE INDEX ix_preorder_audit_events_action ON preorder_audit_events (action);

CREATE TABLE preorder_items (
	id INTEGER NOT NULL, 
	preorder_id INTEGER NOT NULL, 
	sku VARCHAR(100) NOT NULL, 
	product_name_snapshot VARCHAR(255) NOT NULL, 
	size_snapshot VARCHAR(50) NOT NULL, 
	quantity INTEGER NOT NULL, 
	unit_price_snapshot NUMERIC(12, 2) NOT NULL, 
	line_total_snapshot NUMERIC(12, 2) NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_preorder_item_sku UNIQUE (preorder_id, sku), 
	CONSTRAINT check_preorder_item_quantity_positive CHECK (quantity > 0), 
	CONSTRAINT check_preorder_item_unit_price_positive CHECK (unit_price_snapshot > 0), 
	CONSTRAINT check_preorder_item_line_total_positive CHECK (line_total_snapshot > 0), 
	FOREIGN KEY(preorder_id) REFERENCES preorders (id) ON DELETE RESTRICT, 
	FOREIGN KEY(sku) REFERENCES product_skus (sku) ON DELETE RESTRICT
)

;
CREATE INDEX ix_preorder_items_sku ON preorder_items (sku);
CREATE INDEX ix_preorder_items_id ON preorder_items (id);
CREATE INDEX ix_preorder_items_preorder_id ON preorder_items (preorder_id);

CREATE TABLE preorder_status_history (
	id INTEGER NOT NULL, 
	preorder_id INTEGER NOT NULL, 
	sequence_number INTEGER NOT NULL, 
	action VARCHAR(50) NOT NULL, 
	source VARCHAR(20) NOT NULL, 
	from_status VARCHAR(20), 
	to_status VARCHAR(20) NOT NULL, 
	from_payment_status VARCHAR(20), 
	to_payment_status VARCHAR(20) NOT NULL, 
	actor_user_id INTEGER, 
	actor_username_snapshot VARCHAR(100), 
	note TEXT, 
	payload_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT uq_preorder_status_history_sequence UNIQUE (preorder_id, sequence_number), 
	CONSTRAINT check_preorder_history_to_status CHECK (to_status IN ('Pending', 'Confirmed', 'Preparing', 'Ready', 'Fulfilled', 'Cancelled', 'No-show')), 
	CONSTRAINT check_preorder_history_to_payment_status CHECK (to_payment_status IN ('Unpaid', 'Partial', 'Paid', 'Receivable', 'Refunded')), 
	CONSTRAINT check_preorder_history_source CHECK (source IN ('public', 'internal', 'system')), 
	CONSTRAINT check_preorder_history_internal_actor CHECK ((source <> 'internal' OR actor_username_snapshot IS NOT NULL)), 
	FOREIGN KEY(preorder_id) REFERENCES preorders (id) ON DELETE RESTRICT, 
	FOREIGN KEY(actor_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_preorder_status_history_actor_user_id ON preorder_status_history (actor_user_id);
CREATE INDEX ix_preorder_status_history_created_at ON preorder_status_history (created_at);
CREATE INDEX ix_preorder_status_history_preorder_id ON preorder_status_history (preorder_id);
CREATE INDEX ix_preorder_status_history_action ON preorder_status_history (action);
CREATE INDEX ix_preorder_status_history_id ON preorder_status_history (id);

CREATE TABLE sheet_sync_changes (
	id INTEGER NOT NULL, 
	public_id VARCHAR(36) NOT NULL, 
	fingerprint VARCHAR(64) NOT NULL, 
	run_id INTEGER NOT NULL, 
	source_id INTEGER NOT NULL, 
	snapshot_id INTEGER NOT NULL, 
	stable_identifier VARCHAR(255) NOT NULL, 
	source_row_number INTEGER NOT NULL, 
	source_header VARCHAR(255) NOT NULL, 
	destination_entity VARCHAR(100) NOT NULL, 
	destination_field VARCHAR(100) NOT NULL, 
	raw_source_value_json TEXT NOT NULL, 
	previous_value_json TEXT NOT NULL, 
	proposed_value_json TEXT NOT NULL, 
	destination_version VARCHAR(64) NOT NULL, 
	risk_level VARCHAR(20) NOT NULL, 
	approval_mode VARCHAR(30) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	detected_at DATETIME NOT NULL, 
	decided_at DATETIME, 
	applied_at DATETIME, 
	decided_by_user_id INTEGER, 
	applied_by_user_id INTEGER, 
	resolution_note TEXT, 
	error_code VARCHAR(100), 
	error_message TEXT, 
	PRIMARY KEY (id), 
	CONSTRAINT check_sheet_sync_change_status CHECK (status IN ('pending', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict')), 
	CONSTRAINT check_sheet_sync_change_approval CHECK (approval_mode IN ('manual_review', 'auto_apply')), 
	FOREIGN KEY(run_id) REFERENCES sheet_sync_runs (id) ON DELETE RESTRICT, 
	FOREIGN KEY(source_id) REFERENCES sheet_sync_sources (id) ON DELETE RESTRICT, 
	FOREIGN KEY(snapshot_id) REFERENCES sheet_sync_snapshots (id) ON DELETE RESTRICT, 
	FOREIGN KEY(decided_by_user_id) REFERENCES users (id) ON DELETE SET NULL, 
	FOREIGN KEY(applied_by_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_sheet_sync_changes_run_id ON sheet_sync_changes (run_id);
CREATE INDEX ix_sheet_sync_changes_status ON sheet_sync_changes (status);
CREATE UNIQUE INDEX ix_sheet_sync_changes_public_id ON sheet_sync_changes (public_id);
CREATE INDEX ix_sheet_sync_changes_snapshot_id ON sheet_sync_changes (snapshot_id);
CREATE UNIQUE INDEX ix_sheet_sync_changes_fingerprint ON sheet_sync_changes (fingerprint);
CREATE INDEX ix_sheet_sync_changes_applied_by_user_id ON sheet_sync_changes (applied_by_user_id);
CREATE INDEX ix_sheet_sync_changes_source_id ON sheet_sync_changes (source_id);
CREATE INDEX ix_sheet_sync_changes_decided_by_user_id ON sheet_sync_changes (decided_by_user_id);
CREATE INDEX ix_sheet_sync_changes_stable_identifier ON sheet_sync_changes (stable_identifier);
CREATE INDEX ix_sheet_sync_changes_id ON sheet_sync_changes (id);

CREATE TABLE sheet_sync_change_events (
	id INTEGER NOT NULL, 
	change_id INTEGER NOT NULL, 
	event_type VARCHAR(30) NOT NULL, 
	actor_user_id INTEGER, 
	event_payload_json TEXT NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id), 
	CONSTRAINT check_sheet_sync_change_event_type CHECK (event_type IN ('detected', 'accepted', 'rejected', 'ignored', 'applied', 'failed', 'conflict')), 
	FOREIGN KEY(change_id) REFERENCES sheet_sync_changes (id) ON DELETE RESTRICT, 
	FOREIGN KEY(actor_user_id) REFERENCES users (id) ON DELETE SET NULL
)

;
CREATE INDEX ix_sheet_sync_change_events_change_id ON sheet_sync_change_events (change_id);
CREATE INDEX ix_sheet_sync_change_events_event_type ON sheet_sync_change_events (event_type);
CREATE INDEX ix_sheet_sync_change_events_id ON sheet_sync_change_events (id);
CREATE INDEX ix_sheet_sync_change_events_actor_user_id ON sheet_sync_change_events (actor_user_id);
PRAGMA foreign_keys=ON;
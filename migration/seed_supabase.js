const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables from the root .env
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const localDbPath = path.join(__dirname, '..', '..', 'backend', 'happy_noether.db');
const pgUri = process.env.DATABASE_URL;
if (!pgUri) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}

async function runSeed() {
  console.log("Reading local SQLite DB...");
  const sqliteDb = new sqlite3.Database(localDbPath);
  
  console.log("Connecting to Supabase PostgreSQL...");
  const pgClient = new Client({ connectionString: pgUri });
  await pgClient.connect();
  console.log("Connected to Supabase!");

  // 1. Read and run schema.sql to build tables
  const schemaPath = path.join(__dirname, '..', '..', 'backend', 'database', 'schema.sql');
  console.log("Reading schema.sql...");
  let schemaSql = fs.readFileSync(schemaPath, 'utf8');
  
  // Clean comments and execute
  console.log("Initializing database tables on Supabase...");
  await pgClient.query(schemaSql);
  console.log("Database tables initialized successfully!");

  // Helper to get SQLite rows
  const getSqliteRows = (query, params = []) => {
    return new Promise((resolve, reject) => {
      sqliteDb.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  };

  // Helper to clear table on Supabase (optional, since schema drops/creates them, but safe)
  const tables = [
    'cleaning_tasks',
    'maintenance_assets',
    'reseller_order_items',
    'reseller_orders',
    'consignment_items',
    'consignment_deliveries',
    'consignment_partners',
    'recipe_items',
    'recipes',
    'raw_ingredients',
    'product_skus',
    'gift_set_items',
    'gift_sets',
    'category_overhead_rates'
  ];

  // 2. Sync raw_ingredients
  console.log("Syncing raw_ingredients...");
  const rawIngs = await getSqliteRows("SELECT * FROM raw_ingredients");
  for (const r of rawIngs) {
    await pgClient.query(`
      INSERT INTO raw_ingredients (id, name, category, unit, price, net_weight, brand, shop, reorder_level, available_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET 
        name=EXCLUDED.name, category=EXCLUDED.category, unit=EXCLUDED.unit, price=EXCLUDED.price, 
        net_weight=EXCLUDED.net_weight, brand=EXCLUDED.brand, shop=EXCLUDED.shop, 
        reorder_level=EXCLUDED.reorder_level, available_stock=EXCLUDED.available_stock
    `, [r.id, r.name, r.category, r.unit, r.price, r.net_weight, r.brand, r.shop, r.reorder_level, r.available_stock]);
  }
  console.log(`Synced ${rawIngs.length} raw_ingredients.`);

  // 3. Sync product_skus
  console.log("Syncing product_skus...");
  const products = await getSqliteRows("SELECT * FROM product_skus");
  for (const p of products) {
    await pgClient.query(`
      INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, warehouse_stock, cost_per_unit, storage_life, serving_requirement)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (sku) DO UPDATE SET 
        product_name=EXCLUDED.product_name, category=EXCLUDED.category, size=EXCLUDED.size, 
        retail_price=EXCLUDED.retail_price, reseller_price=EXCLUDED.reseller_price, 
        pack_qty=EXCLUDED.pack_qty, warehouse_stock=EXCLUDED.warehouse_stock, 
        cost_per_unit=EXCLUDED.cost_per_unit, storage_life=EXCLUDED.storage_life, 
        serving_requirement=EXCLUDED.serving_requirement
    `, [p.sku, p.product_name, p.category, p.size, p.retail_price, p.reseller_price, p.pack_qty, p.warehouse_stock, p.cost_per_unit, p.storage_life, p.serving_requirement]);
  }
  console.log(`Synced ${products.length} product_skus.`);

  // 4. Sync recipes
  console.log("Syncing recipes...");
  const recipes = await getSqliteRows("SELECT * FROM recipes");
  for (const rec of recipes) {
    await pgClient.query(`
      INSERT INTO recipes (id, sku, recipe_name, yield_weight, yield_unit, portion_size, yield_pcs, batch_yield)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (id) DO UPDATE SET 
        sku=EXCLUDED.sku, recipe_name=EXCLUDED.recipe_name, yield_weight=EXCLUDED.yield_weight, 
        yield_unit=EXCLUDED.yield_unit, portion_size=EXCLUDED.portion_size, 
        yield_pcs=EXCLUDED.yield_pcs, batch_yield=EXCLUDED.batch_yield
    `, [rec.id, rec.sku, rec.recipe_name, rec.yield_weight, rec.yield_unit, rec.portion_size, rec.yield_pcs, rec.batch_yield]);
  }
  console.log(`Synced ${recipes.length} recipes.`);

  // 5. Sync recipe_items
  console.log("Syncing recipe_items...");
  const items = await getSqliteRows("SELECT * FROM recipe_items");
  for (const item of items) {
    await pgClient.query(`
      INSERT INTO recipe_items (id, recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET 
        recipe_id=EXCLUDED.recipe_id, ingredient_type=EXCLUDED.ingredient_type, 
        raw_ingredient_id=EXCLUDED.raw_ingredient_id, sub_sku=EXCLUDED.sub_sku, 
        base_qty=EXCLUDED.base_qty, base_unit=EXCLUDED.base_unit
    `, [item.id, item.recipe_id, item.ingredient_type, item.raw_ingredient_id, item.sub_sku, item.base_qty, item.base_unit]);
  }
  console.log(`Synced ${items.length} recipe_items.`);

  // 6. Sync consignment_partners
  console.log("Syncing consignment_partners...");
  const partners = await getSqliteRows("SELECT * FROM consignment_partners");
  for (const part of partners) {
    await pgClient.query(`
      INSERT INTO consignment_partners (id, name, discount_rate, collection_frequency, minimum_order_amount)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET 
        name=EXCLUDED.name, discount_rate=EXCLUDED.discount_rate, 
        collection_frequency=EXCLUDED.collection_frequency, minimum_order_amount=EXCLUDED.minimum_order_amount
    `, [part.id, part.name, part.discount_rate, part.collection_frequency, part.minimum_order_amount]);
  }
  console.log(`Synced ${partners.length} consignment_partners.`);

  // 7. Sync consignment_deliveries
  console.log("Syncing consignment_deliveries...");
  const deliveries = await getSqliteRows("SELECT * FROM consignment_deliveries");
  for (const del of deliveries) {
    await pgClient.query(`
      INSERT INTO consignment_deliveries (id, partner_id, delivery_date, dr_number, is_paid, payment_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET 
        partner_id=EXCLUDED.partner_id, delivery_date=EXCLUDED.delivery_date, 
        dr_number=EXCLUDED.dr_number, is_paid=EXCLUDED.is_paid, payment_date=EXCLUDED.payment_date
    `, [del.id, del.partner_id, del.delivery_date, del.dr_number, del.is_paid, del.payment_date]);
  }
  console.log(`Synced ${deliveries.length} consignment_deliveries.`);

  // 8. Sync consignment_items
  console.log("Syncing consignment_items...");
  const cItems = await getSqliteRows("SELECT * FROM consignment_items");
  for (const ci of cItems) {
    await pgClient.query(`
      INSERT INTO consignment_items (id, delivery_id, sku, qty_delivered, units_sold, qty_pulled_out, reseller_price_snapshot, cost_per_unit_snapshot, store_price_snapshot, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET 
        delivery_id=EXCLUDED.delivery_id, sku=EXCLUDED.sku, qty_delivered=EXCLUDED.qty_delivered, 
        units_sold=EXCLUDED.units_sold, qty_pulled_out=EXCLUDED.qty_pulled_out, 
        reseller_price_snapshot=EXCLUDED.reseller_price_snapshot, cost_per_unit_snapshot=EXCLUDED.cost_per_unit_snapshot, 
        store_price_snapshot=EXCLUDED.store_price_snapshot, notes=EXCLUDED.notes
    `, [ci.id, ci.delivery_id, ci.sku, ci.qty_delivered, ci.units_sold, ci.qty_pulled_out, ci.reseller_price_snapshot, ci.cost_per_unit_snapshot, ci.store_price_snapshot, ci.notes]);
  }
  console.log(`Synced ${cItems.length} consignment_items.`);

  // 9. Sync category_overhead_rates
  console.log("Syncing category_overhead_rates...");
  const overheads = await getSqliteRows("SELECT * FROM category_overhead_rates");
  for (const o of overheads) {
    await pgClient.query(`
      INSERT INTO category_overhead_rates (category, labor_rate_per_unit, utility_rate_per_unit)
      VALUES ($1, $2, $3)
      ON CONFLICT (category) DO UPDATE SET 
        labor_rate_per_unit=EXCLUDED.labor_rate_per_unit, utility_rate_per_unit=EXCLUDED.utility_rate_per_unit
    `, [o.category, o.labor_rate_per_unit, o.utility_rate_per_unit]);
  }
  console.log(`Synced ${overheads.length} category_overhead_rates.`);

  // 10. Sync maintenance_assets & cleaning_tasks
  console.log("Syncing maintenance_assets...");
  const assets = await getSqliteRows("SELECT * FROM maintenance_assets");
  for (const a of assets) {
    await pgClient.query(`
      INSERT INTO maintenance_assets (id, asset_name, area, last_checked, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET 
        asset_name=EXCLUDED.asset_name, area=EXCLUDED.area, last_checked=EXCLUDED.last_checked, 
        status=EXCLUDED.status, notes=EXCLUDED.notes
    `, [a.id, a.asset_name, a.area, a.last_checked, a.status, a.notes]);
  }

  console.log("Syncing cleaning_tasks...");
  const tasks = await getSqliteRows("SELECT * FROM cleaning_tasks");
  for (const t of tasks) {
    await pgClient.query(`
      INSERT INTO cleaning_tasks (id, task_name, frequency, assigned_role, last_completed, status)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (id) DO UPDATE SET 
        task_name=EXCLUDED.task_name, frequency=EXCLUDED.frequency, assigned_role=EXCLUDED.assigned_role, 
        last_completed=EXCLUDED.last_completed, status=EXCLUDED.status
    `, [t.id, t.task_name, t.frequency, t.assigned_role, t.last_completed, t.status]);
  }
  console.log("Sanitation checklists synced!");

  console.log("Closing local SQLite connection...");
  sqliteDb.close();
  
  console.log("Closing Supabase client...");
  await pgClient.end();
  
  console.log("DATABASE SYNC TO SUPABASE COMPLETE!");
}

runSeed().catch(err => {
  console.error("FATAL SYNC ERROR:", err);
  process.exit(1);
});

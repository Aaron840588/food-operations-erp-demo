require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

const localDbPath = "C:\\Users\\aaron\\Documents\\antigravity\\happy-noether\\backend\\happy_noether.db";
const pgUri = process.env.DATABASE_URL;
if (!pgUri) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}
const prodFile = "C:\\Users\\aaron\\Downloads\\H+H Production Inventory Management.xlsx";

const extractedProductsPath = "C:\\Users\\aaron\\.gemini\\antigravity\\brain\\3b56b72c-decd-47ec-9125-7663e93b2269\\scratch\\extracted_products.json";
const compiledIngredientsPath = "C:\\Users\\aaron\\.gemini\\antigravity\\brain\\3b56b72c-decd-47ec-9125-7663e93b2269\\scratch\\compiled_ingredients.json";

async function runCleanMigrationAndSync() {
  console.log("1. Re-initializing local SQLite database...");
  if (fs.existsSync(localDbPath)) {
    fs.unlinkSync(localDbPath);
  }
  
  const sqliteDb = new sqlite3.Database(localDbPath);

  // Initialize SQLite schema
  const sqliteSchemaPath = "C:\\Users\\aaron\\Documents\\antigravity\\happy-noether\\backend\\database\\schema_sqlite.sql";
  const sqliteSchemaSql = fs.readFileSync(sqliteSchemaPath, 'utf8');
  await new Promise((resolve, reject) => {
    sqliteDb.exec(sqliteSchemaSql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  console.log("SQLite tables initialized.");

  // Load from compiled JSON files
  console.log("Loading compiled caches...");
  const productsList = JSON.parse(fs.readFileSync(extractedProductsPath, 'utf8'));
  const ingredientsList = JSON.parse(fs.readFileSync(compiledIngredientsPath, 'utf8'));

  console.log(`Loaded ${ingredientsList.length} raw ingredients, ${productsList.length} products.`);

  // Insert raw ingredients
  const rawIngMap = new Map();
  for (const ing of ingredientsList) {
    await new Promise((resolve) => {
      sqliteDb.run(`
        INSERT INTO raw_ingredients (name, category, unit, price, net_weight, available_stock, brand, shop)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [ing.name, ing.category, ing.unit, ing.price, ing.netWeight, ing.availableStock || 0.0, ing.brand, ing.shop], function(err) {
        if (err) resolve(); // Skip duplicates
        else {
          rawIngMap.set(ing.name.toLowerCase().trim(), this.lastID);
          resolve();
        }
      });
    });
  }

  // Insert product SKUs
  for (const p of productsList) {
    await new Promise((resolve) => {
      sqliteDb.run(`
        INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [p.sku, p.name, p.category, p.size, p.retailPrice, p.resellerPrice, p.packQty, '', ''], () => resolve());
    });
  }

  // Strictly defined Sub-Recipes map to prevent false naming overlaps (Tomato -> Sandwich loops)
  const strictSubRecipes = {
    "pesto": "PP-IND-SVR",          // Pesto Sauce
    "pesto sauce": "PP-IND-SVR",    // Pesto Sauce
    "yema": "YP-IND-SWT",           // Yema Spread
    "yema spread": "YP-IND-SWT",    // Yema Spread
    "matcha": "CM-IND-SWT",         // Matcha Spread
    "matcha spread": "CM-IND-SWT",  // Matcha Spread
    "salmon mix": "SSS-SL-SW-SVR",
    "tuna mix": "TSLD-SL-SW-SVR",
    "brazo filling": "YMB-SL-SW-SWT",
    "yema brazo filling": "YMB-SL-SW-SWT",
    "tiramisu mousse": "TRM-FL-SW-SWT",
    "ube mousse": "UYK-FL-SW-CK",
    "black forest mousse": "TBF-FL-SW-CK"
  };

  // Parse Recipes
  console.log("Parsing Recipes from spreadsheet...");
  const prodWb = xlsx.readFile(prodFile);
  const recipeSheets = [
    { sheetName: 'Adjustable Recipe SpreadsFillin', workbook: prodWb },
    { sheetName: 'Adjustable Pasta and Pastries', workbook: prodWb },
    { sheetName: 'Sandwich Ingredient Calc', workbook: prodWb }
  ];

  for (const recipeSheet of recipeSheets) {
    const sheet = recipeSheet.workbook.Sheets[recipeSheet.sheetName];
    if (!sheet) continue;
    
    const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[xlsx.utils.encode_cell({ r, c })];
        if (cell && cell.v && String(cell.v).trim().toUpperCase() === 'RECIPE NAME') {
          const nameCell = sheet[xlsx.utils.encode_cell({ r: r, c: c + 1 })];
          const name = nameCell ? String(nameCell.v).trim() : '';
          if (!name || name === '') continue;

          // Match SKU
          let sku = null;
          const cleanName = name.toLowerCase().replace(/sandwich|sauce|spread|recipe|mix|mousse|filling|calc/g, '').trim();
          for (const p of productsList) {
            const cleanSkuName = p.name.toLowerCase().replace(/sandwich|sauce|spread|cups|cold brew|latte|tsokolate/g, '').trim();
            if (cleanSkuName === cleanName || cleanSkuName.includes(cleanName) || cleanName.includes(cleanSkuName)) {
              sku = p.sku;
              break;
            }
          }

          const yieldVal = parseFloat(sheet[xlsx.utils.encode_cell({ r: r + 2, c: c + 1 })]?.v) || 0;
          const yieldUnit = String(sheet[xlsx.utils.encode_cell({ r: r + 2, c: c + 2 })]?.v || 'g').trim();
          const portionVal = parseFloat(sheet[xlsx.utils.encode_cell({ r: r + 4, c: c + 1 })]?.v) || 0;
          const portionUnit = String(sheet[xlsx.utils.encode_cell({ r: r + 4, c: c + 2 })]?.v || 'g').trim();

          const recipeId = await new Promise((resolve) => {
            sqliteDb.run(`
              INSERT INTO recipes (sku, yield_weight, yield_unit, portion_size, portion_unit, notes)
              VALUES (?, ?, ?, ?, ?, ?)
            `, [sku, yieldVal, yieldUnit, portionVal, portionUnit, `Imported recipe for ${name}`], function() {
              resolve(this.lastID);
            });
          });

          if (!recipeId) continue;

          // Parse Ingredients (up to 12 items, break if hitting next header)
          for (let offset = 9; offset < 22; offset++) {
            const ingRow = r + offset;
            if (ingRow > range.e.r) break;
            
            const ingName = String(sheet[xlsx.utils.encode_cell({ r: ingRow, c: c })]?.v || '').trim();
            const ingQty = parseFloat(sheet[xlsx.utils.encode_cell({ r: ingRow, c: c + 1 })]?.v) || 0;
            const ingUnit = String(sheet[xlsx.utils.encode_cell({ r: ingRow, c: c + 2 })]?.v || 'g').trim();

            if (ingName === '' || ingName.toUpperCase() === 'RECIPE NAME' || ingName.toUpperCase().includes('TOTAL')) {
              if (ingName.toUpperCase() === 'RECIPE NAME') break;
              continue;
            }

            let ingType = 'raw';
            let rawId = null;
            let subSku = null;

            const cleanIngName = ingName.toLowerCase().trim();

            // Strict SKU matching check to resolve Tomato -> Sandwich circular loop
            if (strictSubRecipes[cleanIngName]) {
              ingType = 'sku';
              subSku = strictSubRecipes[cleanIngName];
            } else {
              // Lookup in raw ingredients first
              rawId = rawIngMap.get(cleanIngName);
              if (!rawId) {
                // Fuzzy raw match
                for (const [k, id] of rawIngMap.entries()) {
                  if (k.includes(cleanIngName) || cleanIngName.includes(k)) {
                    rawId = id;
                    break;
                  }
                }
              }
            }

            await new Promise((resolve) => {
              sqliteDb.run(`
                INSERT INTO recipe_items (recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
                VALUES (?, ?, ?, ?, ?, ?)
              `, [recipeId, ingType, rawId, subSku, ingQty, ingUnit], () => resolve());
            });
          }
        }
      }
    }
  }
  console.log("Recipes and ingredients synced.");

  // Seed default category overheads
  await new Promise((resolve) => {
    sqliteDb.run("INSERT INTO category_overhead_rates VALUES ('spread', 3.00, 2.00)", () => resolve());
  });
  await new Promise((resolve) => {
    sqliteDb.run("INSERT INTO category_overhead_rates VALUES ('sandwich', 5.00, 3.00)", () => resolve());
  });
  await new Promise((resolve) => {
    sqliteDb.run("INSERT INTO category_overhead_rates VALUES ('pasta', 8.00, 4.00)", () => resolve());
  });
  await new Promise((resolve) => {
    sqliteDb.run("INSERT INTO category_overhead_rates VALUES ('pastry', 4.00, 2.00)", () => resolve());
  });

  // Seed partners and delivery logs
  const partnersList = [
    { name: "Likhang Laguna", rate: 0.10, min: 1000 },
    { name: "Pinana", rate: 0.10, min: 1000 },
    { name: "ARTISAN", rate: 0.10, min: 1000 },
    { name: "AA Mart", rate: 0.10, min: 1000 },
    { name: "KITCHEN ANGELS", rate: 0.10, min: 1000 },
    { name: "OTOP", rate: 0.10, min: 1000 }
  ];
  for (const part of partnersList) {
    await new Promise((resolve) => {
      sqliteDb.run(`
        INSERT INTO consignment_partners (name, discount_rate, collection_frequency, minimum_order_amount)
        VALUES (?, ?, 'Weekly', ?)
      `, [part.name, part.rate, part.min], () => resolve());
    });
  }

  // Seeding cleaning checklists
  const tasks = [
    { name: "Sanitize kitchen tables", freq: "Daily", role: "Kitchen Assistant" },
    { name: "Mop floors", freq: "Daily", role: "Kitchen Assistant" },
    { name: "Clean ovens", freq: "Weekly", role: "Kitchen Assistant" },
    { name: "Deep clean freezer", freq: "Monthly", role: "Kitchen Assistant" }
  ];
  for (const t of tasks) {
    await new Promise((resolve) => {
      sqliteDb.run(`
        INSERT INTO cleaning_tasks (task_name, frequency, assigned_role, status)
        VALUES (?, ?, ?, 'Pending')
      `, [t.name, t.freq, t.role], () => resolve());
    });
  }

  console.log("Local SQLite database migration successfully rebuilt!");

  // ----------------------------------------------------
  // SYNC CLEAN DATABASE TO SUPABASE POSTGRESQL
  // ----------------------------------------------------
  console.log("Connecting to Supabase to upload clean tables...");
  const pgClient = new Client({ connectionString: pgUri });
  await pgClient.connect();
  console.log("Connected to Supabase!");

  // Run schema.sql to re-create tables on Supabase
  const schemaPath = "C:\\Users\\aaron\\Documents\\antigravity\\happy-noether\\backend\\database\\schema.sql";
  let schemaSql = fs.readFileSync(schemaPath, 'utf8');
  await pgClient.query(schemaSql);
  console.log("Supabase tables rebuilt.");

  // Helper to read rows
  const getSqliteRows = (query) => {
    return new Promise((resolve) => {
      sqliteDb.all(query, (err, rows) => resolve(rows || []));
    });
  };

  // Sync raw_ingredients
  const rawIngs = await getSqliteRows("SELECT * FROM raw_ingredients");
  for (const r of rawIngs) {
    await pgClient.query(`
      INSERT INTO raw_ingredients (id, name, category, unit, price, net_weight, available_stock, reorder_level, brand, shop, remarks)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [r.id, r.name, r.category, r.unit, r.price, r.net_weight, r.available_stock, r.reorder_level, r.brand, r.shop, r.remarks]);
  }
  console.log(`Uploaded ${rawIngs.length} raw_ingredients.`);

  // Sync product_skus
  const products = await getSqliteRows("SELECT * FROM product_skus");
  for (const p of products) {
    await pgClient.query(`
      INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement, cost_per_unit, warehouse_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [p.sku, p.product_name, p.category, p.size, p.retail_price, p.reseller_price, p.pack_qty, p.storage_life, p.serving_requirement, p.cost_per_unit, p.warehouse_stock]);
  }
  console.log(`Uploaded ${products.length} product_skus.`);

  // Sync recipes
  const dbRecipes = await getSqliteRows("SELECT * FROM recipes");
  for (const rec of dbRecipes) {
    await pgClient.query(`
      INSERT INTO recipes (id, sku, yield_weight, yield_unit, portion_size, portion_unit)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [rec.id, rec.sku, rec.yield_weight, rec.yield_unit, rec.portion_size, rec.portion_unit]);
  }

  // Sync recipe_items
  const dbRecipeItems = await getSqliteRows("SELECT * FROM recipe_items");
  for (const item of dbRecipeItems) {
    await pgClient.query(`
      INSERT INTO recipe_items (id, recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [item.id, item.recipe_id, item.ingredient_type, item.raw_ingredient_id, item.sub_sku, item.base_qty, item.base_unit]);
  }
  console.log("Uploaded recipes.");

  // Sync consignment_partners
  const dbPartners = await getSqliteRows("SELECT * FROM consignment_partners");
  for (const part of dbPartners) {
    await pgClient.query(`
      INSERT INTO consignment_partners (id, name, discount_rate, collection_frequency, minimum_order_amount)
      VALUES ($1, $2, $3, $4, $5)
    `, [part.id, part.name, part.discount_rate, part.collection_frequency, part.minimum_order_amount]);
  }

  // Sync category_overhead_rates
  const dbOverheads = await getSqliteRows("SELECT * FROM category_overhead_rates");
  for (const o of dbOverheads) {
    await pgClient.query(`
      INSERT INTO category_overhead_rates (category, labor_rate_per_unit, utility_rate_per_unit)
      VALUES ($1, $2, $3)
    `, [o.category, o.labor_rate_per_unit, o.utility_rate_per_unit]);
  }

  // Sync cleaning_tasks
  const dbTasks = await getSqliteRows("SELECT * FROM cleaning_tasks");
  for (const t of dbTasks) {
    await pgClient.query(`
      INSERT INTO cleaning_tasks (id, task_name, frequency, assigned_role, status)
      VALUES ($1, $2, $3, $4, $5)
    `, [t.id, t.task_name, t.frequency, t.assigned_role, t.status]);
  }

  console.log("Closing connections...");
  sqliteDb.close();
  await pgClient.end();
  console.log("DATABASE SYNC COMPLETE!");
}

runCleanMigrationAndSync().catch(console.error);

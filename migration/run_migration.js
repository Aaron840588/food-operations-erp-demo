const xlsx = require('xlsx');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

// File paths
const partnerFile = "C:\\Users\\aaron\\Downloads\\Partner Inventory Management.xlsx";
const prodFile = "C:\\Users\\aaron\\Downloads\\H+H Production Inventory Management.xlsx";
const trackerFile = "C:\\Users\\aaron\\Downloads\\H+H Food System Trackers.xlsx";
const dbPath = path.join(__dirname, '..', 'backend', 'happy_noether.db');
const schemaPath = path.join(__dirname, '..', 'backend', 'database', 'schema_sqlite.sql');

// Helper to convert Excel date to YYYY-MM-DD
function excelDateToISO(serial) {
  if (serial === null || serial === undefined || serial === '') return null;
  if (typeof serial !== 'number') {
    const str = String(serial).trim();
    if (str === '' || str.toUpperCase().includes('TOTAL') || str.toUpperCase().includes('DR')) return null;
    const d = new Date(str);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return null;
  }
  // Excel leap year bug offset
  const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
  if (isNaN(date.getTime())) return null;
  return date.toISOString().split('T')[0];
}

console.log("Initializing database migration...");

// 1. Delete existing DB if it exists and recreate
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log("Existing database file removed.");
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Execute schema
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schemaSql, (err) => {
    if (err) {
      console.error("Schema execution error:", err);
      process.exit(1);
    }
    console.log("Database schema initialized successfully.");
    
    // Now start importing data
    startMigration();
  });
});

function startMigration() {
  const trackerWb = xlsx.readFile(trackerFile);
  const prodWb = xlsx.readFile(prodFile);
  const partnerWb = xlsx.readFile(partnerFile);

  // Load compiled products and ingredients from JSON caches if they exist, or parse them directly
  // We'll read the cache JSONs we generated during research phase
  const extractedProductsPath = "C:\\Users\\aaron\\.gemini\\antigravity\\brain\\3b56b72c-decd-47ec-9125-7663e93b2269\\scratch\\extracted_products.json";
  const compiledIngredientsPath = "C:\\Users\\aaron\\.gemini\\antigravity\\brain\\3b56b72c-decd-47ec-9125-7663e93b2269\\scratch\\compiled_ingredients.json";
  
  if (!fs.existsSync(extractedProductsPath) || !fs.existsSync(compiledIngredientsPath)) {
    console.error("Cache JSON files not found. Please run research scripts first.");
    process.exit(1);
  }

  const productsList = JSON.parse(fs.readFileSync(extractedProductsPath, 'utf8'));
  const ingredientsList = JSON.parse(fs.readFileSync(compiledIngredientsPath, 'utf8'));

  db.serialize(() => {
    // ----------------------------------------------------
    // IMPORT PRODUCTS
    // ----------------------------------------------------
    console.log(`Importing ${productsList.length} products...`);
    const stmtProduct = db.prepare(`
      INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    productsList.forEach(p => {
      stmtProduct.run(
        p.sku,
        p.name,
        p.category,
        p.size,
        p.retailPrice,
        p.resellerPrice,
        p.packQty,
        '', // storage_life to be updated
        ''  // serving_requirement
      );
    });
    stmtProduct.finalize();

    // ----------------------------------------------------
    // IMPORT INGREDIENTS
    // ----------------------------------------------------
    console.log(`Importing ${ingredientsList.length} raw ingredients...`);
    const stmtIngredient = db.prepare(`
      INSERT INTO raw_ingredients (name, category, unit, price, net_weight, available_stock, brand, shop)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    ingredientsList.forEach(ing => {
      stmtIngredient.run(
        ing.name,
        ing.category,
        ing.unit,
        ing.price,
        ing.netWeight,
        ing.availableStock,
        ing.brand,
        ing.shop
      );
    });
    stmtIngredient.finalize();

    // Trigger update for raw cost calculation
    db.run("UPDATE raw_ingredients SET cost_per_gram_unit = CASE WHEN net_weight > 0 THEN price / net_weight ELSE 0.0 END");

    // ----------------------------------------------------
    // UPDATE STORAGE LIFE & SERVING REQUIREMENT FROM RESELLER RATE SHEET
    // ----------------------------------------------------
    console.log("Updating product metadata from Reseller Rate...");
    const rateSheet = trackerWb.Sheets['Reseller Rate'];
    if (rateSheet) {
      const data = xlsx.utils.sheet_to_json(rateSheet, { header: 1, defval: '' });
      data.forEach(row => {
        const name = row[0] ? String(row[0]).trim() : '';
        const size = row[2] ? String(row[2]).trim() : '';
        const life = row[4] ? String(row[4]).trim() : '';
        const serve = row[5] ? String(row[5]).trim() : '';
        
        if (name && life) {
          db.run(`
            UPDATE product_skus
            SET storage_life = ?, serving_requirement = ?
            WHERE LOWER(product_name) = LOWER(?) AND (LOWER(size) = LOWER(?) OR size = '')
          `, [life, serve, name, size]);
        }
      });
    }

    // ----------------------------------------------------
    // IMPORT OVERHEAD & LABOR CONFIGS
    // ----------------------------------------------------
    console.log("Importing overhead configurations...");
    const utilitySheet = trackerWb.Sheets['Utility, Labor, and Supplies Co'];
    if (utilitySheet) {
      const data = xlsx.utils.sheet_to_json(utilitySheet, { header: 1, defval: '' });
      
      // Electricity/Water/Gas (Column A, C)
      const utilities = [
        { name: 'Electricity Overall', cat: 'utility', rowIdx: 6 },
        { name: 'Water', cat: 'utility', rowIdx: 7 },
        { name: 'Gas', cat: 'utility', rowIdx: 8 }
      ];
      
      utilities.forEach(ut => {
        const row = data[ut.rowIdx];
        if (row) {
          const cost = parseFloat(row[2]) || 0;
          db.run(`
            INSERT INTO overhead_configs (category, particular, cost_per_month, cost_per_day)
            VALUES (?, ?, ?, ?)
          `, [ut.cat, ut.name, cost, cost / 30]);
        }
      });
      
      // Default daily utility per product
      const defaultRate = parseFloat(data[30] ? data[30][6] : 0) || 3.277777778;
      db.run(`
        INSERT INTO overhead_configs (category, particular, cost_per_day, notes)
        VALUES ('utility', 'default_utility_per_unit', ?, 'Default utility allocation rate per product manufactured')
      `, [defaultRate]);

      // Staff Labor Rates (Column P, Q, R)
      // Che, rate 350, perks 100
      db.run(`
        INSERT INTO overhead_configs (category, particular, cost_per_day, hourly_rate, notes)
        VALUES ('labor', 'Che', 450.00, 45.00, 'Staff labor rate per 10 hour day (350 rate + 100 perks)')
      `);
    }

    // ----------------------------------------------------
    // IMPORT MAINTENANCE & CLEANING CHECKLISTS
    // ----------------------------------------------------
    console.log("Importing maintenance checklists...");
    const maintSheet = prodWb.Sheets['Maintenance'];
    if (maintSheet) {
      const data = xlsx.utils.sheet_to_json(maintSheet, { header: 1, defval: '' });
      let currentArea = 'Production Area';
      
      for (let r = 3; r < data.length; r++) {
        const row = data[r];
        if (!row || row.length === 0) continue;
        
        const colA = row[0] ? String(row[0]).trim() : '';
        if (colA === 'Kitchen' || colA === 'CR' || colA === 'Office') {
          currentArea = colA;
          continue;
        }
        
        const itemName = colA;
        const style = row[1] ? String(row[1]).trim() : '';
        const cond = row[2] ? String(row[2]).trim() : 'OK';
        const rem = row[3] ? String(row[3]).trim() : '';
        const replDate = excelDateToISO(row[4]);
        
        if (itemName && itemName !== '' && itemName !== 'Item' && !itemName.includes('Add request')) {
          db.run(`
            INSERT INTO maintenance_assets (area, item_name, style_or_kind, condition, remarks, replacement_date)
            VALUES (?, ?, ?, ?, ?, ?)
          `, [currentArea, itemName, style, cond, rem, replDate]);
        }
      }
    }

    console.log("Importing cleaning tasks...");
    // Standard cleaning checklists based on task list categories
    const defaultCleaningTasks = [
      { name: 'Production Area Sweep & Mop', freq: 'Daily' },
      { name: 'Sanitize Tables & Countertops', freq: 'Daily' },
      { name: 'Sterilize Equipment and Weighing Scales', freq: 'Daily' },
      { name: 'Wash Utensils, Bowls, and Whisks', freq: 'Daily' },
      { name: 'Defrost Refrigerator', freq: 'Weekly' },
      { name: 'CR Disinfection and Floor Scrub', freq: 'Weekly' },
      { name: 'Declutter Shelves & Cabinets', freq: 'Monthly' }
    ];
    defaultCleaningTasks.forEach(task => {
      db.run(`
        INSERT INTO cleaning_tasks (task_name, frequency)
        VALUES (?, ?)
      `, [task.name, task.freq]);
    });


    // ----------------------------------------------------
    // PARSE & IMPORT RECIPES
    // ----------------------------------------------------
    console.log("Parsing and seeding recipe tables...");
    
    // Fetch raw ingredients map to look up database IDs
    db.all("SELECT id, name FROM raw_ingredients", (err, rows) => {
      if (err) {
        console.error(err);
        process.exit(1);
      }
      
      const rawIngMap = new Map();
      rows.forEach(r => rawIngMap.set(r.name.toLowerCase().trim(), r.id));

      const recipeSheets = [
        { sheetName: 'Adjustable Recipe SpreadsFillin', workbook: prodWb },
        { sheetName: 'Adjustable Pasta and Pastries', workbook: prodWb },
        { sheetName: 'Sandwich Ingredient Calc', workbook: prodWb }
      ];

      recipeSheets.forEach(recipeSheet => {
        const sheet = recipeSheet.workbook.Sheets[recipeSheet.sheetName];
        if (!sheet) return;
        
        const range = xlsx.utils.decode_range(sheet['!ref'] || 'A1:A1');
        
        // Scan for recipe blocks
        for (let r = range.s.r; r <= range.e.r; r++) {
          for (let c = range.s.c; c <= range.e.c; c++) {
            const cell = sheet[xlsx.utils.encode_cell({ r: r, c: c })];
            if (cell && cell.v && String(cell.v).trim().toUpperCase() === 'RECIPE NAME') {
              const nameCell = sheet[xlsx.utils.encode_cell({ r: r, c: c + 1 })];
              const name = nameCell ? String(nameCell.v).trim() : '';
              if (!name || name === '') continue;

              // Find corresponding SKU for this recipe name
              let sku = '';
              const cleanName = name.toLowerCase().replace(/sandwich|sauce|spread|recipe|mix|mousse|filling|calc/g, '').trim();
              
              // Direct or fuzzy match with SKUs
              for (const p of productsList) {
                const cleanSkuName = p.name.toLowerCase().replace(/sandwich|sauce|spread|cups|cold brew|latte|tsokolate/g, '').trim();
                if (cleanSkuName.includes(cleanName) || cleanName.includes(cleanSkuName)) {
                  sku = p.sku;
                  break;
                }
              }
              
              if (!sku) {
                // If it is a helper mix (like tuna mix, salmon mix), we don't have a finished SKU, but we'll register it as a sub-recipe
                sku = null;
              }

              // Yield
              const yValCell = sheet[xlsx.utils.encode_cell({ r: r + 2, c: c + 1 })];
              const yUnitCell = sheet[xlsx.utils.encode_cell({ r: r + 2, c: c + 2 })];
              const yieldVal = yValCell ? parseFloat(yValCell.v) || 0 : 0;
              const yieldUnit = yUnitCell ? String(yUnitCell.v).trim() : 'g';

              // Portion
              const pValCell = sheet[xlsx.utils.encode_cell({ r: r + 4, c: c + 1 })];
              const pUnitCell = sheet[xlsx.utils.encode_cell({ r: r + 4, c: c + 2 })];
              const portionVal = pValCell ? parseFloat(pValCell.v) || 0 : 0;
              const portionUnit = pUnitCell ? String(pUnitCell.v).trim() : 'g';

              // Insert recipe
              db.run(`
                INSERT INTO recipes (sku, yield_weight, yield_unit, portion_size, portion_unit, notes)
                VALUES (?, ?, ?, ?, ?, ?)
              `, [sku, yieldVal, yieldUnit, portionVal, portionUnit, `Imported recipe for ${name}`], function(err) {
                if (err) {
                  // Suppress warning on unique SKU constraint (e.g. duplicates)
                  return;
                }
                
                const recipeId = this.lastID;
                
                // Parse ingredients
                for (let offset = 9; offset < 24; offset++) {
                  const ingRow = r + offset;
                  if (ingRow > range.e.r) break;
                  
                  const ingNameCell = sheet[xlsx.utils.encode_cell({ r: ingRow, c: c })];
                  const ingQtyCell = sheet[xlsx.utils.encode_cell({ r: ingRow, c: c + 1 })];
                  const ingUnitCell = sheet[xlsx.utils.encode_cell({ r: ingRow, c: c + 2 })];
                  
                  const ingName = ingNameCell ? String(ingNameCell.v).trim() : '';
                  const ingQty = ingQtyCell ? parseFloat(ingQtyCell.v) || 0 : 0;
                  const ingUnit = ingUnitCell ? String(ingUnitCell.v).trim() : 'g';
                  
                  if (ingName.toUpperCase() === 'RECIPE NAME' || ingName.toUpperCase().includes('TOTAL')) {
                    break;
                  }
                  if (ingName === '') continue;
                  
                  // Look up ingredient in raw_ingredients or product_skus
                  let ingType = 'raw';
                  let rawId = null;
                  let subSku = null;
                  
                  const cleanIngName = ingName.toLowerCase().trim();
                  
                  // 1. Check if it matches a SKU (for nested recipe, e.g. Yema Spread used in sandwiches)
                  let matchedSku = productsList.find(p => 
                    p.name.toLowerCase().includes(cleanIngName) || 
                    cleanIngName.includes(p.name.toLowerCase())
                  );
                  
                  if (matchedSku) {
                    ingType = 'sku';
                    subSku = matchedSku.sku;
                  } else {
                    // 2. Lookup in raw ingredients database
                    rawId = rawIngMap.get(cleanIngName);
                    if (!rawId) {
                      // Fuzzy match lookup
                      for (const [k, id] of rawIngMap.entries()) {
                        if (k.includes(cleanIngName) || cleanIngName.includes(k)) {
                          rawId = id;
                          break;
                        }
                      }
                    }
                  }
                  
                  db.run(`
                    INSERT INTO recipe_items (recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
                    VALUES (?, ?, ?, ?, ?, ?)
                  `, [recipeId, ingType, rawId, subSku, ingQty, ingUnit]);
                }
              });
            }
          }
        }
      });
    });


    // ----------------------------------------------------
    // PARSE & IMPORT CONSIGNMENT PARTNER DELIVERY LOGS
    // ----------------------------------------------------
    console.log("Parsing B2B partner consignment logs...");
    const partnerSheets = [
      { name: 'Likhang Laguna', defaultDiscount: 0.10 },
      { name: 'Pinana', defaultDiscount: 0.10 },
      { name: 'ARTISAN ', defaultDiscount: 0.10 },
      { name: 'AA Mart', defaultDiscount: 0.12 },
      { name: 'KITCHEN ANGELS', defaultDiscount: 0.15 },
      { name: 'OTOP', defaultDiscount: 0.10 }
    ];

    partnerSheets.forEach(partner => {
      const sheet = partnerWb.Sheets[partner.name];
      if (!sheet) return;
      
      const data = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      
      // Insert partner
      db.run(`
        INSERT INTO consignment_partners (name, discount_rate)
        VALUES (?, ?)
      `, [partner.name.trim(), partner.defaultDiscount], function(err) {
        if (err) return;
        const partnerId = this.lastID;

        // Find header row containing 'SKU'
        let headerRow = null;
        let headerIndex = -1;
        for (let i = 0; i < data.length; i++) {
          if (data[i].includes('SKU') && (data[i].includes('Store Price') || data[i].includes('Reseller\'s Price') || data[i].includes('Reseller\'s Price (10% off)'))) {
            headerRow = data[i];
            headerIndex = i;
            break;
          }
        }

        if (!headerRow) return;

        const skuIdx = headerRow.indexOf('SKU');
        const dateIdx = headerRow.indexOf('Date of Delivery');
        const drIdx = headerRow.indexOf('DR #');
        const costIdx = headerRow.indexOf('Cost/Unit');
        const resellerIdx = headerRow.findIndex(h => h.includes("Reseller's Price") || h.includes("Reseller Rate") || h.includes("Reseller Price"));
        const retailIdx = headerRow.findIndex(h => h.includes("Store Price") || h.includes("SRP") || h.includes("H+H Price") || h.includes("Retail Price"));
        const deliveredIdx = headerRow.indexOf('QTY delivered');
        const soldIdx = headerRow.indexOf('Units Sold');
        const pulloutIdx = headerRow.findIndex(h => h.includes("Pull out QTY") || h.includes("Pull-out") || h.includes("Pull out"));
        const paidDateIdx = headerRow.indexOf('Date Paid');

        let currentDeliveryDate = null;
        let currentDrNumber = null;
        let currentDeliveryId = null;

        // Scan delivery entries
        data.slice(headerIndex + 1).forEach(row => {
          let sku = row[skuIdx] ? String(row[skuIdx]).trim() : '';
          if (!sku || sku === '' || sku.toUpperCase().includes('TOTAL') || sku.toUpperCase().includes('DELIVERY')) {
            // Reset delivery ID on totals/breaks
            currentDeliveryId = null;
            return;
          }

          // SKU correction logic for half-sized sandwiches with copy-pasted SKUs
          const nameIdx = headerRow.indexOf('Product Name');
          if (nameIdx !== -1 && row[nameIdx]) {
            const pName = String(row[nameIdx]).toUpperCase();
            if (pName.includes('HALF') || pName.includes('1/2')) {
              if (sku === 'PPZ-FL-SW-SVR') sku = 'PPZ-HF-SW-SVR';
              else if (sku === 'CQM-FL-SW-SVR') sku = 'CQM-HF-SW-SVR';
              else if (sku === 'CQMD-FL-SW-SVR') sku = 'CQMD-HF-SW-SVR';
            }
          }

          // Check if SKU is valid
          const isValidSku = productsList.some(p => p.sku === sku);
          if (!isValidSku) return;

          // Resolve date of delivery and DR number
          const rowDateRaw = row[dateIdx];
          const rowDr = row[drIdx] ? String(row[drIdx]).trim() : '';
          const parsedRowDate = excelDateToISO(rowDateRaw);

          if (parsedRowDate) {
            currentDeliveryDate = parsedRowDate;
            currentDrNumber = rowDr || null;
            currentDeliveryId = null; // Forces creation of a new delivery record
          }

          if (!currentDeliveryDate) {
            // Skip rows that don't belong to any delivery context
            return;
          }

          // Get values
          const qtyDelivered = parseInt(row[deliveredIdx]) || 0;
          const unitsSold = parseInt(row[soldIdx]) || 0;
          const qtyPulledOut = pulloutIdx !== -1 ? (parseInt(row[pulloutIdx]) || 0) : 0;
          const resellerPrice = resellerIdx !== -1 ? (parseFloat(row[resellerIdx]) || 0) : 0;
          const storePrice = retailIdx !== -1 ? (parseFloat(row[retailIdx]) || 0) : 0;
          const costPerUnit = costIdx !== -1 ? (parseFloat(row[costIdx]) || 0) : 0;
          const paidDate = paidDateIdx !== -1 ? excelDateToISO(row[paidDateIdx]) : null;

          if (qtyDelivered === 0 && unitsSold === 0 && qtyPulledOut === 0) {
            return; // Skip empty rows
          }

          // Create delivery block if not exists
          function insertItem(deliveryId) {
            db.run(`
              INSERT INTO consignment_items (delivery_id, sku, qty_delivered, units_sold, qty_pulled_out, reseller_price_snapshot, cost_per_unit_snapshot, store_price_snapshot, notes)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
              deliveryId,
              sku,
              qtyDelivered,
              unitsSold,
              qtyPulledOut,
              resellerPrice || storePrice * (1 - partner.defaultDiscount),
              costPerUnit,
              storePrice,
              `Paid on: ${paidDate || 'Unpaid'}`
            ]);
          }

          if (currentDeliveryId) {
            insertItem(currentDeliveryId);
          } else {
            db.run(`
              INSERT INTO consignment_deliveries (partner_id, delivery_date, dr_number, is_paid, payment_date)
              VALUES (?, ?, ?, ?, ?)
            `, [
              partnerId,
              currentDeliveryDate,
              currentDrNumber,
              paidDate ? 1 : 0,
              paidDate
            ], function(err) {
              if (err) return;
              currentDeliveryId = this.lastID;
              insertItem(currentDeliveryId);
            });
          }
        });
      });
    });

    // ----------------------------------------------------
    // COMPLETED MIGRATION STATUS
    // ----------------------------------------------------
    db.get("SELECT COUNT(*) as count FROM product_skus", (err, r) => {
      console.log(`\nMigration completed successfully!`);
      console.log(`- Product SKUs loaded: ${r.count}`);
      db.get("SELECT COUNT(*) as count FROM raw_ingredients", (err, r) => {
        console.log(`- Raw Ingredients loaded: ${r.count}`);
        db.get("SELECT COUNT(*) as count FROM recipes", (err, r) => {
          console.log(`- Recipes loaded: ${r.count}`);
          db.get("SELECT COUNT(*) as count FROM consignment_deliveries", (err, r) => {
            console.log(`- Consignment Deliveries loaded: ${r.count}`);
            db.get("SELECT COUNT(*) as count FROM maintenance_assets", (err, r) => {
              console.log(`- Maintenance Items loaded: ${r.count}`);
              db.close();
            });
          });
        });
      });
    });

  });
}

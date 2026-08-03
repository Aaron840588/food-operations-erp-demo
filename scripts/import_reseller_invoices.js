const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const pgUri = process.env.DATABASE_URL;
if (!pgUri) {
  console.error("DATABASE_URL is not set in environment.");
  process.exit(1);
}
const file = "C:\\Users\\aaron\\Downloads\\H+H Production Inventory Management - Reseller Comp.csv";

const skuMap = {
  // Spreads
  "yema spread_100g": "YP-SAM-SWT",
  "yema spread_240g": "YP-IND-SWT",
  "sweet tablea spread_100g": "ST-SAM-SWT",
  "sweet tablea spread_240g": "ST-IND-SWT",
  "matcha spread_100g": "CM-SAM-SWT",
  "matcha spread_240g": "CM-IND-SWT",
  "white mocha spread_100g": "WM-SAM-SWT",
  "white mocha spread_240g": "WM-IND-SWT",
  "pesto sauce_100g": "PP-SAM-SVR",
  "pesto sauce_200g": "PP-IND-SVR",
  
  // Sandwiches
  "pesto tomato egg sandwich": "PEGG-SL-SW-SVR",
  "sweet tablea s'mores sandwich": "STS-HF-SW-SWT",
  "cookies and matcha s'mores sandwich": "CMS-HF-SW-SWT",
  "white mocha s'mores sandwich": "WMS-HF-SW-SWT",
  "tuna salad": "TSLD-SL-SW-SVR",
  "grilled cheese and pesto with pili": "GCP-SL-SW-SVR",
  "pesto egg": "PEGG-SL-SW-SVR",
  "pesto chicken with cheese": "PCHXW-SL-SW-SVR",
  "pesto club sandwich": "PCLB-HF-SW-SVR"
};

function resolveSku(itemName, size) {
  const nameClean = itemName.toLowerCase().replace(/spreads/g, 'spread').trim();
  const sizeClean = size ? size.toLowerCase().replace(/\s/g, '') : '';
  
  // Try combined key first
  const combinedKey = `${nameClean}_${sizeClean}`;
  if (skuMap[combinedKey]) return skuMap[combinedKey];
  
  // Try name only (for sandwiches/salads where size is omitted)
  if (skuMap[nameClean]) return skuMap[nameClean];
  
  // Fallbacks/Fuzzy matches
  if (nameClean.includes("yema")) {
    return sizeClean.includes("100") ? "YP-SAM-SWT" : "YP-IND-SWT";
  }
  if (nameClean.includes("tablea") || nameClean.includes("mores sandwich")) {
    if (nameClean.includes("tablea")) {
      if (nameClean.includes("sandwich") || nameClean.includes("s'mores")) return "STS-HF-SW-SWT";
      return sizeClean.includes("100") ? "ST-SAM-SWT" : "ST-IND-SWT";
    }
  }
  if (nameClean.includes("matcha")) {
    if (nameClean.includes("sandwich") || nameClean.includes("s'mores")) return "CMS-HF-SW-SWT";
    return sizeClean.includes("100") ? "CM-SAM-SWT" : "CM-IND-SWT";
  }
  if (nameClean.includes("mocha")) {
    if (nameClean.includes("sandwich") || nameClean.includes("s'mores")) return "WMS-HF-SW-SWT";
    return sizeClean.includes("100") ? "WM-SAM-SWT" : "WM-IND-SWT";
  }
  if (nameClean.includes("pesto")) {
    if (nameClean.includes("chicken")) return "PCHXW-SL-SW-SVR";
    if (nameClean.includes("egg") || nameClean.includes("tomato")) return "PEGG-SL-SW-SVR";
    if (nameClean.includes("club")) return "PCLB-HF-SW-SVR";
    if (nameClean.includes("sauce")) return sizeClean.includes("100") ? "PP-SAM-SVR" : "PP-IND-SVR";
  }
  
  return null;
}

function cleanNumber(str) {
  if (!str) return 0;
  const cleaned = str.replace(/[₱\$,%\-\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function runResellerImport() {
  if (!fs.existsSync(file)) {
    console.error(`❌ Reseller Comp file not found at ${file}`);
    return;
  }

  const pgClient = new Client({ connectionString: pgUri });
  await pgClient.connect();
  console.log("Connected to Supabase database.");

  // Proactively register missing SKUs in catalog if needed
  await pgClient.query(`
    INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty)
    VALUES 
      ('WMS-HF-SW-SWT', 'WHITE MOCHA S''MORES', 'Sweet', 'Half', 80.00, 80.00, 1),
      ('PCLB-HF-SW-SVR', 'PESTO CLUB SANDWICH', 'Savory', 'Half', 125.00, 125.00, 1)
    ON CONFLICT (sku) DO NOTHING
  `);

  const lines = fs.readFileSync(file, 'utf8')
    .split('\n')
    .map(l => l.split(',').map(c => c.trim()));

  const orders = [];

  // Ms. Anna Dolores left group (columns 0-4)
  const leftOrder = {
    reseller_name: "Ms. Anna Dolores",
    order_date: "2024-05-15", // default date
    items: [],
    subtotal: 2550,
    discount_percentage: 20.00,
    discount_amount: 510,
    grand_total: 2040
  };
  
  // Ms. Anna Dolores right group (columns 6-10)
  const rightOrder = {
    reseller_name: "Ms. Anna Dolores - Additional",
    order_date: "2024-05-15",
    items: [],
    subtotal: 510,
    discount_percentage: 20.00,
    discount_amount: 102,
    grand_total: 408
  };

  // Ms. Kate (columns 0-4)
  const kateOrder = {
    reseller_name: "Ms. Kate",
    order_date: "2024-06-01",
    items: [],
    subtotal: 7850,
    discount_percentage: 22.00,
    discount_amount: 1727,
    grand_total: 6123
  };

  // Drip Kofi 11/29 (columns 0-4)
  const dripKofi11 = {
    reseller_name: "Drip Kofi",
    order_date: "2024-11-29",
    items: [],
    subtotal: 1310,
    discount_percentage: 12.00,
    discount_amount: 157.2,
    grand_total: 1152.8
  };

  // Drip Kofi 12/9 (columns 0-4)
  const dripKofi12 = {
    reseller_name: "Drip Kofi",
    order_date: "2024-12-09",
    items: [],
    subtotal: 1365,
    discount_percentage: 12.00,
    discount_amount: 163.8,
    grand_total: 1201.2
  };

  // Parse lines manually based on section markers
  let currentSection = "";
  let lastLeftItemName = "";
  let lastRightItemName = "";

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (row.length === 0 || row.every(c => c === '')) continue;

    const firstCol = row[0] || '';

    if (firstCol.includes("Anna Dolores")) {
      currentSection = "anna";
      continue;
    }
    if (firstCol.includes("Ms. Kate")) {
      currentSection = "kate";
      continue;
    }
    if (firstCol.includes("DRIP KOFI") && row[1].includes("11/29")) {
      currentSection = "drip11";
      continue;
    }
    if (firstCol.includes("DRIP KOFI") && row[1].includes("12/9")) {
      currentSection = "drip12";
      continue;
    }

    if (row[0] === "Item" || row[0] === "ItemName" || row[0] === "Item ") continue;

    if (currentSection === "anna") {
      // Left item (columns 0-4)
      const leftItem = row[0] || '';
      const leftSize = row[1] || '';
      const leftQty = parseInt(row[2]) || 0;
      const leftPrice = cleanNumber(row[3]);
      
      if (leftQty > 0) {
        if (leftItem) lastLeftItemName = leftItem;
        const sku = resolveSku(lastLeftItemName, leftSize);
        if (sku) {
          leftOrder.items.push({ sku, qty: leftQty, price: leftPrice });
        } else {
          console.warn(`⚠️ Unmapped SKU for Anna Left: ${lastLeftItemName} (${leftSize})`);
        }
      }

      // Right item (columns 6-10)
      const rightItem = row[6] || '';
      const rightSize = row[7] || '';
      const rightQty = parseInt(row[8]) || 0;
      const rightPrice = cleanNumber(row[9]);

      if (rightQty > 0) {
        if (rightItem) lastRightItemName = rightItem;
        const sku = resolveSku(lastRightItemName, rightSize);
        if (sku) {
          rightOrder.items.push({ sku, qty: rightQty, price: rightPrice });
        } else {
          console.warn(`⚠️ Unmapped SKU for Anna Right: ${lastRightItemName} (${rightSize})`);
        }
      }
    } else if (currentSection === "kate") {
      const item = row[0] || '';
      const size = row[1] || '';
      const qty = parseInt(row[2]) || 0;
      const price = cleanNumber(row[3]);

      if (qty > 0) {
        const sku = resolveSku(item, size);
        if (sku) {
          kateOrder.items.push({ sku, qty, price });
        } else {
          console.warn(`⚠️ Unmapped SKU for Kate: ${item}`);
        }
      }
    } else if (currentSection === "drip11") {
      const item = row[0] || '';
      const qty = parseInt(row[1]) || 0;
      const price = cleanNumber(row[2]);

      if (qty > 0 && !row[0].includes("Subtotal") && !row[1].includes("discount")) {
        const sku = resolveSku(item, "");
        if (sku) {
          dripKofi11.items.push({ sku, qty, price });
        } else {
          console.warn(`⚠️ Unmapped SKU for Drip Kofi 11/29: ${item}`);
        }
      }
    } else if (currentSection === "drip12") {
      const item = row[0] || '';
      const qty = parseInt(row[1]) || 0;
      const price = cleanNumber(row[2]);

      if (qty > 0 && !row[0].includes("Subtotal") && !row[1].includes("discount")) {
        const sku = resolveSku(item, "");
        if (sku) {
          dripKofi12.items.push({ sku, qty, price });
        } else {
          console.warn(`⚠️ Unmapped SKU for Drip Kofi 12/9: ${item}`);
        }
      }
    }
  }

  orders.push(leftOrder, rightOrder, kateOrder, dripKofi11, dripKofi12);

  let totalOrdersInserted = 0;
  let totalItemsInserted = 0;

  for (const ord of orders) {
    // Check if order already exists in database
    const checkRes = await pgClient.query(
      "SELECT id FROM reseller_orders WHERE reseller_name = $1 AND order_date = $2",
      [ord.reseller_name, ord.order_date]
    );

    let orderId;
    if (checkRes.rows.length > 0) {
      orderId = checkRes.rows[0].id;
    } else {
      const ordRes = await pgClient.query(`
        INSERT INTO reseller_orders (reseller_name, order_date, subtotal, discount_percentage, discount_amount, grand_total, is_paid)
        VALUES ($1, $2, $3, $4, $5, $6, TRUE)
        RETURNING id
      `, [ord.reseller_name, ord.order_date, ord.subtotal, ord.discount_percentage, ord.discount_amount, ord.grand_total]);
      orderId = ordRes.rows[0].id;
      totalOrdersInserted++;
    }

    // Sync items
    for (const item of ord.items) {
      const checkItem = await pgClient.query(
        "SELECT id FROM reseller_order_items WHERE order_id = $1 AND sku = $2",
        [orderId, item.sku]
      );
      if (checkItem.rows.length === 0) {
        await pgClient.query(`
          INSERT INTO reseller_order_items (order_id, sku, quantity, price_snapshot)
          VALUES ($1, $2, $3, $4)
        `, [orderId, item.sku, item.qty, item.price]);
        totalItemsInserted++;
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`🎉 RESELLER IMPORT COMPLETE!`);
  console.log(`  Reseller Orders Logged: ${totalOrdersInserted}`);
  console.log(`  Reseller Order Items Logged: ${totalItemsInserted}`);
  console.log(`========================================`);

  await pgClient.end();
}

runResellerImport().catch(console.error);

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

const partners = [
  { name: "Likhang Laguna", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - Likhang Laguna.csv" },
  { name: "OTOP", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - OTOP.csv" },
  { name: "AA Mart", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - AA Mart.csv" },
  { name: "Artisan", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - ARTISAN .csv" },
  { name: "Pinana", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - Pinana.csv" },
  { name: "Kitchen Angels", file: "C:\\Users\\aaron\\Downloads\\Partner Inventory Management - KITCHEN ANGELS.csv" }
];

function cleanNumber(str) {
  if (!str) return 0;
  // Remove currency signs, commas, and percentage signs
  const cleaned = str.replace(/[₱\$,%\s]/g, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function parseDate(str) {
  if (!str || str.trim() === '' || str.includes('#') || str.includes('ROI')) return null;
  const parts = str.split('/');
  if (parts.length === 3) {
    let m = parts[0].padStart(2, '0');
    let d = parts[1].padStart(2, '0');
    let y = parts[2];
    if (y.length === 2) y = "20" + y;
    return `${y}-${m}-${d}`;
  }
  const iso = new Date(str.trim());
  if (!isNaN(iso.getTime())) {
    return iso.toISOString().split('T')[0];
  }
  return null;
}

async function runImport() {
  const pgClient = new Client({ connectionString: pgUri });
  await pgClient.connect();
  console.log("Connected to Supabase PostgreSQL.");

  // Get active partner mapping
  const partnerRes = await pgClient.query("SELECT id, name FROM consignment_partners");
  const partnerMap = {};
  partnerRes.rows.forEach(r => {
    // lowercase match for robust mapping
    partnerMap[r.name.toLowerCase().trim()] = r.id;
  });
  console.log("Database partners:", partnerMap);

  // Get active product SKUs list to filter out summary rows
  const skuRes = await pgClient.query("SELECT sku FROM product_skus");
  const dbSkus = new Set(skuRes.rows.map(r => r.sku.toLowerCase().trim()));

  // Keep track of counts
  let totalDeliveriesCreated = 0;
  let totalItemsCreated = 0;

  for (const p of partners) {
    const partnerKey = p.name.toLowerCase().trim();
    const partnerId = partnerMap[partnerKey];
    if (!partnerId) {
      console.warn(`⚠️ Partner ${p.name} not found in database! Skipping file.`);
      continue;
    }

    if (!fs.existsSync(p.file)) {
      console.warn(`⚠️ File not found: ${p.file}. Skipping.`);
      continue;
    }

    console.log(`\n----------------------------------------`);
    console.log(`Processing: ${p.name} (File: ${path.basename(p.file)})`);
    console.log(`----------------------------------------`);

    const rawContent = fs.readFileSync(p.file, 'utf8');
    const lines = rawContent.split('\n').map(l => l.split(',').map(c => c.trim()));

    // Find header
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('SKU')) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      console.error(`❌ Could not find header row for ${p.name}`);
      continue;
    }

    const headers = lines[headerIdx];
    
    // Dynamic column index resolution
    const skuCol = headers.indexOf('SKU');
    
    const dateCol = headers.findIndex(h => h.includes('Date of Delivery') || h.includes('Date of delivery') || h.includes('Delivery Date'));
    const drCol = headers.indexOf('DR #');
    
    const costCol = headers.findIndex(h => h.includes('Cost/Unit') || h.includes('Cost / Unit'));
    
    // Reseller Price has different names:
    const resellerCol = headers.findIndex(h => 
      h.includes("Reseller's Price") || 
      h.includes("Price for OTOP") || 
      h.includes("Reseller's Price (10% off)") ||
      h.includes("H+H Price")
    );

    const storeCol = headers.findIndex(h => 
      h.includes("Store Price") || 
      h.includes("SRP")
    );

    const qtyCol = headers.findIndex(h => h.includes('QTY delivered') || h.includes('QTY Delivered'));
    const soldCol = headers.findIndex(h => h.includes('Units Sold') || h.includes('Units sold'));
    
    const pulloutCol = headers.findIndex(h => h.includes('Pull out QTY') || h.includes('Pullout Qty') || h.includes('Pull-out'));
    
    const amtPaidCol = headers.findIndex(h => h.includes('Amount Paid') || h.includes('To collect') || h.includes('Total Sales'));
    const datePaidCol = headers.findIndex(h => h.includes('Date Paid') || h.includes('Date paid'));

    console.log(`Column Indices: SKU=${skuCol}, Date=${dateCol}, DR=${drCol}, Cost=${costCol}, ResellerPrice=${resellerCol}, StorePrice=${storeCol}, Qty=${qtyCol}, Sold=${soldCol}, Pullout=${pulloutCol}, DatePaid=${datePaidCol}`);

    // Map of unique deliveries we've inserted during this script to prevent duplicate inserts
    // Key: date_dr
    const localDeliveryCache = {};

    let partnerRowsCount = 0;

    for (let i = headerIdx + 1; i < lines.length; i++) {
      const row = lines[i];
      if (row.length <= skuCol) continue;
      
      const sku = row[skuCol] ? row[skuCol].trim() : '';
      // Skip if not a valid product SKU (filters out "Total", "PULL OUT", etc.)
      if (!sku || !dbSkus.has(sku.toLowerCase())) continue;

      const rawDate = row[dateCol] ? row[dateCol].trim() : '';
      const deliveryDate = parseDate(rawDate);
      if (!deliveryDate) continue; // Skip rows without a valid date of delivery

      const drNumber = row[drCol] ? row[drCol].trim() : 'DR-' + deliveryDate.replace(/-/g, '');
      const costSnapshot = cleanNumber(row[costCol]);
      const resellerSnapshot = cleanNumber(row[resellerCol]);
      const storeSnapshot = storeCol !== -1 ? cleanNumber(row[storeCol]) : resellerSnapshot; // Fallback to reseller price if store price is not defined

      const qtyDelivered = parseInt(row[qtyCol]) || 0;
      const unitsSold = parseInt(row[soldCol]) || 0;
      const qtyPulledOut = pulloutCol !== -1 ? (parseInt(row[pulloutCol]) || 0) : 0;
      
      const rawDatePaid = datePaidCol !== -1 ? row[datePaidCol] : '';
      const paymentDate = parseDate(rawDatePaid);
      const isPaid = !!paymentDate;

      // Deduce delivery cache key
      const deliveryKey = `${deliveryDate}_${drNumber}`;
      let deliveryId;

      if (localDeliveryCache[deliveryKey]) {
        deliveryId = localDeliveryCache[deliveryKey];
      } else {
        // Query database to see if delivery exists
        const checkRes = await pgClient.query(
          "SELECT id FROM consignment_deliveries WHERE partner_id = $1 AND delivery_date = $2 AND dr_number = $3",
          [partnerId, deliveryDate, drNumber]
        );
        
        if (checkRes.rows.length > 0) {
          deliveryId = checkRes.rows[0].id;
        } else {
          // Insert new delivery
          const delRes = await pgClient.query(`
            INSERT INTO consignment_deliveries (partner_id, delivery_date, dr_number, is_paid, payment_date)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING id
          `, [partnerId, deliveryDate, drNumber, isPaid, paymentDate]);
          deliveryId = delRes.rows[0].id;
          totalDeliveriesCreated++;
        }
        localDeliveryCache[deliveryKey] = deliveryId;
      }

      // Check if consignment item already exists
      const itemCheck = await pgClient.query(
        "SELECT id FROM consignment_items WHERE delivery_id = $1 AND sku = $2",
        [deliveryId, sku]
      );

      if (itemCheck.rows.length === 0) {
        // Insert consignment item
        await pgClient.query(`
          INSERT INTO consignment_items (delivery_id, sku, qty_delivered, units_sold, qty_pulled_out, reseller_price_snapshot, cost_per_unit_snapshot, store_price_snapshot)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [deliveryId, sku, qtyDelivered, unitsSold, qtyPulledOut, resellerSnapshot, costSnapshot, storeSnapshot]);
        totalItemsCreated++;
      }

      partnerRowsCount++;
    }

    console.log(`Uploaded ${partnerRowsCount} transaction records for ${p.name}.`);
  }

  console.log(`\n========================================`);
  console.log(`🎉 IMPORT COMPLETE!`);
  console.log(`  Consignment Deliveries Created: ${totalDeliveriesCreated}`);
  console.log(`  Consignment Items Logged: ${totalItemsCreated}`);
  console.log(`========================================`);

  await pgClient.end();
}

runImport().catch(console.error);

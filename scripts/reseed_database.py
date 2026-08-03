import os
import csv
import re
import sqlite3
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

CSV_DIR = r"C:\Users\aaron\Downloads\H+H -20260710T063840Z-2-001\H+H"
SQLITE_DB = "backend/happy_noether.db"
POSTGRES_URI = os.getenv("DATABASE_URL")

# Schema files
SCHEMA_SQLITE = "backend/database/schema_sqlite.sql"
SCHEMA_EXPANSION = "backend/database/schema_expansion.sql"

# Strict mapping of recipe names (from sheets) to SKUs
RECIPE_TO_SKU = {
    # Spreads / Fillings
    "YEMA WITH PILI SPREAD": "YP-IND-SWT",
    "SWEET TABLEA WITH PEANUTS SPREAD": "ST-IND-SWT",
    "CREAMY MATCHA SPREAD": "CM-IND-SWT",
    "WHITE MOCHA WITH MACADAMIA SPREAD": "WM-IND-SWT",
    "NEW SWEET TABLEA WITH PEANUTS SPREAD": "ST-IND-SWT",
    "PESTO WITH PILI SAUCE": "PP-IND-SVR",
    "CHILI GARLIC OIL": "CGO-IND-SVR",
    "CHICKEN LIVER SPREAD": "CLS-IND-SVR",
    "COLD BREW RECIPE": "UNSW-CB-200",
    
    # Sub-Recipes (Mousses / Mixes)
    "SALMON MIX": "SSS-SL-SW-SVR",
    "TUNA MIX": "TSLD-SL-SW-SVR",
    "TABLEA MOUSSE": "STS-FL-SW-SWT",
    "BRAZO FILLING": "YMB-SL-SW-SWT",
    "TIRAMISU MOUSSE": "TRM-FL-SW-SWT",
    "UBE MOUSSE": "UYK-FL-SW-CK",
    "BLACK FOREST MOUSSE": "TBF-FL-SW-CK",
    "PESTO BECHAMEL": "PP-IND-SVR",
    
    # Pastas & Pastries
    "TUNA PESTO PASTA": "TPP-SL-PASTA",
    "PESTO TOMATO RIGATONI": "PTR-SL-PASTA",
    "CHILI ASIAN PASTA": "CAP-SL-PASTA",
    "BACON MAC AND CHEESE": "CAP-SL-PASTA", 
    "YEMA WITH PILI BRAZO CUPS": "YPBZ-DES-2S",
    "CLASSIC CRINKLES": "CL-CRK-PSTRY-1S",
    "TABLEA LAVA CRINKLES": "TBL-CRK-PSTRY-1S",
    "MATCHA LAVA CRINKLES": "ML-CRK-PSTRY-1S",
    "MACCHIATO LAVA CRINKLES": "MACCL-CRK-PSTRY-1S",
    "CLASSIC MATCHA CRINKLES": "M-CRK-PSTRY-1S",
    
    # Sandwiches
    "GRILLED CHEESE": "GCP-SL-SW-SVR",
    "GRILLED CHEESE & PESTO WITH PILI": "GCP-SL-SW-SVR",
    "PESTO EGG": "PEGG-SL-SW-SVR",
    "PESTO CHICKEN WITH CHEESE": "PCHXW-SL-SW-SVR",
    "PESTO CHICKEN WITH CHEESE RICE MEAL": "PCHXW-SL-SW-SVR",
    "PESTO CORNED BEEF W/ CHEESE": "PCBW-SL-SW-SVR",
    "SPICY SMOKED SALMON": "SSS-SL-SW-SVR",
    "TUNA SALAD SANDWICH": "TSLD-SL-SW-SVR",
    "BACON LETTUCE AND TOMATO": "BLT-SL-SW-SVR",
    "TABLEA ROCKY ROAD": "TRRD-SL-SW-SWT",
    "YEMA BRAZO": "YMB-SL-SW-SWT",
    "TABLEA S'MORES": "STS-FL-SW-SWT",
    "SWEET TABLEA S'MORES": "STS-FL-SW-SWT",
    "COOKIES AND MATCH S'MORES": "CMS-FL-SW-SWT", # Note: can map MATCH/MATCHA
    "COOKIES AND MATCHA S'MORES": "CMS-FL-SW-SWT",
    "TIRAMISU SANDWICH": "TRM-FL-SW-SWT",
    "UBE YEMA WITH PILI AND KESO": "UYK-FL-SW-CK",
    "MACCHIATO HONEYCOMB CRUNCH": "MHC-FL-SW-CK",
    "TABLEA BLACK FOREST": "TBF-FL-SW-CK",
    "PESTO, TOMATO, AND EGG": "PTE-FL-SW-SVR",
    "PESTO PEPPERONI PIZZA SW": "PPZ-FL-SW-SVR",
    "PESTO PEPPERONI PIZZA SANDWICH": "PPZ-FL-SW-SVR",
    "PESTO CROQUE MONSIEUR": "CQM-FL-SW-SVR",
    "PESTO CROQUE MADAME": "CQMD-FL-SW-SVR",
    "PESTO CLUB SANDWICH": "PCS-FL-SW-SVR"
}

# Sub-recipe SKU mappings
INGREDIENT_SUB_RECIPES = {
    "pesto": "PP-IND-SVR",
    "pesto sauce": "PP-IND-SVR",
    "yema": "YP-IND-SWT",
    "yema spread": "YP-IND-SWT",
    "matcha": "CM-IND-SWT",
    "matcha spread": "CM-IND-SWT",
    "salmon mix": "SSS-SL-SW-SVR",
    "tuna mix": "TSLD-SL-SW-SVR",
    "brazo filling": "YMB-SL-SW-SWT",
    "yema brazo filling": "YMB-SL-SW-SWT",
    "tiramisu mousse": "TRM-FL-SW-SWT",
    "ube mousse": "UYK-FL-SW-CK",
    "black forest mousse": "TBF-FL-SW-CK",
    "wm mousse": "WM-IND-SWT",
    "bechamel": "PP-IND-SVR",
    "white mocha mousse": "WM-IND-SWT",
    "sweet tablea": "ST-IND-SWT",
    "creamy matcha": "CM-IND-SWT",
    "white mocha": "WM-IND-SWT",
    "chili garlic": "CGO-IND-SVR",
    "chicken liver spread": "CLS-IND-SVR",
    "spread": "YP-IND-SWT"
}

# Synonym mapping to clean up names and match database records
SYNONYMS = {
    "all purpose flour": "apf",
    "parmersan": "grated processed parmesan",
    "perfect pasta sream": "perfect pasta cream",
    "perfect pasta cream to mix": "perfect pasta cream",
    "tablea chopped": "tablea",
    "ground roasted peanuts": "roasted peanuts",
    "roasted peanuts": "roasted peanuts",
    "roasted pili, finely chopped": "roasted pili",
    "roasted macadamia, finely chopped": "roasted macadamia",
    "instant coffee powder": "coffee powder",
    "wheat bread": "bread",
    "wheaten bread": "bread",
    "white bread": "bread",
    "ube bread": "bread",
    "chocolate chip bread": "bread",
    "vinegar": "white vinegar",
    "tuna": "tuna flakes in oil",
    "basil garnish": "basil",
    "sweet basil": "basil",
    "cayenne": "cayenne powder",
    "paprika": "paprika powder",
    "chili": "taiwan chili",
    "garlic": "garlic",
    "onion": "onion",
    "pepper": "black pepper",
    "cgo": "chili garlic oil"
}

def clean_name(name):
    name = name.lower().strip()
    return SYNONYMS.get(name, name)

def safe_float(val, default=0.0):
    if not val:
        return default
    cleaned = re.sub(r'[^\d\.\-]', '', val.replace('₱', '').replace(',', '').strip())
    try:
        return float(cleaned) if cleaned else default
    except ValueError:
        return default

def run_seeding():
    print("Re-initializing local SQLite database...")
    # Initialize SQLite database with core schemas
    lite_conn = sqlite3.connect(SQLITE_DB)
    lite_cur = lite_conn.cursor()

    # Run schema files
    if os.path.exists(SCHEMA_SQLITE):
        print(f"Executing {SCHEMA_SQLITE}...")
        with open(SCHEMA_SQLITE, "r") as f:
            lite_cur.executescript(f.read())
            
    if os.path.exists(SCHEMA_EXPANSION):
        print(f"Executing {SCHEMA_EXPANSION}...")
        with open(SCHEMA_EXPANSION, "r") as f:
            lite_cur.executescript(f.read())
            
    lite_conn.commit()

    # Clear recipes and dependencies in SQLite
    print("Clearing recipes and dependencies...")
    lite_cur.execute("DELETE FROM recipe_items")
    lite_cur.execute("DELETE FROM recipes")
    lite_cur.execute("DELETE FROM category_overhead_rates")
    lite_conn.commit()

    # Delete literal headers from product_skus
    lite_cur.execute("DELETE FROM product_skus WHERE sku = 'SKU' OR product_name = 'Product Name'")
    lite_conn.commit()

    # Load existing SKUs and Raw Ingredients from the database
    lite_cur.execute("SELECT sku, product_name FROM product_skus")
    existing_skus = {row[0].strip(): row[1].strip() for row in lite_cur.fetchall()}

    lite_cur.execute("SELECT id, name FROM raw_ingredients")
    existing_ingredients = {row[1].lower().strip(): row[0] for row in lite_cur.fetchall()}

    # 2. Add missing product SKUs
    new_skus = [
        ("CLS-IND-SVR", "Chicken Liver Spread", "Savory", "Indulge", 250.0, 230.0),
        ("CLS-SAM-SVR", "Chicken Liver Spread", "Sampler", "Savory", 130.0, 120.0),
        ("PCS-FL-SW-SVR", "Pesto Club Sandwich", "Sandwich", "Full", 245.0, 208.25),
        ("PCS-HF-SW-SVR", "Pesto Club Sandwich", "Sandwich", "Half", 125.0, 106.25),
        ("BLT-SL-SW-SVR", "Bacon Lettuce and Tomato", "Sandwich", "Solo", 120.0, 102.0),
        # Cold Brew Drinks — retail prices from Analysis.csv; reseller = 10% consignment discount
        ("UNSW-CB-200", "Unsweetened Cold Brew", "drink", "200ml", 100.0, 90.0),
        ("SWTD-CB-200", "Sweetened Cold Brew", "drink", "200ml", 100.0, 90.0),
        ("TSOK-CB-200", "Tsokolate", "drink", "200ml", 130.0, 117.0),
        ("WHM-CB-200", "White Mocha Cold Brew", "drink", "200ml", 120.0, 108.0),
        ("DMAT-CB-200", "Dirty Matcha Cold Brew", "drink", "200ml", 110.0, 99.0),
        ("SPLAT-CB-200", "Spanish Latte Cold Brew", "drink", "200ml", 110.0, 99.0),
        # Pasta — retail prices from Analysis.csv; reseller = 10% discount
        ("TPP-SL-PASTA", "Tuna Pesto Pasta", "pasta", "Pasta Tub", 130.0, 117.0),
        ("PTR-SL-PASTA", "Pesto Tomato Rigatoni", "pasta", "Pasta Tub", 150.0, 135.0),
        ("CAP-SL-PASTA", "Chili Asian Pasta", "pasta", "Pasta Tub", 130.0, 117.0),
        # Desserts
        ("YPBZ-DES-2S", "Yema with Pili Brazo Cups", "dessert", "2s", 130.0, 117.0),
        ("YPBZ-DES-4S", "Yema with Pili Brazo Cups", "dessert", "4s", 250.0, 225.0),
        # Pastries — retail prices from Analysis.csv; reseller = 10% discount
        ("CL-CRK-PSTRY-1S", "Classic Crinkles", "pastry", "1s", 40.0, 36.0),
        ("CL-CRK-PSTRY-5S", "Classic Crinkles", "pastry", "5s", 190.0, 171.0),
        ("TBL-CRK-PSTRY-1S", "Tablea Lava Crinkles", "pastry", "1s", 45.0, 40.5),
        ("TBL-CRK-PSTRY-5S", "Tablea Lava Crinkles", "pastry", "5s", 215.0, 193.5),
        ("ML-CRK-PSTRY-1S", "Matcha Lava Crinkles", "pastry", "1s", 45.0, 40.5),
        ("ML-CRK-PSTRY-5S", "Matcha Lava Crinkles", "pastry", "5s", 215.0, 193.5),
        ("MACCL-CRK-PSTRY-1S", "Macchiato Lava Crinkles", "pastry", "1s", 45.0, 40.5),
        ("MACCL-CRK-PSTRY-5S", "Macchiato Lava Crinkles", "pastry", "5s", 215.0, 193.5),
        ("PST-CRK-PSTRY-1S", "Pastillas Crinkles", "pastry", "1s", 45.0, 40.5),
        ("PST-CRK-PSTRY-5S", "Pastillas Crinkles", "pastry", "5s", 215.0, 193.5),
        ("M-CRK-PSTRY-1S", "Classic Matcha Crinkles", "pastry", "1s", 40.0, 36.0),
        ("M-CRK-PSTRY-5S", "Classic Matcha Crinkles", "pastry", "5s", 190.0, 171.0),
        ("SB-CRK-PSTRY-1S", "Strawberry Chili Crinkles", "pastry", "1s", 40.0, 36.0),
        ("SB-CRK-PSTRY-5S", "Strawberry Chili Crinkles", "pastry", "5s", 190.0, 171.0),
    ]
    for sku, name, cat, sz, ret, res in new_skus:
        if sku not in existing_skus:
            print(f"Adding missing SKU: {sku} ({name})")
            lite_cur.execute("""
                INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement)
                VALUES (?, ?, ?, ?, ?, ?, 1, '', '')
            """, (sku, name, cat, sz, ret, res))
            existing_skus[sku] = name
    lite_conn.commit()

    # 3. Extract all raw ingredients from the recipe sheets to make sure none are missing
    costing_files = [
        "H+H Food System Trackers - Full and Half Sandwiches FC_.csv",
        "H+H Food System Trackers - Solo Sandwiches FC_.csv",
        "H+H Food System Trackers - Pasta FC_.csv",
        "H+H Food System Trackers - Savory FC_.csv",
        "H+H Food System Trackers - Sweet FC_.csv"
    ]

    for f_name in costing_files:
        f_path = os.path.join(CSV_DIR, f_name)
        if not os.path.exists(f_path):
            continue
        print(f"Extracting ingredients from costing file: {f_name}")
        with open(f_path, mode='r', encoding='utf-8-sig', errors='ignore') as file:
            reader = list(csv.reader(file))
            for r_idx, row in enumerate(reader):
                for c_idx, cell in enumerate(row):
                    if cell.strip().upper() == "INGREDIENTS":
                        # Read ingredients below it
                        for offset in range(1, 20):
                            ing_row = r_idx + offset
                            if ing_row >= len(reader):
                                break
                            r_data = reader[ing_row]
                            if len(r_data) <= c_idx + 4:
                                break
                            ing_name = r_data[c_idx].strip()
                            # Stop indicators
                            if not ing_name or ing_name.upper() in ["TOTAL", "NO. OF SERVINGS", "RECIPE NAME", "INGREDIENTS", "TOTAL COST", "PACKAGING COST"]:
                                break
                            
                            cleaned = clean_name(ing_name)
                            if cleaned in INGREDIENT_SUB_RECIPES:
                                continue # Skip sub-recipes

                            price = safe_float(r_data[c_idx+1]) if c_idx+1 < len(r_data) else 0.0
                            net_wt = safe_float(r_data[c_idx+2], default=1.0) if c_idx+2 < len(r_data) else 1.0
                            unit = r_data[c_idx+3].strip() or "grams"
                            
                            # Add to database if not present
                            if cleaned not in existing_ingredients:
                                # Safe word boundary check against database to avoid duplicates
                                found_id = None
                                for db_name, db_id in existing_ingredients.items():
                                    if re.search(r'\b' + re.escape(cleaned) + r'\b', db_name) or re.search(r'\b' + re.escape(db_name) + r'\b', cleaned):
                                        found_id = db_id
                                        break
                                
                                if found_id:
                                    existing_ingredients[cleaned] = found_id
                                else:
                                    print(f"Inserting missing Raw Ingredient: {ing_name} (Cleaned: {cleaned}) | Price: {price} | NetWt: {net_wt}")
                                    lite_cur.execute("""
                                        INSERT INTO raw_ingredients (name, category, unit, price, net_weight, available_stock, reorder_level)
                                        VALUES (?, ?, ?, ?, ?, 0.0, 0.0)
                                    """, (ing_name, "Raw Material", unit, price, net_wt))
                                    existing_ingredients[cleaned] = lite_cur.lastrowid
                                    existing_ingredients[ing_name.lower().strip()] = lite_cur.lastrowid
    lite_conn.commit()

    # 4. Parse recipes from calculator sheets
    recipe_files = [
        "H+H Production Inventory Management - Adjustable Recipe Spreads_Fillings.csv",
        "H+H Production Inventory Management - Adjustable Pasta and Pastries.csv",
        "H+H Production Inventory Management - Sandwich Ingredient Calc.csv"
    ]

    for filename in recipe_files:
        filepath = os.path.join(CSV_DIR, filename)
        if not os.path.exists(filepath):
            print(f"Recipe file not found: {filename}")
            continue
        print(f"Parsing recipes from: {filename}")
        with open(filepath, mode='r', encoding='utf-8-sig', errors='ignore') as f:
            rows = list(csv.reader(f))
            
            # Scan for 'RECIPE NAME' / 'COLD BREW RECIPE'
            parsed_blocks = set() # Avoid parsing same block twice
            for r_idx in range(len(rows)):
                row = rows[r_idx]
                for c_idx in range(len(row)):
                    cell_val = row[c_idx].strip()
                    if cell_val.upper() in ['RECIPE NAME', 'COLD BREW RECIPE']:
                        block_key = f"{r_idx}-{c_idx}"
                        if block_key in parsed_blocks:
                            continue
                        
                        recipe_name = row[c_idx+1].strip() if c_idx+1 < len(row) else ""
                        if not recipe_name and cell_val.upper() == 'COLD BREW RECIPE':
                            recipe_name = "COLD BREW RECIPE"
                            
                        if not recipe_name:
                            continue
                            
                        # Locate definition values (Yield & Portion)
                        # Yield is at row r_idx + 2, col c_idx + 1
                        yield_row = r_idx + 2
                        yield_val = 0.0
                        yield_unit = "g"
                        if yield_row < len(rows) and len(rows[yield_row]) > c_idx + 1:
                            yield_val = safe_float(rows[yield_row][c_idx+1])
                            if len(rows[yield_row]) > c_idx + 2:
                                yield_unit = rows[yield_row][c_idx+2].strip() or "g"
                                
                        # Portion is at row r_idx + 4, col c_idx + 1
                        portion_row = r_idx + 4
                        portion_val = 0.0
                        portion_unit = "g"
                        if portion_row < len(rows) and len(rows[portion_row]) > c_idx + 1:
                            portion_val = safe_float(rows[portion_row][c_idx+1])
                            if len(rows[portion_row]) > c_idx + 2:
                                portion_unit = rows[portion_row][c_idx+2].strip() or "g"

                        # Retrieve SKU
                        target_sku = RECIPE_TO_SKU.get(recipe_name.upper())
                        if not target_sku:
                            print(f"Skipping recipe without SKU mapping: {recipe_name}")
                            continue

                        # Check if recipe already exists for target_sku to avoid unique clash
                        lite_cur.execute("SELECT id FROM recipes WHERE sku = ?", (target_sku,))
                        existing_recipe = lite_cur.fetchone()
                        if existing_recipe:
                            recipe_id = existing_recipe[0]
                            # Clear old recipe items
                            lite_cur.execute("DELETE FROM recipe_items WHERE recipe_id = ?", (recipe_id,))
                            # Update recipe definition
                            lite_cur.execute("""
                                UPDATE recipes 
                                SET yield_weight = ?, yield_unit = ?, portion_size = ?, portion_unit = ?, notes = ?
                                WHERE id = ?
                            """, (yield_val, yield_unit, portion_val, portion_unit, f"Imported recipe for {recipe_name}", recipe_id))
                            print(f"Updated Recipe for: {recipe_name} -> SKU: {target_sku} | Yield: {yield_val} {yield_unit} | Portion: {portion_val} {portion_unit}")
                        else:
                            lite_cur.execute("""
                                INSERT INTO recipes (sku, yield_weight, yield_unit, portion_size, portion_unit, notes)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (target_sku, yield_val, yield_unit, portion_val, portion_unit, f"Imported recipe for {recipe_name}"))
                            recipe_id = lite_cur.lastrowid
                            print(f"Seeding Recipe for: {recipe_name} -> SKU: {target_sku} | Yield: {yield_val} {yield_unit} | Portion: {portion_val} {portion_unit}")

                        # Mark the definition block as parsed
                        parsed_blocks.add(block_key)

                        # Locate ingredients list block (exactly 7 rows below)
                        ing_hdr_row = r_idx + 7
                        # Mark it as parsed so we don't treat it as a separate recipe
                        parsed_blocks.add(f"{ing_hdr_row}-{c_idx}")

                        # Parse ingredients rows
                        for offset in range(9, 25):
                            ing_row = r_idx + offset
                            if ing_row >= len(rows):
                                break
                            r_data = rows[ing_row]
                            if len(r_data) <= c_idx + 2:
                                break
                            ing_name = r_data[c_idx].strip()
                            
                            # Break or continue criteria
                            if not ing_name or ing_name.upper() == "RECIPE NAME" or ing_name.upper().startswith("TOTAL") or ing_name.upper() == "INGREDIENTS":
                                if ing_name.upper() == "RECIPE NAME":
                                    break
                                continue
                            
                            qty = safe_float(r_data[c_idx+1])
                            unit = r_data[c_idx+2].strip() or "g"

                            cleaned = clean_name(ing_name)
                            
                            ing_type = "raw"
                            raw_id = None
                            sub_sku = None

                            if cleaned in INGREDIENT_SUB_RECIPES:
                                ing_type = "sku"
                                sub_sku = INGREDIENT_SUB_RECIPES[cleaned]
                            else:
                                raw_id = existing_ingredients.get(cleaned)
                                if not raw_id:
                                    # Fallback word boundary check
                                    for db_name, db_id in existing_ingredients.items():
                                        if re.search(r'\b' + re.escape(cleaned) + r'\b', db_name):
                                            raw_id = db_id
                                            break

                            # Save item
                            lite_cur.execute("""
                                INSERT INTO recipe_items (recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (recipe_id, ing_type, raw_id, sub_sku, qty, unit))

    # 5. Seed category overhead rates with correct spread rates
    lite_cur.execute("INSERT INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit) VALUES ('spread', 22.50, 3.28)")
    lite_cur.execute("INSERT INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit) VALUES ('sandwich', 6.30, 3.28)")
    lite_cur.execute("INSERT INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit) VALUES ('pasta', 10.23, 3.28)")
    lite_cur.execute("INSERT INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit) VALUES ('pastry', 5.00, 3.28)")
    lite_conn.commit()

    print("Local SQLite database successfully updated!")

    # 6. Upload clean tables to Supabase Postgres
    if not POSTGRES_URI:
        print("DATABASE_URL is not set. Skipping Supabase sync.")
        lite_conn.close()
        return

    print("Connecting to Supabase Postgres...")
    pg_conn = psycopg2.connect(POSTGRES_URI)
    pg_cur = pg_conn.cursor()

    try:
        print("Syncing product_skus table...")
        lite_cur.execute("SELECT sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement FROM product_skus")
        for p in lite_cur.fetchall():
            pg_cur.execute("""
                INSERT INTO product_skus (sku, product_name, category, size, retail_price, reseller_price, pack_qty, storage_life, serving_requirement)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    product_name = EXCLUDED.product_name,
                    category = EXCLUDED.category,
                    size = EXCLUDED.size,
                    retail_price = EXCLUDED.retail_price,
                    reseller_price = EXCLUDED.reseller_price
            """, p)
            
        print("Syncing raw_ingredients table...")
        lite_cur.execute("SELECT id, name, category, unit, price, net_weight, available_stock, reorder_level FROM raw_ingredients")
        for r in lite_cur.fetchall():
            pg_cur.execute("""
                INSERT INTO raw_ingredients (id, name, category, unit, price, net_weight, available_stock, reorder_level)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name,
                    category = EXCLUDED.category,
                    unit = EXCLUDED.unit,
                    price = EXCLUDED.price,
                    net_weight = EXCLUDED.net_weight
            """, r)

        print("Syncing recipes table...")
        # Clear remote recipes and recipe items to avoid duplicate foreign key clashes
        pg_cur.execute("DELETE FROM recipe_items")
        pg_cur.execute("DELETE FROM recipes")
        
        lite_cur.execute("SELECT id, sku, yield_weight, yield_unit, portion_size, portion_unit, notes FROM recipes")
        for r in lite_cur.fetchall():
            pg_cur.execute("""
                INSERT INTO recipes (id, sku, yield_weight, yield_unit, portion_size, portion_unit, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, r)

        print("Syncing recipe_items table...")
        lite_cur.execute("SELECT id, recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit FROM recipe_items")
        for ri in lite_cur.fetchall():
            pg_cur.execute("""
                INSERT INTO recipe_items (id, recipe_id, ingredient_type, raw_ingredient_id, sub_sku, base_qty, base_unit)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, ri)

        print("Syncing category_overhead_rates table...")
        pg_cur.execute("DELETE FROM category_overhead_rates")
        lite_cur.execute("SELECT category, labor_cost_per_unit, utility_cost_per_unit FROM category_overhead_rates")
        for o in lite_cur.fetchall():
            pg_cur.execute("""
                INSERT INTO category_overhead_rates (category, labor_cost_per_unit, utility_cost_per_unit)
                VALUES (%s, %s, %s)
            """, o)

        pg_conn.commit()
        print("DATABASE SYNC TO SUPABASE COMPLETE!")

    except Exception as err:
        print(f"Error during Supabase sync: {err}")
        pg_conn.rollback()
    finally:
        pg_cur.close()
        pg_conn.close()
        lite_conn.close()

if __name__ == "__main__":
    run_seeding()

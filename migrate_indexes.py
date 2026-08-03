import os
import sqlite3
from dotenv import load_dotenv

# Load .env file
load_dotenv()

INDEX_STATEMENTS = [
    "CREATE INDEX IF NOT EXISTS idx_ingredient_batches_raw_ingredient_id ON ingredient_batches(raw_ingredient_id)",
    "CREATE INDEX IF NOT EXISTS idx_ingredient_batches_expiry_date ON ingredient_batches(expiry_date)",
    "CREATE INDEX IF NOT EXISTS idx_reseller_order_items_order_id ON reseller_order_items(order_id)",
    "CREATE INDEX IF NOT EXISTS idx_reseller_order_items_sku ON reseller_order_items(sku)",
    "CREATE INDEX IF NOT EXISTS idx_inventory_transactions_sku ON inventory_transactions(sku)",
    "CREATE INDEX IF NOT EXISTS idx_inventory_transactions_raw_ingredient_id ON inventory_transactions(raw_ingredient_id)",
    "CREATE INDEX IF NOT EXISTS idx_reseller_order_items_sku_qty ON reseller_order_items(sku, quantity)",
    "CREATE INDEX IF NOT EXISTS idx_market_event_allocations_sku_qty ON market_event_allocations(sku, quantity)"
]

def migrate_sqlite():
    db_path = os.path.join("backend", "happy_noether.db")
    print(f"Connecting to SQLite database at {db_path}...")
    if not os.path.exists(db_path):
        print("Local SQLite database file not found. Skipping local indexes creation.")
        return
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        for stmt in INDEX_STATEMENTS:
            cursor.execute(stmt)
        conn.commit()
        print("Successfully created indexes in local SQLite database.")
    except Exception as e:
        print(f"SQLite migration error: {e}")
    finally:
        conn.close()

def migrate_supabase():
    pg_uri = os.getenv("DATABASE_URL")
    if not pg_uri:
        print("DATABASE_URL is not set in environment. Skipping Supabase migration.")
        return
        
    print("Connecting to Supabase PostgreSQL database...")
    try:
        import psycopg2
    except ImportError:
        print("psycopg2 is not installed. Installing it via pip first...")
        import subprocess
        subprocess.check_call(["pip", "install", "psycopg2-binary"])
        import psycopg2
        
    try:
        conn = psycopg2.connect(pg_uri)
        cursor = conn.cursor()
        try:
            for stmt in INDEX_STATEMENTS:
                cursor.execute(stmt)
            conn.commit()
            print("Successfully created indexes in Supabase PostgreSQL database.")
        except Exception as e:
            print(f"PostgreSQL migration error: {e}")
            conn.rollback()
        finally:
            cursor.close()
            conn.close()
    except Exception as e:
        print(f"Failed to connect to Supabase: {e}")

if __name__ == "__main__":
    migrate_sqlite()
    print("-" * 50)
    migrate_supabase()

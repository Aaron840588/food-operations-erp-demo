import os
import sqlite3
import psycopg2
from dotenv import load_dotenv

# Load dotenv configurations
load_dotenv()

def get_password_hash(password: str) -> str:
    """Simple bcrypt hashing for bootstrap migrations."""
    import bcrypt
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def migrate_sqlite():
    db_path = os.path.join("backend", "happy_noether.db")
    print(f"Connecting to SQLite database at {db_path}...")
    if not os.path.exists(db_path):
        print("Local SQLite database file not found. Skipping local migration.")
        return
        
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    try:
        # Create users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            hashed_password TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff',
            is_active INTEGER DEFAULT 1
        )
        """)
        
        # Create suppliers table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            contact_person TEXT,
            email TEXT,
            phone TEXT,
            address TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Add supplier_id to raw_ingredients
        try:
            cursor.execute("ALTER TABLE raw_ingredients ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL")
            print("Added supplier_id column to raw_ingredients on local SQLite.")
        except sqlite3.OperationalError:
            print("supplier_id column already exists or table alter skipped in SQLite.")
            
        # Create inventory_transactions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            sku TEXT REFERENCES product_skus(sku) ON DELETE CASCADE,
            raw_ingredient_id INTEGER REFERENCES raw_ingredients(id) ON DELETE CASCADE,
            transaction_type TEXT NOT NULL,
            qty REAL NOT NULL,
            batch_reference TEXT,
            notes TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create discount_tiers table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS discount_tiers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            min_subtotal REAL NOT NULL UNIQUE,
            discount_percentage REAL NOT NULL
        )
        """)
        
        # Seed users if empty
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            owner_pass = os.getenv("INITIAL_OWNER_PASSCODE")
            if not owner_pass:
                raise RuntimeError("INITIAL_OWNER_PASSCODE is required to seed users")
            hashed = get_password_hash(owner_pass)
            cursor.execute("INSERT INTO users (username, hashed_password, role, is_active) VALUES (?, ?, ?, ?)", ("owner", hashed, "owner", 1))
            cursor.execute("INSERT INTO users (username, hashed_password, role, is_active) VALUES (?, ?, ?, ?)", ("staff", hashed, "staff", 1))
            print("Successfully seeded SQLite default users.")
            
        # Seed discount_tiers if empty
        cursor.execute("SELECT COUNT(*) FROM discount_tiers")
        if cursor.fetchone()[0] == 0:
            tiers = [(0.0, 10.0), (1300.0, 12.0), (2000.0, 15.0), (3500.0, 18.0), (7000.0, 22.0)]
            for min_sub, pct in tiers:
                cursor.execute("INSERT INTO discount_tiers (min_subtotal, discount_percentage) VALUES (?, ?)", (min_sub, pct))
            print("Successfully seeded SQLite default discount tiers.")
            
        conn.commit()
        print("Successfully migrated local SQLite schema.")
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
    conn = psycopg2.connect(pg_uri)
    cursor = conn.cursor()
    try:
        # Create users table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) NOT NULL UNIQUE,
            hashed_password VARCHAR(255) NOT NULL,
            role VARCHAR(50) NOT NULL DEFAULT 'staff',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create suppliers table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS suppliers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            contact_person VARCHAR(255),
            email VARCHAR(255),
            phone VARCHAR(50),
            address TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Add supplier_id to raw_ingredients
        try:
            cursor.execute("ALTER TABLE raw_ingredients ADD COLUMN supplier_id INT REFERENCES suppliers(id) ON DELETE SET NULL")
            print("Added supplier_id column to raw_ingredients on Supabase.")
        except Exception as e:
            if "already exists" in str(e).lower():
                print("supplier_id column already exists on Supabase raw_ingredients table.")
            else:
                print(f"Error adding supplier_id: {e}")
            conn.rollback()
            
        # Create inventory_transactions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id SERIAL PRIMARY KEY,
            user_id INT REFERENCES users(id) ON DELETE SET NULL,
            sku VARCHAR(100) REFERENCES product_skus(sku) ON DELETE CASCADE,
            raw_ingredient_id INT REFERENCES raw_ingredients(id) ON DELETE CASCADE,
            transaction_type VARCHAR(50) NOT NULL,
            qty NUMERIC(10, 2) NOT NULL,
            batch_reference VARCHAR(100),
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Create discount_tiers table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS discount_tiers (
            id SERIAL PRIMARY KEY,
            min_subtotal NUMERIC(10, 2) NOT NULL UNIQUE,
            discount_percentage NUMERIC(5, 2) NOT NULL
        )
        """)
        
        # Seed users if empty
        cursor.execute("SELECT COUNT(*) FROM users")
        if cursor.fetchone()[0] == 0:
            owner_pass = os.getenv("INITIAL_OWNER_PASSCODE")
            if not owner_pass:
                raise RuntimeError("INITIAL_OWNER_PASSCODE is required to seed users")
            hashed = get_password_hash(owner_pass)
            cursor.execute("INSERT INTO users (username, hashed_password, role, is_active) VALUES (%s, %s, %s, %s)", ("owner", hashed, "owner", True))
            cursor.execute("INSERT INTO users (username, hashed_password, role, is_active) VALUES (%s, %s, %s, %s)", ("staff", hashed, "staff", True))
            print("Successfully seeded Supabase default users.")
            
        # Seed discount_tiers if empty
        cursor.execute("SELECT COUNT(*) FROM discount_tiers")
        if cursor.fetchone()[0] == 0:
            tiers = [(0.0, 10.0), (1300.0, 12.0), (2000.0, 15.0), (3500.0, 18.0), (7000.0, 22.0)]
            for min_sub, pct in tiers:
                cursor.execute("INSERT INTO discount_tiers (min_subtotal, discount_percentage) VALUES (%s, %s)", (min_sub, pct))
            print("Successfully seeded Supabase default discount tiers.")
            
        conn.commit()
        print("Successfully migrated Supabase PostgreSQL schema.")
    except Exception as e:
        print(f"Supabase migration error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()

if __name__ == "__main__":
    migrate_sqlite()
    print("-" * 50)
    migrate_supabase()

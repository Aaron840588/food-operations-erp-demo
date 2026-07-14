import os
import random
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from sqlalchemy import func
from .. import models, auth

def seed_demo_baseline(db: Session):
    """
    Seeds baseline master data: Warehouses, Users (demo-owner, demo-staff),
    Suppliers, Raw Ingredients, Product SKUs, Recipes, and Discount Tiers.
    """
    print("Seeding baseline demo data...")

    # 1. Warehouses
    if db.query(models.Warehouse).count() == 0:
        warehouses = [
            models.Warehouse(id=1, name="Main Facility", location="123 Production Blvd", is_active=True),
            models.Warehouse(id=2, name="East Hub Storage", location="456 Distribution Rd", is_active=True),
        ]
        db.add_all(warehouses)
        db.commit()

    # 2. Users
    if db.query(models.User).count() == 0:
        owner_username = os.getenv("DEMO_OWNER_USERNAME", "demo-owner")
        owner_password = os.getenv("DEMO_OWNER_PASSWORD", "owner123")
        staff_username = os.getenv("DEMO_STAFF_USERNAME", "demo-staff")
        staff_password = os.getenv("DEMO_STAFF_PASSWORD", "staff123")
        
        hashed_owner = auth.get_password_hash(owner_password)
        hashed_staff = auth.get_password_hash(staff_password)

        users = [
            models.User(username="owner", hashed_password=hashed_owner, role="owner", is_active=True),
            models.User(username="staff", hashed_password=hashed_staff, role="staff", is_active=True),
            models.User(username=owner_username, hashed_password=hashed_owner, role="owner", is_active=True),
            models.User(username=staff_username, hashed_password=hashed_staff, role="staff", is_active=True),
        ]
        db.add_all(users)
        db.commit()

    # 3. Suppliers (fully fictional)
    if db.query(models.Supplier).count() == 0:
        suppliers = [
            models.Supplier(id=1, name="Sample Supplier Co.", contact_person="John Doe", email="john@samplesupplier.demo", phone="555-0199", address="100 Supply Ave"),
            models.Supplier(id=2, name="Golden Grain Milling", contact_person="Jane Smith", email="jane@goldengrain.demo", phone="555-0244", address="200 Flour Mill Rd"),
            models.Supplier(id=3, name="Green Leaf Farms", contact_person="Bob Green", email="bob@greenfarms.demo", phone="555-0322", address="300 Organic Way"),
        ]
        db.add_all(suppliers)
        db.commit()

    # 4. Raw Ingredients (fully fictional prices & specifications)
    if db.query(models.RawIngredient).count() == 0:
        ingredients = [
            models.RawIngredient(id=1, name="Organic Sugar", category="Sweetener", unit="grams", price=80.00, net_weight=1000.0, available_stock=100000.0, reorder_level=10000.0, shop="Local Wholesale", brand="SweetLife", supplier_id=1),
            models.RawIngredient(id=2, name="Pili Nuts (Demo)", category="Nuts", unit="grams", price=350.00, net_weight=500.0, available_stock=50000.0, reorder_level=5000.0, shop="Local Wholesale", brand="GoldNut", supplier_id=1),
            models.RawIngredient(id=3, name="Fresh Basil (Demo)", category="Produce", unit="grams", price=120.00, net_weight=250.0, available_stock=20000.0, reorder_level=2000.0, shop="Green Leaf Farms", brand="FreshPick", supplier_id=3),
            models.RawIngredient(id=4, name="Fresh Garlic (Demo)", category="Produce", unit="grams", price=90.00, net_weight=500.0, available_stock=30000.0, reorder_level=3000.0, shop="Green Leaf Farms", brand="FreshPick", supplier_id=3),
            models.RawIngredient(id=5, name="Olive Oil (Demo)", category="Oils", unit="grams", price=450.00, net_weight=1000.0, available_stock=40000.0, reorder_level=5000.0, shop="Local Wholesale", brand="MedGlow", supplier_id=2),
            models.RawIngredient(id=6, name="Coconut Oil (Demo)", category="Oils", unit="grams", price=180.00, net_weight=1000.0, available_stock=60000.0, reorder_level=8000.0, shop="Local Wholesale", brand="CocoPure", supplier_id=2),
            models.RawIngredient(id=7, name="Chicken Liver (Demo)", category="Meat", unit="grams", price=200.00, net_weight=1000.0, available_stock=15000.0, reorder_level=2000.0, shop="Sample Meat Shop", brand="FarmFresh", supplier_id=1),
            models.RawIngredient(id=8, name="Soy Sauce (Demo)", category="Condiments", unit="grams", price=60.00, net_weight=1000.0, available_stock=30000.0, reorder_level=3000.0, shop="Local Wholesale", brand="SoyBest", supplier_id=1),
            models.RawIngredient(id=9, name="White Vinegar (Demo)", category="Condiments", unit="grams", price=50.00, net_weight=1000.0, available_stock=35000.0, reorder_level=3000.0, shop="Local Wholesale", brand="VineChef", supplier_id=1),
            models.RawIngredient(id=10, name="Egg Yolks", category="Dairy & Eggs", unit="grams", price=150.00, net_weight=500.0, available_stock=25000.0, reorder_level=2500.0, shop="Green Leaf Farms", brand="EggExcel", supplier_id=3),
            models.RawIngredient(id=11, name="Creamy Milk (Demo)", category="Dairy & Eggs", unit="grams", price=95.00, net_weight=1000.0, available_stock=40000.0, reorder_level=4000.0, shop="Local Wholesale", brand="MilkyWay", supplier_id=2),
            models.RawIngredient(id=12, name="Unsalted Butter (Demo)", category="Dairy & Eggs", unit="grams", price=210.00, net_weight=500.0, available_stock=18000.0, reorder_level=2000.0, shop="Local Wholesale", brand="ButterFine", supplier_id=2),
            models.RawIngredient(id=13, name="All-Purpose Flour", category="Grains", unit="grams", price=45.00, net_weight=1000.0, available_stock=80000.0, reorder_level=8000.0, shop="Golden Grain Milling", brand="MillersGold", supplier_id=2),
        ]
        # Calculate cost_per_gram_unit for all ingredients
        for ing in ingredients:
            ing.cost_per_gram_unit = float(ing.price) / float(ing.net_weight)
        db.add_all(ingredients)
        db.commit()

    # 5. Product SKUs (Spreads & Sauces, Sandwiches & Salads active categories)
    if db.query(models.ProductSKU).count() == 0:
        products = [
            models.ProductSKU(sku="YP-IND-SWT", product_name="Golden Yema Spread", category="Spreads & Sauces", size="Indulge", retail_price=180.00, reseller_price=150.00, pack_qty=1, storage_life="6 Months", serving_requirement="Refrigerate after opening", labor_cost=20.0, utility_cost=3.0, warehouse_stock=150, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="PP-IND-SVR", product_name="Pili Pesto Sauce", category="Spreads & Sauces", size="Indulge", retail_price=220.00, reseller_price=180.00, pack_qty=1, storage_life="3 Months", serving_requirement="Keep chilled", labor_cost=25.0, utility_cost=4.0, warehouse_stock=120, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="CGO-IND-SVR", product_name="Spiced Garlic Chili Oil", category="Spreads & Sauces", size="Indulge", retail_price=150.00, reseller_price=120.00, pack_qty=1, storage_life="12 Months", serving_requirement="Store in cool dry place", labor_cost=15.0, utility_cost=2.0, warehouse_stock=200, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="CLS-IND-SVR", product_name="Savory Chicken Liver Spread", category="Spreads & Sauces", size="Indulge", retail_price=170.00, reseller_price=140.00, pack_qty=1, storage_life="1 Month", serving_requirement="Keep frozen until use", labor_cost=18.0, utility_cost=3.0, warehouse_stock=80, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="GCP-SL-SW-SVR", product_name="Grilled Pesto & Cheese Sandwich", category="Sandwiches & Salads", size="Solo", retail_price=110.00, reseller_price=90.00, pack_qty=1, storage_life="1 Day", serving_requirement="Serve warm", labor_cost=15.0, utility_cost=2.0, warehouse_stock=40, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="SSS-SL-SW-SVR", product_name="Spicy Smoked Salmon Sandwich", category="Sandwiches & Salads", size="Solo", retail_price=150.00, reseller_price=120.00, pack_qty=1, storage_life="1 Day", serving_requirement="Keep chilled", labor_cost=20.0, utility_cost=2.5, warehouse_stock=30, density_multiplier=1.0, is_active=True),
            models.ProductSKU(sku="TSLD-SL-SW-SVR", product_name="Tuna Salad Garden Sandwich", category="Sandwiches & Salads", size="Solo", retail_price=130.00, reseller_price=105.00, pack_qty=1, storage_life="1 Day", serving_requirement="Keep chilled", labor_cost=18.0, utility_cost=2.2, warehouse_stock=50, density_multiplier=1.0, is_active=True),
        ]
        db.add_all(products)
        db.commit()

    # 6. Recipes & Recipe Items
    if db.query(models.Recipe).count() == 0:
        # Recipes mapping
        # Let's read product IDs and raw ingredient IDs
        yp_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "YP-IND-SWT").first()
        pp_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "PP-IND-SVR").first()
        cgo_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "CGO-IND-SVR").first()
        cls_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "CLS-IND-SVR").first()
        gcp_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "GCP-SL-SW-SVR").first()
        sss_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "SSS-SL-SW-SVR").first()
        tsld_prod = db.query(models.ProductSKU).filter(models.ProductSKU.sku == "TSLD-SL-SW-SVR").first()

        ingredients_dict = {ing.name: ing.id for ing in db.query(models.RawIngredient).all()}

        recipes = [
            # Golden Yema Spread
            models.Recipe(sku="YP-IND-SWT", yield_weight=1000.0, portion_size=200.0, notes="Yields 5 jars"),
            # Pili Pesto Sauce
            models.Recipe(sku="PP-IND-SVR", yield_weight=1000.0, portion_size=200.0, notes="Yields 5 jars"),
            # Spiced Garlic Chili Oil
            models.Recipe(sku="CGO-IND-SVR", yield_weight=1000.0, portion_size=200.0, notes="Yields 5 jars"),
            # Savory Chicken Liver Spread
            models.Recipe(sku="CLS-IND-SVR", yield_weight=1000.0, portion_size=200.0, notes="Yields 5 jars"),
            # Grilled Pesto & Cheese Sandwich
            models.Recipe(sku="GCP-SL-SW-SVR", yield_weight=250.0, portion_size=250.0, notes="Single portion sandwich"),
        ]
        db.add_all(recipes)
        db.commit()

        # Recipe Items
        yp_recipe = db.query(models.Recipe).filter(models.Recipe.sku == "YP-IND-SWT").first()
        pp_recipe = db.query(models.Recipe).filter(models.Recipe.sku == "PP-IND-SVR").first()
        cgo_recipe = db.query(models.Recipe).filter(models.Recipe.sku == "CGO-IND-SVR").first()
        cls_recipe = db.query(models.Recipe).filter(models.Recipe.sku == "CLS-IND-SVR").first()
        gcp_recipe = db.query(models.Recipe).filter(models.Recipe.sku == "GCP-SL-SW-SVR").first()

        recipe_items = [
            # Golden Yema
            models.RecipeItem(recipe_id=yp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Egg Yolks"], base_qty=300.0, base_unit="grams"),
            models.RecipeItem(recipe_id=yp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Creamy Milk (Demo)"], base_qty=500.0, base_unit="grams"),
            models.RecipeItem(recipe_id=yp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Organic Sugar"], base_qty=200.0, base_unit="grams"),

            # Pili Pesto
            models.RecipeItem(recipe_id=pp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Fresh Basil (Demo)"], base_qty=500.0, base_unit="grams"),
            models.RecipeItem(recipe_id=pp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Pili Nuts (Demo)"], base_qty=150.0, base_unit="grams"),
            models.RecipeItem(recipe_id=pp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Fresh Garlic (Demo)"], base_qty=50.0, base_unit="grams"),
            models.RecipeItem(recipe_id=pp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Olive Oil (Demo)"], base_qty=300.0, base_unit="grams"),

            # Chili Garlic Oil
            models.RecipeItem(recipe_id=cgo_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Fresh Garlic (Demo)"], base_qty=200.0, base_unit="grams"),
            models.RecipeItem(recipe_id=cgo_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Coconut Oil (Demo)"], base_qty=800.0, base_unit="grams"),

            # Chicken Liver Spread
            models.RecipeItem(recipe_id=cls_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Chicken Liver (Demo)"], base_qty=700.0, base_unit="grams"),
            models.RecipeItem(recipe_id=cls_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Soy Sauce (Demo)"], base_qty=100.0, base_unit="grams"),
            models.RecipeItem(recipe_id=cls_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["White Vinegar (Demo)"], base_qty=100.0, base_unit="grams"),
            models.RecipeItem(recipe_id=cls_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Unsalted Butter (Demo)"], base_qty=100.0, base_unit="grams"),

            # Grilled Cheese & Pesto Sandwich (uses PP-IND-SVR spread recursively!)
            models.RecipeItem(recipe_id=gcp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["All-Purpose Flour"], base_qty=120.0, base_unit="grams"),
            models.RecipeItem(recipe_id=gcp_recipe.id, ingredient_type="raw", raw_ingredient_id=ingredients_dict["Unsalted Butter (Demo)"], base_qty=30.0, base_unit="grams"),
            models.RecipeItem(recipe_id=gcp_recipe.id, ingredient_type="sku", sub_sku="PP-IND-SVR", base_qty=30.0, base_unit="grams"), # 30g pesto spread
        ]
        db.add_all(recipe_items)
        db.commit()

    # 7. Discount Tiers
    if db.query(models.DiscountTier).count() == 0:
        discount_tiers = [
            models.DiscountTier(min_subtotal=0.0, discount_percentage=10.0),
            models.DiscountTier(min_subtotal=1300.0, discount_percentage=12.0),
            models.DiscountTier(min_subtotal=2000.0, discount_percentage=15.0),
            models.DiscountTier(min_subtotal=3500.0, discount_percentage=18.0),
            models.DiscountTier(min_subtotal=7000.0, discount_percentage=22.0),
        ]
        db.add_all(discount_tiers)
        db.commit()

    # 8. Category Overhead Rates
    if db.query(models.CategoryOverheadRate).count() == 0:
        rates = [
            models.CategoryOverheadRate(category="Spreads & Sauces", labor_cost_per_unit=15.0, utility_cost_per_unit=2.5),
            models.CategoryOverheadRate(category="Sandwiches & Salads", labor_cost_per_unit=18.0, utility_cost_per_unit=3.0),
        ]
        db.add_all(rates)
        db.commit()

    # 9. Default Tasks and Assets
    if db.query(models.CleaningTask).count() == 0:
        tasks = [
            models.CleaningTask(task_name="Sanitize Main Mixing Station", frequency="Daily", remarks="Focus on surface touchpoints"),
            models.CleaningTask(task_name="Calibrate Packaging Scale", frequency="Daily", remarks="Ensure precise gram measures"),
            models.CleaningTask(task_name="Deep Clean Exhaust Hoods", frequency="Weekly", remarks="Periodic sanitation check"),
        ]
        db.add_all(tasks)
        db.commit()

    if db.query(models.MaintenanceAsset).count() == 0:
        assets = [
            models.MaintenanceAsset(area="Production Kitchen", item_name="Double-Door Upright Chiller", style_or_kind="Industrial Refrigerator", condition="OK", remarks="Maintained at 4C constant temperature"),
            models.MaintenanceAsset(area="Packaging Station", item_name="Commercial Glass Jar Sealer", style_or_kind="Induction Sealer", condition="OK", remarks="Gaskets and heating element checked"),
        ]
        db.add_all(assets)
        db.commit()

    db.commit()
    print("Baseline master data seeded.")


def seed_demo_transactions(db: Session):
    """
    Clears only dynamic testing/transaction entries, then seeds completely synthetic,
    rich historical transactions (orders, consignment deliveries, market events, sales logs, production plans,
    FIFO batches, audit logs) to provide charts and dashboards with beautiful visual completeness.
    """
    print("Seeding dynamic transaction history...")

    # Restore/Verify demo accounts are intact during reset
    owner_username = os.getenv("DEMO_OWNER_USERNAME", "demo-owner")
    owner_password = os.getenv("DEMO_OWNER_PASSWORD", "owner123")
    staff_username = os.getenv("DEMO_STAFF_USERNAME", "demo-staff")
    staff_password = os.getenv("DEMO_STAFF_PASSWORD", "staff123")

    # Clear and recreate default credentials safely
    db.query(models.User).filter(models.User.username.in_([owner_username, staff_username, "owner", "staff"])).delete(synchronize_session=False)
    db.commit()

    hashed_owner = auth.get_password_hash(owner_password)
    hashed_staff = auth.get_password_hash(staff_password)

    users = [
        models.User(username="owner", hashed_password=hashed_owner, role="owner", is_active=True),
        models.User(username="staff", hashed_password=hashed_staff, role="staff", is_active=True),
        models.User(username=owner_username, hashed_password=hashed_owner, role="owner", is_active=True),
        models.User(username=staff_username, hashed_password=hashed_staff, role="staff", is_active=True),
    ]
    db.add_all(users)
    db.commit()

    # A. Clean dynamic dynamic tables
    db.query(models.MarketEventSaleItem).delete()
    db.query(models.MarketEventSale).delete()
    db.query(models.MarketEventAllocation).delete()
    db.query(models.MarketEvent).delete()

    db.query(models.ResellerOrderItem).delete()
    db.query(models.ResellerOrder).delete()

    db.query(models.ConsignmentItem).delete()
    db.query(models.ConsignmentDelivery).delete()
    db.query(models.ConsignmentPartner).delete()

    db.query(models.ProductionBatch).delete()
    db.query(models.ProductionTarget).delete()
    db.query(models.ProductionPlan).delete()

    db.query(models.InventoryTransaction).delete()
    db.query(models.IngredientBatch).delete()
    db.query(models.WarehouseStock).delete()
    
    db.commit()

    # Establish dates
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)
    
    # 1. Ingredient FIFO Batches (Future & Past)
    ingredients = db.query(models.RawIngredient).all()
    for ing in ingredients:
        # Create 2 batches for each ingredient: one expiring in 3 months, one expiring in 6 months
        batch1 = models.IngredientBatch(
            raw_ingredient_id=ing.id,
            batch_code=f"BCH-{ing.id}-01",
            quantity=float(ing.available_stock) * 0.4,
            expiry_date=(today + timedelta(days=90)).strftime("%Y-%m-%d")
        )
        batch2 = models.IngredientBatch(
            raw_ingredient_id=ing.id,
            batch_code=f"BCH-{ing.id}-02",
            quantity=float(ing.available_stock) * 0.6,
            expiry_date=(today + timedelta(days=180)).strftime("%Y-%m-%d")
        )
        db.add_all([batch1, batch2])
    db.commit()

    # 2. Consignment Partners (Fictional)
    partners = [
        models.ConsignmentPartner(id=1, name="Golden Spoon Pantry", discount_rate=0.15, collection_frequency="Weekly", minimum_order_amount=2000.0, is_active=True),
        models.ConsignmentPartner(id=2, name="Demo Retail Partner A", discount_rate=0.10, collection_frequency="Bi-weekly", minimum_order_amount=1500.0, is_active=True),
        models.ConsignmentPartner(id=3, name="Cozy Cafe Corner", discount_rate=0.12, collection_frequency="Weekly", minimum_order_amount=1000.0, is_active=True),
    ]
    db.add_all(partners)
    db.commit()

    # 3. Consignment Deliveries (Historical completed & unpaid)
    products = db.query(models.ProductSKU).all()
    p_dict = {p.sku: p for p in products}

    # Delivery 1: completed & paid (2 weeks ago)
    del1 = models.ConsignmentDelivery(
        partner_id=1,
        delivery_date=(today - timedelta(days=14)).strftime("%Y-%m-%d"),
        dr_number="DR-GSP-2026-001",
        is_paid=True,
        payment_date=(today - timedelta(days=7)).strftime("%Y-%m-%d")
    )
    db.add(del1)
    db.flush()

    # Items for Delivery 1
    item1_1 = models.ConsignmentItem(
        delivery_id=del1.id,
        sku="YP-IND-SWT",
        qty_delivered=20,
        units_sold=18,
        qty_pulled_out=2,
        reseller_price_snapshot=150.00,
        cost_per_unit_snapshot=85.00,
        store_price_snapshot=180.00,
        notes="2 jars pulled out due to sealing review"
    )
    item1_2 = models.ConsignmentItem(
        delivery_id=del1.id,
        sku="PP-IND-SVR",
        qty_delivered=15,
        units_sold=15,
        qty_pulled_out=0,
        reseller_price_snapshot=180.00,
        cost_per_unit_snapshot=110.00,
        store_price_snapshot=220.00
    )
    db.add_all([item1_1, item1_2])

    # Delivery 2: outstanding/unpaid (5 days ago)
    del2 = models.ConsignmentDelivery(
        partner_id=2,
        delivery_date=(today - timedelta(days=5)).strftime("%Y-%m-%d"),
        dr_number="DR-DRP-2026-004",
        is_paid=False
    )
    db.add(del2)
    db.flush()

    item2_1 = models.ConsignmentItem(
        delivery_id=del2.id,
        sku="CGO-IND-SVR",
        qty_delivered=30,
        units_sold=12, # partially sold
        qty_pulled_out=0,
        reseller_price_snapshot=120.00,
        cost_per_unit_snapshot=65.00,
        store_price_snapshot=150.00
    )
    item2_2 = models.ConsignmentItem(
        delivery_id=del2.id,
        sku="YP-IND-SWT",
        qty_delivered=10,
        units_sold=5,
        qty_pulled_out=0,
        reseller_price_snapshot=150.00,
        cost_per_unit_snapshot=85.00,
        store_price_snapshot=180.00
    )
    db.add_all([item2_1, item2_2])
    db.commit()

    # 4. Wholesale Reseller Orders (Historical)
    order1 = models.ResellerOrder(
        reseller_name="Delta Gourmet Collective",
        order_date=(today - timedelta(days=10)).strftime("%Y-%m-%d"),
        subtotal=4500.0,
        discount_percentage=18.0,
        discount_amount=810.0,
        tax_rate=12.0,
        tax_amount=442.80,
        grand_total=4132.80,
        is_paid=True,
        notes="Standard bulk delivery. Fully settled."
    )
    db.add(order1)
    db.flush()

    o1_item1 = models.ResellerOrderItem(order_id=order1.id, sku="YP-IND-SWT", quantity=15, price_snapshot=150.00)
    o1_item2 = models.ResellerOrderItem(order_id=order1.id, sku="PP-IND-SVR", quantity=125, price_snapshot=180.00) # (15*150) + (12.5*180) => 2250 + 2250 = 4500
    db.add_all([o1_item1, o1_item2])

    order2 = models.ResellerOrder(
        reseller_name="Pantry Express Retail",
        order_date=(today - timedelta(days=2)).strftime("%Y-%m-%d"),
        subtotal=1200.00,
        discount_percentage=10.0,
        discount_amount=120.0,
        tax_rate=12.0,
        tax_amount=129.60,
        grand_total=1209.60,
        is_paid=False,
        notes="Pending bank transfer settlement."
    )
    db.add(order2)
    db.flush()
    o2_item = models.ResellerOrderItem(order_id=order2.id, sku="CGO-IND-SVR", quantity=10, price_snapshot=120.00)
    db.add(o2_item)
    db.commit()

    # 5. Production Plans
    plan1 = models.ProductionPlan(
        plan_date=(today - timedelta(days=3)).strftime("%Y-%m-%d"),
        status="completed"
    )
    db.add(plan1)
    db.flush()

    target1_1 = models.ProductionTarget(plan_id=plan1.id, sku="YP-IND-SWT", outlet="Main Warehouse", target_qty=50)
    target1_2 = models.ProductionTarget(plan_id=plan1.id, sku="PP-IND-SVR", outlet="Main Warehouse", target_qty=30)
    db.add_all([target1_1, target1_2])

    batch1_1 = models.ProductionBatch(batch_date=(today - timedelta(days=3)).strftime("%Y-%m-%d"), sku="YP-IND-SWT", qty_produced=50, qty_delivered=50, actual_yield=100.0)
    batch1_2 = models.ProductionBatch(batch_date=(today - timedelta(days=3)).strftime("%Y-%m-%d"), sku="PP-IND-SVR", qty_produced=30, qty_delivered=30, actual_yield=100.0)
    db.add_all([batch1_1, batch1_2])

    # Dynamic Draft Plan for tomorrow
    plan2 = models.ProductionPlan(
        plan_date=(today + timedelta(days=1)).strftime("%Y-%m-%d"),
        status="draft"
    )
    db.add(plan2)
    db.flush()
    target2_1 = models.ProductionTarget(plan_id=plan2.id, sku="CGO-IND-SVR", outlet="East Hub Storage", target_qty=40)
    db.add(target2_1)
    db.commit()

    # 6. Market Events POS & Cashier sales
    # Event 1: Completed event (Last Weekend)
    event1 = models.MarketEvent(
        name="Demo Weekend Collective",
        event_date=(today - timedelta(days=3)).strftime("%Y-%m-%d"),
        location="BGC Activity Center, Metro Manila",
        staff_assigned="demo-staff",
        status="Completed",
        is_deleted=False,
        initial_cash_balance=5000.0,
        actual_closing_cash=13640.0,
        cash_adjustments=0.0,
        cash_adjustments_notes="",
        total_expenses=800.0,
        expense_notes="Booth entrance cleaning permit"
    )
    db.add(event1)
    db.flush()

    # Allocations for Event 1
    alloc1_1 = models.MarketEventAllocation(event_id=event1.id, sku="YP-IND-SWT", quantity=40, wasted_quantity=1, waste_reason="Jar cracked during transit")
    alloc1_2 = models.MarketEventAllocation(event_id=event1.id, sku="PP-IND-SVR", quantity=30, wasted_quantity=0)
    db.add_all([alloc1_1, alloc1_2])

    # Sales for Event 1 (Cashier POS orders)
    # Sale 1: Cash sale
    sale1 = models.MarketEventSale(
        event_id=event1.id,
        cashier_id=2, # owner/staff ID
        payment_method="Cash",
        total_amount=540.0,
        timestamp=datetime.now(timezone.utc) - timedelta(days=3, hours=4),
        is_preorder=False
    )
    db.add(sale1)
    db.flush()
    sale1_item1 = models.MarketEventSaleItem(sale_id=sale1.id, sku="YP-IND-SWT", quantity=3, price_snapshot=180.00) # 3 * 180 = 540
    db.add(sale1_item1)

    # Sale 2: GCash mobile wallet sale
    sale2 = models.MarketEventSale(
        event_id=event1.id,
        cashier_id=2,
        payment_method="GCash",
        total_amount=1100.0,
        timestamp=datetime.now(timezone.utc) - timedelta(days=3, hours=2),
        is_preorder=False
    )
    db.add(sale2)
    db.flush()
    sale2_item1 = models.MarketEventSaleItem(sale_id=sale2.id, sku="PP-IND-SVR", quantity=5, price_snapshot=220.00) # 5 * 220 = 1100
    db.add(sale2_item1)
    db.commit()

    # Event 2: Active event (Today)
    event2 = models.MarketEvent(
        name="Sample Pop-up Bazaar",
        event_date=today.strftime("%Y-%m-%d"),
        location="Salcedo Weekend Market, Makati",
        staff_assigned="demo-staff",
        status="Active",
        is_deleted=False,
        initial_cash_balance=3000.0,
        cash_adjustments=0.0,
        cash_adjustments_notes="",
        total_expenses=0.0
    )
    db.add(event2)
    db.flush()

    alloc2_1 = models.MarketEventAllocation(event_id=event2.id, sku="YP-IND-SWT", quantity=25, wasted_quantity=0)
    alloc2_2 = models.MarketEventAllocation(event_id=event2.id, sku="CGO-IND-SVR", quantity=20, wasted_quantity=0)
    db.add_all([alloc2_1, alloc2_2])

    sale3 = models.MarketEventSale(
        event_id=event2.id,
        cashier_id=4, # demo-staff ID
        payment_method="Cash",
        total_amount=360.0,
        timestamp=datetime.now(timezone.utc) - timedelta(hours=1),
        is_preorder=False
    )
    db.add(sale3)
    db.flush()
    sale3_item1 = models.MarketEventSaleItem(sale_id=sale3.id, sku="YP-IND-SWT", quantity=2, price_snapshot=180.00)
    db.add(sale3_item1)
    db.commit()

    # 7. Inventory Transaction Ledger History
    transactions = [
        # Stock additions
        models.InventoryTransaction(sku="YP-IND-SWT", transaction_type="production_add", qty=50.0, notes="Production Batch #YEMA-098", warehouse_id=1),
        models.InventoryTransaction(sku="PP-IND-SVR", transaction_type="production_add", qty=30.0, notes="Production Batch #PESTO-045", warehouse_id=1),
        # Wholesale consumptions
        models.InventoryTransaction(sku="YP-IND-SWT", transaction_type="consume", qty=-15.0, notes="Reseller Order #GOURMET-01", warehouse_id=1),
        models.InventoryTransaction(sku="PP-IND-SVR", transaction_type="consume", qty=-12.5, notes="Reseller Order #GOURMET-01", warehouse_id=1),
        # Consignment deliveries & sales
        models.InventoryTransaction(sku="YP-IND-SWT", transaction_type="consignment_deduct", qty=-20.0, notes="Consignment Dispatch DR-GSP-2026-001", warehouse_id=1),
        models.InventoryTransaction(sku="YP-IND-SWT", transaction_type="waste", qty=-2.0, notes="Consignment Pull-out Waste DR-GSP-2026-001", warehouse_id=1),
    ]
    db.add_all(transactions)
    db.commit()

    # 8. Synced warehouse stocks table for physical counts
    # Make sure Main Facility (ID: 1) has warehouse_stocks for all raw ingredients and product SKUs
    for prod in products:
        ws = models.WarehouseStock(
            warehouse_id=1,
            sku=prod.sku,
            quantity=float(prod.warehouse_stock or 0)
        )
        db.add(ws)

    for ing in ingredients:
        ws = models.WarehouseStock(
            warehouse_id=1,
            raw_ingredient_id=ing.id,
            quantity=float(ing.available_stock or 0.0)
        )
        db.add(ws)

    db.commit()
    print("Fictional transaction history and allocations successfully seeded!")

if __name__ == "__main__":
    import sys
    from dotenv import load_dotenv
    # Load environment variables
    base_dir = os.path.dirname(os.path.abspath(__file__))
    # base_dir is backend/app/services, grandparent is backend
    dotenv_path = os.path.join(os.path.dirname(os.path.dirname(base_dir)), ".env")
    load_dotenv(dotenv_path)

    from ..database import SessionLocal, Base, engine
    
    # Run the seeder
    db = SessionLocal()
    try:
        # Recreate tables safely if SQLite local file
        if "sqlite" in engine.name:
            Base.metadata.create_all(bind=engine)
        seed_demo_baseline(db)
        seed_demo_transactions(db)
        print("Demo database seeding complete!")
    except Exception as e:
        print(f"Error seeding demo database: {e}")
        sys.exit(1)
    finally:
        db.close()

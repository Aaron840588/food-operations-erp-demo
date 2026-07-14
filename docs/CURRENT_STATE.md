# H+H Food System: Current State & Releases

This file details the active state of code features, database schemas, and configuration for H+H Hub.

---

## 🛠️ Deployed Milestones
All major milestones have been fully implemented, verified, and integrated into the public demo:

1. **Authentication**: Bcrypt password hashing & secure dual-token JWT sessions.
2. **Products & SKUs**: Product catalog with granular SKU overheads and size mappings.
3. **Ingredients**: Supplier relationship mappings and batch FIFO inventory tracking.
4. **Recipes & Costing**: DFS-based costing engine with circular loop protection.
5. **Inventory Audit**: Complete ledger mapping every manual and automatic stock adjustment.
6. **Production Planner**: Bill of Material explosion and deficit checking.
7. **Wholesale POS**: Real-time sales calculations, manual discounts, and invoice generation.
8. **Consignment Channels**: Partner stores shipments and write-offs tracking.
9. **Pop-Up Retail POS**: Tablet-optimized bazaar POS, offline sales cache, and SWR sync.
10. **Reports & Dashboards**: Analytical graphs highlighting category margins and channels.
11. **Multi-Location Warehouse**: Physical warehouse allocations and transfers tracking.
12. **Push Notifications**: Device-level push notifications utilizing VAPID protocols.

---

## 📊 Database Table Inventory
The database contains **31 active tables**:
1. `users` (Owner & Staff roles)
2. `suppliers` (Supplier details)
3. `raw_ingredients` (Ingredient warehouse catalog)
4. `product_skus` (Finished items catalog with product-specific labor/utility costs)
5. `recipes` (Recipe batch formulas)
6. `recipe_items` (Recipe ingredients)
7. `discount_tiers` (Reseller discount configurations)
8. `reseller_orders` (Reseller orders log)
9. `reseller_order_items` (Reseller items)
10. `consignment_partners` (Store partner details)
11. `consignment_deliveries` (Shipment sheets)
12. `consignment_items` (Delivery detail logs)
13. `inventory_transactions` (Movement ledger)
14. `maintenance_assets` (Maintenance schedules)
15. `cleaning_tasks` (Sanitation checklists)
16. `warehouses` (Physical storage locations)
17. `warehouse_stocks` (Distributed quantity mappings)
18. `push_subscriptions` (PWA device push credentials)
19. `market_events` (Pop-Up Markets scheduling)
20. `market_event_allocations` (Reserved market stock levels)
21. `market_event_sales` (POS cashier orders log)
22. `market_event_sale_items` (POS cashier items sold)
23. `ingredient_batches` (FIFO inventory batches and expiry dates)
24. `refresh_tokens` (Rotating authenticated sessions)
25. `category_overhead_rates` (Category costing defaults)
26. `overhead_configs` (Global overhead configuration)
27. `production_batches` (Recorded production runs)
28. `production_plans` (Daily production plans)
29. `production_targets` (SKU production targets)
30. `gift_sets` (Bundle definitions)
31. `gift_set_items` (Bundle components)

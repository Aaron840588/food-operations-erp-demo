# H+H Food System: Project Context Handbook

This handbook provides the high-level background, business constraints, and operational context of the H+H Food System application.

---

## 🥪 Business Background
**H+H** is a premium spreads and food products manufacturer operating out of a single kitchen facility. The business manufactures finished SKUs (e.g. Yellow Pesto Sandwiches, jarred spreads, special gourmet products) using raw ingredients (basil, nuts, oils, packaging jars, labels) purchased from suppliers.

### Core Sales Channels
H+H distributes products through two primary sales channels:
1. **B2B Consignment Partners**: H+H delivers finished goods directly to retail stores. Stores sell items to end customers. H+H audits store sales weekly, collecting payments for units sold, writing off expired items (pull-outs), and computing sell-through efficiency.
2. **B2B Reseller Network**: H+H sells finished goods directly to independent distributors at wholesale prices. Discounts are dynamically computed based on order volume using tiered discount configurations.

---

## 🎯 Application Objectives
The H+H Food System is a custom ERP web application built to automate internal operations, accounting, and supply chain tracking.

* **Recipe Costing & Pricing**: Break down the exact food and packaging costs of finished goods, incorporating labor and allocated kitchen overhead rates.
* **Production Planning**: Explode target product quantities into raw ingredient requirements, compile buying checklists, and block production if warehouse ingredients are insufficient.
* **B2B Consignment Tracking**: Log store shipments, track unpaid dispatches, calculate waste rates, and log write-offs.
* **Reseller Billing Invoices**: Compute tiered wholesale discounts, calculate Value Added Tax (VAT), record payments, and print formatted invoices.
* **Facility Checklists**: Track daily kitchen facility cleaning lists and asset maintenance assets checking logs.
* **Inventory Ledger**: Audit stock adjustments made by kitchen staff.

---

## 🔑 Operational Credentials
H+H operates under a strict role-based access model with two pre-configured profiles:

1. **Owner Profile**:
   * **Username**: `owner`
   * **Passcode**: Configured securely through `INITIAL_OWNER_PASSCODE`; never stored in documentation.
   * **Privileges**: Administrative configuration control (Discount Tiers, Overhead Rates), system backups, and database exports.
2. **Staff Profile**:
   * **Username**: `staff`
   * **Passcode**: Assigned by the owner through User Management; never stored in documentation.
   * **Privileges**: Production planning, checklists, consignment dispatches, and inventory logs.

---

This context provides any successor AI or developer with the high-level background needed to understand operational workflows.

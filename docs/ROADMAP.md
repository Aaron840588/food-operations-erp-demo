# H+H Food System: Future Roadmap Planner

This document provides a forward-looking planner detailing upcoming features and optimizations designed to expand H+H's operations.

---

## 📈 Future Milestones & Next Steps

### 0. Release quality hardening [COMPLETED]
* **Description**: Completed the typed API migration, resolved all ESLint warnings/TypeScript errors, achieved a zero-warning build gate, and verified test suites for core operations.
* **Goal**: Pre-deploy quality gate is evidence-based and verified under clean production builds.

### 1. Custom Printable Invoice PDF Exports [COMPLETED]
* **Description**: Integrated print-specific styling overrides in the main sidebar layouts and headers, and configured standard A4 margin cards for direct pdf prints.
* **Tech Stack**: Native CSS `@media print` class selectors in LayoutClient wrapper elements.
* **Goal**: Enables operators to select products and trigger official browser print formatting previews for direct PDF downloads.

### 2. Multi-Location Warehouse support [COMPLETED]
* **Description**: Created a physical location directory mapping distributed stock counts, and added a visual transfer panel to move inventory from/to facilities, updating matching double entry logs.
* **Tech Stack**: Introduce `warehouses` and `warehouse_stocks` tables, link quantities, and update FastAPI routes.
* **Goal**: Enabled the business to track and coordinate stock across multiple retail outlets, kitchens, and warehouses.

### 3. Automated Webhook payment notifications
* **Description**: Connect the payment systems to automatically trigger SMS or email updates when B2B partners settle deliveries.
* **Tech Stack**: Set up webhook API endpoints in FastAPI that process Stripe or GCash payment confirmation notifications.

### 4. Push Notification triggers from backend [COMPLETED]
* **Description**: Dispatches browser push alerts to registered user device endpoints when system events are triggered.
* **Tech Stack**: Loaded the Python `pywebpush` library, generated secure VAPID key pairs, and connected triggers on low ingredient stock warnings and new reseller orders.
* **Goal**: Automatically alerts the business owner's device if raw ingredient stock levels fall below reorder thresholds or if a reseller order is registered.

### 5. Service Worker Offline cache storage [COMPLETED]
* **Description**: Transitioned the PWA service worker `sw.js` to handle all HTML Next.js page requests via a high-performance **Network-First (Offline Fallback)** strategy, while pre-caching vital structural assets.
* **Tech Stack**: Native Service Worker caches API and fetch interceptors, paired with localStorage SWR cache-restorers.
* **Goal**: Guarantees that users always load the latest deployed UI features when online, while seamlessly serving off-line functional page shells when disconnected at bazaar booths.

### 6. Pop-Up Market Events POS Cashier [COMPLETED]
* **Description**: Deployed a complete pop-up weekend market coordinator module integrating allocations, high-speed 1-tap checkout, offline sales queueing, auto-sync, auto-returns warehouse reconciliation, and Closeout Reports.
* **Tech Stack**: Introduce custom database models, JWT protection dependencies, PWA localStorage queues, and responsive Recharts diagrams.
* **Goal**: Replaces handwritten paper notebooks and double manual sheets data-entry with a completely automatic, intelligent business assistant.

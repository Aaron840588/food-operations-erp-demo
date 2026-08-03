# Handmade+Homemade (H+H) Hub — Enterprise Food Operations & ERP Platform

[![Security & Correctness](https://img.shields.io/badge/Security-Audit_Passed-emerald?style=for-the-badge&logo=shield)](file:///PROJECT_CONTEXT.md#6-security-and-correctness-invariants)
[![Version](https://img.shields.io/badge/Version-v2.8.0-blue?style=for-the-badge)](file:///CHANGELOG.md)
[![Stack](https://img.shields.io/badge/Stack-Next.js_16_%7C_FastAPI_%7C_PostgreSQL-darkviolet?style=for-the-badge)](file:///PROJECT_CONTEXT.md#2-current-stack)

**H+H Hub** is a full-stack, enterprise-grade Operations Management and ERP platform custom-architected for **Handmade+Homemade**. It unifies multi-channel sales (Market Events, Wholesale Resellers, Consignment Partners, and Public Pre-Orders), recipe costing, inventory control, automated material requirement planning (MRP), staff timesheets, and owner financial analytics into a single high-performance system.

---

## 🔒 Security Architecture & Privacy Standards

H+H Hub enforces zero-trust security boundaries to protect commercial financial data, customer privacy, and infrastructure credentials:

### 1. Zero Hardcoded Secrets
- All environment variables (Database URIs, JWT secrets, CORS allowlists, service account identifiers) are injected dynamically via Vercel Production Environment and local `.env` files (enforced by `.gitignore`).
- **Keyless Google Integration**: Workload Identity Federation uses short-lived Vercel OIDC tokens for Google Sheets ingestion—no static private keys or service account credentials are stored in the repo or browser bundle.

### 2. Authentication & Data Minimization
- **Token Security**: Short-lived JWT access tokens remain exclusively in-memory; refresh tokens are stored in secure `HttpOnly`, `SameSite=Lax`, HTTPS cookies.
- **Role-Based Access Control (RBAC)**: API routes strictly enforce `require_owner` for financial reporting, cost structures, and system administration. Staff roles receive stripped schemas omitting supplier costs, margins, and owner totals.

### 3. Financial Write Safety & Offline Idempotency
- **No Generic Mutation Replay**: Administrative, inventory, and financial writes require online server validation and are never stored in generic offline queues.
- **Isolated Market POS Offline Journal**: Offline cashier sales operate on a dedicated `hh_market_events_offline` IndexedDB instance using stable UUID `client_reference` tags to prevent duplicate transaction application during network recovery.
- **Immutable Transaction Snapshots**: Historical consignment, reseller, and event sales retain immutable price and cost snapshots to ensure historical financial truth cannot be rewritten by subsequent product price updates.

---

## 🛠️ System Architecture & Technology Stack

```
                                  ┌───────────────────────────┐
                                  │   Next.js 16 App Router   │
                                  │ (React 19 / Tailwind CSS) │
                                  └─────────────┬─────────────┘
                                                │ Same-Origin /api
                                  ┌─────────────▼─────────────┐
                                  │      FastAPI Backend      │
                                  │   (Python 3.12 / Async)   │
                                  └─────────────┬─────────────┘
                                                │ SQLAlchemy 2.0 ORM
                                  ┌─────────────▼─────────────┐
                                  │  Supabase PostgreSQL 17   │
                                  │ (45 Tables / Transaction) │
                                  └───────────────────────────┘
```

| Layer | Technologies & Specifications |
|---|---|
| **Frontend** | Next.js `16.2.12` App Router, React `19.2.4`, Turbopack, Tailwind CSS v4, SWR |
| **Backend** | FastAPI `0.139.2`, Python 3.12, SQLAlchemy `2.0.28` (45 unified models) |
| **Database** | Supabase PostgreSQL `17.6` (Production), SQLite (Local Dev/Tests) |
| **Authentication** | Passcode hash verification, JWT in-memory, secure HttpOnly refresh cookies |
| **Testing** | Python `unittest` suite (150 tests), Next.js regression tests, TypeScript strict no-emit |

---

## ✨ Core Modules & Business Capabilities

- **📊 Owner Executive Dashboard**: Real-time Asian/Manila weekly financial overview, recognized revenue, direct cost composition, contribution margins, Action Center alerts, and data confidence metrics.
- **🎪 Market Events & POS**: Smart recurring event series collapsing, live booth stock allocation, multi-payor checkout (Cash/GCash/Custom), tip tracking, stock loadout manifest generator, and 1-click printable closeout reports.
- **🏪 Consignment & Wholesale POS**: Partner discount matrix, whole-peso rounding, automated DR generation, sticky-column dispatch matrix, and linked production batch tracking.
- **📋 Production Planner & BOM Costing**: Multi-level recursive bill of materials (BOM), automated material shortage calculation from Market Event targets, FIFO stock consumption, and batch yield reconciliation.
- **📦 Public Pre-Order Portal**: Customer-facing catalog (`/preorder/[publicToken]`) with server-enforced positive price validation and mobile-optimized bottom sheet review.
- **⏱️ Staff Operations & Timesheets**: Guided inventory audit workflows, warehouse transfers (Main Facility mirror sync), task checklists, and shift clock-in/out logs.

---

## ⚡ Local Setup & Development

### Prerequisites
- Node.js `v20+` & npm
- Python `3.12+`

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Aaron840588/H-H.git
   cd H-H
   ```

2. **Backend Setup**:
   ```bash
   # Create and activate virtual environment
   python -m venv backend/venv
   # Windows PowerShell:
   .\backend\venv\Scripts\Activate.ps1

   # Install requirements
   pip install -r backend/requirements.txt
   ```

3. **Frontend Setup**:
   ```bash
   cd frontend
   npm install
   ```

4. **Environment Configuration**:
   Copy `.env.example` to `.env` and configure local values:
   ```bash
   cp .env.example .env
   ```

5. **Run Development Servers**:
   - Backend: `uvicorn backend.app.main:app --reload` (Runs on `http://127.0.0.1:8000`)
   - Frontend: `cd frontend && npm run dev` (Runs on `http://localhost:3000`)

---

## 🧪 Quality Assurance & Test Verification

Before any code is committed, the full verification suite must pass cleanly:

```powershell
# 1. Backend Unittest Suite (150 tests)
$env:PYTHONPATH="backend"; python -m unittest discover -s backend/tests -v

# 2. Frontend Regression & Build Checks
cd frontend
npm run test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

---

## 📜 License & Compliance

© 2026 Handmade+Homemade. All rights reserved. Built for portfolio presentation and operational excellence.

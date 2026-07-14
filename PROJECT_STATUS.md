# H+H Hub — Project Status

> **H+H Hub** is an enterprise resource planning (ERP) and operations management platform designed for premium food manufacturing and retail operations. It replaces spreadsheet-based workflows with a unified, high-performance web application.

---

## Technical Features Implemented

* **Frontend & UX**: Completely unified the visual layouts of Recipes, Inventory, and Production Planner into a structured, professional table grid with vertical column dividers and categorical navigation tabs (`ALL`, `Spreads & Sauces`, `Sandwiches & Salads`).
* **Sizing displays**: Unified the sizing displays across all pages to render exact physical weights from master trackers (e.g. `240g`, `200g`, `100g`, and size classifications like `Full`, `Half`, `Solo`).
* **Active Sales Lineup**: Exposes active Spreads & Sauces and Sandwiches & Salads lines.
* **Database Support**: Integrates SQLAlchemy supporting SQLite locally for development and PostgreSQL/Supabase for cloud-ready environments.
* **Comprehensive Test Suite**: Included backend unit tests verifying authentication, authorization boundaries, financial validity, FIFO calculations, and stock levels.

---

## 🚀 Live Cloud Deployment & Infrastructure

The application can be deployed as a unified Next.js + FastAPI project on serverless monorepos (such as Vercel) and connected to a Cloud PostgreSQL database (such as Supabase).

All database connections and credentials are secure and configured via standard environment variables:
*   `DATABASE_URL`: Connection URL of the PostgreSQL database.
*   `JWT_SECRET`: Signing key for JSON Web Tokens.
*   `INITIAL_OWNER_PASSCODE`: Default administrative security code.
*   `DEMO_MODE`: Enables public portfolio mode.

---

## 🏷️ Branding & Design System

The user interface supports high-contrast, premium, brand-compliant aesthetics:
*   **App Name**: **H+H Hub**
*   **Warm Sand Theme**: Theme backdrop (`#f4eee3`) paired with pure white cards (`bg-white`) and warm beige borders (`#dfd5c6`).
*   **Typography**: Clean headings (Georgia) and high-density, highly readable UI text (Helvetica).
*   **Branding Colors**: Warm Brown (`#885625`) and Yellow Gold (`#bc9037`).

---

## 🔒 Security & RBAC Implementation

*   **Role-Based Access Control**: Fully distinct dashboards and action states for `owner` and `staff` roles. Staff roles are restricted to standard operational views with sensitive financial pricing and profit margin data hidden.
*   **Secure Authentication**: Dual-token authentication with short-lived in-memory access tokens and HttpOnly, SameSite=Strict cookies for refresh tokens.
*   **Server-side Protection**: Custom dependency decorators protect all write/delete endpoints against privilege escalation.

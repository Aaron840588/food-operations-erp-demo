# H+H Hub — Portfolio Demo Active Session Context

> This document provides developer context for running, managing, and reviewing the sanitized public demo of H+H Hub.

---

## 🚀 1. Infrastructure & Connections

| Service | Details |
|---|---|
| **Local SQLite DB** | `backend/happy_noether.db` (local development fallback) |
| **Cloud PostgreSQL** | Connects to any PostgreSQL/Supabase database via `DATABASE_URL` |
| **Env File** | `.env` in project root — contains `DATABASE_URL`, `JWT_SECRET`, `INITIAL_OWNER_PASSCODE`, and `DEMO_MODE` |

---

## 🔒 2. Security & Auth Flow

*   **Bcrypt Password Hashing**: Supported via passlib.
*   **Dual-Token Authentication**: Short-lived 15-minute access token in memory, long-lived 14-day refresh token in HttpOnly cookie.
*   **RBAC**: Custom security decorators restrict financial configurations, administrative dashboards, and data resetting to authenticated owners, while kitchen operations staff have simplified, cost-redacted views.

---

## 🎨 3. Frontend & UX Layouts

*   **Framework**: Next.js App Router.
*   **Styling**: Tailwind CSS Warm Sand design theme.
*   **SWR Prefetching**: LocalStorage cache prefetching enables sub-5ms loading transitions on main tabs.
*   **Global Command Palette (Ctrl+K)**: Quick navigation panel accessible globally across all layouts.

# H+H Hub documentation index

Documentation checkpoint: **v2.6.1 — 2026-08-03**.

## Read first

1. [`../AGENTS.md`](../AGENTS.md) — engineering constraints and release gate.
2. [`../PROJECT_CONTEXT.md`](../PROJECT_CONTEXT.md) — canonical architecture, workflows, invariants, and live state.
3. [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) — current release results and remaining external/data work.
4. [`../SESSION_CONTEXT.md`](../SESSION_CONTEXT.md) — concise resume checklist and infrastructure identity.
5. [`../CHANGELOG.md`](../CHANGELOG.md) — release history.

## Current technical and business contracts

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — frontend, API, database, offline, Sheets, and deployment boundaries.
- [`BUSINESS_RULES.md`](BUSINESS_RULES.md) — costing, revenue, preorder, stock, Market Event, offline, and Sheet rules.
- [`CURRENT_STATE.md`](CURRENT_STATE.md) — active production and release checkpoints.
- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — concise business handbook.
- [`ROADMAP.md`](ROADMAP.md) — completed foundations and remaining activation/proof work.
- [`GOOGLE_SHEETS_SYNC.md`](GOOGLE_SHEETS_SYNC.md) — exact Sheet source-of-truth and activation contract.
- [`MARKET_EVENT_READINESS.md`](MARKET_EVENT_READINESS.md) — offline cashier and physical event readiness contract.

## Product and UI records

- [`DASHBOARD_OWNER_REQUIREMENTS.md`](DASHBOARD_OWNER_REQUIREMENTS.md) — owner request, metric definitions, implementation decisions, and acceptance criteria.
- [`TABLE_UI_AUDIT.md`](TABLE_UI_AUDIT.md) — shared table/product presentation standards.
- [`../design-qa.md`](../design-qa.md) — dashboard visual and interaction evidence.

## Historical evidence

- [`system-audit-2026-07-29/FULL_SYSTEM_AUDIT.md`](system-audit-2026-07-29/FULL_SYSTEM_AUDIT.md) — pre-fix audit with a v2.4.0 resolution record at the top.
- `system-audit-2026-07-29/*.json` and audit scripts — bounded evidence and reproducible checks.
- `../chat_export.md` — historical conversation export; not an active source of truth and intentionally not rewritten.

When documents conflict, use this order:

1. live GitHub/Vercel/Supabase verification;
2. root `PROJECT_CONTEXT.md` and `PROJECT_STATUS.md`;
3. current contracts under `docs/`;
4. historical audits and exports.

# H+H public demo context

This repository is an AI-assisted food-operations portfolio prototype. It must contain synthetic records only. Private hosting identifiers, payroll workbooks, client exports, deployment transcripts, credentials and production configuration do not belong here.

## Architecture and invariants

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS and SWR. Use the versions pinned in frontend/package.json.
- Backend: FastAPI, Pydantic and SQLAlchemy. Models remain unified in backend/app/models.py.
- Access tokens stay in memory. Refresh cookies remain secure and HttpOnly. Enforce role checks and minimize staff financial responses on the server.
- Do not rename/delete database columns without an explicitly reviewed migration. Production schema uses reviewed migrations, not create_all.
- Stock mutations synchronize the Main Facility mirror. Costing preserves cycle detection and memoization.
- Financial writes require online validation. Only the dedicated idempotent Market Event journal may replay cashier sales; never add a generic mutation queue.
- Preserve immutable sale-time prices/costs, positive public preorder prices and server-side product allowlists.
- Google Sheets reads stay server-side, allowlisted and audited. Do not commit cloud credentials.

## Public status

The public entry and `/login` redirect to `/demo`, a fictional React-memory workspace for inventory, order fulfilment and costing. It has no API client, auth, synchronization, persistence or private integrations. The public route bypasses the authenticated layout entirely. All data resets on refresh. The separate hosted API remains unavailable; database recovery and server-authorized guest sessions are still required before exposing the full ERP. Never reuse private production data or credentials. Preserve the isolated demo boundary.

The built-in timesheet calculator contains explicitly synthetic JSON examples. Uploaded workbooks are parsed in memory for an authorized session; never commit uploads. All original private payroll material has been removed from the branch, but historical commits may retain it.

## Validation

Run the full backend unittest suite against isolated SQLite and a test JWT secret. Run frontend tests, lint, typecheck, build, and production audit. Run pip-audit against backend/requirements.txt, git diff --check, then verify the deployed build independently. See AGENTS.md for detailed code rules.

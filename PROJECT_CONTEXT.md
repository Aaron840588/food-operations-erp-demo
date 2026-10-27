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

The original H+H screens now use `/api/demo-workspace`, an isolated stateless sample transport. Each call creates SQLite from `resources/demo-schema.sql`, restores bounded parameterized rows, executes the original handler using a separate dependency provider, and returns a compressed snapshot. The frontend holds snapshots only in memory and serializes requests. Production dependency overrides are never modified. Costing caches are bypassed in the sample context. The public server ignores private DATABASE_URL/POSTGRES_URL configuration and skips startup migrations. Cloud connections, private uploads and push delivery are outside the demo. The previous reduced UI was removed; `/demo` redirects to the original dashboard. Preserve these isolation boundaries.

The built-in timesheet calculator contains explicitly synthetic JSON examples. Uploaded workbooks are parsed in memory for an authorized session; never commit uploads. All original private payroll material has been removed from the branch, but historical commits may retain it.

## Validation

Run the full backend unittest suite against isolated SQLite and a test JWT secret. Run frontend tests, lint, typecheck, build, and production audit. Run pip-audit against backend/requirements.txt, git diff --check, then verify the deployed build independently. See AGENTS.md for detailed code rules.

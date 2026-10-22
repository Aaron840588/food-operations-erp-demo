# H+H Hub — food operations prototype

An AI-assisted portfolio prototype exploring inventory, recipe costing, purchasing, consignment, market sales and reporting with Next.js, FastAPI and SQLAlchemy.

[Case study](https://aarontagapan.vercel.app/work/hh-hub) · [Hosted demo](https://food-operations-erp-demo.vercel.app)

## Public status — October 22, 2026

The public demo is under maintenance. The entry page explains the limitation and links to the case study and source. Backend unavailability returns a generic public error. This release does not restore database connectivity or create authenticated guest sessions.

Before reopening, provision an isolated database containing synthetic records, verify connectivity and implement server-authorized guest sessions. Never connect private production records or credentials to this public demo. SQLite regression results do not establish PostgreSQL hosting health.

## Stack and architecture

- Frontend: Next.js 16.4.2, React 19.2.4, TypeScript, Tailwind CSS, SWR.
- Backend: Python 3.12, FastAPI, Pydantic, SQLAlchemy; exact versions in `backend/requirements.txt`.
- Deployment: root `vercel.json` routes `/api/*` to FastAPI and other requests to Next.js.
- Authentication: server-enforced role checks, in-memory access tokens, HttpOnly refresh cookies.
- Stock and financial workflows preserve FIFO handling, immutable sale snapshots and dedicated idempotent Market Event offline handling. Generic mutation replay is prohibited.
- CORS uses an explicit origin allowlist. Public 500-level errors omit internal exception details.
- The timesheet calculator uses fictional JSON examples in `backend/app/resources/demo-timesheets.json`.

These are implementation patterns, not a certification that every inherited feature or external integration is ready for public use.

## Local setup

Use Node.js 24 and Python 3.12. Clone this public repository:

```sh
git clone https://github.com/Aaron840588/food-operations-erp-demo.git
cd food-operations-erp-demo
python -m venv .venv
```

Activate the environment (`.\.venv\Scripts\Activate.ps1` in PowerShell), then:

```sh
pip install -r backend/requirements.txt
cd frontend
npm ci
npm run dev
```

For a local backend, set `DATABASE_URL` to an isolated database and generate a local `JWT_SECRET`; use environment variables rather than committing values. Run `uvicorn backend.app.main:app --reload` from the repository root. The frontend development proxy targets localhost:8000. Review `.env.example` for optional integrations; placeholder credentials must be replaced locally and must never be committed. No private cloud integration is needed for the regression suite.

## Validation

From the root with the virtual environment active (PowerShell):

```powershell
$env:PYTHONPATH = 'backend'
$env:DATABASE_URL = 'sqlite://'
$env:JWT_SECRET = [guid]::NewGuid().ToString() + [guid]::NewGuid().ToString()
python -m unittest discover -s backend/tests -v
python -m pip_audit -r backend/requirements.txt
cd frontend
npm test
npm run lint
npx tsc --noEmit
npm run build
npm audit --omit=dev
```

Install `pip-audit` separately for the dependency scan. Keep `backend/requirements.txt` and `backend/app/requirements.txt` identical. CI verifies both manifests and runs these checks.

The October 22 run passed 156 backend tests, 8 frontend tests, lint, TypeScript, build and production dependency audits. Five development-only ESLint dependency findings remain. See [release notes](RELEASE_NOTES.md), [engineering constraints](AGENTS.md), [current context](PROJECT_CONTEXT.md) and [documentation index](docs/README.md).

## Privacy and license

Private payroll workbooks, deployment/chat transcripts and stale backups were removed from the current source. Earlier Git commits may retain removed material; source cleanup does not erase history. Never upload private payroll, client records or backups to the demo.

This public repository is provided for portfolio review, not represented as an open-source licensed product. Existing copyright/license notices apply.

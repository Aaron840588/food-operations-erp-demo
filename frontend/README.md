> Public demo release, October 27, 2026: the original interface uses an isolated fictional API workspace. Run FastAPI locally with the frontend; `/demo` redirects to the dashboard. See [root README](../README.md) and [release notes](../RELEASE_NOTES.md) for current scope.

# H+H Hub frontend

Current application version: **2.9.0**.

Next.js `16.4.3` and React `19.3.1` App Router client for H+H Hub, using Node.js 24. The frontend and FastAPI backend deploy as one Vercel project from the repository root.

## Local development

For the fictional demo, run:

```powershell
cd frontend
npm.cmd run dev
```

Both public and private modes need FastAPI. Run `uvicorn backend.app.main:app --reload` from the repository root in a second terminal with the Python environment active. During local development, `next.config.ts` rewrites `/api/*` to `http://127.0.0.1:8000`. Public mode sends operations only to the isolated `/api/demo-workspace` transport.

## Quality checks

```powershell
npm.cmd run test
npm.cmd run lint
npx.cmd tsc --noEmit
npm.cmd run build
npm.cmd audit --omit=dev
```

Every release requires passing regression tests, zero ESLint warnings, zero TypeScript errors, a successful production build, and a clean production dependency audit.

## Version behavior

- `frontend/package.json` provides the initial client version.
- `GET /api/version` returns the canonical backend version and release timestamp.
- Private mode polls the server version and reloads when the release timestamp changes. Public mode uses a fixed sample version and does not poll or register service workers.
- Backend tests verify that the frontend package and FastAPI versions match.

## Offline behavior

- Read caches may provide immediate previously loaded data.
- Generic mutation replay is retired and sanitized.
- Authentication, administrative, inventory, reseller, consignment, and destructive writes are online-only.
- Only Market POS has a dedicated offline sales journal with stable client references and receipt reconciliation. Public mode uses memory instead of persistent IndexedDB; refreshing resets its sample journal.

## UX and accessibility

- Respect browser zoom.
- Do not add CSS `zoom`, `user-scalable=no`, or restrictive maximum-scale settings.
- Preserve practical touch targets, safe-area padding, keyboard focus, and responsive mobile order controls.

## Deployment

Merging repository `main` triggers Vercel production deployment. After release:

1. Confirm the deployment source SHA and `READY` state.
2. Run `python scripts/check_deployment.py https://food-operations-erp-demo.vercel.app` from the root to verify HTML and referenced scripts/styles.
3. Verify the isolated `/api/demo-workspace` operations and intended `/api/version` release. Private database health is not the public demo readiness signal.
4. Check original-screen navigation, stock/sale/production behavior, JSON backup download and mobile navigation.
5. Review CI screenshots and runtime errors. Real-device printing, sharing and private integrations require separate validation.

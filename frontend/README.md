# H+H Hub frontend

Current application version: **2.8.0**.

Next.js `16.2.12` App Router client for H+H Hub. The frontend and FastAPI backend deploy as one Vercel project from the repository root.

## Local development

Run the backend separately, then:

```powershell
cd frontend
npm.cmd run dev
```

The client uses same-origin `/api` requests. During local development, `next.config.ts` rewrites `/api/*` to `http://127.0.0.1:8000`; `NEXT_PUBLIC_API_URL` may explicitly override the base when required.

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
- `LayoutClient` displays the server version and reloads when the release timestamp changes.
- Backend tests verify that the frontend package and FastAPI versions match.

## Offline behavior

- Read caches may provide immediate previously loaded data.
- Generic mutation replay is retired and sanitized.
- Authentication, administrative, inventory, reseller, consignment, and destructive writes are online-only.
- Only Market POS has a dedicated offline sales journal with stable client references and receipt reconciliation.

## UX and accessibility

- Respect browser zoom.
- Do not add CSS `zoom`, `user-scalable=no`, or restrictive maximum-scale settings.
- Preserve practical touch targets, safe-area padding, keyboard focus, and responsive mobile order controls.

## Deployment

Merging repository `main` triggers Vercel production deployment. After release:

1. Confirm the deployment source SHA and `READY` state.
2. Verify `/api/health` reports `healthy`, `online`, and `production`.
3. Verify `/api/version` reports the intended release.
4. Smoke-test the public preorder catalog and mobile review flow.
5. Check Vercel runtime errors.

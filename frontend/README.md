# H+H Hub frontend

Next.js 16 App Router client for H+H Hub. It is deployed with the FastAPI backend as one Vercel project from the repository root.

## Local development

```powershell
cd frontend
npm.cmd run dev
```

The frontend uses same-origin `/api` requests in every environment. During local development, `next.config.ts` rewrites `/api/*` to the FastAPI server at `http://127.0.0.1:8000`; `NEXT_PUBLIC_API_URL` can still override the API base when needed.

## Quality checks

```powershell
npm.cmd run build
npm.cmd run lint
```

Build success is required for release. All route modules have been fully migrated to typed API contracts, and the build gate maintains zero ESLint warnings and zero TypeScript errors. Do not introduce warnings in new or changed code.

## UX and accessibility

The application uses a responsive viewport and intentionally respects browser zoom. Do not add CSS `zoom`, `user-scalable=no`, or restrictive maximum scale settings.

## Deployment

Push repository `main` to trigger Vercel production deployment. Verify `/api/health` returns `healthy`, `online`, and `production` after each release.

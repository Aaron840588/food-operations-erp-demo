# Original H+H demo restored — October 27, 2026

Restore the original interface and route it through an isolated fictional SQLite workspace using the existing ERP handlers. Remove the reduced demo interface. Preserve role checks, recipe costing, stock mirrors, sale-time snapshots and production idempotency. Demo state stays in browser memory and resets on refresh. Public mode skips production startup writes and ignores private database configuration.

Fix Vercel asset routing so Next.js scripts and styles load before the legacy catch-all. Add a public deployment asset check and CI browser screenshots. External account connections, push delivery and private uploads remain explicitly unavailable in the public sample.

Validation includes the existing backend suite plus sample-isolation, invalid-state, parallel-visitor, staff-permission and connected stock/wholesale/consignment/production regressions. Browser CI exercises original-screen navigation, tasks, sales and mobile navigation. Production evidence must be checked independently after merging.

Restore complete fictional workspace downloads in the original backup panel, omitting password and form-token hash fields. Keep the public Market Events journal in memory so sample sales reset on refresh. Correct product grouping so sauce/spread samples appear in inventory, and remove inherited contact details from invoice templates.

---

# Fictional interactive demo — October 23, 2026

Replace the public maintenance entry with a browser-only inventory, order and costing simulation. Root and login entry routes redirect to `/demo`; the authenticated application layout never mounts on this route. Synthetic records live only in memory. No database, credentials, API writes, customer uploads or cloud integrations are used.

Order fulfilment validates stock, prevents repeat deductions and retains order-time costs/prices. Reset restores original samples. A batch calculator shows illustrative margins independently of order prices. Responsive navigation, keyboard focus, status/error announcements, reduced motion and browser zoom are supported.

The full backend remains unavailable and is not presented as restored. Existing security/privacy-history limitations still apply.

---

# Public release — October 22, 2026

Publish an honest maintenance entry, generic backend errors, explicit CORS, security headers and synthetic timesheet examples. Remove private payroll and transcript artifacts from current source; update vulnerable dependencies. Validation: 156 backend and 8 frontend tests plus lint, types, build and production dependency audits passed. Database recovery and real guest authorization remain required; historical commits may retain removed private files.

## Deployment

Publication uses the existing GitHub-to-Vercel integration after merging the reviewed changes into the default branch. Verify the deployment for the merge commit and the actual public URLs; a passing build alone does not prove external service health. Production verification results are recorded separately in the workspace release report.

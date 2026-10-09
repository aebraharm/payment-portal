# payment-portal

A production-oriented payment portal for an immigration agency. It has two separate areas:

- **Client portal** – clients sign in with their full name and a client-specific access code, see their invoices, choose a payment method, get a payment reference with bank or Western Union instructions, tell the agency they have sent the money, upload a receipt, and follow each confirmation's status.
- **Admin portal** – staff manage clients and invitations, invoices (totals are calculated on the server), payment setup (currencies, bank accounts, Western Union), the payment review queue, refunds recorded manually, branding and settings (draft and publish), notification templates, the audit log, admin users, and CSV reports.

Nothing agency-specific (name, logo, bank details, Western Union details, exchange data, instructions) is in the code. It is all stored in the database and managed by staff.

## Principles

- **Money is never assumed.** A client's "I HAVE SENT THE MONEY" creates a confirmation for review. It never marks an invoice paid. Only an authorised reviewer who confirms the amount can verify a payment.
- **The server decides amounts.** Totals, outstanding balances, partial-payment limits, and refund limits are calculated and checked on the server from decimal strings.
- **Currencies are never converted.** Each invoice is payable only in its own currency (USD, CAD, EUR or GBP).
- **Card payments are not offered.** The card option is shown disabled with the label "Not available in your region". No card data is collected, and the server refuses to enable card payments.
- **Honest delivery status.** When email is not configured, notifications are recorded as `not_configured`. Nothing is reported as sent unless the mail server accepted it.

## Stack

Vite, React 19, TypeScript, React Router, Tailwind CSS 4 (front end). Hono (API), PostgreSQL via `pg` in production, and an embedded PostgreSQL-compatible database (PGlite) for local development and tests. Zod schemas are shared by the browser and the server. Netlify Functions run the API in production; a Node server is included for self-hosting.

## Local development

Requirements: Node.js 22 (see `.nvmrc`).

```bash
npm install
npm run dev            # API on 127.0.0.1:8787 and the app on http://localhost:5173
```

Local development uses an embedded database in `.data/` (git-ignored). It is not suitable for production.

To create the first administrator locally, set the bootstrap variables for one command only:

```bash
ADMIN_BOOTSTRAP_EMAIL=you@example.com ADMIN_BOOTSTRAP_PASSWORD='choose-a-long-passphrase' npm run db:bootstrap-admin
```

The first sign-in requires a new password. The bootstrap password is never printed or stored in plain text, and running the command again is safe.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | API and app for local development |
| `npm run build` | Type-check, then build the app to `dist/` |
| `npm start` | Serve the built app and API with Node (self-hosting) |
| `npm run typecheck` | TypeScript checks for the app and the server |
| `npm run lint` | ESLint |
| `npm test` | Test suite (server integration, UI, shared rules) |
| `npm run db:migrate` | Apply database migrations (also applied automatically on start) |
| `npm run db:bootstrap-admin` | Create the first administrator from environment variables |
| `npm run jobs:reminders` | Send due-soon and overdue reminders once |

## Layout

```
src/                 React app (client portal, admin portal, shared UI)
shared/              Zod schemas, money and date rules, bank field definitions, status rules
server/              Hono API, services, database adapters and migrations, storage, mail, security
netlify/functions/   Netlify Functions: API (/api/*) and the daily reminders schedule
tests/               Server integration tests, UI tests, rule tests
docs/DEPLOYMENT.md   Environment variables, Netlify setup, bootstrap, storage, email, operations
```

## Security summary

- Passwords and access codes are hashed with scrypt (`node:crypto`). Session and one-time tokens are stored as hashes.
- Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS. State-changing requests need a CSRF token and a same-origin request.
- Login errors are generic, and unknown accounts take the same time to check. Rate limits apply per name or email and per network address.
- Invitation links last 7 days and reset links 30 minutes. Both are single-use and sent in the URL fragment, so they are not written to server logs.
- Receipts are checked by content (PDF, JPEG and PNG magic bytes) and size (5 MB), stored in private storage, and served only after authorisation. Each view is audited.
- The audit log is append-only, enforced by a database trigger.
- Security headers and a Content Security Policy are set for the app.

## Verification status

The repository includes automated tests for the acceptance criteria. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` to reproduce the results. Exact results are reported in the completion summary, not here.

Not verified in this environment: a live PostgreSQL server, a live S3-compatible bucket, a live SMTP server, and a Netlify deployment. These need the external services described in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

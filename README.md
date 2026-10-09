# Payment Portal

A production-oriented payment platform for a migration agency, with two separate
portals sharing one secure backend:

- **Client Portal** — clients sign in with their full name and an
  admin-issued access code, view invoices, follow configurable bank-transfer or
  Western Union instructions, and submit payment confirmations with receipt
  uploads.
- **Admin Portal** — agency staff manage clients, invoices, payment
  configuration, branding, and review payment confirmations
  (verify / reject / request information). A dashboard shows live statistics
  and charts built from real database records.

Everything client-facing is configurable from the database/settings — agency
name, logo, colors, bank details, currencies, payment methods, legal texts,
notification templates. **Nothing is hardcoded in the frontend.**

## Key properties

- **Money is always integer cents** with an explicit currency. Amounts are
  computed and validated on the server; the browser is never trusted.
- **Manual payments are never auto-verified.** A client pressing
  *"I have sent the money"* only submits a confirmation; the invoice becomes
  `paid` / `partially_paid` exclusively through an admin review action, which
  records the reviewer and timestamp.
- **Card payments are always shown as disabled** with the exact label
  *"Not available in your region"*. No card data is ever collected, and the
  server rejects card payment references with that label.
- **Payment instructions are snapshotted** into every payment reference, so
  changing bank details later never corrupts historical transactions.
- **Receipts** are limited to PDF/JPEG/PNG, validated by magic bytes (not just
  extension), stored outside any public static directory, and streamed only to
  the owning client or an admin.
- **Email is honest**: if SMTP is not configured, notifications are stored in
  the database marked `skipped_not_configured` — the app never pretends an
  email was sent.
- **Security**: bcrypt-hashed access codes (shown once), HttpOnly
  SameSite=Strict session cookies, rate limiting, helmet/CSP headers, audit
  logs for every sensitive action, forced password change on first admin
  login, and idempotent seeding.
- **Accessibility**: `prefers-reduced-motion` support, keyboard-navigable
  components, focus management in modals, and fully responsive layouts.

## Tech stack

| Layer     | Technology                                                        |
| --------- | ----------------------------------------------------------------- |
| Frontend  | React 18 + TypeScript + Vite + Tailwind CSS                       |
| Backend   | Node.js (>= 22.5) + Express                                       |
| Database  | SQLite via the built-in `node:sqlite` driver (zero native builds) |
| Auth      | Cookie sessions (sha256-hashed tokens) + bcrypt                   |
| Uploads   | multer (memory storage) + magic-byte validation                   |
| Email     | nodemailer (only when SMTP is configured)                         |
| Tests     | Vitest + supertest (API) + Testing Library (UI)                   |

## Project structure

```
server/
  config.js               env-driven configuration
  db.js                   node:sqlite wrapper (WAL, FK, transactions)
  migrate.js / seed.js    schema + idempotent seed (bootstrap admin, currencies, methods)
  app.js / index.js       Express app factory + dev/prod entrypoint
  middleware/             auth, security (rate limits, CSP), error handling
  lib/                    money, refs, tokens, audit, notify, storage, settings,
                          paymentConfig, instructions (snapshots)
  routes/                 public, auth, files, admin/*, client/portal
src/
  api/client.ts           typed API wrapper (JSON + multipart, ApiError)
  context/                Branding, ClientAuth, AdminAuth providers
  components/ui/          design system (buttons, badges, charts, modals, ...)
  components/layout/      client/admin layouts, logo
  pages/client/           login, dashboard, pay flow (4 steps), transactions, support, legal
  pages/admin/            dashboard, clients, invoices, payments, transactions,
                          branding settings, security
tests/
  backend/                supertest API suites (auth, payments, config, uploads)
  frontend/               jsdom component/page tests
```

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment (NEVER commit real credentials)
cp .env.example .env
$EDITOR .env        # set ADMIN_EMAIL, ADMIN_PASSWORD (see .env.example)

# 3. Create/migrate the database and seed defaults + bootstrap admin
npm run migrate
npm run seed        # idempotent — safe to re-run

# 4. Start the dev server (frontend served by Vite middleware, port 4000)
npm run dev
```

Open http://localhost:4000 — the **client portal** is at `/`, the **admin
portal** at `/admin/login`.

- Bootstrap admin: the `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.
  The first login forces a password change.
- To create a client: sign in to the admin portal → Clients → New client.
  The access code is shown **once** — copy it to the client.

## Scripts

| Script               | Purpose                                              |
| -------------------- | ---------------------------------------------------- |
| `npm run dev`        | Dev server with Vite middleware (HMR)                |
| `npm run build`      | Type-check + production frontend build to `dist/`    |
| `npm start`          | Production server: serves `dist/` + API (SPA fallback) |
| `npm run typecheck`  | `tsc` type-check                                     |
| `npm test`           | Full test suite (75 tests: API + UI)                 |
| `npm run lint`       | ESLint                                               |
| `npm run migrate`    | Apply database migrations                            |
| `npm run seed`       | Idempotent seed (currencies, methods, settings, admin) |

## Environment variables

See `.env.example` for the full annotated list. The important ones:

| Variable          | Required | Purpose                                             |
| ----------------- | -------- | --------------------------------------------------- |
| `PORT`            | no       | Server port (default 4000)                          |
| `NODE_ENV`        | no       | `production` enables secure cookies                 |
| `DATABASE_PATH`   | no       | SQLite file path                                    |
| `UPLOAD_DIR`      | no       | Private upload directory (never statically served)  |
| `ADMIN_EMAIL`     | yes      | Bootstrap admin email (seeded once)                 |
| `ADMIN_PASSWORD`  | yes      | Bootstrap admin initial password (change on login)  |
| `SMTP_*`          | no       | Email is optional; without it nothing is faked      |
| `RATE_LIMIT_*`    | no       | Auth/general rate-limit tuning                      |

## Payment flow (client)

1. **Select invoice** → 2. **Choose method** (bank transfer / Western Union;
   card is always shown disabled with the fixed label) → 3. **Instructions**
   (server-generated reference + snapshot of the current bank details; the
   reference is auto-registered) → 4. **Submit proof** (amount, date, sender,
   reference, receipt file; idempotent via `Idempotency-Key`) →
   **"I have sent the money"** marks the transaction *submitted* — it is
   **not** verified until an admin reviews it.

## Admin review workflow

Transactions appear in the review queue (`/admin/transactions`). An admin can
set a confirmation to `under_review`, `verified` (marks the invoice
`paid`/`partially_paid` by amount comparison), `rejected` (reason required —
the client may resubmit), or `info_requested` (reason required). Every action
writes an audit-log entry with the acting admin.

## Testing

```bash
npm test
```

- **Backend** (`tests/backend/`): supertest against the real Express app with
  an isolated in-memory database and temp upload dir. Covers authentication,
  forced password change, client isolation, the full payment workflow,
  idempotency, snapshots, settings validation, receipt security, and CSV
  export.
- **Frontend** (`tests/frontend/`): jsdom tests for the design system, money
  formatting, and the client login page (with a mocked API layer).

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the production checklist:
building, environment variables, reverse proxy (nginx), TLS, backups of
`server/data` + `server/uploads`, and optional SMTP.

## License

Proprietary — internal project.

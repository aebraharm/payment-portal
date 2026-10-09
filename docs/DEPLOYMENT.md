# Deployment guide

This guide covers what is needed to run the portal on Netlify with external services. Values in this file are examples. Real secrets belong only in the hosting provider's environment settings.

## 1. External services you must provide

| Service | Why it is needed | Notes |
| --- | --- | --- |
| Managed PostgreSQL (version 14 or later) | Persistent data. Netlify Functions have no persistent disk. | Use TLS. Set `DATABASE_URL` and `DATABASE_SSL=true`. |
| S3-compatible private bucket | Receipt storage. Required on Netlify (`RECEIPT_STORAGE=s3`). | Block all public access. No public-read policy. |
| SMTP mail account (optional) | Client and staff notifications. | Without it, notifications are recorded as `not_configured`. |
| Netlify site | Hosts the app, the API function and the daily reminder schedule. | Connect the repository and use the included `netlify.toml`. |

## 2. Environment variables

Set these in Netlify under *Site configuration → Environment variables*, or in a local `.env` for development (see `.env.example`).

| Variable | Required | Description |
| --- | --- | --- |
| `APP_URL` | Yes (production) | Public HTTPS address of the site, for example `https://payments.example.com`. Used in links. |
| `APP_SECRET` | Yes (production) | At least 32 random characters. Keys the hashing of network addresses used for rate limits and logs. Generate with `openssl rand -base64 48`. Rotating it resets rate-limit counters; it does not sign anyone out or invalidate links. |
| `NODE_ENV` | Recommended | `production` on the live site. |
| `APP_TIME_ZONE` | Optional | IANA time zone for due dates and reminders. Default `Africa/Lagos`. |
| `DATABASE_URL` | Yes | PostgreSQL connection string. Required on Netlify. |
| `DATABASE_SSL` | Optional | `true` (default in production) to require TLS. |
| `RECEIPT_STORAGE` | Yes | `s3` on Netlify. `local` is for development only. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Yes when `s3` | Bucket details. Use a key that can only read and write this bucket. `S3_ENDPOINT` is needed for non-AWS providers. `S3_FORCE_PATH_STYLE=true` for providers that need it. |
| `RECEIPT_MAX_BYTES` | Optional | Upper limit per receipt. Default and maximum 5242880 (5 MB). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Optional | Outgoing mail. `SMTP_FROM` is the sender shown to clients. Leave `SMTP_HOST` empty to disable email. |
| `ADMIN_BOOTSTRAP_EMAIL` | Once | Email for the first administrator. |
| `ADMIN_BOOTSTRAP_PASSWORD` | Once | Initial password for the first administrator (minimum 10 characters). Remove it after the account exists. |
| `ADMIN_BOOTSTRAP_NAME` | Optional | Display name. Default `Administrator`. |
| `CRON_SECRET` | Optional | Long random value for calling `POST /api/internal/reminders` manually. If unset, that endpoint returns 503. |
| `COOKIE_SECURE` | Optional | Defaults to `true` when `APP_URL` is HTTPS. |
| `TRUST_PROXY_HEADERS` | Optional | Defaults to `true` on Netlify so rate limits see the client's network address. |
| `ADMIN_SESSION_HOURS`, `CLIENT_SESSION_HOURS` | Optional | Session lengths. Defaults 8 and 24. |
| `RATE_LIMIT_WINDOW_MINUTES`, `ADMIN_LOGIN_MAX_PER_EMAIL`, `ADMIN_LOGIN_MAX_PER_IP`, `CLIENT_LOGIN_MAX_PER_NAME`, `CLIENT_LOGIN_MAX_PER_IP`, `RESET_REQUESTS_MAX_PER_EMAIL` | Optional | Rate limit tuning. Defaults in `.env.example`. |

The server refuses to start in production if `APP_URL` is not HTTPS, `APP_SECRET` is short, `DATABASE_URL` is missing, or receipts would be stored on a function's local disk. Startup errors name the variable that needs attention.

## 3. Deploy to Netlify

1. In Netlify, create a site from the Git repository. Netlify reads `netlify.toml`: build command `npm run build`, publish directory `dist`, functions in `netlify/functions`.
2. Set the environment variables from section 2. Set `NODE_ENV=production`.
3. Deploy. The API is served at `/api/*` by the `api` function. The app is served from `dist/` with a single-page-app fallback.
4. Open `https://<your-site>/api/health`. It should report that the service is up.
5. Complete the first-administrator setup (section 4). Sign in at `/admin/login`.

Database migrations run automatically the first time the API starts (`server/runtime.ts`). They take a PostgreSQL advisory lock, so several instances starting together are safe. You can also run them explicitly from a machine that has `DATABASE_URL`:

```bash
DATABASE_URL='postgres://…' npm run db:migrate
```

Migrations only move forward. Take a database backup before each deployment that includes a new migration file.

## 4. First administrator (one-time)

Run this from a secure machine that has the production `DATABASE_URL`. It is idempotent: if the email already exists, nothing changes.

```bash
DATABASE_URL='postgres://…' \
ADMIN_BOOTSTRAP_EMAIL='portal11@gmail.com' \
ADMIN_BOOTSTRAP_PASSWORD='<a passphrase of at least 10 characters>' \
npm run db:bootstrap-admin
```

- The password is hashed before it is stored and is never printed.
- The account must change its password on first sign-in.
- Remove `ADMIN_BOOTSTRAP_PASSWORD` from the environment afterwards. Keep `ADMIN_BOOTSTRAP_EMAIL` if you like.
- Never commit the password or place it in the frontend.

## 5. Receipt storage

- Use a private bucket with public access blocked. Receipts are never linked directly; the API checks the user's permissions before serving each file.
- Receipts are stored before the database record is written. If the database write fails, the stored object is removed.
- Enable bucket versioning or lifecycle rules according to your retention policy. The portal does not delete receipts automatically.

## 6. Email

- Set the `SMTP_*` variables. Staff can see delivery state under *Notifications*, and failed messages can be retried there.
- A message is shown as **sent** only after the mail server accepts it.
- Without SMTP, messages are recorded as **not configured**. Share invitation links through a secure channel in that case. Each link is shown once, when it is created.

## 7. Reminders

- `netlify/functions/reminders.mts` runs daily at 00:00 UTC (01:00 in Lagos). It sends due-soon reminders on the days configured under *Settings → Operations* and overdue reminders at the configured interval.
- Each reminder has a dedupe key, so reruns never send the same message twice.
- To run once manually: `DATABASE_URL=… npm run jobs:reminders`, or call `POST /api/internal/reminders` with `Authorization: Bearer $CRON_SECRET`.

## 8. Operations checklist before go-live

- [ ] Managed PostgreSQL with TLS, automated backups, and a tested restore
- [ ] Private S3-compatible bucket, public access blocked, credentials limited to this bucket
- [ ] SMTP configured and a test notification delivered (Notifications page shows *sent*)
- [ ] `APP_URL` uses HTTPS and matches the public site address
- [ ] `APP_SECRET` is at least 32 random characters and stored only in Netlify
- [ ] First administrator created; bootstrap password removed from the environment; password changed
- [ ] Currencies, bank accounts, and Western Union details entered and reviewed by finance; Western Union turned on only when ready
- [ ] Branding and contact details published (drafts are not visible to clients)
- [ ] Staff roles assigned (finance reviewers verify payments; viewers cannot change anything)
- [ ] Card option stays disabled (the server will not enable it)

## 9. Known limits

- No card processing and no currency conversion. Clients pay in the invoice currency only.
- Refunds are recorded manually after they are sent outside the portal. The portal does not move money.
- Western Union submissions stay unverified until an authorised reviewer checks them.
- Reminders run once a day, so their timing has one-day precision.
- The embedded development database is for local use only. It refuses to run in serverless environments.

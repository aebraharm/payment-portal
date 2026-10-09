# Deployment Guide

This guide covers running the Payment Portal in production. The app is a
single Node.js process that serves both the API and the built frontend
(`dist/`), with SQLite as the database and a private uploads directory.

## 1. Build

```bash
npm ci
npm run build        # type-checks and produces dist/
```

Requirements: **Node.js >= 22.5** (for the built-in `node:sqlite` driver).
No native compilation is needed — `node:sqlite` ships with Node itself.

## 2. Environment

Create `.env` on the server (never commit it):

```bash
NODE_ENV=production
PORT=4000
DATABASE_PATH=/var/lib/payment-portal/portal.db
UPLOAD_DIR=/var/lib/payment-portal/uploads
ADMIN_EMAIL=admin@your-agency.com
ADMIN_PASSWORD=<long random initial password>
# Sessions are random 256-bit tokens stored hashed in the DB — no secret needed.
SESSION_TTL_HOURS=8
# Optional email (without SMTP, notifications are recorded as "not configured")
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=portal@your-agency.com
SMTP_PASSWORD=<smtp password>
SMTP_FROM="Your Agency <no-reply@your-agency.com>"
NOTIFY_ADMIN_EMAIL=admin@your-agency.com
```

Generate secrets with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**First login**: the bootstrap admin (`ADMIN_EMAIL`) must change the initial
password on first sign-in — this is enforced by the server.

## 3. Initialize the database

```bash
npm run migrate
npm run seed         # idempotent: safe on every start; never resets passwords
```

You can re-run `npm run seed` after upgrades; it never duplicates rows and
never overwrites a changed admin password.

## 4. Run

```bash
npm start            # NODE_ENV=production node server/index.js
```

The server listens on `0.0.0.0:$PORT` and serves:

- `GET /api/*` — JSON API
- `GET /api/files/receipts/:id` — authenticated receipt streaming
- everything else — the SPA (`dist/index.html` with client-side routing)

For process management use systemd, PM2, or Docker. Example systemd unit:

```ini
[Unit]
Description=Payment Portal
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/payment-portal
EnvironmentFile=/opt/payment-portal/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
User=portal

[Install]
WantedBy=multi-user.target
```

## 5. Reverse proxy & TLS

Put nginx (or Caddy) in front; terminate TLS there and proxy to
`127.0.0.1:4000`:

```nginx
server {
    listen 443 ssl http2;
    server_name pay.your-agency.com;

    ssl_certificate     /etc/letsencrypt/live/pay.your-agency.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pay.your-agency.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

Notes:

- The app sets `Secure` cookies only when `NODE_ENV=production`, and trusts
  `X-Forwarded-Proto` for rate-limit keying. Always run with
  `NODE_ENV=production` behind TLS.
- Increase `client_max_body_size` (nginx) to slightly above
  `receipt_max_size_mb` (default 10 MB → set e.g. `client_max_body_size 12m;`).
- Let's Encrypt via `certbot` is the usual way to get certificates.

## 6. Backups

Two directories hold all state — back them up together, atomically if
possible:

```bash
/var/lib/payment-portal/portal.db*     # SQLite database (+ -wal/-shm files)
/var/lib/payment-portal/uploads/       # receipts and branding assets
```

Example (with the app briefly stopped, or using SQLite `.backup` while
running — WAL mode makes online backups safe):

```bash
sqlite3 /var/lib/payment-portal/portal.db ".backup '/backups/portal-$(date +%F).db'"
tar -czf /backups/uploads-$(date +%F).tar.gz -C /var/lib/payment-portal uploads
```

Restore by copying the files back and restarting the service.

## 7. Security checklist

- [ ] `.env` is on the server only, readable by the service user only
      (`chmod 600 .env`).
- [ ] `ADMIN_PASSWORD` is a long random value (changed on first login).
- [ ] TLS is enabled; `NODE_ENV=production` is set.
- [ ] `DATABASE_PATH` and `UPLOAD_DIR` live on a backed-up volume and are
      **not** inside any statically-served directory.
- [ ] Firewall allows only 443 (and 80 for redirects); the Node port is not
      exposed publicly.
- [ ] Rate limits are left at safe defaults (auth: 15/15 min per IP).
- [ ] The server runs as an unprivileged user.
- [ ] Keep Node.js patched (`node:sqlite` is stable from Node 22.5+;
      prefer a current LTS).

## 8. Email (optional)

Without `SMTP_HOST`, every notification is stored in the `notifications`
table with status `skipped_not_configured` and is visible in the admin portal
under Security → Notifications. The application **never** marks an email as
sent unless the SMTP server accepted it. Configure `SMTP_*` and restart to
enable real delivery.

## 9. Upgrades

```bash
git pull
npm ci
npm run build
npm run migrate     # applies any new migrations
npm run seed        # idempotent — adds new defaults only
systemctl restart payment-portal
```

## 10. Can this deploy to Netlify? (serverless assessment)

**Short answer: not with the current architecture.** The frontend builds and
could be served by Netlify's static hosting, but the backend cannot run there.

### What works on Netlify

- `npm run build` produces a static `dist/` that Netlify can serve as-is
  (set the build command to `npm run build` and the publish directory to
  `dist`; SPA redirects are handled by the built-in `index.html` fallback —
  add a `netlify.toml` with `[[redirects]] from = "/*" to = "/index.html"
  status = 200` for client-side routes).

### Precise blockers

1. **Persistent Express server required.** The whole API is one long-lived
   Express process (`server/index.js`). Netlify only runs static files and
   short-lived serverless Functions — there is no way to run a persistent
   Node server.
2. **SQLite on a local filesystem.** The database is a SQLite file
   (`node:sqlite`) written to `DATABASE_PATH`. Netlify Functions have a
   read-only filesystem (except ephemeral `/tmp`), so the database would not
   persist between invocations and writes would fail.
3. **Receipt/logo storage on a local filesystem.** Uploaded receipts and the
   branding logo are written under `UPLOAD_DIR` and streamed back through an
   authenticated Express route. Serverless invocations cannot share or persist
   that directory.
4. **In-memory rate limiting.** `express-rate-limit` uses an in-memory store;
   across many isolated Function invocations it does not actually limit
   anything. A serverless deployment needs a shared store (e.g. Upstash).
5. **DB-backed sessions** would also need to move to the external database.

### Recommended path if Netlify is a hard requirement

Treat it as a real migration project (do not attempt it casually):

1. Move the API into Netlify Functions (or Netlify's Express adapter) — the
   route code is plain Express and ports over largely unchanged.
2. Replace SQLite with a network database: **Turso (libSQL)** is the closest
   drop-in for SQLite; Neon/Supabase Postgres also works (`server/db.js` is
   the only data-access layer to adapt).
3. Move receipt/logo storage to **Netlify Blobs** or S3-compatible object
   storage, and stream files through an authenticated Function.
4. Replace the in-memory rate limiter with a shared store (Upstash Redis).
5. Re-verify the full test suite against the new data layer.

### Recommended path otherwise (no code changes)

Deploy the app as-is to any VPS, container platform, or Node host — see the
systemd/nginx instructions above. This is the intended production setup: one
process, one SQLite file (WAL), one private uploads directory, all of which
Netlify's serverless model does not provide.

## 11. Scaling notes

- SQLite (WAL mode) comfortably serves a single-agency workload. If you ever
  need multiple app instances, move `DATABASE_PATH`/`UPLOAD_DIR` to shared
  storage or migrate the data layer to PostgreSQL — the route code is
  database-agnostic at the `server/db.js` wrapper level, and `DEPLOYMENT`
  keeps all money as integer cents, so a migration is a data-copy exercise.
- The frontend is fully static after `npm run build`; it can be served from
  a CDN by pointing the API base at your domain (same origin is the default
  and simplest).

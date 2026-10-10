# Deployment Guide — Payment Portal on a VPS

This guide takes you from a fresh virtual private server (VPS) to a running,
HTTPS-protected payment portal. It assumes **no prior sysadmin experience** —
every command is spelled out. The app is a single Node.js process that serves
both the API and the built frontend (`dist/`), with SQLite as the database
and a private uploads directory for receipts and branding assets.

> **TL;DR of the architecture:** one Node process (`npm start`) + one nginx
> reverse proxy + one SQLite file + one private uploads directory + systemd
> for supervision + Let's Encrypt for HTTPS. Nothing else is required.

**What you need before you start** (details in [Part C](#part-c--decisions-you-must-make)):

1. A VPS from any reputable provider (Hetzner, DigitalOcean, Vultr, Linode,
   OVH, …) running **Ubuntu 24.04 LTS**, with its IP address.
2. A domain name you control (e.g. `pay.your-agency.com`) and access to its
   DNS settings.
3. An administrator email address for the portal.
4. (Optional) an SMTP account for email notifications.

---

## Part A — Step-by-step beginner guide (Ubuntu 24.04 LTS)

Work through the steps in order. Commands are run on the VPS, in a terminal,
over SSH. Replace `pay.your-agency.com` and `203.0.113.10` with your own
domain and server IP (203.0.113.10 is the placeholder IP used in examples).

### Step 1 — Create the server

At your VPS provider's dashboard:

1. Create a new server/VM with **Ubuntu 24.04 LTS** (64-bit).
2. Pick the smallest plan that fits: **2 GB RAM / 1–2 vCPU / 40 GB SSD** is
   plenty for a single-agency portal.
3. Choose a datacenter region close to your clients.
4. Add your **SSH public key** if the provider asks (recommended), or copy the
   root password they show you — you will use it exactly once.
5. Note the server's **public IP address**.

### Step 2 — First login and firewall (do this immediately)

From your own computer, open a terminal and connect as root:

```bash
ssh root@203.0.113.10
```

Install security updates and set up the firewall so that **only SSH, HTTP and
HTTPS are reachable from the internet** — the Node app port must never be
open to the public:

```bash
apt update && apt upgrade -y
apt install -y ufw
ufw allow OpenSSH        # port 22 — your way in
ufw allow 'Nginx Full'   # ports 80 + 443 — the website (installed in step 5)
ufw enable               # answers "y" when asked
ufw status               # should list: 22, 80, 443 only
```

### Step 3 — Create a deploy user and secure SSH

Running everything as root is dangerous. Create a normal user with sudo:

```bash
adduser portal                       # set a strong password when asked
usermod -aG sudo portal
# copy root's SSH key to the new user (if you used a key):
mkdir -p /home/portal/.ssh
cp /root/.ssh/authorized_keys /home/portal/.ssh/authorized_keys 2>/dev/null || true
chown -R portal:portal /home/portal/.ssh
chmod 700 /home/portal/.ssh && chmod 600 /home/portal/.ssh/authorized_keys
```

Harden SSH (disable root login and password authentication):

```bash
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
```

Open a **second terminal** and verify you can log in as the new user before
closing the root session:

```bash
ssh portal@203.0.113.10
sudo whoami    # should print: root
```

From now on, use `ssh portal@203.0.113.10` and prefix commands with `sudo`
when needed.

### Step 4 — Install Node.js 22

The app requires **Node.js >= 22.5** (it uses the built-in `node:sqlite`
database driver). Install Node 22 from NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version    # must print v22.x.y  (22.5 or higher)
npm --version
```

(Alternative: install `nvm` and `nvm install 22` — NodeSource is simpler.)

### Step 5 — Install nginx and git

```bash
sudo apt install -y nginx git sqlite3
sudo systemctl enable --now nginx
```

`nginx` is the reverse proxy: it handles HTTPS and forwards requests to the
Node app, which will only listen on `127.0.0.1` (loopback). `sqlite3` is only
needed for backups.

### Step 6 — Get the code

```bash
sudo mkdir -p /opt/payment-portal
sudo chown portal:portal /opt/payment-portal
cd /opt/payment-portal
git clone https://github.com/aebraharm/payment-portal.git .
git checkout arena/88460e9d-payment-portal
```

(If you deploy your own fork/branch, adjust the URL and branch. Deploying
from a branch is fine; for production you may prefer to tag a release.)

### Step 7 — Install dependencies and build

```bash
npm ci                # clean install from package-lock.json
npm run build         # type-check + build the frontend into dist/
```

Good news: **no compiler toolchain is needed** — the database driver is
built into Node and the password hashing library is pure JavaScript.

Verify the build output exists:

```bash
ls dist/              # should contain index.html and assets/
```

### Step 8 — Create the data directories (persistent storage)

All state lives in two places — keep them on the server's disk and back them
up (step 15):

```bash
sudo mkdir -p /var/lib/payment-portal/uploads
sudo chown -R portal:portal /var/lib/payment-portal
```

### Step 9 — Configure the environment (`.env`)

Create the environment file — **this file contains secrets and must never be
committed to Git or shared**:

```bash
sudo -u portal nano /opt/payment-portal/.env
```

Paste this and fill in your values:

```bash
NODE_ENV=production
PORT=4000
# Production binds 127.0.0.1 by default (API reachable only via nginx).
# Leave HOST unset unless you know you need otherwise.
DATABASE_PATH=/var/lib/payment-portal/portal.db
UPLOAD_DIR=/var/lib/payment-portal/uploads
ADMIN_EMAIL=admin@your-agency.com
ADMIN_PASSWORD=<long random initial password — see step 10>
SESSION_TTL_HOURS=8
# Email (optional — see Part B):
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM="Your Agency <no-reply@your-agency.com>"
NOTIFY_ADMIN_EMAIL=admin@your-agency.com
```

Then lock it down so only the service user can read it:

```bash
sudo chown portal:portal /opt/payment-portal/.env
sudo chmod 600 /opt/payment-portal/.env
```

Verify it is **not** tracked by Git (it must never be uploaded):

```bash
cd /opt/payment-portal && git status --short .env    # must print nothing
```

### Step 10 — Secure initial administrator setup

1. Generate a long random initial password **on the server** (or in a password
   manager) — do not type a real password into a chat or a shared document:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. Put that value in `ADMIN_PASSWORD` in `.env` (step 9).
3. Initialize the database:

   ```bash
   cd /opt/payment-portal
   npm run migrate
   npm run seed     # creates the admin account, currencies, payment methods, defaults
   ```

4. **First login forces a password change.** Sign in at
   `http://203.0.113.10/admin/login` (or your domain once HTTPS is up) with
   `ADMIN_EMAIL` + the initial password, and immediately set a new, permanent
   admin password. The server blocks all other admin actions until you do.
5. The initial password in `.env` is now only a bootstrap fallback — the seed
   never resets an existing admin's password, so **you can delete
   `ADMIN_PASSWORD` from `.env` after the first login** (the seed creates the
   admin only when both `ADMIN_EMAIL` and `ADMIN_PASSWORD` are set, and skips
   admin creation otherwise; your changed password is safe). Restart the
   service after editing `.env`.
6. If the initial password ever leaks before first login, generate a new one,
   update `.env`, and delete the admin row only as a last resort (or re-seed a
   fresh database). Never share admin passwords in chat.

### Step 11 — Run the app under systemd (process supervision)

Create the service unit:

```bash
sudo nano /etc/systemd/system/payment-portal.service
```

```ini
[Unit]
Description=Payment Portal
After=network.target

[Service]
Type=simple
User=portal
Group=portal
WorkingDirectory=/opt/payment-portal
EnvironmentFile=/opt/payment-portal/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
SyslogIdentifier=payment-portal
# Light hardening (the app writes only under /var/lib/payment-portal):
NoNewPrivileges=true
ProtectSystem=full

[Install]
WantedBy=multi-user.target
```

Enable and start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payment-portal
sudo systemctl status payment-portal     # should say: active (running)
```

### Step 12 — Health checks (from the server)

```bash
curl -fsS http://127.0.0.1:4000/api/health
# -> {"status":"ok","time":"..."}

curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4000/
# -> 200  (the frontend is served)

sudo ss -tlnp | grep node
# -> node should listen on 127.0.0.1:4000 ONLY (not 0.0.0.0, not public)
```

The last check proves the backend is **not exposed** — only nginx can reach it.

### Step 13 — Point your domain at the server (you do this)

At your domain registrar / DNS host, create an **A record**:

```
pay.your-agency.com  →  203.0.113.10
```

Wait for DNS to propagate (usually minutes; check with
`dig pay.your-agency.com` or https://dnschecker.org).

### Step 14 — HTTPS with Let's Encrypt (free)

First create a plain-HTTP nginx site so certbot has something to upgrade:

```bash
sudo nano /etc/nginx/sites-available/payment-portal
```

```nginx
server {
    listen 80;
    server_name pay.your-agency.com;

    # Receipts can be up to receipt_max_size_mb (default 10 MB); allow a little more.
    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/payment-portal /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Now get a free TLS certificate (certbot edits the config to add HTTPS and an
HTTP→HTTPS redirect):

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pay.your-agency.com
# follow the prompts; choose "redirect HTTP to HTTPS" when asked
sudo systemctl reload nginx
```

Certificates renew automatically via a systemd timer
(`sudo systemctl status certbot.timer`).

**Proxy trust note:** the app is configured for **exactly one proxy hop**
(`TRUST_PROXY=1`, the default) — nginx directly in front of it. If you later
add Cloudflare (or another CDN) in front of nginx, set `TRUST_PROXY=2` in
`.env` and restart, otherwise rate limiting will key on the CDN's IPs.

### Step 15 — Verify from the outside

From your own computer:

```bash
curl -fsS https://pay.your-agency.com/api/health
# -> {"status":"ok",...}

curl -fsS -o /dev/null -w '%{http_code}\n' https://pay.your-agency.com/
# -> 200
```

Then open `https://pay.your-agency.com/admin/login` in a browser and sign in
with your new admin password. Configure branding, currencies, bank
instructions and Western Union under **Admin → Payment settings** before
creating clients.

Also verify the security headers:

```bash
curl -sI https://pay.your-agency.com/ | grep -iE 'strict-transport|x-frame|x-content|content-security'
```

### Step 16 — Backups and restore testing

Two locations hold all state — back up **both, together**:

| Path | What it is |
| --- | --- |
| `/var/lib/payment-portal/portal.db` (+ `-wal`, `-shm`) | SQLite database: clients, invoices, payments, sessions, audit logs |
| `/var/lib/payment-portal/uploads/` | Uploaded receipts and the branding logo |

**Manual backup** (WAL mode makes an online SQLite backup safe):

```bash
sudo mkdir -p /backups
sudo sqlite3 /var/lib/payment-portal/portal.db ".backup '/backups/portal-$(date +%F).db'"
sudo tar -czf /backups/uploads-$(date +%F).tar.gz -C /var/lib/payment-portal uploads
sudo chown -R portal:portal /backups
```

**Automate it** — a daily systemd timer (or cron). Create
`/etc/systemd/system/payment-portal-backup.service`:

```ini
[Unit]
Description=Payment Portal backup

[Service]
Type=oneshot
User=root
ExecStart=/bin/bash -c "sqlite3 /var/lib/payment-portal/portal.db \".backup '/backups/portal-$(date +%%F).db'\" && tar -czf /backups/uploads-$(date +%%F).tar.gz -C /var/lib/payment-portal uploads"
```

and `/etc/systemd/system/payment-portal-backup.timer`:

```ini
[Unit]
Description=Daily Payment Portal backup

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now payment-portal-backup.timer
sudo systemctl list-timers payment-portal-backup.timer
```

Keep backups somewhere off-server too (your VPS provider's snapshots, or
`rclone`/`rsync` to another host/S3). Delete backups older than 30 days.

**Restore procedure**:

```bash
sudo systemctl stop payment-portal
sudo cp /backups/portal-YYYY-MM-DD.db /var/lib/payment-portal/portal.db
sudo rm -rf /var/lib/payment-portal/uploads
sudo tar -xzf /backups/uploads-YYYY-MM-DD.tar.gz -C /var/lib/payment-portal
sudo chown -R portal:portal /var/lib/payment-portal
sudo systemctl start payment-portal
```

**Test your restore before you need it.** Restore a backup into a scratch
location and boot a throwaway instance against it (nothing is overwritten):

```bash
sudo mkdir -p /tmp/restore-test/uploads
sudo cp /backups/portal-YYYY-MM-DD.db /tmp/restore-test/portal.db
sudo tar -xzf /backups/uploads-YYYY-MM-DD.tar.gz -C /tmp/restore-test
sudo chown -R portal:portal /tmp/restore-test
cd /opt/payment-portal
sudo -u portal env NODE_ENV=production PORT=4100 \
  DATABASE_PATH=/tmp/restore-test/portal.db \
  UPLOAD_DIR=/tmp/restore-test/uploads \
  node server/index.js &
sleep 3
curl -fsS http://127.0.0.1:4100/api/health    # {"status":"ok",...}
# Log in at http://127.0.0.1:4100/admin/login with your admin credentials and
# confirm clients, invoices and a receipt are present.
sudo pkill -f 'PORT=4100' 2>/dev/null; kill %1 2>/dev/null
sudo rm -rf /tmp/restore-test
```

Do this once after your first backup. If it works, your backups are real.

### Step 17 — Logging

The app logs to stdout; systemd captures it:

```bash
sudo journalctl -u payment-portal -f              # follow live
sudo journalctl -u payment-portal --since today   # today's logs
sudo journalctl -u payment-portal -n 100          # last 100 lines
sudo journalctl --vacuum-time=30d                 # keep 30 days of logs
```

nginx access/error logs: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`.

The app never logs passwords, access codes, session tokens or receipt
contents; audit events (logins, reviews, settings changes) are in the
**Admin → Security → Audit log** page and in the `audit_logs` table.

### Step 18 — Updates and upgrades

When a new version is available:

```bash
cd /opt/payment-portal
sudo systemctl stop payment-portal            # or: backup first (step 16)
git pull
npm ci
npm run build
npm run migrate     # applies new migrations (safe to re-run)
npm run seed        # adds new defaults only; never resets passwords
sudo systemctl start payment-portal
sudo systemctl status payment-portal
```

Always back up before updating, and check `journalctl -u payment-portal` after
restarting. Test in a staging copy first if the update is significant.

### Step 19 — Troubleshooting

| Symptom | Check |
| --- | --- |
| Service won't start | `sudo journalctl -u payment-portal -n 50` — usually a `.env` typo or permissions on `/var/lib/payment-portal` |
| 502 from nginx | `sudo systemctl status payment-portal`; `curl http://127.0.0.1:4000/api/health` |
| Can't reach the site | `sudo ufw status`; `sudo ss -tlnp`; DNS: `dig pay.your-agency.com` |
| Login says "must change password" | Expected on first login — set a new password at `/admin/change-password` |
| Receipt upload rejected | File must be PDF/JPEG/PNG, under `receipt_max_size_mb` (default 10 MB), and nginx `client_max_body_size` must exceed it |
| Emails not sending | Admin → Security → Notifications shows `failed`/`skipped_not_configured`; check SMTP credentials and firewall port 587/465 outbound |
| SQLite "database is locked" | Only one writer at a time is normal for SQLite; the app serializes writes — if you run external tools, stop the app first |

---

## Part B — Reference

### Environment variables (complete)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | `development` | `production` enables Secure cookies and production behavior |
| `PORT` | no | `4000` | Port the Node server listens on |
| `HOST` | no | `127.0.0.1` in production, `0.0.0.0` in dev | Bind address. Keep loopback in production (API via nginx only) |
| `TRUST_PROXY` | no | `1` | Reverse-proxy hops in front of the app (1 = nginx; 2 = CDN + nginx) |
| `DATABASE_PATH` | no | `server/data/portal.db` | SQLite database file |
| `UPLOAD_DIR` | no | `server/uploads` | Private receipt/logo storage (never statically served) |
| `ADMIN_EMAIL` | first run | `admin@example.com` | Bootstrap admin email (created once; required together with `ADMIN_PASSWORD` — no built-in default) |
| `ADMIN_PASSWORD` | first run | — (unset = no admin created) | Bootstrap admin initial password; change forced on first login. Remove after first login |
| `SESSION_TTL_HOURS` | no | `8` | Session lifetime |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | no | — | Email delivery (see below) |
| `NOTIFY_ADMIN_EMAIL` | no | — | Where admin alerts (new submissions, reset requests) go |
| `RATE_LIMIT_AUTH_MAX` / `RATE_LIMIT_AUTH_WINDOW_MS` | no | `15` / 15 min | Login rate limit per IP |
| `RATE_LIMIT_GENERAL_MAX` / `RATE_LIMIT_GENERAL_WINDOW_MS` | no | `600` / 1 min | General API rate limit per IP |
| `BRAND_PRIMARY_COLOR` / `BRAND_SECONDARY_COLOR` | no | `#2563eb` / `#0b2447` | Branding fallbacks (editable in Admin → Settings) |
| `DB_DRIVER` | no | `sqlite`; auto-`libsql` when `TURSO_DATABASE_URL` is set | Data-layer driver |
| `TURSO_DATABASE_URL` / `TURSO_DATABASE_TOKEN` | hosted DB | — | libSQL/Turso connection (aliases `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`); both required together |
| `DB_TIMEOUT_MS` | no | `15000` | Ceiling per operation, so a slow network fails a request instead of hanging it |
| `STORAGE_DRIVER` | no | `fs`; auto-`s3` when `S3_BUCKET` is set | Receipt/logo backend |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` / `S3_PREFIX` | object store | — / — / — / `false` / `payment-portal` | Private bucket coordinates; endpoint+path style only for S3-compatible hosts |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | object store | — | Bucket credentials (aliases `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) |
| `S3_SERVER_SIDE_ENCRYPTION` | no | `false` | Send `ServerSideEncryption: AES256` on writes; R2/B2/MinIO reject it, AWS encrypts regardless |
| `RATE_LIMIT_STORE` | no | `memory`; `db` when serverless or libsql | Where rate-limit counters live |

Sessions are random 256-bit tokens stored only as SHA-256 hashes in the
database — no session secret is needed.

### Email configuration (secure)

Email is **optional**. Without `SMTP_HOST`, every notification is stored in
the `notifications` table with status `skipped_not_configured` and is visible
under **Admin → Security → Notifications** — the app never pretends an email
was sent.

To enable real delivery, use a reputable transactional/SMTP provider and an
**app-specific password** (never your main account password):

| Provider | `SMTP_HOST` | `SMTP_PORT` | `SMTP_SECURE` | Notes |
| --- | --- | --- | --- | --- |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | `false` | Requires an "App password" (2-Step Verification on) |
| Microsoft 365 | `smtp.office365.com` | 587 | `false` | App password or OAuth; may need SMTP AUTH enabled |
| Amazon SES | `email-smtp.<region>.amazonaws.com` | 587 | `false` | Create SMTP credentials in the SES console |
| Mailgun | `smtp.mailgun.org` | 587 | `false` | Use the SMTP credentials from the Mailgun dashboard |
| Brevo | `smtp-relay.brevo.com` | 587 | `false` | SMTP key from the Brevo dashboard |

Any provider also works on port 465 with `SMTP_SECURE=true` (implicit TLS).
Prefer 587 + STARTTLS. Keep `SMTP_PASSWORD` only in `.env` (chmod 600) —
never in Git, never in a ticket.

For reliable delivery from your own domain, also configure DNS (ask your
provider for the exact records):

- **SPF** — a TXT record authorizing the provider's servers to send for your domain.
- **DKIM** — a TXT/CNAME record with the provider's public key (the provider signs outgoing mail).
- **DMARC** — a TXT record (`_dmarc`) telling receivers what to do with unsigned mail (start with `p=none` and monitor).

Then test: submit a payment confirmation as a client (or request an
access-code reset) and watch **Admin → Security → Notifications** — the status
should become `sent` (green). If it says `failed`, the error message is stored
with the notification.

### Security checklist

- [ ] `.env` is on the server only, `chmod 600`, owned by the service user, and never committed (`git status` clean).
- [ ] `ADMIN_PASSWORD` was a long random value; changed on first login; removed from `.env` afterwards.
- [ ] TLS is enabled (Let's Encrypt); `NODE_ENV=production` is set.
- [ ] The firewall allows only 22, 80, 443 (`ufw status`); `ss -tlnp` shows Node on `127.0.0.1:4000` only.
- [ ] SSH: key-only authentication, root login disabled.
- [ ] `DATABASE_PATH` and `UPLOAD_DIR` live under `/var/lib/payment-portal`, are backed up, and are **not** inside any statically-served directory.
- [ ] Rate limits left at safe defaults (auth: 15 / 15 min per IP).
- [ ] The service runs as the unprivileged `portal` user.
- [ ] `TRUST_PROXY` matches the real proxy topology (1 = nginx only; 2 = CDN + nginx).
- [ ] Backups run daily and a **restore test** has been performed successfully.
- [ ] Keep the OS and Node.js patched (`apt upgrade`; Node 22 LTS or newer).

### Scaling notes

- SQLite (WAL mode) comfortably serves a single-agency workload. For multiple
  app instances, move `DATABASE_PATH`/`UPLOAD_DIR` to shared storage or
  migrate the data layer to PostgreSQL — `server/db.js` is the only
  data-access layer to adapt, and all money is stored as integer cents, so a
  migration is a data-copy exercise.
- The frontend is fully static after `npm run build`; it can be served from
  a CDN by pointing the API base at your domain (same origin is the default
  and simplest).

### Can this deploy to Netlify?

**Yes — the backend runs there now.** The React app is served statically, and
the JSON API runs as a Netlify Function (`netlify/functions/api.js`) hosting the
*same* Express app as Part A: same routes, same middleware, same session,
rate-limit, audit and upload checks — no parallel implementation to drift.

Two managed services are required, because a serverless invocation has no disk
that outlives a request: a **hosted libSQL/Turso database** and a **private
S3-compatible bucket** for receipts. Part D is the step-by-step version of that
(services, environment variables, migrations, backups, deploy, verification).

Part A stays the recommended default for a single agency: one process, one
SQLite file, one private directory, no per-request billing, and no third-party
dependency for the data. The choice is configuration, not code.

What is already in place for either host:

- `npm run build` produces the static `dist/`; `netlify.toml` sets
  `command = "npm run build"`, `publish = "dist"` and the
  `[[redirects]] from = "/*" to = "/index.html" status = 200` rule that
  client-side routes need (next section).
- The security headers the Express app sets are mirrored for the static app, so
  a Netlify-served frontend is not less strict than the VPS one.

#### Single-page routing (what the `/*` rule is for)

The React app routes in the browser (`src/routes.tsx`); the server only ever
owns `index.html`. Without a fallback, a **direct visit or a refresh** on any
deep link — `/admin/login`, `/admin/clients/12`, `/pay/7/submit` — asks the host
for a file that does not exist and returns 404 instead of the app.

- **Netlify:** `netlify.toml` rewrites unknown paths to `/index.html` with status
  200 (a rewrite, not a 301, so the URL — and therefore the route — survives).
- **VPS:** the same behaviour is provided by `createSpaMiddleware()` in
  `server/lib/spa.js`, mounted after the API routes in `server/app.js`, and real
  files under `dist/` (hashed assets) are still served directly.
- **`/api/*` always wins:** any API rule must be placed *before* the catch-all,
  and the Express fallback passes `/api/*` back to the API stack. Otherwise a
  miss on an endpoint returns HTML from `index.html` instead of a JSON 404,
  which is a debugging nightmare and can confuse clients that parse JSON.
- Both invariants are covered by tests: `tests/deploy/netlifyConfig.test.ts`
  (parses `netlify.toml`, asserts the fallback is 200 and is the *last* rule) and
  `tests/backend/spaFallback.test.ts` (deep link, refresh, assets, `/api/*`).
- In development, Vite's own SPA fallback does this (`npm run dev`).

#### What the previous version of this document listed as blockers

Those five items were accurate then; this is what replaced each of them.

| Blocker (as previously documented) | What the code does now |
| --- | --- |
| Long-lived Express process required | `server/lib/serverlessAdapter.js` converts a Netlify fetch event into the API-Gateway-shaped event `serverless-http` feeds to `createApp()`; `netlify/functions/api.js` is a four-line shim. `server/index.js` (VPS) is untouched. |
| SQLite on a local filesystem | `server/db.js` is a driver facade: `node:sqlite` for a file, `@libsql/client` for a hosted database. Same SQL, same transactions, selected by config (`DB_DRIVER`, auto-`libsql` when `TURSO_DATABASE_URL` exists). |
| Receipt/logo storage on local disk | `server/lib/storage.js` has `fs` and `s3` drivers behind one async API; uploads and downloads go through the same authenticated route on both. |
| In-memory rate limiting | `RATE_LIMIT_STORE=db` puts windows in `rate_limit_buckets` (`server/migrations/002_serverless_support.sql`), so counters are shared by every invocation and survive cold starts. The store is chosen per request, not at import time. |
| DB-backed sessions | Already portable — sessions live in the `sessions` table as SHA-256 hashes, so they moved with the database and needed no change. |

Making the data layer asynchronous was the real work: `node:sqlite` is sync and
a network database is not, so every `get`/`all`/`run`/`tx` call site in the
routes is now awaited. That is why `tests/backend/transactions.test.ts` pins
rollback, nested transactions, context isolation and concurrent sequence
allocation explicitly — an un-awaited `tx()` is the new way to lose money
records.

Full setup: **Part D** below.
---

## Part C — Decisions you must make (checklist for the owner)

Before starting, decide and write down:

1. **Hosting provider & plan** — any reputable VPS (Hetzner, DigitalOcean,
   Vultr, Linode, OVH…); 2 GB RAM / 1–2 vCPU / 40 GB SSD, Ubuntu 24.04 LTS.
   If you would rather use Netlify (Part D), the decisions multiply: a paid
   Netlify plan, a Turso (or other libSQL) instance, and a private bucket with
   versioning — three vendors and three bills for the same portal.
2. **Domain / subdomain** — e.g. `pay.your-agency.com`, and **who controls
   its DNS** (you need to create one A record in Step 13).
3. **Administrator setup** — the admin email address; how you will generate
   and store the initial password (password manager); who performs the first
   login and password change.
4. **Email** — whether to enable SMTP at launch (and which provider), or run
   without email initially (notifications are stored in the portal either way).
5. **Backups** — where off-server backups go (provider snapshots, another
   host, S3-compatible storage) and who checks the restore test.
6. **Update window** — when you will apply OS/app updates.

Everything else (firewall, Node, nginx, TLS, systemd, health checks) is
covered step-by-step in Part A and needs no decisions.

---

## Part D — Netlify (serverless) deployment

This is the alternative to Part A, not an addition to it: the same repository,
the same Express app, the same routes and security checks. What changes is where
the two things that must outlive a request live — the database and the uploaded
receipts.

**Do not treat this as a way to avoid a VPS for free.** Netlify's free tier is
not appropriate for a system holding client payment evidence: you need a paid
site plan (password protection and function support), a hosted database and a
bucket. If you already pay for a VPS, Part A is simpler and cheaper.

### D.1 — What runs where

```
browser
  ├─ /            → Netlify CDN  → dist/index.html  (Vite build, static)
  ├─ /assets/*    → Netlify CDN  → hashed JS/CSS
  └─ /api/*       → netlify.toml redirect → /.netlify/functions/api/:splat
                       → netlify/functions/api.js          (4 lines)
                       → server/lib/serverlessAdapter.js   (fetch ⇄ API Gateway event)
                       → serverless-http                   (drives Express)
                       → server/app.js                     (the SAME app as Part A)
                             ├─ server/db.js ────────────→ Turso / libSQL  (hosted)
                             └─ server/lib/storage.js ───→ private S3 bucket
```

Ordering is the whole trick: the `/api/*` rule sits **above** the `/*` SPA
fallback in `netlify.toml`, because Netlify applies the first match. If it were
below, every API call would return `index.html` with status 200 and the app would
fail in a way that looks like a broken login form. `tests/deploy/netlifyConfig.test.ts`
enforces the order, and the adapter also strips the `/.netlify/functions/api`
prefix itself, so both the rewritten and the public form of the path work.

The function uses `node_bundler = "nft"` (trace-and-copy) rather than esbuild
bundling, for two reasons that only appear in production: this project is ESM
while `express` → `body-parser` → `depd` are CommonJS, and an esbuild ESM bundle
turns their `require('path')` into `Dynamic require of "path" is not supported`
on the first cold start; and `@libsql/client` / `@aws-sdk/client-s3` resolve
platform-specific optional bindings at require-time, which a single-file bundle
cannot reproduce. Because the migrations are read from disk at runtime they are
not part of the import graph, so `included_files = ["/server/migrations/*.sql"]`
is mandatory — without it the function deploys cleanly and then answers every
request with `no such table`.

### D.2 — Services you must create first

1. **Turso (libSQL) database** — `turso db create payment-portal`, then
   `turso db show payment-portal --url` and
   `turso db tokens create payment-portal`. The URL looks like
   `libsql://payment-portal-<org>.turso.io`. Anything that speaks the libSQL
   protocol works; the app only needs the URL + auth token.
2. **A private S3-compatible bucket** — Cloudflare R2, Backblaze B2,
   DigitalOcean Spaces or AWS S3. Requirements, in order of importance:
   - **block public access** at the bucket level (no public policy, no CDN
     origin for this bucket). Receipts contain client bank-transfer evidence.
   - versioning on (see D.7).
   - one bucket per environment is cheaper to reason about than shared prefixes.
   The app never generates a public object URL, never sets an ACL, and never
   presigns: `GET /api/files/receipts/:id` is the only way a stored byte is
   reachable, and it checks ownership before streaming. Object keys are
   `S3_PREFIX/receipts/<YYYY>/<MM>/<32-hex>.png`.
3. **Netlify site** connected to the branch you want to deploy, with the build
   settings below. Add your SMTP credentials only if you want email (D.5).

### D.3 — Build settings and environment variables

Netlify reads `netlify.toml`: `command = "npm run build"`, `publish = "dist"`,
`[functions] directory = "netlify/functions"`, `NODE_VERSION = "22"`.

Set these in **Site configuration → Environment variables** (never in
`netlify.toml`, never committed):

| Variable | Value on Netlify | Notes |
| --- | --- | --- |
| `NODE_ENV` | `production` | Secure (`https`) cookies, `SameSite=strict` |
| `TURSO_DATABASE_URL` | your `libsql://…` URL | Selecting it also selects `DB_DRIVER=libsql` automatically |
| `TURSO_DATABASE_TOKEN` | the auth token | Required; there is no fallback |
| `S3_BUCKET` | bucket name | Selecting it also selects `STORAGE_DRIVER=s3` automatically |
| `S3_REGION` | e.g. `auto` (R2), `us-east-005` (B2) | Real AWS S3 uses your region |
| `S3_ENDPOINT` | provider endpoint | Omit **only** for real AWS S3 |
| `S3_FORCE_PATH_STYLE` | `true` for R2/B2/Spaces/MinIO | `false`/unset for AWS S3 |
| `S3_PREFIX` | `payment-portal` (default) | Keeps one bucket usable by several apps |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | bucket credentials | `AWS_*` names are also accepted |
| `RATE_LIMIT_STORE` | `db` (default on serverless) | Shared windows across invocations |
| `SMTP_*`, `NOTIFY_ADMIN_EMAIL` | optional | Same semantics as Part A |
| `DB_TIMEOUT_MS` | `15000` (default) | Keeps a slow database from burning the function timeout |

`SESSION_TTL_HOURS`, `RATE_LIMIT_*` and `BRAND_*` behave exactly as in Part B.
`DATABASE_PATH` and `UPLOAD_DIR` are irrelevant here — there is no persistent
disk to point them at.

**The app refuses to boot with a losing combination.** `assertProductionConfig()`
(`server/config.js`) runs before the first request and exits with all problems at
once, instead of accepting uploads to a disk that will vanish:

- `Serverless hosts have no persistent disk: set STORAGE_DRIVER=s3 with a private bucket`
- `Serverless hosts have no persistent disk: set DB_DRIVER=libsql with a hosted database`
- `Serverless needs a shared rate-limit store: set RATE_LIMIT_STORE=db`
- `DB_DRIVER=libsql requires TURSO_DATABASE_URL` / `…TURSO_DATABASE_TOKEN`
- `STORAGE_DRIVER=s3 requires S3_BUCKET` / `…S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY`

Netlify also sets `NETLIFY=true` in the *build* environment, which is harmless:
the guard runs per request in the function, not during `npm run build`.

### D.4 — Migrations

Migrations are forward-only `.sql` files in `server/migrations/`, applied in
filename order and recorded in `schema_migrations`. On Netlify, `ensureMigrated()`
runs once per cold start (memoized), so the first request after a deploy pays one
extra round trip and every later request pays nothing.

- Apply them yourself (recommended before/at deploy, and required for the VPS):
  `npm run migrate` with the same env vars the app uses. On a fresh hosted
  database it applies `001_init.sql` then `002_serverless_support.sql`.
- Add a new one as `003_<something>.sql`. Never edit a file that has already been
  applied anywhere — checksums aside, the point is that two environments with
  different history stay comparable. `npm run migrate` is safe to run
  repeatedly.
- Seed/first administrator: there is **no built-in admin credential**, so on
  Netlify you create the first admin from your own machine against the hosted
  database:

  ```bash
  DATABASE_PATH=unused NODE_ENV=production \
  TURSO_DATABASE_URL=libsql://… TURSO_DATABASE_TOKEN=… \
  ADMIN_EMAIL=you@agency.example ADMIN_PASSWORD='a-long-one-off-passphrase' \
    npm run seed
  ```

  `npm run seed` is idempotent: it will not touch an existing administrator. The
  account is flagged to change its password on first login. Clear
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` from the environment afterwards.

### D.5 — Email, reminders and scheduled work

SMTP works the same way as in Part B (it is a network call, no local state). If
it is not configured, notifications are stored in the `notifications` table and
labelled `skipped_not_configured` — nothing is ever reported as sent that was
not.

The application itself runs no scheduler: nothing in the repo relies on a
long-lived process ticking. If you add scheduled work (statement reminders,
nightly reconciliation), use Netlify Cron Functions (a `netlify/cron.yml` plus a
function) rather than assuming a background loop exists — on the VPS path the
equivalent is the systemd timer described in Part A.

### D.6 — Deploy and verify

```bash
# 1. install, then check the app end to end locally first
npm ci
npm run deploy:check          # typecheck + lint + tests + build

# 2. deploy (or push the branch, if the site is connected to git)
npx netlify-cli deploy --prod

# 3. verify — these are the four things that actually break
SITE=https://pay.agency.example
curl -s $SITE/api/health                                   # {"status":"ok",…}
curl -s -o /dev/null -w '%{http_code}\n' $SITE/admin/login  # 200 (SPA fallback)
curl -s $SITE/api/nope                                     # JSON 404, NOT index.html
curl -s -i -X POST $SITE/api/admin/auth/login \
  -H 'content-type: application/json' -H "origin: $SITE" \
  -d '{"email":"nope@example.com","password":"wrong"}' | head -1   # 401 + Set-Cookie
```

Then, in a browser: sign in, create a client, issue an invoice, log in as that
client with the one-time access code, submit a receipt, confirm the object
appears in the bucket and **nowhere public**, verify the payment as admin, and
check the invoice became `paid`. Finally sign out, and confirm a stale session
cookie is refused.

Log inspection: `npx netlify-cli logs:function --function api`, or the Functions
log stream in the UI. Cold starts and every error land there.

### D.7 — Backups (and the fact that there are now two stores)

A payment portal has a rule that the VPS path made implicit: **the database and
the bucket must be backed up together.** A `receipts` row is only a pointer —
restore one without the other and either the file has no owner or the row points
at a missing object (the download route then answers 404 for a payment that
really happened).

- **Turso**: `turso db backup payment-portal ./backup-$(date +%F).sqlite` on a
  schedule (cron on your laptop, a GH Action, or your server). Keep a replica in
  a second region for availability: `turso db replica create`. Restoring is
  `turso db create payment-portal-restored -f ./backup.sqlite` (or a snapshot
  restore from the dashboard), then repoint `TURSO_DATABASE_URL`.
- **Bucket**: enable **versioning** (deletes and overwrites become recoverable),
  plus object lock/retention if you need WORM behaviour, and
  cross-region replication or a scheduled `aws s3 sync`/`r2 clone` to a second
  account. Test a restore by downloading a receipt into an empty bucket and
  reading it through the app.
- **Cadence**: daily database dumps, retained ≥ 30 days, plus one monthly copy
  kept off-account. Verify a restore quarterly — an untested backup is a
  rumour.
- **Secrets**: rotate the Turso token and bucket keys on the same schedule you
  use for admin passwords; they are in Netlify's environment, so rotation is a
  one-line edit and a redeploy.

### D.8 — Limits worth knowing before you commit

- Netlify Functions time out at ~10 s on the paid plan. The database and bucket
  are network calls, so `DB_TIMEOUT_MS` (15 s default) is *above* that; the
  practical ceiling is the host's. Keep `S3_ENDPOINT`/`S3_REGION` pointing at a
  region near the function's (`us-east-1` is a safe default pairing).
- Uploads are clamped to **5 MB** when the app runs serverless
  (`SERVERLESS_MAX_UPLOAD_BYTES` in `server/routes/client/portal.js`), because
  the whole file passes through the function's memory in one base64 body. The
  admin setting `receipt_max_size_mb` still applies and is honoured *within* that
  clamp. On the VPS there is no clamp: `fs` streams the file to disk.
- Receipt downloads are streamed from the object store per request. There is no
  CDN cache for them by design (`Cache-Control: private, no-store`) — a cached
  receipt would be a data leak.
- Every cold start pays the migration check. It is one `SELECT` when the
  database is already migrated, so it is negligible; keep `schema_migrations`
  rows intact and do not add per-request migration calls.
- Netlify does not support outbound SMTP on some plans (port 25 / 587 may be
  blocked). If email is a requirement, test it on the plan you intend to pay
  for, or send via an HTTPS API (Postmark/SES/Resend) instead of SMTP.

### D.9 — Switching back to the VPS path

Nothing is Netlify-specific in the code. To move back: create the SQLite
database, run `npm run migrate` against it, restore the Turso dump into it, copy
the bucket objects into `UPLOAD_DIR` preserving the
`receipts/<YYYY>/<MM>/<name>` layout, unset the `TURSO_*`/`S3_*` variables, and
follow Part A from Step 8. Sessions, audit history and payment records come with
the database dump.

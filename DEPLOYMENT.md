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

### Can this deploy to Netlify? (serverless assessment)

**Short answer: not with the current architecture.** The frontend builds and
could be served by Netlify's static hosting, but the backend cannot run there.

#### What works on Netlify

- `npm run build` produces a static `dist/` that Netlify can serve as-is
  (set the build command to `npm run build` and the publish directory to
  `dist`; add a `netlify.toml` with
  `[[redirects]] from = "/*" to = "/index.html" status = 200` for
  client-side routes).

#### Precise blockers

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

#### Recommended path if Netlify is a hard requirement

Treat it as a real migration project (do not attempt it casually):

1. Move the API into Netlify Functions — the route code is plain Express and
   ports over largely unchanged.
2. Replace SQLite with a network database: **Turso (libSQL)** is the closest
   drop-in for SQLite; Neon/Supabase Postgres also works.
3. Move receipt/logo storage to **Netlify Blobs** or S3-compatible object
   storage, and stream files through an authenticated Function.
4. Replace the in-memory rate limiter with a shared store (Upstash Redis).
5. Re-verify the full test suite against the new data layer.

#### Recommended path otherwise (no code changes)

Deploy the app as-is to any VPS, container platform, or Node host — see Part
A above. This is the intended production setup: one process, one SQLite file
(WAL), one private uploads directory, all of which Netlify's serverless model
does not provide.

---

## Part C — Decisions you must make (checklist for the owner)

Before starting, decide and write down:

1. **Hosting provider & plan** — any reputable VPS (Hetzner, DigitalOcean,
   Vultr, Linode, OVH…); 2 GB RAM / 1–2 vCPU / 40 GB SSD, Ubuntu 24.04 LTS.
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

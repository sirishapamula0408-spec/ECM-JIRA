# Production deployment — ECM JIRA Clone

Two deploy paths live in this repo:

| Script | Model | Use |
|--------|-------|-----|
| `deploy.sh` | Vite **dev** server on `:5173`, `/api` proxied to `:4000` | quick demo box |
| `deploy.prod.sh` | **nginx** serves built `dist/`; **PM2** runs the API (+ `/ws`) | real deployment |

This guide covers the **production** path. Do the one-time setup once; after
that every release is a single `./deploy.prod.sh`.

## Architecture

```
        :80/:443                    127.0.0.1:4000
 browser ─────► nginx ─┬─ /            → dist/ (SPA, try_files → index.html)
                       ├─ /assets/     → dist/assets (immutable cache)
                       ├─ /api/*       → Express API   (proxy_buffering off → SSE)
                       └─ /ws          → Express API   (WebSocket upgrade, JL-136)
                                          │
                                          └─ PM2: jira-lite-api (single fork)
                                                   │
                                                   └─ PostgreSQL (:5432)
```

The frontend calls the API with **relative `/api` paths**, so everything is
same-origin behind nginx — no CORS, no `VITE_` base URL needed.

## One-time server setup

Run these on the server (Ubuntu/Debian shown; adapt for your distro).

### 1. Prerequisites

```bash
# Node 20+ and npm (nodesource or your distro), then:
sudo npm install -g pm2
sudo apt-get install -y nginx rsync
# PostgreSQL: either Docker (recommended) or a local install
sudo apt-get install -y docker.io docker-compose-plugin   # if using Docker
```

### 2. Clone the repo

```bash
sudo mkdir -p /var/www && cd /var/www
git clone https://github.com/sirishapamula0408-spec/ECM-JIRA.git ecm-jira
cd ecm-jira
```

### 3. Environment

Create `.env` (copy from `.env.example`) and set at minimum:

```ini
NODE_ENV=production
PORT=4000
DATABASE_URL=postgresql://jira_lite:jira_lite_dev@localhost:5432/jira_lite
JWT_SECRET=<64-hex-chars>        # deploy.prod.sh generates one if missing
JWT_EXPIRES_IN=7d
APP_URL=http://20.219.248.167    # your public origin (used in emails/links)
# SMTP_* and OAuth creds are optional
```

The app **hard-fails on boot without `JWT_SECRET`** (JL-90); the deploy
script will generate one if it's absent.

### 4. Database

```bash
docker compose up -d           # brings up postgres:16 as the jira_lite owner
# or point DATABASE_URL at an existing PostgreSQL 16 instance
```

### 5. nginx

The bundled config serves `dist/` from `/var/www/ecm-jira/dist`. If your repo
lives elsewhere, either edit `root` in the conf **or** set `WEB_ROOT` when
deploying (the script rsyncs `dist/` there).

```bash
sudo cp deploy/nginx/jira-lite.conf /etc/nginx/sites-available/jira-lite
sudo ln -sf /etc/nginx/sites-available/jira-lite /etc/nginx/sites-enabled/jira-lite
sudo rm -f /etc/nginx/sites-enabled/default        # remove the default site if present
sudo nginx -t && sudo systemctl reload nginx
```

Edit `server_name` (and add TLS — see below) to match your domain/IP.

### 6. PM2 boot persistence

```bash
pm2 startup systemd -u "$USER" --hp "$HOME"   # prints a command — run it with sudo
# (deploy.prod.sh runs `pm2 save` after each deploy so the process list survives reboot)
```

### Alternative: systemd instead of PM2

If you'd rather not run PM2, a systemd unit is provided at
`deploy/systemd/jira-lite-api.service`. It runs the API as a single process
with `Restart=always`, logs to the journal, and starts on boot — no PM2
needed. Pick **one** process manager; don't run both against the same port.

```bash
# 1. Edit User / Group / WorkingDirectory / ExecStart (absolute node path) in
#    the unit to match your box (`which node` gives the ExecStart path).
sudo cp deploy/systemd/jira-lite-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jira-lite-api     # start + enable on boot
systemctl status jira-lite-api
journalctl -u jira-lite-api -f                # tail logs
```

Then deploy with the systemd path (it runs `systemctl restart` instead of
`pm2 startOrReload`):

```bash
PROCESS_MANAGER=systemd ./deploy.prod.sh
```

`PROCESS_MANAGER` defaults to `pm2`. Override the unit name with
`SYSTEMD_UNIT=<name>` if you renamed the service.

## Deploying a release

```bash
cd /var/www/ecm-jira
git pull origin main        # first time, to fetch deploy.prod.sh itself
./deploy.prod.sh
```

It fast-forwards to `origin/main`, installs deps (only on lockfile change),
ensures `.env`/DB, **builds `dist/`**, publishes it (if `WEB_ROOT` is set),
reloads the API under PM2, reloads nginx, and polls `/api/health` before
declaring success.

Handy overrides:

```bash
WEB_ROOT=/var/www/ecm-jira/dist ./deploy.prod.sh   # explicit web root
RELOAD_NGINX=0 ./deploy.prod.sh                     # skip nginx reload
SKIP_DB=1 ./deploy.prod.sh                          # DB managed elsewhere
FORCE_INSTALL=1 ./deploy.prod.sh                    # force npm ci
PROCESS_MANAGER=systemd ./deploy.prod.sh            # use systemd instead of PM2
```

## TLS (recommended)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot rewrites the nginx site to listen on `:443` and redirect `:80`. The
`/ws` block already upgrades to `wss://` automatically because the client
picks `wss:` when the page is served over HTTPS.

## Operating it

```bash
# PM2
pm2 status                     # process state
pm2 logs jira-lite-api         # tail API logs
pm2 restart jira-lite-api      # manual restart

# systemd (if you chose that instead of PM2)
systemctl status jira-lite-api
journalctl -u jira-lite-api -f            # tail API logs
sudo systemctl restart jira-lite-api      # manual restart

sudo systemctl reload nginx    # after editing the nginx conf
curl -s localhost:4000/api/health   # -> {"status":"ok"}
```

## Rollback

```bash
git checkout <previous-good-sha>
BRANCH=$(git rev-parse --abbrev-ref HEAD) ./deploy.prod.sh   # or reset a branch to the old sha
```

## Automated deploys (GitHub Actions)

`.github/workflows/deploy.yml` auto-deploys on every green push to `main`. It
fires **after** the `CI` workflow (lint/test/build) finishes **successfully**
on `main` — so only green commits reach the server — then SSHes in and runs
`deploy.prod.sh`. You can also trigger it manually from the **Actions** tab
(**Deploy → Run workflow**), which skips the CI gate.

### One-time setup

1. **Generate a deploy key** on your machine (no passphrase):

   ```bash
   ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
   ```

2. **Authorize the public half** on the server:

   ```bash
   ssh-copy-id -i deploy_key.pub <user>@<host>
   # or append deploy_key.pub to ~/.ssh/authorized_keys on the server
   ```

3. **Add repository secrets** (Settings → Secrets and variables → Actions):

   | Secret | Value |
   |--------|-------|
   | `SSH_HOST` | server IP/host, e.g. `20.219.248.167` |
   | `SSH_USER` | SSH login user, e.g. `azureuser` |
   | `SSH_PRIVATE_KEY` | full contents of the **private** `deploy_key` (PEM) |
   | `APP_DIR` | repo path on the server, e.g. `/var/www/ecm-jira` |
   | `SSH_PORT` | *(optional)* SSH port; defaults to `22` |

4. **First deploy** still needs the manual one-time server setup above (nginx,
   PM2, `.env`, DB). After that, pushes to `main` deploy themselves.

### Notes

- The workflow uses a `deploy-production` concurrency group, so overlapping
  deploys queue instead of clobbering each other.
- It updates the working tree (`git reset --hard origin/main`) **before**
  invoking `deploy.prod.sh`, so the latest script version runs each time.
- Prefer restricting the deploy key to this server and, optionally, add a
  required reviewer under **Settings → Environments → production** to gate
  production releases behind an approval.

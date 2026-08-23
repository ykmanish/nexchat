# Deploying NexChat to `chax.nexarrow.eu`

Target: the EC2 box at `16.171.22.149` that already runs **splitta**. Nothing
here touches splitta — different ports, its own nginx site, its own PM2 apps.

| | |
|---|---|
| Domain | `chax.nexarrow.eu` |
| Frontend (Next.js) | `127.0.0.1:3100` |
| Backend (Express + Socket.IO) | `127.0.0.1:5100` |
| Code | `/var/www/nexchat` |
| Attachments | `/var/www/nexchat-data/uploads` |
| Logs | `/var/log/nexchat`, `/var/log/nginx/nexchat.*.log` |

**Ports are 3100/5100, not the 3000/5000 defaults.** Splitta is very likely on
3000. Confirm before you start:

```bash
sudo ss -tlnp | grep -E ':(3000|3100|5000|5100)'
```

If either of ours is taken, change it in three places together —
`deploy/ecosystem.config.cjs`, `deploy/nginx-chax.nexarrow.eu.conf`, and
`backend/.env`. Nothing discovers the ports at runtime.

---

## One-time setup

```bash
scp deploy/setup-server.sh ubuntu@16.171.22.149:~
ssh ubuntu@16.171.22.149 'bash ~/setup-server.sh'
```

It checks the ports are free, adds swap if the instance is small, installs
Node 20 / PM2 / nginx / certbot, creates the directories, clones the repo, and
installs a **HTTP-only bootstrap** nginx site. Then it prints the remaining
steps. It is safe to re-run.

### Why bootstrap first

The real config references `/etc/letsencrypt/live/chax.nexarrow.eu/`. Nginx
refuses to start when an `ssl_certificate` file is missing, so it cannot be
installed before the certificate exists. Order is: bootstrap → certbot →
real config.

### DNS

Point an A record at the box and wait for it to propagate before running
certbot — issuance fails otherwise.

```bash
dig +short chax.nexarrow.eu     # must print 16.171.22.149
```

### Env files

These hold secrets so they are not in git. Both must exist **before the first
build**:

```bash
cp deploy/backend.env.example            backend/.env
cp deploy/frontend.env.production.example frontend/.env.production
nano backend/.env
```

Generate what it asks for:

```bash
openssl rand -base64 48
```

```bash
npx web-push generate-vapid-keys
```

`NEXT_PUBLIC_API_URL` is **inlined at build time**, not read at runtime. If
`frontend/.env.production` is missing when `next build` runs, you get a bundle
that points at `localhost:5000` and fails only in the visitor's browser. The
deploy workflow refuses to run without it for exactly this reason.

### Certificate

```bash
sudo certbot certonly --webroot -w /var/www/html -d chax.nexarrow.eu --agree-tos -m you@example.com --non-interactive
```

Then swap in the real site and reload:

```bash
sudo cp /var/www/nexchat/deploy/nginx-chax.nexarrow.eu.conf /etc/nginx/sites-available/chax.nexarrow.eu && sudo nginx -t && sudo systemctl reload nginx
```

Renewal is automatic via certbot's timer. Verify with `sudo certbot renew --dry-run`.

### First start

```bash
cd /var/www/nexchat/backend && npm ci --omit=dev && cd ../frontend && npm ci && npm run build && cd .. && pm2 start deploy/ecosystem.config.cjs && pm2 save
```

Then make both survive a reboot — `pm2 startup` prints a command to run:

```bash
pm2 startup
```

---

## GitHub Actions

`.github/workflows/deploy-aws.yml` deploys on every push to `main`, and can be
run manually from the Actions tab.

Add under **Settings → Secrets and variables → Actions**:

| Secret | Value |
|---|---|
| `AWS_HOST` | `16.171.22.149` |
| `AWS_USER` | `ubuntu` |
| `AWS_SSH_KEY` | private key, **including** the `BEGIN`/`END` lines |
| `AWS_SSH_PORT` | optional, defaults to 22 |

A dedicated key is better than reusing your login key:

```bash
ssh-keygen -t ed25519 -C github-actions -f ~/.ssh/gh_deploy -N '' && cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys && cat ~/.ssh/gh_deploy
```

The run: verifies both env files exist → `git reset --hard origin/main` →
installs deps → rebuilds the frontend from a clean `.next` → reloads PM2 →
then **polls both apps until they answer 200**, dumping logs and failing the
run if they don't. A process that starts and immediately crashes still counts
as a successful `pm2 reload`, so without that check a broken deploy reports
green.

---

## Notes that will save you an afternoon

**`next build` needs more than 1 GB.** On a 1 GB instance the OOM killer stops
it partway with no error message. `setup-server.sh` adds 2 GB of swap when it
sees a small box. If you skip that script, do it by hand.

**Attachments live outside the repo.** `UPLOAD_DIR` is
`/var/www/nexchat-data/uploads`, not inside `/var/www/nexchat`. Every deploy
runs `git reset --hard`; untracked files do survive that, but one stray
`git clean -fd` would take every attachment with it.

**Upload size is capped in two places.** `MAX_UPLOAD_MB=50` in the app and
`client_max_body_size 60m` in nginx. Nginx must be the larger of the two, or
big files are rejected by the proxy before Express can return a useful error.

**Rotate the secrets in `backend/.env`.** Changing either JWT secret signs
every existing session out. Regenerating the VAPID pair invalidates every push
subscription — the server will mint a temporary pair and log it if you leave
them blank, but a fresh pair on each restart means push silently stops working.

**MongoDB.** Reuse your existing `MONGODB_URI`. If you'd rather run it locally,
install `mongodb-org` and use `mongodb://127.0.0.1:27017/nexchat` — but then
you own the backups.

## Checks

```bash
pm2 status && pm2 logs nexchat-backend --lines 50
```

```bash
curl -s https://chax.nexarrow.eu/api/health
```

```bash
sudo tail -f /var/log/nginx/nexchat.error.log
```

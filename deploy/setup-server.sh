#!/usr/bin/env bash
#
# One-time server setup for NexChat on an EC2 box that already runs splitta.
# Safe to re-run: every step checks before it acts, and nothing here touches
# splitta's files, ports, or nginx config.
#
#   scp deploy/setup-server.sh ubuntu@16.171.22.149:~
#   ssh ubuntu@16.171.22.149 'bash ~/setup-server.sh'

set -euo pipefail

DOMAIN=chax.nexarrow.eu
APP_DIR=/var/www/nexchat
DATA_DIR=/var/www/nexchat-data
REPO=https://github.com/ykmanish/nexchat.git
FRONTEND_PORT=3100
BACKEND_PORT=5100

say() { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }

# ── ports ───────────────────────────────────────────────────────────────────
say "Checking ports $FRONTEND_PORT and $BACKEND_PORT are free"
for p in "$FRONTEND_PORT" "$BACKEND_PORT"; do
  if sudo ss -tlnp 2>/dev/null | grep -q ":$p "; then
    warn "Port $p is already in use:"
    sudo ss -tlnp | grep ":$p "
    warn "Pick different ports in deploy/ecosystem.config.cjs, the nginx"
    warn "config, and backend/.env, then re-run."
    exit 1
  fi
done
echo "Both free. In use on this box right now:"
sudo ss -tlnp | awk 'NR==1 || /LISTEN/' | head -20

# ── swap ────────────────────────────────────────────────────────────────────
# `next build` needs well over 1GB. On a 1GB instance it is killed by the OOM
# reaper partway through, which shows up as a build that just stops with no
# error — the most confusing possible failure. Swap makes it merely slow.
say "Checking swap"
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
echo "RAM: ${TOTAL_MB}MB, swap: ${SWAP_MB}MB"
if [ "$SWAP_MB" -lt 1024 ] && [ "$TOTAL_MB" -lt 3000 ]; then
  say "Adding 2G swap (needed for next build on a small instance)"
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile || true
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
  free -h
fi

# ── packages ────────────────────────────────────────────────────────────────
say "Installing base packages"
sudo apt-get update -qq
sudo apt-get install -y -qq git curl nginx

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  say "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y -qq nodejs
fi
echo "node $(node -v), npm $(npm -v)"

if ! command -v pm2 >/dev/null; then
  say "Installing PM2"
  sudo npm install -g pm2
fi

if ! command -v certbot >/dev/null; then
  say "Installing certbot"
  sudo apt-get install -y -qq certbot python3-certbot-nginx
fi

# ── directories ─────────────────────────────────────────────────────────────
say "Creating directories"
sudo mkdir -p "$APP_DIR" "$DATA_DIR/uploads" /var/log/nexchat /var/www/html
sudo chown -R "$USER:$USER" "$APP_DIR" "$DATA_DIR" /var/log/nexchat
# nginx serves /uploads straight off disk, so www-data has to be able to
# traverse into it.
sudo chmod 755 /var/www "$DATA_DIR" "$DATA_DIR/uploads"

if [ ! -d "$APP_DIR/.git" ]; then
  say "Cloning $REPO"
  git clone "$REPO" "$APP_DIR"
fi

# ── nginx (bootstrap, HTTP only) ────────────────────────────────────────────
say "Installing bootstrap nginx site"
sudo cp "$APP_DIR/deploy/nginx-chax.nexarrow.eu.bootstrap.conf" \
        "/etc/nginx/sites-available/$DOMAIN"
sudo ln -sfn "/etc/nginx/sites-available/$DOMAIN" "/etc/nginx/sites-enabled/$DOMAIN"
sudo nginx -t
sudo systemctl reload nginx

cat <<EOF

$(say "Base setup done")

Next, in order:

 1. DNS — point an A record at this box, and wait for it to resolve:
        $DOMAIN  ->  16.171.22.149
    Check with:  dig +short $DOMAIN

 2. Env files (they hold secrets, so they are never in git):
        cp $APP_DIR/deploy/backend.env.example $APP_DIR/backend/.env
        cp $APP_DIR/deploy/frontend.env.production.example $APP_DIR/frontend/.env.production
        nano $APP_DIR/backend/.env

    Generate the secrets it asks for:
        openssl rand -base64 48          # x2, for the two JWT secrets
        npx web-push generate-vapid-keys # for the two VAPID keys

 3. Certificate:
        sudo certbot certonly --webroot -w /var/www/html -d $DOMAIN \\
             --agree-tos -m you@example.com --non-interactive

 4. Swap in the real (HTTPS) site config:
        sudo cp $APP_DIR/deploy/nginx-chax.nexarrow.eu.conf \\
                /etc/nginx/sites-available/$DOMAIN
        sudo nginx -t && sudo systemctl reload nginx

 5. First build and start:
        cd $APP_DIR/backend  && npm ci --omit=dev
        cd $APP_DIR/frontend && npm ci && npm run build
        cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs
        pm2 save
        pm2 startup    # run the command it prints, so both apps survive reboot

 6. GitHub Actions — add these repo secrets under
    Settings > Secrets and variables > Actions:
        AWS_HOST     16.171.22.149
        AWS_USER     $USER
        AWS_SSH_KEY  the full private key, including the BEGIN/END lines

    If you do not already have a deploy key on this box:
        ssh-keygen -t ed25519 -C github-actions -f ~/.ssh/gh_deploy -N ''
        cat ~/.ssh/gh_deploy.pub >> ~/.ssh/authorized_keys
        cat ~/.ssh/gh_deploy     # paste this into AWS_SSH_KEY

EOF

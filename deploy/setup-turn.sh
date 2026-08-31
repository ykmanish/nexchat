#!/usr/bin/env bash
#
# Stands up a TURN relay (coturn) on the box that already serves Chax.
#
# Why this is needed at all: STUN only tells a peer what its own public address
# is. It cannot get packets through a symmetric NAT, and symmetric NAT is what
# most mobile carriers use — so without a relay a real share of phone-to-phone
# calls cannot connect, and they fail by sitting in "Connecting…" forever rather
# than by reporting anything. That is what "the calling doesn't work" looks like
# from the inside.
#
# Reuses the existing Let's Encrypt certificate, so TURN over TLS works on
# networks that only allow 443-shaped traffic, and no new DNS record is needed.
#
# Safe to re-run: every step checks before it acts, and an existing secret is
# kept rather than rotated — rotating it drops every call in progress.
#
#   scp deploy/setup-turn.sh ubuntu@16.171.22.149:~
#   ssh ubuntu@16.171.22.149 'sudo bash ~/setup-turn.sh'

set -euo pipefail

DOMAIN=${DOMAIN:-chax.nexarrow.eu}
CERT_DIR=/etc/letsencrypt/live/$DOMAIN
CONF=/etc/turnserver.conf
SECRET_FILE=/etc/turnserver.secret
MIN_PORT=${MIN_PORT:-49160}
MAX_PORT=${MAX_PORT:-49200}

say()  { printf '\n\033[1;32m==>\033[0m %s\n' "$1"; }
warn() { printf '\n\033[1;33m!!\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mxx\033[0m %s\n' "$1"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run with sudo: sudo bash $0"

# ── addresses ───────────────────────────────────────────────────────────────
# A relay behind NAT has to be told its public face, or it advertises the
# private address and every candidate it hands out is unreachable.
say "Working out this machine's addresses"
PRIVATE_IP=$(hostname -I | awk '{print $1}')
if [ -z "${PUBLIC_IP:-}" ]; then
  TOKEN=$(curl -s -m 2 -X PUT "http://169.254.169.254/latest/api/token" \
    -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
  PUBLIC_IP=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" \
    http://169.254.169.254/latest/meta-data/public-ipv4 || true)
fi
[ -n "${PUBLIC_IP:-}" ] || PUBLIC_IP=$(curl -s -m 4 https://api.ipify.org || true)
[ -n "${PUBLIC_IP:-}" ] || die "Could not determine the public IP. Set PUBLIC_IP=x.x.x.x and re-run."
echo "    private $PRIVATE_IP   public $PUBLIC_IP"

# ── install ─────────────────────────────────────────────────────────────────
if ! command -v turnserver >/dev/null 2>&1; then
  say "Installing coturn"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq coturn
else
  say "coturn is already installed"
fi

# Shipped disabled on Debian and Ubuntu, which is a quiet way to spend an hour
# wondering why nothing is listening.
say "Enabling the coturn service"
if grep -q '^#\?TURNSERVER_ENABLED' /etc/default/coturn 2>/dev/null; then
  sed -i 's/^#\?TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn
else
  echo 'TURNSERVER_ENABLED=1' >> /etc/default/coturn
fi

# ── secret ──────────────────────────────────────────────────────────────────
# Kept across runs. Rotating it invalidates every credential already handed out,
# which drops calls in progress for as long as their TTL had left.
if [ -s "$SECRET_FILE" ]; then
  say "Reusing the existing shared secret"
  SECRET=$(cat "$SECRET_FILE")
else
  say "Generating a shared secret"
  SECRET=$(openssl rand -hex 32)
  ( umask 077 && printf '%s' "$SECRET" > "$SECRET_FILE" )
  chmod 600 "$SECRET_FILE"
fi

# ── certificate access ──────────────────────────────────────────────────────
# coturn drops to its own unprivileged user and cannot read Let's Encrypt's
# directories, which are root-only by default. TLS then fails to start while
# plain TURN keeps working, so it half-works and reads as a network problem.
TLS_LINES=""
if [ -d "$CERT_DIR" ]; then
  say "Granting coturn read access to the $DOMAIN certificate"
  groupadd -f ssl-cert
  usermod -aG ssl-cert turnserver
  chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
  chmod -R g=rX /etc/letsencrypt/live /etc/letsencrypt/archive
  TLS_LINES="tls-listening-port=5349
cert=$CERT_DIR/fullchain.pem
pkey=$CERT_DIR/privkey.pem
no-tlsv1
no-tlsv1_1"

  # A renewed certificate is a new file that coturn is still holding the old
  # handle to, so it serves an expired one until something restarts it.
  mkdir -p /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh << 'HOOK'
#!/usr/bin/env bash
# coturn keeps the certificate open, so a renewal it is not told about means it
# goes on serving the expired one.
chgrp -R ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive || true
chmod -R g=rX /etc/letsencrypt/live /etc/letsencrypt/archive || true
systemctl restart coturn || true
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
else
  warn "No certificate at $CERT_DIR — setting up plain TURN only."
  warn "TURN over TLS on 5349 is the part that gets through restrictive"
  warn "networks, so issue the certificate and re-run this when you can."
fi

# ── config ──────────────────────────────────────────────────────────────────
say "Writing $CONF"
[ -f "$CONF" ] && cp "$CONF" "$CONF.bak.$(date +%s)"
cat > "$CONF" << CONFEOF
# Managed by deploy/setup-turn.sh — re-running this script overwrites the file.

listening-port=3478
$TLS_LINES

listening-ip=$PRIVATE_IP
# Behind NAT the relay has to be told its public face, or it advertises the
# private address and every candidate it hands out is unreachable.
external-ip=$PUBLIC_IP/$PRIVATE_IP

realm=$DOMAIN
server-name=$DOMAIN
fingerprint

# The client is never given a password. It asks the API for a credential and
# gets an expiry timestamp plus an HMAC of it made with this secret — so a
# credential that leaks is worth whatever is left of its few hours, and the
# relay is not an open proxy for anyone who reads the JavaScript bundle.
use-auth-secret
static-auth-secret=$SECRET

# A narrow media range, so the firewall rule stays small enough to justify.
min-port=$MIN_PORT
max-port=$MAX_PORT

# A relay forwards to any address it is asked to unless told otherwise, which
# turns it into a way to reach things that were never meant to be public — the
# instance metadata service, the database on localhost, the rest of the VPC.
no-multicast-peers
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=::1
denied-peer-ip=fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff
denied-peer-ip=fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff

# One misbehaving client should not be able to saturate the box's uplink.
user-quota=12
total-quota=1200

no-cli
no-software-attribute
simple-log
CONFEOF

# ── firewall ────────────────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  say "Opening ports in ufw"
  ufw allow 3478/tcp >/dev/null; ufw allow 3478/udp >/dev/null
  ufw allow 5349/tcp >/dev/null; ufw allow 5349/udp >/dev/null
  ufw allow "$MIN_PORT:$MAX_PORT/udp" >/dev/null
fi

say "Restarting coturn"
systemctl enable coturn >/dev/null 2>&1 || true
systemctl restart coturn
sleep 2
systemctl is-active --quiet coturn || {
  journalctl -u coturn -n 30 --no-pager
  die "coturn did not start — the log above says why."
}

say "Listening on:"
ss -tulnp 2>/dev/null | grep -E ':(3478|5349) ' || warn "Nothing on 3478/5349 yet."

printf '\n\033[1;32m==>\033[0m coturn is running.\n'
cat << SUMMARY

Two things left. Calls will not use the relay until both are done.

1. Open these in the AWS security group for this instance, source 0.0.0.0/0 —
   a relay is only useful if the people calling can reach it:

     3478             TCP and UDP
     5349             TCP and UDP
     $MIN_PORT-$MAX_PORT      UDP

2. Add these to /var/www/nexchat/backend/.env and restart the API:

     TURN_URLS=turn:$DOMAIN:3478,turns:$DOMAIN:5349
     TURN_SECRET=$SECRET
     TURN_TTL_SECONDS=43200

     pm2 restart nexchat-backend

To check it end to end, open the Trickle ICE page:

     https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/

Put in turn:$DOMAIN:3478, and for the username and password use what
https://$DOMAIN/api/calls/ice gives you while signed in. A row of type
"relay" means the relay works. Only "host" and "srflx" rows means step 1 has
not taken effect yet.

SUMMARY

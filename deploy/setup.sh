#!/usr/bin/env bash
# One-time setup of the always-on Tick worker on a fresh Ubuntu 22.04/24.04 VPS.
# Usage: sudo bash setup.sh <git-repo-url>     (private repo: use a read-only deploy token in the URL)
set -euo pipefail
REPO_URL=${1:?usage: setup.sh <git-repo-url>}
apt-get update && apt-get install -y docker.io git curl ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs
id tick &>/dev/null || useradd -r -m -s /usr/sbin/nologin -G docker tick
[ -d /opt/tick/.git ] && git -C /opt/tick pull || git clone "$REPO_URL" /opt/tick
chown -R tick:tick /opt/tick
sudo -u tick docker build -t relay-sandbox /opt/tick/worker/sandbox
sudo -u tick bash -c 'cd /opt/tick/worker && (npm ci || npm install)'
mkdir -p /etc/tick
[ -f /etc/tick/worker.env ] || install -m 600 -o tick /opt/tick/deploy/worker.env.example /etc/tick/worker.env
cp /opt/tick/deploy/tick-worker.service /etc/systemd/system/
ufw allow OpenSSH && ufw --force enable   # worker makes outbound calls only; nothing else to open
systemctl daemon-reload
echo "Next: edit /etc/tick/worker.env, then run: systemctl enable --now tick-worker && journalctl -u tick-worker -f"

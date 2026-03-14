# First deployment guide

Follow these steps in order from a fresh Ubuntu 22.04 server.
Expected total time: 20-30 minutes.

## Step 1 — Server prerequisites

Run as root or with sudo:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker compose version   # Must show v2.x

# Open firewall ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (redirect only)
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

## Step 2 — Clone the repository

```bash
sudo mkdir -p /opt/aeronet-os
sudo chown $USER:$USER /opt/aeronet-os
cd /opt/aeronet-os
git clone https://github.com/<your-org>/aeronet-os.git .
```

## Step 3 — Create and fill .env.secret

```bash
cp .env.secret.example .env.secret
nano .env.secret
```

Work through `docs/secrets-setup-guide.md` for each value.
Run the helpers for generated keys:

```bash
bash scripts/generate-fernet-key.sh       # CREDENTIALS_ENCRYPTION_KEY
openssl rand -hex 32                       # SECRET_KEY
openssl rand -base64 24 | tr -d '/+='     # POSTGRES_PASSWORD
openssl rand -base64 16 | tr -d '/+='     # GRAFANA_ADMIN_PASSWORD
```

Validate when done:

```bash
bash scripts/validate-env.sh
```

Do not proceed until all checks pass.

## Step 4 — TLS certificates

For staging (self-signed):

```bash
bash infra/nginx/generate-certs.sh
```

For production: see `docs/tls-setup-guide.md` Option B.

## Step 5 — Start the stack

```bash
bash scripts/start.sh
```

Expected output sequence:

```
AeroNet OS — Production Start
=================================
Validating environment...
  ...all checks passed
Pulling latest images...
Starting stack...
Waiting for postgres to be healthy...
  Postgres ready.
Running preflight checks...
AeroNet OS is running.
  Frontend: https://aeronet.local
  API:      https://api.aeronet.local
  Grafana:  https://grafana.aeronet.local
```

If start.sh fails, check logs:

```bash
docker compose -f infra/docker-compose.yml logs --tail=50 <service-name>
```

## Step 6 — Seed the superadmin user

```bash
bash scripts/seed-superadmin.sh 'YourChosenPassword123!'
```

Store this password in your password manager immediately.

## Step 7 — Run smoke tests

```bash
pip3 install -r tests/requirements-test.txt

# Set test credentials
export CI_SUPERADMIN_USER=superadmin
export CI_SUPERADMIN_PASSWORD='YourChosenPassword123!'
export GRAFANA_ADMIN_PASSWORD=$(grep GRAFANA_ADMIN_PASSWORD .env.secret | cut -d= -f2)

bash tests/smoke/preflight.sh
pytest tests/smoke/ -v --timeout=30 --tb=short
```

Expected: all tests pass or skip (some require real MIST/Twilio credentials).

## Step 8 — Verify the UI

Open in a browser (accept self-signed cert warning if staging):

```
https://aeronet.local
```

You should see the AeroNet OS login page.
Log in with: `superadmin` / `<your chosen password>`

Expected on first login:

- Dashboard shows 0 devices (no scans run yet)
- Topology shows empty state
- Alerts shows empty state

## Step 9 — Trigger first scan

From the browser or via curl:

```bash
TOKEN=$(curl -sk -X POST https://api.aeronet.local/auth/token \
  -d "username=superadmin&password=YourChosenPassword123!" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST https://api.aeronet.local/enroller/check \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cidr": "10.0.0.0/24"}'
```

Replace `10.0.0.0/24` with your actual airport network CIDR.
Devices will appear in the inventory within ~2 minutes.

## Step 10 — Configure GitHub CD (optional)

Set these in GitHub > Settings > Secrets and variables > Actions:

| Secret | Value |
|---|---|
| DEPLOY_HOST | Your server IP |
| DEPLOY_USER | Your SSH username |
| DEPLOY_SSH_KEY | Contents of `~/.ssh/aeronet_deploy` |

Plus all CI_ secrets documented in `docs/github-secrets.md`.

After configuring, push to main to trigger the first automated deployment.

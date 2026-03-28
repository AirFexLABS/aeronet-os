# Admin Setup Guide

Complete setup manual for deploying AeroNet OS on a Virgilio appliance.
This guide covers initial server hardening through first VLAN configuration.

## Prerequisites

| Requirement | Minimum |
|-------------|---------|
| OS | Ubuntu 24.04 LTS, x86_64 |
| RAM | 32 GB |
| CPU | 8 cores |
| Disk | 100 GB SSD |
| Docker | Engine v24+ with Compose v2 |
| Git | 2.40+ |
| SSH key | Ed25519 or RSA 4096 (for deployment access) |
| Network | At least one VLAN trunk port to the managed switch |

Verify Docker is installed:

```bash
docker --version        # Docker Engine v24+
docker compose version  # Compose v2.x
```

If not installed:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## Initial Server Hardening

### SSH on port 2222

```bash
sudo sed -i 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config
sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo sed -i 's/^#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

Verify you can reconnect on the new port before closing the current session:

```bash
ssh -p 2222 user@virgilio
```

### UFW firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp comment 'SSH'
sudo ufw allow 80/tcp  comment 'HTTP redirect'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw enable
sudo ufw status verbose
```

### nftables

Copy the AeroNet nftables rules and restart:

```bash
sudo cp infra/nftables.conf /etc/nftables.conf
sudo systemctl enable nftables
sudo systemctl restart nftables
sudo nft list ruleset   # verify rules loaded
```

The nftables config enforces:

- Input: drop all except SSH (2222, rate-limited), HTTP/HTTPS, INSIDE interfaces
- Forward: drop all except Docker bridge traffic
- Output: allow all

### fail2ban

```bash
sudo apt install -y fail2ban
sudo tee /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = 2222
maxretry = 3
bantime = 3600
findtime = 600
EOF
sudo systemctl enable fail2ban
sudo systemctl restart fail2ban
```

### auditd

```bash
sudo apt install -y auditd
sudo systemctl enable auditd

# Log all commands run as root
sudo auditctl -a always,exit -F arch=b64 -S execve -F euid=0 -k root-commands

# Log netplan changes
sudo auditctl -w /etc/netplan/ -p wa -k netplan-changes

# Log Docker config changes
sudo auditctl -w /opt/aeronet-os/infra/docker-compose.yml -p wa -k docker-compose-changes
```

Make rules persistent:

```bash
sudo tee -a /etc/audit/rules.d/aeronet.rules << 'EOF'
-a always,exit -F arch=b64 -S execve -F euid=0 -k root-commands
-w /etc/netplan/ -p wa -k netplan-changes
-w /opt/aeronet-os/infra/docker-compose.yml -p wa -k docker-compose-changes
EOF
sudo systemctl restart auditd
```

## Repository Clone and .env.secret Configuration

```bash
sudo mkdir -p /opt/aeronet-os
sudo chown $USER:$USER /opt/aeronet-os
cd /opt/aeronet-os
git clone https://github.com/<your-org>/aeronet-os.git .
```

Create the secrets file:

```bash
cp .env.secret.example .env.secret
chmod 600 .env.secret
```

Generate each required secret:

```bash
# SECRET_KEY (JWT signing)
openssl rand -hex 32

# POSTGRES_PASSWORD
openssl rand -base64 24 | tr -d '/+='

# GRAFANA_ADMIN_PASSWORD
openssl rand -base64 16 | tr -d '/+='

# CREDENTIALS_ENCRYPTION_KEY (Fernet)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

# ALERT_CONTACTS_ENCRYPTION_KEY (Fernet)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Edit `.env.secret` and paste each value. See `docs/secrets-setup-guide.md`
for external service credentials (MIST, Twilio, Telegram).

Validate all secrets are set:

```bash
bash scripts/validate-env.sh
```

Do not proceed until all checks pass.

## Docker Stack Deployment

```bash
bash scripts/start.sh
```

This script:

1. Validates `.env.secret`
2. Checks/generates TLS certificates
3. Pulls latest Docker images
4. Starts the full stack via `docker compose`
5. Waits for PostgreSQL healthcheck
6. Runs preflight checks

Verify all containers are running:

```bash
docker compose -f infra/docker-compose.yml ps
```

Expected: 11 containers, all with status `Up` or `Up (healthy)`.

## Initial Admin Password Setup

```bash
bash scripts/seed-superadmin.sh 'YourChosenPassword123!'
```

Store this password in your password manager immediately.

Verify login:

```bash
curl -sk -X POST https://aeronet.local/api/auth/token \
  -d "username=superadmin&password=YourChosenPassword123!" \
  | python3 -m json.tool
```

Expected: JSON response with `access_token` field.

## TLS Certificate Setup

### Self-signed (staging)

```bash
bash infra/nginx/generate-certs.sh
```

This runs:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infra/nginx/certs/aeronet.key \
  -out    infra/nginx/certs/aeronet.crt \
  -subj   "/CN=*.aeronet.local/O=AeroNet OS/C=US" \
  -addext "subjectAltName=DNS:aeronet.local,DNS:*.aeronet.local"
```

**Important:** The `-keyout` and `-out` flags must point to separate files.
A previous version of this command pointed both to the same file, which
produced a combined PEM that Nginx could not parse. Always use:

- `-keyout ...aeronet.key` -- private key only
- `-out ...aeronet.crt` -- certificate only

Add to your workstation's `/etc/hosts`:

```
<virgilio-ip>  aeronet.local api.aeronet.local grafana.aeronet.local
```

### Production (Let's Encrypt)

See `docs/tls-setup-guide.md` for the full Let's Encrypt procedure.

## First VLAN Configuration Walkthrough

This example uses VLAN 4 (the standard sandbox segment used during initial
setup before going live at any airport deployment).

### Step 1 -- Create the VLAN interface on Virgilio

Create the netplan config for VLAN 4:

```bash
sudo tee /etc/netplan/60-vlan4-sandbox.yaml << 'EOF'
network:
  version: 2
  vlans:
    INSIDE.4:
      id: 4
      link: INSIDE        # your trunk interface name
      addresses:
        - 192.168.1.250/24
      routes:
        - to: 192.168.1.0/24
          via: 192.168.1.1
          metric: 100
EOF
```

Apply and verify:

```bash
sudo netplan apply
ip addr show INSIDE.4
# Should show 192.168.1.250/24
```

### Step 2 -- Add macvlan network to docker-compose

Add to the `networks:` section of `infra/docker-compose.yml`:

```yaml
networks:
  aeronet-internal:
    driver: bridge

  vlan4-sandbox:
    driver: macvlan
    driver_opts:
      parent: INSIDE.4
    ipam:
      config:
        - subnet: 192.168.1.0/24
          gateway: 192.168.1.1
```

Add the network to the enroller service:

```yaml
services:
  enroller:
    networks:
      aeronet-internal: {}
      vlan4-sandbox:
        ipv4_address: 192.168.1.249
```

### Step 3 -- Set SCAN_TARGETS

Edit `.env.secret`:

```
SCAN_TARGETS=192.168.1.0/24
```

### Step 4 -- Restart the stack

```bash
cd /opt/aeronet-os
docker compose -f infra/docker-compose.yml up -d
```

### Step 5 -- Verify scanning

```bash
# Check enroller logs for scan activity
docker compose -f infra/docker-compose.yml logs enroller --tail=20

# Trigger a manual discovery
TOKEN=$(curl -sk -X POST https://aeronet.local/api/auth/token \
  -d "username=superadmin&password=<your-password>" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -sk -X POST https://aeronet.local/api/discover \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"cidr": "192.168.1.0/24", "timeout": 120}'
```

Expected: JSON array of discovered devices with vendor, OS, ports, and
confidence scores.

### Step 6 -- Mark VLAN active in the UI

Log in to `https://aeronet.local`, navigate to VLAN management, and mark
VLAN 4 as active. This enables scheduled scanning on this segment.

## Verification Checklist

Run through this checklist after initial setup:

- [ ] All 11 containers show `Up` in `docker compose ps`
- [ ] `https://aeronet.local` loads the login page (accept cert warning if self-signed)
- [ ] Superadmin can log in and sees the dashboard
- [ ] `bash scripts/validate-env.sh` passes all checks
- [ ] `bash tests/smoke/preflight.sh` passes
- [ ] `pytest tests/smoke/ -v --timeout=30` passes (or skips for missing external creds)
- [ ] Enroller logs show `Scheduled scanner started` with correct targets
- [ ] `ip addr show INSIDE.4` shows the VLAN interface with correct IP
- [ ] `sudo nft list ruleset` shows the AeroNet firewall rules
- [ ] `sudo systemctl status fail2ban` shows active
- [ ] `sudo auditctl -l` shows the audit rules
- [ ] TLS cert files exist at `infra/nginx/certs/aeronet.{key,crt}` (separate files)
- [ ] `.env.secret` has mode `600` (`ls -la .env.secret`)

# Production Host Setup

## Requirements
- Ubuntu 22.04 LTS (x86_64)
- Docker Engine 26.x + Docker Compose Plugin v2.x
- 32GB RAM, 8+ CPU cores, 200GB+ SSD
- SSH access for the deploy user

## One-time Setup

### 1. Create deploy directory
```bash
sudo mkdir -p /opt/aeronet-os
sudo chown $USER:$USER /opt/aeronet-os
cd /opt/aeronet-os
```

### 2. Clone the repository
```bash
git clone https://github.com/<org>/aeronet-os.git .
```

### 3. Create production secrets file
```bash
cp .env.secret.example .env.secret
nano .env.secret   # Fill in all real values — never commit this file
```

### 4. Create the assets directory
```bash
mkdir -p frontend/public/assets
# Copy your airport logo:
cp /path/to/logo.svg frontend/public/assets/logo.svg
cp /path/to/favicon.ico frontend/public/assets/favicon.ico
```

### 5. Initial stack start
```bash
docker compose -f infra/docker-compose.yml up -d
```

## SSH Deploy Key Setup

On the target server, add the GitHub Actions public key to authorized_keys:
```bash
echo "<public-key>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Generate the keypair locally (ed25519 recommended):
```bash
ssh-keygen -t ed25519 -C "aeronet-os-deploy" -f aeronet_deploy_key
# Add private key → GitHub Secret: DEPLOY_SSH_KEY
# Add public key  → server authorized_keys
```

## CD Pipeline Assumptions
- Working directory on host: `/opt/aeronet-os`
- Docker Compose file: `infra/docker-compose.yml` (no override in production)
- Images pulled from GHCR using `GITHUB_TOKEN` (automatic — no registry login needed on host)

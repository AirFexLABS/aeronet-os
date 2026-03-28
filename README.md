# AeroNet OS

Containerised Network Management System for airports.
Vendor-agnostic (Cisco/Juniper), white-label ready (Apache 2.0), aligned with ISO 27001 / NIST CSF 2.0.

## Quick start

### Prerequisites

- Ubuntu 22.04 LTS, x86_64, 32GB RAM, 8 CPU cores
- Docker Engine v24+ with Compose v2
- Python 3.11+ (for scripts and tests)

### Deploy

```bash
git clone https://github.com/<your-org>/aeronet-os.git
cd aeronet-os
cp .env.secret.example .env.secret
# Fill in .env.secret — see docs/secrets-setup-guide.md
bash scripts/validate-env.sh
bash infra/nginx/generate-certs.sh   # staging TLS
bash scripts/start.sh
bash scripts/seed-superadmin.sh 'YourPassword'
```

Open https://aeronet.local in a browser.

## Architecture Status

- **11 containers** (api-gateway, enroller, collector, notifier, portal, frontend, grafana, prometheus, postgres, postgres-exporter, nginx)
- **VLAN 4 active** -- sandbox segment (192.168.1.0/24, gateway 192.168.1.1)
- VLAN 4 is the standard sandbox segment used during initial setup before going live at any airport deployment

## Services

| Service | Port | Description |
|---|---|---|
| api-gateway | 8000 | FastAPI — RBAC, device inventory |
| enroller | 8002 | Nmap discovery + Scrapli provisioning |
| collector | 8003 | Juniper MIST API polling |
| notifier | 8001 | Telegram + Twilio alert dispatcher |
| portal | 8080 | Go JWT-gated Grafana proxy |
| frontend | 5173 | React + Tailwind UI |
| grafana | 3000 | Metrics dashboards |
| prometheus | 9090 | Metrics collection |
| postgres | 5432 | PostgreSQL source of truth |
| postgres-exporter | — | Prometheus metrics for PostgreSQL |
| nginx | 80/443 | TLS termination + reverse proxy |

## Known Production State

Virgilio's current configuration:

| Parameter | Value |
|---|---|
| VLAN interface | INSIDE.4 |
| Subnet | 192.168.1.0/24 |
| Gateway | 192.168.1.1 |
| Macvlan status | pending |

VLAN 4 (sandbox) is active for scanning. Macvlan Docker network configuration
is pending -- the enroller currently reaches the VLAN via the bridge network
with `SCAN_TARGETS=192.168.1.0/24`.

## Docs

### Architecture

| Document | Description |
|---|---|
| [docs/architecture/vlan-discovery.md](docs/architecture/vlan-discovery.md) | Scalable VLAN discovery architecture and compliance mapping |
| [docs/architecture/security-decisions.md](docs/architecture/security-decisions.md) | All security architecture decisions and rationale |

### Setup

| Document | Description |
|---|---|
| [docs/setup/admin-setup-guide.md](docs/setup/admin-setup-guide.md) | Full admin setup manual (hardening, deploy, first VLAN) |
| [docs/setup/vlan-configuration.md](docs/setup/vlan-configuration.md) | VLAN configuration reference and templates |

### Operations

| Document | Description |
|---|---|
| [docs/secrets-setup-guide.md](docs/secrets-setup-guide.md) | How to obtain every secret value |
| [docs/tls-setup-guide.md](docs/tls-setup-guide.md) | Self-signed and Let's Encrypt TLS setup |
| [docs/first-deployment-guide.md](docs/first-deployment-guide.md) | End-to-end first deployment walkthrough |
| [docs/post-deployment-checklist.md](docs/post-deployment-checklist.md) | Validation checklist after deployment |
| [docs/deployment.md](docs/deployment.md) | One-time server setup |
| [docs/github-secrets.md](docs/github-secrets.md) | GitHub Actions secrets reference |

## Testing

```bash
pip install -r tests/requirements-test.txt
bash tests/smoke/preflight.sh
pytest tests/smoke/ -v --timeout=30
```

## White-labeling

Edit `frontend/src/theme/theme.json` to change brand name, colors, and logo paths.
Replace `frontend/public/assets/logo.svg` and `favicon.ico` with your airport's assets.
Rebuild the frontend container: `docker compose build frontend`

## License

Apache License 2.0 — see LICENSE file.

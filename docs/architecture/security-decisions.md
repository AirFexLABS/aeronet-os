# Security Architecture Decisions

This document records every security design decision made in AeroNet OS,
the alternatives considered, and the rationale for each choice.

## 1. No Inter-VLAN Routing

**Decision:** The Virgilio host does not route traffic between VLANs.

**Implementation:**

- `ip_forward=0` in sysctl (kernel-level forwarding disabled)
- nftables forward chain: `policy drop` with explicit logging
- Each VLAN interface is a leaf -- traffic enters and exits through the
  upstream switch/router, never through Virgilio

**Rationale:** Virgilio is a passive monitoring appliance. If it routed
between VLANs, a compromised container could pivot from the sandbox VLAN
to production segments. Keeping `ip_forward=0` makes lateral movement
structurally impossible at the kernel level.

**nftables enforcement (`infra/nftables.conf`):**

```
chain forward {
    type filter hook forward priority filter; policy drop;
    ct state established,related accept
    # Docker bridge only
    iifname "br-..." accept
    oifname "br-..." tcp dport { 80, 443 } accept
    log prefix "nft-drop-forward: " flags all
    drop
}
```

## 2. Virgilio as Passive Monitor Only

**Decision:** Virgilio never pushes configuration to network devices.

**What it does:**

- Scans networks with Nmap (read-only probes: SYN, version, OS fingerprint)
- Queries SNMP sysDescr (read-only OID)
- Polls Juniper MIST API (read-only token)
- Records findings in the database

**What it does not do:**

- SSH into devices to change configuration (Scrapli is available for
  engineer-initiated provisioning only, never automated)
- Modify switch port assignments, VLAN trunks, or ACLs
- Send SNMP SET commands

**Rationale:** A passive monitor that gets compromised cannot disrupt the
network it monitors. This limits the blast radius to data exfiltration
(mitigated by encryption) rather than network disruption.

## 3. Container Capability Model

**Decision:** All containers run with `cap_drop: ALL` and only add back
the minimum capabilities required.

| Container | Capabilities | Why |
|-----------|-------------|-----|
| enroller | NET_RAW, NET_ADMIN | Nmap raw sockets for SYN scan and OS fingerprinting |
| nginx | CHOWN, SETUID, SETGID, DAC_OVERRIDE | Nginx worker process management |
| postgres | CHOWN, SETUID, SETGID, FOWNER, DAC_OVERRIDE | PostgreSQL data directory ownership |
| grafana | CHOWN, SETUID, SETGID | Grafana data directory |
| prometheus | CHOWN, SETUID, SETGID | Prometheus TSDB directory |
| frontend | CHOWN, SETUID, SETGID, DAC_OVERRIDE | Nginx serving static files |
| api-gateway | (none) | Pure Python, no privileged ops |
| collector | (none) | Pure Python, read-only filesystem |
| notifier | (none) | Pure Python, read-only filesystem |
| portal | (none) | Go binary, read-only filesystem |
| postgres-exporter | (none) | Read-only metrics exporter |

**Additional hardening applied to all containers:**

- `security_opt: no-new-privileges:true` -- prevents setuid binaries from
  escalating privileges inside the container
- `read_only: true` where possible (collector, notifier, portal, postgres-exporter)
- `tmpfs: /tmp` -- writable tmp that does not persist
- Resource limits (memory + CPU) to prevent DoS via resource exhaustion

## 4. JWT HS256 Authentication

**Decision:** Use HS256 (HMAC-SHA256) symmetric JWT tokens.

**Configuration:**

- Secret: `SECRET_KEY` (256-bit, generated via `openssl rand -hex 32`)
- Expiry: 60 minutes (configurable via `ACCESS_TOKEN_EXPIRE_MINUTES`)
- Payload: `{ sub: username, role: Role, site_id: string|null, exp: unix_ts }`

**Why HS256 over RS256:**

- Single-service architecture -- the API Gateway is the only JWT issuer and
  verifier, so there is no need for public-key verification by third parties
- Simpler key management -- one secret vs. a keypair with rotation
- Adequate security -- 256-bit HMAC is computationally secure for symmetric
  verification within a single trust boundary

**Token lifecycle:**

1. `POST /auth/token` -- OAuth2 password flow, returns JWT
2. All subsequent requests include `Authorization: Bearer <token>`
3. Token is validated on every request via `get_current_user()` dependency
4. No refresh tokens -- client re-authenticates after expiry

## 5. RBAC Role Hierarchy

**Decision:** Four-tier role hierarchy with permission-based guards.

```
VIEWER   < OPERATOR  < ENGINEER  < ADMIN
```

| Role | Key permissions | Intended user |
|------|----------------|---------------|
| VIEWER | devices:read, alerts:read, dashboard:read | Airport ops staff, read-only dashboards |
| OPERATOR | + scan:trigger, alerts:ack, vault:read/write | NOC operators, can trigger scans and manage credentials |
| ENGINEER | + devices:write, provision:run | Network engineers, can modify device records and provision |
| ADMIN | + users:read/write, audit:read, vault:admin | System admins, full access including user management |

**Site scoping:** Non-admin users have a `site_id` in their JWT. All device
queries are filtered to that site. Admins have `site_id: null` (all sites).

**Implementation:** Permission checks via `require_permission("devices:read")`
and role checks via `require_role(Role.OPERATOR)` FastAPI dependencies.

## 6. Fernet Encryption for Credentials

**Decision:** Use Fernet symmetric encryption for all secrets at rest.

**Two separate encryption keys:**

| Key | Protects | Rationale for separation |
|-----|----------|------------------------|
| `CREDENTIALS_ENCRYPTION_KEY` | Device SSH passwords, API tokens, SNMP community strings | Compromise of alert contact PII should not expose device credentials |
| `ALERT_CONTACTS_ENCRYPTION_KEY` | Email addresses, phone numbers, Telegram chat IDs | Compromise of device credentials should not expose operator PII |

**Why Fernet:**

- Authenticated encryption (AES-128-CBC + HMAC-SHA256)
- Built-in timestamp for key rotation detection
- Standard library support via `cryptography` package
- No key management infrastructure required (key is an environment variable)

**Encryption points:**

- Vault: `encrypted_value` column -- all credential types
- Alert contacts: `recipient_value`, `whatsapp_sender_number` columns
- Email config: `smtp_username`, `smtp_password` columns

## 7. Audit Trail on All Sensitive Operations

**Decision:** Every sensitive operation is logged to immutable database tables.

**Two audit tables:**

| Table | Scope | Fields |
|-------|-------|--------|
| `audit_logs` | Device and system events | event_type, severity, device_serial, message, source_service, created_at |
| `vault_audit` | Credential access events | vault_id, action, performed_by, source_service, ip_address, created_at |

**Vault audit actions:** `created`, `read`, `updated`, `deleted`, `rotated`

**Design rules:**

- Audit tables are append-only -- no UPDATE or DELETE permissions granted
- Credential values are never written to audit records
- All audit queries are read-only (`GET /vault/{id}/audit`, `GET /alerts`)
- PostgreSQL logs DDL statements and queries exceeding 2 seconds

## 8. Self-Signed TLS for *.aeronet.local

**Decision:** Ship with self-signed certificates; support Let's Encrypt for
production.

**Certificate details:**

- CN: `*.aeronet.local`
- SANs: `aeronet.local`, `*.aeronet.local`
- Key: RSA 2048-bit
- Validity: 365 days
- Generated by: `infra/nginx/generate-certs.sh`

**Important:** The `openssl` command uses separate `-keyout` and `-out` paths.
A previous bug pointed both flags to the same file, producing a combined
PEM that Nginx could not parse.

Correct command:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout infra/nginx/certs/aeronet.key \
  -out    infra/nginx/certs/aeronet.crt \
  -subj   "/CN=*.aeronet.local/O=AeroNet OS/C=US" \
  -addext "subjectAltName=DNS:aeronet.local,DNS:*.aeronet.local"
```

**Nginx TLS hardening (`infra/nginx/nginx.conf`):**

- Protocols: TLSv1.2 and TLSv1.3 only
- Modern cipher suite (no legacy algorithms)
- Session tickets disabled
- Security headers: X-Frame-Options, X-Content-Type-Options, X-XSS-Protection,
  Referrer-Policy

## 9. Why network_mode:host Was Rejected for the Enroller

**Decision:** Use macvlan per-VLAN networks instead of `network_mode: host`.

**Arguments for host mode (rejected):**

- Simpler to configure -- no macvlan networks needed
- Enroller sees all VLAN interfaces automatically
- Works without any Docker network configuration

**Arguments against (decisive):**

| Risk | Impact |
|------|--------|
| Full network namespace access | Enroller can see and interact with every host interface, including management and WAN |
| Port conflicts | Enroller's port 8002 could conflict with host services |
| Firewall bypass | Docker network isolation is completely bypassed; nftables rules on the host apply but container is in the host namespace |
| Violates least privilege | Container has far more network access than it needs |
| Breaks network segmentation | A compromised enroller could scan/attack any network the host can reach |
| Compliance gap | Fails ISO 27001 A.8.20 (network security) and A.8.22 (network segregation) |

**Macvlan gives the enroller exactly the network access it needs** -- one
interface per VLAN, with a static IP on each segment -- and nothing more.

## 10. Password Hashing

**Decision:** bcrypt with 12 rounds for all user passwords.

**Implementation:**

```python
bcrypt.gensalt(rounds=12)
bcrypt.hashpw(password.encode(), salt)
```

**Why bcrypt over alternatives:**

- Argon2: better theoretical properties, but bcrypt is well-understood and
  has excellent library support in Python
- SHA-256/512: not a password hash -- no work factor, vulnerable to GPU attacks
- scrypt: good choice, but bcrypt has wider deployment experience

## 11. SSH on Non-Standard Port

**Decision:** SSH listens on port 2222 instead of 22.

**nftables rate limiting:**

```
iif "OUTSIDE" tcp dport 2222 ct state new meter ssh_limit size 65535 \
    { ip saddr limit rate 5/minute burst 5 packets } accept
```

This is defense-in-depth, not security-through-obscurity. The non-standard
port eliminates noise from automated scanners targeting port 22, and the
rate limit (5 new connections per minute per source IP) mitigates brute-force
attempts. Primary authentication is SSH key-based.

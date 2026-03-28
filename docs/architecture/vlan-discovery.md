# VLAN Discovery Architecture

How AeroNet OS discovers and monitors devices across airport VLAN segments
without granting the application stack direct control over host networking.

## Core Principle

> The UI manages the config DB.
> The engineer applies changes to the OS.
> The enroller reads from the DB.

No container ever writes netplan files, restarts Docker, or modifies host
networking. This separation is deliberate and maps directly to NIST CSF 2.0
and ISO 27001 controls (see below).

## Three-Layer Flow

```
 Layer 1 — UI + API
 ┌──────────────────────────────────────────────┐
 │  Operator adds VLAN in frontend              │
 │  POST /vlans { id: 4, cidr: "192.168.1.0/24",│
 │                gateway: "192.168.1.1",        │
 │                name: "sandbox" }              │
 │  API Gateway writes row to vlans table        │
 └──────────────────┬───────────────────────────┘
                    │
 Layer 2 — Engineer applies to Virgilio OS
 ┌──────────────────┴───────────────────────────┐
 │  1. Engineer generates netplan snippet from   │
 │     UI or copies template (see setup docs)    │
 │  2. sudo netplan apply on Virgilio host       │
 │  3. Engineer adds macvlan block to            │
 │     docker-compose.yml                        │
 │  4. docker compose up -d (recreates enroller) │
 │  5. Engineer marks VLAN "active" in UI        │
 └──────────────────┬───────────────────────────┘
                    │
 Layer 3 — Enroller reads DB at startup
 ┌──────────────────┴───────────────────────────┐
 │  On startup / scheduled interval:             │
 │  1. Query vlans table for active VLANs        │
 │  2. Build SCAN_TARGETS from CIDR list         │
 │  3. Run Nmap scan on each CIDR                │
 │  4. Upsert discovered devices into DB         │
 │  5. Notify on asset changes (moved, new, etc.)│
 └──────────────────────────────────────────────┘
```

## Security Rationale

**Why the API never writes netplan or restarts Docker:**

1. **Blast radius containment** -- a compromised API container cannot alter
   host networking, create new interfaces, or pivot to other VLANs.

2. **Audit trail** -- every VLAN activation requires an engineer's SSH session
   to the host, which is captured by auditd and logged separately from
   application-level audit_logs.

3. **No privilege escalation path** -- the API container runs with `cap_drop: ALL`
   and `no-new-privileges:true`. Even if an attacker gains code execution
   inside the container, there is no path to host-level network changes.

4. **Change management** -- VLAN changes follow a two-person workflow:
   an operator requests in the UI, an engineer applies on the host. This
   prevents unilateral network changes.

## Compliance Control Mapping

### NIST CSF 2.0

| Function | Category | Control | How AeroNet implements it |
|----------|----------|---------|---------------------------|
| Protect | PR.AA | Least privilege | Containers run cap_drop ALL + minimal cap_add |
| Protect | PR.AA | Separation of duties | UI operator cannot apply host config; engineer cannot bypass UI approval |
| Detect | DE.CM | Continuous monitoring | Enroller scans every 30 min, alerts on asset moves |
| Identify | ID.AM | Asset management | Every scan upserts to devices table with serial, vendor, OS |
| Govern | GV.SC | Supply chain risk | No third-party agents on network devices; passive scanning only |

### ISO 27001:2022

| Control | Description | Implementation |
|---------|-------------|----------------|
| A.5.15 | Access control | RBAC: viewer/operator/engineer/admin |
| A.5.3 | Segregation of duties | Three-layer separation (UI / host / scanner) |
| A.8.4 | Access to source code | Git-based, PR reviews, no direct production edits |
| A.8.20 | Network security | Per-VLAN isolation via macvlan, no inter-VLAN routing |
| A.8.22 | Segregation of networks | Each VLAN is a separate macvlan Docker network |
| A.8.15 | Logging | Immutable audit_logs + vault_audit tables |
| A.8.9 | Configuration management | Netplan + docker-compose versioned in Git |

## Macvlan vs network_mode:host

Two approaches were evaluated for giving the enroller container access to
VLAN-tagged traffic:

| Criterion | macvlan | network_mode:host |
|-----------|---------|-------------------|
| Network isolation | Container gets a dedicated IP on the VLAN; isolated from host stack | Container shares host's full network namespace |
| Port conflicts | None -- container has its own IP | Risk of port collisions with host services |
| Attack surface | Container can only see its assigned VLAN | Container can see all host interfaces and traffic |
| Firewall bypass | Cannot bypass host nftables on other interfaces | Bypasses Docker's network isolation entirely |
| Multi-VLAN | One macvlan network per VLAN, each with its own subnet | Container sees all VLANs at once (overprivileged) |
| Compliance | Satisfies A.8.20 (network segregation) | Violates least-privilege and network segregation |

**Decision: macvlan.** Each VLAN gets a dedicated macvlan network in
docker-compose. The enroller connects to each macvlan network and receives
a static IP on that segment. This gives it scan visibility without host-level
network access.

## Per-VLAN Macvlan Network Design

Each active VLAN gets a block in `infra/docker-compose.yml`:

```yaml
networks:
  aeronet-internal:
    driver: bridge

  vlan4-sandbox:
    driver: macvlan
    driver_opts:
      parent: INSIDE.4          # host sub-interface for VLAN 4
    ipam:
      config:
        - subnet: 192.168.1.0/24
          gateway: 192.168.1.1
```

The enroller service connects to each macvlan network:

```yaml
services:
  enroller:
    networks:
      aeronet-internal: {}      # internal service mesh
      vlan4-sandbox:            # VLAN 4 scan access
        ipv4_address: 192.168.1.250
```

The static IP (e.g. `.250`) is chosen from the top of the range to avoid
DHCP conflicts.

## Enroller Dynamic SCAN_TARGETS

The enroller currently reads `SCAN_TARGETS` from the environment variable
at startup:

```python
SCAN_TARGETS = os.getenv("SCAN_TARGETS", "").split(",")
```

This is populated from `.env.secret`:

```
SCAN_TARGETS=192.168.1.0/24
```

**Future enhancement:** read active VLAN CIDRs from the `vlans` database
table at startup and on each scheduled scan interval, replacing the static
environment variable with a dynamic query. This allows operators to add
VLANs in the UI without restarting the enroller container.

The scheduled scan loop will query:

```sql
SELECT cidr FROM vlans WHERE is_active = TRUE;
```

And merge results with any `SCAN_TARGETS` env var entries (for backward
compatibility).

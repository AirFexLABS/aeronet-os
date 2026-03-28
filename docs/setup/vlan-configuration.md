# VLAN Configuration Reference

How to add, configure, and manage VLAN segments in AeroNet OS.

## When to Add a New VLAN

Add a new VLAN when:

- **Network expansion** -- a new building, terminal, or floor is brought online
  and has its own VLAN segment on the airport switch infrastructure
- **New airport segment** -- a new functional zone (operations, security cameras,
  passenger Wi-Fi, IoT sensors) needs separate monitoring
- **Initial deployment** -- VLAN 4 is the standard sandbox segment used during
  setup to validate scanning before connecting production VLANs
- **Lab or staging** -- a test VLAN for validating firmware upgrades or config
  changes before applying to production devices

## Step-by-Step: Adding a New VLAN

This example adds VLAN 10 for a terminal operations segment on 10.10.10.0/24
with gateway 10.10.10.1.

### Step 1 -- Add VLAN in the UI

Log in as an operator or admin. Navigate to VLAN management and create:

| Field | Value |
|-------|-------|
| VLAN ID | 10 |
| Name | terminal-ops |
| CIDR | 10.10.10.0/24 |
| Gateway | 10.10.10.1 |
| Status | pending |

This writes a row to the `vlans` table. No network changes happen yet.

### Step 2 -- Backup and amend netplan config

All VLAN sub-interfaces live in the single `/etc/netplan/50-aeronet.yaml`
file that was created during initial deployment.  **Never create separate
per-VLAN netplan files** -- Netplan merges all YAML files in `/etc/netplan/`
and conflicting keys across files cause silent failures.

First, back up the current config:

```bash
sudo cp /etc/netplan/50-aeronet.yaml \
  /etc/netplan/50-aeronet.yaml.bak.$(date +%Y%m%d%H%M%S)
```

Then open the file and add the new VLAN block under the existing `vlans:`
section:

```bash
sudo nano /etc/netplan/50-aeronet.yaml
```

Add this block (indented under `vlans:`):

```yaml
    INSIDE.10:
      id: 10
      link: INSIDE
      addresses:
        - 10.10.10.250/24
      routes:
        - to: 10.10.10.0/24
          via: 10.10.10.1
          metric: 100
```

**Naming convention:**

- Interface: `INSIDE.{vlan_id}` -- `INSIDE` is the logical trunk interface
  name used consistently across all AeroNet deployments, regardless of the
  physical NIC name (e.g. `enp2s0f1`).  The trunk is always aliased to
  `INSIDE` in the base netplan config so that VLAN sub-interfaces
  (`INSIDE.4`, `INSIDE.10`, etc.) remain portable across hardware.
- Host IP: `.250` from the top of the range to avoid DHCP conflicts
- Routes: only required when a gateway is specified; omit the `routes:`
  block for isolated/unrouted segments

### Step 3 -- Apply netplan on Virgilio

Validate the config first with a dry run (auto-reverts after timeout):

```bash
sudo netplan try --timeout 30
```

If the dry run succeeds, apply permanently:

```bash
sudo netplan apply
```

Verify the interface is up:

```bash
ip addr show INSIDE.10
# Expected: inet 10.10.10.250/24
```

Test connectivity to the gateway:

```bash
ping -c 3 10.10.10.1
```

### Step 4 -- Add macvlan block to docker-compose

Edit `infra/docker-compose.yml`. Add the network definition:

```yaml
networks:
  aeronet-internal:
    driver: bridge

  # ... existing macvlan networks ...

  vlan10-terminal-ops:
    driver: macvlan
    driver_opts:
      parent: INSIDE.10
    ipam:
      config:
        - subnet: 10.10.10.0/24
          gateway: 10.10.10.1
```

Attach the enroller to the new network:

```yaml
services:
  enroller:
    networks:
      aeronet-internal: {}
      # ... existing VLAN networks ...
      vlan10-terminal-ops:
        ipv4_address: 10.10.10.249
```

**IP assignment convention:** Use `.249` for the enroller's macvlan IP
(one below the host's `.250`) to keep them adjacent and predictable.

### Step 5 -- Update SCAN_TARGETS

Add the new CIDR to `.env.secret`:

```
SCAN_TARGETS=192.168.1.0/24,10.10.10.0/24
```

### Step 6 -- Recreate the enroller

```bash
cd /opt/aeronet-os
docker compose -f infra/docker-compose.yml up -d enroller
```

Verify the enroller can reach the new VLAN:

```bash
docker compose -f infra/docker-compose.yml exec enroller \
  ping -c 3 10.10.10.1
```

### Step 7 -- Mark active in UI

Return to VLAN management in the UI and change VLAN 10's status from
`pending` to `active`. The next scheduled scan will include this CIDR.

## Netplan Template

All VLAN sub-interfaces are appended to the single `50-aeronet.yaml` file.
The `link` field always references `INSIDE` -- the logical trunk alias.

```yaml
# Add under the vlans: section in /etc/netplan/50-aeronet.yaml
    INSIDE.{ID}:
      id: {ID}
      link: INSIDE
      addresses:
        - {HOST_IP}/{PREFIX}
      # Include routes only when a gateway is configured:
      routes:
        - to: {CIDR}
          via: {GATEWAY}
          metric: 100
```

| Placeholder | Example | Notes |
|-------------|---------|-------|
| `{ID}` | 10 | 802.1Q VLAN tag |
| `{NAME}` | terminal-ops | Lowercase, hyphenated |
| `{HOST_IP}` | 10.10.10.250 | Pick from top of range |
| `{PREFIX}` | 24 | Subnet prefix length |
| `{CIDR}` | 10.10.10.0/24 | Full CIDR notation |
| `{GATEWAY}` | 10.10.10.1 | Switch/router gateway IP |

## Docker-Compose Macvlan Template

```yaml
# Add to networks: section
vlan{ID}-{NAME}:
  driver: macvlan
  driver_opts:
    parent: INSIDE.{ID}
  ipam:
    config:
      - subnet: {CIDR}
        gateway: {GATEWAY}

# Add to enroller service networks:
vlan{ID}-{NAME}:
  ipv4_address: {ENROLLER_IP}
```

| Placeholder | Example | Notes |
|-------------|---------|-------|
| `{ENROLLER_IP}` | 10.10.10.249 | One below host IP (.250 - 1) |

## Security Considerations Per VLAN Addition

Each new VLAN expands the enroller's network attack surface. Before adding:

1. **Verify the VLAN is trunk-tagged on the switch port** connected to
   Virgilio. Untagged VLANs will not work with macvlan.

2. **Confirm ip_forward remains disabled:**

   ```bash
   sysctl net.ipv4.ip_forward
   # Must show: net.ipv4.ip_forward = 0
   ```

3. **Verify nftables forward policy is still drop:**

   ```bash
   sudo nft list chain inet filter forward | head -2
   # Must show: policy drop
   ```

4. **Review the macvlan IP assignment** -- ensure the enroller's static IP
   does not conflict with existing devices or DHCP ranges on the VLAN.

5. **Verify the audit rule** covers the main netplan config file:

   ```bash
   sudo auditctl -w /etc/netplan/50-aeronet.yaml -p wa -k netplan-changes
   ```

6. **Do not add management VLANs** (switch management, out-of-band) to
   the scan targets unless specifically required and approved. Scanning
   management interfaces can trigger IDS alerts on some switch platforms.

## Rollback Procedure

If a VLAN configuration causes issues (network unreachable, container crash,
scan failures):

### 1. Restore the netplan backup

```bash
# Find the most recent backup
ls -lt /etc/netplan/50-aeronet.yaml.bak.*

# Restore it
sudo cp /etc/netplan/50-aeronet.yaml.bak.<TIMESTAMP> \
  /etc/netplan/50-aeronet.yaml
sudo netplan apply
```

Verify the interface is gone:

```bash
ip addr show INSIDE.10 2>&1
# Expected: "Device "INSIDE.10" does not exist."
```

### 2. Remove the macvlan network from docker-compose

Edit `infra/docker-compose.yml`:

- Remove the `vlan10-terminal-ops:` network definition
- Remove the network from the enroller's `networks:` section

### 3. Remove the CIDR from SCAN_TARGETS

Edit `.env.secret` and remove `10.10.10.0/24` from `SCAN_TARGETS`.

### 4. Recreate the enroller

```bash
docker compose -f infra/docker-compose.yml up -d enroller
```

### 5. Mark inactive in UI

Set the VLAN status back to `pending` or `inactive` in the UI.

### 6. Verify

```bash
# Enroller is healthy
docker compose -f infra/docker-compose.yml ps enroller

# No leftover Docker network
docker network ls | grep vlan10
# Should return nothing

# Enroller logs show no errors
docker compose -f infra/docker-compose.yml logs enroller --tail=10
```

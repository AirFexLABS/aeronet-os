import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import type { Vlan, VlanCreate, VlanStatus } from "../api/client";

// ── Status badge config ─────────────────────────────────────────────────

const STATUS_STYLES: Record<VlanStatus, string> = {
  pending:  "bg-yellow-900/40 text-yellow-300 border border-yellow-700/50",
  active:   "bg-green-900/40 text-green-300 border border-green-700/50",
  error:    "bg-red-900/40 text-red-300 border border-red-700/50",
  disabled: "bg-gray-800/60 text-gray-400 border border-gray-700/50",
};

function VlanStatusBadge({ status }: { status: VlanStatus }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.disabled}`}
    >
      {status}
    </span>
  );
}

// ── IP / CIDR helpers ───────────────────────────────────────────────────

function parseIpMask(input: string): { ip: string; prefix: number; network: string } | null {
  const match = input.trim().match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);
  if (!match) return null;

  const ip = match[1];
  const prefix = parseInt(match[2], 10);
  if (prefix < 1 || prefix > 32) return null;

  const octets = ip.split(".").map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;

  // Derive network address by zeroing host bits
  const ipNum = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const netNum = (ipNum & mask) >>> 0;

  const network = [
    (netNum >>> 24) & 0xff,
    (netNum >>> 16) & 0xff,
    (netNum >>> 8) & 0xff,
    netNum & 0xff,
  ].join(".");

  return { ip, prefix, network: `${network}/${prefix}` };
}

// ── Helpers ──────────────────────────────────────────────────────────────

function nextIp(ip: string): string {
  const parts = ip.split(".").map(Number);
  parts[3] = Math.min(parts[3] + 1, 254);
  return parts.join(".");
}

// ── Setup instructions generator ────────────────────────────────────────

function scanTargetsSnippet(v: Vlan): string {
  return `# In .env.secret, add this CIDR to SCAN_TARGETS:
SCAN_TARGETS=...,${v.cidr}

# Or rely on the vlans table (no env change needed if
# the VLAN is marked active with scan_enabled=true).`;
}

function applyCommandsSnippet(v: Vlan): string {
  const ip = v.interface_ip ?? v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".250");
  const prefix = v.cidr.split("/")[1] ?? "24";
  const enrIp = v.interface_ip
    ? nextIp(v.interface_ip)
    : v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".254");
  const routesBlock = v.gateway
    ? `'routes': [{'to': '${v.cidr}', 'via': '${v.gateway}', 'metric': 100}],`
    : "";
  const gwIpamBlock = v.gateway
    ? `'gateway': '${v.gateway}'`
    : "";
  const gwPingStep = v.gateway
    ? `\n# 9. Test Layer 2 connectivity to gateway\ndocker exec infra-enroller-1 ping -c 3 ${v.gateway}`
    : "";
  return `# ⚠️  Run steps in order. Each step validates before proceeding.
#    Backups are created automatically before any file is modified.
#    If netplan validation fails, the original config is restored automatically.

# 1. Backup current netplan config
sudo cp /etc/netplan/50-aeronet.yaml \\
  /etc/netplan/50-aeronet.yaml.bak.$(date +%Y%m%d%H%M%S)

# 2. Add VLAN block to netplan using Python
sudo python3 << 'PYEOF'
import yaml, sys

NETPLAN_PATH = '/etc/netplan/50-aeronet.yaml'

with open(NETPLAN_PATH, 'r') as f:
    config = yaml.safe_load(f)

if 'INSIDE.${v.vlan_id}' in config.get('network', {}).get('vlans', {}):
    print("ERROR: INSIDE.${v.vlan_id} already exists. Aborting.")
    sys.exit(1)

if 'vlans' not in config['network']:
    config['network']['vlans'] = {}

config['network']['vlans']['INSIDE.${v.vlan_id}'] = {
    'id': ${v.vlan_id},
    'link': 'INSIDE',
    'addresses': ['${ip}/${prefix}'],
    ${routesBlock}
}

import shutil, datetime
ts = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
shutil.copy(NETPLAN_PATH, f"{NETPLAN_PATH}.bak.{ts}")

with open(NETPLAN_PATH, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)

print("OK: INSIDE.${v.vlan_id} added to netplan config.")
PYEOF

# 3. Validate before applying (dry run — auto-reverts on failure)
sudo netplan try --timeout 30

# 4. Apply only if validation passed
if [ $? -eq 0 ]; then
    sudo netplan apply
    echo "OK: netplan applied, INSIDE.${v.vlan_id} active."
else
    echo "ERROR: netplan validation failed. Restoring backup."
    sudo cp /etc/netplan/50-aeronet.yaml.bak.* \\
      /etc/netplan/50-aeronet.yaml
    sudo netplan apply
    echo "RESTORED: original config reapplied."
fi

# 5. Verify interface is up
ip addr show ${v.interface}

# 6. Add macvlan network to docker-compose.yml using Python
python3 << 'PYEOF'
import yaml, sys, shutil, datetime

COMPOSE_PATH = '/opt/aeronet-os/infra/docker-compose.yml'

with open(COMPOSE_PATH, 'r') as f:
    config = yaml.safe_load(f)

network_key = 'vlan${v.vlan_id}_monitor'

if network_key in config.get('networks', {}):
    print(f"INFO: {network_key} already exists in networks. Skipping.")
else:
    config.setdefault('networks', {})[network_key] = {
        'driver': 'macvlan',
        'driver_opts': {'parent': 'INSIDE.${v.vlan_id}'},
        'ipam': {
            'config': [{
                'subnet': '${v.cidr}',
                ${gwIpamBlock}
            }]
        }
    }
    print(f"OK: {network_key} added to networks section.")

enroller = config.get('services', {}).get('enroller', {})
svc_networks = enroller.get('networks', {})

if isinstance(svc_networks, dict):
    if network_key not in svc_networks:
        svc_networks[network_key] = {
            'ipv4_address': '${enrIp}'
        }
        print(f"OK: {network_key} added to enroller service.")
    else:
        print(f"INFO: {network_key} already in enroller service. Skipping.")
elif isinstance(svc_networks, list):
    if network_key not in svc_networks:
        svc_networks.append(network_key)
        print(f"OK: {network_key} added to enroller service.")

ts = datetime.datetime.now().strftime('%Y%m%d%H%M%S')
shutil.copy(COMPOSE_PATH, f"{COMPOSE_PATH}.bak.{ts}")
with open(COMPOSE_PATH, 'w') as f:
    yaml.dump(config, f, default_flow_style=False, allow_unicode=True)

print("OK: docker-compose.yml updated and backed up.")
PYEOF

# 7. Restart enroller to attach to new macvlan network
cd /opt/aeronet-os
docker compose -f infra/docker-compose.yml --env-file .env.secret up -d enroller

# 8. Verify enroller has the new interface IP
docker exec infra-enroller-1 hostname -I${gwPingStep}`;
}

// ── Copy button ─────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                 hover:text-primary hover:border-white/20 transition-colors"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

// ── Instructions modal ──────────────────────────────────────────────────

const TABS = ["Apply Commands", "SCAN_TARGETS"] as const;
type TabKey = (typeof TABS)[number];

function InstructionsModal({
  vlan,
  onClose,
}: {
  vlan: Vlan;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("Apply Commands");

  const snippets: Record<TabKey, { header: string; code: string }> = {
    "Apply Commands": {
      header: "Run this script on the Virgilio host to configure netplan + docker-compose:",
      code: applyCommandsSnippet(vlan),
    },
    SCAN_TARGETS: {
      header: "Update scan targets (optional if using DB-driven scanning):",
      code: scanTargetsSnippet(vlan),
    },
  };

  const current = snippets[tab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-white/10 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-primary">
              Setup Instructions
            </h2>
            <p className="text-xs text-secondary mt-0.5">
              VLAN {vlan.vlan_id} &mdash; {vlan.name} ({vlan.cidr})
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors text-xl"
          >
            &times;
          </button>
        </div>

        <div className="flex border-b border-white/10 px-6">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                tab === t
                  ? "border-primary text-primary"
                  : "border-transparent text-secondary hover:text-primary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-6">
          <p className="text-sm text-secondary mb-3">{current.header}</p>
          <div className="relative">
            <div className="absolute top-2 right-2">
              <CopyButton text={current.code} />
            </div>
            <pre className="bg-background border border-white/10 rounded-lg p-4 text-xs text-primary font-mono overflow-x-auto whitespace-pre">
              {current.code}
            </pre>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-white/10 text-secondary
                       hover:text-primary hover:border-white/20 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirmation modal ───────────────────────────────────────────

function DeleteModal({
  vlan,
  onClose,
  onConfirm,
}: {
  vlan: Vlan;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  const expected = `DELETE ${vlan.name}`;
  const canConfirm = typed === expected;

  const handleDelete = async () => {
    setDeleting(true);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-white/10 rounded-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-red-400">Delete VLAN</h2>
          <p className="text-xs text-secondary mt-1">
            This will permanently delete VLAN {vlan.vlan_id} ({vlan.name}) and
            its configuration. This action cannot be undone.
          </p>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-secondary mb-2">
            Type <span className="font-mono text-primary">{expected}</span> to
            confirm:
          </p>
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={expected}
            className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                       focus:outline-none focus:border-red-500/50"
          />
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-white/10 text-secondary
                       hover:text-primary hover:border-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={!canConfirm || deleting}
            className="px-4 py-2 text-sm rounded-lg bg-red-600/90 hover:bg-red-600 text-white
                       transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting..." : "Delete VLAN"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit slide-over ────────────────────────────────────────────

function VlanForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: Vlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;

  const [vlanId, setVlanId] = useState(initial?.vlan_id ?? 0);
  const [name, setName] = useState(initial?.name ?? "");
  const [ipMask, setIpMask] = useState(() => {
    if (initial?.interface_ip && initial?.cidr) {
      const prefix = initial.cidr.split("/")[1] ?? "24";
      return `${initial.interface_ip}/${prefix}`;
    }
    return "";
  });
  const [gateway, setGateway] = useState(initial?.gateway ?? "");
  const [iface, setIface] = useState(initial?.interface ?? "");
  const [scanEnabled, setScanEnabled] = useState(initial?.scan_enabled ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Auto-fill interface when vlan_id changes (only in create mode)
  useEffect(() => {
    if (!isEdit && vlanId > 0) {
      setIface(`INSIDE.${vlanId}`);
    }
  }, [vlanId, isEdit]);

  // Derive network CIDR and interface IP from the IP/mask input
  const derived = useMemo(() => parseIpMask(ipMask), [ipMask]);

  const handleSave = async () => {
    setError("");

    if (!vlanId || vlanId < 1) {
      setError("VLAN ID must be a positive integer");
      return;
    }
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!derived) {
      setError("Interface IP / Mask must be in format x.x.x.x/xx (e.g. 192.168.1.50/24)");
      return;
    }
    if (!iface.trim()) {
      setError("Interface is required");
      return;
    }

    setSaving(true);
    try {
      const payload: VlanCreate = {
        vlan_id: vlanId,
        name: name.trim(),
        cidr: derived.network,
        gateway: gateway.trim() || undefined,
        interface: iface.trim(),
        interface_ip: derived.ip,
        scan_enabled: scanEnabled,
        notes: notes.trim() || undefined,
      };

      if (isEdit && initial) {
        await api.vlans.update(initial.id, payload);
      } else {
        await api.vlans.create(payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute top-0 right-0 h-full w-full max-w-md bg-surface border-l border-white/10 flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">
            {isEdit ? "Edit VLAN" : "Add VLAN"}
          </h2>
          <button
            onClick={onClose}
            className="text-secondary hover:text-primary transition-colors text-xl"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4">
          {error && (
            <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 text-red-300 text-xs">
              {error}
            </div>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary flex items-center gap-1.5">
              VLAN ID
              {isEdit && (
                <span className="text-secondary/50" title="VLAN ID cannot be changed after creation">
                  &#x1F512;
                </span>
              )}
            </span>
            <input
              type="number"
              min={1}
              max={4094}
              value={vlanId || ""}
              onChange={(e) => setVlanId(parseInt(e.target.value) || 0)}
              disabled={isEdit}
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed"
              title={isEdit ? "VLAN ID cannot be changed after creation" : undefined}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="sandbox"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Interface</span>
            <input
              type="text"
              value={iface}
              onChange={(e) => setIface(e.target.value)}
              placeholder="INSIDE.4"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Interface IP / Mask</span>
            <input
              type="text"
              value={ipMask}
              onChange={(e) => setIpMask(e.target.value)}
              placeholder="192.168.1.50/24"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
            {ipMask && !derived && (
              <p className="text-xs text-red-400 mt-0.5">
                Invalid format. Use x.x.x.x/xx (e.g. 192.168.1.50/24)
              </p>
            )}
            {derived && (
              <div className="mt-1 bg-background/50 border border-white/5 rounded-lg px-3 py-2 flex flex-col gap-0.5">
                <p className="text-xs text-secondary">
                  Network CIDR:{" "}
                  <span className="font-mono text-primary">{derived.network}</span>
                </p>
                <p className="text-xs text-secondary">
                  Interface will be assigned:{" "}
                  <span className="font-mono text-primary">{derived.ip}</span>
                </p>
              </div>
            )}
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Gateway</span>
            <input
              type="text"
              value={gateway}
              onChange={(e) => setGateway(e.target.value)}
              placeholder="192.168.1.1"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={scanEnabled}
              onChange={(e) => setScanEnabled(e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm text-primary">Scan enabled</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Notes</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50 resize-none"
            />
          </label>
        </div>

        <div className="px-6 py-3 border-t border-white/10 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-white/10 text-secondary
                       hover:text-primary hover:border-white/20 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-primary/90 hover:bg-primary text-white
                       transition-colors disabled:opacity-40"
          >
            {saving ? "Saving..." : isEdit ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

export function VlanManager() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isAdmin = user?.role === "admin";
  const isEngineerOrAdmin =
    user?.role === "admin" || user?.role === "engineer";

  // Redirect non-engineer/admin users
  useEffect(() => {
    if (user && !isEngineerOrAdmin) {
      navigate("/", { replace: true });
    }
  }, [user, isEngineerOrAdmin, navigate]);

  const [vlans, setVlans] = useState<Vlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal / slide-over state
  const [showForm, setShowForm] = useState(false);
  const [editVlan, setEditVlan] = useState<Vlan | null>(null);
  const [instructionsVlan, setInstructionsVlan] = useState<Vlan | null>(null);
  const [deleteVlan, setDeleteVlan] = useState<Vlan | null>(null);

  const loadVlans = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.vlans.list();
      setVlans(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load VLANs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadVlans();
  }, [loadVlans]);

  const handleStatusChange = async (vlan: Vlan, status: VlanStatus) => {
    try {
      await api.vlans.patchStatus(vlan.id, status);
      await loadVlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    }
  };

  const handleDelete = async (vlan: Vlan) => {
    try {
      await api.vlans.delete(vlan.id);
      setDeleteVlan(null);
      await loadVlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  if (user && !isEngineerOrAdmin) return null;

  return (
    <div>
      <PageHeader
        title="VLAN Segments"
        subtitle="Configure network segments for discovery"
        action={
          isAdmin ? (
            <button
              onClick={() => {
                setEditVlan(null);
                setShowForm(true);
              }}
              className="px-4 py-2 text-sm rounded-lg bg-primary/90 hover:bg-primary text-white transition-colors"
            >
              + Add VLAN
            </button>
          ) : undefined
        }
      />

      {error && (
        <div className="mb-4 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 text-red-300 text-xs">
          {error}
        </div>
      )}

      {loading && (
        <p className="text-secondary text-sm">Loading...</p>
      )}

      {!loading && vlans.length === 0 && (
        <EmptyState message="No VLANs configured. Add a VLAN segment to start network discovery." />
      )}

      {!loading && vlans.length > 0 && (
        <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs text-secondary uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-medium">VLAN ID</th>
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Interface</th>
                  <th className="text-left px-4 py-3 font-medium">CIDR</th>
                  <th className="text-left px-4 py-3 font-medium">Interface IP</th>
                  <th className="text-left px-4 py-3 font-medium">Gateway</th>
                  <th className="text-left px-4 py-3 font-medium">Scan</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {vlans.map((v) => (
                  <tr
                    key={v.id}
                    className="border-b border-white/5 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-primary">
                      {v.vlan_id}
                    </td>
                    <td className="px-4 py-3 text-primary">{v.name}</td>
                    <td className="px-4 py-3 font-mono text-secondary text-xs">
                      {v.interface}
                    </td>
                    <td className="px-4 py-3 font-mono text-secondary text-xs">
                      {v.cidr}
                    </td>
                    <td className="px-4 py-3 font-mono text-secondary text-xs">
                      {v.interface_ip ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3 font-mono text-secondary text-xs">
                      {v.gateway ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3">
                      {v.scan_enabled ? (
                        <span className="text-green-400 text-xs">On</span>
                      ) : (
                        <span className="text-gray-500 text-xs">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <VlanStatusBadge status={v.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setInstructionsVlan(v)}
                          className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                                     hover:text-primary hover:border-white/20 transition-colors"
                        >
                          Setup
                        </button>
                        {isAdmin && v.status !== "active" && (
                          <button
                            onClick={() => handleStatusChange(v, "active")}
                            className="px-2 py-1 text-xs rounded border border-green-700/50 text-green-400
                                       hover:bg-green-900/30 transition-colors"
                          >
                            Activate
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => {
                              setEditVlan(v);
                              setShowForm(true);
                            }}
                            className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                                       hover:text-primary hover:border-white/20 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {isAdmin && v.status !== "disabled" && (
                          <button
                            onClick={() => handleStatusChange(v, "disabled")}
                            className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                                       hover:text-alert-critical hover:border-red-700/50 transition-colors"
                          >
                            Disable
                          </button>
                        )}
                        {isAdmin && (
                          <button
                            onClick={() => setDeleteVlan(v)}
                            className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                                       hover:text-red-400 hover:border-red-700/50 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Slide-over: create / edit form */}
      {showForm && (
        <VlanForm
          initial={editVlan}
          onClose={() => {
            setShowForm(false);
            setEditVlan(null);
          }}
          onSaved={loadVlans}
        />
      )}

      {/* Modal: setup instructions */}
      {instructionsVlan && (
        <InstructionsModal
          vlan={instructionsVlan}
          onClose={() => setInstructionsVlan(null)}
        />
      )}

      {/* Modal: delete confirmation */}
      {deleteVlan && (
        <DeleteModal
          vlan={deleteVlan}
          onClose={() => setDeleteVlan(null)}
          onConfirm={() => handleDelete(deleteVlan)}
        />
      )}
    </div>
  );
}

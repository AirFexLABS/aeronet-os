import { useState, useEffect, useCallback } from "react";
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

// ── Setup instructions generator ────────────────────────────────────────

function netplanSnippet(v: Vlan): string {
  return `# /etc/netplan/60-vlan${v.vlan_id}-${v.name}.yaml
network:
  version: 2
  vlans:
    ${v.interface}:
      id: ${v.vlan_id}
      link: INSIDE
      addresses:
        - ${v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".250")}/${v.cidr.split("/")[1] ?? "24"}
      routes:
        - to: ${v.cidr}
          via: ${v.gateway ?? v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".1")}
          metric: 100`;
}

function dockerComposeSnippet(v: Vlan): string {
  const enrIp = v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".50");
  return `# Add to networks: section in infra/docker-compose.yml
  vlan${v.vlan_id}_monitor:
    driver: macvlan
    driver_opts:
      parent: ${v.interface}
    ipam:
      config:
        - subnet: ${v.cidr}
          gateway: ${v.gateway ?? v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".1")}

# Add to enroller service networks:
    networks:
      aeronet-internal:
      vlan${v.vlan_id}_monitor:
        ipv4_address: ${enrIp}`;
}

function scanTargetsSnippet(v: Vlan): string {
  return `# In .env.secret, add this CIDR to SCAN_TARGETS:
SCAN_TARGETS=...,${v.cidr}

# Or rely on the vlans table (no env change needed if
# the VLAN is marked active with scan_enabled=true).`;
}

function applyCommandsSnippet(v: Vlan): string {
  return `# 1. Apply netplan
sudo netplan apply
ip addr show ${v.interface}

# 2. Restart enroller with new macvlan network
cd /opt/aeronet-os
docker compose -f infra/docker-compose.yml up -d enroller

# 3. Verify connectivity
docker compose -f infra/docker-compose.yml exec enroller \\
  ping -c 3 ${v.gateway ?? v.cidr.replace(/\/\d+$/, "").replace(/\.\d+$/, ".1")}`;
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

const TABS = ["Netplan", "Docker Compose", "SCAN_TARGETS", "Apply Commands"] as const;
type TabKey = (typeof TABS)[number];

function InstructionsModal({
  vlan,
  onClose,
}: {
  vlan: Vlan;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<TabKey>("Netplan");

  const snippets: Record<TabKey, { header: string; code: string }> = {
    Netplan: {
      header: "Create this file on the Virgilio host:",
      code: netplanSnippet(vlan),
    },
    "Docker Compose": {
      header: "Add these blocks to infra/docker-compose.yml:",
      code: dockerComposeSnippet(vlan),
    },
    SCAN_TARGETS: {
      header: "Update scan targets (optional if using DB-driven scanning):",
      code: scanTargetsSnippet(vlan),
    },
    "Apply Commands": {
      header: "Run these commands on the Virgilio host to activate:",
      code: applyCommandsSnippet(vlan),
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

  const [form, setForm] = useState<VlanCreate>({
    vlan_id:      initial?.vlan_id ?? 0,
    name:         initial?.name ?? "",
    cidr:         initial?.cidr ?? "",
    gateway:      initial?.gateway ?? "",
    interface:    initial?.interface ?? "",
    scan_enabled: initial?.scan_enabled ?? true,
    notes:        initial?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Auto-fill interface when vlan_id changes (only in create mode)
  useEffect(() => {
    if (!isEdit && form.vlan_id > 0) {
      setForm((f) => ({ ...f, interface: `INSIDE.${f.vlan_id}` }));
    }
  }, [form.vlan_id, isEdit]);

  const handleSave = async () => {
    setError("");

    if (!form.vlan_id || form.vlan_id < 1) {
      setError("VLAN ID must be a positive integer");
      return;
    }
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(form.cidr)) {
      setError("CIDR must be in format x.x.x.x/xx");
      return;
    }
    if (!form.interface.trim()) {
      setError("Interface is required");
      return;
    }

    setSaving(true);
    try {
      if (isEdit && initial) {
        await api.vlans.update(initial.id, form);
      } else {
        await api.vlans.create(form);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof VlanCreate, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));

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
            <span className="text-xs text-secondary">VLAN ID</span>
            <input
              type="number"
              min={1}
              max={4094}
              value={form.vlan_id || ""}
              onChange={(e) => set("vlan_id", parseInt(e.target.value) || 0)}
              disabled={isEdit}
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50 disabled:opacity-40"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Name</span>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="sandbox"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Interface</span>
            <input
              type="text"
              value={form.interface}
              onChange={(e) => set("interface", e.target.value)}
              placeholder="INSIDE.4"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">CIDR</span>
            <input
              type="text"
              value={form.cidr}
              onChange={(e) => set("cidr", e.target.value)}
              placeholder="192.168.1.0/24"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Gateway</span>
            <input
              type="text"
              value={form.gateway ?? ""}
              onChange={(e) => set("gateway", e.target.value)}
              placeholder="192.168.1.1"
              className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                         focus:outline-none focus:border-primary/50"
            />
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.scan_enabled ?? true}
              onChange={(e) => set("scan_enabled", e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            <span className="text-sm text-primary">Scan enabled</span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-secondary">Notes</span>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
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
    </div>
  );
}

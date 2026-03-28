import { useState } from "react";
import { StatusBadge } from "../components/ui/StatusBadge";
import { useNavigate } from "react-router-dom";
import { useDevices } from "../hooks/useDevices";
import { DataTable } from "../components/ui/DataTable";

import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import type { Device } from "../api/client";

// ── Delete confirmation modal ───────────────────────────────────────────

function DeleteDeviceModal({
  device,
  onClose,
  onConfirm,
}: {
  device: Device;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  const expected = `DELETE ${device.serial_number}`;
  const canConfirm = typed === expected;

  const handleDelete = () => {
    setDeleting(true);
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-surface border border-white/10 rounded-xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-red-400">Delete Device</h2>
          <div className="mt-2 text-xs text-secondary flex flex-col gap-1">
            <p>
              <span className="text-secondary/60">Serial:</span>{" "}
              <span className="font-mono text-primary">
                {device.serial_number}
              </span>
            </p>
            <p>
              <span className="text-secondary/60">Hostname:</span>{" "}
              <span className="text-primary">{device.hostname}</span>
            </p>
            <p>
              <span className="text-secondary/60">IP:</span>{" "}
              <span className="font-mono text-primary">
                {device.ip_address}
              </span>
            </p>
          </div>
          <p className="text-xs text-secondary mt-3">
            This will remove the device from inventory and audit logs will be
            preserved. This action cannot be undone.
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
            {deleting ? "Deleting..." : "Delete Device"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────

export function Devices() {
  const { devices, isLoading, refresh } = useDevices();
  const navigate = useNavigate();
  const { user } = useAuth();

  const canDelete = user?.role === "admin" || user?.role === "engineer";
  const [deleteDevice, setDeleteDevice] = useState<Device | null>(null);
  const [error, setError] = useState("");

  const handleDelete = async (d: Device) => {
    try {
      await api.devices.delete(d.serial_number);
      setDeleteDevice(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleteDevice(null);
    }
  };

  if (isLoading)
    return <p className="text-secondary text-sm">Loading...</p>;

  return (
    <div>
      <PageHeader
        title="Device inventory"
        subtitle={`${devices.length} devices`}
      />

      {error && (
        <div className="mb-4 bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2 text-red-300 text-xs">
          {error}
        </div>
      )}

      {devices.length === 0 ? (
        <EmptyState message="No devices discovered yet. Trigger a scan to populate inventory." />
      ) : (
        <DataTable<Device>
          rows={devices}
          rowKey={(d) => d.serial_number}
          onRowClick={(d) => navigate(`/devices/${d.serial_number}`)}
          filterKeys={["serial_number", "hostname", "ip_address", "site_id"]}
          columns={[
            { key: "serial_number", label: "Serial", sortable: true },
            { key: "hostname", label: "Hostname", sortable: true },
            { key: "ip_address", label: "IP", sortable: true },
            { key: "device_type", label: "Type", sortable: true },
            { key: "site_id", label: "Site", sortable: true },
            {
              key: "vendor",
              label: "Vendor",
              sortable: true,
              render: (d) => (
                <span className="text-secondary text-xs">
                  {d.vendor && d.vendor !== "unknown" ? d.vendor : "\u2014"}
                </span>
              ),
            },
            {
              key: "os_guess",
              label: "OS / Fingerprint",
              sortable: true,
              render: (d) => {
                const os =
                  d.os_guess && d.os_guess !== "unknown" ? d.os_guess : "";
                if (!os)
                  return (
                    <span className="text-secondary text-xs">{"\u2014"}</span>
                  );
                const truncated =
                  os.length > 40 ? os.slice(0, 40) + "\u2026" : os;
                return (
                  <span className="text-secondary text-xs" title={os}>
                    {truncated}
                  </span>
                );
              },
            },
            {
              key: "status",
              label: "Status",
              sortable: true,
              render: (d) => <StatusBadge status={d.status} />,
            },
            {
              key: "last_seen",
              label: "Last seen",
              render: (d) => (
                <span className="text-secondary text-xs">
                  {new Date(d.last_seen).toLocaleString()}
                </span>
              ),
            },
            ...(canDelete
              ? [
                  {
                    key: "_actions" as keyof Device,
                    label: "",
                    render: (d: Device) => (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteDevice(d);
                        }}
                        className="px-2 py-1 text-xs rounded border border-white/10 text-secondary
                                   hover:text-red-400 hover:border-red-700/50 transition-colors"
                      >
                        Delete
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}

      {deleteDevice && (
        <DeleteDeviceModal
          device={deleteDevice}
          onClose={() => setDeleteDevice(null)}
          onConfirm={() => handleDelete(deleteDevice)}
        />
      )}
    </div>
  );
}

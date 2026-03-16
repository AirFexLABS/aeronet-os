import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { api } from "../api/client";
import type { DiscoveredDevice, Device } from "../api/client";

// ── Device class config ──────────────────────────────────────────────────
const CLASS_CONFIG: Record<
  string,
  { icon: string; label: string; color: string }
> = {
  router:  { icon: "\u{1F500}", label: "Router",  color: "text-blue-400"   },
  switch:  { icon: "\u{1F517}", label: "Switch",  color: "text-green-400"  },
  ap:      { icon: "\u{1F4E1}", label: "AP",      color: "text-yellow-400" },
  server:  { icon: "\u{1F5A5}\uFE0F", label: "Server",  color: "text-purple-400" },
  printer: { icon: "\u{1F5A8}\uFE0F", label: "Printer", color: "text-gray-400"   },
  unknown: { icon: "\u2753", label: "Unknown", color: "text-secondary"   },
};

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

type DeviceClass = DiscoveredDevice["device_class"];
type FilterKey = "all" | DeviceClass;
type Phase = "scan" | "results" | "registering" | "done";

interface RegEntry {
  device: DiscoveredDevice;
  serial_number: string;
  device_type: string;
  site_id: string;
  new_site: string;
  monitor: "connectivity" | "performance" | "both";
}

interface RegResult {
  serial: string;
  ip: string;
  hostname: string;
  success: boolean;
  error?: string;
}

export function Discovery() {
  const navigate = useNavigate();

  // ── Scan state ─────────────────────────────────────────────────────
  const [cidr, setCidr] = useState("");
  const [timeout, setTimeout_] = useState(30);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState("");
  const [results, setResults] = useState<DiscoveredDevice[]>([]);
  const [phase, setPhase] = useState<Phase>("scan");

  // ── Selection & filter ─────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<FilterKey>("all");

  // ── Registration state ─────────────────────────────────────────────
  const [regEntries, setRegEntries] = useState<Map<string, RegEntry>>(new Map());
  const [sites, setSites] = useState<string[]>([]);
  const [existingDevices, setExistingDevices] = useState<Device[]>([]);
  const [regResults, setRegResults] = useState<RegResult[]>([]);
  const [regInProgress, setRegInProgress] = useState(false);
  const [regProgress, setRegProgress] = useState<Map<string, "pending" | "success" | "error">>(new Map());

  // ── Load sites & existing devices on mount ─────────────────────────
  useEffect(() => {
    api.discover.sites().then(setSites).catch(() => {});
    api.devices.list().then(setExistingDevices).catch(() => {});
  }, []);

  const existingIPs = useMemo(
    () => new Set(existingDevices.map((d) => d.ip_address)),
    [existingDevices]
  );

  const existingSerials = useMemo(
    () => new Set(existingDevices.map((d) => d.serial_number)),
    [existingDevices]
  );

  // ── Filtered results ──────────────────────────────────────────────
  const filtered = useMemo(
    () =>
      filter === "all"
        ? results
        : results.filter((d) => d.device_class === filter),
    [results, filter]
  );

  const alreadyMonitored = useMemo(
    () => results.filter((d) => existingIPs.has(d.ip)),
    [results, existingIPs]
  );

  const newDevices = useMemo(
    () => results.filter((d) => !existingIPs.has(d.ip)),
    [results, existingIPs]
  );

  // ── CIDR validation ───────────────────────────────────────────────
  const cidrValid = CIDR_RE.test(cidr);
  const isLargeSubnet = cidrValid && parseInt(cidr.split("/")[1], 10) <= 16;

  // ── Scan handler ──────────────────────────────────────────────────
  async function handleScan() {
    if (!cidrValid) return;
    setScanError("");
    setScanning(true);
    setResults([]);
    setSelected(new Set());
    setPhase("scan");
    try {
      const data = await api.discover.scan({ cidr, timeout });
      setResults(data);
      setPhase("results");
      // Pre-build registration entries
      const entries = new Map<string, RegEntry>();
      for (const d of data) {
        entries.set(d.ip, {
          device: d,
          serial_number: `MAC-${d.mac.replace(/:/g, "").toUpperCase()}`,
          device_type: d.device_class === "unknown" ? "other" : d.device_class,
          site_id: sites[0] ?? "default",
          new_site: "",
          monitor: "both",
        });
      }
      setRegEntries(entries);
    } catch (err: unknown) {
      setScanError(err instanceof Error ? err.message : "Scan failed");
      setPhase("results");
    } finally {
      setScanning(false);
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────
  function toggleSelect(ip: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ip)) next.delete(ip);
      else next.add(ip);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filtered.map((d) => d.ip)));
  }

  function deselectAll() {
    setSelected(new Set());
  }

  // ── Reg entry updater ─────────────────────────────────────────────
  function updateReg(ip: string, patch: Partial<RegEntry>) {
    setRegEntries((prev) => {
      const next = new Map(prev);
      const entry = next.get(ip);
      if (entry) next.set(ip, { ...entry, ...patch });
      return next;
    });
  }

  // ── Registration handler ──────────────────────────────────────────
  async function handleRegister() {
    setRegInProgress(true);
    setPhase("registering");
    const results: RegResult[] = [];

    // Initialize all as pending
    const progress = new Map<string, "pending" | "success" | "error">();
    for (const ip of selected) progress.set(ip, "pending");
    setRegProgress(new Map(progress));

    for (const ip of selected) {
      const entry = regEntries.get(ip);
      if (!entry) continue;

      const siteId = entry.site_id === "__new__" ? entry.new_site : entry.site_id;

      // Check serial uniqueness
      if (existingSerials.has(entry.serial_number)) {
        results.push({
          serial: entry.serial_number,
          ip,
          hostname: entry.device.hostname,
          success: false,
          error: "Serial number already exists",
        });
        progress.set(ip, "error");
        setRegProgress(new Map(progress));
        continue;
      }

      try {
        await api.register.device({
          serial_number: entry.serial_number,
          hostname: entry.device.hostname || `device-${ip}`,
          ip_address: ip,
          device_type: entry.device_type,
          site_id: siteId,
          status: "active",
        });
        results.push({
          serial: entry.serial_number,
          ip,
          hostname: entry.device.hostname,
          success: true,
        });
        progress.set(ip, "success");
        setRegProgress(new Map(progress));
      } catch (err: unknown) {
        results.push({
          serial: entry.serial_number,
          ip,
          hostname: entry.device.hostname,
          success: false,
          error: err instanceof Error ? err.message : "Registration failed",
        });
        progress.set(ip, "error");
        setRegProgress(new Map(progress));
      }
    }

    setRegResults(results);
    setRegInProgress(false);
    setPhase("done");
  }

  // ── Reset ─────────────────────────────────────────────────────────
  function reset() {
    setCidr("");
    setResults([]);
    setSelected(new Set());
    setRegEntries(new Map());
    setRegResults([]);
    setRegProgress(new Map());
    setPhase("scan");
    setScanError("");
  }

  // ── Confidence bar ────────────────────────────────────────────────
  function ConfidenceBar({ value }: { value: number }) {
    const color =
      value > 70 ? "bg-green-500" : value >= 40 ? "bg-yellow-500" : "bg-red-500";
    return (
      <div className="flex items-center gap-2">
        <div className="w-16 h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${color}`}
            style={{ width: `${value}%` }}
          />
        </div>
        <span className="text-xs text-secondary">{value}</span>
      </div>
    );
  }

  // ── Filter buttons ────────────────────────────────────────────────
  const filterButtons: { key: FilterKey; label: string }[] = [
    { key: "all", label: "All" },
    { key: "router", label: "Routers" },
    { key: "switch", label: "Switches" },
    { key: "ap", label: "APs" },
    { key: "server", label: "Servers" },
    { key: "unknown", label: "Unknown" },
  ];

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Network Discovery"
        subtitle="Scan a subnet to discover and register devices"
      />

      {/* ── Section 1: Scan Input ──────────────────────────────── */}
      <div className="bg-surface rounded-lg border border-white/10 p-6 mb-6">
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs text-secondary mb-1">
              CIDR Block
            </label>
            <input
              type="text"
              value={cidr}
              onChange={(e) => setCidr(e.target.value)}
              placeholder="10.0.1.0/24"
              className="w-full bg-background border border-white/10 rounded-lg px-3 py-2
                         text-sm text-primary placeholder:text-secondary/40
                         focus:outline-none focus:border-blue-500/50"
            />
            {cidr && !cidrValid && (
              <p className="text-xs text-alert-critical mt-1">
                Invalid CIDR format
              </p>
            )}
            {isLargeSubnet && (
              <p className="text-xs text-alert-warning mt-1">
                Large subnet — scan may take several minutes
              </p>
            )}
          </div>

          <div className="w-40">
            <label className="block text-xs text-secondary mb-1">
              Timeout: {timeout}s
            </label>
            <input
              type="range"
              min={10}
              max={60}
              step={10}
              value={timeout}
              onChange={(e) => setTimeout_(Number(e.target.value))}
              className="w-full accent-blue-500"
            />
            <div className="flex justify-between text-xs text-secondary/40">
              <span>10s</span>
              <span>60s</span>
            </div>
          </div>

          <button
            onClick={handleScan}
            disabled={!cidrValid || scanning}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                       disabled:cursor-not-allowed text-white text-sm font-medium
                       rounded-lg transition-colors"
          >
            {scanning ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Scanning...
              </span>
            ) : (
              "Scan Network"
            )}
          </button>
        </div>

        {scanning && (
          <div className="mt-4 text-sm text-secondary animate-pulse">
            Scanning {cidr}... this may take up to {timeout}s
          </div>
        )}

        {scanError && (
          <div className="mt-4 text-sm text-alert-critical bg-red-900/20 border border-red-700/30 rounded-lg px-4 py-2">
            {scanError}
          </div>
        )}
      </div>

      {/* ── Section 2: Results Table ──────────────────────────── */}
      {phase !== "scan" && !scanning && results.length === 0 && !scanError && (
        <EmptyState message={`No devices found on ${cidr}. Check the network is reachable from the AeroNet enroller container.`} />
      )}

      {phase !== "scan" && results.length > 0 && results.length === alreadyMonitored.length && (
        <div className="bg-surface rounded-lg border border-white/10 p-6 text-center">
          <p className="text-sm text-secondary">
            All devices on this segment are already being monitored.
          </p>
        </div>
      )}

      {results.length > 0 && phase !== "done" && (
        <div className="bg-surface rounded-lg border border-white/10 mb-6">
          {/* Toolbar */}
          <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-3">
            <span className="text-sm text-secondary">
              Found {results.length} devices — {alreadyMonitored.length} already monitored, {newDevices.length} new
            </span>
            <div className="flex-1" />
            <div className="flex gap-1">
              {filterButtons.map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setFilter(key)}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    filter === key
                      ? "bg-blue-600 text-white"
                      : "bg-white/5 text-secondary hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={selected.size === filtered.length ? deselectAll : selectAll}
              className="px-3 py-1 text-xs rounded-lg bg-white/5 text-secondary hover:text-primary transition-colors"
            >
              {selected.size === filtered.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-secondary border-b border-white/10">
                  <th className="px-4 py-2 w-8" />
                  <th className="px-4 py-2 w-8" />
                  <th className="px-4 py-2">IP Address</th>
                  <th className="px-4 py-2">Hostname</th>
                  <th className="px-4 py-2">Vendor</th>
                  <th className="px-4 py-2">OS Guess</th>
                  <th className="px-4 py-2">Open Ports</th>
                  <th className="px-4 py-2">Confidence</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((d) => {
                  const cls = CLASS_CONFIG[d.device_class] ?? CLASS_CONFIG.unknown;
                  const monitored = existingIPs.has(d.ip);
                  return (
                    <tr
                      key={d.ip}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={selected.has(d.ip)}
                          onChange={() => toggleSelect(d.ip)}
                          disabled={monitored}
                          className="accent-blue-500"
                        />
                      </td>
                      <td className={`px-4 py-2 ${cls.color}`} title={cls.label}>
                        {cls.icon}
                      </td>
                      <td className="px-4 py-2 text-primary font-mono text-xs">
                        {d.ip}
                      </td>
                      <td className="px-4 py-2 text-primary">{d.hostname || "—"}</td>
                      <td className="px-4 py-2 text-primary">{d.vendor}</td>
                      <td className="px-4 py-2 text-secondary text-xs">
                        {d.os_guess}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {d.open_ports.map((p) => (
                            <span
                              key={p}
                              className="px-1.5 py-0.5 text-xs bg-white/10 rounded text-secondary"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2">
                        <ConfidenceBar value={d.confidence} />
                      </td>
                      <td className="px-4 py-2">
                        {monitored ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-300 border border-green-700/50">
                            Monitored
                          </span>
                        ) : (
                          <span className="text-xs text-secondary">New</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Section 3: Registration Panel ─────────────────────── */}
      {selected.size > 0 && phase === "results" && (
        <div className="bg-surface rounded-lg border border-white/10 p-6 mb-6">
          <h2 className="text-sm font-semibold text-primary mb-4">
            Register {selected.size} device{selected.size > 1 ? "s" : ""}
          </h2>

          <div className="space-y-3 max-h-80 overflow-y-auto mb-4">
            {[...selected].map((ip) => {
              const entry = regEntries.get(ip);
              if (!entry) return null;
              const cls = CLASS_CONFIG[entry.device.device_class] ?? CLASS_CONFIG.unknown;

              return (
                <div
                  key={ip}
                  className="flex flex-wrap items-center gap-3 bg-background rounded-lg px-4 py-3 border border-white/5"
                >
                  <span className={cls.color}>{cls.icon}</span>
                  <span className="text-xs text-primary font-mono w-28">{ip}</span>
                  <span className="text-xs text-secondary w-32 truncate">
                    {entry.device.hostname || "—"}
                  </span>

                  {/* Serial Number */}
                  <div>
                    <label className="block text-xs text-secondary/60 mb-0.5">Serial</label>
                    <input
                      value={entry.serial_number}
                      onChange={(e) => updateReg(ip, { serial_number: e.target.value })}
                      className="bg-surface border border-white/10 rounded px-2 py-1 text-xs text-primary w-44
                                 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>

                  {/* Device Type */}
                  <div>
                    <label className="block text-xs text-secondary/60 mb-0.5">Type</label>
                    <select
                      value={entry.device_type}
                      onChange={(e) => updateReg(ip, { device_type: e.target.value })}
                      className="bg-surface border border-white/10 rounded px-2 py-1 text-xs text-primary
                                 focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="ap">AP</option>
                      <option value="switch">Switch</option>
                      <option value="router">Router</option>
                      <option value="server">Server</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  {/* Site ID */}
                  <div>
                    <label className="block text-xs text-secondary/60 mb-0.5">Site</label>
                    <select
                      value={entry.site_id}
                      onChange={(e) => updateReg(ip, { site_id: e.target.value })}
                      className="bg-surface border border-white/10 rounded px-2 py-1 text-xs text-primary
                                 focus:outline-none focus:border-blue-500/50"
                    >
                      {sites.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                      <option value="__new__">New site...</option>
                    </select>
                    {entry.site_id === "__new__" && (
                      <input
                        value={entry.new_site}
                        onChange={(e) => updateReg(ip, { new_site: e.target.value })}
                        placeholder="site-id"
                        className="mt-1 bg-surface border border-white/10 rounded px-2 py-1 text-xs text-primary w-28
                                   focus:outline-none focus:border-blue-500/50"
                      />
                    )}
                  </div>

                  {/* Monitor */}
                  <div>
                    <label className="block text-xs text-secondary/60 mb-0.5">Monitor</label>
                    <select
                      value={entry.monitor}
                      onChange={(e) =>
                        updateReg(ip, {
                          monitor: e.target.value as RegEntry["monitor"],
                        })
                      }
                      className="bg-surface border border-white/10 rounded px-2 py-1 text-xs text-primary
                                 focus:outline-none focus:border-blue-500/50"
                    >
                      <option value="both">Both</option>
                      <option value="connectivity">Connectivity</option>
                      <option value="performance">Performance</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={handleRegister}
            disabled={regInProgress}
            className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40
                       text-white text-sm font-medium rounded-lg transition-colors"
          >
            {regInProgress ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Registering...
              </span>
            ) : (
              `Add ${selected.size} device${selected.size > 1 ? "s" : ""} to monitoring`
            )}
          </button>
        </div>
      )}

      {/* ── Registration Progress ─────────────────────────────── */}
      {phase === "registering" && (
        <div className="bg-surface rounded-lg border border-white/10 p-6 mb-6">
          <h2 className="text-sm font-semibold text-primary mb-4">
            Registering devices...
          </h2>
          <div className="space-y-2">
            {[...selected].map((ip) => {
              const entry = regEntries.get(ip);
              const status = regProgress.get(ip) ?? "pending";
              return (
                <div key={ip} className="flex items-center gap-3 text-sm">
                  {status === "pending" && (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-blue-400 rounded-full animate-spin" />
                  )}
                  {status === "success" && (
                    <span className="text-green-400">&#10003;</span>
                  )}
                  {status === "error" && (
                    <span className="text-alert-critical">&#10007;</span>
                  )}
                  <span className="text-primary font-mono text-xs">{ip}</span>
                  <span className="text-secondary text-xs">
                    {entry?.device.hostname || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Section 4: Post-registration Summary ──────────────── */}
      {phase === "done" && (
        <div className="bg-surface rounded-lg border border-white/10 p-6">
          {regResults.filter((r) => r.success).length > 0 && (
            <p className="text-sm text-green-400 font-medium mb-4">
              {regResults.filter((r) => r.success).length} device
              {regResults.filter((r) => r.success).length > 1 ? "s" : ""} added
              to AeroNet OS
            </p>
          )}

          <div className="space-y-2 mb-6">
            {regResults.map((r) => (
              <div
                key={r.serial}
                className="flex items-center gap-3 text-sm"
              >
                {r.success ? (
                  <span className="text-green-400">&#10003;</span>
                ) : (
                  <span className="text-alert-critical">&#10007;</span>
                )}
                <span className="text-primary font-mono text-xs">{r.ip}</span>
                <span className="text-secondary">{r.hostname || "—"}</span>
                {r.success ? (
                  <button
                    onClick={() => navigate(`/devices/${r.serial}`)}
                    className="text-xs text-blue-400 hover:underline"
                  >
                    View
                  </button>
                ) : (
                  <span className="text-xs text-alert-critical">{r.error}</span>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate("/devices")}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm
                         font-medium rounded-lg transition-colors"
            >
              View in Dashboard
            </button>
            <button
              onClick={reset}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-primary text-sm
                         rounded-lg transition-colors"
            >
              Scan Another Network
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

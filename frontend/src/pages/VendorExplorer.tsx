import { useState, useEffect, useCallback } from "react";
import {
  api,
  VendorConfig,
  VendorEndpoint,
  VendorFieldMapping,
  FlattenedField,
  ExecuteResult,
  VendorTestResult,
} from "../api/client";

/* ── Toast ─────────────────────────────────────────────────────────────── */

function Toast({
  message,
  type,
  onClose,
}: {
  message: string;
  type: "success" | "error";
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div
      className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm shadow-lg ${
        type === "success"
          ? "bg-emerald-600/90 text-white"
          : "bg-red-600/90 text-white"
      }`}
    >
      {message}
    </div>
  );
}

/* ── Skeleton rows ─────────────────────────────────────────────────────── */

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-8 bg-white/5 rounded animate-pulse mb-2" />
      ))}
    </>
  );
}

/* ── Shared styles ─────────────────────────────────────────────────────── */

const inputCls =
  "w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:ring-1 focus:ring-primary/50";
const labelCls = "block text-xs text-secondary mb-1";
const btnPrimary =
  "px-4 py-2 bg-primary text-black text-sm font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50 transition";
const btnCancel =
  "px-4 py-2 text-sm text-secondary hover:text-primary transition";

/* ── Add Config Modal ──────────────────────────────────────────────────── */

const PRESETS: Record<
  string,
  { display_name: string; base_url: string; auth_type: string }
> = {
  juniper_mist: {
    display_name: "Juniper MIST",
    base_url: "https://api.mist.com",
    auth_type: "token",
  },
  fortinet: {
    display_name: "Fortinet FortiManager",
    base_url: "https://fortimanager.local/jsonrpc",
    auth_type: "token",
  },
  cisco: {
    display_name: "Cisco Catalyst Center",
    base_url: "https://dnac.local",
    auth_type: "basic",
  },
  ruckus: {
    display_name: "Ruckus SmartZone",
    base_url: "https://smartzone.local:8443/wsg/api/public",
    auth_type: "token",
  },
};

function AddConfigModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (c: VendorConfig) => void;
}) {
  const [vendor, setVendor] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authType, setAuthType] = useState("token");
  const [token, setToken] = useState("");
  const [orgId, setOrgId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function applyPreset(v: string) {
    setVendor(v);
    const p = PRESETS[v];
    if (p) {
      setDisplayName(p.display_name);
      setBaseUrl(p.base_url);
      setAuthType(p.auth_type);
    }
  }

  async function handleSubmit() {
    setError("");
    if (!vendor || !displayName || !baseUrl) {
      setError("Vendor, display name, and base URL are required.");
      return;
    }
    const credentials: Record<string, string> = {};
    if (authType === "token") {
      if (!token) {
        setError("API token is required.");
        return;
      }
      credentials.token = token;
      if (orgId) credentials.org_id = orgId;
      if (siteId) credentials.site_id = siteId;
    } else if (authType === "basic") {
      if (!username || !password) {
        setError("Username and password are required.");
        return;
      }
      credentials.username = username;
      credentials.password = password;
    }
    setSaving(true);
    try {
      const created = await api.vendorExplorer.configs.create({
        vendor,
        display_name: displayName,
        base_url: baseUrl,
        auth_type: authType,
        credentials,
      });
      onCreated(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create config");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-white/10 rounded-xl w-full max-w-lg p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-primary">
          Add Vendor Config
        </h3>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <div>
          <label className={labelCls}>Vendor Preset</label>
          <select
            className={inputCls}
            value={vendor}
            onChange={(e) => applyPreset(e.target.value)}
          >
            <option value="">Custom...</option>
            {Object.keys(PRESETS).map((v) => (
              <option key={v} value={v}>
                {PRESETS[v].display_name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Vendor Key</label>
            <input
              className={inputCls}
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              placeholder="e.g. juniper_mist"
            />
          </div>
          <div>
            <label className={labelCls}>Display Name</label>
            <input
              className={inputCls}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Juniper MIST"
            />
          </div>
        </div>

        <div>
          <label className={labelCls}>Base URL</label>
          <input
            className={inputCls}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.mist.com"
          />
        </div>

        <div>
          <label className={labelCls}>Auth Type</label>
          <select
            className={inputCls}
            value={authType}
            onChange={(e) => setAuthType(e.target.value)}
          >
            <option value="token">Token / Bearer</option>
            <option value="basic">Basic Auth</option>
          </select>
        </div>

        {authType === "token" && (
          <>
            <div>
              <label className={labelCls}>API Token</label>
              <input
                className={inputCls}
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Enter API token"
              />
            </div>
            {vendor === "juniper_mist" && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Org ID</label>
                  <input
                    className={inputCls}
                    value={orgId}
                    onChange={(e) => setOrgId(e.target.value)}
                    placeholder="MIST Org UUID"
                  />
                </div>
                <div>
                  <label className={labelCls}>Site ID</label>
                  <input
                    className={inputCls}
                    value={siteId}
                    onChange={(e) => setSiteId(e.target.value)}
                    placeholder="MIST Site UUID"
                  />
                </div>
              </div>
            )}
          </>
        )}

        {authType === "basic" && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input
                className={inputCls}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input
                className={inputCls}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={btnCancel}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={saving} className={btnPrimary}>
            {saving ? "Saving..." : "Save Config"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Add Endpoint Modal ────────────────────────────────────────────────── */

function AddEndpointModal({
  configId,
  onClose,
  onCreated,
}: {
  configId: number;
  onClose: () => void;
  onCreated: (ep: VendorEndpoint) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [method, setMethod] = useState("GET");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!name || !path) {
      setError("Name and path are required.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.vendorExplorer.endpoints.create(configId, {
        name,
        path,
        method,
        description: description || undefined,
      });
      onCreated(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create endpoint");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-white/10 rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-primary">Add Endpoint</h3>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div>
          <label className={labelCls}>Name</label>
          <input
            className={inputCls}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. List APs"
          />
        </div>
        <div className="grid grid-cols-[100px_1fr] gap-3">
          <div>
            <label className={labelCls}>Method</label>
            <select
              className={inputCls}
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              <option>GET</option>
              <option>POST</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Path</label>
            <input
              className={inputCls}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="/api/v1/sites/{site_id}/devices"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <input
            className={inputCls}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={btnCancel}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={btnPrimary}
          >
            {saving ? "Saving..." : "Add Endpoint"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Save Mapping Modal ────────────────────────────────────────────────── */

function SaveMappingModal({
  endpointId,
  field,
  onClose,
  onCreated,
}: {
  endpointId: number;
  field: FlattenedField;
  onClose: () => void;
  onCreated: (m: VendorFieldMapping) => void;
}) {
  const pathParts = field.path.split(".");
  const [displayName, setDisplayName] = useState(
    pathParts[pathParts.length - 1].replace(/\[\d+\]$/, "")
  );
  const [cmdbColumn, setCmdbColumn] = useState("");
  const [grafanaLabel, setGrafanaLabel] = useState("");
  const [dataType, setDataType] = useState(field.type || "string");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    if (!displayName) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      const created = await api.vendorExplorer.fields.create(endpointId, {
        json_path: field.path,
        display_name: displayName,
        cmdb_column: cmdbColumn || undefined,
        grafana_label: grafanaLabel || undefined,
        data_type: dataType,
      });
      onCreated(created);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save mapping");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-white/10 rounded-xl w-full max-w-md p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-primary">
          Save Field Mapping
        </h3>
        <p className="text-xs text-secondary font-mono break-all">
          {field.path}
        </p>
        {error && <p className="text-sm text-red-400">{error}</p>}

        <div>
          <label className={labelCls}>Display Name</label>
          <input
            className={inputCls}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>CMDB Column</label>
            <input
              className={inputCls}
              value={cmdbColumn}
              onChange={(e) => setCmdbColumn(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className={labelCls}>Grafana Label</label>
            <input
              className={inputCls}
              value={grafanaLabel}
              onChange={(e) => setGrafanaLabel(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>
        <div>
          <label className={labelCls}>Data Type</label>
          <select
            className={inputCls}
            value={dataType}
            onChange={(e) => setDataType(e.target.value)}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className={btnCancel}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={btnPrimary}
          >
            {saving ? "Saving..." : "Save Mapping"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────────── */

export function VendorExplorer() {
  /* configs */
  const [configs, setConfigs] = useState<VendorConfig[]>([]);
  const [selectedConfigId, setSelectedConfigId] = useState<number | null>(null);
  const [loadingConfigs, setLoadingConfigs] = useState(true);
  const [showAddConfig, setShowAddConfig] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);

  /* endpoints */
  const [endpoints, setEndpoints] = useState<VendorEndpoint[]>([]);
  const [selectedEndpointId, setSelectedEndpointId] = useState<number | null>(
    null
  );
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);
  const [showAddEndpoint, setShowAddEndpoint] = useState(false);

  /* execute */
  const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(
    null
  );
  const [executing, setExecuting] = useState(false);
  const [responseTab, setResponseTab] = useState<"raw" | "fields">("fields");

  /* field mappings */
  const [fieldMappings, setFieldMappings] = useState<VendorFieldMapping[]>([]);
  const [savingField, setSavingField] = useState<FlattenedField | null>(null);

  /* toast */
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
    },
    []
  );

  /* ── Fetch configs on mount ─────────────────────────────────────────── */
  useEffect(() => {
    api.vendorExplorer.configs
      .list()
      .then(setConfigs)
      .catch(() => showToast("Failed to load vendor configs", "error"))
      .finally(() => setLoadingConfigs(false));
  }, [showToast]);

  /* ── Fetch endpoints when config changes ────────────────────────────── */
  useEffect(() => {
    if (selectedConfigId === null) {
      setEndpoints([]);
      return;
    }
    setLoadingEndpoints(true);
    setSelectedEndpointId(null);
    setExecuteResult(null);
    setFieldMappings([]);
    api.vendorExplorer.endpoints
      .list(selectedConfigId)
      .then(setEndpoints)
      .catch(() => showToast("Failed to load endpoints", "error"))
      .finally(() => setLoadingEndpoints(false));
  }, [selectedConfigId, showToast]);

  /* ── Fetch field mappings when endpoint changes ─────────────────────── */
  useEffect(() => {
    if (selectedEndpointId === null) {
      setFieldMappings([]);
      return;
    }
    api.vendorExplorer.fields
      .list(selectedEndpointId)
      .then(setFieldMappings)
      .catch(() => {});
  }, [selectedEndpointId]);

  /* ── Handlers ───────────────────────────────────────────────────────── */

  async function handleTestConfig(id: number) {
    setTesting(id);
    try {
      const result: VendorTestResult = await api.vendorExplorer.configs.test(id);
      showToast(
        result.ok
          ? `Connected \u2014 ${result.latency_ms}ms`
          : `Failed \u2014 HTTP ${result.status}`,
        result.ok ? "success" : "error"
      );
    } catch {
      showToast("Connection test failed", "error");
    } finally {
      setTesting(null);
    }
  }

  async function handleDeleteConfig(id: number) {
    if (!confirm("Delete this vendor config and all its endpoints?")) return;
    try {
      await api.vendorExplorer.configs.delete(id);
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      if (selectedConfigId === id) setSelectedConfigId(null);
      showToast("Config deleted");
    } catch {
      showToast("Failed to delete config", "error");
    }
  }

  async function handleExecute(endpointId: number) {
    setExecuting(true);
    setExecuteResult(null);
    setSelectedEndpointId(endpointId);
    try {
      const result = await api.vendorExplorer.endpoints.execute(endpointId);
      setExecuteResult(result);
      if (result.error) {
        showToast(`API error: ${result.error}`, "error");
      } else {
        showToast(`Received ${result.fields?.length ?? 0} fields`);
      }
    } catch (e: unknown) {
      showToast(
        e instanceof Error ? e.message : "Execute failed",
        "error"
      );
    } finally {
      setExecuting(false);
    }
  }

  async function handleTogglePoll(ep: VendorEndpoint) {
    try {
      const updated = await api.vendorExplorer.endpoints.updatePoll(ep.id, {
        poll_enabled: !ep.poll_enabled,
        poll_interval_s: ep.poll_interval_s,
      });
      setEndpoints((prev) =>
        prev.map((e) => (e.id === ep.id ? updated : e))
      );
      showToast(`Polling ${updated.poll_enabled ? "enabled" : "disabled"}`);
    } catch {
      showToast("Failed to update polling", "error");
    }
  }

  async function handleDeleteEndpoint(id: number) {
    try {
      await api.vendorExplorer.endpoints.delete(id);
      setEndpoints((prev) => prev.filter((e) => e.id !== id));
      if (selectedEndpointId === id) {
        setSelectedEndpointId(null);
        setExecuteResult(null);
      }
      showToast("Endpoint deleted");
    } catch {
      showToast("Failed to delete endpoint", "error");
    }
  }

  async function handleDeleteMapping(id: number) {
    try {
      await api.vendorExplorer.fields.delete(id);
      setFieldMappings((prev) => prev.filter((m) => m.id !== id));
      showToast("Mapping deleted");
    } catch {
      showToast("Failed to delete mapping", "error");
    }
  }

  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="space-y-0 h-[calc(100vh-4rem)]">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
        <h1 className="text-xl font-bold text-primary">
          Vendor API Explorer
        </h1>
      </div>

      <div className="flex h-[calc(100%-4rem)]">
        {/* ── Panel 1: Vendor Configs Sidebar ──────────────────────────── */}
        <div className="w-64 border-r border-white/10 flex flex-col shrink-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Vendors
            </span>
            <button
              onClick={() => setShowAddConfig(true)}
              className="text-xs text-primary hover:text-primary/80 font-medium transition"
            >
              + Add
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-2 px-2 space-y-1">
            {loadingConfigs ? (
              <div className="px-2">
                <SkeletonRows />
              </div>
            ) : configs.length === 0 ? (
              <p className="text-xs text-secondary/60 px-2 py-4 text-center">
                No vendor configs yet.
              </p>
            ) : (
              configs.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedConfigId(c.id)}
                  className={`group px-3 py-2 rounded-lg cursor-pointer transition ${
                    selectedConfigId === c.id
                      ? "bg-primary/20 text-primary"
                      : "text-secondary hover:text-primary hover:bg-white/5"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium truncate">
                      {c.display_name}
                    </span>
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        c.is_active ? "bg-emerald-500" : "bg-red-500"
                      }`}
                    />
                  </div>
                  <div className="text-xs text-secondary/60 truncate">
                    {c.base_url}
                  </div>
                  <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTestConfig(c.id);
                      }}
                      className="text-xs text-primary/70 hover:text-primary"
                      disabled={testing === c.id}
                    >
                      {testing === c.id ? "Testing..." : "Test"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteConfig(c.id);
                      }}
                      className="text-xs text-red-400/70 hover:text-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Main Content ─────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {!selectedConfigId ? (
            <div className="flex-1 flex items-center justify-center text-secondary/40 text-sm">
              Select a vendor config to explore its API endpoints
            </div>
          ) : (
            <>
              {/* ── Panel 2: Endpoints ──────────────────────────────────── */}
              <div className="border-b border-white/10 max-h-[40%] flex flex-col shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                    Endpoints &mdash; {selectedConfig?.display_name}
                  </span>
                  <button
                    onClick={() => setShowAddEndpoint(true)}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition"
                  >
                    + Add Endpoint
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {loadingEndpoints ? (
                    <div className="p-4">
                      <SkeletonRows />
                    </div>
                  ) : endpoints.length === 0 ? (
                    <p className="text-xs text-secondary/60 px-4 py-6 text-center">
                      No endpoints configured.
                    </p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-secondary/60 uppercase border-b border-white/5">
                          <th className="text-left px-4 py-2 font-medium">
                            Name
                          </th>
                          <th className="text-left px-2 py-2 font-medium w-16">
                            Method
                          </th>
                          <th className="text-left px-2 py-2 font-medium">
                            Path
                          </th>
                          <th className="text-left px-2 py-2 font-medium w-16">
                            Poll
                          </th>
                          <th className="text-right px-4 py-2 font-medium w-40">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {endpoints.map((ep) => (
                          <tr
                            key={ep.id}
                            onClick={() => setSelectedEndpointId(ep.id)}
                            className={`border-b border-white/5 cursor-pointer transition ${
                              selectedEndpointId === ep.id
                                ? "bg-primary/10"
                                : "hover:bg-white/5"
                            }`}
                          >
                            <td className="px-4 py-2 text-primary">
                              {ep.name}
                            </td>
                            <td className="px-2 py-2">
                              <span
                                className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                                  ep.method === "POST"
                                    ? "bg-amber-500/20 text-amber-400"
                                    : "bg-emerald-500/20 text-emerald-400"
                                }`}
                              >
                                {ep.method}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-secondary font-mono text-xs truncate max-w-[300px]">
                              {ep.path}
                            </td>
                            <td className="px-2 py-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTogglePoll(ep);
                                }}
                                className={`w-8 h-4 rounded-full transition relative ${
                                  ep.poll_enabled
                                    ? "bg-emerald-500"
                                    : "bg-white/10"
                                }`}
                              >
                                <span
                                  className={`absolute top-0.5 block w-3 h-3 rounded-full bg-white shadow transition-transform ${
                                    ep.poll_enabled
                                      ? "translate-x-4"
                                      : "translate-x-0.5"
                                  }`}
                                />
                              </button>
                            </td>
                            <td className="px-4 py-2 text-right space-x-2">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExecute(ep.id);
                                }}
                                disabled={executing}
                                className="text-xs text-primary hover:text-primary/80 font-medium disabled:opacity-50"
                              >
                                {executing && selectedEndpointId === ep.id
                                  ? "Running..."
                                  : "Execute"}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteEndpoint(ep.id);
                                }}
                                className="text-xs text-red-400/70 hover:text-red-400"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>

              {/* ── Bottom: Panel 3 + Panel 4 ──────────────────────────── */}
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* ── Panel 3: Response Explorer ────────────────────────── */}
                <div className="flex-1 border-r border-white/10 flex flex-col overflow-hidden min-w-0">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider mr-auto">
                      Response
                    </span>
                    <button
                      onClick={() => setResponseTab("fields")}
                      className={`text-xs px-2 py-1 rounded transition ${
                        responseTab === "fields"
                          ? "bg-primary/20 text-primary"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      Fields
                    </button>
                    <button
                      onClick={() => setResponseTab("raw")}
                      className={`text-xs px-2 py-1 rounded transition ${
                        responseTab === "raw"
                          ? "bg-primary/20 text-primary"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    {executing ? (
                      <SkeletonRows count={6} />
                    ) : !executeResult ? (
                      <p className="text-xs text-secondary/40 text-center py-8">
                        Execute an endpoint to see its response
                      </p>
                    ) : executeResult.error ? (
                      <div className="text-sm text-red-400 p-3 bg-red-500/10 rounded-lg">
                        {executeResult.error}
                        {executeResult.body && (
                          <pre className="mt-2 text-xs text-secondary whitespace-pre-wrap">
                            {executeResult.body}
                          </pre>
                        )}
                      </div>
                    ) : responseTab === "raw" ? (
                      <pre className="text-xs text-secondary font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(executeResult.raw, null, 2)}
                      </pre>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-secondary/60 uppercase border-b border-white/5">
                            <th className="text-left py-1 pr-3 font-medium">
                              Path
                            </th>
                            <th className="text-left py-1 pr-3 font-medium">
                              Value
                            </th>
                            <th className="text-left py-1 pr-3 font-medium w-16">
                              Type
                            </th>
                            <th className="w-12" />
                          </tr>
                        </thead>
                        <tbody>
                          {executeResult.fields?.map(
                            (f: FlattenedField, i: number) => (
                              <tr
                                key={i}
                                className="border-b border-white/5 hover:bg-white/5"
                              >
                                <td className="py-1.5 pr-3 font-mono text-primary break-all">
                                  {f.path}
                                </td>
                                <td
                                  className="py-1.5 pr-3 text-secondary truncate max-w-[200px]"
                                  title={String(f.value)}
                                >
                                  {String(f.value)}
                                </td>
                                <td className="py-1.5 pr-3 text-secondary/60">
                                  {f.type}
                                </td>
                                <td className="py-1.5">
                                  {selectedEndpointId && (
                                    <button
                                      onClick={() => setSavingField(f)}
                                      className="text-primary/60 hover:text-primary text-xs"
                                      title="Save as field mapping"
                                    >
                                      +Map
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          )}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>

                {/* ── Panel 4: Saved Field Mappings ─────────────────────── */}
                <div className="w-80 flex flex-col overflow-hidden shrink-0">
                  <div className="px-4 py-3 border-b border-white/10 shrink-0">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                      Saved Mappings
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto p-3">
                    {!selectedEndpointId ? (
                      <p className="text-xs text-secondary/40 text-center py-8">
                        Select an endpoint
                      </p>
                    ) : fieldMappings.length === 0 ? (
                      <p className="text-xs text-secondary/40 text-center py-8">
                        No saved mappings.
                        <br />
                        Click +Map on a field to save it.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {fieldMappings.map((m) => (
                          <div
                            key={m.id}
                            className="bg-white/5 rounded-lg p-3 border border-white/5"
                          >
                            <div className="flex items-start justify-between">
                              <span className="text-sm text-primary font-medium">
                                {m.display_name}
                              </span>
                              <button
                                onClick={() => handleDeleteMapping(m.id)}
                                className="text-xs text-red-400/50 hover:text-red-400 ml-2"
                              >
                                x
                              </button>
                            </div>
                            <p className="text-xs text-secondary/60 font-mono mt-1 break-all">
                              {m.json_path}
                            </p>
                            <div className="flex gap-3 mt-1.5 text-xs text-secondary/50">
                              <span>{m.data_type}</span>
                              {m.cmdb_column && (
                                <span>CMDB: {m.cmdb_column}</span>
                              )}
                              {m.grafana_label && (
                                <span>Grafana: {m.grafana_label}</span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────── */}

      {showAddConfig && (
        <AddConfigModal
          onClose={() => setShowAddConfig(false)}
          onCreated={(c) => {
            setConfigs((prev) => [...prev, c]);
            setShowAddConfig(false);
            setSelectedConfigId(c.id);
            showToast("Vendor config created");
          }}
        />
      )}

      {showAddEndpoint && selectedConfigId && (
        <AddEndpointModal
          configId={selectedConfigId}
          onClose={() => setShowAddEndpoint(false)}
          onCreated={(ep) => {
            setEndpoints((prev) => [...prev, ep]);
            setShowAddEndpoint(false);
            showToast("Endpoint added");
          }}
        />
      )}

      {savingField && selectedEndpointId && (
        <SaveMappingModal
          endpointId={selectedEndpointId}
          field={savingField}
          onClose={() => setSavingField(null)}
          onCreated={(m) => {
            setFieldMappings((prev) => [...prev, m]);
            setSavingField(null);
            showToast("Field mapping saved");
          }}
        />
      )}
    </div>
  );
}

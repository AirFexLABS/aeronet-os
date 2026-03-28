import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import {
  api,
  VendorConfig,
  VendorEndpoint,
  VendorFieldMapping,
  FlattenedField,
  ExecuteResult,
  VendorTestResult,
  FieldMappingTemplate,
  FieldMappingTemplateDetail,
} from "../api/client";

/* ── Types ─────────────────────────────────────────────────────────────── */

interface CachedSite {
  id: string;
  name: string;
  address: string;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Extract {param} placeholders from a path, excluding org_id (auto-filled). */
function extractUserParams(path: string): string[] {
  const matches = path.match(/\{(\w+)\}/g) || [];
  return matches.map((m) => m.slice(1, -1)).filter((p) => p !== "org_id");
}

/** "ATL SkyClub - C37" → "ATL" */
function airportCode(name: string): string {
  const first = name.split(" ")[0];
  return first && first.length >= 3 ? first.substring(0, 3).toUpperCase() : "---";
}

/** "$.lldp_stat.system_name" → "Lldp Stat System Name" */
function pathToDisplayName(path: string): string {
  const last = path.split(".").pop() || path;
  return (
    last
      .replace(/^\$/, "")
      .replace(/\[\d+\]$/, "")
      .replace(/[._]/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ") || path
  );
}

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
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={btnPrimary}
          >
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

  /* execute — per-endpoint results */
  const [executeResults, setExecuteResults] = useState<Record<number, ExecuteResult>>({});
  const [executing, setExecuting] = useState(false);
  const [responseTab, setResponseTab] = useState<"raw" | "fields">("fields");

  /* endpoint mappings cache — keyed by endpoint id */
  const [endpointMappingsCache, setEndpointMappingsCache] = useState<Record<number, VendorFieldMapping[]>>({});

  /* field mappings */
  const [fieldMappings, setFieldMappings] = useState<VendorFieldMapping[]>([]);
  const [savingField, setSavingField] = useState<FlattenedField | null>(null);

  /* site cache — keyed by vendor config id */
  const [sitesCache, setSitesCache] = useState<Record<number, CachedSite[]>>(
    {}
  );
  const [activeSiteId, setActiveSiteId] = useState<string | null>(null);
  const [activeSiteName, setActiveSiteName] = useState<string | null>(null);
  const [showSitesTable, setShowSitesTable] = useState(false);

  /* inline parameter bar */
  const [pendingExecuteEp, setPendingExecuteEp] =
    useState<VendorEndpoint | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  /* top-level tab */
  const [topTab, setTopTab] = useState<"explorer" | "templates">("explorer");

  /* templates */
  const [templates, setTemplates] = useState<FieldMappingTemplate[]>([]);
  const [expandedTemplateId, setExpandedTemplateId] = useState<number | null>(null);
  const [expandedTemplateDetail, setExpandedTemplateDetail] = useState<FieldMappingTemplateDetail | null>(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  /* new template form */
  const [showNewTemplateForm, setShowNewTemplateForm] = useState(false);
  const [newTplName, setNewTplName] = useState("");
  const [newTplDesc, setNewTplDesc] = useState("");
  const [newTplVendor, setNewTplVendor] = useState("");
  const [newTplScope, setNewTplScope] = useState("vendor");
  const [newTplSiteGroup, setNewTplSiteGroup] = useState("");
  const [newTplSelectedPaths, setNewTplSelectedPaths] = useState<Set<string>>(new Set());
  const [newTplDisplayNames, setNewTplDisplayNames] = useState<Record<string, string>>({});
  const [newTplFieldSearch, setNewTplFieldSearch] = useState("");
  const [newTplSaving, setNewTplSaving] = useState(false);
  const [collapsedEndpointGroups, setCollapsedEndpointGroups] = useState<Set<number>>(new Set());

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

  /* derived: current sites for the selected vendor config */
  const currentSites =
    selectedConfigId !== null ? sitesCache[selectedConfigId] ?? [] : [];

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
    setExecuteResults({});
    setEndpointMappingsCache({});
    setFieldMappings([]);
    setActiveSiteId(null);
    setActiveSiteName(null);
    setPendingExecuteEp(null);
    setShowSitesTable(false);
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

  /* ── Load field mappings for ALL endpoints (for template picker) ──── */
  useEffect(() => {
    if (endpoints.length === 0) return;
    const cache: Record<number, VendorFieldMapping[]> = {};
    Promise.all(
      endpoints.map((ep) =>
        api.vendorExplorer.fields
          .list(ep.id)
          .then((mappings) => { cache[ep.id] = mappings; })
          .catch(() => { cache[ep.id] = []; })
      )
    ).then(() => setEndpointMappingsCache(cache));
  }, [endpoints]);

  /* ── Site caching ───────────────────────────────────────────────────── */

  function maybeCacheSites(
    ep: VendorEndpoint,
    result: ExecuteResult,
    configId: number
  ) {
    const isSitesEndpoint =
      ep.name.toLowerCase().includes("list sites") ||
      (ep.path.includes("/sites") && !ep.path.includes("{site_id}"));

    if (!isSitesEndpoint || !Array.isArray(result.raw)) return;

    const sites: CachedSite[] = [];
    for (const item of result.raw as Record<string, unknown>[]) {
      if (item.id && item.name) {
        sites.push({
          id: String(item.id),
          name: String(item.name),
          address: String(item.address ?? ""),
        });
      }
    }

    if (sites.length > 0) {
      setSitesCache((prev) => ({ ...prev, [configId]: sites }));
      showToast(`${sites.length} sites cached`);
    }
  }

  /* ── Load templates on mount ──────────────────────────────────────── */
  useEffect(() => {
    api.vendorExplorer.templates
      .list()
      .then(setTemplates)
      .catch(() => {});
  }, []);

  /* ── Template handlers ─────────────────────────────────────────────── */

  async function handleExpandTemplate(id: number) {
    if (expandedTemplateId === id) {
      setExpandedTemplateId(null);
      setExpandedTemplateDetail(null);
      return;
    }
    try {
      const detail = await api.vendorExplorer.templates.get(id);
      setExpandedTemplateId(id);
      setExpandedTemplateDetail(detail);
    } catch {
      showToast("Failed to load template fields", "error");
    }
  }

  async function handleRenameTemplate(id: number) {
    if (!renameValue.trim()) return;
    try {
      const updated = await api.vendorExplorer.templates.update(id, { name: renameValue.trim() });
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
      setRenamingTemplateId(null);
      showToast("Template renamed");
    } catch {
      showToast("Failed to rename template", "error");
    }
  }

  async function handleDuplicateTemplate(tpl: FieldMappingTemplate) {
    try {
      const detail = await api.vendorExplorer.templates.get(tpl.id);
      const copy = await api.vendorExplorer.templates.create({
        name: `Copy of ${tpl.name}`,
        description: tpl.description ?? undefined,
        vendor: tpl.vendor,
        scope: tpl.scope,
        site_group_id: tpl.site_group_id ?? undefined,
      });
      for (const f of detail.fields) {
        await api.vendorExplorer.templates.addField(copy.id, {
          json_path: f.json_path,
          display_name: f.display_name,
          cmdb_column: f.cmdb_column ?? undefined,
          grafana_label: f.grafana_label ?? undefined,
          data_type: f.data_type,
        });
      }
      copy.field_count = detail.fields.length;
      setTemplates((prev) => [...prev, copy]);
      showToast("Template duplicated");
    } catch {
      showToast("Failed to duplicate template", "error");
    }
  }

  async function handleDeleteTemplate(id: number) {
    if (!confirm("Delete this template?")) return;
    try {
      await api.vendorExplorer.templates.delete(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      if (expandedTemplateId === id) {
        setExpandedTemplateId(null);
        setExpandedTemplateDetail(null);
      }
      showToast("Template deleted");
    } catch {
      showToast("Failed to delete template", "error");
    }
  }

  async function handleApplyTemplate(templateId: number) {
    if (!selectedEndpointId) return;
    try {
      const result = await api.vendorExplorer.templates.apply(templateId, selectedEndpointId);
      showToast(`Applied ${result.applied} mappings (${result.skipped} skipped)`);
      // Refresh field mappings
      const updated = await api.vendorExplorer.fields.list(selectedEndpointId);
      setFieldMappings(updated);
    } catch {
      showToast("Failed to apply template", "error");
    }
  }

  /* ── New template form ─────────────────────────────────────────────── */

  function openNewTemplateForm() {
    setShowNewTemplateForm(true);
    setNewTplVendor(selectedConfig?.vendor ?? uniqueVendors[0] ?? "");
    setNewTplSelectedPaths(new Set());
    setNewTplDisplayNames({});
    setNewTplFieldSearch("");
    setNewTplName("");
    setNewTplDesc("");
    setNewTplScope("vendor");
    setNewTplSiteGroup("");
    setCollapsedEndpointGroups(new Set());
  }

  function toggleFieldSelection(path: string) {
    const isSelected = newTplSelectedPaths.has(path);
    if (isSelected) {
      setNewTplSelectedPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      setNewTplSelectedPaths((prev) => new Set(prev).add(path));
      if (!newTplDisplayNames[path]) {
        setNewTplDisplayNames((prev) => ({
          ...prev,
          [path]: pathToDisplayName(path),
        }));
      }
    }
  }

  function handleSelectAllVisible() {
    setNewTplSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const g of newTplFieldGroups) {
        for (const f of g.fields) next.add(f.path);
      }
      return next;
    });
    setNewTplDisplayNames((prev) => {
      const next = { ...prev };
      for (const g of newTplFieldGroups) {
        for (const f of g.fields) {
          if (!next[f.path]) next[f.path] = pathToDisplayName(f.path);
        }
      }
      return next;
    });
  }

  function handleDeselectAllVisible() {
    setNewTplSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const g of newTplFieldGroups) {
        for (const f of g.fields) next.delete(f.path);
      }
      return next;
    });
  }

  function handleSelectAllInGroup(epId: number) {
    const group = newTplFieldGroups.find((g) => g.endpoint.id === epId);
    if (!group) return;
    setNewTplSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const f of group.fields) next.add(f.path);
      return next;
    });
    setNewTplDisplayNames((prev) => {
      const next = { ...prev };
      for (const f of group.fields) {
        if (!next[f.path]) next[f.path] = pathToDisplayName(f.path);
      }
      return next;
    });
  }

  function handleDeselectAllInGroup(epId: number) {
    const group = newTplFieldGroups.find((g) => g.endpoint.id === epId);
    if (!group) return;
    setNewTplSelectedPaths((prev) => {
      const next = new Set(prev);
      for (const f of group.fields) next.delete(f.path);
      return next;
    });
  }

  function toggleEndpointGroupCollapse(epId: number) {
    setCollapsedEndpointGroups((prev) => {
      const next = new Set(prev);
      if (next.has(epId)) next.delete(epId);
      else next.add(epId);
      return next;
    });
  }

  async function handleCreateTemplate() {
    if (!newTplName.trim() || !newTplVendor || newTplSelectedPaths.size === 0)
      return;
    setNewTplSaving(true);
    try {
      const tpl = await api.vendorExplorer.templates.create({
        name: newTplName.trim(),
        description: newTplDesc.trim() || undefined,
        vendor: newTplVendor,
        scope: newTplScope,
        site_group_id:
          newTplScope === "site_group" ? newTplSiteGroup || undefined : undefined,
      });

      // Collect all unique fields across all endpoint groups
      const added = new Set<string>();
      for (const g of newTplFieldGroups) {
        for (const f of g.fields) {
          if (!newTplSelectedPaths.has(f.path) || added.has(f.path)) continue;
          added.add(f.path);
          await api.vendorExplorer.templates.addField(tpl.id, {
            json_path: f.path,
            display_name:
              newTplDisplayNames[f.path] || pathToDisplayName(f.path),
            data_type: f.type || "string",
          });
        }
      }

      tpl.field_count = added.size;
      setTemplates((prev) => [...prev, tpl]);
      setShowNewTemplateForm(false);
      showToast(`Template saved with ${added.size} fields`);
    } catch (e: unknown) {
      showToast(
        e instanceof Error ? e.message : "Failed to create template",
        "error"
      );
    } finally {
      setNewTplSaving(false);
    }
  }

  async function handleAssignTemplateToEndpoint(templateId: number, endpointId: number) {
    try {
      const result = await api.vendorExplorer.templates.apply(templateId, endpointId);
      showToast(`Applied ${result.applied} mappings to endpoint (${result.skipped} skipped)`);
      // Refresh if it's the currently selected endpoint
      if (endpointId === selectedEndpointId) {
        const updated = await api.vendorExplorer.fields.list(endpointId);
        setFieldMappings(updated);
      }
    } catch {
      showToast("Failed to assign template", "error");
    }
  }

  const selectedConfig = configs.find((c) => c.id === selectedConfigId);

  /* derived: current execute result for the selected endpoint */
  const currentExecResult = selectedEndpointId !== null
    ? executeResults[selectedEndpointId] ?? null
    : null;

  /* templates filtered for current vendor */
  const vendorTemplates = selectedConfig
    ? templates.filter((t) => t.vendor === selectedConfig.vendor)
    : [];

  const uniqueVendors = useMemo(() => {
    const set = new Set(configs.map((c) => c.vendor));
    return Array.from(set);
  }, [configs]);

  /** Grouped fields for the New Template picker — one group per endpoint */
  const newTplFieldGroups = useMemo(() => {
    const search = newTplFieldSearch.toLowerCase();
    return endpoints
      .map((ep) => {
        // Merge execute result fields + saved mappings (dedupe by path)
        const seen = new Set<string>();
        const fields: FlattenedField[] = [];

        // Execute results first (they have sample values)
        const execFields = executeResults[ep.id]?.fields ?? [];
        for (const f of execFields) {
          if (!seen.has(f.path)) {
            seen.add(f.path);
            fields.push(f);
          }
        }

        // Then saved mappings (convert to FlattenedField shape)
        const mappings = endpointMappingsCache[ep.id] ?? [];
        for (const m of mappings) {
          if (!seen.has(m.json_path)) {
            seen.add(m.json_path);
            fields.push({
              path: m.json_path,
              value: `(saved: ${m.display_name})`,
              type: m.data_type,
            });
          }
        }

        // Apply search filter
        const filtered = search
          ? fields.filter(
              (f) =>
                f.path.toLowerCase().includes(search) ||
                String(f.value).toLowerCase().includes(search)
            )
          : fields;

        return { endpoint: ep, fields: filtered };
      })
      .filter((g) => g.fields.length > 0);
  }, [endpoints, executeResults, endpointMappingsCache, newTplFieldSearch]);

  /* ── Execute logic ──────────────────────────────────────────────────── */

  function handleExecuteClick(ep: VendorEndpoint) {
    const userParams = extractUserParams(ep.path);

    // No user-facing params → execute immediately
    if (userParams.length === 0) {
      doExecute(ep.id, {});
      return;
    }

    // Try to auto-fill all params
    const autoFilled: Record<string, string> = {};
    let allResolved = true;

    for (const param of userParams) {
      if (param === "site_id" && activeSiteId) {
        autoFilled.site_id = activeSiteId;
      } else {
        allResolved = false;
      }
    }

    if (allResolved) {
      doExecute(ep.id, autoFilled);
      return;
    }

    // Show inline parameter bar
    setPendingExecuteEp(ep);
    setParamValues(autoFilled);
  }

  async function doExecute(
    endpointId: number,
    pathParams: Record<string, string>
  ) {
    setExecuting(true);
    setSelectedEndpointId(endpointId);
    setPendingExecuteEp(null);

    // If we're executing with a site_id, persist it as active
    if (pathParams.site_id) {
      setActiveSiteId(pathParams.site_id);
      const site = currentSites.find((s) => s.id === pathParams.site_id);
      setActiveSiteName(site?.name ?? pathParams.site_id.substring(0, 8) + "\u2026");
    }

    try {
      const hasParams = Object.keys(pathParams).length > 0;
      const result = await api.vendorExplorer.endpoints.execute(
        endpointId,
        hasParams ? pathParams : undefined
      );
      setExecuteResults((prev) => ({ ...prev, [endpointId]: result }));

      if (result.error) {
        showToast(`API error: ${result.error}`, "error");
      } else {
        showToast(`Received ${result.fields?.length ?? 0} fields`);

        // Cache sites if this looks like a sites response
        const ep = endpoints.find((e) => e.id === endpointId);
        if (ep && selectedConfigId !== null) {
          maybeCacheSites(ep, result, selectedConfigId);
        }
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

  /* ── Other handlers ─────────────────────────────────────────────────── */

  async function handleTestConfig(id: number) {
    setTesting(id);
    try {
      const result: VendorTestResult =
        await api.vendorExplorer.configs.test(id);
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
      }
      setExecuteResults((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
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

  /* ── Render ─────────────────────────────────────────────────────────── */

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
        <h1 className="text-xl font-bold text-primary">
          Vendor API Explorer
        </h1>
      </div>

      <div className="flex flex-1 min-h-0">
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
              {/* ── Tab Bar ────────────────────────────────────────────── */}
              <div className="flex border-b border-white/10 shrink-0">
                <button
                  onClick={() => setTopTab("explorer")}
                  className={`px-4 py-2.5 text-xs font-medium transition border-b-2 ${
                    topTab === "explorer"
                      ? "text-primary border-primary"
                      : "text-secondary hover:text-primary border-transparent"
                  }`}
                >
                  Explorer
                </button>
                <button
                  onClick={() => setTopTab("templates")}
                  className={`px-4 py-2.5 text-xs font-medium transition border-b-2 ${
                    topTab === "templates"
                      ? "text-primary border-primary"
                      : "text-secondary hover:text-primary border-transparent"
                  }`}
                >
                  Templates{templates.length > 0 ? ` (${templates.length})` : ""}
                </button>
              </div>

              {topTab === "explorer" && (
              <>
              {/* ── Panel 2: Endpoints ──────────────────────────────────── */}
              <div className="border-b border-white/10 max-h-[40%] flex flex-col shrink-0">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider shrink-0">
                      Endpoints &mdash; {selectedConfig?.display_name}
                    </span>
                    {activeSiteName && (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-primary/15 text-primary text-xs rounded-full shrink-0">
                        Active Site: {activeSiteName}
                        <button
                          onClick={() => {
                            setActiveSiteId(null);
                            setActiveSiteName(null);
                          }}
                          className="text-primary/60 hover:text-primary"
                        >
                          &times;
                        </button>
                      </span>
                    )}
                    {currentSites.length > 0 && (
                      <button
                        onClick={() => setShowSitesTable((p) => !p)}
                        className="text-xs text-secondary/50 hover:text-primary transition shrink-0"
                      >
                        {currentSites.length} sites
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setShowAddEndpoint(true)}
                    className="text-xs text-primary hover:text-primary/80 font-medium transition shrink-0"
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
                                  handleExecuteClick(ep);
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

              {/* ── Inline Parameter Bar ────────────────────────────────── */}
              {pendingExecuteEp && (
                <div className="px-4 py-3 bg-white/[0.02] border-b border-white/10 flex items-center gap-3 shrink-0 flex-wrap">
                  <span className="text-xs text-secondary font-semibold uppercase tracking-wider shrink-0">
                    Parameters
                  </span>
                  {extractUserParams(pendingExecuteEp.path).map((param) => (
                    <div key={param} className="flex items-center gap-2">
                      <label className="text-xs text-secondary capitalize shrink-0">
                        {param.replace(/_/g, " ")}:
                      </label>
                      {param === "site_id" && currentSites.length > 0 ? (
                        <select
                          className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 max-w-xs"
                          value={paramValues[param] || ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [param]: e.target.value,
                            }))
                          }
                        >
                          <option value="">Select a site...</option>
                          {currentSites.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:ring-1 focus:ring-primary/50 w-72"
                          value={paramValues[param] || ""}
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [param]: e.target.value,
                            }))
                          }
                          placeholder={
                            param === "site_id"
                              ? "Run 'List Sites' first for picker"
                              : `Enter ${param.replace(/_/g, " ")}`
                          }
                        />
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      doExecute(pendingExecuteEp.id, { ...paramValues })
                    }
                    disabled={
                      executing ||
                      extractUserParams(pendingExecuteEp.path).some(
                        (p) => !paramValues[p]
                      )
                    }
                    className="px-3 py-1.5 bg-primary text-black text-xs font-medium rounded-lg hover:bg-primary/80 disabled:opacity-50 transition shrink-0"
                  >
                    Execute
                  </button>
                  <button
                    onClick={() => setPendingExecuteEp(null)}
                    className="text-xs text-secondary hover:text-primary transition shrink-0"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* ── Sites (collapsed pill / expandable table) ────────── */}
              {currentSites.length > 0 && (
                <div className="border-b border-white/10 shrink-0">
                  {!showSitesTable ? (
                    <button
                      onClick={() => setShowSitesTable(true)}
                      className="w-full flex items-center gap-2 px-4 py-1.5 text-xs text-secondary/50 hover:text-primary hover:bg-white/[0.02] transition"
                    >
                      <span>{currentSites.length} sites loaded</span>
                      <span>&#9654; Expand</span>
                    </button>
                  ) : (
                    <div className="max-h-48 flex flex-col">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-white/[0.02] shrink-0">
                        <span className="text-xs text-secondary">
                          {currentSites.length} sites loaded
                        </span>
                        <button
                          onClick={() => setShowSitesTable(false)}
                          className="text-xs text-secondary hover:text-primary transition"
                        >
                          Hide
                        </button>
                      </div>
                      <div className="overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-secondary/60 uppercase border-b border-white/5 sticky top-0 bg-surface">
                              <th className="text-left px-4 py-1.5 font-medium">
                                Site Name
                              </th>
                              <th className="text-left px-2 py-1.5 font-medium w-16">
                                Airport
                              </th>
                              <th className="text-left px-2 py-1.5 font-medium">
                                Address
                              </th>
                              <th className="text-left px-2 py-1.5 font-medium w-28">
                                ID
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentSites.map((s) => (
                              <tr
                                key={s.id}
                                onClick={() => {
                                  setActiveSiteId(s.id);
                                  setActiveSiteName(s.name);
                                }}
                                className={`border-b border-white/5 cursor-pointer transition ${
                                  activeSiteId === s.id
                                    ? "bg-primary/10"
                                    : "hover:bg-white/5"
                                }`}
                              >
                                <td className="px-4 py-1.5 text-primary">
                                  {s.name}
                                </td>
                                <td className="px-2 py-1.5 text-secondary font-mono">
                                  {airportCode(s.name)}
                                </td>
                                <td className="px-2 py-1.5 text-secondary/60 truncate max-w-[250px]">
                                  {s.address || "\u2014"}
                                </td>
                                <td className="px-2 py-1.5 text-secondary/40 font-mono">
                                  {s.id.substring(0, 8)}&hellip;
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Bottom: Panel 3 + Panel 4 ──────────────────────────── */}
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* ── Panel 3: Response Explorer ────────────────────────── */}
                <div className="flex-1 border-r border-white/10 flex flex-col overflow-hidden min-w-0">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 shrink-0">
                    <div className="mr-auto min-w-0">
                      <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                        Response
                      </span>
                      {currentExecResult?.resolved_url && (
                        <p
                          className="text-xs text-secondary/40 font-mono mt-0.5 truncate"
                          title={currentExecResult.resolved_url}
                        >
                          {currentExecResult.resolved_url}
                        </p>
                      )}
                    </div>
                    {selectedEndpointId && vendorTemplates.length > 0 && (
                      <select
                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-secondary focus:outline-none focus:ring-1 focus:ring-primary/50 shrink-0"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) handleApplyTemplate(Number(e.target.value));
                        }}
                      >
                        <option value="">Apply Template...</option>
                        {vendorTemplates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} ({t.field_count} fields)
                          </option>
                        ))}
                      </select>
                    )}
                    <button
                      onClick={() => setResponseTab("fields")}
                      className={`text-xs px-2 py-1 rounded transition shrink-0 ${
                        responseTab === "fields"
                          ? "bg-primary/20 text-primary"
                          : "text-secondary hover:text-primary"
                      }`}
                    >
                      Fields
                    </button>
                    <button
                      onClick={() => setResponseTab("raw")}
                      className={`text-xs px-2 py-1 rounded transition shrink-0 ${
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
                    ) : !currentExecResult ? (
                      <p className="text-xs text-secondary/40 text-center py-8">
                        Execute an endpoint to see its response
                      </p>
                    ) : currentExecResult.error ? (
                      <div className="text-sm text-red-400 p-3 bg-red-500/10 rounded-lg">
                        {currentExecResult.error}
                        {currentExecResult.body && (
                          <pre className="mt-2 text-xs text-secondary whitespace-pre-wrap">
                            {currentExecResult.body}
                          </pre>
                        )}
                      </div>
                    ) : responseTab === "raw" ? (
                      <pre className="text-xs text-secondary font-mono whitespace-pre-wrap break-all">
                        {JSON.stringify(currentExecResult.raw, null, 2)}
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
                          {currentExecResult.fields?.map(
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

              {/* ── Templates Tab ──────────────────────────────────────── */}
              {topTab === "templates" && (
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                      Field Mapping Templates ({templates.length})
                    </span>
                    <button
                      onClick={() =>
                        showNewTemplateForm
                          ? setShowNewTemplateForm(false)
                          : openNewTemplateForm()
                      }
                      className="text-xs text-primary hover:text-primary/80 font-medium transition"
                    >
                      {showNewTemplateForm ? "Cancel" : "+ New Template"}
                    </button>
                  </div>

                  {/* ── New Template Form (collapsible) ──────────────────── */}
                  {showNewTemplateForm && (
                    <div className="border-b border-white/10 shrink-0 max-h-[60%] flex flex-col bg-white/[0.02]">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0">
                        <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                          New Template
                        </span>
                        <button
                          onClick={() => setShowNewTemplateForm(false)}
                          className="text-xs text-secondary hover:text-primary transition"
                        >
                          &#9650; Collapse
                        </button>
                      </div>
                      <div className="flex-1 overflow-auto p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className={labelCls}>Template Name</label>
                            <input
                              className={inputCls}
                              value={newTplName}
                              onChange={(e) => setNewTplName(e.target.value)}
                              placeholder="e.g. AP Stats CMDB Template"
                            />
                          </div>
                          <div>
                            <label className={labelCls}>Description (optional)</label>
                            <input
                              className={inputCls}
                              value={newTplDesc}
                              onChange={(e) => setNewTplDesc(e.target.value)}
                              placeholder="What this template maps"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <label className={labelCls}>Vendor</label>
                            <select
                              className={inputCls}
                              value={newTplVendor}
                              onChange={(e) => setNewTplVendor(e.target.value)}
                            >
                              {uniqueVendors.map((v) => (
                                <option key={v} value={v}>
                                  {PRESETS[v]?.display_name ?? v}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className={labelCls}>Scope</label>
                            <select
                              className={inputCls}
                              value={newTplScope}
                              onChange={(e) => setNewTplScope(e.target.value)}
                            >
                              <option value="vendor">This Vendor</option>
                              <option value="site_group">Site Group</option>
                            </select>
                          </div>
                          {newTplScope === "site_group" && (
                            <div>
                              <label className={labelCls}>Site Group</label>
                              <input
                                className={inputCls}
                                value={newTplSiteGroup}
                                onChange={(e) => setNewTplSiteGroup(e.target.value)}
                                placeholder="Site group ID"
                              />
                            </div>
                          )}
                        </div>

                        {/* ── Field selection (grouped by endpoint) ─────── */}
                        <div className="border-t border-white/5 pt-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
                              Select Fields
                            </span>
                            <input
                              className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-primary placeholder:text-secondary/40 focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
                              value={newTplFieldSearch}
                              onChange={(e) => setNewTplFieldSearch(e.target.value)}
                              placeholder="Search fields..."
                            />
                          </div>

                          {newTplFieldGroups.length === 0 ? (
                            <p className="text-xs text-secondary/40 py-6 text-center">
                              Execute endpoints or save field mappings to populate available fields
                            </p>
                          ) : (
                            <>
                              <div className="border border-white/10 rounded-lg overflow-hidden max-h-80 overflow-y-auto">
                                {newTplFieldGroups.map((group) => {
                                  const isCollapsed = collapsedEndpointGroups.has(group.endpoint.id);
                                  const groupSelectedCount = group.fields.filter((f) =>
                                    newTplSelectedPaths.has(f.path)
                                  ).length;
                                  return (
                                    <div key={group.endpoint.id}>
                                      {/* ── Group header ── */}
                                      <div className="flex items-center justify-between px-3 py-2 bg-white/[0.04] border-b border-white/5 sticky top-0 z-10">
                                        <button
                                          onClick={() => toggleEndpointGroupCollapse(group.endpoint.id)}
                                          className="flex items-center gap-2 text-xs font-semibold text-primary hover:text-primary/80 transition"
                                        >
                                          <span className="text-[10px]">
                                            {isCollapsed ? "\u25B6" : "\u25BC"}
                                          </span>
                                          {group.endpoint.name}
                                          <span className="text-secondary/50 font-normal font-mono">
                                            {group.endpoint.method} {group.endpoint.path}
                                          </span>
                                        </button>
                                        <div className="flex items-center gap-2">
                                          <span className="text-[10px] text-secondary/40">
                                            {groupSelectedCount}/{group.fields.length}
                                          </span>
                                          <button
                                            onClick={() => handleSelectAllInGroup(group.endpoint.id)}
                                            className="text-[10px] text-primary/60 hover:text-primary"
                                          >
                                            All
                                          </button>
                                          <button
                                            onClick={() => handleDeselectAllInGroup(group.endpoint.id)}
                                            className="text-[10px] text-primary/60 hover:text-primary"
                                          >
                                            None
                                          </button>
                                        </div>
                                      </div>
                                      {/* ── Group fields ── */}
                                      {!isCollapsed && (
                                        <table className="w-full text-xs">
                                          <tbody>
                                            {group.fields.map((f) => {
                                              const selected = newTplSelectedPaths.has(f.path);
                                              return (
                                                <tr
                                                  key={f.path}
                                                  onClick={() => toggleFieldSelection(f.path)}
                                                  className={`border-b border-white/5 cursor-pointer transition ${
                                                    selected ? "bg-primary/10" : "hover:bg-white/5"
                                                  }`}
                                                >
                                                  <td className="w-8 px-2 py-1.5 text-center">
                                                    <input
                                                      type="checkbox"
                                                      checked={selected}
                                                      onChange={() => toggleFieldSelection(f.path)}
                                                      className="accent-emerald-500"
                                                      onClick={(e) => e.stopPropagation()}
                                                    />
                                                  </td>
                                                  <td className="px-2 py-1.5 font-mono text-primary break-all">
                                                    {f.path}
                                                  </td>
                                                  <td className="px-2 py-1.5">
                                                    {selected ? (
                                                      <input
                                                        className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-xs text-primary w-full focus:outline-none focus:ring-1 focus:ring-primary/50"
                                                        value={newTplDisplayNames[f.path] || ""}
                                                        onChange={(e) =>
                                                          setNewTplDisplayNames((prev) => ({
                                                            ...prev,
                                                            [f.path]: e.target.value,
                                                          }))
                                                        }
                                                        onClick={(e) => e.stopPropagation()}
                                                      />
                                                    ) : (
                                                      <span className="text-secondary/40">
                                                        {pathToDisplayName(f.path)}
                                                      </span>
                                                    )}
                                                  </td>
                                                  <td
                                                    className="px-2 py-1.5 text-secondary truncate max-w-[120px]"
                                                    title={String(f.value)}
                                                  >
                                                    {String(f.value)}
                                                  </td>
                                                  <td className="px-2 py-1.5 text-secondary/60 w-16">
                                                    {f.type}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="flex items-center gap-3 mt-2">
                                <button
                                  onClick={handleSelectAllVisible}
                                  className="text-xs text-primary/70 hover:text-primary"
                                >
                                  Select All
                                </button>
                                <button
                                  onClick={handleDeselectAllVisible}
                                  className="text-xs text-primary/70 hover:text-primary"
                                >
                                  Deselect All
                                </button>
                                <span className="text-xs text-secondary/50 ml-auto">
                                  {newTplSelectedPaths.size} fields selected
                                </span>
                              </div>
                            </>
                          )}
                        </div>

                        <div className="flex justify-end gap-3 pt-2 border-t border-white/5">
                          <button
                            onClick={() => setShowNewTemplateForm(false)}
                            className={btnCancel}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleCreateTemplate}
                            disabled={
                              newTplSaving ||
                              !newTplName.trim() ||
                              !newTplVendor ||
                              newTplSelectedPaths.size === 0
                            }
                            className={btnPrimary}
                          >
                            {newTplSaving ? "Saving..." : "Save Template \u2192"}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Templates table ───────────────────────────────────── */}
                  <div className="flex-1 overflow-auto">
                    {templates.length === 0 ? (
                      <p className="text-xs text-secondary/40 text-center py-12">
                        No templates yet. Create one from the last Execute response.
                      </p>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-secondary/60 uppercase border-b border-white/5 sticky top-0 bg-surface">
                            <th className="text-left px-4 py-2 font-medium">Name</th>
                            <th className="text-left px-2 py-2 font-medium w-28">Vendor</th>
                            <th className="text-left px-2 py-2 font-medium w-20">Scope</th>
                            <th className="text-left px-2 py-2 font-medium w-16">Fields</th>
                            <th className="text-right px-4 py-2 font-medium w-52">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {templates.map((tpl) => (
                            <Fragment key={tpl.id}>
                              <tr className="border-b border-white/5 hover:bg-white/5">
                                <td className="px-4 py-2 text-primary">
                                  {renamingTemplateId === tpl.id ? (
                                    <form
                                      onSubmit={(e) => {
                                        e.preventDefault();
                                        handleRenameTemplate(tpl.id);
                                      }}
                                      className="flex items-center gap-1"
                                    >
                                      <input
                                        className="bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-primary/50 w-48"
                                        value={renameValue}
                                        onChange={(e) => setRenameValue(e.target.value)}
                                        autoFocus
                                        onBlur={() => setRenamingTemplateId(null)}
                                      />
                                    </form>
                                  ) : (
                                    <span>{tpl.name}</span>
                                  )}
                                  {tpl.description && (
                                    <p className="text-secondary/40 mt-0.5 truncate max-w-xs">
                                      {tpl.description}
                                    </p>
                                  )}
                                </td>
                                <td className="px-2 py-2 text-secondary">{tpl.vendor}</td>
                                <td className="px-2 py-2 text-secondary/60">{tpl.scope}</td>
                                <td className="px-2 py-2 text-secondary">{tpl.field_count}</td>
                                <td className="px-4 py-2 text-right space-x-2">
                                  <button
                                    onClick={() => handleExpandTemplate(tpl.id)}
                                    className="text-primary/60 hover:text-primary"
                                  >
                                    {expandedTemplateId === tpl.id ? "Hide" : "Fields"}
                                  </button>
                                  <button
                                    onClick={() => {
                                      setRenamingTemplateId(tpl.id);
                                      setRenameValue(tpl.name);
                                    }}
                                    className="text-primary/60 hover:text-primary"
                                  >
                                    Rename
                                  </button>
                                  <button
                                    onClick={() => handleDuplicateTemplate(tpl)}
                                    className="text-primary/60 hover:text-primary"
                                  >
                                    Duplicate
                                  </button>
                                  {selectedConfigId && endpoints.length > 0 && (
                                    <select
                                      className="bg-white/5 border border-white/10 rounded px-1 py-0.5 text-xs text-secondary focus:outline-none"
                                      value=""
                                      onChange={(e) => {
                                        if (e.target.value)
                                          handleAssignTemplateToEndpoint(
                                            tpl.id,
                                            Number(e.target.value)
                                          );
                                      }}
                                    >
                                      <option value="">Assign...</option>
                                      {endpoints.map((ep) => (
                                        <option key={ep.id} value={ep.id}>
                                          {ep.name}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                  <button
                                    onClick={() => handleDeleteTemplate(tpl.id)}
                                    className="text-red-400/60 hover:text-red-400"
                                  >
                                    Delete
                                  </button>
                                </td>
                              </tr>
                              {expandedTemplateId === tpl.id && expandedTemplateDetail && (
                                <tr className="bg-white/[0.02]">
                                  <td colSpan={5} className="px-6 py-3">
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-secondary/60 uppercase">
                                          <th className="text-left py-1 pr-3 font-medium">JSON Path</th>
                                          <th className="text-left py-1 pr-3 font-medium">Display Name</th>
                                          <th className="text-left py-1 pr-3 font-medium">CMDB</th>
                                          <th className="text-left py-1 pr-3 font-medium">Grafana</th>
                                          <th className="text-left py-1 pr-3 font-medium">Type</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {expandedTemplateDetail.fields.map((f) => (
                                          <tr key={f.id} className="border-t border-white/5">
                                            <td className="py-1 pr-3 text-primary font-mono break-all">
                                              {f.json_path}
                                            </td>
                                            <td className="py-1 pr-3 text-secondary">
                                              {f.display_name}
                                            </td>
                                            <td className="py-1 pr-3 text-secondary/50">
                                              {f.cmdb_column || "\u2014"}
                                            </td>
                                            <td className="py-1 pr-3 text-secondary/50">
                                              {f.grafana_label || "\u2014"}
                                            </td>
                                            <td className="py-1 pr-3 text-secondary/50">
                                              {f.data_type}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}
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

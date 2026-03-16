import { useState, useEffect, useMemo } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import { StatCard } from "../components/ui/StatCard";
import { api } from "../api/client";
import type { VaultEntry, VaultCreate, VaultAuditEntry, CredentialType } from "../api/client";

// ── Credential type config ───────────────────────────────────────────────

const CRED_TYPE_CONFIG: Record<
  CredentialType,
  { icon: string; label: string; color: string; fields: string[] }
> = {
  ssh_password:      { icon: "\u{1F511}", label: "SSH Password",  color: "text-blue-400",    fields: ["username", "password"] },
  ssh_key:           { icon: "\u{1F5DD}\uFE0F", label: "SSH Key",       color: "text-cyan-400",    fields: ["username", "private_key", "passphrase"] },
  api_token:         { icon: "\u{1FA99}", label: "API Token",     color: "text-yellow-400",  fields: ["token", "service"] },
  snmp_v2_community: { icon: "\u{1F4E1}", label: "SNMP v2",       color: "text-green-400",   fields: ["community", "access"] },
  snmp_v3:           { icon: "\u{1F4E1}", label: "SNMP v3",       color: "text-emerald-400", fields: ["username", "auth_protocol", "auth_password", "priv_protocol", "priv_password"] },
  tls_cert:          { icon: "\u{1F512}", label: "TLS Cert",      color: "text-purple-400",  fields: ["certificate", "private_key"] },
};

const CRED_TYPES = Object.keys(CRED_TYPE_CONFIG) as CredentialType[];

type FilterStatus = "all" | "active" | "expired" | "inactive";
type SortKey = "name" | "credential_type" | "created_at" | "last_used_at" | "expires_at";

// ── Password strength ────────────────────────────────────────────────────

function passwordStrength(pw: string): { label: string; color: string; width: string } {
  if (!pw) return { label: "", color: "", width: "0%" };
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 2) return { label: "Weak", color: "bg-red-500", width: "33%" };
  if (score <= 3) return { label: "Medium", color: "bg-yellow-500", width: "66%" };
  return { label: "Strong", color: "bg-green-500", width: "100%" };
}

// ── Relative time ────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}

// ── Component ────────────────────────────────────────────────────────────

export function Vault() {
  // ── Data state ─────────────────────────────────────────────────────
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ── Filter/sort state ──────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<CredentialType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<SortKey>("name");

  // ── Modal state ────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [editEntry, setEditEntry] = useState<VaultEntry | null>(null);
  const [rotateEntry, setRotateEntry] = useState<VaultEntry | null>(null);
  const [auditEntry, setAuditEntry] = useState<VaultEntry | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<VaultEntry | null>(null);

  // ── Load data ──────────────────────────────────────────────────────
  async function loadEntries() {
    setLoading(true);
    setError("");
    try {
      const data = await api.vault.list();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load vault");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadEntries(); }, []);

  // ── Stats ──────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = entries.length;
    const ssh = entries.filter((e) => e.credential_type.startsWith("ssh")).length;
    const apiTokens = entries.filter((e) => e.credential_type === "api_token").length;
    const snmp = entries.filter((e) => e.credential_type.startsWith("snmp")).length;
    const expiringSoon = entries.filter((e) => {
      const d = daysUntil(e.expires_at);
      return d !== null && d > 0 && d <= 30;
    }).length;
    const expired = entries.filter((e) => e.is_expired).length;
    return { total, ssh, apiTokens, snmp, expiringSoon, expired };
  }, [entries]);

  // ── Filtered & sorted ─────────────────────────────────────────────
  const displayed = useMemo(() => {
    let list = [...entries];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          (e.username && e.username.toLowerCase().includes(q)) ||
          e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (typeFilter !== "all") list = list.filter((e) => e.credential_type === typeFilter);
    if (statusFilter === "active") list = list.filter((e) => e.is_active && !e.is_expired);
    else if (statusFilter === "expired") list = list.filter((e) => e.is_expired);
    else if (statusFilter === "inactive") list = list.filter((e) => !e.is_active);

    list.sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      return String(av).localeCompare(String(bv));
    });
    return list;
  }, [entries, search, typeFilter, statusFilter, sortBy]);

  // ── Render ─────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Vault"
        subtitle="Encrypted credential store"
        action={
          <button
            onClick={() => { setEditEntry(null); setShowCreate(true); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm
                       font-medium rounded-lg transition-colors"
          >
            + Add Credential
          </button>
        }
      />

      {/* ── Stats Bar ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Total" value={stats.total} />
        <StatCard label="SSH" value={stats.ssh} />
        <StatCard label="API Tokens" value={stats.apiTokens} />
        <StatCard label="SNMP" value={stats.snmp} />
        <StatCard label="Expiring Soon" value={stats.expiringSoon} alert={stats.expiringSoon > 0} />
        <StatCard label="Expired" value={stats.expired} alert={stats.expired > 0} />
      </div>

      {/* ── Filter Bar ─────────────────────────────────────────────── */}
      <div className="bg-surface rounded-lg border border-white/10 p-4 mb-6 flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, username, or tag..."
          className="flex-1 min-w-[200px] bg-background border border-white/10 rounded-lg px-3 py-2
                     text-sm text-primary placeholder:text-secondary/40
                     focus:outline-none focus:border-blue-500/50"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as CredentialType | "all")}
          className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                     focus:outline-none focus:border-blue-500/50"
        >
          <option value="all">All Types</option>
          {CRED_TYPES.map((t) => (
            <option key={t} value={t}>{CRED_TYPE_CONFIG[t].label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
          className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                     focus:outline-none focus:border-blue-500/50"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="inactive">Inactive</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
          className="bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary
                     focus:outline-none focus:border-blue-500/50"
        >
          <option value="name">Sort: Name</option>
          <option value="credential_type">Sort: Type</option>
          <option value="created_at">Sort: Created</option>
          <option value="last_used_at">Sort: Last Used</option>
          <option value="expires_at">Sort: Expiry</option>
        </select>
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {error && (
        <div className="mb-6 text-sm text-alert-critical bg-red-900/20 border border-red-700/30 rounded-lg px-4 py-2">
          {error}
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center justify-center py-20 text-secondary text-sm animate-pulse">
          Loading vault...
        </div>
      )}

      {/* ── Empty ──────────────────────────────────────────────────── */}
      {!loading && entries.length === 0 && !error && (
        <EmptyState message="No credentials stored yet. Click '+ Add Credential' to get started." />
      )}

      {/* ── Credentials Table ──────────────────────────────────────── */}
      {!loading && displayed.length > 0 && (
        <div className="bg-surface rounded-lg border border-white/10 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-secondary border-b border-white/10">
                  <th className="px-4 py-3 w-8" />
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Username</th>
                  <th className="px-4 py-3">Tags</th>
                  <th className="px-4 py-3">Last Used</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((entry) => {
                  const cfg = CRED_TYPE_CONFIG[entry.credential_type];
                  const expDays = daysUntil(entry.expires_at);
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className={`px-4 py-3 ${cfg.color}`}>{cfg.icon}</td>
                      <td className="px-4 py-3 text-primary font-medium">{entry.name}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-white/5 ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                          entry.scope === "global"
                            ? "bg-blue-900/40 text-blue-300 border border-blue-700/50"
                            : "bg-white/5 text-secondary"
                        }`}>
                          {entry.scope}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-secondary font-mono text-xs">
                        {entry.username || "\u2014"}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {entry.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 text-xs bg-white/10 rounded text-secondary"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-secondary text-xs">
                        {relativeTime(entry.last_used_at)}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {entry.expires_at ? (
                          <span className={
                            entry.is_expired
                              ? "text-alert-critical"
                              : expDays !== null && expDays <= 30
                              ? "text-alert-warning"
                              : "text-secondary"
                          }>
                            {entry.is_expired
                              ? "Expired"
                              : expDays !== null && expDays <= 30
                              ? `${expDays}d left`
                              : new Date(entry.expires_at).toLocaleDateString()}
                          </span>
                        ) : (
                          <span className="text-secondary">Never</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!entry.is_active ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-800/60 text-gray-400 border border-gray-700/50">
                            Inactive
                          </span>
                        ) : entry.is_expired ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-900/40 text-red-300 border border-red-700/50">
                            Expired
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-900/40 text-green-300 border border-green-700/50">
                            Active
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button
                            onClick={() => { setEditEntry(entry); setShowCreate(true); }}
                            title="Edit"
                            className="p-1.5 rounded hover:bg-white/10 text-secondary hover:text-primary transition-colors"
                          >
                            &#9998;
                          </button>
                          <button
                            onClick={() => setRotateEntry(entry)}
                            title="Rotate"
                            className="p-1.5 rounded hover:bg-white/10 text-secondary hover:text-primary transition-colors"
                          >
                            &#x21BB;
                          </button>
                          <button
                            onClick={() => setAuditEntry(entry)}
                            title="Audit"
                            className="p-1.5 rounded hover:bg-white/10 text-secondary hover:text-primary transition-colors"
                          >
                            &#x1F4CB;
                          </button>
                          <button
                            onClick={() => setDeleteEntry(entry)}
                            title="Delete"
                            className="p-1.5 rounded hover:bg-white/10 text-secondary hover:text-alert-critical transition-colors"
                          >
                            &#x1F5D1;
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-xs text-secondary border-t border-white/10">
            {displayed.length} of {entries.length} credentials
          </div>
        </div>
      )}

      {/* ── Create / Edit Modal ────────────────────────────────────── */}
      {showCreate && (
        <CreateEditModal
          entry={editEntry}
          onClose={() => { setShowCreate(false); setEditEntry(null); }}
          onSaved={() => { setShowCreate(false); setEditEntry(null); loadEntries(); }}
        />
      )}

      {/* ── Rotate Modal ───────────────────────────────────────────── */}
      {rotateEntry && (
        <RotateModal
          entry={rotateEntry}
          onClose={() => setRotateEntry(null)}
          onRotated={() => { setRotateEntry(null); loadEntries(); }}
        />
      )}

      {/* ── Audit Slide-over ───────────────────────────────────────── */}
      {auditEntry && (
        <AuditPanel
          entry={auditEntry}
          onClose={() => setAuditEntry(null)}
        />
      )}

      {/* ── Delete Confirmation ────────────────────────────────────── */}
      {deleteEntry && (
        <DeleteModal
          entry={deleteEntry}
          onClose={() => setDeleteEntry(null)}
          onDeleted={() => { setDeleteEntry(null); loadEntries(); }}
        />
      )}
    </div>
  );
}

// ── Create / Edit Modal ──────────────────────────────────────────────────

function CreateEditModal({
  entry,
  onClose,
  onSaved,
}: {
  entry: VaultEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = entry !== null;
  const [credType, setCredType] = useState<CredentialType>(entry?.credential_type ?? "ssh_password");
  const [name, setName] = useState(entry?.name ?? "");
  const [scope, setScope] = useState(entry?.scope ?? "global");
  const [username, setUsername] = useState(entry?.username ?? "");
  const [secretValue, setSecretValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, unknown>>(entry?.metadata ?? {});
  const [tagsInput, setTagsInput] = useState((entry?.tags ?? []).join(", "));
  const [expiresAt, setExpiresAt] = useState(entry?.expires_at?.slice(0, 10) ?? "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors.name = "Name is required";
    if (!isEdit && !secretValue.trim()) errors.secret = "Secret value is required";
    if (needsConfirm && secretValue !== confirmValue) errors.confirm = "Values do not match";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const needsConfirm = credType === "ssh_password" || credType === "snmp_v2_community" ||
    credType === "snmp_v3";
  const isPasswordField = credType === "ssh_password" || credType === "snmp_v2_community";
  const strength = isPasswordField ? passwordStrength(secretValue) : null;

  async function handleSubmit() {
    if (!validate()) return;
    setSaving(true);
    setFormError("");
    try {
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean);
      if (isEdit) {
        const updateData: Partial<VaultCreate> = { name, username: username || undefined };
        if (secretValue) updateData.secret_value = secretValue;
        if (tagsInput !== (entry.tags ?? []).join(", ")) (updateData as Record<string, unknown>).tags = tags;
        if (expiresAt) updateData.expires_at = new Date(expiresAt).toISOString();
        await api.vault.update(entry.id, updateData);
      } else {
        const createData: VaultCreate = {
          name,
          credential_type: credType,
          scope,
          secret_value: secretValue,
          tags,
          ...(username && { username }),
          ...(Object.keys(metadata).length > 0 && { metadata }),
          ...(expiresAt && { expires_at: new Date(expiresAt).toISOString() }),
        };
        await api.vault.create(createData);
      }
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // ── Dynamic fields based on credential type ────────────────────────

  function renderSecretFields() {
    const inputCls = "w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-blue-500/50";

    switch (credType) {
      case "ssh_password":
        return (
          <>
            <Field label="Username" error={fieldErrors.username}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" className={inputCls} />
            </Field>
            <Field label={isEdit ? "New Password (leave blank to keep)" : "Password"} error={fieldErrors.secret}>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  className={inputCls + " pr-10"}
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary text-sm">
                  {showSecret ? "\u{1F648}" : "\u{1F441}"}
                </button>
              </div>
              {strength && secretValue && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${strength.color}`} style={{ width: strength.width }} />
                  </div>
                  <span className="text-xs text-secondary">{strength.label}</span>
                </div>
              )}
            </Field>
            {needsConfirm && secretValue && (
              <Field label="Confirm Password" error={fieldErrors.confirm}>
                <input type="password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} className={inputCls} />
              </Field>
            )}
          </>
        );

      case "ssh_key":
        return (
          <>
            <Field label="Username" error={fieldErrors.username}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="root" className={inputCls} />
            </Field>
            <Field label={isEdit ? "New Private Key (leave blank to keep)" : "Private Key"} error={fieldErrors.secret}>
              <textarea
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                rows={6}
                className={inputCls + " font-mono text-xs"}
              />
            </Field>
            <Field label="Passphrase (optional)">
              <input
                type={showSecret ? "text" : "password"}
                value={String(metadata.passphrase ?? "")}
                onChange={(e) => setMetadata({ ...metadata, passphrase: e.target.value || undefined })}
                className={inputCls}
              />
            </Field>
          </>
        );

      case "api_token":
        return (
          <>
            <Field label="Service" error={fieldErrors.service}>
              <select
                value={String(metadata.service ?? "")}
                onChange={(e) => setMetadata({ ...metadata, service: e.target.value })}
                className={inputCls}
              >
                <option value="">Select service...</option>
                <option value="juniper_mist">Juniper MIST</option>
                <option value="twilio">Twilio</option>
                <option value="telegram">Telegram</option>
                <option value="custom">Custom</option>
              </select>
            </Field>
            <Field label={isEdit ? "New Token (leave blank to keep)" : "Token"} error={fieldErrors.secret}>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  className={inputCls + " pr-10"}
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary text-sm">
                  {showSecret ? "\u{1F648}" : "\u{1F441}"}
                </button>
              </div>
            </Field>
          </>
        );

      case "snmp_v2_community":
        return (
          <>
            <Field label={isEdit ? "New Community String (leave blank to keep)" : "Community String"} error={fieldErrors.secret}>
              <div className="relative">
                <input
                  type={showSecret ? "text" : "password"}
                  value={secretValue}
                  onChange={(e) => setSecretValue(e.target.value)}
                  className={inputCls + " pr-10"}
                />
                <button type="button" onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary text-sm">
                  {showSecret ? "\u{1F648}" : "\u{1F441}"}
                </button>
              </div>
              {strength && secretValue && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${strength.color}`} style={{ width: strength.width }} />
                  </div>
                  <span className="text-xs text-secondary">{strength.label}</span>
                </div>
              )}
            </Field>
            {needsConfirm && secretValue && (
              <Field label="Confirm Community String" error={fieldErrors.confirm}>
                <input type="password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} className={inputCls} />
              </Field>
            )}
            <Field label="Access">
              <select
                value={String(metadata.access ?? "ro")}
                onChange={(e) => setMetadata({ ...metadata, access: e.target.value })}
                className={inputCls}
              >
                <option value="ro">Read-only</option>
                <option value="rw">Read-write</option>
              </select>
            </Field>
          </>
        );

      case "snmp_v3":
        return (
          <>
            <Field label="Username" error={fieldErrors.username}>
              <input value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Auth Protocol">
              <select
                value={String(metadata.auth_protocol ?? "SHA")}
                onChange={(e) => setMetadata({ ...metadata, auth_protocol: e.target.value })}
                className={inputCls}
              >
                <option value="MD5">MD5</option>
                <option value="SHA">SHA</option>
              </select>
            </Field>
            <Field label={isEdit ? "New Auth Password (leave blank to keep)" : "Auth Password"} error={fieldErrors.secret}>
              <input
                type={showSecret ? "text" : "password"}
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                className={inputCls}
              />
            </Field>
            {needsConfirm && secretValue && (
              <Field label="Confirm Auth Password" error={fieldErrors.confirm}>
                <input type="password" value={confirmValue} onChange={(e) => setConfirmValue(e.target.value)} className={inputCls} />
              </Field>
            )}
            <Field label="Priv Protocol">
              <select
                value={String(metadata.priv_protocol ?? "AES")}
                onChange={(e) => setMetadata({ ...metadata, priv_protocol: e.target.value })}
                className={inputCls}
              >
                <option value="DES">DES</option>
                <option value="AES">AES</option>
              </select>
            </Field>
            <Field label="Priv Password">
              <input
                type={showSecret ? "text" : "password"}
                value={String(metadata.priv_password ?? "")}
                onChange={(e) => setMetadata({ ...metadata, priv_password: e.target.value || undefined })}
                className={inputCls}
              />
            </Field>
          </>
        );

      case "tls_cert":
        return (
          <>
            <Field label="Certificate (PEM)" error={fieldErrors.cert}>
              <textarea
                value={String(metadata.certificate ?? "")}
                onChange={(e) => setMetadata({ ...metadata, certificate: e.target.value })}
                placeholder="-----BEGIN CERTIFICATE-----"
                rows={6}
                className={inputCls + " font-mono text-xs"}
              />
            </Field>
            <Field label={isEdit ? "New Private Key (leave blank to keep)" : "Private Key (PEM)"} error={fieldErrors.secret}>
              <textarea
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----"
                rows={6}
                className={inputCls + " font-mono text-xs"}
              />
            </Field>
          </>
        );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-surface rounded-xl border border-white/10 shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-primary">
            {isEdit ? "Edit Credential" : "Add Credential"}
          </h2>
          <button onClick={onClose} className="text-secondary hover:text-primary text-xl">&times;</button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {!isEdit && (
            <Field label="Credential Type">
              <select
                value={credType}
                onChange={(e) => setCredType(e.target.value as CredentialType)}
                className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500/50"
              >
                {CRED_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CRED_TYPE_CONFIG[t].icon} {CRED_TYPE_CONFIG[t].label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Name" error={fieldErrors.name}>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BCN Core Switch SSH"
              className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-blue-500/50"
            />
          </Field>
          {!isEdit && (
            <Field label="Scope">
              <input
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                placeholder="global"
                className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-blue-500/50"
              />
            </Field>
          )}
          {renderSecretFields()}
          <Field label="Tags (comma-separated)">
            <input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="cisco, core, bcn"
              className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-blue-500/50"
            />
          </Field>
          <Field label="Expires (optional)">
            <input
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500/50"
            />
          </Field>
          {formError && (
            <div className="text-sm text-alert-critical bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
              {formError}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-primary text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {saving ? "Saving..." : isEdit ? "Update Credential" : "Create Credential"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rotate Modal ─────────────────────────────────────────────────────────

function RotateModal({
  entry,
  onClose,
  onRotated,
}: {
  entry: VaultEntry;
  onClose: () => void;
  onRotated: () => void;
}) {
  const [newValue, setNewValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState("");

  async function handleRotate() {
    if (!newValue.trim()) { setError("New value is required"); return; }
    if (newValue !== confirmValue) { setError("Values do not match"); return; }
    setRotating(true);
    setError("");
    try {
      await api.vault.rotate(entry.id, newValue);
      onRotated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-white/10 shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-primary">Rotate Credential</h2>
          <p className="text-sm text-secondary mt-1">{entry.name}</p>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div className="text-sm text-alert-warning bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-3 py-2">
            This will replace the current value. The old value cannot be recovered.
          </div>
          <Field label="New value">
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary pr-10 focus:outline-none focus:border-blue-500/50"
              />
              <button type="button" onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary hover:text-primary text-sm">
                {showSecret ? "\u{1F648}" : "\u{1F441}"}
              </button>
            </div>
          </Field>
          <Field label="Confirm value">
            <input
              type="password"
              value={confirmValue}
              onChange={(e) => setConfirmValue(e.target.value)}
              className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-blue-500/50"
            />
          </Field>
          {error && (
            <div className="text-sm text-alert-critical bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-primary text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleRotate}
            disabled={rotating || !newValue}
            className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {rotating ? "Rotating..." : "Rotate Credential"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Audit Panel ──────────────────────────────────────────────────────────

function AuditPanel({
  entry,
  onClose,
}: {
  entry: VaultEntry;
  onClose: () => void;
}) {
  const [auditLog, setAuditLog] = useState<VaultAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.vault.audit(entry.id).then(setAuditLog).catch(() => {}).finally(() => setLoading(false));
  }, [entry.id]);

  const actionColors: Record<string, string> = {
    created: "text-green-400",
    read: "text-blue-400",
    updated: "text-yellow-400",
    deleted: "text-red-400",
    rotated: "text-purple-400",
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="bg-surface w-full max-w-md h-full border-l border-white/10 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-primary">Audit Trail</h2>
            <p className="text-sm text-secondary">{entry.name}</p>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary text-xl">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading && <p className="text-sm text-secondary animate-pulse">Loading audit log...</p>}
          {!loading && auditLog.length === 0 && <p className="text-sm text-secondary">No audit entries.</p>}
          {auditLog.map((a) => (
            <div key={a.id} className="flex items-start gap-3 py-3 border-b border-white/5">
              <div className="flex-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-secondary text-xs">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                  <span className="text-primary font-medium">{a.performed_by}</span>
                  <span className={`font-medium ${actionColors[a.action] ?? "text-secondary"}`}>
                    {a.action}
                  </span>
                </div>
                {(a.ip_address || a.source_service) && (
                  <p className="text-xs text-secondary mt-0.5">
                    {a.source_service && `via ${a.source_service} `}
                    {a.ip_address && `from ${a.ip_address}`}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Delete Modal ─────────────────────────────────────────────────────────

function DeleteModal({
  entry,
  onClose,
  onDeleted,
}: {
  entry: VaultEntry;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (confirmName !== entry.name) return;
    setDeleting(true);
    setError("");
    try {
      await api.vault.delete(entry.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-white/10 shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-alert-critical">Delete Credential</h2>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-sm text-secondary">
            Type <strong className="text-primary">"{entry.name}"</strong> to confirm deletion.
          </p>
          <input
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={entry.name}
            className="w-full bg-background border border-white/10 rounded-lg px-3 py-2 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-red-500/50"
          />
          {error && (
            <div className="text-sm text-alert-critical bg-red-900/20 border border-red-700/30 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 bg-white/5 hover:bg-white/10 text-primary text-sm rounded-lg transition-colors">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={confirmName !== entry.name || deleting}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {deleting ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Field Helper ─────────────────────────────────────────────────────────

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-secondary mb-1">{label}</label>
      {children}
      {error && <p className="text-xs text-alert-critical mt-1">{error}</p>}
    </div>
  );
}

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import {
  api,
  AlertContact,
  ChannelCreatePayload,
  ContactCreatePayload,
  TestResult,
  ChannelType,
  MinSeverity,
} from "../api/client";

// ── Channel config ───────────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<
  ChannelType,
  { label: string; color: string; recipientLabel: string; recipientPlaceholder: string }
> = {
  email: {
    label: "Email",
    color: "text-purple-400",
    recipientLabel: "Email address",
    recipientPlaceholder: "user@example.com",
  },
  sms: {
    label: "Phone (SMS)",
    color: "text-amber-400",
    recipientLabel: "Phone number (E.164)",
    recipientPlaceholder: "+521234567890",
  },
  whatsapp: {
    label: "Phone (WhatsApp)",
    color: "text-green-400",
    recipientLabel: "Phone number (E.164)",
    recipientPlaceholder: "+521234567890",
  },
  telegram: {
    label: "Telegram",
    color: "text-blue-400",
    recipientLabel: "Telegram Chat ID",
    recipientPlaceholder: "123456789",
  },
};

const SEVERITY_CONFIG: Record<MinSeverity, { label: string; color: string }> = {
  INFO: { label: "All alerts", color: "bg-blue-900/40 text-blue-300 border-blue-700/50" },
  WARNING: { label: "Warning+", color: "bg-amber-900/40 text-amber-300 border-amber-700/50" },
  CRITICAL: { label: "Critical only", color: "bg-red-900/40 text-red-300 border-red-700/50" },
};

// ── Helper types ─────────────────────────────────────────────────────────

interface ChannelFormRow {
  channel_type: ChannelType;
  recipient_value: string;
  min_severity: MinSeverity;
  whatsapp_use_separate_sender: boolean;
  whatsapp_sender_number: string;
}

function emptyChannel(): ChannelFormRow {
  return {
    channel_type: "telegram",
    recipient_value: "",
    min_severity: "WARNING",
    whatsapp_use_separate_sender: false,
    whatsapp_sender_number: "",
  };
}

// ── Toast component ──────────────────────────────────────────────────────

interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let toastId = 0;

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`px-4 py-3 rounded-lg text-sm shadow-lg cursor-pointer transition-opacity ${
            t.type === "success"
              ? "bg-green-900/90 text-green-200 border border-green-700/50"
              : t.type === "error"
              ? "bg-red-900/90 text-red-200 border border-red-700/50"
              : "bg-blue-900/90 text-blue-200 border border-blue-700/50"
          }`}
          onClick={() => onDismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────

export function AlertsSetup() {
  const [contacts, setContacts] = useState<AlertContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<AlertContact | null>(null);
  const [formName, setFormName] = useState("");
  const [formActive, setFormActive] = useState(true);
  const [formChannels, setFormChannels] = useState<ChannelFormRow[]>([emptyChannel()]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<AlertContact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"]) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ── Data fetch ─────────────────────────────────────────────────────────

  const fetchContacts = useCallback(async () => {
    try {
      const data = await api.alertContacts.list();
      setContacts(data);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  // ── Drawer handlers ────────────────────────────────────────────────────

  function openCreate() {
    setEditingContact(null);
    setFormName("");
    setFormActive(true);
    setFormChannels([emptyChannel()]);
    setFormError("");
    setDrawerOpen(true);
  }

  function openEdit(contact: AlertContact) {
    setEditingContact(contact);
    setFormName(contact.display_name);
    setFormActive(contact.is_active);
    // For edit, we start with empty channels since we can't decrypt existing values
    // User adds new channels or manages via the card
    setFormChannels([emptyChannel()]);
    setFormError("");
    setDrawerOpen(true);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingContact(null);
  }

  function updateChannel(index: number, updates: Partial<ChannelFormRow>) {
    setFormChannels((prev) =>
      prev.map((ch, i) => (i === index ? { ...ch, ...updates } : ch))
    );
  }

  function removeChannel(index: number) {
    if (formChannels.length <= 1 && !editingContact) return;
    setFormChannels((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSave() {
    setFormError("");

    if (!formName.trim()) {
      setFormError("Display name is required");
      return;
    }

    if (editingContact) {
      // Update mode — just update name/active, add new channels if any non-empty
      setSaving(true);
      try {
        await api.alertContacts.update(editingContact.id, {
          display_name: formName.trim(),
          is_active: formActive,
        });

        // Add any filled channels
        for (const ch of formChannels) {
          if (ch.recipient_value.trim()) {
            const payload: ChannelCreatePayload = {
              channel_type: ch.channel_type,
              recipient_value: ch.recipient_value.trim(),
              min_severity: ch.min_severity,
              whatsapp_use_separate_sender: ch.whatsapp_use_separate_sender,
            };
            if (ch.whatsapp_sender_number.trim()) {
              payload.whatsapp_sender_number = ch.whatsapp_sender_number.trim();
            }
            try {
              await api.alertContacts.addChannel(editingContact.id, payload);
            } catch {
              // Channel may already exist — skip
            }
          }
        }

        await fetchContacts();
        closeDrawer();
        addToast("Contact updated", "success");
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "Failed to update");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create mode
    const validChannels = formChannels.filter((ch) => ch.recipient_value.trim());
    if (validChannels.length === 0) {
      setFormError("At least one channel with a recipient is required");
      return;
    }

    // Validate
    for (const ch of validChannels) {
      if (ch.channel_type === "email" && !ch.recipient_value.includes("@")) {
        setFormError("Invalid email address");
        return;
      }
      if ((ch.channel_type === "sms" || ch.channel_type === "whatsapp") && !ch.recipient_value.startsWith("+")) {
        setFormError("Phone number must start with + (E.164 format)");
        return;
      }
      if (ch.channel_type === "telegram" && !/^\d+$/.test(ch.recipient_value.trim())) {
        setFormError("Telegram Chat ID must be numeric");
        return;
      }
      if (ch.channel_type === "whatsapp" && ch.whatsapp_use_separate_sender && !ch.whatsapp_sender_number.trim()) {
        setFormError("WhatsApp separate sender number is required when enabled");
        return;
      }
    }

    setSaving(true);
    try {
      const payload: ContactCreatePayload = {
        display_name: formName.trim(),
        is_active: formActive,
        channels: validChannels.map((ch) => {
          const p: ChannelCreatePayload = {
            channel_type: ch.channel_type,
            recipient_value: ch.recipient_value.trim(),
            min_severity: ch.min_severity,
            whatsapp_use_separate_sender: ch.whatsapp_use_separate_sender,
          };
          if (ch.whatsapp_sender_number.trim()) {
            p.whatsapp_sender_number = ch.whatsapp_sender_number.trim();
          }
          return p;
        }),
      };
      await api.alertContacts.create(payload);
      await fetchContacts();
      closeDrawer();
      addToast("Contact created", "success");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Failed to create contact");
    } finally {
      setSaving(false);
    }
  }

  // ── Delete handler ─────────────────────────────────────────────────────

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.alertContacts.delete(deleteTarget.id);
      await fetchContacts();
      setDeleteTarget(null);
      addToast("Contact deleted", "success");
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to delete", "error");
    } finally {
      setDeleting(false);
    }
  }

  // ── Toggle active ──────────────────────────────────────────────────────

  async function toggleActive(contact: AlertContact) {
    try {
      await api.alertContacts.update(contact.id, { is_active: !contact.is_active });
      await fetchContacts();
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Failed to toggle", "error");
    }
  }

  // ── Test handler ───────────────────────────────────────────────────────

  async function handleTest(contact: AlertContact) {
    setTestingId(contact.id);
    try {
      const { results } = await api.alertContacts.test(contact.id);
      for (const r of results) {
        if (r.channel_type === "email") {
          addToast("Email test skipped -- SMTP not yet configured", "info");
        } else if (r.success) {
          addToast(`Test sent via ${CHANNEL_CONFIG[r.channel_type].label}`, "success");
        } else {
          addToast(`${CHANNEL_CONFIG[r.channel_type].label} test failed: ${r.error}`, "error");
        }
      }
      if (results.length === 0) {
        addToast("No active channels to test", "info");
      }
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Test failed", "error");
    } finally {
      setTestingId(null);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-secondary text-sm">Loading alert contacts...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Alerts Setup"
        subtitle="Manage who receives alert notifications and on which channels."
        action={
          <button
            onClick={openCreate}
            className="px-4 py-2 rounded-lg text-sm bg-primary/90 hover:bg-primary text-white transition-colors"
          >
            + Add Contact
          </button>
        }
      />

      {error && (
        <div className="bg-red-900/40 text-red-300 border border-red-700/50 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Contact cards */}
      {contacts.length === 0 ? (
        <div className="bg-surface border border-white/10 rounded-xl p-12 text-center">
          <p className="text-secondary text-sm">No alert contacts configured.</p>
          <p className="text-secondary/60 text-xs mt-1">Add your first contact to start receiving notifications.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {contacts.map((contact) => (
            <div
              key={contact.id}
              className="bg-surface border border-white/10 rounded-xl p-5 flex flex-col gap-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold text-primary">{contact.display_name}</h3>
                  <button
                    onClick={() => toggleActive(contact)}
                    className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border cursor-pointer transition-colors ${
                      contact.is_active
                        ? "bg-green-900/40 text-green-300 border-green-700/50 hover:bg-green-900/60"
                        : "bg-white/5 text-secondary border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {contact.is_active ? "Active" : "Inactive"}
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEdit(contact)}
                    className="px-3 py-1.5 rounded-lg text-xs text-secondary hover:text-primary hover:bg-white/5 transition-colors"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleTest(contact)}
                    disabled={testingId === contact.id}
                    className="px-3 py-1.5 rounded-lg text-xs border border-white/10 text-secondary hover:text-primary hover:bg-white/5 transition-colors disabled:opacity-50"
                  >
                    {testingId === contact.id ? "Sending..." : "Test"}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(contact)}
                    className="px-3 py-1.5 rounded-lg text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Channel chips */}
              <div className="flex flex-wrap gap-2">
                {contact.channels.map((ch) => (
                  <div
                    key={ch.id}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border border-white/10 bg-white/5 ${
                      ch.is_active ? "" : "opacity-40"
                    }`}
                  >
                    <span className={CHANNEL_CONFIG[ch.channel_type]?.color ?? "text-secondary"}>
                      {CHANNEL_CONFIG[ch.channel_type]?.label ?? ch.channel_type}
                    </span>
                    <span className="text-secondary/60">{ch.recipient_value}</span>
                    <span
                      className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                        SEVERITY_CONFIG[ch.min_severity]?.color ?? ""
                      }`}
                    >
                      {SEVERITY_CONFIG[ch.min_severity]?.label ?? ch.min_severity}
                    </span>
                  </div>
                ))}
                {contact.channels.length === 0 && (
                  <span className="text-xs text-secondary/40">No channels configured</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Drawer ──────────────────────────────────────────────────────── */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={closeDrawer} />
          <div className="fixed top-0 right-0 h-full w-full max-w-lg bg-surface border-l border-white/10 z-50 overflow-y-auto flex flex-col">
            <div className="px-6 py-5 border-b border-white/10">
              <h2 className="text-sm font-semibold text-primary">
                {editingContact ? "Edit Contact" : "Add Contact"}
              </h2>
            </div>

            <div className="flex-1 px-6 py-5 flex flex-col gap-5 overflow-y-auto">
              {formError && (
                <div className="bg-red-900/40 text-red-300 border border-red-700/50 rounded-lg px-3 py-2 text-xs">
                  {formError}
                </div>
              )}

              {/* Contact details */}
              <div className="flex flex-col gap-3">
                <label className="text-xs text-secondary font-medium">Display Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  maxLength={80}
                  placeholder="NOC Engineer 1"
                  className="px-3 py-2.5 rounded-lg bg-background border border-white/10 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-primary/60 transition-colors"
                />

                <div className="flex items-center gap-2 mt-1">
                  <label className="text-xs text-secondary font-medium">Active</label>
                  <button
                    type="button"
                    onClick={() => setFormActive(!formActive)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      formActive ? "bg-primary" : "bg-white/20"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${
                        formActive ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Channels */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-secondary font-medium">
                    Notification Channels {!editingContact && "-- at least one required"}
                  </label>
                </div>

                {formChannels.map((ch, idx) => (
                  <div key={idx} className="bg-background border border-white/10 rounded-lg p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-secondary/60">Channel {idx + 1}</span>
                      {(formChannels.length > 1 || editingContact) && (
                        <button
                          onClick={() => removeChannel(idx)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          Remove
                        </button>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-secondary/60">Channel Type</label>
                      <select
                        value={ch.channel_type}
                        onChange={(e) =>
                          updateChannel(idx, { channel_type: e.target.value as ChannelType })
                        }
                        className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-primary focus:outline-none focus:border-primary/60"
                      >
                        {Object.entries(CHANNEL_CONFIG).map(([key, cfg]) => (
                          <option key={key} value={key}>
                            {cfg.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-secondary/60">
                        {CHANNEL_CONFIG[ch.channel_type].recipientLabel}
                      </label>
                      <input
                        type="text"
                        value={ch.recipient_value}
                        onChange={(e) => updateChannel(idx, { recipient_value: e.target.value })}
                        placeholder={CHANNEL_CONFIG[ch.channel_type].recipientPlaceholder}
                        className="px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-primary/60 transition-colors"
                      />
                    </div>

                    {ch.channel_type === "whatsapp" && (
                      <div className="bg-amber-900/20 border border-amber-700/30 rounded-lg px-3 py-2 text-xs text-amber-300/90">
                        WhatsApp requires your Twilio number to be WhatsApp-enabled. For testing,
                        activate the Twilio WhatsApp Sandbox at console.twilio.com. For production,
                        a Meta Business API approval is required. SMS will work immediately with no
                        extra setup.
                      </div>
                    )}

                    {ch.channel_type === "email" && (
                      <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-3 py-2 text-xs text-blue-300/90">
                        Email dispatch is not yet implemented. SMTP configuration is required (future work).
                      </div>
                    )}

                    <div className="flex flex-col gap-2">
                      <label className="text-xs text-secondary/60">Severity Threshold</label>
                      <select
                        value={ch.min_severity}
                        onChange={(e) =>
                          updateChannel(idx, { min_severity: e.target.value as MinSeverity })
                        }
                        className="px-3 py-2 rounded-lg bg-surface border border-white/10 text-sm text-primary focus:outline-none focus:border-primary/60"
                      >
                        <option value="INFO">INFO (all alerts)</option>
                        <option value="WARNING">WARNING and above</option>
                        <option value="CRITICAL">CRITICAL only</option>
                      </select>
                    </div>

                    {ch.channel_type === "whatsapp" && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={ch.whatsapp_use_separate_sender}
                            onChange={(e) =>
                              updateChannel(idx, { whatsapp_use_separate_sender: e.target.checked })
                            }
                            className="rounded border-white/20"
                          />
                          <label className="text-xs text-secondary/60">
                            Use separate WhatsApp sender number
                          </label>
                        </div>
                        {ch.whatsapp_use_separate_sender && (
                          <input
                            type="text"
                            value={ch.whatsapp_sender_number}
                            onChange={(e) =>
                              updateChannel(idx, { whatsapp_sender_number: e.target.value })
                            }
                            placeholder="+15551234567"
                            className="px-3 py-2.5 rounded-lg bg-surface border border-white/10 text-sm text-primary placeholder:text-secondary/40 focus:outline-none focus:border-primary/60 transition-colors"
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={() => setFormChannels((prev) => [...prev, emptyChannel()])}
                  className="px-3 py-2 rounded-lg text-xs text-secondary border border-dashed border-white/10 hover:border-white/20 hover:text-primary transition-colors"
                >
                  + Add Channel
                </button>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-white/10 flex justify-end gap-3">
              <button
                onClick={closeDrawer}
                className="px-4 py-2 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 rounded-lg text-sm bg-primary/90 hover:bg-primary text-white transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Contact"}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Delete dialog ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setDeleteTarget(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-surface border border-white/10 rounded-xl p-6 w-full max-w-sm flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-primary">Delete {deleteTarget.display_name}?</h3>
            <p className="text-xs text-secondary">
              This will permanently remove the contact and all their notification channels. This action
              cannot be undone.
            </p>
            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg text-sm text-secondary hover:text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg text-sm bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </>
      )}

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

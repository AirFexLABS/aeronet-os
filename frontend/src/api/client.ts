/**
 * Typed API client for AeroNet OS backend.
 * All requests go through the api-gateway at /api.
 * JWT token is read from localStorage key "aeronet_token".
 */

const BASE = import.meta.env.VITE_API_URL ?? "/api";

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("aeronet_token");
  return token
    ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────

export interface Device {
  [key: string]: unknown;
  serial_number: string;
  hostname: string;
  ip_address: string;
  device_type: string;
  site_id: string;
  status: "active" | "offline" | "unknown";
  last_seen: string;
}

export interface ConnectivityEntry {
  ap_serial: string;
  ap_hostname: string;
  ap_ip: string;
  site_id: string;
  switch_hostname: string;
  switch_port: string;
  last_updated: string;
}

export interface AuditLog {
  [key: string]: unknown;
  id: number;
  event_type: string;
  severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  device_serial: string;
  message: string;
  source_service: string;
  created_at: string;
}

export interface DashboardStats {
  total_devices: number;
  offline_devices: number;
  asset_moved_24h: number;
  auth_failures_24h: number;
}

export interface DiscoveredDevice {
  ip:           string;
  hostname:     string;
  mac:          string;
  vendor:       string;
  device_class: "router" | "switch" | "ap" | "server" | "printer" | "unknown";
  open_ports:   number[];
  os_guess:     string;
  confidence:   number;
  snmp_desc:    string | null;
}

export interface DiscoverRequest {
  cidr:    string;
  timeout?: number;
}

export interface DeviceRegistration {
  serial_number: string;
  hostname:      string;
  ip_address:    string;
  device_type:   string;
  site_id:       string;
  status:        string;
}

// ── Alert contact types ──────────────────────────────────────────────────

export type ChannelType = "email" | "sms" | "whatsapp" | "telegram";
export type MinSeverity = "INFO" | "WARNING" | "CRITICAL";

export interface AlertChannel {
  id: string;
  channel_type: ChannelType;
  recipient_value: string; // masked
  min_severity: MinSeverity;
  whatsapp_use_separate_sender: boolean;
  is_active: boolean;
}

export interface AlertContact {
  id: string;
  display_name: string;
  is_active: boolean;
  channels: AlertChannel[];
  created_at: string;
  updated_at: string;
}

export interface ChannelCreatePayload {
  channel_type: ChannelType;
  recipient_value: string;
  min_severity: MinSeverity;
  whatsapp_use_separate_sender: boolean;
  whatsapp_sender_number?: string;
}

export interface ContactCreatePayload {
  display_name: string;
  is_active: boolean;
  channels: ChannelCreatePayload[];
}

export interface TestResult {
  channel_id: string;
  channel_type: ChannelType;
  success: boolean;
  error: string | null;
}

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  from_address: string;
  from_name: string;
  use_tls: boolean;
  is_configured: boolean;
  updated_at: string;
}

// ── Vault types ──────────────────────────────────────────────────────────

export type CredentialType =
  | "ssh_password"
  | "ssh_key"
  | "api_token"
  | "snmp_v2_community"
  | "snmp_v3"
  | "tls_cert";

export interface VaultEntry {
  id:              string;
  name:            string;
  credential_type: CredentialType;
  scope:           string;
  username:        string | null;
  metadata:        Record<string, unknown>;
  tags:            string[];
  created_by:      string;
  created_at:      string;
  updated_at:      string;
  last_used_at:    string | null;
  expires_at:      string | null;
  is_active:       boolean;
  is_expired:      boolean;
}

export interface VaultCreate {
  name:            string;
  credential_type: CredentialType;
  scope:           string;
  username?:       string;
  secret_value:    string;
  metadata?:       Record<string, unknown>;
  tags?:           string[];
  expires_at?:     string;
}

export interface VaultAuditEntry {
  id:             number;
  vault_id:       string | null;
  action:         string;
  performed_by:   string;
  source_service: string | null;
  ip_address:     string | null;
  created_at:     string;
}

// ── API calls ────────────────────────────────────────────────────────────

export const api = {
  devices: {
    list: () => request<Device[]>("/devices"),
    get: (serial: string) => request<Device>(`/devices/${serial}`),
    delete: (serial: string) =>
      request<void>(`/devices/${serial}`, { method: "DELETE" }),
  },
  topology: {
    list: () => request<ConnectivityEntry[]>("/topology"),
  },
  alerts: {
    list: (limit = 200) => request<AuditLog[]>(`/alerts?limit=${limit}`),
  },
  dashboard: {
    stats: () => request<DashboardStats>("/dashboard/stats"),
  },
  enroller: {
    scan: (cidr: string) =>
      request<{ status: string }>("/enroller/check", {
        method: "POST",
        body: JSON.stringify({ cidr }),
      }),
  },
  discover: {
    scan: (req: DiscoverRequest) =>
      request<DiscoveredDevice[]>("/discover", {
        method: "POST",
        body: JSON.stringify(req),
      }),
    sites: () => request<string[]>("/sites"),
  },
  register: {
    device: (reg: DeviceRegistration) =>
      request<{ serial_number: string; status: string }>("/devices", {
        method: "POST",
        body: JSON.stringify(reg),
      }),
  },
  vault: {
    list: (params?: string) =>
      request<VaultEntry[]>(`/vault${params ? "?" + params : ""}`),
    get: (id: string) => request<VaultEntry>(`/vault/${id}`),
    create: (data: VaultCreate) =>
      request<VaultEntry>("/vault", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<VaultCreate>) =>
      request<VaultEntry>(`/vault/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/vault/${id}`, { method: "DELETE" }),
    rotate: (id: string, newSecret: string) =>
      request<VaultEntry>(`/vault/${id}/rotate`, {
        method: "POST",
        body: JSON.stringify({ new_secret_value: newSecret }),
      }),
    audit: (id: string) =>
      request<VaultAuditEntry[]>(`/vault/${id}/audit`),
  },
  alertContacts: {
    list: () => request<AlertContact[]>("/alert-contacts"),
    get: (id: string) => request<AlertContact>(`/alert-contacts/${id}`),
    create: (data: ContactCreatePayload) =>
      request<AlertContact>("/alert-contacts", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { display_name?: string; is_active?: boolean }) =>
      request<AlertContact>(`/alert-contacts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      request<void>(`/alert-contacts/${id}`, { method: "DELETE" }),
    addChannel: (contactId: string, data: ChannelCreatePayload) =>
      request<AlertContact>(`/alert-contacts/${contactId}/channels`, {
        method: "POST",
        body: JSON.stringify(data),
      }),
    updateChannel: (contactId: string, channelId: string, data: Record<string, unknown>) =>
      request<AlertContact>(`/alert-contacts/${contactId}/channels/${channelId}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    deleteChannel: (contactId: string, channelId: string) =>
      request<void>(`/alert-contacts/${contactId}/channels/${channelId}`, { method: "DELETE" }),
    test: (id: string) =>
      request<{ results: TestResult[] }>(`/alert-contacts/${id}/test`, { method: "POST" }),
  },
  emailConfig: {
    get: () => request<EmailConfig>("/email-config"),
    update: (data: Omit<EmailConfig, "is_configured" | "updated_at">) =>
      request<{ status: string }>("/email-config", {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    test: (recipient: string) =>
      request<{ status: string; recipient?: string; error?: string }>(
        `/email-config/test?recipient=${encodeURIComponent(recipient)}`,
        { method: "POST" }
      ),
  },
};

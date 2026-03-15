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
};

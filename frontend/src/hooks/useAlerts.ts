import useSWR from "swr";
import { api, AuditLog } from "../api/client";

export function useAlerts(limit = 200) {
  const { data, error, isLoading, mutate } = useSWR<AuditLog[]>(
    `alerts-${limit}`,
    () => api.alerts.list(limit),
    { refreshInterval: 15_000 }
  );
  return { alerts: data ?? [], error, isLoading, refresh: mutate };
}

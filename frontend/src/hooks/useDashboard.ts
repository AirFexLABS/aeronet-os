import useSWR from "swr";
import { api, DashboardStats } from "../api/client";

export function useDashboard() {
  const { data, error, isLoading, mutate } = useSWR<DashboardStats>(
    "dashboard-stats",
    api.dashboard.stats,
    { refreshInterval: 30_000 }
  );
  return { stats: data, error, isLoading, refresh: mutate };
}

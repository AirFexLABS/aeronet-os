import useSWR from "swr";
import { api, Device } from "../api/client";

export function useDevices() {
  const { data, error, isLoading, mutate } = useSWR<Device[]>(
    "devices",
    api.devices.list,
    { refreshInterval: 30_000 }
  );
  return { devices: data ?? [], error, isLoading, refresh: mutate };
}

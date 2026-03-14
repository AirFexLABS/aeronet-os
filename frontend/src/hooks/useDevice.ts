import useSWR from "swr";
import { api, Device } from "../api/client";

export function useDevice(serial: string) {
  const { data, error, isLoading, mutate } = useSWR<Device>(
    serial ? `device-${serial}` : null,
    () => api.devices.get(serial),
    { refreshInterval: 15_000 }
  );
  return { device: data, error, isLoading, refresh: mutate };
}

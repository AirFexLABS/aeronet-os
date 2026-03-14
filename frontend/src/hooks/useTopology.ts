import useSWR from "swr";
import { api, ConnectivityEntry } from "../api/client";

export function useTopology() {
  const { data, error, isLoading, mutate } = useSWR<ConnectivityEntry[]>(
    "topology",
    api.topology.list,
    { refreshInterval: 60_000 }
  );
  return { topology: data ?? [], error, isLoading, refresh: mutate };
}

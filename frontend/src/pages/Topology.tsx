import { useTopology } from "../hooks/useTopology";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import type { ConnectivityEntry } from "../api/client";

function groupBySwitchHostname(entries: ConnectivityEntry[]) {
  return entries.reduce<Record<string, ConnectivityEntry[]>>((acc, e) => {
    (acc[e.switch_hostname] ??= []).push(e);
    return acc;
  }, {});
}

export function Topology() {
  const { topology, isLoading } = useTopology();
  const grouped = groupBySwitchHostname(topology);

  if (isLoading)
    return <p className="text-secondary text-sm">Loading...</p>;
  if (topology.length === 0)
    return (
      <div>
        <PageHeader title="Network topology" subtitle="AP \u2192 Switch mapping" />
        <EmptyState message="No topology data yet. The collector populates this from MIST LLDP data." />
      </div>
    );

  return (
    <div>
      <PageHeader
        title="Network topology"
        subtitle={`${topology.length} APs mapped across ${Object.keys(grouped).length} switches`}
      />

      <div className="flex flex-col gap-6">
        {Object.entries(grouped).map(([switchHost, aps]) => (
          <div
            key={switchHost}
            className="bg-surface border border-white/10 rounded-xl overflow-hidden"
          >
            <div className="px-5 py-3 border-b border-white/10 flex items-center gap-3">
              <span className="text-xs text-secondary">Switch</span>
              <span className="font-medium text-primary text-sm">
                {switchHost}
              </span>
              <span className="ml-auto text-xs text-secondary">
                {aps.length} AP{aps.length !== 1 ? "s" : ""}
              </span>
            </div>

            <div className="divide-y divide-white/5">
              {aps
                .sort((a, b) => a.switch_port.localeCompare(b.switch_port))
                .map((ap) => (
                  <div
                    key={ap.ap_serial}
                    className="flex items-center gap-4 px-5 py-3 text-sm"
                  >
                    <span
                      className="w-28 shrink-0 font-mono text-xs
                                   text-secondary bg-black/20 px-2 py-0.5 rounded"
                    >
                      {ap.switch_port}
                    </span>
                    <span className="flex-1 text-primary">
                      {ap.ap_hostname || ap.ap_serial}
                    </span>
                    <span className="text-secondary text-xs font-mono">
                      {ap.ap_ip}
                    </span>
                    <span className="text-secondary text-xs">{ap.site_id}</span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

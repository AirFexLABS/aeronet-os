import { StatusBadge } from "../components/ui/StatusBadge";
import { useNavigate } from "react-router-dom";
import { useDevices } from "../hooks/useDevices";
import { DataTable } from "../components/ui/DataTable";

import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import type { Device } from "../api/client";

export function Devices() {
  const { devices, isLoading } = useDevices();
  const navigate = useNavigate();

  if (isLoading)
    return <p className="text-secondary text-sm">Loading...</p>;

  return (
    <div>
      <PageHeader
        title="Device inventory"
        subtitle={`${devices.length} devices`}
      />
      {devices.length === 0 ? (
        <EmptyState message="No devices discovered yet. Trigger a scan to populate inventory." />
      ) : (
        <DataTable<Device>
          rows={devices}
          rowKey={(d) => d.serial_number}
          onRowClick={(d) => navigate(`/devices/${d.serial_number}`)}
          filterKeys={["serial_number", "hostname", "ip_address", "site_id"]}
          columns={[
            { key: "serial_number", label: "Serial", sortable: true },
            { key: "hostname", label: "Hostname", sortable: true },
            { key: "ip_address", label: "IP", sortable: true },
            { key: "device_type", label: "Type", sortable: true },
            { key: "site_id", label: "Site", sortable: true },
            {
              key: "status",
              label: "Status",
              sortable: true,
              render: (d) => <StatusBadge status={d.status} />,
            },
            {
              key: "last_seen",
              label: "Last seen",
              render: (d) => (
                <span className="text-secondary text-xs">
                  {new Date(d.last_seen).toLocaleString()}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

import { useParams, useNavigate } from "react-router-dom";
import { useDevice } from "../hooks/useDevice";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";

export function DeviceDetail() {
  const { serial } = useParams<{ serial: string }>();
  const navigate = useNavigate();
  const { device, isLoading } = useDevice(serial ?? "");

  if (isLoading)
    return <p className="text-secondary text-sm">Loading...</p>;
  if (!device)
    return <p className="text-secondary text-sm">Device not found.</p>;

  const fields: [string, React.ReactNode][] = [
    [
      "Serial number",
      <code className="text-xs bg-black/30 px-2 py-0.5 rounded">
        {device.serial_number}
      </code>,
    ],
    ["Hostname", device.hostname],
    ["IP address", device.ip_address],
    ["Device type", device.device_type],
    ["Site", device.site_id],
    ["Status", <StatusBadge status={device.status} />],
    ["Last seen", new Date(device.last_seen).toLocaleString()],
  ];

  return (
    <div>
      <PageHeader
        title={device.hostname || device.serial_number}
        subtitle={device.ip_address}
        action={
          <button
            onClick={() => navigate(-1)}
            className="text-sm text-secondary hover:text-primary transition-colors"
          >
            &larr; Back
          </button>
        }
      />

      <div className="bg-surface border border-white/10 rounded-xl overflow-hidden">
        {fields.map(([label, value]) => (
          <div
            key={label}
            className="flex items-center gap-4 px-5 py-3.5
                        border-b border-white/5 last:border-0"
          >
            <span className="w-36 shrink-0 text-xs text-secondary uppercase tracking-wide">
              {label}
            </span>
            <span className="text-sm text-primary">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

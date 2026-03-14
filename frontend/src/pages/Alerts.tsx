import { useState } from "react";
import { useAlerts } from "../hooks/useAlerts";
import { DataTable } from "../components/ui/DataTable";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import { EmptyState } from "../components/ui/EmptyState";
import type { AuditLog } from "../api/client";

const SEVERITIES = ["ALL", "CRITICAL", "ERROR", "WARNING", "INFO"] as const;

export function Alerts() {
  const { alerts, isLoading } = useAlerts(500);
  const [filter, setFilter] = useState<string>("ALL");

  const visible =
    filter === "ALL" ? alerts : alerts.filter((a) => a.severity === filter);

  return (
    <div>
      <PageHeader
        title="Alerts & audit log"
        subtitle={`${visible.length} events`}
        action={
          <div className="flex gap-1">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`px-3 py-1 text-xs rounded-lg border transition-colors
                  ${
                    filter === s
                      ? "bg-primary/20 border-primary/50 text-primary"
                      : "border-white/10 text-secondary hover:text-primary hover:border-white/20"
                  }`}
              >
                {s}
              </button>
            ))}
          </div>
        }
      />

      {isLoading && <p className="text-secondary text-sm">Loading...</p>}
      {!isLoading && visible.length === 0 && (
        <EmptyState message="No alerts match this filter." />
      )}
      {!isLoading && visible.length > 0 && (
        <DataTable<AuditLog>
          rows={visible}
          rowKey={(a) => String(a.id)}
          filterKeys={[
            "device_serial",
            "message",
            "source_service",
            "event_type",
          ]}
          columns={[
            {
              key: "severity",
              label: "Severity",
              sortable: true,
              render: (a) => <StatusBadge status={a.severity} />,
            },
            { key: "event_type", label: "Event", sortable: true },
            { key: "device_serial", label: "Device", sortable: true },
            { key: "source_service", label: "Service", sortable: true },
            {
              key: "message",
              label: "Message",
              render: (a) => (
                <span className="text-secondary text-xs truncate max-w-xs block">
                  {a.message}
                </span>
              ),
            },
            {
              key: "created_at",
              label: "Time",
              sortable: true,
              render: (a) => (
                <span className="text-secondary text-xs whitespace-nowrap">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}

import { useDashboard } from "../hooks/useDashboard";
import { useAlerts } from "../hooks/useAlerts";
import { StatCard } from "../components/ui/StatCard";
import { StatusBadge } from "../components/ui/StatusBadge";
import { PageHeader } from "../components/layout/PageHeader";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export function Dashboard() {
  const { stats, isLoading } = useDashboard();
  const { alerts } = useAlerts(50);

  const chartData = alerts
    .slice()
    .reverse()
    .reduce<Record<string, { time: string; count: number }>>((acc, a) => {
      const hour = a.created_at.slice(0, 13);
      acc[hour] = { time: hour, count: (acc[hour]?.count ?? 0) + 1 };
      return acc;
    }, {});

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Live network health overview" />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Active devices"
          value={isLoading ? "\u2014" : (stats?.total_devices ?? 0)}
          sublabel="last 30 min"
        />
        <StatCard
          label="Offline"
          value={isLoading ? "\u2014" : (stats?.offline_devices ?? 0)}
          alert={(stats?.offline_devices ?? 0) > 0}
        />
        <StatCard
          label="Asset moved (24h)"
          value={isLoading ? "\u2014" : (stats?.asset_moved_24h ?? 0)}
          alert={(stats?.asset_moved_24h ?? 0) > 0}
        />
        <StatCard
          label="Auth failures (24h)"
          value={isLoading ? "\u2014" : (stats?.auth_failures_24h ?? 0)}
          alert={(stats?.auth_failures_24h ?? 0) > 0}
        />
      </div>

      <div className="bg-surface border border-white/10 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-medium text-secondary mb-4 uppercase tracking-wider">
          Alert volume (last 50 events)
        </h2>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={Object.values(chartData)}>
            <defs>
              <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#378ADD" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#378ADD" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
            />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "#9CA3AF" }}
            />
            <YAxis tick={{ fontSize: 11, fill: "#9CA3AF" }} />
            <Tooltip
              contentStyle={{
                background: "#111827",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#378ADD"
              fill="url(#alertGrad)"
              strokeWidth={1.5}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-surface border border-white/10 rounded-xl p-5">
        <h2 className="text-sm font-medium text-secondary mb-4 uppercase tracking-wider">
          Recent alerts
        </h2>
        <div className="flex flex-col gap-2">
          {alerts.slice(0, 8).map((a) => (
            <div
              key={a.id}
              className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0"
            >
              <StatusBadge status={a.severity} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-primary truncate">{a.message}</p>
                <p className="text-xs text-secondary">
                  {a.device_serial} &middot; {a.source_service} &middot;{" "}
                  {new Date(a.created_at).toLocaleTimeString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

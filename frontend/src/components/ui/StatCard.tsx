interface StatCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  alert?: boolean;
}

export function StatCard({ label, value, sublabel, alert }: StatCardProps) {
  return (
    <div
      className={`
      rounded-xl p-5 border flex flex-col gap-1
      bg-surface border-white/10
      ${alert ? "border-alert-critical/40" : ""}
    `}
    >
      <span className="text-xs text-secondary uppercase tracking-widest">
        {label}
      </span>
      <span
        className={`text-3xl font-semibold tabular-nums
        ${alert ? "text-alert-critical" : "text-primary"}
      `}
      >
        {value}
      </span>
      {sublabel && <span className="text-xs text-secondary">{sublabel}</span>}
    </div>
  );
}

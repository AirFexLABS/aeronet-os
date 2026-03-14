import clsx from "clsx";

type Status =
  | "active"
  | "offline"
  | "unknown"
  | "CRITICAL"
  | "ERROR"
  | "WARNING"
  | "INFO";

const styles: Record<Status, string> = {
  active: "bg-green-900/40  text-green-300  border border-green-700/50",
  offline: "bg-red-900/40    text-red-300    border border-red-700/50",
  unknown: "bg-gray-800/60   text-gray-400   border border-gray-700/50",
  CRITICAL: "bg-red-900/40    text-red-300    border border-red-700/50",
  ERROR: "bg-orange-900/40 text-orange-300 border border-orange-700/50",
  WARNING: "bg-yellow-900/40 text-yellow-300 border border-yellow-700/50",
  INFO: "bg-blue-900/40   text-blue-300   border border-blue-700/50",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        styles[status] ?? styles.unknown
      )}
    >
      {status}
    </span>
  );
}

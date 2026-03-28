import { NavLink } from "react-router-dom";
import clsx from "clsx";
import { useTheme } from "../../hooks/useTheme";
import { useAuth } from "../../context/AuthContext";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  minRole?: "engineer";
  adminOnly?: boolean;
}

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: "\u25a6" },
  { to: "/devices", label: "Devices", icon: "\u25c8" },
  { to: "/topology", label: "Topology", icon: "\u2b21" },
  { to: "/alerts", label: "Alerts", icon: "\u25ce" },
  { to: "/discovery", label: "Discovery", icon: "\u2295" },
  { to: "/vlans", label: "VLAN Segments", icon: "\u2630", minRole: "engineer" },
  { to: "/vault", label: "Vault", icon: "\u{1F510}" },
  { to: "/vendor-explorer", label: "Vendor API", icon: "\u2699", adminOnly: true },
  { to: "/alerts-setup", label: "Alerts Setup", icon: "\u{1F514}", adminOnly: true },
];

function roleLabel(role: string): string {
  switch (role) {
    case "admin":
      return "Admin";
    case "engineer":
      return "Engineer";
    case "operator":
      return "Operator";
    default:
      return "Viewer";
  }
}

export function Sidebar() {
  const { brand } = useTheme();
  const { user, logout } = useAuth();

  return (
    <aside
      className="
      w-56 shrink-0 h-screen sticky top-0
      bg-surface border-r border-white/10
      flex flex-col
    "
    >
      <div className="px-5 py-5 border-b border-white/10">
        <span className="text-sm font-semibold text-primary tracking-wide">
          {brand?.name ?? "AeroNet OS"}
        </span>
      </div>
      <nav className="flex-1 py-4 flex flex-col gap-1 px-3">
        {NAV.filter((item) => {
          if (item.adminOnly) return user?.role === "admin";
          if (item.minRole === "engineer")
            return user?.role === "admin" || user?.role === "engineer";
          return true;
        }).map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              clsx(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-secondary hover:text-primary hover:bg-white/5"
              )
            }
          >
            <span className="text-base w-5 text-center">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-4 border-t border-white/10 flex flex-col gap-3">
        {user && (
          <div className="px-1">
            <p className="text-xs text-secondary truncate">{user.sub}</p>
            <p className="text-xs text-secondary/60">
              {roleLabel(user.role)}
            </p>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full text-left px-3 py-2 rounded-lg text-xs text-secondary
                     hover:text-alert-critical hover:bg-alert-critical/10
                     transition-colors"
        >
          Sign out
        </button>
        <span className="text-xs text-secondary/40 px-1">v0.1.0</span>
      </div>
    </aside>
  );
}

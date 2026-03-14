import { useState, FormEvent } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../hooks/useTheme";

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { brand } = useTheme();
  const from =
    (location.state as { from?: Location })?.from?.pathname ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const base = import.meta.env.VITE_API_URL ?? "/api";
      const body = new URLSearchParams({ username, password });
      const res = await fetch(`${base}/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });

      if (!res.ok) {
        setError("Invalid username or password.");
        return;
      }

      const { access_token, refresh_token } = await res.json();
      login(access_token, refresh_token ?? "");
      navigate(from, { replace: true });
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-2xl font-semibold text-primary tracking-tight">
            {brand?.name ?? "AeroNet OS"}
          </p>
          <p className="text-sm text-secondary mt-1">
            Sign in to your account
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-white/10 rounded-2xl p-8 flex flex-col gap-5"
        >
          {error && (
            <div
              className="text-xs text-alert-critical bg-alert-critical/10
                          border border-alert-critical/20 rounded-lg px-3 py-2"
            >
              {error}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-secondary uppercase tracking-wider">
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-background border border-white/10
                         text-sm text-primary placeholder:text-secondary
                         focus:outline-none focus:border-primary/60 transition-colors"
              placeholder="username"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-secondary uppercase tracking-wider">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="px-3 py-2.5 rounded-lg bg-background border border-white/10
                         text-sm text-primary placeholder:text-secondary
                         focus:outline-none focus:border-primary/60 transition-colors"
              placeholder="\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 py-2.5 rounded-lg text-sm font-medium
                       bg-primary/90 hover:bg-primary text-white
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-colors"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="text-center text-xs text-secondary mt-6">
          AeroNet OS &middot; ISO 27001 / NIST CSF 2.0
        </p>
      </div>
    </div>
  );
}

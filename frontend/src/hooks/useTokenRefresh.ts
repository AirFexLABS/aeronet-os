/**
 * Silently refreshes the access token 2 minutes before expiry.
 * Uses the refresh token stored in localStorage.
 * Called once from App.tsx when the user is authenticated.
 */
import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";

export function useTokenRefresh() {
  const { token, login, logout } = useAuth();

  useEffect(() => {
    if (!token) return;

    const payload = JSON.parse(atob(token.split(".")[1]));
    const expiresIn = payload.exp * 1000 - Date.now();
    const refreshIn = expiresIn - 2 * 60 * 1000; // 2 min before expiry

    if (refreshIn <= 0) {
      logout();
      return;
    }

    const timer = setTimeout(async () => {
      const refreshToken = localStorage.getItem("aeronet_refresh");
      if (!refreshToken) {
        logout();
        return;
      }

      try {
        const base = import.meta.env.VITE_API_URL ?? "/api";
        const res = await fetch(`${base}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(refreshToken),
        });
        if (!res.ok) {
          logout();
          return;
        }
        const { access_token, refresh_token } = await res.json();
        login(access_token, refresh_token);
      } catch {
        logout();
      }
    }, refreshIn);

    return () => clearTimeout(timer);
  }, [token, login, logout]);
}

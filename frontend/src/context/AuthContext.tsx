/**
 * AuthContext: manages JWT token lifecycle.
 * Token stored in localStorage under "aeronet_token".
 * Provides: user (decoded payload), login(), logout(), isAuthenticated.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";

interface TokenPayload {
  sub: string;
  role: string;
  site_id: string | null;
  exp: number;
}

interface AuthContextValue {
  user: TokenPayload | null;
  isAuthenticated: boolean;
  login: (token: string, refreshToken: string) => void;
  logout: () => void;
  token: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodePayload(token: string): TokenPayload | null {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64)) as TokenPayload;
  } catch {
    return null;
  }
}

function isExpired(payload: TokenPayload): boolean {
  return Date.now() / 1000 > payload.exp;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("aeronet_token")
  );

  const user = token ? decodePayload(token) : null;
  const isAuthenticated = !!user && !isExpired(user);

  // Clear expired token on mount
  useEffect(() => {
    if (token && user && isExpired(user)) {
      localStorage.removeItem("aeronet_token");
      localStorage.removeItem("aeronet_refresh");
      setToken(null);
    }
  }, []);

  const login = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem("aeronet_token", accessToken);
    localStorage.setItem("aeronet_refresh", refreshToken);
    setToken(accessToken);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("aeronet_token");
    localStorage.removeItem("aeronet_refresh");
    setToken(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated, login, logout, token }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

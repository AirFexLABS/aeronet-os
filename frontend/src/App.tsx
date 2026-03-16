import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute } from "./components/layout/ProtectedRoute";
import { AppShell } from "./components/layout/AppShell";
import { Login } from "./pages/Login";
import { Dashboard } from "./pages/Dashboard";
import { Devices } from "./pages/Devices";
import { DeviceDetail } from "./pages/DeviceDetail";
import { Topology } from "./pages/Topology";
import { Alerts } from "./pages/Alerts";
import { Discovery } from "./pages/Discovery";
import { useTheme } from "./hooks/useTheme";
import { useTokenRefresh } from "./hooks/useTokenRefresh";

function AppInner() {
  useTheme();
  useTokenRefresh();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="devices" element={<Devices />} />
        <Route path="devices/:serial" element={<DeviceDetail />} />
        <Route path="topology" element={<Topology />} />
        <Route path="alerts" element={<Alerts />} />
        <Route path="discovery" element={<Discovery />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  );
}

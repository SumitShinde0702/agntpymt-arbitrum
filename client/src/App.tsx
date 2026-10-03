import { Navigate, Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { LandingPage } from "./pages/LandingPage";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { AgentDetailPage } from "./pages/AgentDetailPage";
import { SellersPage } from "./pages/SellersPage";
import { SellerDetailPage } from "./pages/SellerDetailPage";
import { WalletsPage } from "./pages/WalletsPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { LogsPage } from "./pages/LogsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PoliciesPage } from "./pages/PoliciesPage";
import { showSellerAdmin } from "./lib/features";

const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/home" element={<Navigate to="/" replace />} />
      {clerkEnabled && (
        <>
          <Route path="/sign-in/*" element={<SignInPage />} />
          <Route path="/sign-up/*" element={<SignUpPage />} />
        </>
      )}
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="agents/:agentId" element={<AgentDetailPage />} />
          {showSellerAdmin && (
            <>
              <Route path="sellers" element={<SellersPage />} />
              <Route path="sellers/:vendorId" element={<SellerDetailPage />} />
            </>
          )}
          <Route path="wallets" element={<WalletsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="policies" element={<PoliciesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

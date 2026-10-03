import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Bot,
  Store,
  Wallet,
  CreditCard,
  Clock,
  Shield,
  Settings,
  FileText,
  Sun,
  ChevronDown,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type HealthData, type DashboardData } from "../../lib/api";
import { AuthControls } from "../auth/AuthControls";
import { ApprovalToast } from "./ApprovalToast";
import { Logo } from "../brand/Logo";
import { showSellerAdmin } from "../../lib/features";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/agents", label: "Agents", icon: Bot },
  ...(showSellerAdmin ? [{ to: "/sellers", label: "Sellers", icon: Store }] : []),
  { to: "/wallets", label: "Wallets", icon: Wallet },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/approvals", label: "Approvals", icon: Clock, badge: true },
  { to: "/policies", label: "Policies", icon: Shield },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function AppLayout() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [approvalCount, setApprovalCount] = useState(0);
  const [activeWallets, setActiveWallets] = useState(4);
  const [hermesProfiles, setHermesProfiles] = useState<{ provisioned: number; total: number } | null>(
    null
  );
  const [showStatusDetail, setShowStatusDetail] = useState(false);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      void api<HealthData>("/api/health").then(setHealth);
      void api<DashboardData>("/api/dashboard").then((d) => {
        setApprovalCount(Array.isArray(d.pendingApprovals) ? d.pendingApprovals.length : 0);
        setActiveWallets(d.activeWallets ?? 4);
        setHermesProfiles({
          provisioned: d.kpis.hermesProfilesProvisioned ?? 0,
          total: d.agents.length,
        });
      });
    };
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (statusRef.current && !statusRef.current.contains(e.target as Node)) {
        setShowStatusDetail(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const systemHealthy = health?.daemon === "running";

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center border-b border-slate-200 px-5 py-5">
          <Logo markClassName="h-8 w-8" />
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {nav.map(({ to, label, icon: Icon, badge }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? "nav-active" : "text-slate-600 hover:bg-slate-50"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{label}</span>
              {badge && approvalCount > 0 && (
                <span className="rounded-full bg-accent-cyan px-2 py-0.5 text-xs text-white">{approvalCount}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-slate-500">Network</span>
              <span className="flex items-center gap-1.5 font-medium text-slate-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                {health?.network ?? "Arbitrum Sepolia"}
              </span>
            </div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-slate-500">Active Wallets</span>
              <span className="font-medium">{activeWallets}</span>
            </div>
            <NavLink
              to="/logs"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <FileText className="h-4 w-4" />
              View Logs
            </NavLink>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <div ref={statusRef} className="relative">
              <button
                type="button"
                onClick={() => setShowStatusDetail((v) => !v)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition ${
                  systemHealthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${systemHealthy ? "bg-emerald-500" : "bg-amber-500"}`} />
                {systemHealthy ? "Systems operational" : "Attention needed"}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>

              {showStatusDetail && (
                <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500">Daemon</span>
                    <span className="font-medium text-slate-800">
                      {health?.daemon === "running"
                        ? "Running"
                        : health?.daemon === "auth_error"
                          ? "Auth error"
                          : "Degraded"}
                    </span>
                  </div>
                  {hermesProfiles && (
                    <div className="flex items-center justify-between py-1">
                      <span className="text-slate-500">Hermes profiles</span>
                      <span className="font-medium text-slate-800">
                        {hermesProfiles.provisioned}/{hermesProfiles.total}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-slate-500">Payment mode</span>
                    <span className="font-medium text-slate-800">
                      {health?.simulatePayments ? "Simulated" : `x402 · ${health?.network ?? ""}`}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {health?.simulatePayments && (
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                Simulated Commerce
              </span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button type="button" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
              <Sun className="h-5 w-5" />
            </button>
            <AuthControls variant="light" />
          </div>
        </header>

        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>

        <footer className="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3 text-xs text-slate-500">
          <span>v0.1.0</span>
          <span>© 2026 AgntPymt</span>
        </footer>
      </div>
      <ApprovalToast />
    </div>
  );
}

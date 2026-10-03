import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Bot, CheckCircle, Clock, Copy, ExternalLink } from "lucide-react";
import { CapabilitiesPanel } from "../components/agents/CapabilitiesPanel";
import { Erc8004Panel } from "../components/agents/Erc8004Panel";
import { NegotiationRulesEditor } from "../components/agents/NegotiationRulesEditor";
import { SoulEditor } from "../components/agents/SoulEditor";
import { PageSkeleton, Spinner } from "../components/ui/Skeleton";
import {
  api,
  type AgentPolicy,
  type AgentWalletRow,
  type HermesProfileStatus,
  type Transaction,
  type WalletsOverview,
} from "../lib/api";
import { addressExplorerUrl, txExplorerUrl } from "../lib/explorer";

const colorMap: Record<string, string> = {
  violet: "bg-slate-100 text-accent-navy",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-emerald-100 text-emerald-700",
  orange: "bg-orange-100 text-orange-700",
};

type Tab = "overview" | "identity" | "capabilities";

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

function timeAgo(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function AgentTransactions({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <p className="text-sm text-slate-400">No transactions yet</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
      {transactions.map((t) => {
        const completed = t.status === "completed" || t.status === "simulated";
        return (
          <li key={t.id} className="flex items-start gap-3 px-4 py-3">
            {completed ? (
              <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : (
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-900">{t.vendorName}</div>
              <div className="text-xs text-slate-500">{t.description}</div>
              <div className="mt-0.5 text-xs text-slate-400">{timeAgo(t.createdAt)}</div>
              {t.txHash && (
                <a
                  href={txExplorerUrl(t.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 font-mono text-xs text-accent-cyan hover:underline"
                >
                  {t.txHash.slice(0, 14)}…
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-sm font-semibold text-slate-900">−{t.amountUsd.toFixed(2)} USDC</div>
              <span
                className={`text-xs font-medium capitalize ${
                  completed ? "text-emerald-600" : "text-amber-600"
                }`}
              >
                {t.status === "simulated" ? "simulated" : t.status}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const [tab, setTab] = useState<Tab>("overview");
  const [agent, setAgent] = useState<AgentWalletRow | null>(null);
  const [network, setNetwork] = useState("Arbitrum Sepolia");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [policy, setPolicy] = useState<AgentPolicy | undefined>();
  const [hermes, setHermes] = useState<HermesProfileStatus | null>(null);
  const [hermesLoading, setHermesLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!agentId) return;
    setLoading(true);
    setLoadError(null);
    void Promise.all([
      api<WalletsOverview>("/api/wallets"),
      api<Transaction[]>("/api/transactions"),
      api<AgentPolicy[]>("/api/policies"),
    ])
      .then(([wallets, tx, policies]) => {
        const found = wallets.agents.find((a) => a.id === agentId) ?? null;
        setAgent(found);
        setNetwork(wallets.network);
        setTransactions(tx.filter((t) => t.agentId === agentId));
        setPolicy(policies.find((p) => p.agentId === agentId));
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load agent");
      })
      .finally(() => setLoading(false));
  }, [agentId]);

  const loadHermes = useCallback(() => {
    if (!agentId) return;
    setHermesLoading(true);
    void api<HermesProfileStatus>(`/api/agents/${agentId}/hermes`)
      .then(setHermes)
      .finally(() => setHermesLoading(false));
  }, [agentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (tab === "identity" || tab === "capabilities") {
      loadHermes();
    }
  }, [tab, loadHermes]);

  const tabs: { id: Tab; label: string; description: string }[] = useMemo(
    () => [
      { id: "overview", label: "Overview", description: "Wallet, policy & payments" },
      { id: "identity", label: "Identity", description: "ERC-8004 passport & SOUL" },
      { id: "capabilities", label: "Capabilities", description: "Skills & MCP tools" },
    ],
    []
  );

  if (loading) {
    return <PageSkeleton cards={2} />;
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <Link to="/agents" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-accent-cyan">
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </Link>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">API server unreachable</p>
          <p className="mt-1 text-amber-800">
            Start the backend with <code className="rounded bg-amber-100 px-1">npm run dev</code> in the
            project root, then refresh.
          </p>
          <button type="button" onClick={load} className="btn-primary-sm mt-3">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!agent || !agentId) {
    return (
      <div className="space-y-4">
        <Link to="/agents" className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-accent-cyan">
          <ArrowLeft className="h-4 w-4" />
          Back to agents
        </Link>
        <p className="text-slate-500">Agent not found.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link
        to="/agents"
        className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-accent-cyan"
      >
        <ArrowLeft className="h-4 w-4" />
        All agents
      </Link>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${colorMap[agent.iconColor] ?? colorMap.violet}`}
            >
              <Bot className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{agent.name}</h1>
              <p className="capitalize text-slate-500">{agent.category}</p>
              {hermes?.profileName && (
                <p className="mt-1 font-mono text-xs text-slate-400">{hermes.profileName}</p>
              )}
            </div>
          </div>
          <div className="flex gap-3">
            <div className="rounded-xl bg-slate-50 px-4 py-2 text-center">
              <div className="text-xs text-slate-500">USDC</div>
              <div className="text-xl font-bold">{agent.onChain.usdc.toFixed(2)}</div>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-2 text-center">
              <div className="text-xs text-slate-500">ETH</div>
              <div className="text-xl font-bold">{agent.onChain.eth.toFixed(4)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-xl border px-4 py-3 text-left transition ${
              tab === t.id
                ? "border-accent-cyan/30 bg-white shadow-sm ring-1 ring-accent-cyan/20"
                : "border-transparent bg-slate-100/80 hover:bg-slate-100"
            }`}
          >
            <div className={`text-sm font-semibold ${tab === t.id ? "text-accent-navy" : "text-slate-700"}`}>
              {t.label}
            </div>
            <div className="text-xs text-slate-500">{t.description}</div>
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Operational wallet</h2>
            <p className="mt-1 text-sm text-slate-600">Agent spending wallet on {network}.</p>
            {agent.walletAddress ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                <span className="min-w-0 flex-1 break-all font-mono text-sm text-slate-700">
                  {agent.walletAddress}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(agent.walletAddress!)}
                  className="shrink-0 text-slate-400 hover:text-accent-cyan"
                  title="Copy"
                >
                  <Copy className="h-4 w-4" />
                </button>
                <a
                  href={addressExplorerUrl(agent.walletAddress)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-slate-400 hover:text-accent-cyan"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            ) : (
              <p className="mt-3 text-sm text-accent-cyan">Wallet provisioning…</p>
            )}
          </section>

          {policy && (
            <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <NegotiationRulesEditor agentId={agentId} policy={policy} onSaved={load} />
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Transactions ({transactions.length})
            </h2>
            <AgentTransactions transactions={transactions} />
          </section>
        </div>
      )}

      {tab === "identity" && (
        <div className="space-y-6">
          <Erc8004Panel
            apiBase={`/api/agents/${agentId}/erc8004`}
            operationalWallet={agent.walletAddress}
            variant="buyer"
          />
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">SOUL.md</h2>
            <div className="mt-4">
              {hermesLoading && !hermes ? (
                <Spinner label="Loading profile…" />
              ) : hermes ? (
                <SoulEditor
                  agentId={agentId!}
                  agentName={agent?.name}
                  category={agent?.category}
                  initialSoul={hermes.soul}
                  onSaved={loadHermes}
                />
              ) : (
                <p className="text-sm text-slate-500">Could not load Hermes profile</p>
              )}
            </div>
          </section>
        </div>
      )}

      {tab === "capabilities" && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {hermesLoading && !hermes ? (
            <Spinner label="Loading capabilities…" />
          ) : hermes ? (
            <CapabilitiesPanel
              agentId={agentId}
              capabilities={hermes.capabilities}
              onChanged={loadHermes}
            />
          ) : (
            <p className="text-sm text-slate-500">Could not load capabilities</p>
          )}
        </section>
      )}
    </div>
  );
}

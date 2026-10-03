import { useEffect, useState } from "react";
import { Download, ExternalLink, RefreshCw } from "lucide-react";
import { api, downloadPaymentsCsv, type Transaction } from "../lib/api";
import { txExplorerUrl } from "../lib/explorer";
import { Skeleton } from "../components/ui/Skeleton";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return (
    <a
      href={txExplorerUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-accent-cyan hover:underline"
      title={hash}
    >
      {label}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function statusClass(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700";
  if (status === "simulated") return "bg-slate-100 text-slate-600";
  return "bg-amber-50 text-amber-800";
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    void api<Transaction[]>("/api/transactions")
      .then(setPayments)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load payments");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const total = payments.reduce((sum, p) => sum + p.amountUsd, 0);

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      await downloadPaymentsCsv();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payments</h1>
          <p className="mt-1 text-slate-500">
            All agent settlements — x402 USDC on Arbitrum Sepolia with on-chain seller ratings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="btn-primary-sm"
            disabled={exporting || payments.length === 0}
          >
            <Download className="h-4 w-4" />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payments</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{payments.length}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total volume</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">{total.toFixed(2)} USDC</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Rated on-chain</div>
          <div className="mt-1 text-2xl font-bold text-slate-900">
            {payments.filter((p) => p.feedbackTxHash).length}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {loading ? (
          <div className="divide-y divide-slate-100 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 py-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="ml-auto h-5 w-20 rounded-full" />
              </div>
            ))}
          </div>
        ) : payments.length === 0 ? (
          <div className="p-8 text-center text-slate-500">
            No payments yet. Run a purchase from the Agent Console to see settlements here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Agent</th>
                  <th className="px-4 py-3">Seller</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Payment tx</th>
                  <th className="px-4 py-3">Rating tx</th>
                  <th className="px-4 py-3">Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatWhen(p.createdAt)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{p.agentName}</td>
                    <td className="px-4 py-3 text-slate-700">{p.vendorName}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-900">
                      − {p.amountUsd.toFixed(2)} USDC
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusClass(p.status)}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.txHash ? (
                        <TxLink hash={p.txHash} label={`${p.txHash.slice(0, 10)}…`} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.feedbackTxHash ? (
                        <TxLink hash={p.feedbackTxHash} label={`${p.feedbackTxHash.slice(0, 10)}…`} />
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.runId ? (
                        <a href={`/logs`} className="font-mono text-xs text-accent-cyan hover:underline">
                          {p.runId.slice(0, 8)}…
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Export CSV opens in Excel for audit. Columns include payment and ERC-8004 rating transaction hashes.
      </p>
    </div>
  );
}

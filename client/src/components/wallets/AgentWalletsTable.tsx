import { Copy, Bot } from "lucide-react";
import type { AgentWalletRow } from "../../lib/api";
import { AgentWalletFund } from "./AgentWalletFund";

const colorMap: Record<string, string> = {
  violet: "bg-slate-100 text-accent-navy",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-emerald-100 text-emerald-700",
  orange: "bg-orange-100 text-orange-700",
};

function copyText(text: string) {
  void navigator.clipboard.writeText(text);
}

type Props = {
  agents: AgentWalletRow[];
  treasuryAddress?: string | null;
  onFunded?: () => void;
};

export function AgentWalletsTable({ agents, treasuryAddress, onFunded }: Props) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-5 py-4">
        <h2 className="text-lg font-semibold">Agent operational wallets</h2>
        <p className="text-sm text-slate-500">
          Auto-created when each agent is provisioned. Fund from your treasury wallet.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Agent</th>
              <th className="px-5 py-3 font-medium">Wallet address</th>
              <th className="px-5 py-3 font-medium">ETH</th>
              <th className="px-5 py-3 font-medium">USDC</th>
              <th className="px-5 py-3 font-medium">Fund from treasury</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${colorMap[a.iconColor] ?? colorMap.violet}`}
                    >
                      <Bot className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{a.name}</div>
                      <div className="text-xs capitalize text-slate-500">{a.category}</div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-4">
                  {a.walletAddress ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-slate-700">
                        {a.walletAddress.slice(0, 8)}…{a.walletAddress.slice(-6)}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyText(a.walletAddress!)}
                        className="text-slate-400 hover:text-accent-cyan"
                        title="Copy address"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-amber-600">Provisioning…</span>
                  )}
                </td>
                <td className="px-5 py-4 font-medium">
                  {a.onChain.eth.toFixed(4)}
                  {a.onChain.eth < 0.00005 && a.walletAddress && (
                    <div className="text-xs text-amber-600">Use ETH gas button →</div>
                  )}
                </td>
                <td className="px-5 py-4 font-medium">{a.onChain.usdc.toFixed(2)}</td>
                <td className="px-5 py-4">
                  {a.walletAddress && treasuryAddress ? (
                    <AgentWalletFund
                      agentId={a.id}
                      walletAddress={a.walletAddress}
                      treasuryAddress={treasuryAddress}
                      onFunded={onFunded ?? (() => {})}
                    />
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {treasuryAddress && (
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          <strong>USDC</strong> — payment balance. <strong>ETH gas</strong> — sends free Arbitrum Sepolia
          ETH from treasury (default 0.001) so the agent can sign payments. Fund treasury from the
          Arbitrum Sepolia faucet below (no mainnet ETH).
        </div>
      )}
    </div>
  );
}

import { useAccount, useBalance, useChainId, useSwitchChain, useReadContract } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { AlertTriangle, Crown } from "lucide-react";
import { formatUnits } from "viem";
import { api, type WalletsOverview } from "../../lib/api";
import { erc20Abi } from "../../lib/erc20";
import { TARGET_CHAIN, USDC_ADDRESS } from "../../lib/wagmi";

type Props = {
  treasury: WalletsOverview["treasury"];
  onUpdate: () => void;
};

export function TreasuryCard({ treasury, onUpdate }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;
  const isLinked = treasury?.address && address?.toLowerCase() === treasury.address.toLowerCase();

  const displayAddress = treasury?.address ?? address;
  const { data: ethBalance } = useBalance({
    address: displayAddress as `0x${string}` | undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!displayAddress },
  });
  const { data: usdcRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: displayAddress ? [displayAddress as `0x${string}`] : undefined,
    chainId: TARGET_CHAIN.id,
    query: { enabled: !!displayAddress },
  });

  async function linkTreasury() {
    if (!address) return;
    await api<WalletsOverview>("/api/treasury", {
      method: "PATCH",
      body: JSON.stringify({ address }),
    });
    onUpdate();
  }

  async function unlinkTreasury() {
    await api<WalletsOverview>("/api/treasury", {
      method: "PATCH",
      body: JSON.stringify({ address: null }),
    });
    onUpdate();
  }

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Crown className="h-5 w-5 text-accent-cyan" />
        <h2 className="text-lg font-semibold text-slate-900">Treasury Wallet</h2>
      </div>
      <p className="mb-4 text-sm text-slate-600">
        Connect your company MetaMask once. Use it to fund agent operational wallets on Arbitrum Sepolia.
      </p>

      {treasury?.address && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Linked treasury</div>
          <div className="mt-1 break-all font-mono text-sm text-slate-800">{treasury.address}</div>
          <div className="mt-3 flex gap-6 text-sm">
            <span>
              <span className="text-slate-500">ETH </span>
              <span className="font-semibold">
                {ethBalance ? Number(ethBalance.formatted).toFixed(4) : (treasury.balances?.eth.toFixed(4) ?? "…")}
              </span>
            </span>
            <span>
              <span className="text-slate-500">USDC </span>
              <span className="font-semibold">
                {usdcRaw !== undefined
                  ? Number(formatUnits(usdcRaw, 6)).toFixed(2)
                  : (treasury.balances?.usdc.toFixed(2) ?? "…")}
              </span>
            </span>
          </div>
        </div>
      )}

      {wrongNetwork && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Switch to Arbitrum Sepolia</p>
            <button
              type="button"
              disabled={switching}
              onClick={() => switchChain({ chainId: TARGET_CHAIN.id })}
              className="mt-2 rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white"
            >
              Switch network
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ConnectButton />
        {isConnected && !wrongNetwork && !isLinked && (
          <button
            type="button"
            onClick={() => void linkTreasury()}
            className="btn-primary"
          >
            Set as treasury
          </button>
        )}
        {isLinked && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            Treasury connected
          </span>
        )}
        {treasury?.address && (
          <button type="button" onClick={() => void unlinkTreasury()} className="text-sm text-slate-500 hover:text-red-600">
            Unlink
          </button>
        )}
      </div>
    </div>
  );
}

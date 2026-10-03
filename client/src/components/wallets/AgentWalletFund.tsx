import { useEffect, useState } from "react";
import {
  useAccount,
  useChainId,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { parseEther, parseUnits } from "viem";
import { api } from "../../lib/api";
import { erc20Abi } from "../../lib/erc20";
import { TARGET_CHAIN, USDC_ADDRESS } from "../../lib/wagmi";

type Props = {
  agentId: string;
  walletAddress: string;
  treasuryAddress: string;
  onFunded: () => void;
};

const DEFAULT_ETH = "0.001";

function walletErrorText(err: Error): string {
  const e = err as Error & { shortMessage?: string; details?: string };
  const text = [e.shortMessage ?? e.message, e.details].filter(Boolean).join(" — ");
  return text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function TxLink({ hash }: { hash: `0x${string}` }) {
  return (
    <a
      href={`${TARGET_CHAIN.blockExplorers?.default.url}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-emerald-600 hover:underline"
    >
      Confirmed on-chain
    </a>
  );
}

export function AgentWalletFund({ agentId, walletAddress, treasuryAddress, onFunded }: Props) {
  const [usdcAmount, setUsdcAmount] = useState("");
  const [ethAmount, setEthAmount] = useState(DEFAULT_ETH);
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const isTreasury = isConnected && address?.toLowerCase() === treasuryAddress.toLowerCase();
  const wrongNetwork = isConnected && chainId !== TARGET_CHAIN.id;

  const {
    writeContract,
    data: usdcHash,
    isPending: usdcPending,
    error: usdcError,
    reset: resetUsdc,
  } = useWriteContract();
  const { isLoading: usdcConfirming, isSuccess: usdcSuccess } = useWaitForTransactionReceipt({
    hash: usdcHash,
  });

  const {
    sendTransaction,
    data: ethHash,
    isPending: ethPending,
    error: ethError,
    reset: resetEth,
  } = useSendTransaction();
  const { isLoading: ethConfirming, isSuccess: ethSuccess } = useWaitForTransactionReceipt({
    hash: ethHash,
  });

  useEffect(() => {
    if (!usdcSuccess) return;
    const funded = usdcAmount;
    setUsdcAmount("");
    resetUsdc();
    void api(`/api/agents/${agentId}/topup`, {
      method: "POST",
      body: JSON.stringify({ amount: Number(funded) }),
    }).finally(onFunded);
  }, [usdcSuccess, agentId, usdcAmount, onFunded, resetUsdc]);

  useEffect(() => {
    if (!ethSuccess) return;
    resetEth();
    onFunded();
  }, [ethSuccess, onFunded, resetEth]);

  function fundUsdc() {
    const trimmed = usdcAmount.trim();
    if (!trimmed || Number(trimmed) <= 0) return;
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [walletAddress as `0x${string}`, parseUnits(trimmed, 6)],
      chainId: TARGET_CHAIN.id,
    });
  }

  function fundEth() {
    const trimmed = ethAmount.trim() || DEFAULT_ETH;
    if (Number(trimmed) <= 0) return;
    sendTransaction({
      to: walletAddress as `0x${string}`,
      value: parseEther(trimmed),
      chainId: TARGET_CHAIN.id,
    });
  }

  if (!isConnected) {
    return <span className="text-xs text-slate-400">Connect treasury</span>;
  }
  if (wrongNetwork) {
    return <span className="text-xs text-amber-600">Wrong network</span>;
  }
  if (!isTreasury) {
    return <span className="text-xs text-slate-400">Use treasury wallet</span>;
  }

  const usdcBusy = usdcPending || usdcConfirming;
  const ethBusy = ethPending || ethConfirming;

  return (
    <div className="flex min-w-[12rem] flex-col gap-2">
      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="USDC"
          value={usdcAmount}
          onChange={(e) => setUsdcAmount(e.target.value)}
          disabled={usdcBusy}
          className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        <button
          type="button"
          disabled={usdcBusy || !usdcAmount.trim() || Number(usdcAmount) <= 0}
          onClick={() => fundUsdc()}
          className="btn-primary-xs disabled:opacity-50"
        >
          {usdcBusy ? "…" : "USDC"}
        </button>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="0.0001"
          placeholder="ETH"
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          disabled={ethBusy}
          className="w-16 rounded-lg border border-slate-200 px-2 py-1.5 text-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
        />
        <button
          type="button"
          disabled={ethBusy}
          onClick={() => fundEth()}
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {ethBusy ? "…" : "ETH gas"}
        </button>
      </div>

      {usdcError && <span className="max-w-xs break-words text-xs text-red-600">{walletErrorText(usdcError)}</span>}
      {ethError && <span className="max-w-xs break-words text-xs text-red-600">{walletErrorText(ethError)}</span>}
      {usdcSuccess && usdcHash && <TxLink hash={usdcHash} />}
      {ethSuccess && ethHash && <TxLink hash={ethHash} />}
    </div>
  );
}

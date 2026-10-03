import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAccount, useWriteContract } from "wagmi";
import {
  Check,
  Circle,
  ExternalLink,
  Link2,
  Shield,
  Wallet,
} from "lucide-react";
import { api } from "../../lib/api";
import { Spinner } from "../ui/Skeleton";
import {
  ERC8004_IDENTITY_REGISTRY,
  identityRegistryAbi,
  nftExplorerUrl,
  registryExplorerUrl,
  reputationRegistryExplorerUrl,
} from "../../lib/erc8004";
import { addressExplorerUrl, txExplorerUrl } from "../../lib/explorer";
import type { Erc8004AgentStatus } from "../../lib/api";

type Props = {
  apiBase: string;
  operationalWallet?: string | null;
  variant?: "buyer" | "seller";
  title?: string;
};

type Erc8004Status = Erc8004AgentStatus & { sellerWallet?: string | null };

type StepState = "done" | "current" | "upcoming";

type SetupStep = {
  id: string;
  title: string;
  description: string;
  who: string;
  state: StepState;
  txHash?: string | null;
  action?: ReactNode;
};

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function StepIndicator({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-4 w-4" />
      </div>
    );
  }
  if (state === "current") {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-accent-cyan bg-white ring-4 ring-accent-cyan/15">
        <Circle className="h-2.5 w-2.5 fill-accent-cyan text-accent-cyan" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-slate-50">
      <Circle className="h-2.5 w-2.5 text-slate-300" />
    </div>
  );
}

function PassportField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-sm text-slate-800">{children}</div>
    </div>
  );
}

export function Erc8004Panel({
  apiBase,
  operationalWallet,
  variant = "buyer",
  title = "ERC-8004 on-chain identity",
}: Props) {
  const walletLabel = variant === "seller" ? "Payment wallet" : "Operational wallet";
  const linkWalletTitle = variant === "seller" ? "Link payment wallet" : "Link operational wallet";
  const linkWalletDesc =
    variant === "seller"
      ? "Payment wallet signs off-chain; treasury submits setAgentWallet on the seller NFT."
      : "Agent wallet signs off-chain; treasury submits setAgentWallet. Links spending wallet to the NFT.";
  const displayWallet = operationalWallet ?? null;

  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [status, setStatus] = useState<Erc8004Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    void api<Erc8004Status>(apiBase)
      .then((s) => {
        setStatus(s);
        if (variant === "seller" && s.sellerWallet && !operationalWallet) {
          // seller wallet comes from API when not passed
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [apiBase, operationalWallet, variant]);

  useEffect(() => {
    load();
  }, [load]);

  const treasuryMatch =
    status?.treasuryAddress &&
    address &&
    status.treasuryAddress.toLowerCase() === address.toLowerCase();

  const resolvedWallet = displayWallet ?? status?.sellerWallet ?? null;

  async function runTreasuryStep(
    label: string,
    action: () => Promise<`0x${string}`>,
    confirmPath: string,
    body?: Record<string, unknown>
  ) {
    if (!address) throw new Error("Connect treasury wallet in MetaMask");
    setBusy(label);
    setError(null);
    try {
      const txHash = await action();
      await api(confirmPath, {
        method: "POST",
        body: JSON.stringify({ txHash, treasuryAddress: address, ...body }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleRegister() {
    const { agentUri } = await api<{ agentUri: string }>(`${apiBase}/registration-uri`);
    await runTreasuryStep(
      "register",
      () =>
        writeContractAsync({
          address: ERC8004_IDENTITY_REGISTRY,
          abi: identityRegistryAbi,
          functionName: "register",
          args: [agentUri],
        }),
      `${apiBase}/register/confirm`
    );
  }

  async function handleSetUri() {
    const onChainAgentId = status?.agentId;
    if (!onChainAgentId) return;
    const { agentUri } = await api<{ agentUri: string }>(
      `${apiBase}/registration-uri?agentId=${onChainAgentId}`
    );
    await runTreasuryStep(
      "set_uri",
      () =>
        writeContractAsync({
          address: ERC8004_IDENTITY_REGISTRY,
          abi: identityRegistryAbi,
          functionName: "setAgentURI",
          args: [BigInt(onChainAgentId), agentUri],
        }),
      `${apiBase}/uri/confirm`
    );
  }

  async function handleLinkWallet() {
    if (!address) throw new Error("Connect treasury wallet");
    setBusy("link_wallet");
    setError(null);
    try {
      const prepared = await api<{
        agentId: string;
        newWallet: `0x${string}`;
        owner: `0x${string}`;
        deadline: string;
        signature: `0x${string}`;
      }>(`${apiBase}/wallet-link/prepare`, {
        method: "POST",
        body: JSON.stringify({ treasuryAddress: address }),
      });
      const txHash = await writeContractAsync({
        address: ERC8004_IDENTITY_REGISTRY,
        abi: identityRegistryAbi,
        functionName: "setAgentWallet",
        args: [
          BigInt(prepared.agentId),
          prepared.newWallet,
          BigInt(prepared.deadline),
          prepared.signature,
        ],
      });
      await api(`${apiBase}/wallet-link/confirm`, {
        method: "POST",
        body: JSON.stringify({ txHash }),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet link failed");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !status) {
    return <Spinner label="Loading on-chain identity…" />;
  }

  if (!status) {
    return <p className="text-sm text-red-600">{error ?? "Could not load ERC-8004 status"}</p>;
  }

  const treasuryDone = Boolean(status.treasuryAddress);
  const registerDone = Boolean(status.registerTx && status.agentId);
  const uriDone =
    Boolean(status.uriTx) || status.nextStep === "link_wallet" || status.nextStep === "done";
  const walletDone = status.nextStep === "done";

  function stepState(done: boolean, isCurrent: boolean): StepState {
    if (done) return "done";
    if (isCurrent) return "current";
    return "upcoming";
  }

  const currentStep = status.nextStep;

  const setupSteps: SetupStep[] = [
    {
      id: "treasury",
      title: "Set org treasury",
      description: "Link your company MetaMask on the Wallets page. Treasury owns the identity NFT.",
      who: "Org admin",
      state: stepState(treasuryDone, currentStep === "connect_treasury"),
      action:
        currentStep === "connect_treasury" ? (
          <Link to="/wallets" className="btn-primary-sm">
            <Wallet className="h-3.5 w-3.5" />
            Go to Wallets
          </Link>
        ) : undefined,
    },
    {
      id: "register",
      title: "Mint identity NFT",
      description: "Treasury signs register() — creates ERC-8004 Agent ID on Arbitrum Sepolia.",
      who: "Treasury MetaMask",
      state: stepState(registerDone, currentStep === "register"),
      txHash: status.registerTx,
      action:
        currentStep === "register" ? (
          <button
            type="button"
            disabled={!isConnected || !treasuryMatch || isPending || !!busy}
            onClick={() => void handleRegister()}
            className="btn-primary-sm"
          >
            {busy === "register" ? "Minting…" : "Mint NFT"}
          </button>
        ) : undefined,
    },
    {
      id: "uri",
      title: "Publish registration file",
      description: "Set the full data: URI with agent wallet and MCP endpoint in registrations[].",
      who: "Treasury MetaMask",
      state: stepState(uriDone, currentStep === "set_uri"),
      txHash: status.uriTx,
      action:
        currentStep === "set_uri" && status.agentId ? (
          <button
            type="button"
            disabled={!isConnected || !treasuryMatch || isPending || !!busy}
            onClick={() => void handleSetUri()}
            className="btn-primary-sm"
          >
            {busy === "set_uri" ? "Publishing…" : "Set URI"}
          </button>
        ) : undefined,
    },
    {
      id: "wallet",
      title: linkWalletTitle,
      description: linkWalletDesc,
      who: "Treasury MetaMask (+ wallet signature)",
      state: stepState(walletDone, currentStep === "link_wallet"),
      txHash: status.walletTx,
      action:
        currentStep === "link_wallet" ? (
          <button
            type="button"
            disabled={!isConnected || !treasuryMatch || isPending || !!busy}
            onClick={() => void handleLinkWallet()}
            className="btn-primary-sm"
          >
            {busy === "link_wallet" ? "Linking…" : "Link wallet"}
          </button>
        ) : undefined,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Shield className="h-5 w-5 text-accent-cyan" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {status.nextStep === "done" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            <Link2 className="h-3 w-3" />
            Complete
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="lg:col-span-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Setup flow</h3>
          <p className="mt-1 text-sm text-slate-600">
            Follow these steps in order. Each on-chain step needs the correct wallet connected in MetaMask.
          </p>

          <ol className="mt-6 space-y-0">
            {setupSteps.map((step, i) => (
              <li key={step.id} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <StepIndicator state={step.state} />
                  {i < setupSteps.length - 1 && (
                    <div
                      className={`my-1 w-0.5 flex-1 min-h-[2rem] ${
                        step.state === "done" ? "bg-emerald-300" : "bg-slate-200"
                      }`}
                    />
                  )}
                </div>
                <div className={`pb-8 ${step.state === "current" ? "" : "opacity-80"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{step.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {step.who}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{step.description}</p>
                  {step.txHash && (
                    <a
                      href={txExplorerUrl(step.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 font-mono text-xs text-accent-cyan hover:underline"
                    >
                      {step.txHash.slice(0, 14)}…
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {step.action && <div className="mt-3">{step.action}</div>}
                </div>
              </li>
            ))}
          </ol>

          {isConnected && status.treasuryAddress && !treasuryMatch && currentStep !== "connect_treasury" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Connected wallet is not org treasury. Switch MetaMask to{" "}
              <span className="font-mono">{shortAddr(status.treasuryAddress)}</span> for identity steps.
            </p>
          )}

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        </section>

        <section className="lg:col-span-2 space-y-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm">
            <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-400">
              On-chain passport
            </div>
            {status.agentId ? (
              <a
                href={nftExplorerUrl(status.agentId)}
                target="_blank"
                rel="noreferrer"
                className="text-2xl font-bold text-accent-navy hover:underline"
              >
                Agent #{status.agentId}
              </a>
            ) : (
              <div className="text-2xl font-bold text-slate-400">Not minted</div>
            )}

            <div className="mt-4 grid gap-2">
              <PassportField label="NFT owner (treasury)">
                {status.onChain?.owner ? (
                  <a href={addressExplorerUrl(status.onChain.owner)} target="_blank" rel="noreferrer" className="font-mono text-xs hover:underline">
                    {shortAddr(status.onChain.owner)}
                  </a>
                ) : (
                  "—"
                )}
              </PassportField>
              <PassportField label="Verified wallet">
                {status.onChain?.verifiedWallet ? (
                  <span className={status.onChain.walletMatches ? "text-emerald-700" : "text-amber-700"}>
                    <a
                      href={addressExplorerUrl(status.onChain.verifiedWallet)}
                      target="_blank"
                      rel="noreferrer"
                      className="font-mono text-xs hover:underline"
                    >
                      {shortAddr(status.onChain.verifiedWallet)}
                    </a>
                    {status.onChain.walletMatches ? " ✓" : " mismatch"}
                  </span>
                ) : (
                  "—"
                )}
              </PassportField>
              <PassportField label={walletLabel}>
                {resolvedWallet ? (
                  <a
                    href={addressExplorerUrl(resolvedWallet)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs hover:underline"
                  >
                    {shortAddr(resolvedWallet)}
                  </a>
                ) : (
                  "—"
                )}
              </PassportField>
              {variant === "seller" && (
                <PassportField label="Ratings received">
                  {status.reputation ? (
                    <>
                      {status.reputation.count} · score {status.reputation.summaryValue}{" "}
                      <a
                        href={reputationRegistryExplorerUrl()}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent-cyan hover:underline"
                      >
                        registry
                      </a>
                    </>
                  ) : (
                    "—"
                  )}
                </PassportField>
              )}
            </div>

            <a
              href={registryExplorerUrl()}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-xs text-accent-cyan hover:underline"
            >
              Identity registry
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>

          {status.registration && (
            <details className="rounded-xl border border-slate-200 bg-white p-4 text-xs">
              <summary className="cursor-pointer font-medium text-slate-700">Registration JSON</summary>
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-slate-600">
                {JSON.stringify(status.registration, null, 2)}
              </pre>
            </details>
          )}
        </section>
      </div>
    </div>
  );
}

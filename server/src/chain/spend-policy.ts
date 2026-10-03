import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  stringToHex,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config.js";
import { SETTLEMENT_CHAIN, SETTLEMENT_RPC_URL, txExplorerUrl } from "./network.js";
import { agentSpendPolicyAbi } from "./spend-policy-abi.js";
import { publicClient, usdToUsdcUnits } from "./wallet.js";

/** Mirrors `AgentSpendPolicy.Status`. */
export enum OnchainSpendStatus {
  None = 0,
  PendingApproval = 1,
  Authorized = 2,
  Settled = 3,
  Rejected = 4,
  Cancelled = 5,
}

export type SpendLimitsUsd = {
  perTxUsd: number;
  dailyUsd: number;
  autoApproveUsd: number;
};

export type OnchainRequest = {
  requestId: Hex;
  status: OnchainSpendStatus;
  txHash: Hash;
  explorerUrl: string;
};

/** A revert from the policy contract itself (limit, kill switch…) — as opposed to RPC / gas failures. */
export class SpendPolicyRevertError extends Error {
  constructor(public readonly reason: string) {
    super(`On-chain policy rejected: ${reason}`);
    this.name = "SpendPolicyRevertError";
  }
}

const policyAddress = env.spendPolicyAddress as Address | "";
const adminAccount = env.spendPolicyAdminKey ? privateKeyToAccount(env.spendPolicyAdminKey) : null;

export function spendPolicyEnabled(): boolean {
  return Boolean(policyAddress && adminAccount);
}

export function spendPolicyInfo() {
  return {
    enabled: spendPolicyEnabled(),
    address: policyAddress || null,
    admin: adminAccount?.address ?? null,
    chainId: SETTLEMENT_CHAIN.id,
  };
}

function requireConfig() {
  if (!policyAddress || !adminAccount) throw new Error("AgentSpendPolicy is not configured");
  return { address: policyAddress, admin: adminAccount };
}

const adminWallet = adminAccount
  ? createWalletClient({
      account: adminAccount,
      chain: SETTLEMENT_CHAIN,
      transport: http(SETTLEMENT_RPC_URL, { timeout: 30_000 }),
    })
  : null;

// All admin writes share one nonce sequence; serialize them so concurrent runs don't collide.
let writeQueue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeQueue.then(fn, fn);
  writeQueue = next.catch(() => undefined);
  return next;
}

type WriteArgs = {
  functionName:
    | "bindAgent"
    | "setLimits"
    | "setOperator"
    | "approve"
    | "reject"
    | "requestSpend"
    | "markSettled"
    | "cancel";
  args: readonly unknown[];
};

async function write({ functionName, args }: WriteArgs) {
  const { address, admin } = requireConfig();
  return enqueue(async () => {
    try {
      const { request } = await publicClient.simulateContract({
        address,
        abi: agentSpendPolicyAbi,
        functionName,
        args: args as never,
        account: admin,
      });
      const hash = await adminWallet!.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
      return receipt;
    } catch (err) {
      throw normalizeError(err);
    }
  });
}

function normalizeError(err: unknown): Error {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return new SpendPolicyRevertError(revert.data?.errorName ?? revert.reason ?? "reverted");
    }
  }
  return err instanceof Error ? err : new Error(String(err));
}

function toUnits(usd: number): bigint {
  return usdToUsdcUnits(Math.max(0, usd));
}

/** Clamp to the contract invariant: 0 < autoApprove <= perTx <= daily. */
export function normalizeLimits(limits: SpendLimitsUsd) {
  const daily = toUnits(limits.dailyUsd);
  const perTx = [toUnits(limits.perTxUsd), daily].reduce((a, b) => (a < b ? a : b));
  const auto = [toUnits(limits.autoApproveUsd), perTx].reduce((a, b) => (a < b ? a : b));
  if (perTx === 0n) throw new Error("On-chain per-transaction limit must be greater than zero");
  return { perTx, daily, auto };
}

async function readPolicy(agent: Address) {
  const { address } = requireConfig();
  const [admin, active, perTxLimit, dailyLimit, autoApproveLimit] = await publicClient.readContract({
    address,
    abi: agentSpendPolicyAbi,
    functionName: "policies",
    args: [agent],
  });
  return { admin, active, perTxLimit, dailyLimit, autoApproveLimit };
}

async function ensureAdminIsOperator() {
  const { address, admin } = requireConfig();
  const allowed = await publicClient.readContract({
    address,
    abi: agentSpendPolicyAbi,
    functionName: "isOperator",
    args: [admin.address, admin.address],
  });
  if (!allowed) await write({ functionName: "setOperator", args: [admin.address, true] });
}

/**
 * Bind the agent wallet to the AgntPymt policy admin (agent consents via EIP-712) and keep its
 * on-chain limits in sync with the off-chain policy. Returns any tx hashes sent.
 */
export async function ensureAgentPolicy(
  agentPrivateKey: Hex,
  limits: SpendLimitsUsd
): Promise<{ bound: boolean; txHashes: Hash[] }> {
  const { address, admin } = requireConfig();
  const agent = privateKeyToAccount(agentPrivateKey);
  const { perTx, daily, auto } = normalizeLimits(limits);
  const txHashes: Hash[] = [];

  await ensureAdminIsOperator();

  const current = await readPolicy(agent.address);
  if (current.admin === "0x0000000000000000000000000000000000000000") {
    const nonce = await publicClient.readContract({
      address,
      abi: agentSpendPolicyAbi,
      functionName: "nonces",
      args: [agent.address],
    });
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
    const signature = await agent.signTypedData({
      domain: {
        name: "AgntPymt AgentSpendPolicy",
        version: "1",
        chainId: SETTLEMENT_CHAIN.id,
        verifyingContract: address,
      },
      types: {
        BindAgent: [
          { name: "agent", type: "address" },
          { name: "admin", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "BindAgent",
      message: { agent: agent.address, admin: admin.address, nonce, deadline },
    });
    const receipt = await write({
      functionName: "bindAgent",
      args: [agent.address, perTx, daily, auto, deadline, signature],
    });
    txHashes.push(receipt.transactionHash);
    return { bound: true, txHashes };
  }

  if (getAddress(current.admin) !== admin.address) {
    throw new Error(`Agent ${agent.address} is bound to a different policy admin (${current.admin})`);
  }

  if (current.perTxLimit !== perTx || current.dailyLimit !== daily || current.autoApproveLimit !== auto) {
    const receipt = await write({ functionName: "setLimits", args: [agent.address, perTx, daily, auto] });
    txHashes.push(receipt.transactionHash);
  }
  return { bound: true, txHashes };
}

/** Deterministic placeholder payee for vendors without a configured wallet. */
export function vendorPolicyAddress(vendor: { id: string; walletAddress?: string | null }): Address {
  const candidate = vendor.walletAddress || env.evmPayToAddress;
  if (candidate) return getAddress(candidate);
  return getAddress(`0x${keccak256(stringToHex(`agntpymt-vendor:${vendor.id}`)).slice(-40)}`);
}

export async function requestOnchainSpend(params: {
  agentAddress: Address;
  vendor: Address;
  amountUsd: number;
  ref: string;
}): Promise<OnchainRequest> {
  const receipt = await write({
    functionName: "requestSpend",
    args: [params.agentAddress, params.vendor, toUnits(params.amountUsd), keccak256(stringToHex(params.ref))],
  });

  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi: agentSpendPolicyAbi, data: log.data, topics: log.topics });
      if (event.eventName === "SpendRequested") {
        return {
          requestId: event.args.requestId,
          status: Number(event.args.status) as OnchainSpendStatus,
          txHash: receipt.transactionHash,
          explorerUrl: txExplorerUrl(receipt.transactionHash),
        };
      }
    } catch {
      // not a policy event
    }
  }
  throw new Error("requestSpend succeeded but SpendRequested event was missing");
}

export async function readOnchainRequestStatus(requestId: Hex): Promise<OnchainSpendStatus> {
  const { address } = requireConfig();
  const request = await publicClient.readContract({
    address,
    abi: agentSpendPolicyAbi,
    functionName: "requests",
    args: [requestId],
  });
  return Number(request[5]) as OnchainSpendStatus;
}

export async function approveOnchainSpend(requestId: Hex): Promise<Hash> {
  const receipt = await write({ functionName: "approve", args: [requestId] });
  return receipt.transactionHash;
}

export async function cancelOnchainSpend(requestId: Hex): Promise<Hash | null> {
  const status = await readOnchainRequestStatus(requestId);
  if (status === OnchainSpendStatus.PendingApproval) {
    return (await write({ functionName: "reject", args: [requestId] })).transactionHash;
  }
  if (status === OnchainSpendStatus.Authorized) {
    return (await write({ functionName: "cancel", args: [requestId] })).transactionHash;
  }
  return null;
}

/** Record settlement; `settlementTxHash` is the x402 transfer, or a reference hash when payments are simulated. */
export async function markOnchainSettled(requestId: Hex, settlementRef: string): Promise<Hash> {
  const ref = /^0x[0-9a-fA-F]{64}$/.test(settlementRef)
    ? (settlementRef as Hex)
    : keccak256(stringToHex(settlementRef));
  const receipt = await write({ functionName: "markSettled", args: [requestId, ref] });
  return receipt.transactionHash;
}

export function isRequestId(value: string | null | undefined): value is Hex {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

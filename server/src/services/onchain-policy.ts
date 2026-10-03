import { eq, getDb, schema, type Agent, type Vendor } from "@agntpymt/db";
import { env } from "../config.js";
import { txExplorerUrl } from "../chain/network.js";
import {
  OnchainSpendStatus,
  SpendPolicyRevertError,
  approveOnchainSpend,
  cancelOnchainSpend,
  ensureAgentPolicy,
  isRequestId,
  markOnchainSettled,
  readOnchainRequestStatus,
  requestOnchainSpend,
  spendPolicyEnabled,
  spendPolicyInfo,
  vendorPolicyAddress,
} from "../chain/spend-policy.js";
import { logAudit } from "./audit.js";

const ACTOR = "AgentSpendPolicy (Arbitrum)";

type RunContext = { runId: string; agentId: string; source?: string };

export type OnchainAuthorization =
  | { kind: "skipped" }
  | { kind: "authorized" | "pending"; requestId: `0x${string}`; txHash: string }
  | { kind: "denied"; reason: string };

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bind/sync the agent on-chain, then submit `requestSpend`. Contract reverts (limits, kill switch) are a
 * hard deny; infrastructure failures (RPC, gas) are logged and the off-chain policy result stands.
 */
export async function authorizeOnchain(
  ctx: RunContext & {
    agent: Agent;
    vendor: Vendor;
    sessionId: string;
    amountUsd: number;
    limits: { autoApproveUsd: number; dailyCapUsd: number | null; orgCeilingUsd: number | null };
  }
): Promise<OnchainAuthorization> {
  if (!spendPolicyEnabled() || !ctx.agent.walletAddress || !ctx.agent.walletPrivateKey) {
    return { kind: "skipped" };
  }

  const dailyUsd = Math.max(ctx.limits.dailyCapUsd ?? 0, env.spendPolicyDefaultDailyUsd);
  const perTxUsd = ctx.limits.orgCeilingUsd ?? dailyUsd;

  try {
    const sync = await ensureAgentPolicy(ctx.agent.walletPrivateKey as `0x${string}`, {
      perTxUsd,
      dailyUsd,
      autoApproveUsd: ctx.limits.autoApproveUsd,
    });
    if (!ctx.agent.spendPolicyBound) {
      await getDb()
        .update(schema.agents)
        .set({ spendPolicyBound: true })
        .where(eq(schema.agents.id, ctx.agent.id));
    }
    if (sync.txHashes.length) {
      await logAudit({
        ...ctx,
        step: "onchain_policy_synced",
        message: `Agent wallet bound to AgentSpendPolicy with limits synced on Arbitrum`,
        actor: ACTOR,
        payload: {
          txHash: sync.txHashes.at(-1),
          txHashes: sync.txHashes,
          explorerUrl: txExplorerUrl(sync.txHashes.at(-1)!),
        },
      });
    }

    const request = await requestOnchainSpend({
      agentAddress: ctx.agent.walletAddress as `0x${string}`,
      vendor: vendorPolicyAddress(ctx.vendor),
      amountUsd: ctx.amountUsd,
      ref: ctx.sessionId,
    });

    await getDb()
      .update(schema.sellerSessions)
      .set({ policyRequestId: request.requestId })
      .where(eq(schema.sellerSessions.id, ctx.sessionId));

    const pending = request.status === OnchainSpendStatus.PendingApproval;
    await logAudit({
      ...ctx,
      step: pending ? "onchain_policy_pending" : "onchain_policy_authorized",
      message: pending
        ? "On-chain spend request awaiting admin approval on Arbitrum"
        : "On-chain spend authorized by AgentSpendPolicy on Arbitrum",
      actor: ACTOR,
      payload: {
        requestId: request.requestId,
        txHash: request.txHash,
        explorerUrl: request.explorerUrl,
        contract: spendPolicyInfo().address,
      },
    });

    return { kind: pending ? "pending" : "authorized", requestId: request.requestId, txHash: request.txHash };
  } catch (err) {
    if (err instanceof SpendPolicyRevertError) {
      await logAudit({
        ...ctx,
        step: "onchain_policy_denied",
        message: `Denied on-chain — AgentSpendPolicy reverted with ${err.reason}`,
        actor: ACTOR,
        payload: { reason: err.reason, contract: spendPolicyInfo().address },
      });
      return { kind: "denied", reason: err.reason };
    }
    await logAudit({
      ...ctx,
      step: "onchain_policy_unavailable",
      message: `On-chain policy check unavailable — continuing with off-chain policy (${errorMessage(err)})`,
      actor: ACTOR,
    });
    return { kind: "skipped" };
  }
}

async function sessionRequestId(sessionId: string): Promise<`0x${string}` | null> {
  const [session] = await getDb()
    .select({ policyRequestId: schema.sellerSessions.policyRequestId })
    .from(schema.sellerSessions)
    .where(eq(schema.sellerSessions.id, sessionId));
  return isRequestId(session?.policyRequestId) ? session.policyRequestId : null;
}

/** Mirror a human approval on-chain. Throws if the contract refuses (e.g. daily cap now exceeded). */
export async function approveOnchain(ctx: RunContext & { sessionId: string }): Promise<void> {
  if (!spendPolicyEnabled()) return;
  const requestId = await sessionRequestId(ctx.sessionId);
  if (!requestId) return;
  if ((await readOnchainRequestStatus(requestId)) !== OnchainSpendStatus.PendingApproval) return;

  const txHash = await approveOnchainSpend(requestId);
  await logAudit({
    ...ctx,
    step: "onchain_policy_approved",
    message: "Admin approval recorded on-chain on Arbitrum",
    actor: ACTOR,
    payload: { requestId, txHash, explorerUrl: txExplorerUrl(txHash) },
  });
}

export async function cancelOnchain(ctx: RunContext & { sessionId: string }): Promise<void> {
  if (!spendPolicyEnabled()) return;
  const requestId = await sessionRequestId(ctx.sessionId);
  if (!requestId) return;
  try {
    const txHash = await cancelOnchainSpend(requestId);
    if (!txHash) return;
    await logAudit({
      ...ctx,
      step: "onchain_policy_rejected",
      message: "Spend request rejected on-chain on Arbitrum",
      actor: ACTOR,
      payload: { requestId, txHash, explorerUrl: txExplorerUrl(txHash) },
    });
  } catch (err) {
    console.warn(`[spend-policy] cancel failed for ${requestId}: ${errorMessage(err)}`);
  }
}

/** Record the settlement against the on-chain request. Never throws — payment already happened. */
export async function recordOnchainSettlement(
  ctx: RunContext & { sessionId: string; settlementRef: string }
): Promise<string | null> {
  if (!spendPolicyEnabled()) return null;
  const requestId = await sessionRequestId(ctx.sessionId);
  if (!requestId) return null;
  try {
    const txHash = await markOnchainSettled(requestId, ctx.settlementRef);
    await logAudit({
      ...ctx,
      step: "onchain_policy_settled",
      message: "Settlement recorded on-chain by AgentSpendPolicy on Arbitrum",
      actor: ACTOR,
      payload: { requestId, txHash, settlementRef: ctx.settlementRef, explorerUrl: txExplorerUrl(txHash) },
    });
    return txHash;
  } catch (err) {
    console.warn(`[spend-policy] markSettled failed for ${requestId}: ${errorMessage(err)}`);
    return null;
  }
}

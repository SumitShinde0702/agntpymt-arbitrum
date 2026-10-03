/**
 * End-to-end check of the server's AgentSpendPolicy integration against a live RPC.
 * Requires SPEND_POLICY_ADDRESS, SPEND_POLICY_ADMIN_PRIVATE_KEY and (optionally) ARBITRUM_SEPOLIA_RPC_URL.
 *
 *   npx tsx server/scripts/smoke-spend-policy.ts
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  OnchainSpendStatus,
  SpendPolicyRevertError,
  approveOnchainSpend,
  cancelOnchainSpend,
  ensureAgentPolicy,
  markOnchainSettled,
  readOnchainRequestStatus,
  requestOnchainSpend,
  spendPolicyInfo,
  vendorPolicyAddress,
} from "../src/chain/spend-policy.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ok  ${message}`);
}

const info = spendPolicyInfo();
if (!info.enabled) throw new Error("Set SPEND_POLICY_ADDRESS and SPEND_POLICY_ADMIN_PRIVATE_KEY");
console.log(`AgentSpendPolicy ${info.address} on chain ${info.chainId}, admin ${info.admin}`);

const agentKey = generatePrivateKey();
const agent = privateKeyToAccount(agentKey).address;
const vendor = vendorPolicyAddress({ id: "smoke-vendor" });
const limits = { perTxUsd: 1, dailyUsd: 2, autoApproveUsd: 0.05 };

const bound = await ensureAgentPolicy(agentKey, limits);
assert(bound.txHashes.length === 1, "agent bound with EIP-712 consent");
assert((await ensureAgentPolicy(agentKey, limits)).txHashes.length === 0, "re-sync with same limits is a no-op");

const small = await requestOnchainSpend({ agentAddress: agent, vendor, amountUsd: 0.01, ref: "smoke-small" });
assert(small.status === OnchainSpendStatus.Authorized, "small spend auto-authorized");
await markOnchainSettled(small.requestId, "simulated:smoke-small");
assert((await readOnchainRequestStatus(small.requestId)) === OnchainSpendStatus.Settled, "settlement recorded");

const big = await requestOnchainSpend({ agentAddress: agent, vendor, amountUsd: 0.5, ref: "smoke-big" });
assert(big.status === OnchainSpendStatus.PendingApproval, "large spend waits for approval");
await approveOnchainSpend(big.requestId);
assert((await readOnchainRequestStatus(big.requestId)) === OnchainSpendStatus.Authorized, "admin approval recorded");
await cancelOnchainSpend(big.requestId);
assert((await readOnchainRequestStatus(big.requestId)) === OnchainSpendStatus.Cancelled, "authorized spend cancelled");

try {
  await requestOnchainSpend({ agentAddress: agent, vendor, amountUsd: 5, ref: "smoke-over" });
  assert(false, "over-limit spend should revert");
} catch (err) {
  assert(
    err instanceof SpendPolicyRevertError && err.reason === "ExceedsPerTxLimit",
    "over per-tx limit surfaces as SpendPolicyRevertError(ExceedsPerTxLimit)"
  );
}

console.log("All spend-policy smoke checks passed.");

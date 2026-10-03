import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootDir, ".env") });

const clerkPublishableKey =
  process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY ?? "";
const clerkSecretKey = process.env.CLERK_SECRET_KEY ?? "";

// @clerk/express reads CLERK_* from process.env — sync from VITE_* fallback.
if (clerkPublishableKey && !process.env.CLERK_PUBLISHABLE_KEY) {
  process.env.CLERK_PUBLISHABLE_KEY = clerkPublishableKey;
}
if (clerkSecretKey && !process.env.CLERK_SECRET_KEY) {
  process.env.CLERK_SECRET_KEY = clerkSecretKey;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  simulatePayments: process.env.SIMULATE_PAYMENTS !== "false",
  demoTransactionFeeUsd: Number(process.env.DEMO_TRANSACTION_FEE_USD ?? 0.01),
  evmPayToAddress: process.env.EVM_PAY_TO_ADDRESS ?? "",
  facilitatorUrl: process.env.FACILITATOR_URL ?? "https://facilitator.payai.network",
  /** When false, runs use the built-in LLM negotiation runner and Hermes is never contacted. */
  hermesEnabled: process.env.HERMES_ENABLED === "true",
  hermesApiUrl: process.env.HERMES_API_URL ?? "http://localhost:8642",
  hermesApiKey: process.env.HERMES_API_KEY ?? "",
  hermesProfilesDir: process.env.HERMES_PROFILES_DIR ?? "",
  gcsProfileBucket: process.env.GCS_PROFILE_BUCKET ?? "",
  gcsProfilePrefix: (process.env.GCS_PROFILE_PREFIX ?? "hermes").replace(/^\/+|\/+$/g, ""),
  agntpymtPublicUrl: process.env.AGNTPYMT_PUBLIC_URL ?? "",
  mcpServiceKey: process.env.AGNTPYMT_MCP_KEY ?? "dev-mcp-key",
  /** Optional — auto-submit ERC-8004 vendor feedback after x402 settlement (must match EVM_PAY_TO_ADDRESS). */
  vendorWalletPrivateKey: (process.env.VENDOR_WALLET_PRIVATE_KEY ?? "") as `0x${string}` | "",
  clerkSecretKey,
  clerkPublishableKey,
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiModel: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
  /** AgentSpendPolicy contract on Arbitrum Sepolia; on-chain governance is skipped when unset. */
  spendPolicyAddress: process.env.SPEND_POLICY_ADDRESS ?? "",
  /** Policy admin + operator; pays gas for bind/request/approve/settle records. */
  spendPolicyAdminKey: (process.env.SPEND_POLICY_ADMIN_PRIVATE_KEY ?? "") as `0x${string}` | "",
  /** Hard on-chain daily ceiling when an agent has no daily cap (USD). */
  spendPolicyDefaultDailyUsd: Number(process.env.SPEND_POLICY_DEFAULT_DAILY_USD ?? 100),
  orgId: "org_demo",
};

export { rootDir };

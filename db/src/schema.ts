import {
  pgTable,
  text,
  boolean,
  doublePrecision,
} from "drizzle-orm/pg-core";

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  treasuryWalletAddress: text("treasury_wallet_address"),
  /** Org kill switch — when true, all agent purchases are denied before execution. */
  agentsPaused: boolean("agents_paused").notNull().default(false),
  /** Hard ceiling on every agent's auto-approve limit (nullable = no org ceiling). */
  maxExposureLimitUsd: doublePrecision("max_exposure_limit_usd"),
  createdAt: text("created_at").notNull(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email"),
  createdAt: text("created_at").notNull(),
});

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  iconColor: text("icon_color").notNull().default("violet"),
  walletAddress: text("wallet_address"),
  walletPrivateKey: text("wallet_private_key"),
  walletProvisioned: boolean("wallet_provisioned").notNull().default(false),
  balanceUsd: doublePrecision("balance_usd").notNull().default(0),
  hermesProfileName: text("hermes_profile_name"),
  hermesProvisioned: boolean("hermes_provisioned").notNull().default(false),
  erc8004AgentId: text("erc8004_agent_id"),
  erc8004Status: text("erc8004_status").notNull().default("none"),
  erc8004RegisterTx: text("erc8004_register_tx"),
  erc8004UriTx: text("erc8004_uri_tx"),
  erc8004WalletTx: text("erc8004_wallet_tx"),
  erc8004RegisteredAt: text("erc8004_registered_at"),
  spendPolicyBound: boolean("spend_policy_bound").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const agentPolicies = pgTable("agent_policies", {
  agentId: text("agent_id").primaryKey(),
  autoApproveLimitUsd: doublePrecision("auto_approve_limit_usd").notNull().default(50),
  requireWalletConfirmation: boolean("require_wallet_confirmation").notNull().default(false),
  autoSettlementEnabled: boolean("auto_settlement_enabled").notNull().default(true),
  negotiationRules: text("negotiation_rules"),
  /** Max settled spend per rolling 24h; null = no daily cap. Overage escalates for approval. */
  dailyAggregateCapUsd: doublePrecision("daily_aggregate_cap_usd"),
});

export const vendors = pgTable("vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description"),
  listPriceUsd: doublePrecision("list_price_usd").notNull(),
  counterPriceUsd: doublePrecision("counter_price_usd"),
  negotiationStyle: text("negotiation_style").notNull().default("instant"),
  walletAddress: text("wallet_address"),
  erc8004AgentId: text("erc8004_agent_id"),
  erc8004Status: text("erc8004_status").notNull().default("none"),
  erc8004RegisterTx: text("erc8004_register_tx"),
  erc8004UriTx: text("erc8004_uri_tx"),
  erc8004WalletTx: text("erc8004_wallet_tx"),
  erc8004RegisteredAt: text("erc8004_registered_at"),
});

export const runs = pgTable("runs", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  prompt: text("prompt").notNull(),
  status: text("status").notNull().default("running"),
  hermesRunId: text("hermes_run_id"),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const sellerSessions = pgTable("seller_sessions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  vendorId: text("vendor_id").notNull(),
  purchaseIntent: text("purchase_intent").notNull(),
  quotedPriceUsd: doublePrecision("quoted_price_usd"),
  finalPriceUsd: doublePrecision("final_price_usd"),
  status: text("status").notNull().default("negotiating"),
  fulfillmentPayload: text("fulfillment_payload"),
  policyRequestId: text("policy_request_id"),
  createdAt: text("created_at").notNull(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  runId: text("run_id"),
  sellerSessionId: text("seller_session_id"),
  vendorName: text("vendor_name").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending_approval"),
  kind: text("kind").notNull().default("payment"),
  hermesRunId: text("hermes_run_id"),
  toolName: text("tool_name"),
  requestedAt: text("requested_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  agentId: text("agent_id").notNull(),
  runId: text("run_id"),
  approvalId: text("approval_id"),
  vendorName: text("vendor_name").notNull(),
  description: text("description").notNull(),
  amountUsd: doublePrecision("amount_usd").notNull(),
  status: text("status").notNull(),
  txHash: text("tx_hash"),
  feedbackTxHash: text("feedback_tx_hash"),
  policyTxHash: text("policy_tx_hash"),
  createdAt: text("created_at").notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  agentId: text("agent_id").notNull(),
  step: text("step").notNull(),
  message: text("message").notNull(),
  actor: text("actor"),
  payload: text("payload"),
  source: text("source").notNull().default("dashboard"),
  createdAt: text("created_at").notNull(),
});

export type Agent = typeof agents.$inferSelect;
export type Vendor = typeof vendors.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;

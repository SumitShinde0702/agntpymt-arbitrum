import postgres from "postgres";
import { resolveDatabaseUrl } from "./connection.js";

const migrationSql = `
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  treasury_wallet_address TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  icon_color TEXT NOT NULL DEFAULT 'violet',
  wallet_address TEXT,
  wallet_private_key TEXT,
  wallet_provisioned BOOLEAN NOT NULL DEFAULT FALSE,
  balance_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
  hermes_profile_name TEXT,
  hermes_provisioned BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_policies (
  agent_id TEXT PRIMARY KEY,
  auto_approve_limit_usd DOUBLE PRECISION NOT NULL DEFAULT 50,
  require_wallet_confirmation BOOLEAN NOT NULL DEFAULT FALSE,
  auto_settlement_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  negotiation_rules TEXT
);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  list_price_usd DOUBLE PRECISION NOT NULL,
  counter_price_usd DOUBLE PRECISION,
  negotiation_style TEXT NOT NULL DEFAULT 'instant'
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  hermes_run_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS seller_sessions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  purchase_intent TEXT NOT NULL,
  quoted_price_usd DOUBLE PRECISION,
  final_price_usd DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'negotiating',
  fulfillment_payload TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  seller_session_id TEXT,
  vendor_name TEXT NOT NULL,
  amount_usd DOUBLE PRECISION NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_approval',
  kind TEXT NOT NULL DEFAULT 'payment',
  hermes_run_id TEXT,
  tool_name TEXT,
  requested_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  run_id TEXT,
  approval_id TEXT,
  vendor_name TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_usd DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  step TEXT NOT NULL,
  message TEXT NOT NULL,
  actor TEXT,
  payload TEXT,
  source TEXT NOT NULL DEFAULT 'dashboard',
  created_at TEXT NOT NULL
);
`;

const sql = postgres(resolveDatabaseUrl(), { max: 1, prepare: false });
await sql.unsafe(migrationSql);

const alterSql = `
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_agent_id TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_register_tx TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_uri_tx TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_wallet_tx TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS erc8004_registered_at TEXT;

ALTER TABLE vendors ADD COLUMN IF NOT EXISTS wallet_address TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_agent_id TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_register_tx TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_uri_tx TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_wallet_tx TEXT;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS erc8004_registered_at TEXT;

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS feedback_tx_hash TEXT;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS agents_paused BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS max_exposure_limit_usd DOUBLE PRECISION;

ALTER TABLE agent_policies ADD COLUMN IF NOT EXISTS daily_aggregate_cap_usd DOUBLE PRECISION;

ALTER TABLE agents ADD COLUMN IF NOT EXISTS spend_policy_bound BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE seller_sessions ADD COLUMN IF NOT EXISTS policy_request_id TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS policy_tx_hash TEXT;
`;

await sql.unsafe(alterSql);
await sql.end({ timeout: 5 });

console.log(`Migrated PostgreSQL at ${resolveDatabaseUrl().replace(/:[^:@/]+@/, ":***@")}`);

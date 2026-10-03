import { eq } from "@agntpymt/db";
import { getDb, schema } from "@agntpymt/db";
import { createAgentWallet, fetchWalletBalances } from "../chain/wallet.js";
import { SETTLEMENT_CHAIN_NAME } from "../chain/network.js";
import { env } from "../config.js";

export async function provisionAgentWallet(agentId: string) {
  const db = getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) throw new Error("Agent not found");
  if (agent.walletProvisioned && agent.walletAddress && agent.walletPrivateKey) {
    return agent.walletAddress;
  }

  const { address, privateKey } = createAgentWallet();
  await db
    .update(schema.agents)
    .set({
      walletAddress: address,
      walletPrivateKey: privateKey,
      walletProvisioned: true,
    })
    .where(eq(schema.agents.id, agentId));

  return address;
}

export async function ensureAllAgentWallets(orgId: string = env.orgId) {
  const db = getDb();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
  for (const agent of agents) {
    if (!agent.walletProvisioned || !agent.walletAddress || !agent.walletPrivateKey) {
      await provisionAgentWallet(agent.id);
    }
  }
}

export async function getWalletsOverview(orgId: string = env.orgId) {
  await ensureAllAgentWallets(orgId);
  const db = getDb();

  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));

  const treasuryAddress = org?.treasuryWalletAddress ?? null;
  const treasuryBalances = treasuryAddress ? await fetchWalletBalances(treasuryAddress) : null;

  const agentWallets = await Promise.all(
    agents.map(async (agent) => {
      const onChain = agent.walletAddress
        ? await fetchWalletBalances(agent.walletAddress)
        : { eth: 0, usdc: 0 };
      return {
        id: agent.id,
        name: agent.name,
        category: agent.category,
        iconColor: agent.iconColor,
        status: agent.status,
        walletAddress: agent.walletAddress,
        walletProvisioned: agent.walletProvisioned,
        ledgerBalanceUsd: agent.balanceUsd,
        onChain,
      };
    })
  );

  return {
    network: SETTLEMENT_CHAIN_NAME,
    treasury: treasuryAddress
      ? { address: treasuryAddress, balances: treasuryBalances }
      : null,
    agents: agentWallets,
  };
}

export async function setTreasuryWallet(address: string | null, orgId: string = env.orgId) {
  const db = getDb();
  await db
    .update(schema.organizations)
    .set({ treasuryWalletAddress: address })
    .where(eq(schema.organizations.id, orgId));
}

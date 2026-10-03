import { Router } from "express";
import { eq, desc, and, getDb, schema, inArray, gte, type AuditLog } from "@agntpymt/db";
import { z } from "zod";
import { env } from "../config.js";
import { SETTLEMENT_CHAIN, SETTLEMENT_CHAIN_NAME } from "../chain/network.js";
import { spendPolicyInfo } from "../chain/spend-policy.js";
import { checkHermesHealth } from "../services/hermes.js";
import { createRun } from "../services/run-orchestrator.js";
import { runEventBus } from "../services/event-bus.js";
import { approveAndSettle, denyApproval } from "../simulation/purchase-flow.js";
import {
  ensureAllAgentWallets,
  getWalletsOverview,
  provisionAgentWallet,
  setTreasuryWallet,
} from "../services/agent-wallet.js";
import { suggestAgentProfile, suggestSoulProfile } from "../services/agent-profile-ai.js";
import {
  createSkill,
  deleteMcpServer,
  deleteSkill,
  ensureAllHermesProfiles,
  ensureHermesProfile,
  getHermesProfileStatus,
  profileDirForAgent,
  provisionProfile,
  updateSkill,
  upsertMcpServer,
  writeSoul,
} from "../services/hermes-profile.js";
import { authEnabled, getOrgId } from "../middleware/auth.js";
import { getOrCreateTenant } from "../services/tenant.js";
import { getAuth } from "@clerk/express";
import { erc8004Router } from "./erc8004.js";
import { vendorErc8004Router } from "./vendor-erc8004.js";
import { getVendorErc8004Status } from "../services/vendor-erc8004.js";
import { listPaymentsForOrg, paymentsToCsv } from "../services/transactions.js";
import { getOrgSettings, updateOrgSettings } from "../services/org-settings.js";

export const apiRouter = Router();

apiRouter.get("/me", async (req, res) => {
  const orgId = getOrgId(req);
  if (!authEnabled) {
    return res.json({
      authEnabled: false,
      orgId,
      orgName: "Demo Organization",
      userId: null,
    });
  }
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const tenant = await getOrCreateTenant(userId);
  res.json({
    authEnabled: true,
    orgId: tenant.orgId,
    orgName: tenant.orgName,
    userId,
  });
});

apiRouter.get("/health", async (req, res) => {
  const hermes = await checkHermesHealth();
  const orgId = getOrgId(req);
  const db = getDb();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
  const hermesProfilesProvisioned = agents.filter((a) => a.hermesProvisioned).length;
  res.json({
    status: "ok",
    daemon:
      hermes.online && hermes.authenticated !== false
        ? "running"
        : hermes.online
          ? "auth_error"
          : "degraded",
    hermes,
    hermesProfilesProvisioned,
    hermesProfilesTotal: agents.length,
    simulatePayments: env.simulatePayments,
    demoTransactionFeeUsd: env.demoTransactionFeeUsd,
    aiNegotiation: Boolean(env.openaiApiKey),
    paymentMode: env.simulatePayments ? "simulated" : "x402",
    facilitatorUrl: env.facilitatorUrl,
    network: SETTLEMENT_CHAIN_NAME,
    chainId: SETTLEMENT_CHAIN.id,
    vendorPayToAddress: env.evmPayToAddress || null,
    erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    spendPolicy: spendPolicyInfo(),
  });
});

/** x402-protected vendor settlement — payment handled by x402 middleware before this runs. */
apiRouter.post("/x402/vendor/settle/:sessionId", async (req, res) => {
  res.json({
    ok: true,
    protocol: "x402",
    sessionId: req.params.sessionId,
  });
});

apiRouter.get("/wallets", async (req, res) => {
  const data = await getWalletsOverview(getOrgId(req));
  res.json(data);
});

const treasurySchema = z.object({
  address: z.string().nullable(),
});

apiRouter.patch("/treasury", async (req, res) => {
  const parsed = treasurySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  await setTreasuryWallet(parsed.data.address, getOrgId(req));
  const data = await getWalletsOverview(getOrgId(req));
  res.json(data);
});

apiRouter.get("/dashboard", async (req, res) => {
  const orgId = getOrgId(req);
  await ensureAllAgentWallets(orgId);
  await ensureAllHermesProfiles(orgId);
  const db = getDb();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
  const approvals = await db
    .select()
    .from(schema.approvals)
    .where(and(eq(schema.approvals.orgId, orgId), eq(schema.approvals.status, "pending_approval")));
  const transactions = await db
    .select()
    .from(schema.transactions)
    .where(eq(schema.transactions.orgId, orgId))
    .orderBy(desc(schema.transactions.createdAt))
    .limit(5);
  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  const totalBalance = agents.reduce((sum, a) => sum + a.balanceUsd, 0);
  const activeAgents = agents.filter((a) => a.status === "active").length;
  const spend30Days = transactions.reduce((sum, t) => sum + t.amountUsd, 0);
  const hermesProfilesProvisioned = agents.filter((a) => a.hermesProvisioned).length;

  res.json({
    kpis: {
      totalBalanceUsd: totalBalance,
      activeAgents: `${activeAgents} of ${agents.length}`,
      pendingApprovals: approvals.length,
      spend30DaysUsd: spend30Days,
      hermesProfilesProvisioned,
    },
    agents: await Promise.all(
      agents.map(async (a) => {
        const base = stripAgentSecrets(a);
        if (!a.hermesProvisioned) {
          return { ...base, hermesSkillCount: 0, hermesMcpCount: 0 };
        }
        try {
          const status = await getHermesProfileStatus(a);
          return {
            ...base,
            hermesSkillCount: status.capabilities.skills.length,
            hermesMcpCount: status.capabilities.mcpServers.length,
          };
        } catch {
          return { ...base, hermesSkillCount: 0, hermesMcpCount: 0 };
        }
      })
    ),
    pendingApprovals: approvals,
    recentTransactions: transactions.map((t) => ({
      ...t,
      agentName: agentNames.get(t.agentId) ?? t.agentId,
    })),
    activeWallets: agents.filter((a) => a.walletProvisioned && a.walletAddress).length,
  });
});

function stripAgentSecrets<T extends { walletPrivateKey?: string | null }>(agent: T) {
  const { walletPrivateKey: _key, ...safe } = agent;
  return safe;
}

async function agentIdsForOrg(orgId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ id: schema.agents.id })
    .from(schema.agents)
    .where(eq(schema.agents.orgId, orgId));
  return rows.map((r) => r.id);
}

apiRouter.get("/policies", async (req, res) => {
  const orgId = getOrgId(req);
  const db = getDb();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
  if (agents.length === 0) {
    return res.json([]);
  }

  const agentIds = agents.map((a) => a.id);
  const policies = await db
    .select()
    .from(schema.agentPolicies)
    .where(inArray(schema.agentPolicies.agentId, agentIds));
  const policyByAgent = new Map(policies.map((p) => [p.agentId, p]));

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const txs = await db
    .select({
      agentId: schema.transactions.agentId,
      amountUsd: schema.transactions.amountUsd,
    })
    .from(schema.transactions)
    .where(
      and(
        inArray(schema.transactions.agentId, agentIds),
        gte(schema.transactions.createdAt, since),
        inArray(schema.transactions.status, ["completed", "simulated"])
      )
    );

  const spendByAgent = new Map<string, number>();
  for (const tx of txs) {
    spendByAgent.set(tx.agentId, (spendByAgent.get(tx.agentId) ?? 0) + tx.amountUsd);
  }

  const orgSettings = await getOrgSettings(orgId);

  res.json(
    agents.map((agent) => {
      const policy = policyByAgent.get(agent.id) ?? {
        agentId: agent.id,
        autoApproveLimitUsd: 0.05,
        requireWalletConfirmation: false,
        autoSettlementEnabled: true,
        negotiationRules: null,
        dailyAggregateCapUsd: null,
      };
      return {
        agentId: agent.id,
        agentName: agent.name,
        category: agent.category,
        status: agent.status,
        iconColor: agent.iconColor,
        policy,
        dailySpendUsd: spendByAgent.get(agent.id) ?? 0,
        orgCeilingUsd: orgSettings.maxExposureLimitUsd,
      };
    })
  );
});

apiRouter.get("/org/settings", async (req, res) => {
  const settings = await getOrgSettings(getOrgId(req));
  res.json(settings);
});

const patchOrgSettingsSchema = z.object({
  agentsPaused: z.boolean().optional(),
  maxExposureLimitUsd: z.number().positive().nullable().optional(),
});

apiRouter.patch("/org/settings", async (req, res) => {
  const parsed = patchOrgSettingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());
  const settings = await updateOrgSettings(parsed.data, getOrgId(req));
  res.json(settings);
});

const patchPolicySchema = z.object({
  autoApproveLimitUsd: z.number().min(0).optional(),
  negotiationRules: z.string().nullable().optional(),
  dailyAggregateCapUsd: z.number().positive().nullable().optional(),
});

apiRouter.patch("/agents/:id/policy", async (req, res) => {
  const parsed = patchPolicySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const db = getDb();
  const orgId = getOrgId(req);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id));
  if (!agent || agent.orgId !== orgId) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, number | string | null> = {};
  if (parsed.data.autoApproveLimitUsd != null) {
    const { maxExposureLimitUsd } = await getOrgSettings(orgId);
    updates.autoApproveLimitUsd =
      maxExposureLimitUsd != null
        ? Math.min(parsed.data.autoApproveLimitUsd, maxExposureLimitUsd)
        : parsed.data.autoApproveLimitUsd;
  }
  if (parsed.data.negotiationRules !== undefined) {
    updates.negotiationRules = parsed.data.negotiationRules;
  }
  if (parsed.data.dailyAggregateCapUsd !== undefined) {
    updates.dailyAggregateCapUsd = parsed.data.dailyAggregateCapUsd;
  }

  await db
    .update(schema.agentPolicies)
    .set(updates)
    .where(eq(schema.agentPolicies.agentId, req.params.id));

  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.agentId, req.params.id));
  res.json(policy);
});

apiRouter.get("/agents", async (req, res) => {
  const orgId = getOrgId(req);
  await ensureAllAgentWallets(orgId);
  const db = getDb();
  const agents = await db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId));
  res.json(agents.map(stripAgentSecrets));
});

apiRouter.get("/agents/:id", async (req, res) => {
  const db = getDb();
  const orgId = getOrgId(req);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id));
  if (!agent || agent.orgId !== orgId) return res.status(404).json({ error: "Not found" });
  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.agentId, agent.id));
  res.json({ ...stripAgentSecrets(agent), policy });
});

const iconColorSchema = z.enum(["violet", "blue", "green", "orange"]);

const suggestAgentSchema = z.object({
  prompt: z.string().min(1),
});

apiRouter.post("/agents/suggest", async (req, res) => {
  const parsed = suggestAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  try {
    const suggestion = await suggestAgentProfile(parsed.data.prompt);
    res.json({ ...suggestion, aiEnabled: Boolean(env.openaiApiKey) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

const createAgentSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  description: z.string().optional(),
  iconColor: iconColorSchema.optional(),
  negotiationRules: z.string().optional(),
  autoApproveLimitUsd: z.number().positive().optional(),
});

apiRouter.post("/agents", async (req, res) => {
  const parsed = createAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const db = getDb();
  const orgId = getOrgId(req);
  const id = `agent_${Date.now()}`;
  const row = {
    id,
    orgId,
    name: parsed.data.name,
    category: parsed.data.category,
    description: parsed.data.description ?? null,
    status: "active",
    iconColor: parsed.data.iconColor ?? "violet",
    walletAddress: null,
    balanceUsd: 0,
    createdAt: new Date().toISOString(),
  };

  await db.insert(schema.agents).values(row);
  const { maxExposureLimitUsd } = await getOrgSettings(orgId);
  const requestedLimit = parsed.data.autoApproveLimitUsd ?? 0.05;
  await db.insert(schema.agentPolicies).values({
    agentId: id,
    autoApproveLimitUsd:
      maxExposureLimitUsd != null ? Math.min(requestedLimit, maxExposureLimitUsd) : requestedLimit,
    negotiationRules: parsed.data.negotiationRules?.trim() || null,
  });
  await provisionAgentWallet(id);
  const [created] = await db.select().from(schema.agents).where(eq(schema.agents.id, id));
  if (created) {
    const [policy] = await db
      .select()
      .from(schema.agentPolicies)
      .where(eq(schema.agentPolicies.agentId, id));
    await provisionProfile(created, policy);
    const [withHermes] = await db.select().from(schema.agents).where(eq(schema.agents.id, id));
    return res.status(201).json(withHermes ? stripAgentSecrets(withHermes) : stripAgentSecrets(created));
  }
  res.status(201).json(created ? stripAgentSecrets(created) : row);
});

const patchAgentSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

apiRouter.patch("/agents/:id", async (req, res) => {
  const parsed = patchAgentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const db = getDb();
  const orgId = getOrgId(req);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id));
  if (!agent || agent.orgId !== orgId) return res.status(404).json({ error: "Not found" });

  const updates: Record<string, string | null> = {};
  if (parsed.data.name) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  await db.update(schema.agents).set(updates).where(eq(schema.agents.id, req.params.id));
  const [updated] = await db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id));
  res.json(updated ? stripAgentSecrets(updated) : null);
});

async function loadOrgAgent(agentId: string, orgId: string) {
  const db = getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent || agent.orgId !== orgId) return null;
  return agent;
}

apiRouter.get("/agents/:id/hermes", async (req, res) => {
  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });
  const status = await getHermesProfileStatus(agent);
  res.json(status);
});

apiRouter.use("/agents/:id/erc8004", erc8004Router);
apiRouter.use("/vendors/:id/erc8004", vendorErc8004Router);

const soulSchema = z.object({ soul: z.string() });

const suggestSoulSchema = z.object({
  prompt: z.string().min(1),
});

apiRouter.post("/agents/:id/hermes/soul/suggest", async (req, res) => {
  const parsed = suggestSoulSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  try {
    const suggestion = await suggestSoulProfile({
      prompt: parsed.data.prompt,
      agentName: agent.name,
      category: agent.category,
    });
    res.json({ ...suggestion, aiEnabled: Boolean(env.openaiApiKey) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

apiRouter.put("/agents/:id/hermes/soul", async (req, res) => {
  const parsed = soulSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  await writeSoul(profilePath, parsed.data.soul);
  res.json({ ok: true, soul: parsed.data.soul });
});

apiRouter.post("/agents/:id/hermes/provision", async (req, res) => {
  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  const db = getDb();
  const [policy] = await db
    .select()
    .from(schema.agentPolicies)
    .where(eq(schema.agentPolicies.agentId, agent.id));
  const status = await provisionProfile(agent, policy);
  res.json(status);
});

const skillBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().default(""),
  body: z.string().default(""),
});

apiRouter.post("/agents/:id/hermes/skills", async (req, res) => {
  const parsed = skillBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  const id = parsed.data.id ?? parsed.data.name;
  const skill = await createSkill(
    profilePath,
    id,
    parsed.data.name,
    parsed.data.description,
    parsed.data.body
  );
  res.status(201).json(skill);
});

apiRouter.put("/agents/:id/hermes/skills/:skillId", async (req, res) => {
  const parsed = skillBodySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  const skill = await updateSkill(
    profilePath,
    req.params.skillId,
    parsed.data.name,
    parsed.data.description,
    parsed.data.body
  );
  res.json(skill);
});

apiRouter.delete("/agents/:id/hermes/skills/:skillId", async (req, res) => {
  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  await deleteSkill(profilePath, req.params.skillId);
  res.json({ ok: true });
});

const mcpServerSchema = z.object({
  name: z.string().min(1),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
});

apiRouter.post("/agents/:id/hermes/mcp", async (req, res) => {
  const parsed = mcpServerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  const servers = await upsertMcpServer(profilePath, parsed.data);
  res.json({ mcpServers: servers });
});

apiRouter.delete("/agents/:id/hermes/mcp/:name", async (req, res) => {
  const orgId = getOrgId(req);
  const agent = await loadOrgAgent(req.params.id, orgId);
  if (!agent) return res.status(404).json({ error: "Not found" });

  await ensureHermesProfile(agent.id);
  const profilePath = profileDirForAgent(agent);
  try {
    const servers = await deleteMcpServer(profilePath, req.params.name);
    res.json({ mcpServers: servers });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

apiRouter.get("/vendors", async (req, res) => {
  const db = getDb();
  const orgId = getOrgId(req);
  const vendors = await db.select().from(schema.vendors);

  await Promise.all(
    vendors
      .filter((v) => v.erc8004AgentId && v.erc8004Status !== "complete")
      .map((v) => getVendorErc8004Status(v.id, orgId).catch(() => null))
  );

  const refreshed = await db.select().from(schema.vendors);
  res.json(refreshed);
});

apiRouter.get("/approvals", async (req, res) => {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.orgId, getOrgId(req)))
    .orderBy(desc(schema.approvals.requestedAt));
  res.json(rows);
});

apiRouter.post("/approvals/:id/approve", async (req, res) => {
  try {
    const db = getDb();
    const orgId = getOrgId(req);
    const [approval] = await db
      .select()
      .from(schema.approvals)
      .where(eq(schema.approvals.id, req.params.id));
    if (!approval || approval.orgId !== orgId) {
      return res.status(404).json({ error: "Not found" });
    }
    if (approval.kind === "hermes_action") {
      const { resolveHermesApproval } = await import("../services/hermes-approvals.js");
      const choice = String(req.body?.choice ?? "once") as "once" | "deny";
      const result = await resolveHermesApproval(req.params.id, choice);
      return res.json(result);
    }
    const result = await approveAndSettle(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

apiRouter.post("/approvals/:id/deny", async (req, res) => {
  const db = getDb();
  const orgId = getOrgId(req);
  const [approval] = await db
    .select()
    .from(schema.approvals)
    .where(eq(schema.approvals.id, req.params.id));
  if (!approval || approval.orgId !== orgId) {
    return res.status(404).json({ error: "Not found" });
  }
  if (approval.kind === "hermes_action") {
    try {
      const { resolveHermesApproval } = await import("../services/hermes-approvals.js");
      const result = await resolveHermesApproval(req.params.id, "deny");
      return res.json(result);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
    }
  }
  await denyApproval(req.params.id);
  res.json({ ok: true });
});

apiRouter.get("/transactions", async (req, res) => {
  const rows = await listPaymentsForOrg(getOrgId(req));
  res.json(rows);
});

apiRouter.get("/transactions/export", async (req, res) => {
  const rows = await listPaymentsForOrg(getOrgId(req));
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="agntpymt-payments-${stamp}.csv"`);
  res.send(paymentsToCsv(rows));
});

apiRouter.get("/logs", async (req, res) => {
  const db = getDb();
  const orgId = getOrgId(req);
  const allowedAgentIds = await agentIdsForOrg(orgId);
  const runId = req.query.runId as string | undefined;
  const agentId = req.query.agentId as string | undefined;

  if (agentId && !allowedAgentIds.includes(agentId)) {
    return res.status(404).json({ error: "Not found" });
  }

  let rows: AuditLog[] = [];
  if (runId) {
    rows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.runId, runId))
      .orderBy(schema.auditLogs.createdAt);
    rows = rows.filter((r) => allowedAgentIds.includes(r.agentId));
  } else if (agentId) {
    rows = await db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.agentId, agentId))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(100);
  } else if (allowedAgentIds.length > 0) {
    rows = await db
      .select()
      .from(schema.auditLogs)
      .where(inArray(schema.auditLogs.agentId, allowedAgentIds))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(100);
  } else {
    rows = [];
  }

  res.json(rows);
});

const runSchema = z.object({
  agentId: z.string(),
  prompt: z.string().min(1),
});

apiRouter.post("/agent/run", async (req, res) => {
  const parsed = runSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const db = getDb();
  const orgId = getOrgId(req);
  const [agent] = await db
    .select()
    .from(schema.agents)
    .where(eq(schema.agents.id, parsed.data.agentId));
  if (!agent || agent.orgId !== orgId) {
    return res.status(404).json({ error: "Agent not found" });
  }

  const runId = await createRun(parsed.data.agentId, parsed.data.prompt, orgId);
  res.status(202).json({ runId });
});

apiRouter.get("/agent/run/:runId/history", async (req, res) => {
  const db = getDb();
  const { runId } = req.params;
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run) return res.status(404).json({ error: "Run not found" });

  const logs = await db
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.runId, runId))
    .orderBy(schema.auditLogs.createdAt);

  res.json({
    runId,
    status: run.status,
    agentId: run.agentId,
    prompt: run.prompt,
    events: logs.map((log) => ({
      runId: log.runId,
      step: log.step,
      message: log.message,
      actor: log.actor ?? undefined,
      payload: log.payload ? JSON.parse(log.payload) : undefined,
      createdAt: log.createdAt,
    })),
  });
});

apiRouter.get("/agent/run/:runId/events", (req, res) => {
  const { runId } = req.params;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: unknown) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const unsubscribe = runEventBus.subscribe(runId, send);

  const seenLogIds = new Set<string>();

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 15_000);

  const pollAudit = setInterval(() => {
    void getDb()
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.runId, runId))
      .orderBy(schema.auditLogs.createdAt)
      .then((logs) => {
        for (const log of logs) {
          if (seenLogIds.has(log.id)) continue;
          seenLogIds.add(log.id);
          send({
            runId: log.runId,
            step: log.step,
            message: log.message,
            actor: log.actor ?? undefined,
            payload: log.payload ? JSON.parse(log.payload) : undefined,
            createdAt: log.createdAt,
          });
        }
      });
  }, 1000);

  void getDb()
    .select()
    .from(schema.auditLogs)
    .where(eq(schema.auditLogs.runId, runId))
    .orderBy(schema.auditLogs.createdAt)
    .then((existing) => {
      for (const log of existing) {
        seenLogIds.add(log.id);
        send({
          runId: log.runId,
          step: log.step,
          message: log.message,
          actor: log.actor ?? undefined,
          payload: log.payload ? JSON.parse(log.payload) : undefined,
          createdAt: log.createdAt,
        });
      }
    });

  req.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(pollAudit);
    unsubscribe();
  });
});

const purchaseSchema = z.object({
  agentId: z.string(),
  purchaseIntent: z.string(),
  runId: z.string().optional(),
  category: z.string().optional(),
  resourceId: z.string().optional(),
  maxBudget: z.number().optional(),
});

apiRouter.post("/agent/execute", async (req, res) => {
  const parsed = purchaseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json(parsed.error.flatten());

  const { runPurchaseFlow } = await import("../simulation/purchase-flow.js");
  const runId = parsed.data.runId ?? `mcp_${Date.now()}`;

  try {
    const result = await runPurchaseFlow({
      runId,
      agentId: parsed.data.agentId,
      purchaseIntent: parsed.data.purchaseIntent,
      category: parsed.data.category,
      resourceId: parsed.data.resourceId,
      maxBudget: parsed.data.maxBudget,
      source: "mcp",
    });

    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Purchase failed";
    res.status(200).json({ status: "error", error: message, runId });
  }
});

apiRouter.post("/agents/:id/topup", async (req, res) => {
  const amount = Number(req.body.amount ?? 0);
  if (amount <= 0) return res.status(400).json({ error: "Invalid amount" });

  const db = getDb();
  const orgId = getOrgId(req);
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, req.params.id));
  if (!agent || agent.orgId !== orgId) return res.status(404).json({ error: "Not found" });

  const { fetchWalletBalances } = await import("../chain/wallet.js");
  const onChain = agent.walletAddress
    ? await fetchWalletBalances(agent.walletAddress)
    : { eth: 0, usdc: 0 };

  await db
    .update(schema.agents)
    .set({ balanceUsd: onChain.usdc })
    .where(eq(schema.agents.id, req.params.id));

  res.json({ ok: true, onChainUsdc: onChain.usdc });
});

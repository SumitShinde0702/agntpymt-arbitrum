import { nanoid } from "nanoid";
import { eq } from "@agntpymt/db";
import { getDb, schema } from "@agntpymt/db";
import { env } from "../config.js";
import { logAudit } from "./audit.js";
import { runEventBus } from "./event-bus.js";
import { checkHermesHealth, startHermesRun, streamHermesRunEvents, type HermesRunEvent } from "./hermes.js";
import { ensureHermesProfile, readSoul, profileDirForAgent, syncHermesGatewayMcpConfig } from "./hermes-profile.js";
import { runPurchaseFlow, PolicyDeniedError } from "../simulation/purchase-flow.js";
import { matchVendor } from "../simulation/vendor-matcher.js";
import { createHermesToolApproval } from "./hermes-approvals.js";
import { setActiveRun, clearActiveRun } from "./run-context.js";

const HERMES_RUN_TIMEOUT_MS = 300_000;

function inferPurchaseFromPrompt(prompt: string, agentCategory: string): string | null {
  const lower = prompt.toLowerCase();
  if (/book|flight|travel|sfo|jfk|hotel/.test(lower)) return prompt;
  if (/order|supply|mouse|office|equipment/.test(lower)) return prompt;
  if (/aws|cloud|invoice/.test(lower)) return prompt;
  if (/research|data|sector|market/.test(lower)) return prompt;
  if (/compute|forecast|batch/.test(lower)) return prompt;
  if (/pay|buy|purchase/.test(lower)) return prompt;
  if (agentCategory === "travel") return `Book travel: ${prompt}`;
  if (agentCategory === "procurement") return `Order supplies: ${prompt}`;
  if (agentCategory === "cloud") return `Pay cloud invoice: ${prompt}`;
  if (agentCategory === "research") return `Buy research data: ${prompt}`;
  return null;
}

function formatToolName(raw: string): string {
  return raw.replace(/^mcp_agntpymt_/, "").replace(/^agntpymt_/, "agntpymt_");
}

function hermesTextChunk(event: HermesRunEvent, delta: boolean): string {
  if (delta) {
    return String(event.delta ?? event.text ?? event.content ?? "");
  }
  return String(event.text ?? event.content ?? event.message ?? "");
}

function mapHermesEventToAudit(
  event: HermesRunEvent,
  options: { streamedReply: boolean }
) {
  const type = event.event ?? "hermes.event";
  const actor = "Hermes";

  if (
    type === "message.delta" ||
    type === "message.completed" ||
    type === "message.done" ||
    type === "reasoning.available"
  ) {
    return null;
  }

  if (type === "tool.started") {
    const tool = formatToolName(String(event.tool ?? event.name ?? "unknown"));
    return {
      step: "hermes_tool",
      message: `Calling ${tool}…`,
      actor,
      payload: event,
    };
  }
  if (type === "tool.completed") {
    const tool = formatToolName(String(event.tool ?? event.name ?? "unknown"));
    const rawErr = (event as { error?: unknown }).error;
    const failed =
      rawErr === true ||
      (typeof rawErr === "string" && rawErr.length > 0 && rawErr !== "false");
    const errSuffix = failed
      ? ` — failed${typeof rawErr === "string" && rawErr !== "true" ? `: ${rawErr}` : ""}`
      : "";
    return {
      step: "hermes_tool",
      message: `${tool} completed${errSuffix}`,
      actor,
      payload: event,
    };
  }
  if (type === "run.completed") {
    const finalText = event.text ? String(event.text).trim() : "";
    return {
      step: "run_completed",
      message: options.streamedReply || !finalText ? "Run complete" : finalText,
      actor,
      payload: event,
    };
  }
  if (type === "run.failed") {
    return {
      step: "run_failed",
      message: `Hermes run failed: ${String(event.error ?? "unknown error")}`,
      actor,
      payload: event,
    };
  }
  if (type === "run.cancelled") {
    return {
      step: "run_failed",
      message: "Hermes run was cancelled",
      actor,
      payload: event,
    };
  }
  if (type === "approval.request") {
    return {
      step: "hermes_approval",
      message: "Hermes requested human approval",
      actor,
      payload: event,
    };
  }

  return {
    step: "hermes_event",
    message: type,
    actor,
    payload: event,
  };
}

async function watchHermesRun(
  runId: string,
  agentId: string,
  agentName: string,
  hermesRunId: string
) {
  const db = getDb();
  const streamBase = `hermes-${runId}`;
  let streamSeq = 0;
  let currentStreamId = `${streamBase}-${streamSeq}`;
  let messageBuffer = "";
  let streamedReply = false;
  let lastPersisted = "";

  const emitAgentStream = (message: string, streaming: boolean, streamId = currentStreamId) => {
    if (!message.trim()) return;
    streamedReply = true;
    runEventBus.emitRunEvent({
      runId,
      step: "hermes_message",
      message,
      actor: agentName,
      payload: { streamId, streaming },
      createdAt: new Date().toISOString(),
    });
  };

  const finalizeAssistantSegment = async (persist = false) => {
    const text = messageBuffer.trim();
    if (!text) return;
    emitAgentStream(text, false);
    if (persist && text !== lastPersisted) {
      lastPersisted = text;
      await logAudit({
        runId,
        agentId,
        step: "hermes_message",
        message: text,
        actor: agentName,
        payload: { streamId: currentStreamId, streaming: false },
      });
    }
    messageBuffer = "";
    streamSeq += 1;
    currentStreamId = `${streamBase}-${streamSeq}`;
  };

  const result = await streamHermesRunEvents(
    hermesRunId,
    async (event) => {
      const type = event.event ?? "";

      if (type === "message.delta") {
        const chunk = hermesTextChunk(event, true);
        if (!chunk) return;
        messageBuffer += chunk;
        emitAgentStream(messageBuffer, true);
        return;
      }

      if (type === "message.completed" || type === "message.done" || type === "message") {
        const text = hermesTextChunk(event, false) || messageBuffer;
        messageBuffer = text;
        await finalizeAssistantSegment(true);
        return;
      }

      if (type === "tool.started") {
        await finalizeAssistantSegment(false);
      }

      if (type === "approval.request") {
        await finalizeAssistantSegment(false);
        const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
        if (run) {
          await createHermesToolApproval({
            orgId: run.orgId,
            agentId,
            runId,
            hermesRunId,
            event,
          });
        }
        return;
      }

      const mapped = mapHermesEventToAudit(event, { streamedReply });
      if (mapped) {
        await logAudit({ runId, agentId, ...mapped });
      }
    },
    { timeoutMs: HERMES_RUN_TIMEOUT_MS }
  );

  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run || run.status !== "running") return;

  if (result === "completed") {
    await db
      .update(schema.runs)
      .set({ status: "completed", completedAt: new Date().toISOString() })
      .where(eq(schema.runs.id, runId));
    clearActiveRun(agentId, runId);
    return;
  }

  if (result === "failed" || result === "cancelled") {
    await db
      .update(schema.runs)
      .set({ status: "failed", completedAt: new Date().toISOString() })
      .where(eq(schema.runs.id, runId));
    clearActiveRun(agentId, runId);
    return;
  }

  await logAudit({
    runId,
    agentId,
    step: "run_failed",
    message:
      result === "timeout"
        ? `Hermes run timed out after ${HERMES_RUN_TIMEOUT_MS / 1000}s`
        : "Lost connection to Hermes event stream",
    actor: "Hermes",
  });
  await db
    .update(schema.runs)
    .set({ status: "failed", completedAt: new Date().toISOString() })
    .where(eq(schema.runs.id, runId));
  clearActiveRun(agentId, runId);
}

export async function executeRun(runId: string, agentId: string, prompt: string) {
  const db = getDb();
  const [agent] = await db.select().from(schema.agents).where(eq(schema.agents.id, agentId));
  if (!agent) throw new Error("Agent not found");

  await logAudit({
    runId,
    agentId,
    step: "run_started",
    message: `Run started for ${agent.name}`,
    actor: agent.name,
  });

  await logAudit({
    runId,
    agentId,
    step: "user_message",
    message: prompt,
    actor: "You",
  });

  setActiveRun(agentId, runId);

  if (!env.hermesEnabled) {
    await completeRunWithLocalLogic(runId, agentId, prompt, agent.category);
    clearActiveRun(agentId, runId);
    return { mode: "local" as const };
  }

  await syncHermesGatewayMcpConfig(agentId);

  const hermes = await checkHermesHealth();
  let localReason: string | null = null;

  if (hermes.online && hermes.authenticated !== false) {
    await ensureHermesProfile(agentId);
    const profilePath = profileDirForAgent(agent);
    const soulMd = await readSoul(profilePath);

    const hermesRunId = await startHermesRun({
      prompt,
      soulMd,
      agentId,
      runId,
      agentName: agent.name,
    });

    if (hermesRunId) {
      await db.update(schema.runs).set({ hermesRunId }).where(eq(schema.runs.id, runId));
      await logAudit({
        runId,
        agentId,
        step: "hermes_delegated",
        message: `Task delegated to Hermes (run ${hermesRunId})`,
        actor: "Hermes",
      });

      void watchHermesRun(runId, agentId, agent.name, hermesRunId);
      return { mode: "hermes" as const, hermesRunId };
    }

    localReason =
      "Hermes rejected the run request — check HERMES_API_KEY matches API_SERVER_KEY in ~/.hermes/.env";
  } else if (!hermes.online) {
    localReason = "Hermes offline — running local task simulation";
  } else if (hermes.authError === "missing_key") {
    localReason =
      "Hermes is online but HERMES_API_KEY is not set — add it to .env (must match API_SERVER_KEY in ~/.hermes/.env)";
  } else if (hermes.authError === "invalid_key") {
    localReason =
      "Hermes API key rejected — set HERMES_API_KEY in .env to match API_SERVER_KEY in ~/.hermes/.env";
  } else {
    localReason = "Hermes unavailable — running local task simulation";
  }

  await logAudit({
    runId,
    agentId,
    step: "local_runner",
    message: localReason,
    actor: "AgntPymt",
  });

  await completeRunWithLocalLogic(runId, agentId, prompt, agent.category);
  clearActiveRun(agentId, runId);
  return { mode: "local" as const };
}

async function completeRunWithLocalLogic(runId: string, agentId: string, prompt: string, agentCategory: string) {
  const db = getDb();

  await logAudit({
    runId,
    agentId,
    step: "planning",
    message: `Analyzing task: "${prompt.slice(0, 80)}${prompt.length > 80 ? "…" : ""}"`,
    actor: "AgntPymt Planner",
  });

  const purchaseIntent = inferPurchaseFromPrompt(prompt, agentCategory);

  if (purchaseIntent) {
    const vendors = await db.select().from(schema.vendors);
    const vendor = matchVendor(vendors, purchaseIntent, agentCategory);
    await logAudit({
      runId,
      agentId,
      step: "planning",
      message: `Identified purchase need → ${vendor.category} via ${vendor.name}`,
      actor: "AgntPymt Planner",
    });

    try {
      const result = await runPurchaseFlow({
        runId,
        agentId,
        purchaseIntent,
        category: agentCategory,
      });

      if (result.status === "pending_approval") {
        await db.update(schema.runs).set({ status: "awaiting_approval" }).where(eq(schema.runs.id, runId));
        return;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Purchase flow failed";
      // Kill-switch denials are already audited as `policy_denied`.
      if (!(err instanceof PolicyDeniedError)) {
        await logAudit({
          runId,
          agentId,
          step: "run_failed",
          message: `Run stopped — ${message}`,
          actor: "AgntPymt",
        });
      }
      await db.update(schema.runs).set({ status: "failed" }).where(eq(schema.runs.id, runId));
      return;
    }
  } else {
    await logAudit({
      runId,
      agentId,
      step: "task_completed",
      message: "Task completed — no purchase required",
      actor: "AgntPymt",
    });
  }

  await logAudit({
    runId,
    agentId,
    step: "run_completed",
    message: "Run completed successfully",
    actor: "AgntPymt",
  });

  await db
    .update(schema.runs)
    .set({ status: "completed", completedAt: new Date().toISOString() })
    .where(eq(schema.runs.id, runId));
}

export async function createRun(agentId: string, prompt: string, orgId: string) {
  const db = getDb();
  const runId = nanoid();
  await db.insert(schema.runs).values({
    id: runId,
    orgId,
    agentId,
    prompt,
    status: "running",
    hermesRunId: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });

  void executeRun(runId, agentId, prompt).catch(async (err) => {
    const message = err instanceof Error ? err.message : "Run failed unexpectedly";
    await logAudit({
      runId,
      agentId,
      step: "run_failed",
      message: `Run stopped — ${message}`,
      actor: "AgntPymt",
    });
    await db
      .update(schema.runs)
      .set({ status: "failed", completedAt: new Date().toISOString() })
      .where(eq(schema.runs.id, runId));
  });
  return runId;
}

export async function finalizeRunIfReady(runId: string) {
  const db = getDb();
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, runId));
  if (!run || run.status === "completed") return;

  await logAudit({
    runId,
    agentId: run.agentId,
    step: "run_completed",
    message: "Run completed successfully",
    actor: "AgntPymt",
  });

  await db
    .update(schema.runs)
    .set({ status: "completed", completedAt: new Date().toISOString() })
    .where(eq(schema.runs.id, runId));
}

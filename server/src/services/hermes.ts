import { env } from "../config.js";

export type HermesHealth = {
  online: boolean;
  status?: string;
  authenticated?: boolean;
  authError?: "missing_key" | "invalid_key";
};

function hermesHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.hermesApiKey) headers.Authorization = `Bearer ${env.hermesApiKey}`;
  return headers;
}

export async function checkHermesHealth(): Promise<HermesHealth> {
  if (!env.hermesEnabled) return { online: false, status: "disabled" };
  try {
    const res = await fetch(`${env.hermesApiUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { online: false };
    const data = (await res.json()) as { status?: string };

    if (!env.hermesApiKey) {
      return { online: true, status: data.status, authenticated: false, authError: "missing_key" };
    }

    const authRes = await fetch(`${env.hermesApiUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${env.hermesApiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    if (authRes.status === 401 || authRes.status === 403) {
      return { online: true, status: data.status, authenticated: false, authError: "invalid_key" };
    }

    return { online: true, status: data.status, authenticated: authRes.ok };
  } catch {
    return { online: false };
  }
}

export type HermesRunEvent = {
  event?: string;
  run_id?: string;
  timestamp?: string;
  text?: string;
  tool?: string;
  error?: string;
  [key: string]: unknown;
};

export type StartHermesRunInput = {
  prompt: string;
  soulMd: string;
  agentId: string;
  runId: string;
  agentName: string;
};

export async function startHermesRun(input: StartHermesRunInput): Promise<string | null> {
  try {
    const purchaseTask =
      /buy|purchase|premium|sector research|paid resource|order|book|pay\b|invoice/i.test(
        input.prompt
      );
    const instructions = [
      input.soulMd.trim(),
      "",
      "## Runtime",
      `Agent ID for MCP tools: ${input.agentId}`,
      `AgntPymt run ID (pass as runId on every MCP tool call): ${input.runId}`,
      "Example: agntpymt_initiate_purchase({ agentId, runId, purchaseIntent: '...' })",
      "When the user wants to spend money, you MUST call agntpymt_initiate_purchase (or agntpymt_request_paid_resource) with purchaseIntent and runId.",
      "Never end a purchase task without calling the purchase MCP tool — analysis alone is not enough.",
      "Do not guess prices ($1.50 is wrong). Vendor price comes from the purchase tool result (~$0.01 USDC in demo).",
      "HTTP 402 is x402 payment protocol, not 'auto-approve too low'. Low auto-approve returns pending_approval from the tool, not a chat refusal.",
      "If an MCP tool fails, report the failure honestly — never invent past transactions or offer to reuse old session data.",
      "Do not use session_search to skip payment or substitute for agntpymt_initiate_purchase.",
      "Do not use list_agents / skill_view / memory as a substitute for purchasing.",
      purchaseTask
        ? [
            "",
            "## REQUIRED for this purchase task — DO THIS NOW",
            `The user's message is already a clear purchase intent: "${input.prompt.trim()}"`,
            "Do NOT ask clarifying questions about sector, vendor, geography, or data type.",
            "Do NOT list options or wait for confirmation — call the purchase tool in this turn.",
            "1. Optional: agntpymt_get_agent_policy (once)",
            "2. REQUIRED: agntpymt_initiate_purchase with:",
            `   - purchaseIntent: exactly the user's wording (or close paraphrase): "${input.prompt.trim()}"`,
            `   - agentId: ${input.agentId}`,
            `   - runId: ${input.runId}`,
            "   Alternative: agntpymt_request_paid_resource with resourceId premium-data + same agentId/runId",
            "3. After the tool returns, summarize completed / pending_approval / error — nothing else.",
            "Seller negotiation appears automatically in the dashboard after the purchase tool runs.",
          ].join("\n")
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch(`${env.hermesApiUrl}/v1/runs`, {
      method: "POST",
      headers: hermesHeaders(),
      body: JSON.stringify({
        input: input.prompt,
        instructions,
        session_id: input.runId,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; run_id?: string };
    return data.run_id ?? data.id ?? null;
  } catch {
    return null;
  }
}

function parseSseChunk(chunk: string, onData: (json: string) => void) {
  for (const line of chunk.split("\n")) {
    if (line.startsWith("data: ")) {
      onData(line.slice(6));
    }
  }
}

export type StreamHermesResult = "completed" | "failed" | "cancelled" | "timeout" | "disconnected";

export async function streamHermesRunEvents(
  hermesRunId: string,
  onEvent: (event: HermesRunEvent) => void,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<StreamHermesResult> {
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  try {
    const res = await fetch(`${env.hermesApiUrl}/v1/runs/${hermesRunId}/events`, {
      headers: {
        Accept: "text/event-stream",
        ...(env.hermesApiKey ? { Authorization: `Bearer ${env.hermesApiKey}` } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok || !res.body) return "disconnected";

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let terminal: StreamHermesResult | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        parseSseChunk(part, (data) => {
          if (!data.trim() || data === "[DONE]") return;
          try {
            const event = JSON.parse(data) as HermesRunEvent;
            onEvent(event);
            const type = event.event ?? "";
            if (type === "run.completed") terminal = "completed";
            else if (type === "run.failed") terminal = "failed";
            else if (type === "run.cancelled") terminal = "cancelled";
          } catch {
            // ignore malformed frames
          }
        });
      }

      if (terminal) break;
    }

    return terminal ?? "disconnected";
  } catch (err) {
    if (controller.signal.aborted && !options?.signal?.aborted) return "timeout";
    return "disconnected";
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

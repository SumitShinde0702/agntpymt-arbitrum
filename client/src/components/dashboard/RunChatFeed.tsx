import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Scale,
  Sparkles,
  Store,
  Wrench,
  XCircle,
} from "lucide-react";
import type { RunEvent } from "../../lib/api";
import { txExplorerUrl } from "../../lib/explorer";
import { ChatMarkdown } from "./ChatMarkdown";

type ChatRole = "buyer" | "seller" | "system" | "hermes_tool";
type ToolPhase = "calling" | "completed" | "failed";

const STEP_LABELS: Record<string, string> = {
  run_started: "Run started",
  purchase_intent: "Purchase request",
  vendor_matched: "Vendor matched",
  seller_contacted: "Seller reached out",
  seller_quoted: "Quote received",
  negotiation_round: "Negotiation",
  deal_accepted: "Deal agreed",
  policy_evaluated: "Policy check",
  payment_simulated: "Payment",
  payment_settled: "Payment sent",
  payment_failed: "Payment failed",
  payment_pending: "Awaiting approval",
  payment_denied: "Payment denied",
  policy_denied: "Denied by policy",
  onchain_policy_synced: "On-chain policy synced",
  onchain_policy_authorized: "Authorized on Arbitrum",
  onchain_policy_pending: "On-chain approval required",
  onchain_policy_approved: "Approved on Arbitrum",
  onchain_policy_rejected: "Rejected on Arbitrum",
  onchain_policy_settled: "Settlement recorded on Arbitrum",
  onchain_policy_denied: "Denied by on-chain policy",
  onchain_policy_unavailable: "On-chain policy unavailable",
  order_fulfilled: "Order delivered",
  run_completed: "Run complete",
  run_failed: "Run failed",
  planning: "Planning",
  local_runner: "Local mode",
  hermes_delegated: "Hermes",
  hermes_message: "Agent",
  hermes_tool: "Tool",
  hermes_approval: "Approval needed",
  hermes_approval_granted: "Approved",
  hermes_approval_denied: "Denied",
  user_message: "You",
};

const WAIT_MESSAGES = [
  "Starting Hermes…",
  "Loading agent soul…",
  "Warming up tools…",
  "Thinking…",
];

/** Idle timeout between events — Hermes + negotiation can take a few minutes. */
export const RUN_IDLE_TIMEOUT_MS = 300_000;

function txHashFromEvent(event: RunEvent): string | undefined {
  const hash = event.payload?.txHash;
  return typeof hash === "string" && hash.startsWith("0x") ? hash : undefined;
}

function TxHashLink({ txHash }: { txHash: string }) {
  const short = `${txHash.slice(0, 10)}…${txHash.slice(-8)}`;
  return (
    <a
      href={txExplorerUrl(txHash)}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-xs font-medium underline hover:opacity-80"
    >
      {short}
      <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function normalizeToolName(raw: string): string {
  return raw
    .replace(/^mcp_agntpymt_/, "")
    .replace(/^mcp_/, "")
    .replace(/\s+completed.*$/i, "")
    .replace(/[.…]+$/u, "")
    .trim();
}

function toolNameFromEvent(event: RunEvent): string {
  const payload = event.payload ?? {};
  for (const key of ["tool", "name", "tool_name"] as const) {
    const raw = payload[key];
    if (typeof raw === "string" && raw.trim()) return normalizeToolName(raw);
  }
  const m = event.message.match(/(?:Calling\s+)?([a-zA-Z0-9_.-]+)/i);
  return m?.[1] ? normalizeToolName(m[1]) : "tool";
}

function toolPhase(event: RunEvent): ToolPhase {
  const type = typeof event.payload?.event === "string" ? event.payload.event : "";
  if (type === "tool.started" || /^Calling\s+/i.test(event.message)) return "calling";
  const err = event.payload?.error;
  const failed =
    err === true ||
    (typeof err === "string" && err.length > 0 && err !== "false") ||
    /\bfailed\b/i.test(event.message);
  if (failed) return "failed";
  if (type === "tool.completed" || /completed/i.test(event.message)) return "completed";
  return "completed";
}

/** Hide "Calling" once a matching Done/Failed arrives for the same tool (FIFO). */
function collapseToolEvents(events: RunEvent[]): RunEvent[] {
  const skip = new Set<number>();
  const open = new Map<string, number[]>();

  events.forEach((e, i) => {
    if (e.step !== "hermes_tool") return;
    const name = toolNameFromEvent(e);
    const phase = toolPhase(e);
    if (phase === "calling") {
      const q = open.get(name) ?? [];
      q.push(i);
      open.set(name, q);
      return;
    }
    const q = open.get(name) ?? [];
    const start = q.shift();
    if (start !== undefined) skip.add(start);
    open.set(name, q);
  });

  return events.filter((_, i) => !skip.has(i));
}

function classifyEvent(event: RunEvent, agentName?: string): ChatRole {
  if (event.step === "hermes_tool") return "hermes_tool";
  const actor = event.actor ?? "";
  if (event.step === "user_message" || actor === "You") return "buyer";
  if (actor === agentName) return "buyer";
  if (
    actor === "AgntPymt" ||
    actor.startsWith("AgntPymt ") ||
    actor.startsWith("AgentSpendPolicy") ||
    actor === "Hermes" ||
    event.step === "hermes_delegated" ||
    !actor
  ) {
    return "system";
  }
  return "seller";
}

function isFailureStep(step: string) {
  return (
    step === "payment_failed" ||
    step === "run_failed" ||
    step === "hermes_approval_denied" ||
    step === "payment_denied" ||
    step === "policy_denied" ||
    step === "onchain_policy_denied" ||
    step === "onchain_policy_rejected"
  );
}

function isSuccessStep(step: string) {
  return (
    step === "run_completed" ||
    step === "payment_settled" ||
    step === "order_fulfilled" ||
    step === "hermes_approval_granted" ||
    step === "onchain_policy_authorized" ||
    step === "onchain_policy_approved" ||
    step === "onchain_policy_settled"
  );
}

function HermesWaitingCard({ sinceMs }: { sinceMs: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - sinceMs) / 1000));
  const msgIdx = Math.min(Math.floor(elapsedSec / 3), WAIT_MESSAGES.length - 1);
  const msg = WAIT_MESSAGES[msgIdx]!;
  const pct = Math.min(90, 10 + elapsedSec * 5);

  return (
    <div className="flex justify-center px-2 py-1">
      <div className="w-full max-w-[90%] overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50/50 px-3 py-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            <Sparkles className="h-3 w-3 animate-pulse" />
            Hermes working
          </div>
          <span className="tabular-nums text-[10px] text-slate-400">{elapsedSec}s</span>
        </div>
        <div className="mb-2 flex items-center gap-2 text-sm text-slate-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-600" />
          <span>{msg}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-violet-100">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-[width] duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          First reply can take a few seconds while Hermes loads the profile and model.
        </p>
      </div>
    </div>
  );
}

function HermesToolCard({ event, phase }: { event: RunEvent; phase: ToolPhase }) {
  const name = toolNameFromEvent(event);
  const isAgntpymt = name.startsWith("agntpymt_");

  return (
    <div className="flex justify-center px-2 py-1">
      <div
        className={`w-full max-w-[90%] overflow-hidden rounded-xl border shadow-sm ${
          phase === "failed"
            ? "border-red-200 bg-gradient-to-br from-red-50 to-white"
            : phase === "calling"
              ? "border-violet-200 bg-gradient-to-br from-violet-50 via-white to-cyan-50/40"
              : "border-emerald-200/80 bg-gradient-to-br from-slate-50 via-white to-emerald-50/50"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-100/80 px-3 py-1.5">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">
            <Sparkles className="h-3 w-3" />
            Hermes tool
            {isAgntpymt && (
              <span className="rounded-full bg-cyan-100 px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-cyan-800">
                AgntPymt MCP
              </span>
            )}
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              phase === "calling"
                ? "bg-violet-100 text-violet-800"
                : phase === "failed"
                  ? "bg-red-100 text-red-700"
                  : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {phase === "calling" && <Loader2 className="h-3 w-3 animate-spin" />}
            {phase === "completed" && <CheckCircle2 className="h-3 w-3" />}
            {phase === "failed" && <XCircle className="h-3 w-3" />}
            {phase === "calling" ? "Calling" : phase === "failed" ? "Failed" : "Done"}
          </div>
        </div>
        <div className="flex items-start gap-2.5 px-3 py-2.5">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
            <Wrench className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <code className="block truncate font-mono text-sm font-semibold text-slate-800">{name}</code>
            {phase === "calling" && (
              <p className="mt-0.5 text-xs text-slate-500">
                Running… negotiation / payment steps may appear below while this finishes.
              </p>
            )}
            {phase === "completed" && (
              <p className="mt-0.5 text-xs text-emerald-700">Tool finished successfully</p>
            )}
            {phase === "failed" && (
              <p className="mt-0.5 text-xs text-red-600">
                {typeof event.payload?.error === "string" && event.payload.error !== "true"
                  ? event.payload.error
                  : "Tool returned an error"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({
  event,
  role,
  agentName,
  onHermesApproval,
  approvalResolved,
}: {
  event: RunEvent;
  role: ChatRole;
  agentName?: string;
  onHermesApproval?: (approvalId: string, choice: "approve" | "deny") => void | Promise<void>;
  approvalResolved?: boolean;
}) {
  if (role === "hermes_tool") {
    return <HermesToolCard event={event} phase={toolPhase(event)} />;
  }

  const label = STEP_LABELS[event.step] ?? event.step.replace(/_/g, " ");
  const failed = isFailureStep(event.step);
  const success = isSuccessStep(event.step);
  const pendingApproval =
    (event.step === "hermes_approval" || event.step === "payment_pending") && !approvalResolved;
  const approvalId =
    typeof event.payload?.approvalId === "string" ? event.payload.approvalId : undefined;
  const txHash = txHashFromEvent(event);
  const isHermesSystem = event.step === "hermes_delegated" || event.actor === "Hermes";

  if (role === "system") {
    return (
      <div className="flex justify-center px-2 py-1">
        <div
          className={`max-w-[90%] rounded-2xl px-3 py-2 text-center text-xs ${
            failed
              ? "border border-red-200 bg-red-50 text-red-800"
              : success
                ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                : pendingApproval
                  ? "border border-amber-200 bg-amber-50 text-amber-900"
                  : isHermesSystem
                    ? "border border-violet-200 bg-violet-50 text-violet-900"
                    : "border border-slate-200 bg-white text-slate-600"
          }`}
        >
          <div className="mb-0.5 flex items-center justify-center gap-1 font-semibold uppercase tracking-wide">
            {failed && <AlertCircle className="h-3 w-3" />}
            {success && <CheckCircle2 className="h-3 w-3" />}
            {pendingApproval && <AlertCircle className="h-3 w-3 text-amber-600" />}
            {isHermesSystem && !failed && !success && <Sparkles className="h-3 w-3 text-violet-600" />}
            {event.step === "policy_evaluated" && <Scale className="h-3 w-3" />}
            {label}
          </div>
          <div className="text-left text-sm leading-snug">
            <ChatMarkdown text={event.message} />
          </div>
          {pendingApproval && approvalId && onHermesApproval && (
            <div className="mt-2 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => void onHermesApproval(approvalId, "deny")}
                className="rounded-lg border border-red-200 bg-white px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => void onHermesApproval(approvalId, "approve")}
                className="btn-primary-xs"
              >
                {event.step === "payment_pending" ? "Approve payment" : "Approve once"}
              </button>
            </div>
          )}
          {txHash && (
            <div className="text-left">
              <TxHashLink txHash={txHash} />
            </div>
          )}
        </div>
      </div>
    );
  }

  const isBuyer = role === "buyer";
  const isUser = event.step === "user_message" || event.actor === "You";
  const isHermesAgent = event.step === "hermes_message";

  return (
    <div className={`flex gap-2 px-1 py-1 ${isBuyer ? "flex-row-reverse" : "flex-row"}`}>
      <div
        className={
          isBuyer
            ? "icon-well-round h-8 w-8 shrink-0 text-accent-cyan"
            : "icon-well-round h-8 w-8 shrink-0 text-accent-navy"
        }
      >
        {isBuyer ? <Bot className="h-4 w-4" /> : <Store className="h-4 w-4" />}
      </div>

      <div className={`max-w-[85%] ${isBuyer ? "items-end" : "items-start"} flex flex-col`}>
        <div
          className={`mb-0.5 flex items-center gap-1.5 text-[11px] font-medium ${
            isBuyer ? "flex-row-reverse text-right text-accent-cyan" : "text-accent-navy"
          }`}
        >
          <span>
            {isUser ? "You" : isBuyer ? "Your agent" : "Vendor"}
            {!isUser && event.actor && event.actor !== agentName && event.actor !== "Hermes" && (
              <span className="text-slate-400"> · {event.actor}</span>
            )}
          </span>
          {isHermesAgent && isBuyer && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-violet-700">
              <Sparkles className="h-2.5 w-2.5" />
              Hermes
            </span>
          )}
        </div>
        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-snug shadow-sm ${
            isBuyer
              ? "rounded-tr-sm bg-accent-cyan text-white"
              : "rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-800"
          }`}
        >
          {!isUser && (
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide opacity-70">
              {label}
            </span>
          )}
          <ChatMarkdown text={event.message} tone={isBuyer ? "inverse" : "neutral"} />
          {txHash && (
            <div className={isBuyer ? "text-white/80" : ""}>
              <TxHashLink txHash={txHash} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Props = {
  events: RunEvent[];
  agentName?: string;
  emptyMessage?: string;
  live?: boolean;
  onHermesApproval?: (approvalId: string, choice: "approve" | "deny") => void | Promise<void>;
};

export function RunChatFeed({ events, agentName, emptyMessage, live, onHermesApproval }: Props) {
  const collapsed = useMemo(() => collapseToolEvents(events), [events]);
  const visible = collapsed.filter((e) => e.step !== "run_started" || collapsed.length <= 2);

  const resolvedApprovalIds = new Set(
    events
      .filter(
        (e) =>
          e.step === "hermes_approval_granted" ||
          e.step === "hermes_approval_denied" ||
          e.step === "payment_denied" ||
          e.step === "payment_settled" ||
          e.step === "payment_simulated" ||
          e.step === "order_fulfilled"
      )
      .map((e) => e.payload?.approvalId)
      .filter((id): id is string => typeof id === "string")
  );

  const delegatedIdx = events.findIndex((e) => e.step === "hermes_delegated");
  const delegated = delegatedIdx >= 0 ? events[delegatedIdx] : undefined;
  const activityAfterDelegate =
    delegatedIdx >= 0 &&
    events.slice(delegatedIdx + 1).some(
      (e) =>
        e.step === "hermes_message" ||
        e.step === "hermes_tool" ||
        e.step === "hermes_approval" ||
        e.step === "run_completed" ||
        e.step === "run_failed" ||
        e.step === "local_runner"
    );
  const showWaiting = Boolean(live && delegated && !activityAfterDelegate);
  const waitSince = delegated ? new Date(delegated.createdAt).getTime() || Date.now() : Date.now();

  if (visible.length === 0 && !showWaiting) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-4 text-center">
        <div className="mb-3 flex gap-3">
          <div className="icon-well-round h-10 w-10">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex items-center text-slate-300">↔</div>
          <div className="icon-well-round h-10 w-10 text-accent-navy">
            <Store className="h-5 w-5" />
          </div>
        </div>
        <p className="text-sm text-slate-400">
          {emptyMessage ?? "Agent runs stream here — Hermes replies, tools, and payment steps."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 py-2">
      {visible.map((e, i) => {
        const approvalId =
          typeof e.payload?.approvalId === "string" ? e.payload.approvalId : undefined;
        return (
          <ChatBubble
            key={`${e.createdAt}-${e.step}-${i}`}
            event={e}
            role={classifyEvent(e, agentName)}
            agentName={agentName}
            onHermesApproval={onHermesApproval}
            approvalResolved={approvalId ? resolvedApprovalIds.has(approvalId) : false}
          />
        );
      })}
      {showWaiting && <HermesWaitingCard sinceMs={waitSince} />}
    </div>
  );
}

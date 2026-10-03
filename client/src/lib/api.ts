export const apiBase = import.meta.env.VITE_API_URL ?? "";

let tokenGetter: (() => Promise<string | null>) | null = null;

export function setApiTokenGetter(fn: (() => Promise<string | null>) | null) {
  tokenGetter = fn;
}

export function apiUrl(path: string): string {
  return new URL(path, apiBase || window.location.origin).toString();
}

export async function apiUrlWithAuth(path: string): Promise<string> {
  const url = new URL(path, apiBase || window.location.origin);
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) url.searchParams.set("__clerk_token", token);
  }
  return url.toString();
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders({
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  });

  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? res.statusText);
  }
  return res.json();
}

export async function downloadPaymentsCsv(): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(apiUrl("/api/transactions/export"), { headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? res.statusText);
  }
  const blob = await res.blob();
  const stamp = new Date().toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `agntpymt-payments-${stamp}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function parseSseChunk(chunk: string, onEvent: (data: string) => void) {
  for (const line of chunk.split("\n")) {
    if (line.startsWith("data: ")) {
      onEvent(line.slice(6));
    }
  }
}

/** Fetch-based SSE — supports Authorization headers (unlike EventSource). */
export async function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const headers = await authHeaders({ Accept: "text/event-stream" });
  const res = await fetch(apiUrl(`/api/agent/run/${runId}/events`), { headers, signal });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(body || `Run stream failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error("Run stream returned an invalid response — check API URL and sign-in status.");
  }

  if (!res.body) throw new Error("Run stream has no body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      parseSseChunk(part, (data) => {
        onEvent(JSON.parse(data) as RunEvent);
      });
    }
  }

  if (buffer.trim()) {
    parseSseChunk(buffer, (data) => {
      onEvent(JSON.parse(data) as RunEvent);
    });
  }
}

export type DashboardData = {
  kpis: {
    totalBalanceUsd: number;
    activeAgents: string;
    pendingApprovals: number;
    spend30DaysUsd: number;
    hermesProfilesProvisioned?: number;
  };
  agents: Agent[];
  pendingApprovals: Approval[];
  recentTransactions: Transaction[];
  activeWallets: number;
};

export type AgentPolicy = {
  agentId: string;
  autoApproveLimitUsd: number;
  requireWalletConfirmation: boolean;
  autoSettlementEnabled: boolean;
  negotiationRules: string | null;
  dailyAggregateCapUsd: number | null;
};

export type PolicyRow = {
  agentId: string;
  agentName: string;
  category: string;
  status: string;
  iconColor: string;
  policy: AgentPolicy;
  dailySpendUsd: number;
  orgCeilingUsd: number | null;
};

export type OrgSettings = {
  agentsPaused: boolean;
  maxExposureLimitUsd: number | null;
};

export type Agent = {
  id: string;
  name: string;
  category: string;
  description: string | null;
  status: string;
  iconColor: string;
  walletAddress: string | null;
  balanceUsd: number;
  hermesProvisioned?: boolean;
  hermesProfileName?: string | null;
  hermesSkillCount?: number;
  hermesMcpCount?: number;
};

export type HermesSkill = {
  id: string;
  name: string;
  description: string;
  content: string;
};

export type HermesMcpServer = {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  protected?: boolean;
};

export type HermesCapabilities = {
  skills: HermesSkill[];
  mcpServers: HermesMcpServer[];
};

export type HermesProfileStatus = {
  profileName: string;
  profilePath: string;
  provisioned: boolean;
  soul: string;
  capabilities: HermesCapabilities;
};

export type Approval = {
  id: string;
  agentId: string;
  runId?: string | null;
  vendorName: string;
  amountUsd: number;
  reason: string;
  status: string;
  kind?: string;
  toolName?: string | null;
  hermesRunId?: string | null;
  requestedAt: string;
};

export type RunHistory = {
  runId: string;
  status: string;
  agentId: string;
  prompt: string;
  events: RunEvent[];
};

export type Transaction = {
  id: string;
  runId: string | null;
  agentId: string;
  agentName: string;
  vendorName: string;
  description: string;
  amountUsd: number;
  status: string;
  txHash: string | null;
  feedbackTxHash: string | null;
  policyTxHash: string | null;
  createdAt: string;
};

export type RunEvent = {
  runId: string;
  step: string;
  message: string;
  actor?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
};

export type Erc8004AgentStatus = {
  lifecycle: "none" | "registered" | "complete";
  agentId: string | null;
  registerTx: string | null;
  uriTx: string | null;
  walletTx: string | null;
  registeredAt: string | null;
  treasuryAddress: string | null;
  identityRegistry: string;
  onChain: {
    agentId: string;
    owner: string | null;
    tokenUri: string | null;
    verifiedWallet: string | null;
    walletMatches: boolean;
  } | null;
  registration: Record<string, unknown> | null;
  registrationUri: string | null;
  reputation: { count: number; summaryValue: number; valueDecimals: number } | null;
  nextStep: "connect_treasury" | "register" | "set_uri" | "link_wallet" | "done";
};

export type HealthData = {
  status: string;
  daemon: string;
  hermesProfilesProvisioned?: number;
  hermesProfilesTotal?: number;
  simulatePayments: boolean;
  paymentMode?: string;
  facilitatorUrl?: string;
  demoTransactionFeeUsd?: number;
  aiNegotiation?: boolean;
  network: string;
  vendorPayToAddress?: string | null;
  erc8004IdentityRegistry?: string;
};

export type AgentWalletRow = {
  id: string;
  name: string;
  category: string;
  iconColor: string;
  status: string;
  walletAddress: string | null;
  walletProvisioned: boolean;
  ledgerBalanceUsd: number;
  onChain: { eth: number; usdc: number };
};

export type WalletsOverview = {
  network: string;
  treasury: { address: string; balances: { eth: number; usdc: number } | null } | null;
  agents: AgentWalletRow[];
};

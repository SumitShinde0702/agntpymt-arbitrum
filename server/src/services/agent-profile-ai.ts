import { env } from "../config.js";

export type AgentProfileSuggestion = {
  name: string;
  category: string;
  description: string;
  iconColor: "violet" | "blue" | "green" | "orange";
  negotiationRules: string;
  autoApproveLimitUsd: number;
};

const VALID_COLORS = new Set(["violet", "blue", "green", "orange"]);

function keywordFallback(prompt: string): AgentProfileSuggestion {
  const lower = prompt.toLowerCase();

  if (/travel|flight|hotel|booking/.test(lower)) {
    return {
      name: "Travel Agent",
      category: "travel",
      description: prompt.trim(),
      iconColor: "green",
      negotiationRules:
        "You book travel. Negotiate politely — aim for the lowest fare but accept vendor floor prices when reasonable.",
      autoApproveLimitUsd: 0.05,
    };
  }
  if (/procure|office|supplies|vendor|order/.test(lower)) {
    return {
      name: "Procurement Agent",
      category: "procurement",
      description: prompt.trim(),
      iconColor: "blue",
      negotiationRules:
        "You procure supplies and services. Prefer instant buys at list price when under $0.02. Be concise and cost-conscious.",
      autoApproveLimitUsd: 0.05,
    };
  }
  if (/cloud|aws|azure|gcp|infrastructure|invoice/.test(lower)) {
    return {
      name: "Cloud Ops Agent",
      category: "cloud",
      description: prompt.trim(),
      iconColor: "orange",
      negotiationRules:
        "You pay cloud invoices. Negotiate firmly on large quotes. Anything above the auto-approve limit must escalate to a human.",
      autoApproveLimitUsd: 0.05,
    };
  }
  if (/research|market|data|report|intelligence/.test(lower)) {
    return {
      name: "Research Agent",
      category: "research",
      description: prompt.trim(),
      iconColor: "violet",
      negotiationRules:
        "You buy sector research and market data. Counter at the micro-payment target ($0.01) when quotes are above that. Stay under the auto-approve limit unless the data is critical.",
      autoApproveLimitUsd: 0.05,
    };
  }

  const words = prompt.trim().split(/\s+/).slice(0, 3);
  const name = words.length ? `${words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ")} Agent` : "Custom Agent";

  return {
    name,
    category: "custom",
    description: prompt.trim(),
    iconColor: "violet",
    negotiationRules:
      "Follow the user's spending policy. Prefer micro-payments when possible. Escalate purchases above the auto-approve limit.",
    autoApproveLimitUsd: 0.05,
  };
}

function parseSuggestion(raw: string, prompt: string): AgentProfileSuggestion {
  const fallback = keywordFallback(prompt);
  try {
    const parsed = JSON.parse(raw) as Partial<AgentProfileSuggestion>;
    const iconColor = VALID_COLORS.has(parsed.iconColor ?? "")
      ? (parsed.iconColor as AgentProfileSuggestion["iconColor"])
      : fallback.iconColor;

    return {
      name: typeof parsed.name === "string" && parsed.name.trim() ? parsed.name.trim() : fallback.name,
      category:
        typeof parsed.category === "string" && parsed.category.trim()
          ? parsed.category.trim().toLowerCase().replace(/\s+/g, "_")
          : fallback.category,
      description:
        typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim()
          : fallback.description,
      iconColor,
      negotiationRules:
        typeof parsed.negotiationRules === "string" && parsed.negotiationRules.trim()
          ? parsed.negotiationRules.trim()
          : fallback.negotiationRules,
      autoApproveLimitUsd:
        typeof parsed.autoApproveLimitUsd === "number" && parsed.autoApproveLimitUsd > 0
          ? parsed.autoApproveLimitUsd
          : fallback.autoApproveLimitUsd,
    };
  } catch {
    return fallback;
  }
}

export async function suggestAgentProfile(prompt: string): Promise<AgentProfileSuggestion> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new Error("Describe what you want the agent to do.");
  }

  const fallback = keywordFallback(trimmed);
  if (!env.openaiApiKey) {
    return fallback;
  }

  const system = `You help users configure autonomous payment agents for a USDC commerce demo on Arbitrum.
Given a short description of what the agent should do, return ONLY valid JSON (no markdown) with these fields:
- name: string — display name like "Research Agent"
- category: string — lowercase slug like research, procurement, travel, cloud, or a custom slug
- description: string — one sentence summary of the agent's role
- iconColor: one of "violet", "blue", "green", "orange"
- negotiationRules: string — 1-2 sentences instructing how the agent should negotiate purchases and when to escalate
- autoApproveLimitUsd: number — typical 0.02 to 0.10 for micro-payments`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.5,
        max_tokens: 400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `User wants an agent that: ${trimmed}` },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("OpenAI agent profile failed:", await res.text());
      return fallback;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback;

    return parseSuggestion(text, trimmed);
  } catch (err) {
    console.warn("OpenAI agent profile error:", err);
    return fallback;
  }
}

export type SoulSuggestion = {
  title: string;
  role: string;
  behavior: string;
  payment: string;
  negotiation: string;
  notes: string;
};

const DEFAULT_SOUL_PAYMENT =
  "When a task requires spending money, use the `agntpymt_initiate_purchase` MCP tool.\n" +
  "Respect auto-approve limits and negotiation rules. Never bypass human approval when required.";

function soulKeywordFallback(
  prompt: string,
  agentName: string,
  category?: string
): SoulSuggestion {
  const lower = `${prompt} ${category ?? ""}`.toLowerCase();
  const name = agentName.trim() || "Agent";

  if (/research|market|data|intel|report/.test(lower)) {
    return {
      title: name,
      role: `You are **${name}**, a research buyer agent in the AgntPymt fleet.\nYou purchase sector research, market data, and intelligence reports on behalf of the organization.\nFocus: ${prompt.trim()}`,
      behavior:
        "Be precise and cost-conscious. Prefer reputable data vendors. Summarize what you bought and why it matters.",
      payment: DEFAULT_SOUL_PAYMENT,
      negotiation:
        "Counter at the micro-payment target ($0.01) when quotes are above that. Stay under the auto-approve limit unless the data is critical.",
      notes: "",
    };
  }
  if (/procure|supply|vendor|office|order/.test(lower)) {
    return {
      title: name,
      role: `You are **${name}**, a procurement agent in the AgntPymt fleet.\nYou buy supplies and services for the organization.\nFocus: ${prompt.trim()}`,
      behavior: "Be concise and practical. Prefer instant buys at list price when under policy limits.",
      payment: DEFAULT_SOUL_PAYMENT,
      negotiation:
        "Prefer instant buys at list price when under $0.02. Negotiate only when the quote is clearly inflated.",
      notes: "",
    };
  }
  if (/cloud|aws|azure|gcp|infra|invoice/.test(lower)) {
    return {
      title: name,
      role: `You are **${name}**, a cloud operations agent in the AgntPymt fleet.\nYou pay cloud invoices and infrastructure fees.\nFocus: ${prompt.trim()}`,
      behavior: "Be firm on large quotes. Flag unusual spend. Keep a clear audit trail of what was paid.",
      payment: DEFAULT_SOUL_PAYMENT,
      negotiation:
        "Negotiate firmly on large quotes. Anything above the auto-approve limit must escalate to a human.",
      notes: "",
    };
  }
  if (/travel|flight|hotel|booking/.test(lower)) {
    return {
      title: name,
      role: `You are **${name}**, a travel booking agent in the AgntPymt fleet.\nYou book flights, hotels, and related travel services.\nFocus: ${prompt.trim()}`,
      behavior: "Negotiate politely. Prefer policy-compliant options. Confirm itinerary details before paying.",
      payment: DEFAULT_SOUL_PAYMENT,
      negotiation:
        "Aim for the lowest fare but accept vendor floor prices when reasonable. Escalate luxury or out-of-policy bookings.",
      notes: "",
    };
  }

  return {
    title: name,
    role: `You are **${name}**, an autonomous agent in the AgntPymt fleet.\n${prompt.trim()}`,
    behavior: "Follow spending policy. Prefer micro-payments. Escalate when unsure.",
    payment: DEFAULT_SOUL_PAYMENT,
    negotiation:
      "Follow the user's spending policy. Prefer micro-payments when possible. Escalate purchases above the auto-approve limit.",
    notes: "",
  };
}

function parseSoulSuggestion(
  raw: string,
  prompt: string,
  agentName: string,
  category?: string
): SoulSuggestion {
  const fallback = soulKeywordFallback(prompt, agentName, category);
  try {
    const parsed = JSON.parse(raw) as Partial<SoulSuggestion>;
    return {
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : fallback.title,
      role:
        typeof parsed.role === "string" && parsed.role.trim() ? parsed.role.trim() : fallback.role,
      behavior:
        typeof parsed.behavior === "string" && parsed.behavior.trim()
          ? parsed.behavior.trim()
          : fallback.behavior,
      payment:
        typeof parsed.payment === "string" && parsed.payment.trim()
          ? parsed.payment.trim()
          : fallback.payment,
      negotiation:
        typeof parsed.negotiation === "string" && parsed.negotiation.trim()
          ? parsed.negotiation.trim()
          : fallback.negotiation,
      notes: typeof parsed.notes === "string" ? parsed.notes.trim() : "",
    };
  } catch {
    return fallback;
  }
}

export async function suggestSoulProfile(input: {
  prompt: string;
  agentName: string;
  category?: string;
}): Promise<SoulSuggestion> {
  const trimmed = input.prompt.trim();
  if (!trimmed) {
    throw new Error("Describe how this agent should behave.");
  }

  const fallback = soulKeywordFallback(trimmed, input.agentName, input.category);
  if (!env.openaiApiKey) {
    return fallback;
  }

  const system = `You write SOUL.md content for autonomous payment agents on AgntPymt (USDC micro-payments on Arbitrum).
Return ONLY valid JSON (no markdown) with:
- title: string — short display name (usually keep the existing agent name)
- role: string — 2-4 sentences: who the agent is and what it buys (markdown ok, use **bold** for the name)
- behavior: string — 1-3 sentences on tone, priorities, and how it should act
- payment: string — how it spends; must mention using agntpymt_initiate_purchase MCP tool and respecting auto-approve / human approval
- negotiation: string — 1-2 sentences on pricing strategy and when to escalate
- notes: string — optional extra instructions, or empty string

Agent name: ${input.agentName}
Category: ${input.category ?? "custom"}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.5,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: `Write a SOUL for an agent that: ${trimmed}` },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("OpenAI soul suggest failed:", await res.text());
      return fallback;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback;

    return parseSoulSuggestion(text, trimmed, input.agentName, input.category);
  } catch (err) {
    console.warn("OpenAI soul suggest error:", err);
    return fallback;
  }
}

import { env } from "../config.js";
import { formatUsdc } from "../simulation/pricing.js";

export type TranscriptLine = {
  role: "buyer" | "seller";
  speaker: string;
  text: string;
};

export type NegotiationContext = {
  kind:
    | "purchase_intent"
    | "seller_greeting"
    | "buyer_clarify"
    | "seller_quote"
    | "buyer_counter"
    | "seller_response"
    | "order_fulfilled";
  transcript: TranscriptLine[];
  agentName: string;
  agentDescription?: string | null;
  vendorName: string;
  vendorDescription?: string | null;
  purchaseIntent: string;
  quotedPriceUsd?: number;
  counterOfferUsd?: number;
  finalPriceUsd?: number;
  vendorAccepted?: boolean;
  autoApproveLimitUsd: number;
  targetFeeUsd: number;
  negotiationRules?: string | null;
  fulfillmentSummary?: string;
};

const FALLBACKS: Record<NegotiationContext["kind"], (ctx: NegotiationContext) => string> = {
  purchase_intent: (ctx) =>
    `Hi — I'm looking to ${ctx.purchaseIntent.toLowerCase().replace(/^buy |^order /i, "")}. What can you offer?`,
  seller_greeting: (ctx) =>
    `Hi ${ctx.agentName}, thanks for reaching out. What sector or dataset are you interested in?`,
  buyer_clarify: (ctx) =>
    `I need ${ctx.purchaseIntent.toLowerCase().replace(/^buy /i, "")} — sector overview and key metrics for our research workflow.`,
  seller_quote: (ctx) =>
    `For that package I can do ${formatUsdc(ctx.quotedPriceUsd ?? 0)}. It includes the latest sector overview and supporting data files.`,
  buyer_counter: (ctx) =>
    `That's a bit above our target. Could you do ${formatUsdc(ctx.counterOfferUsd ?? ctx.targetFeeUsd)}?`,
  seller_response: (ctx) =>
    ctx.vendorAccepted
      ? `Agreed — ${formatUsdc(ctx.finalPriceUsd ?? ctx.counterOfferUsd ?? 0)} works. I'll prepare delivery once payment clears.`
      : `I can't match that. Best I can offer is ${formatUsdc(ctx.finalPriceUsd ?? 0)}.`,
  order_fulfilled: (ctx) =>
    `Done — your order is fulfilled. ${ctx.fulfillmentSummary ?? "Delivery details are in the receipt."}`,
};

const KIND_INSTRUCTIONS: Record<NegotiationContext["kind"], string> = {
  purchase_intent: "Write the BUYER's opening message to the vendor.",
  seller_greeting:
    "Write the SELLER's reply to the buyer's opening. Welcome them and ask a specific follow-up question. Do NOT quote a price yet.",
  buyer_clarify:
    "Write the BUYER's reply to the seller's question. Be specific about what they want based on the purchase request.",
  seller_quote:
    "Write the SELLER's message with a clear price quote for what the buyer asked for.",
  buyer_counter: "Write the BUYER's counter-offer in response to the seller's quote.",
  seller_response:
    "Write the SELLER's reply to the buyer's counter — accept or hold firm per vendorAccepted in context.",
  order_fulfilled: "Write the SELLER's brief delivery confirmation.",
};

function formatTranscript(transcript: TranscriptLine[]): string {
  if (transcript.length === 0) return "(no messages yet)";
  return transcript.map((line) => `${line.speaker} (${line.role}): ${line.text}`).join("\n");
}

function buildPrompt(ctx: NegotiationContext): { system: string; user: string } {
  const rules =
    ctx.negotiationRules?.trim() ||
    `Prefer micro-payments near ${formatUsdc(ctx.targetFeeUsd)}. Auto-approve limit is ${formatUsdc(ctx.autoApproveLimitUsd)}.`;

  const system = `You write one chat message for an AI agent commerce demo (1-2 sentences).
Payments are in USDC on Arbitrum. Sound like a real business chat — respond directly to what the other party just said.
Do not repeat yourself. Do not ignore questions. No markdown, no role labels, no quotes around the message.

Buyer agent rules (when writing as buyer):
${rules}

When writing as seller: be commercial, answer questions, then quote when asked.`;

  const facts: Record<string, unknown> = {
    purchaseRequest: ctx.purchaseIntent,
    targetFeeUsd: ctx.targetFeeUsd,
    autoApproveLimitUsd: ctx.autoApproveLimitUsd,
  };

  if (ctx.quotedPriceUsd != null) facts.quotedPriceUsd = ctx.quotedPriceUsd;
  if (ctx.counterOfferUsd != null) facts.counterOfferUsd = ctx.counterOfferUsd;
  if (ctx.finalPriceUsd != null) facts.finalPriceUsd = ctx.finalPriceUsd;
  if (ctx.vendorAccepted != null) facts.vendorAccepted = ctx.vendorAccepted;
  if (ctx.fulfillmentSummary) facts.fulfillmentSummary = ctx.fulfillmentSummary;

  const user = `${KIND_INSTRUCTIONS[ctx.kind]}

Conversation so far:
${formatTranscript(ctx.transcript)}

Facts for this turn:
${JSON.stringify(facts, null, 2)}

Reply with only the next chat message text.`;

  return { system, user };
}

export async function generateNegotiationMessage(ctx: NegotiationContext): Promise<string> {
  const fallback = FALLBACKS[ctx.kind](ctx);

  if (!env.openaiApiKey) {
    return fallback;
  }

  try {
    const { system, user } = buildPrompt(ctx);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: env.openaiModel,
        temperature: 0.7,
        max_tokens: 150,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      console.warn("OpenAI negotiation failed:", await res.text());
      return fallback;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) return fallback;

    return text.replace(/^["']|["']$/g, "");
  } catch (err) {
    console.warn("OpenAI negotiation error:", err);
    return fallback;
  }
}

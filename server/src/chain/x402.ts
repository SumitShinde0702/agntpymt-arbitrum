import type { RequestHandler } from "express";
import { eq, getDb, schema } from "@agntpymt/db";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactEvmScheme as ExactEvmServerScheme } from "@x402/evm/exact/server";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../config.js";
import { SETTLEMENT_CHAIN_NAME, X402_NETWORK } from "./network.js";
import { fetchWalletBalances, gasShortfallMessage } from "./wallet.js";

export { X402_NETWORK };

/** Shown when OpenX402 facilitator requires payTo registration (not needed for x402.org / CDP). */
export const OPENX402_REGISTER_URL = "https://openx402.ai/register";

const pendingSettlementPrices = new Map<string, number>();

function decodePaymentRequiredHeader(header: string | null): { error?: string } | null {
  if (!header) return null;
  try {
    const json = Buffer.from(header, "base64").toString("utf8");
    return JSON.parse(json) as { error?: string };
  } catch {
    return null;
  }
}

export function formatX402Failure(
  status: number,
  body: string,
  headers: { get(name: string): string | null }
): string {
  const paymentRequired =
    decodePaymentRequiredHeader(headers.get("PAYMENT-REQUIRED")) ??
    decodePaymentRequiredHeader(headers.get("X-PAYMENT-REQUIRED"));
  const code = paymentRequired?.error;

  if (code === "address_not_registered") {
    return (
      `Vendor wallet ${env.evmPayToAddress} is not registered with the x402 facilitator. ` +
      `Register it at ${OPENX402_REGISTER_URL} to restore x402 USDC settlement.`
    );
  }

  const paymentResponse =
    headers.get("PAYMENT-RESPONSE") ?? headers.get("X-PAYMENT-RESPONSE");
  const detail = body.trim() || paymentResponse || code || "facilitator rejected payment";
  return `x402 settlement failed (${status}): ${detail}`;
}

export async function checkPayToWhitelisted(payTo = env.evmPayToAddress): Promise<boolean> {
  if (!payTo || !env.facilitatorUrl.includes("openx402")) return true;
  try {
    const res = await fetch(`${env.facilitatorUrl}/whitelist/${payTo}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return true;
    const data = (await res.json()) as { whitelisted?: boolean };
    return data.whitelisted === true;
  } catch {
    return true;
  }
}

export async function warnIfPayToNotWhitelisted(): Promise<void> {
  if (env.simulatePayments || !env.evmPayToAddress) return;
  const ok = await checkPayToWhitelisted();
  if (!ok) {
    console.warn(
      `[x402] EVM_PAY_TO_ADDRESS ${env.evmPayToAddress} is not whitelisted at ${env.facilitatorUrl}.\n` +
        `       x402 USDC payments will fail until you register at ${OPENX402_REGISTER_URL}`
    );
  }
}

function sessionIdFromPath(path: string): string | null {
  const match = path.match(/\/api\/x402\/vendor\/settle\/([^/]+)$/);
  return match?.[1] ?? null;
}

function usdToX402Price(amountUsd: number): string {
  if (amountUsd < 0.01) return `$${amountUsd.toFixed(4)}`;
  return `$${amountUsd.toFixed(2)}`;
}

export function registerPendingX402Settlement(sessionId: string, amountUsd: number) {
  pendingSettlementPrices.set(sessionId, amountUsd);
}

export function clearPendingX402Settlement(sessionId: string) {
  pendingSettlementPrices.delete(sessionId);
}

async function resolveSettlementPrice(path: string): Promise<string> {
  const sessionId = sessionIdFromPath(path);
  if (!sessionId) {
    throw new Error("Invalid x402 settlement path");
  }

  const pending = pendingSettlementPrices.get(sessionId);
  if (pending != null) {
    return usdToX402Price(pending);
  }

  const db = getDb();
  const [session] = await db
    .select()
    .from(schema.sellerSessions)
    .where(eq(schema.sellerSessions.id, sessionId));

  if (session?.finalPriceUsd == null) {
    throw new Error(`No settlement price for session ${sessionId}`);
  }

  return usdToX402Price(session.finalPriceUsd);
}

async function assertFacilitatorReady(): Promise<void> {
  const client = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
  try {
    await client.getSupported();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Facilitator at ${env.facilitatorUrl} failed (${detail}). ` +
        `The facilitator must support ${X402_NETWORK} (${SETTLEMENT_CHAIN_NAME}), e.g. FACILITATOR_URL=https://facilitator.payai.network, or set SIMULATE_PAYMENTS=true`
    );
  }
}

/** Load x402 middleware only in live payment mode — avoids facilitator crash when simulating. */
export async function createX402Middleware(): Promise<RequestHandler> {
  await assertFacilitatorReady();

  const facilitatorClient = new HTTPFacilitatorClient({ url: env.facilitatorUrl });
  const resourceServer = new x402ResourceServer(facilitatorClient).register(
    X402_NETWORK,
    new ExactEvmServerScheme()
  );

  return paymentMiddleware(
    {
      "POST /api/x402/vendor/settle/*": {
        accepts: {
          scheme: "exact",
          network: X402_NETWORK,
          payTo: env.evmPayToAddress || "0x0000000000000000000000000000000000000000",
          price: (context) => resolveSettlementPrice(context.path),
        },
        description: "Vendor fulfillment settlement (x402)",
        mimeType: "application/json",
      },
    },
    resourceServer
  );
}

const MIN_GAS_ETH = 0.00005;

export async function settleViaX402(
  privateKey: `0x${string}`,
  sessionId: string,
  amountUsd: number
): Promise<{ txHash: string; from: string }> {
  const account = privateKeyToAccount(privateKey);
  const balances = await fetchWalletBalances(account.address);

  if (balances.eth < MIN_GAS_ETH) {
    throw new Error(gasShortfallMessage(account.address, balances.eth));
  }

  if (balances.usdc < amountUsd) {
    throw new Error(
      `Insufficient USDC on agent wallet (has ${balances.usdc.toFixed(2)}, need ${amountUsd.toFixed(2)})`
    );
  }

  registerPendingX402Settlement(sessionId, amountUsd);

  try {
    const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
      schemes: [
        {
          network: "eip155:*",
          client: new ExactEvmScheme(account),
        },
      ],
    });

    const url = `http://127.0.0.1:${env.port}/api/x402/vendor/settle/${sessionId}`;
    const response = await fetchWithPayment(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      let detail = formatX402Failure(response.status, body, response.headers);
      if (response.status === 402) {
        detail += ` Agent wallet ${account.address} has ${balances.usdc.toFixed(4)} USDC and ${balances.eth.toFixed(6)} ETH on ${SETTLEMENT_CHAIN_NAME} — fund both on the Wallets page if low.`;
      }
      throw new Error(detail);
    }

    const paymentResponseHeader = response.headers.get("PAYMENT-RESPONSE");
    if (!paymentResponseHeader) {
      throw new Error("x402 settlement succeeded but PAYMENT-RESPONSE header was missing");
    }

    const settled = decodePaymentResponseHeader(paymentResponseHeader);
    if (!settled.success || !settled.transaction) {
      throw new Error(settled.errorMessage ?? settled.errorReason ?? "x402 facilitator settlement failed");
    }

    return { txHash: settled.transaction, from: account.address };
  } finally {
    clearPendingX402Settlement(sessionId);
  }
}

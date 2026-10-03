import type { Agent } from "@agntpymt/db";
import { env } from "../../config.js";
import { SETTLEMENT_CHAIN, SETTLEMENT_CHAIN_NAME } from "../network.js";
import {
  ERC8004_REGISTRATION_TYPE,
  erc8004AgentRegistryRef,
} from "./constants.js";

export type Erc8004RegistrationFile = {
  type: typeof ERC8004_REGISTRATION_TYPE;
  name: string;
  description: string;
  x402Support: boolean;
  active: boolean;
  services: Array<{ name: string; endpoint: string; version?: string }>;
  registrations: Array<{ agentId: number; agentRegistry: string }>;
  supportedTrust: string[];
};

export function buildRegistrationFile(
  agent: Pick<Agent, "name" | "description" | "walletAddress">,
  options?: { agentId?: bigint | number | null; includeWallet?: boolean }
): Erc8004RegistrationFile {
  const agentId = options?.agentId != null ? Number(options.agentId) : null;
  const chainId = SETTLEMENT_CHAIN.id;
  const services: Erc8004RegistrationFile["services"] = [];

  if (options?.includeWallet !== false && agent.walletAddress) {
    services.push({
      name: "agentWallet",
      endpoint: `eip155:${chainId}:${agent.walletAddress}`,
    });
  }

  const mcpBase = env.agntpymtPublicUrl?.replace(/\/$/, "");
  if (mcpBase) {
    services.push({
      name: "MCP",
      endpoint: `${mcpBase}/api/mcp`,
      version: "2025-06-18",
    });
  }

  return {
    type: ERC8004_REGISTRATION_TYPE,
    name: agent.name,
    description: agent.description?.trim() || `${agent.name} — governed agent on AgntPymt (${SETTLEMENT_CHAIN_NAME}).`,
    x402Support: true,
    active: true,
    services,
    registrations:
      agentId != null
        ? [{ agentId, agentRegistry: erc8004AgentRegistryRef() }]
        : [],
    supportedTrust: ["reputation"],
  };
}

export function buildVendorRegistrationFile(
  vendor: Pick<import("@agntpymt/db").Vendor, "name" | "description" | "walletAddress">,
  options?: { agentId?: bigint | number | null }
): Erc8004RegistrationFile {
  const payWallet = vendor.walletAddress ?? env.evmPayToAddress ?? null;
  return buildRegistrationFile(
    {
      name: vendor.name,
      description: vendor.description,
      walletAddress: payWallet,
    },
    { agentId: options?.agentId ?? null, includeWallet: Boolean(payWallet) }
  );
}

export function registrationToDataUri(file: Erc8004RegistrationFile): string {
  const json = JSON.stringify(file);
  const base64 = Buffer.from(json, "utf8").toString("base64");
  return `data:application/json;base64,${base64}`;
}

export function parseDataUriRegistration(uri: string): Erc8004RegistrationFile | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  try {
    const json = Buffer.from(uri.slice(prefix.length), "base64").toString("utf8");
    return JSON.parse(json) as Erc8004RegistrationFile;
  } catch {
    return null;
  }
}

export function hasPublishedRegistrationUri(tokenUri: string | null | undefined): boolean {
  return Boolean(tokenUri && parseDataUriRegistration(tokenUri)?.registrations.length);
}

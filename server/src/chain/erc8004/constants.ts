import type { Address } from "viem";
import { SETTLEMENT_CHAIN } from "../network.js";

/** ERC-8004 testnet singletons (CREATE2, identical on every testnet incl. Arbitrum Sepolia). */
export const ERC8004_IDENTITY_REGISTRY =
  "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const satisfies Address;

export const ERC8004_REPUTATION_REGISTRY =
  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as const satisfies Address;

export const ERC8004_CHAIN = SETTLEMENT_CHAIN;

export const ERC8004_REGISTRATION_TYPE =
  "https://eips.ethereum.org/EIPS/eip-8004#registration-v1" as const;

export function erc8004AgentRegistryRef(): string {
  return `eip155:${ERC8004_CHAIN.id}:${ERC8004_IDENTITY_REGISTRY}`;
}

export const ERC8004_FEEDBACK_TAG_PAYMENT = "payment" as const;
export const ERC8004_FEEDBACK_TAG_X402 = "x402" as const;

/** Successful x402 settlement → 100/100 on-chain score (valueDecimals 0). */
export const ERC8004_PAYMENT_SUCCESS_VALUE = 100;

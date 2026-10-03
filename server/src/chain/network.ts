import { defineChain } from "viem";
import { arbitrumSepolia } from "viem/chains";

/** Primary settlement chain: x402 USDC, ERC-8004 identity/reputation, AgentSpendPolicy. */
export const SETTLEMENT_CHAIN = arbitrumSepolia;
export const SETTLEMENT_CHAIN_NAME = "Arbitrum Sepolia";
export const X402_NETWORK = `eip155:${arbitrumSepolia.id}` as const;
export const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const;
export const EXPLORER_URL = "https://sepolia.arbiscan.io";
export const SETTLEMENT_RPC_URL =
  process.env.ARBITRUM_SEPOLIA_RPC_URL || "https://sepolia-rollup.arbitrum.io/rpc";

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.ROBINHOOD_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: { name: "Robinhood Explorer", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

export function txExplorerUrl(txHash: string): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}

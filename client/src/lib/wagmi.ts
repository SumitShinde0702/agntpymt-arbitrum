import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { arbitrumSepolia } from "viem/chains";

export const USDC_ADDRESS = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as const;

export const wagmiConfig = getDefaultConfig({
  appName: import.meta.env.VITE_APP_NAME ?? "AgntPymt",
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "00000000000000000000000000000000",
  chains: [arbitrumSepolia],
  ssr: false,
});

export const TARGET_CHAIN = arbitrumSepolia;
export const TARGET_CHAIN_NAME = "Arbitrum Sepolia";

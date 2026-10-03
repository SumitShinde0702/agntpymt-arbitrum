import { createPublicClient, createWalletClient, formatUnits, http, parseUnits, type Address, type Hash } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SETTLEMENT_CHAIN, SETTLEMENT_CHAIN_NAME, SETTLEMENT_RPC_URL, USDC_ADDRESS } from "./network.js";

const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const publicClient = createPublicClient({
  chain: SETTLEMENT_CHAIN,
  transport: http(SETTLEMENT_RPC_URL, { timeout: 15_000 }),
});

export function gasShortfallMessage(address: string, ethBalance: number): string {
  return (
    `Agent wallet ${address} needs free ${SETTLEMENT_CHAIN_NAME} ETH for gas (has ${ethBalance.toFixed(6)} ETH). ` +
    "Open Wallets → fund treasury from an Arbitrum Sepolia faucet (no mainnet ETH), then click ETH gas."
  );
}

export function createAgentWallet() {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    address: account.address,
    privateKey,
  };
}

export function usdToUsdcUnits(amountUsd: number): bigint {
  return parseUnits(amountUsd.toFixed(6), 6);
}

export async function fetchWalletBalances(address: string) {
  try {
    const addr = address as Address;
    const [ethWei, usdcRaw] = await Promise.all([
      publicClient.getBalance({ address: addr }),
      publicClient.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [addr],
      }),
    ]);
    return {
      eth: Number(formatUnits(ethWei, 18)),
      usdc: Number(formatUnits(usdcRaw, 6)),
    };
  } catch {
    return { eth: 0, usdc: 0 };
  }
}

const MIN_GAS_ETH = 0.00005;

export async function transferUsdcFromAgentWallet(
  privateKey: `0x${string}`,
  to: Address,
  amountUsd: number
): Promise<Hash> {
  const account = privateKeyToAccount(privateKey);
  const balances = await fetchWalletBalances(account.address);

  if (balances.eth < MIN_GAS_ETH) {
    throw new Error(gasShortfallMessage(account.address, balances.eth));
  }

  const amount = usdToUsdcUnits(amountUsd);
  if (balances.usdc < amountUsd) {
    throw new Error(
      `Insufficient USDC on agent wallet (has ${balances.usdc.toFixed(2)}, need ${amountUsd.toFixed(2)})`
    );
  }

  const walletClient = createWalletClient({
    account,
    chain: SETTLEMENT_CHAIN,
    transport: http(SETTLEMENT_RPC_URL, { timeout: 15_000 }),
  });

  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

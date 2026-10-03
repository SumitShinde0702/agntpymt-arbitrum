export const ARBITRUM_SEPOLIA_EXPLORER = "https://sepolia.arbiscan.io";

export function txExplorerUrl(txHash: string) {
  return `${ARBITRUM_SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function addressExplorerUrl(address: string) {
  return `${ARBITRUM_SEPOLIA_EXPLORER}/address/${address}`;
}

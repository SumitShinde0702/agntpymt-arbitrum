import fs from "node:fs";
import path from "node:path";
import { ethers, network } from "hardhat";

const ARBITRUM_SEPOLIA_USDC = "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d";

async function main() {
  const [deployer] = await ethers.getSigners();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`Deploying to ${network.name} (${chainId}) from ${deployer.address}`);

  let tokenAddress: string;
  if (chainId === 421614n) {
    tokenAddress = ARBITRUM_SEPOLIA_USDC;
  } else {
    const mock = await ethers.deployContract("MockUSDC");
    await mock.waitForDeployment();
    tokenAddress = await mock.getAddress();
    console.log(`MockUSDC: ${tokenAddress}`);
  }

  const policy = await ethers.deployContract("AgentSpendPolicy", [tokenAddress]);
  await policy.waitForDeployment();
  const policyAddress = await policy.getAddress();
  console.log(`AgentSpendPolicy: ${policyAddress} (token ${tokenAddress})`);

  const outDir = path.resolve(__dirname, "../deployments");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `${network.name}.json`),
    JSON.stringify(
      {
        network: network.name,
        chainId: Number(chainId),
        AgentSpendPolicy: policyAddress,
        token: tokenAddress,
        deployer: deployer.address,
        deployedAt: new Date().toISOString(),
        txHash: policy.deploymentTransaction()?.hash,
      },
      null,
      2
    ) + "\n"
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

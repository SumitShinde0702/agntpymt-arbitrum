// Verify a deployment on Sourcify (API v2) — keyless; usage: node scripts/verify-sourcify.cjs <network>
const fs = require("node:fs");
const path = require("node:path");

const network = process.argv[2] || "arbitrumSepolia";
const deployment = require(path.resolve(__dirname, `../deployments/${network}.json`));
const contractIdentifier = "contracts/AgentSpendPolicy.sol:AgentSpendPolicy";

const buildInfoDir = path.resolve(__dirname, "../artifacts/build-info");
const buildInfo = fs
  .readdirSync(buildInfoDir)
  .map((f) => JSON.parse(fs.readFileSync(path.join(buildInfoDir, f), "utf8")))
  .find((b) => b.output.contracts?.["contracts/AgentSpendPolicy.sol"]?.AgentSpendPolicy);
if (!buildInfo) throw new Error("Run `npx hardhat compile` first");

const headers = { "Content-Type": "application/json", "User-Agent": "agntpymt-contracts/0.1 (github.com/SumitShinde0702)" };

async function main() {
  const url = `https://sourcify.dev/server/v2/verify/${deployment.chainId}/${deployment.AgentSpendPolicy}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier,
      creationTransactionHash: deployment.txHash,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Sourcify ${res.status}: ${JSON.stringify(body)}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const job = await (await fetch(`https://sourcify.dev/server/v2/verify/${body.verificationId}`, { headers })).json();
    if (job.isJobCompleted) {
      if (job.error) throw new Error(JSON.stringify(job.error));
      console.log(`Verified (${job.contract?.match ?? "match"}): https://repo.sourcify.dev/${deployment.chainId}/${deployment.AgentSpendPolicy}`);
      return;
    }
  }
  throw new Error("Timed out waiting for Sourcify");
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

# AgntPymt — governed payments for AI agents, on Arbitrum

**Live:** [agntpymt.com](https://agntpymt.com)

AI agents can now buy things on their own: API calls, data, SaaS, and invoices. Companies won't hand an LLM a funded wallet without the same controls they use for employees: spending limits, approvals, a kill switch, and an audit trail. AgntPymt is that control plane. Agents negotiate with sellers and pay in USDC over [x402](https://x402.org). Every spend is authorized, approved, and recorded by an **on-chain policy contract on Arbitrum**.

## Why Arbitrum

- **Cheap enough for agents to govern every call.** Agent commerce means thousands of $0.01 payments. A policy check, an approval, and a settlement record cost cents on Arbitrum, so governance doesn't eat the margin.
- **Settlement and governance on one chain.** x402 USDC payments (`eip155:421614`), ERC-8004 agent identity and reputation, and `AgentSpendPolicy` all live on Arbitrum Sepolia. The audit trail is one Arbiscan query.
- **Robinhood Chain.** The same contract is deployed on Robinhood Chain testnet, an Arbitrum chain, so agents can be governed wherever the assets live.

## How it works

```
Agent (Hermes / MCP) ── "buy sector data" ──▶ AgntPymt control plane
                                                │ negotiate with seller, evaluate org policy
                                                ▼
                         AgentSpendPolicy.requestSpend()        (Arbitrum)
                           ├─ ≤ auto-approve  → Authorized
                           └─ > auto-approve  → PendingApproval ──▶ human approves in UI → approve()
                                                ▼
                         x402 USDC payment via facilitator      (Arbitrum)
                                                ▼
                         AgentSpendPolicy.markSettled(x402 tx)  (Arbitrum)
                         ERC-8004 reputation feedback for seller (Arbitrum)
```

### `AgentSpendPolicy.sol` ([`contracts/`](contracts/))

| Feature | How |
| --- | --- |
| Agent binding | Org admin binds an agent wallet with an **EIP-712 consent signature from the agent**, so nobody can claim someone else's agent address |
| Limits | Per-tx cap, rolling-day cap, auto-approve threshold (invariant: `auto ≤ perTx ≤ daily`) |
| Human-in-the-loop | Spends above the threshold are `PendingApproval` until the admin calls `approve()`; they expire after 3 days |
| Kill switches | Per-agent `setAgentActive(false)` and org-wide `setOrgFrozen(true)`; both also block settlement of already-authorized spends |
| Operators | Admin can delegate request/settle to a backend (AgntPymt), so agents need no gas |
| Settlement | `markSettled(id, x402TxHash)` for off-contract x402 payments, or `execute(id)` to pull USDC agent → vendor via `transferFrom` |
| Safety | OpenZeppelin `SafeERC20`, `ReentrancyGuard`, `SignatureChecker` (EOA + ERC-1271), custom errors, checks-effects-interactions |

### Deployed contracts

| Network | AgentSpendPolicy | Token |
| --- | --- | --- |
| Arbitrum Sepolia (421614) | see [`contracts/deployments/arbitrumSepolia.json`](contracts/deployments/) | USDC `0x75fa…AA4d` |
| Robinhood Chain testnet (46630) | see [`contracts/deployments/robinhoodTestnet.json`](contracts/deployments/) | MockUSDC |

ERC-8004 registries (Arbitrum Sepolia): Identity `0x8004A818BFB912233c491871b3d84c89A494BD9e`, Reputation `0x8004B663056A597Dffe9eCcC1965A193B7388713`.

### Contracts: test and deploy

```bash
cd contracts
npm install
npm test                          # 16 tests: binding, limits, approvals, kill switches, settlement
npm run deploy:arbitrum-sepolia   # needs DEPLOYER_PRIVATE_KEY with Arbitrum Sepolia ETH
npm run deploy:robinhood-testnet
npm run export-abi                # refresh server/src/chain/spend-policy-abi.ts
```

Server integration smoke test against any RPC (local Hardhat node or Arbitrum Sepolia):

```bash
SPEND_POLICY_ADDRESS=0x... SPEND_POLICY_ADMIN_PRIVATE_KEY=0x... npx tsx server/scripts/smoke-spend-policy.ts
```

## Quick start

```bash
# 1. Copy env (single root .env for client + server)
cp .env.example .env

# 2. Install dependencies
npm install

# 3. Start PostgreSQL (Docker)
npm run db:up

# 4. Build db package, migrate & seed
npm run build -w db
npm run db:migrate
npm run db:seed

# 5. Start dev (client :5173 + server :3001)
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Environment

All variables live in **one root `.env`** file. Vite reads `VITE_*` keys via `envDir: '..'` in `client/vite.config.ts`. The server loads the same file from the repo root.

## Optional: Hermes background runtime

AgntPymt provisions one **Hermes profile per agent** under `~/.hermes/profiles/{orgId}__{agentId}/` with `SOUL.md`, `config.yaml` (including the `agntpymt` MCP server), and `skills/`. Manage identity and capabilities from **Agents → Identity / Capabilities** in the UI.

### Local setup

```bash
pip install hermes-agent
hermes setup
# Enable API in ~/.hermes/.env:
#   API_SERVER_ENABLED=true
npm run dev:all   # client + server + hermes gateway (:8642)
```

On Windows, Hermes 0.17.0 can crash with `ModuleNotFoundError: cron.scheduler_provider` (package name collision). `dev:all` uses `scripts/hermes-gateway.py` to work around this automatically.

If the gateway starts but AgntPymt still shows Hermes offline, confirm `API_SERVER_ENABLED=true` in `~/.hermes/.env` and restart `npm run dev:all`.

When the Hermes gateway is online, **Run** in the Agent Console delegates to Hermes with the agent’s SOUL as `instructions` and streams lifecycle events into the chat feed. Purchases go through the `agntpymt` MCP tool (`AGENT_ID` is set per profile in `config.yaml`).

### Single-gateway limitation

One `hermes gateway` process uses **one** `HERMES_HOME` at startup. All agent profile **files** are created on disk, but skills/MCP from inactive profiles are not loaded until that profile is the gateway’s home. For local MVP:

- SOUL is passed via `instructions` on each `/v1/runs` call (works across profiles).
- The shared `agntpymt` MCP entry uses per-profile `AGENT_ID` in env when Hermes loads that profile’s `config.yaml`.

For full per-agent runtime isolation later: one gateway per org, subprocess per run with `HERMES_HOME=profile_path`, or Hermes per-run profile APIs.

See `docs/hermes-mcp.example.json` for a manual MCP reference (AgntPymt auto-writes this into each agent profile).

## Production deploy

Manual deploy on a VM (Docker): [`deploy/vm/README.md`](deploy/vm/README.md)

Optional GCP infra (Cloud SQL, GCS, Hermes VM): [`deploy/gcp/README.md`](deploy/gcp/README.md)

## Demo flows

Micro-payments default to **$0.01 USDC** (`DEMO_TRANSACTION_FEE_USD` in `.env`). Re-seed after pricing changes: `npm run db:seed`.

1. **Auto-approve + negotiate** — Research Agent → "Buy premium sector research data" → seller quotes $0.02, agent counters $0.01, settles
2. **Instant micro-pay** — Procurement Agent → "Order office supplies" → $0.01, no approval needed
3. **Human approval** — Cloud Ops → "Pay AWS invoice" → negotiates to $0.08 → exceeds $0.05 auto-approve limit → approve in UI

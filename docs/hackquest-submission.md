# HackQuest submission — Arbitrum Open House Singapore Buildathon

Copy-paste source for the submission form. Fill the `TODO` addresses after deployment.

## Project name
AgntPymt

## One-liner
Governed payments for AI agents: spending limits, human approvals and kill switches enforced on Arbitrum, settled in USDC over x402.

## Links
- Live app: https://agntpymt.com
- Repo: https://github.com/SumitShinde0702/agntpymt-arbitrum
- AgentSpendPolicy (Arbitrum Sepolia): TODO `https://sepolia.arbiscan.io/address/0x...`
- AgentSpendPolicy (Robinhood Chain testnet): TODO `https://explorer.testnet.chain.robinhood.com/address/0x...`
- Demo video: TODO

## Problem
AI agents can now buy things on their own: APIs, data, SaaS, invoices. But no finance team will give an LLM a funded wallet without the controls they apply to employees: limits, approvals, a kill switch and an audit trail. Today teams either block agent payments entirely or hard-code private keys with no controls. Off-chain rules alone aren't enough, because whoever runs the server can bypass them.

## Solution
AgntPymt is a control plane for agent spending:
1. Each agent gets its own wallet, funded from a company treasury.
2. Agents (Hermes, or any MCP client) discover sellers, negotiate a price and request payment.
3. Every spend goes through **AgentSpendPolicy** on Arbitrum. Small amounts are auto-authorized; anything above the threshold waits for a human to approve on-chain. Per-agent and org-wide kill switches stop spending instantly.
4. Payment settles in USDC via **x402** on Arbitrum, and the settlement tx is recorded against the on-chain request.
5. The buyer agent rates the seller on the **ERC-8004** reputation registry, which builds verifiable trust between agents.

## Why Arbitrum
- Agent commerce is thousands of $0.01 payments. A policy check, approval and settlement record cost cents on Arbitrum, so governance doesn't wipe out the margin.
- One chain for everything: x402 USDC (`eip155:421614`), ERC-8004 identity/reputation and AgentSpendPolicy all run on Arbitrum Sepolia, so the full audit trail is on Arbiscan.
- Also deployed on Robinhood Chain testnet (an Arbitrum chain), so agents can be governed where tokenized assets live.

## Technical highlights
- `AgentSpendPolicy.sol`: binding needs an EIP-712 signature from the agent (no address squatting; ERC-1271 compatible). Enforces `auto ≤ perTx ≤ daily`. Approvals expire after 3 days. Settlement is either recorded from x402 or executed on-chain via `SafeERC20.transferFrom` behind `ReentrancyGuard`. Uses custom errors throughout.
- 16 Hardhat tests cover binding, limits, daily rollover, approvals and expiry, kill switches, settlement and cancellation.
- Server integration (viem) serializes admin writes to avoid nonce collisions and maps contract reverts to policy denials. RPC outages fall back to the off-chain policy with an audit entry.
- Every on-chain step streams into the Agent Console with an Arbiscan link. The Payments page shows payment, rating and policy txs for each settlement.

## What changed during the buildathon
AgntPymt started on Base. For Open House, governance moved on-chain (`AgentSpendPolicy`) and the whole stack was migrated to Arbitrum: x402 network and facilitator, USDC, ERC-8004 registries, wallets, explorer links and UI.

## Roadmap
- **Month 1:** Arbitrum One mainnet deploy; per-org admin keys (Safe multisig as policy admin); vendor allowlists on-chain.
- **Month 2:** Approvals from the treasury wallet in the UI (admin signs `approve()` directly); Stylus port of the policy hot path for cheaper checks.
- **Month 3:** Pilot with 3 teams running agent procurement; SDK so any agent framework can call `requestSpend` via MCP.

## Team
Sumit Shinde — TODO: one-line background + X/LinkedIn

---

## 2-minute demo video script
1. **(0:00) Hook.** "AI agents can now spend money. AgntPymt makes that safe, with policy enforced on Arbitrum."
2. **(0:15) Policies page.** Show the Research Agent: $0.05 auto-approve, daily cap, kill switch.
3. **(0:30) Agent Console, auto-approve.** Research Agent: "Buy premium sector research data". The seller quotes $0.02 and the agent counters $0.01. The feed shows "Authorized on Arbitrum", then "Payment sent", then "Settlement recorded on Arbitrum". Click the Arbiscan link.
4. **(1:00) Human approval.** Cloud Ops: "Pay AWS invoice" at $0.08. The feed shows "On-chain approval required". Approve in the UI, then show "Approved on Arbitrum" and the settlement. Show the `SpendApproved` event on Arbiscan.
5. **(1:30) Kill switch.** Pause the org and run again. "Denied by policy" appears.
6. **(1:45) Payments page.** Payment, rating and policy txs per row. Close: "Live at agntpymt.com, contracts verified on Arbiscan and Robinhood Chain."

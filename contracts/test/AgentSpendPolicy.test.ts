import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HDNodeWallet, Signer } from "ethers";
import type { AgentSpendPolicy, MockUSDC } from "../typechain-types";

const usdc = (n: number) => ethers.parseUnits(n.toString(), 6);
const REF = ethers.encodeBytes32String("order-1");

enum Status {
  None,
  PendingApproval,
  Authorized,
  Settled,
  Rejected,
  Cancelled,
}

async function signBind(policy: AgentSpendPolicy, agent: HDNodeWallet | Signer, admin: string, deadline: bigint) {
  const agentAddress = await agent.getAddress();
  const { chainId } = await ethers.provider.getNetwork();
  return agent.signTypedData(
    {
      name: "AgntPymt AgentSpendPolicy",
      version: "1",
      chainId,
      verifyingContract: await policy.getAddress(),
    },
    {
      BindAgent: [
        { name: "agent", type: "address" },
        { name: "admin", type: "address" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { agent: agentAddress, admin, nonce: await policy.nonces(agentAddress), deadline }
  );
}

async function requestIdFrom(policy: AgentSpendPolicy, tx: Promise<unknown>): Promise<string> {
  const receipt = await (await (tx as Promise<{ wait(): Promise<any> }>)).wait();
  const log = receipt.logs
    .map((l: any) => {
      try {
        return policy.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === "SpendRequested");
  return log!.args.requestId as string;
}

describe("AgentSpendPolicy", () => {
  async function deployFixture() {
    const [admin, operator, vendor, stranger] = await ethers.getSigners();
    const agent = ethers.Wallet.createRandom().connect(ethers.provider);
    await admin.sendTransaction({ to: agent.address, value: ethers.parseEther("1") });

    const token = (await ethers.deployContract("MockUSDC")) as unknown as MockUSDC;
    const policy = (await ethers.deployContract("AgentSpendPolicy", [
      await token.getAddress(),
    ])) as unknown as AgentSpendPolicy;

    const deadline = BigInt(await time.latest()) + 3600n;
    const sig = await signBind(policy, agent, admin.address, deadline);
    await policy.connect(admin).bindAgent(agent.address, usdc(1), usdc(2), usdc(0.05), deadline, sig);
    await policy.connect(admin).setOperator(operator.address, true);

    await token.mint(agent.address, usdc(10));
    await token.connect(agent).approve(await policy.getAddress(), ethers.MaxUint256);

    return { policy, token, admin, operator, vendor, stranger, agent };
  }

  describe("binding", () => {
    it("binds an agent with its consent and stores the policy", async () => {
      const { policy, admin, agent } = await loadFixture(deployFixture);
      const p = await policy.policies(agent.address);
      expect(p.admin).to.equal(admin.address);
      expect(p.active).to.equal(true);
      expect(p.perTxLimit).to.equal(usdc(1));
      expect(p.dailyLimit).to.equal(usdc(2));
      expect(p.autoApproveLimit).to.equal(usdc(0.05));
    });

    it("rejects a bind signed for a different admin (no squatting)", async () => {
      const { policy, stranger, admin } = await loadFixture(deployFixture);
      const fresh = ethers.Wallet.createRandom();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signBind(policy, fresh, admin.address, deadline);
      await expect(
        policy.connect(stranger).bindAgent(fresh.address, usdc(1), usdc(2), 0, deadline, sig)
      ).to.be.revertedWithCustomError(policy, "InvalidSignature");
    });

    it("rejects expired signatures, rebinding and inconsistent limits", async () => {
      const { policy, admin, agent } = await loadFixture(deployFixture);
      const fresh = ethers.Wallet.createRandom();
      const past = BigInt(await time.latest()) - 1n;
      const expired = await signBind(policy, fresh, admin.address, past);
      await expect(
        policy.bindAgent(fresh.address, usdc(1), usdc(2), 0, past, expired)
      ).to.be.revertedWithCustomError(policy, "SignatureExpired");

      const deadline = BigInt(await time.latest()) + 3600n;
      const again = await signBind(policy, agent, admin.address, deadline);
      await expect(
        policy.bindAgent(agent.address, usdc(1), usdc(2), 0, deadline, again)
      ).to.be.revertedWithCustomError(policy, "AlreadyBound");

      await expect(policy.setLimits(agent.address, usdc(3), usdc(2), 0)).to.be.revertedWithCustomError(
        policy,
        "InvalidLimits"
      );
      await expect(policy.setLimits(agent.address, usdc(1), usdc(2), usdc(1.5))).to.be.revertedWithCustomError(
        policy,
        "InvalidLimits"
      );
    });
  });

  describe("requests", () => {
    it("auto-authorizes spends at or below the threshold and reserves daily budget", async () => {
      const { policy, operator, vendor, agent } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.05), REF)
      );
      expect((await policy.requests(id)).status).to.equal(Status.Authorized);
      expect(await policy.remainingDailyAllowance(agent.address)).to.equal(usdc(1.95));
    });

    it("routes larger spends to human approval without reserving budget", async () => {
      const { policy, operator, vendor, agent } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.5), REF)
      );
      expect((await policy.requests(id)).status).to.equal(Status.PendingApproval);
      expect(await policy.remainingDailyAllowance(agent.address)).to.equal(usdc(2));
    });

    it("enforces per-tx and daily caps", async () => {
      const { policy, operator, vendor, agent, admin } = await loadFixture(deployFixture);
      await expect(
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(1.01), REF)
      ).to.be.revertedWithCustomError(policy, "ExceedsPerTxLimit");

      for (let i = 0; i < 2; i++) {
        const id = await requestIdFrom(
          policy,
          policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(1), REF)
        );
        if (i === 0) await policy.connect(admin).approve(id);
        else await expect(policy.connect(admin).approve(id)).to.not.be.reverted;
      }
      const third = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.5), REF)
      );
      await expect(policy.connect(admin).approve(third)).to.be.revertedWithCustomError(policy, "ExceedsDailyLimit");
    });

    it("resets the daily budget on the next day", async () => {
      const { policy, operator, vendor, agent, admin } = await loadFixture(deployFixture);
      for (let i = 0; i < 2; i++) {
        const id = await requestIdFrom(
          policy,
          policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(1), REF)
        );
        await policy.connect(admin).approve(id);
      }
      expect(await policy.remainingDailyAllowance(agent.address)).to.equal(0);
      await time.increase(24 * 60 * 60);
      expect(await policy.remainingDailyAllowance(agent.address)).to.equal(usdc(2));
    });

    it("only lets the agent or an authorized operator submit requests", async () => {
      const { policy, stranger, vendor, agent, admin, operator } = await loadFixture(deployFixture);
      await expect(
        policy.connect(stranger).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "NotAgentOrOperator");
      await expect(policy.connect(agent).requestSpend(agent.address, vendor.address, usdc(0.01), REF)).to.not.be
        .reverted;

      await policy.connect(admin).setOperator(operator.address, false);
      await expect(
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "NotAgentOrOperator");
    });

    it("rejects zero vendor, zero amount and unbound agents", async () => {
      const { policy, operator, vendor, agent } = await loadFixture(deployFixture);
      await expect(
        policy.connect(operator).requestSpend(agent.address, ethers.ZeroAddress, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "ZeroAddress");
      await expect(
        policy.connect(operator).requestSpend(agent.address, vendor.address, 0, REF)
      ).to.be.revertedWithCustomError(policy, "ZeroAmount");
      await expect(
        policy.connect(operator).requestSpend(vendor.address, vendor.address, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "NotBound");
    });
  });

  describe("approvals", () => {
    it("lets only the admin approve or reject, within the TTL", async () => {
      const { policy, operator, vendor, agent, admin, stranger } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.5), REF)
      );
      await expect(policy.connect(stranger).approve(id)).to.be.revertedWithCustomError(policy, "NotAdmin");
      await expect(policy.connect(operator).reject(id)).to.be.revertedWithCustomError(policy, "NotAdmin");
      await expect(policy.connect(admin).approve(id)).to.emit(policy, "SpendApproved").withArgs(id, admin.address);
      await expect(policy.connect(admin).approve(id)).to.be.revertedWithCustomError(policy, "InvalidStatus");

      const late = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.5), REF)
      );
      await time.increase(3 * 24 * 60 * 60 + 1);
      await expect(policy.connect(admin).approve(late)).to.be.revertedWithCustomError(policy, "ApprovalExpired");
      await expect(policy.connect(admin).reject(late)).to.emit(policy, "SpendRejected");
    });
  });

  describe("kill switches", () => {
    it("blocks requests, approvals and settlement when an agent is deactivated", async () => {
      const { policy, operator, vendor, agent, admin } = await loadFixture(deployFixture);
      const authorized = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      );
      await policy.connect(admin).setAgentActive(agent.address, false);
      await expect(
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "AgentInactive");
      await expect(policy.connect(operator).execute(authorized)).to.be.revertedWithCustomError(policy, "AgentInactive");
    });

    it("freezes every agent of an org", async () => {
      const { policy, operator, vendor, agent, admin } = await loadFixture(deployFixture);
      await policy.connect(admin).setOrgFrozen(true);
      await expect(
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      ).to.be.revertedWithCustomError(policy, "OrgIsFrozen");
      await policy.connect(admin).setOrgFrozen(false);
      await expect(policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)).to.not.be
        .reverted;
    });
  });

  describe("settlement", () => {
    it("executes an authorized spend by moving tokens from agent to vendor exactly once", async () => {
      const { policy, token, operator, vendor, agent } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.05), REF)
      );
      await expect(policy.connect(operator).execute(id))
        .to.emit(policy, "SpendSettled")
        .withArgs(id, ethers.ZeroHash, true);
      expect(await token.balanceOf(vendor.address)).to.equal(usdc(0.05));
      await expect(policy.connect(operator).execute(id)).to.be.revertedWithCustomError(policy, "InvalidStatus");
    });

    it("records an off-contract x402 settlement hash", async () => {
      const { policy, operator, vendor, agent } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.01), REF)
      );
      const x402Tx = ethers.keccak256(ethers.toUtf8Bytes("x402-settlement"));
      await expect(policy.connect(operator).markSettled(id, x402Tx))
        .to.emit(policy, "SpendSettled")
        .withArgs(id, x402Tx, false);
      expect((await policy.requests(id)).status).to.equal(Status.Settled);
    });

    it("cannot settle a pending (unapproved) request", async () => {
      const { policy, operator, vendor, agent } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.5), REF)
      );
      await expect(policy.connect(operator).execute(id)).to.be.revertedWithCustomError(policy, "InvalidStatus");
      await expect(policy.connect(operator).markSettled(id, REF)).to.be.revertedWithCustomError(
        policy,
        "InvalidStatus"
      );
    });

    it("releases reserved budget when an authorized request is cancelled", async () => {
      const { policy, operator, vendor, agent, stranger } = await loadFixture(deployFixture);
      const id = await requestIdFrom(
        policy,
        policy.connect(operator).requestSpend(agent.address, vendor.address, usdc(0.05), REF)
      );
      await expect(policy.connect(stranger).cancel(id)).to.be.revertedWithCustomError(policy, "NotAgentOrOperator");
      await policy.connect(agent).cancel(id);
      expect(await policy.remainingDailyAllowance(agent.address)).to.equal(usdc(2));
      await expect(policy.connect(operator).execute(id)).to.be.revertedWithCustomError(policy, "InvalidStatus");
    });
  });
});

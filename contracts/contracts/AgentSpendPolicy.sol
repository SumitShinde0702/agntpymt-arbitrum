// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @title AgentSpendPolicy
/// @author AgntPymt
/// @notice On-chain spending governance for autonomous AI agents.
///         An org admin binds agent wallets to a policy (per-tx cap, daily cap, auto-approve threshold).
///         Every agent spend is a request: small ones are authorized instantly, larger ones wait for the
///         admin's on-chain approval. Authorized spends are either settled off-contract (x402 / EIP-3009,
///         recorded here with the settlement tx hash) or executed by this contract via `transferFrom`.
contract AgentSpendPolicy is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        PendingApproval,
        Authorized,
        Settled,
        Rejected,
        Cancelled
    }

    struct Policy {
        address admin;
        bool active;
        uint128 perTxLimit;
        uint128 dailyLimit;
        uint128 autoApproveLimit;
    }

    struct SpendRequest {
        address agent;
        address vendor;
        uint128 amount;
        uint64 createdAt;
        uint32 reservedDay;
        Status status;
        bytes32 ref;
    }

    /// @notice Pending requests older than this can no longer be approved.
    uint256 public constant APPROVAL_TTL = 3 days;

    bytes32 public constant BIND_TYPEHASH =
        keccak256("BindAgent(address agent,address admin,uint256 nonce,uint256 deadline)");

    /// @notice Settlement asset (USDC on Arbitrum).
    IERC20 public immutable token;

    mapping(address agent => Policy) public policies;
    mapping(address agent => mapping(uint256 day => uint256)) public spentOnDay;
    mapping(address admin => mapping(address operator => bool)) public isOperator;
    mapping(address admin => bool) public orgFrozen;
    mapping(address agent => uint256) public nonces;
    mapping(bytes32 requestId => SpendRequest) public requests;

    event AgentBound(address indexed agent, address indexed admin);
    event PolicyUpdated(address indexed agent, uint128 perTxLimit, uint128 dailyLimit, uint128 autoApproveLimit);
    event AgentActiveSet(address indexed agent, bool active);
    event OrgFrozenSet(address indexed admin, bool frozen);
    event OperatorSet(address indexed admin, address indexed operator, bool allowed);
    event SpendRequested(
        bytes32 indexed requestId,
        address indexed agent,
        address indexed vendor,
        uint128 amount,
        bytes32 ref,
        Status status
    );
    event SpendApproved(bytes32 indexed requestId, address indexed admin);
    event SpendRejected(bytes32 indexed requestId, address indexed admin);
    event SpendCancelled(bytes32 indexed requestId, address indexed by);
    event SpendSettled(bytes32 indexed requestId, bytes32 settlementRef, bool executedOnChain);

    error ZeroAddress();
    error ZeroAmount();
    error AlreadyBound();
    error NotBound();
    error NotAdmin();
    error NotAgentOrOperator();
    error InvalidLimits();
    error SignatureExpired();
    error InvalidSignature();
    error AgentInactive();
    error OrgIsFrozen();
    error ExceedsPerTxLimit(uint256 amount, uint256 limit);
    error ExceedsDailyLimit(uint256 requested, uint256 remaining);
    error InvalidStatus(Status current);
    error ApprovalExpired();

    constructor(IERC20 token_) EIP712("AgntPymt AgentSpendPolicy", "1") {
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
    }

    // ───────────────────────────── Admin ─────────────────────────────

    /// @notice Bind an agent wallet to the caller as its admin. The agent must consent via an EIP-712
    ///         signature so nobody can squat on someone else's agent address.
    function bindAgent(
        address agent,
        uint128 perTxLimit,
        uint128 dailyLimit,
        uint128 autoApproveLimit,
        uint256 deadline,
        bytes calldata agentSignature
    ) external {
        if (agent == address(0)) revert ZeroAddress();
        if (policies[agent].admin != address(0)) revert AlreadyBound();
        if (block.timestamp > deadline) revert SignatureExpired();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(BIND_TYPEHASH, agent, msg.sender, nonces[agent]++, deadline))
        );
        if (!SignatureChecker.isValidSignatureNow(agent, digest, agentSignature)) revert InvalidSignature();

        policies[agent].admin = msg.sender;
        policies[agent].active = true;
        emit AgentBound(agent, msg.sender);
        _setLimits(agent, perTxLimit, dailyLimit, autoApproveLimit);
    }

    function setLimits(address agent, uint128 perTxLimit, uint128 dailyLimit, uint128 autoApproveLimit)
        external
        onlyAdminOf(agent)
    {
        _setLimits(agent, perTxLimit, dailyLimit, autoApproveLimit);
    }

    /// @notice Per-agent kill switch.
    function setAgentActive(address agent, bool active) external onlyAdminOf(agent) {
        policies[agent].active = active;
        emit AgentActiveSet(agent, active);
    }

    /// @notice Org-wide kill switch: freezes every agent bound to the caller.
    function setOrgFrozen(bool frozen) external {
        orgFrozen[msg.sender] = frozen;
        emit OrgFrozenSet(msg.sender, frozen);
    }

    /// @notice Allow a backend (e.g. the AgntPymt control plane) to submit and settle requests for the caller's agents.
    function setOperator(address operator, bool allowed) external {
        if (operator == address(0)) revert ZeroAddress();
        isOperator[msg.sender][operator] = allowed;
        emit OperatorSet(msg.sender, operator, allowed);
    }

    function approve(bytes32 requestId) external {
        SpendRequest storage req = requests[requestId];
        Policy storage policy = policies[req.agent];
        if (msg.sender != policy.admin) revert NotAdmin();
        if (req.status != Status.PendingApproval) revert InvalidStatus(req.status);
        if (block.timestamp > req.createdAt + APPROVAL_TTL) revert ApprovalExpired();
        _checkSpendable(policy, req.amount);

        req.reservedDay = _reserve(req.agent, policy, req.amount);
        req.status = Status.Authorized;
        emit SpendApproved(requestId, msg.sender);
    }

    function reject(bytes32 requestId) external {
        SpendRequest storage req = requests[requestId];
        if (msg.sender != policies[req.agent].admin) revert NotAdmin();
        if (req.status != Status.PendingApproval) revert InvalidStatus(req.status);
        req.status = Status.Rejected;
        emit SpendRejected(requestId, msg.sender);
    }

    // ───────────────────────────── Agent / operator ─────────────────────────────

    /// @notice Request a spend. Amounts at or below the auto-approve threshold are authorized immediately
    ///         (and count toward today's cap); larger amounts wait for admin approval.
    function requestSpend(address agent, address vendor, uint128 amount, bytes32 ref)
        external
        onlyAgentOrOperator(agent)
        returns (bytes32 requestId, Status status)
    {
        if (vendor == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Policy storage policy = policies[agent];
        _checkSpendable(policy, amount);

        requestId = keccak256(abi.encode(block.chainid, address(this), agent, nonces[agent]++));
        SpendRequest storage req = requests[requestId];
        req.agent = agent;
        req.vendor = vendor;
        req.amount = amount;
        req.createdAt = uint64(block.timestamp);
        req.ref = ref;

        if (amount <= policy.autoApproveLimit) {
            req.reservedDay = _reserve(agent, policy, amount);
            status = Status.Authorized;
        } else {
            status = Status.PendingApproval;
        }
        req.status = status;
        emit SpendRequested(requestId, agent, vendor, amount, ref, status);
    }

    /// @notice Record an authorized spend that was settled off-contract (e.g. x402 EIP-3009 transfer).
    function markSettled(bytes32 requestId, bytes32 settlementRef) external {
        SpendRequest storage req = _authorizedRequest(requestId);
        req.status = Status.Settled;
        emit SpendSettled(requestId, settlementRef, false);
    }

    /// @notice Settle an authorized spend by pulling tokens from the agent wallet to the vendor.
    ///         The agent must have approved this contract for at least `amount`.
    function execute(bytes32 requestId) external nonReentrant {
        SpendRequest storage req = _authorizedRequest(requestId);
        req.status = Status.Settled;
        token.safeTransferFrom(req.agent, req.vendor, req.amount);
        emit SpendSettled(requestId, bytes32(0), true);
    }

    /// @notice Cancel a pending or authorized-but-unsettled request; releases today's reservation.
    function cancel(bytes32 requestId) external {
        SpendRequest storage req = requests[requestId];
        address admin = policies[req.agent].admin;
        if (msg.sender != req.agent && msg.sender != admin && !isOperator[admin][msg.sender]) {
            revert NotAgentOrOperator();
        }
        Status current = req.status;
        if (current != Status.PendingApproval && current != Status.Authorized) revert InvalidStatus(current);

        if (current == Status.Authorized) {
            spentOnDay[req.agent][req.reservedDay] -= req.amount;
        }
        req.status = Status.Cancelled;
        emit SpendCancelled(requestId, msg.sender);
    }

    // ───────────────────────────── Views ─────────────────────────────

    function remainingDailyAllowance(address agent) external view returns (uint256) {
        Policy storage policy = policies[agent];
        uint256 spent = spentOnDay[agent][_today()];
        return spent >= policy.dailyLimit ? 0 : policy.dailyLimit - spent;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ───────────────────────────── Internal ─────────────────────────────

    modifier onlyAdminOf(address agent) {
        address admin = policies[agent].admin;
        if (admin == address(0)) revert NotBound();
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyAgentOrOperator(address agent) {
        address admin = policies[agent].admin;
        if (admin == address(0)) revert NotBound();
        if (msg.sender != agent && !isOperator[admin][msg.sender]) revert NotAgentOrOperator();
        _;
    }

    function _setLimits(address agent, uint128 perTxLimit, uint128 dailyLimit, uint128 autoApproveLimit) private {
        if (perTxLimit == 0 || perTxLimit > dailyLimit || autoApproveLimit > perTxLimit) revert InvalidLimits();
        Policy storage policy = policies[agent];
        policy.perTxLimit = perTxLimit;
        policy.dailyLimit = dailyLimit;
        policy.autoApproveLimit = autoApproveLimit;
        emit PolicyUpdated(agent, perTxLimit, dailyLimit, autoApproveLimit);
    }

    function _checkSpendable(Policy storage policy, uint256 amount) private view {
        if (!policy.active) revert AgentInactive();
        if (orgFrozen[policy.admin]) revert OrgIsFrozen();
        if (amount > policy.perTxLimit) revert ExceedsPerTxLimit(amount, policy.perTxLimit);
    }

    function _reserve(address agent, Policy storage policy, uint256 amount) private returns (uint32 day) {
        day = uint32(_today());
        uint256 spent = spentOnDay[agent][day];
        uint256 remaining = spent >= policy.dailyLimit ? 0 : policy.dailyLimit - spent;
        if (amount > remaining) revert ExceedsDailyLimit(amount, remaining);
        spentOnDay[agent][day] = spent + amount;
    }

    function _authorizedRequest(bytes32 requestId) private view returns (SpendRequest storage req) {
        req = requests[requestId];
        address admin = policies[req.agent].admin;
        if (msg.sender != req.agent && !isOperator[admin][msg.sender]) revert NotAgentOrOperator();
        if (req.status != Status.Authorized) revert InvalidStatus(req.status);
        if (orgFrozen[admin]) revert OrgIsFrozen();
        if (!policies[req.agent].active) revert AgentInactive();
    }

    function _today() private view returns (uint256) {
        return block.timestamp / 1 days;
    }
}

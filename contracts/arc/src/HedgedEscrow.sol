// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Minimal ERC-20 surface we use. On Arc, USDC's optional ERC-20 interface lives at
///      0x3600000000000000000000000000000000000000 (6 decimals) and shares one balance with the
///      native 18-decimal gas balance (docs.arc.io "EVM differences" / "Contract addresses").
interface IERC20Like {
    function decimals() external view returns (uint8);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev EIP-2612 (Circle FiatToken v2+; Arc testnet USDC answers `DOMAIN_SEPARATOR`, `nonces`,
///      `PERMIT_TYPEHASH`, name "USDC", version "2").
interface IERC20PermitLike {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @dev EIP-3009 `receiveWithAuthorization` (FiatToken v2+): the token enforces `msg.sender == to`,
///      so only this escrow can redeem an authorization made out to it.
interface IERC3009Like {
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

/// @title HedgedEscrow: Arc (EVM) port of the `programs/escrow` Anchor program.
/// @notice Same 12 operations, same state machines, same authority/pause matrix, same errors
///         (in the same order, so `errorIndex + 6000` equals the Anchor code), same five events.
///         Spec: docs/interfaces.md §1-3 and docs/workflow.md. Differences, all EVM-forced:
///         - `initialize_config` is the constructor (deployer = admin, once).
///         - PDAs become deterministic ids: promoId = keccak256(abi.encode("promo", merchant,
///           nonce)), purchaseKey = keccak256(abi.encode("purchase", promoId, customer,
///           purchaseId)). One contract holds every promo's funds; per-promo accounting
///           (`totalDeposited` / `totalPaidOut`) keeps the "exact per-purchase liability" and
///           "each promo pays out at most what it took in" guarantees of the per-promo vault.
///         - Token "accounts" are wallet addresses: payouts go to the recorded customer /
///           merchant address itself (strictly tighter than the Anchor owner check).
///         - Appended errors (index >= 23) cover cases Anchor reports through system errors.
///         v2 additions (Arc only, all append-only so the v1 ABI keeps working):
///         - VOID outcome (`Outcome.Void` -> `PromoState.ResolvedVoid`): the event was cancelled or the
///           market voided. Product rule (team spec 2026-11-18): "nobody wins, the shop keeps the
///           sales, flagged for an operator": Hedged purchases pay the MERCHANT; purchases never
///           hedged (Deposited / Cancelled) are refunded to their customer.
///         - Automatic settlement: `settlePurchase` / `settlePurchases` / `settlePromo` push each
///           purchase's exact amount to its entitled party. Permissionless on purpose: the recipient
///           and amount are fixed by contract state, so a caller can only pay what is owed to whom it
///           is owed. The self-claims stay as a fallback; whichever runs first wins, exactly once.
///         - Unhedged deposits on a resolved promo can never become Hedged (`markHedged` needs an
///           Active promo), so they are refundable to the customer under any outcome (the
///           "refund-only" default of docs/interfaces.md §8).
///         - One-signature checkout: `depositWithAuthorization` (EIP-3009, customer signs once, anyone
///           such as the relayer submits and pays gas; the 3009 nonce IS the purchase key, so the
///           signature is bound to promo + customer + purchaseId) and `depositWithPermit` (EIP-2612).
///         - Extension points for undecided rules (platform fee, per-customer limit): every deposit
///           goes through `_recordDeposit` and every payout through `_settle` / `_trySettle`.
contract HedgedEscrow {
    // ---------------------------------------------------------------- constants
    uint8 public constant TOKEN_DECIMALS = 6;
    uint256 public constant MAX_MARKET_ID_LEN = 64;
    uint64 public constant MIN_CANCEL_TIMEOUT_SECS = 1;
    uint64 public constant MAX_CANCEL_TIMEOUT_SECS = 30 days;
    /// Upper bound for one batch settlement call (about 50 x ~40k gas, well under Arc's 30M block).
    uint256 public constant MAX_SETTLE_BATCH = 50;

    // ---------------------------------------------------------------- types (Anchor order)
    enum PromoState {
        Active,
        ResolvedYes,
        ResolvedNo,
        ResolvedVoid // v2, appended
    }

    enum PurchaseState {
        Deposited,
        Hedged,
        Cancelled,
        Refunded,
        ClaimedByCustomer,
        ClaimedByMerchant
    }

    enum Outcome {
        Yes,
        No,
        Void // v2, appended
    }

    enum ClaimKind {
        CancelRefund,
        YesRefund,
        MerchantPayout
    }

    /// v2: what `previewSettlement` reports for a purchase right now.
    enum SettleStatus {
        Payable,
        NotFound,
        AlreadySettled,
        NotDue, // promo still Active and the purchase is not Cancelled
        Paused // outcome-dependent payout of a Hedged purchase while the admin pause is on
    }

    struct Promo {
        address merchant;
        uint64 promoNonce;
        uint64 offerAmount;
        uint64 depositDeadline;
        uint64 resolvedAt;
        uint64 totalDeposited;
        uint64 totalPaidOut;
        uint64 purchaseCount;
        uint64 cancelTimeoutSecs;
        PromoState state;
        bool exists;
        string marketId;
    }

    struct Purchase {
        bytes32 promo;
        address customer;
        bytes16 purchaseId;
        uint64 amount;
        PurchaseState state;
        uint64 depositedAt;
        uint64 hedgedAt;
        uint64 cancelledAt;
        uint64 settledAt;
        bool exists;
    }

    // ---------------------------------------------------------------- errors (Anchor order: 6000 + i)
    error Unauthorized(); // 6000
    error Paused(); // 6001
    error InvalidState(); // 6002
    error WrongMint(); // 6003 (unused on EVM: the token is fixed at deploy)
    error WrongTokenAccount(); // 6004 (unused on EVM: payouts go to recorded addresses)
    error DepositClosed(); // 6005
    error WrongAmount(); // 6006
    error PromoNotActive(); // 6007
    error AlreadyResolved(); // 6008
    error AlreadyHedged(); // 6009
    error AlreadyCancelled(); // 6010
    error AlreadyClaimed(); // 6011
    error MarketIdTooLong(); // 6012
    error MathOverflow(); // 6013
    error InvalidOfferAmount(); // 6014
    error InvalidDeadline(); // 6015
    error EmptyMarketId(); // 6016
    error WrongDecimals(); // 6017
    error InvalidRelayer(); // 6018
    error InsufficientVaultFunds(); // 6019
    error ResolutionTooEarly(); // 6020
    error TimeoutNotElapsed(); // 6021
    error InvalidTimeout(); // 6022
    // EVM-only (append-only):
    error PromoAlreadyExists(); // Anchor: `init` on an existing PDA (system "already in use")
    error PurchaseAlreadyExists(); // same, for the purchase
    error AccountNotFound(); // Anchor 3012 AccountNotInitialized
    error Reentrancy();
    error TokenTransferFailed(); // token returned false / reverted / balance delta mismatch
    error BatchTooLarge(); // v2: more than MAX_SETTLE_BATCH keys
    error PermitFailed(); // v2: permit rejected and no sufficient allowance exists

    // ---------------------------------------------------------------- events (same five)
    event DepositEvent(
        bytes32 indexed promo,
        bytes32 indexed purchase,
        address indexed customer,
        bytes16 purchaseId,
        uint64 amount,
        uint64 depositedAt
    );
    event HedgeMarkedEvent(bytes32 indexed promo, bytes32 indexed purchase, address relayer, uint64 markedAt);
    /// Emitted by `cancelUnhedged` (relayer) AND `cancelExpiredDeposit` (customer); same payload.
    event PurchaseCancelledEvent(
        bytes32 indexed promo, bytes32 indexed purchase, address indexed customer, uint64 amount, uint64 cancelledAt
    );
    event ResolutionEvent(bytes32 indexed promo, Outcome outcome, address relayer, uint64 resolvedAt);
    event ClaimEvent(
        bytes32 indexed promo,
        bytes32 indexed purchase,
        address indexed recipient,
        uint64 amount,
        ClaimKind kind,
        uint64 claimedAt
    );

    /// v2: a batch settlement skipped this purchase because the token refused the transfer (e.g. a
    /// blocklisted recipient). Nothing moved and the purchase stays payable.
    event SettlementFailed(bytes32 indexed promo, bytes32 indexed purchase, address indexed recipient, uint64 amount);

    // ---------------------------------------------------------------- config (Anchor `Config`)
    address public admin;
    address public relayer;
    IERC20Like public immutable token;
    bool public paused;
    uint64 public cancelTimeoutSecs;

    mapping(bytes32 => Promo) private _promos;
    mapping(bytes32 => Purchase) private _purchases;
    mapping(bytes32 => bytes32[]) private _promoPurchases;
    bytes32[] private _promoIds;
    uint256 private _lock = 1;

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    /// @notice `initialize_config`: the deployer becomes admin, once.
    constructor(address token_, address relayer_, uint64 cancelTimeoutSecs_) {
        if (relayer_ == address(0)) revert InvalidRelayer();
        if (!_validTimeout(cancelTimeoutSecs_)) revert InvalidTimeout();
        if (IERC20Like(token_).decimals() != TOKEN_DECIMALS) revert WrongDecimals();
        admin = msg.sender;
        relayer = relayer_;
        token = IERC20Like(token_);
        cancelTimeoutSecs = cancelTimeoutSecs_;
    }

    // ================================================================ admin (allowed while paused)

    function setPaused(bool paused_) external {
        if (msg.sender != admin) revert Unauthorized();
        paused = paused_;
    }

    function setRelayer(address newRelayer) external {
        if (msg.sender != admin) revert Unauthorized();
        if (newRelayer == address(0)) revert InvalidRelayer();
        relayer = newRelayer;
    }

    /// Applies to FUTURE promos only (each promo snapshots the value at creation).
    function setCancelTimeout(uint64 secs) external {
        if (msg.sender != admin) revert Unauthorized();
        if (!_validTimeout(secs)) revert InvalidTimeout();
        cancelTimeoutSecs = secs;
    }

    // ================================================================ merchant

    /// `initialize_promo`. Blocked while paused.
    function initializePromo(uint64 promoNonce, uint64 offerAmount, uint64 depositDeadline, string calldata marketId)
        external
        nonReentrant
        returns (bytes32 promoId)
    {
        if (paused) revert Paused();
        promoId = promoIdOf(msg.sender, promoNonce);
        if (_promos[promoId].exists) revert PromoAlreadyExists();
        if (offerAmount == 0) revert InvalidOfferAmount();
        if (bytes(marketId).length == 0) revert EmptyMarketId();
        if (bytes(marketId).length > MAX_MARKET_ID_LEN) revert MarketIdTooLong();
        if (depositDeadline <= block.timestamp) revert InvalidDeadline();

        Promo storage p = _promos[promoId];
        p.merchant = msg.sender;
        p.promoNonce = promoNonce;
        p.offerAmount = offerAmount;
        p.depositDeadline = depositDeadline;
        p.marketId = marketId;
        p.state = PromoState.Active;
        p.cancelTimeoutSecs = cancelTimeoutSecs;
        p.exists = true;
        _promoIds.push(promoId);
    }

    // ================================================================ customer

    /// `deposit`: pulls exactly `offerAmount` (prior `approve` on the token required).
    function deposit(bytes32 promoId, bytes16 purchaseId, uint64 amount)
        external
        nonReentrant
        returns (bytes32 purchaseKey)
    {
        purchaseKey = _recordDeposit(promoId, purchaseId, msg.sender, amount);
        _pullExact(abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), amount)), amount);
    }

    /// v2 one-signature checkout (EIP-3009). The customer signs ONE `ReceiveWithAuthorization`
    /// (from = customer, to = this escrow, value = the exact offer, nonce = the purchase key
    /// `purchaseKeyOf(promoId, customer, purchaseId)`); anyone, normally the relayer, submits it
    /// and pays the gas. The nonce binding means a submitter cannot redirect the signature to
    /// another promo, purchase id or amount, and `receiveWithAuthorization` itself only lets this
    /// contract redeem it. The purchase's customer is `customer` (the signer), not msg.sender.
    function depositWithAuthorization(
        bytes32 promoId,
        bytes16 purchaseId,
        address customer,
        uint64 amount,
        uint256 validAfter,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (bytes32 purchaseKey) {
        if (customer == address(0)) revert Unauthorized();
        purchaseKey = _recordDeposit(promoId, purchaseId, customer, amount);
        _pullExact(
            abi.encodeCall(
                IERC3009Like.receiveWithAuthorization,
                (customer, address(this), amount, validAfter, validBefore, purchaseKey, v, r, s)
            ),
            amount
        );
    }

    /// v2 checkout with an EIP-2612 permit for exactly `amount` (the customer still sends the tx).
    /// If the permit was already used (front-run), an existing allowance >= amount is accepted.
    function depositWithPermit(
        bytes32 promoId,
        bytes16 purchaseId,
        uint64 amount,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (bytes32 purchaseKey) {
        purchaseKey = _recordDeposit(promoId, purchaseId, msg.sender, amount);
        IERC20PermitLike t = IERC20PermitLike(address(token));
        try t.permit(msg.sender, address(this), amount, permitDeadline, v, r, s) {}
        catch {
            if (t.allowance(msg.sender, address(this)) < amount) revert PermitFailed();
        }
        _pullExact(abi.encodeCall(IERC20Like.transferFrom, (msg.sender, address(this), amount)), amount);
    }

    /// `cancel_expired_deposit`: the purchase's customer, once `now >= depositedAt + timeout`.
    /// Allowed while paused and in any promo state. Never for Hedged purchases.
    function cancelExpiredDeposit(bytes32 purchaseKey) external nonReentrant {
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.customer != msg.sender) revert Unauthorized();
        _requireDepositedForCancel(u);
        Promo storage p = _promos[u.promo];
        uint256 releaseAt = uint256(u.depositedAt) + uint256(p.cancelTimeoutSecs);
        if (releaseAt > type(uint64).max) revert MathOverflow();
        uint64 nowTs = _now();
        if (nowTs < releaseAt) revert TimeoutNotElapsed();
        u.state = PurchaseState.Cancelled;
        u.cancelledAt = nowTs;
        emit PurchaseCancelledEvent(u.promo, purchaseKey, u.customer, u.amount, nowTs);
    }

    /// `claim_refund` (self-claim fallback to the automatic settlement): Cancelled -> Refunded (any
    /// promo state, allowed while paused); v2: Deposited on a resolved promo -> Refunded (allowed
    /// while paused: it can never be hedged any more); Hedged -> ClaimedByCustomer when the promo
    /// resolved YES (blocked while paused).
    function claimRefund(bytes32 purchaseKey) external nonReentrant {
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.customer != msg.sender) revert Unauthorized();
        Promo storage p = _promos[u.promo];
        (SettleStatus st, address to, PurchaseState next, ClaimKind kind) = _due(u, p);
        if (st == SettleStatus.AlreadySettled) revert AlreadyClaimed();
        if (st == SettleStatus.NotDue || kind == ClaimKind.MerchantPayout) revert InvalidState();
        if (st == SettleStatus.Paused) revert Paused();
        _settle(purchaseKey, u, p, to, next, kind);
    }

    /// `claim_merchant`: Hedged -> ClaimedByMerchant when the promo resolved NO, or (v2) VOID (the
    /// shop keeps the sale). Blocked while paused.
    function claimMerchant(bytes32 purchaseKey) external nonReentrant {
        if (paused) revert Paused();
        Purchase storage u = _existingPurchase(purchaseKey);
        Promo storage p = _promos[u.promo];
        if (p.merchant != msg.sender) revert Unauthorized();
        if (u.state == PurchaseState.Deposited || u.state == PurchaseState.Cancelled) revert InvalidState();
        (SettleStatus st, address to, PurchaseState next, ClaimKind kind) = _due(u, p);
        if (st == SettleStatus.AlreadySettled) revert AlreadyClaimed();
        if (st != SettleStatus.Payable || kind != ClaimKind.MerchantPayout) revert InvalidState();
        _settle(purchaseKey, u, p, to, next, kind);
    }

    // ================================================================ automatic settlement (v2, anyone)

    /// Push one purchase's exact amount to its entitled party (customer: Cancelled, unhedged after
    /// resolution, Hedged on YES; merchant: Hedged on NO or VOID). Reverts like the claims do:
    /// AlreadyClaimed (settled already), InvalidState (not due yet), Paused, TokenTransferFailed.
    function settlePurchase(bytes32 purchaseKey) external nonReentrant {
        Purchase storage u = _existingPurchase(purchaseKey);
        Promo storage p = _promos[u.promo];
        (SettleStatus st, address to, PurchaseState next, ClaimKind kind) = _due(u, p);
        if (st == SettleStatus.AlreadySettled) revert AlreadyClaimed();
        if (st == SettleStatus.NotDue) revert InvalidState();
        if (st == SettleStatus.Paused) revert Paused();
        _settle(purchaseKey, u, p, to, next, kind);
    }

    /// Batch version (at most MAX_SETTLE_BATCH keys, any promos). Never reverts for a single
    /// purchase: unknown, already settled, not yet due, paused, or refused by the token (emits
    /// SettlementFailed, state rolled back) are skipped. Returns how many were paid.
    function settlePurchases(bytes32[] calldata purchaseKeys) external nonReentrant returns (uint256 settled) {
        if (purchaseKeys.length > MAX_SETTLE_BATCH) revert BatchTooLarge();
        for (uint256 i = 0; i < purchaseKeys.length; i++) {
            if (_trySettle(purchaseKeys[i])) settled++;
        }
    }

    /// Settle a promo's purchases in deposit order, `limit` (capped at MAX_SETTLE_BATCH) starting at
    /// `offset`. Same skip rules as `settlePurchases`. Loop with `nextOffset` until it equals
    /// `purchaseCountOf(promoId)`.
    function settlePromo(bytes32 promoId, uint256 offset, uint256 limit)
        external
        nonReentrant
        returns (uint256 settled, uint256 nextOffset)
    {
        _existingPromo(promoId);
        bytes32[] storage all = _promoPurchases[promoId];
        if (limit > MAX_SETTLE_BATCH) limit = MAX_SETTLE_BATCH;
        if (offset >= all.length) return (0, all.length);
        nextOffset = offset + limit > all.length ? all.length : offset + limit;
        for (uint256 i = offset; i < nextOffset; i++) {
            if (_trySettle(all[i])) settled++;
        }
    }

    // ================================================================ relayer

    /// `mark_hedged`: Deposited -> Hedged; promo must be Active. Blocked while paused.
    function markHedged(bytes32 purchaseKey) external nonReentrant {
        if (msg.sender != relayer) revert Unauthorized();
        if (paused) revert Paused();
        Purchase storage u = _existingPurchase(purchaseKey);
        if (u.state == PurchaseState.Deposited) {
            // ok
        } else if (u.state == PurchaseState.Cancelled || u.state == PurchaseState.Refunded) {
            revert InvalidState();
        } else {
            revert AlreadyHedged();
        }
        if (_promos[u.promo].state != PromoState.Active) revert PromoNotActive();
        uint64 nowTs = _now();
        u.state = PurchaseState.Hedged;
        u.hedgedAt = nowTs;
        emit HedgeMarkedEvent(u.promo, purchaseKey, msg.sender, nowTs);
    }

    /// `cancel_unhedged`: Deposited -> Cancelled (refund entitlement for the customer). Allowed
    /// while paused and in any promo state: it can only return a customer's own funds.
    function cancelUnhedged(bytes32 purchaseKey) external nonReentrant {
        if (msg.sender != relayer) revert Unauthorized();
        Purchase storage u = _existingPurchase(purchaseKey);
        _requireDepositedForCancel(u);
        uint64 nowTs = _now();
        u.state = PurchaseState.Cancelled;
        u.cancelledAt = nowTs;
        emit PurchaseCancelledEvent(u.promo, purchaseKey, u.customer, u.amount, nowTs);
    }

    /// `resolve_promo`: Active -> ResolvedYes|ResolvedNo|ResolvedVoid exactly once, only at/after
    /// the deposit deadline. Check order: Unauthorized -> Paused -> AlreadyResolved -> ResolutionTooEarly.
    function resolvePromo(bytes32 promoId, Outcome outcome) external nonReentrant {
        if (msg.sender != relayer) revert Unauthorized();
        if (paused) revert Paused();
        Promo storage p = _existingPromo(promoId);
        if (p.state != PromoState.Active) revert AlreadyResolved();
        uint64 nowTs = _now();
        if (nowTs < p.depositDeadline) revert ResolutionTooEarly();
        p.state = outcome == Outcome.Yes
            ? PromoState.ResolvedYes
            : outcome == Outcome.No ? PromoState.ResolvedNo : PromoState.ResolvedVoid;
        p.resolvedAt = nowTs;
        emit ResolutionEvent(promoId, outcome, msg.sender, nowTs);
    }

    // ================================================================ views

    function promoIdOf(address merchant, uint64 promoNonce) public pure returns (bytes32) {
        return keccak256(abi.encode("promo", merchant, promoNonce));
    }

    function purchaseKeyOf(bytes32 promoId, address customer, bytes16 purchaseId) public pure returns (bytes32) {
        return keccak256(abi.encode("purchase", promoId, customer, purchaseId));
    }

    function getPromo(bytes32 promoId) external view returns (Promo memory) {
        return _promos[promoId];
    }

    function getPurchase(bytes32 purchaseKey) external view returns (Purchase memory) {
        return _purchases[purchaseKey];
    }

    /// Outstanding liability = deposits not yet paid out.
    function outstanding(bytes32 promoId) external view returns (uint64) {
        Promo storage p = _promos[promoId];
        return p.totalDeposited - p.totalPaidOut;
    }

    function purchaseCountOf(bytes32 promoId) external view returns (uint256) {
        return _promoPurchases[promoId].length;
    }

    function purchaseKeysOf(bytes32 promoId, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory out)
    {
        bytes32[] storage all = _promoPurchases[promoId];
        if (offset >= all.length) return new bytes32[](0);
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        out = new bytes32[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            out[i - offset] = all[i];
        }
    }

    /// v2: what an automatic settlement would do for this purchase right now (recipient and amount
    /// are only meaningful when status is Payable or Paused).
    function previewSettlement(bytes32 purchaseKey)
        external
        view
        returns (SettleStatus status, address recipient, uint64 amount, ClaimKind kind)
    {
        Purchase storage u = _purchases[purchaseKey];
        if (!u.exists) return (SettleStatus.NotFound, address(0), 0, ClaimKind.CancelRefund);
        (status, recipient,, kind) = _due(u, _promos[u.promo]);
        amount = u.amount;
    }

    function promoCount() external view returns (uint256) {
        return _promoIds.length;
    }

    function promoIdAt(uint256 i) external view returns (bytes32) {
        return _promoIds[i];
    }

    // ================================================================ internal

    /// The single entitlement rule used by the claims and the automatic settlement.
    function _due(Purchase storage u, Promo storage p)
        private
        view
        returns (SettleStatus st, address to, PurchaseState next, ClaimKind kind)
    {
        PurchaseState s = u.state;
        if (s == PurchaseState.Refunded || s == PurchaseState.ClaimedByCustomer || s == PurchaseState.ClaimedByMerchant)
        return (SettleStatus.AlreadySettled, address(0), s, ClaimKind.CancelRefund);
        if (s == PurchaseState.Cancelled) {
            return (SettleStatus.Payable, u.customer, PurchaseState.Refunded, ClaimKind.CancelRefund);
        }
        if (p.state == PromoState.Active) return (SettleStatus.NotDue, address(0), s, ClaimKind.CancelRefund);
        if (s == PurchaseState.Deposited) {
            // Never hedged and can no longer be (markHedged needs Active): refund under any outcome.
            return (SettleStatus.Payable, u.customer, PurchaseState.Refunded, ClaimKind.CancelRefund);
        }
        // Hedged: the payout depends on the outcome, so it waits while the admin pause is on.
        if (p.state == PromoState.ResolvedYes) {
            (to, next, kind) = (u.customer, PurchaseState.ClaimedByCustomer, ClaimKind.YesRefund);
        } else {
            // NO, or VOID ("nobody wins, the shop keeps the sale")
            (to, next, kind) = (p.merchant, PurchaseState.ClaimedByMerchant, ClaimKind.MerchantPayout);
        }
        st = paused ? SettleStatus.Paused : SettleStatus.Payable;
    }

    /// Checks done by the caller. Effects, then the exact-amount transfer (reverts on failure).
    function _settle(
        bytes32 purchaseKey,
        Purchase storage u,
        Promo storage p,
        address to,
        PurchaseState next,
        ClaimKind kind
    ) private {
        uint64 amount = u.amount;
        uint64 nowTs = _now();
        u.state = next;
        u.settledAt = nowTs;
        uint64 totalPaidOut = _add(p.totalPaidOut, amount);
        if (totalPaidOut > p.totalDeposited) revert InsufficientVaultFunds();
        uint256 before = token.balanceOf(address(this));
        if (before < amount) revert InsufficientVaultFunds();
        p.totalPaidOut = totalPaidOut;
        _call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
        if (before - token.balanceOf(address(this)) != amount) revert TokenTransferFailed();
        emit ClaimEvent(u.promo, purchaseKey, to, amount, kind, nowTs);
    }

    /// Batch variant: skips instead of reverting; a token-refused transfer rolls the effects back.
    function _trySettle(bytes32 purchaseKey) private returns (bool) {
        Purchase storage u = _purchases[purchaseKey];
        if (!u.exists) return false;
        Promo storage p = _promos[u.promo];
        (SettleStatus st, address to, PurchaseState next, ClaimKind kind) = _due(u, p);
        if (st != SettleStatus.Payable) return false;
        uint64 amount = u.amount;
        uint64 totalPaidOut = _add(p.totalPaidOut, amount);
        if (totalPaidOut > p.totalDeposited) revert InsufficientVaultFunds();
        PurchaseState prevState = u.state; // a payable purchase has settledAt == 0
        // effects
        u.state = next;
        u.settledAt = _now();
        p.totalPaidOut = totalPaidOut;
        // interaction
        if (!_tryTransfer(to, amount)) {
            u.state = prevState;
            u.settledAt = 0;
            p.totalPaidOut = totalPaidOut - amount;
            emit SettlementFailed(u.promo, purchaseKey, to, amount);
            return false;
        }
        emit ClaimEvent(u.promo, purchaseKey, to, amount, kind, _now());
        return true;
    }

    /// Transfer that reports a token refusal (false / revert, nothing moved) instead of reverting.
    /// Reverts if the vault balance moved by anything other than exactly `amount` on success, or
    /// at all on a "failure".
    function _tryTransfer(address to, uint64 amount) private returns (bool) {
        uint256 before = token.balanceOf(address(this));
        if (before < amount) revert InsufficientVaultFunds();
        (bool ok, bytes memory ret) = address(token).call(abi.encodeCall(IERC20Like.transfer, (to, amount)));
        uint256 afterBal = token.balanceOf(address(this));
        if (!(ok && _returnedTrue(ret))) {
            if (afterBal != before) revert TokenTransferFailed();
            return false;
        }
        if (afterBal + amount != before) revert TokenTransferFailed();
        return true;
    }

    /// Validation + effects shared by every deposit path (the single place a future per-customer
    /// limit or deposit-side fee would go). Emits DepositEvent; the caller pulls the tokens.
    function _recordDeposit(bytes32 promoId, bytes16 purchaseId, address customer, uint64 amount)
        private
        returns (bytes32 purchaseKey)
    {
        if (paused) revert Paused();
        Promo storage p = _existingPromo(promoId);
        if (p.state != PromoState.Active) revert PromoNotActive();
        purchaseKey = purchaseKeyOf(promoId, customer, purchaseId);
        if (_purchases[purchaseKey].exists) revert PurchaseAlreadyExists();
        uint64 nowTs = _now();
        if (!(nowTs < p.depositDeadline)) revert DepositClosed();
        if (amount != p.offerAmount) revert WrongAmount();
        uint64 totalDeposited = _add(p.totalDeposited, amount);
        uint64 purchaseCount = _add(p.purchaseCount, 1);

        p.totalDeposited = totalDeposited;
        p.purchaseCount = purchaseCount;
        _purchases[purchaseKey] = Purchase({
            promo: promoId,
            customer: customer,
            purchaseId: purchaseId,
            amount: amount,
            state: PurchaseState.Deposited,
            depositedAt: nowTs,
            hedgedAt: 0,
            cancelledAt: 0,
            settledAt: 0,
            exists: true
        });
        _promoPurchases[promoId].push(purchaseKey);
        emit DepositEvent(promoId, purchaseKey, customer, purchaseId, amount, nowTs);
    }

    /// Exact-amount pull (rejects fee-on-transfer / short transfers).
    function _pullExact(bytes memory data, uint64 amount) private {
        uint256 before = token.balanceOf(address(this));
        _call(data);
        if (token.balanceOf(address(this)) - before != amount) revert TokenTransferFailed();
    }

    function _returnedTrue(bytes memory ret) private pure returns (bool) {
        if (ret.length == 0) return true;
        if (ret.length != 32) return false;
        return abi.decode(ret, (uint256)) == 1;
    }

    function _requireDepositedForCancel(Purchase storage u) private view {
        if (u.state == PurchaseState.Deposited) return;
        if (u.state == PurchaseState.Cancelled || u.state == PurchaseState.Refunded) revert AlreadyCancelled();
        revert InvalidState();
    }

    function _existingPromo(bytes32 promoId) private view returns (Promo storage p) {
        p = _promos[promoId];
        if (!p.exists) revert AccountNotFound();
    }

    function _existingPurchase(bytes32 purchaseKey) private view returns (Purchase storage u) {
        u = _purchases[purchaseKey];
        if (!u.exists) revert AccountNotFound();
    }

    /// SafeERC20-style call: reverts on failure, accepts tokens that return nothing.
    function _call(bytes memory data) private {
        (bool ok, bytes memory ret) = address(token).call(data);
        if (!ok || !_returnedTrue(ret)) revert TokenTransferFailed();
    }

    function _add(uint64 a, uint64 b) private pure returns (uint64) {
        uint256 s = uint256(a) + uint256(b);
        if (s > type(uint64).max) revert MathOverflow();
        return uint64(s);
    }

    function _now() private view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _validTimeout(uint64 secs) private pure returns (bool) {
        return secs >= MIN_CANCEL_TIMEOUT_SECS && secs <= MAX_CANCEL_TIMEOUT_SECS;
    }
}

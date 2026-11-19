// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";

/// Token whose `transfer` re-enters the escrow (settlePurchase / settlePurchases / claimRefund).
contract ReenteringToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    HedgedEscrow public target;
    bytes32 public key;
    uint8 public mode; // 0 off, 1 settlePurchase, 2 settlePurchases, 3 claimRefund

    function arm(HedgedEscrow t, bytes32 k, uint8 m) external {
        (target, key, mode) = (t, k, m);
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        balanceOf[from] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        uint8 m = mode;
        if (m != 0) {
            mode = 0;
            if (m == 1) target.settlePurchase(key);
            if (m == 2) {
                bytes32[] memory ks = new bytes32[](1);
                ks[0] = key;
                target.settlePurchases(ks);
            }
            if (m == 3) target.claimRefund(key);
        }
        return true;
    }
}

/// USDC-like blocklist: transfers to a blocked address return false (or revert), nothing moves.
/// `lie` makes it return false AFTER moving the funds (must stop the whole batch).
contract BlockingToken {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => bool) public blocked;
    bool public revertInstead;
    bool public lie;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function setModes(bool r, bool l) external {
        (revertInstead, lie) = (r, l);
    }

    function transferFrom(address from, address to, uint256 a) external returns (bool) {
        balanceOf[from] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        if (lie) {
            balanceOf[msg.sender] -= a;
            balanceOf[to] += a;
            return false;
        }
        if (blocked[to]) {
            require(!revertInstead, "blocked");
            return false;
        }
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// v2: automatic settlement (push payouts), VOID outcome, exactly-once against the self-claims.
contract AutoSettleTest is EscrowFixture {
    bytes32 internal p;
    address internal keeper = vm.addr(0x4EE9E7); // a random third party: settlement is permissionless

    HedgedEscrow.PurchaseState constant DEP = HedgedEscrow.PurchaseState.Deposited;
    HedgedEscrow.PurchaseState constant REF = HedgedEscrow.PurchaseState.Refunded;
    HedgedEscrow.PurchaseState constant CUS = HedgedEscrow.PurchaseState.ClaimedByCustomer;
    HedgedEscrow.PurchaseState constant MER = HedgedEscrow.PurchaseState.ClaimedByMerchant;

    function setUp() public override {
        super.setUp();
        p = _promo();
    }

    function _settle(bytes32 k) internal {
        vm.prank(keeper);
        esc.settlePurchase(k);
    }

    function _keys(bytes32 a, bytes32 b, bytes32 c) internal pure returns (bytes32[] memory ks) {
        ks = new bytes32[](3);
        (ks[0], ks[1], ks[2]) = (a, b, c);
    }

    // ---------------------------------------------------------- single settlement per outcome

    function test_auto_yes_paysCustomer() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 m0 = usdc.balanceOf(merchant);
        _settle(k);
        assertEq(usdc.balanceOf(alice), a0 + OFFER, "customer refunded");
        assertEq(usdc.balanceOf(merchant), m0, "merchant untouched");
        assertEq(usdc.balanceOf(keeper), 0, "keeper gets nothing");
        assertEq(uint8(_pstate(k)), uint8(CUS), "ClaimedByCustomer");
        assertEq(esc.outstanding(p), 0, "paid out");
    }

    function test_auto_no_paysMerchant() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 m0 = usdc.balanceOf(merchant);
        _settle(k);
        assertEq(usdc.balanceOf(merchant), m0 + OFFER, "merchant paid");
        assertEq(usdc.balanceOf(alice), a0, "customer untouched");
        assertEq(uint8(_pstate(k)), uint8(MER), "ClaimedByMerchant");
    }

    function test_auto_cancelled_refundsAnyPromoStateAndWhilePaused() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _cancel(k);
        esc.setPaused(true);
        uint256 a0 = usdc.balanceOf(alice);
        _settle(k); // promo still Active, contract paused: a cancel refund always goes through
        assertEq(usdc.balanceOf(alice), a0 + OFFER, "refunded");
        assertEq(uint8(_pstate(k)), uint8(REF), "Refunded");
    }

    function test_auto_unhedgedAfterYesOrNo_refundsCustomer() public {
        bytes32 a = _deposit(p, alice, _id(0));
        bytes32 p2 = _promo(merchant, 2);
        bytes32 b = _deposit(p2, bob, _id(0));
        vm.warp(deadline);
        vm.startPrank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        esc.resolvePromo(p2, HedgedEscrow.Outcome.No);
        vm.stopPrank();
        uint256 a0 = usdc.balanceOf(alice);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 m0 = usdc.balanceOf(merchant);
        _settle(a);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector); // never the merchant's: never hedged
        esc.claimMerchant(b);
        vm.prank(bob);
        esc.claimRefund(b); // self-claim fallback for the same rule
        assertEq(usdc.balanceOf(alice), a0 + OFFER, "alice refunded");
        assertEq(usdc.balanceOf(bob), b0 + OFFER, "bob refunded");
        assertEq(usdc.balanceOf(merchant), m0, "merchant got nothing");
        assertEq(uint8(_pstate(a)), uint8(REF), "a Refunded");
        assertEq(uint8(_pstate(b)), uint8(REF), "b Refunded");
    }

    function test_auto_notDueWhileActive() public {
        bytes32 d = _deposit(p, alice, _id(0));
        bytes32 h = _deposit(p, bob, _id(0));
        _hedge(h);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.settlePurchase(d);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.settlePurchase(h);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.AccountNotFound.selector);
        esc.settlePurchase(bytes32(uint256(123)));
    }

    function test_auto_hedgedBlockedWhilePaused() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        esc.setPaused(true);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.settlePurchase(k);
        bytes32[] memory ks = new bytes32[](1);
        ks[0] = k;
        vm.prank(keeper);
        assertEq(esc.settlePurchases(ks), 0, "batch skips while paused");
        assertEq(uint8(_pstate(k)), uint8(HedgedEscrow.PurchaseState.Hedged), "still hedged");
        esc.setPaused(false);
        _settle(k);
        assertEq(uint8(_pstate(k)), uint8(CUS), "paid after unpause");
    }

    function test_preview() public {
        bytes32 h = _deposit(p, alice, _id(0));
        bytes32 d = _deposit(p, bob, _id(0));
        _hedge(h);
        (HedgedEscrow.SettleStatus st,,,) = esc.previewSettlement(h);
        assertEq(uint8(st), uint8(HedgedEscrow.SettleStatus.NotDue), "not due while active");
        (st,,,) = esc.previewSettlement(bytes32(uint256(9)));
        assertEq(uint8(st), uint8(HedgedEscrow.SettleStatus.NotFound), "not found");
        _resolve(p, HedgedEscrow.Outcome.No);
        (HedgedEscrow.SettleStatus s2, address to, uint64 amt, HedgedEscrow.ClaimKind kind) = esc.previewSettlement(h);
        assertEq(uint8(s2), uint8(HedgedEscrow.SettleStatus.Payable), "payable");
        assertEq(to, merchant, "to merchant");
        assertEq(amt, OFFER, "amount");
        assertEq(uint8(kind), uint8(HedgedEscrow.ClaimKind.MerchantPayout), "kind");
        (, to,, kind) = esc.previewSettlement(d);
        assertEq(to, bob, "unhedged -> customer");
        assertEq(uint8(kind), uint8(HedgedEscrow.ClaimKind.CancelRefund), "refund kind");
        _settle(h);
        (st,,,) = esc.previewSettlement(h);
        assertEq(uint8(st), uint8(HedgedEscrow.SettleStatus.AlreadySettled), "settled");
    }

    // ---------------------------------------------------------- VOID

    function test_void_hedgedToMerchant_unhedgedAndCancelledToCustomer() public {
        bytes32 h = _deposit(p, alice, _id(0));
        bytes32 d = _deposit(p, bob, _id(0));
        bytes32 c = _deposit(p, mallory, _id(0));
        _hedge(h);
        _cancel(c);
        vm.recordLogs();
        _resolve(p, HedgedEscrow.Outcome.Void);
        assertEq(uint8(_promoState(p)), uint8(HedgedEscrow.PromoState.ResolvedVoid), "ResolvedVoid");
        assertEq(uint256(vm.getRecordedLogs()[0].topics[0]), uint256(HedgedEscrow.ResolutionEvent.selector), "event");
        uint256 m0 = usdc.balanceOf(merchant);
        uint256 b0 = usdc.balanceOf(bob);
        uint256 c0 = usdc.balanceOf(mallory);
        uint256 a0 = usdc.balanceOf(alice);
        vm.prank(keeper);
        (uint256 n, uint256 next) = esc.settlePromo(p, 0, 50);
        assertEq(n, 3, "all three settled");
        assertEq(next, 3, "next = count");
        assertEq(usdc.balanceOf(merchant), m0 + OFFER, "shop keeps the hedged sale");
        assertEq(usdc.balanceOf(bob), b0 + OFFER, "unhedged refunded");
        assertEq(usdc.balanceOf(mallory), c0 + OFFER, "cancelled refunded");
        assertEq(usdc.balanceOf(alice), a0, "hedged customer gets nothing on VOID");
        assertEq(uint8(_pstate(h)), uint8(MER), "h ClaimedByMerchant");
        assertEq(uint8(_pstate(d)), uint8(REF), "d Refunded");
        assertEq(uint8(_pstate(c)), uint8(REF), "c Refunded");
        assertEq(usdc.balanceOf(address(esc)), 0, "vault empty");
    }

    function test_void_selfClaimFallbacks() public {
        bytes32 h = _deposit(p, alice, _id(0));
        bytes32 d = _deposit(p, bob, _id(0));
        _hedge(h);
        _resolve(p, HedgedEscrow.Outcome.Void);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.InvalidState.selector); // the customer cannot take the shop's VOID payout
        esc.claimRefund(h);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.InvalidState.selector);
        esc.claimMerchant(d);
        vm.prank(merchant);
        esc.claimMerchant(h);
        vm.prank(bob);
        esc.claimRefund(d);
        assertEq(uint8(_pstate(h)), uint8(MER), "merchant claimed");
        assertEq(uint8(_pstate(d)), uint8(REF), "refunded");
    }

    function test_void_rules_relayerOnlyAfterDeadlineOnceNoSwitch() public {
        bytes32 p2 = _promo(merchant, 2);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.ResolutionTooEarly.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Void);
        vm.warp(deadline);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Void);
        vm.prank(relayer);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Void);
        vm.startPrank(relayer);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Yes);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p, HedgedEscrow.Outcome.Void);
        esc.resolvePromo(p2, HedgedEscrow.Outcome.No);
        vm.expectRevert(HedgedEscrow.AlreadyResolved.selector);
        esc.resolvePromo(p2, HedgedEscrow.Outcome.Void);
        vm.stopPrank();
        assertEq(uint8(_promoState(p2)), uint8(HedgedEscrow.PromoState.ResolvedNo), "NO kept");
    }

    function test_void_blockedWhilePausedForHedged() public {
        bytes32 h = _deposit(p, alice, _id(0));
        bytes32 d = _deposit(p, bob, _id(0));
        _hedge(h);
        _resolve(p, HedgedEscrow.Outcome.Void);
        esc.setPaused(true);
        vm.prank(merchant);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.claimMerchant(h);
        vm.prank(keeper);
        assertEq(esc.settlePurchases(_keys(h, d, d)), 1, "only the unhedged refund moves while paused");
        assertEq(uint8(_pstate(h)), uint8(HedgedEscrow.PurchaseState.Hedged), "hedged waits");
    }

    // ---------------------------------------------------------- batches

    function test_batch_mixedAndIdempotent() public {
        bytes32 yes = _deposit(p, alice, _id(0));
        bytes32 can = _deposit(p, bob, _id(0));
        bytes32 dep = _deposit(p, mallory, _id(0));
        bytes32 pOpen = _promo(merchant2, 1);
        bytes32 open = _deposit(pOpen, alice, _id(1)); // promo still Active: not due
        _hedge(yes);
        _cancel(can);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        vm.prank(bob);
        esc.claimRefund(can); // already settled by self-claim before the batch
        bytes32[] memory ks = new bytes32[](6);
        (ks[0], ks[1], ks[2], ks[3], ks[4], ks[5]) = (yes, can, dep, open, bytes32(uint256(77)), yes);
        uint256 vault0 = usdc.balanceOf(address(esc));
        vm.prank(keeper);
        assertEq(esc.settlePurchases(ks), 2, "yes + unhedged paid once each (dup key ignored)");
        assertEq(vault0 - usdc.balanceOf(address(esc)), 2 * OFFER, "exactly two payouts");
        assertEq(uint8(_pstate(open)), uint8(DEP), "open promo untouched");
        vm.prank(keeper);
        assertEq(esc.settlePurchases(ks), 0, "rerun pays nothing and does not revert");
        bytes32[] memory p2 = new bytes32[](2);
        p2[0] = pOpen;
        p2[1] = p;
        _assertConserved(p2);
    }

    function test_batch_boundedAndPaged() public {
        bytes32[] memory big = new bytes32[](51);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.BatchTooLarge.selector);
        esc.settlePurchases(big);
        for (uint256 i = 0; i < 60; i++) {
            _deposit(p, alice, _id(100 + i));
        }
        _resolve(p, HedgedEscrow.Outcome.No); // all unhedged -> refunds
        vm.prank(keeper);
        (uint256 n, uint256 next) = esc.settlePromo(p, 0, 500); // limit capped at 50
        assertEq(n, 50, "first page capped");
        assertEq(next, 50, "next offset");
        vm.prank(keeper);
        (n, next) = esc.settlePromo(p, next, 50);
        assertEq(n, 10, "rest");
        assertEq(next, 60, "end");
        vm.prank(keeper);
        (n, next) = esc.settlePromo(p, 60, 50);
        assertEq(n + next, 60, "past the end: nothing, next = count");
        vm.prank(keeper);
        (n,) = esc.settlePromo(p, 0, 50);
        assertEq(n, 0, "idempotent");
        assertEq(esc.outstanding(p), 0, "all refunded");
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.AccountNotFound.selector);
        esc.settlePromo(bytes32(uint256(5)), 0, 1);
    }

    // ---------------------------------------------------------- exactly once vs self-claims

    function test_race_autoThenSelfClaim() public {
        bytes32 y = _deposit(p, alice, _id(0));
        bytes32 n = _deposit(p, bob, _id(0));
        bytes32 c = _deposit(p, mallory, _id(0));
        _hedge(y);
        _cancel(c);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        _settle(y);
        _settle(c);
        vm.prank(alice);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(y);
        vm.prank(mallory);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.claimRefund(c);
        vm.prank(bob);
        esc.claimRefund(n);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.settlePurchase(n);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.settlePurchase(y);
        assertEq(usdc.balanceOf(address(esc)), 0, "three deposits, three payouts");
    }

    function test_race_merchantClaimThenAuto() public {
        bytes32 k = _deposit(p, alice, _id(0));
        _hedge(k);
        _resolve(p, HedgedEscrow.Outcome.No);
        vm.prank(merchant);
        esc.claimMerchant(k);
        bytes32[] memory ks = new bytes32[](1);
        ks[0] = k;
        vm.prank(keeper);
        assertEq(esc.settlePurchases(ks), 0, "nothing left");
        vm.prank(keeper);
        (uint256 s,) = esc.settlePromo(p, 0, 10);
        assertEq(s, 0, "nothing left via promo either");
        assertEq(esc.getPromo(p).totalPaidOut, OFFER, "paid once");
    }

    /// Whoever calls, money only ever reaches the entitled party, once.
    function testFuzz_settle_onlyEntitledRecipient(address caller, uint8 outcome, uint8 path) public {
        vm.assume(caller != address(0) && caller != address(esc));
        vm.assume(caller != alice && caller != merchant && caller != address(vm));
        bytes32 k = _deposit(p, alice, _id(0));
        if (path % 3 == 0) _hedge(k);
        else if (path % 3 == 1) _cancel(k);
        HedgedEscrow.Outcome o = HedgedEscrow.Outcome(outcome % 3);
        _resolve(p, o);
        uint256 a0 = usdc.balanceOf(alice);
        uint256 m0 = usdc.balanceOf(merchant);
        uint256 c0 = usdc.balanceOf(caller);
        vm.prank(caller);
        esc.settlePurchase(k);
        bool toMerchant = path % 3 == 0 && o != HedgedEscrow.Outcome.Yes;
        assertEq(usdc.balanceOf(caller), c0, "caller gains nothing");
        assertEq(usdc.balanceOf(merchant), m0 + (toMerchant ? OFFER : 0), "merchant share");
        assertEq(usdc.balanceOf(alice), a0 + (toMerchant ? 0 : OFFER), "customer share");
        vm.prank(caller);
        vm.expectRevert(HedgedEscrow.AlreadyClaimed.selector);
        esc.settlePurchase(k);
    }

    // ---------------------------------------------------------- hostile tokens

    function test_reentrancy_settleAndBatch() public {
        ReenteringToken t = new ReenteringToken();
        HedgedEscrow e = new HedgedEscrow(address(t), relayer, TIMEOUT);
        vm.prank(merchant);
        bytes32 pr = e.initializePromo(1, OFFER, deadline, "m");
        t.mint(alice, 3 * OFFER);
        bytes32[3] memory k;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(alice);
            k[i] = e.deposit(pr, _id(i), OFFER);
            vm.prank(relayer);
            e.cancelUnhedged(k[i]);
        }
        // single settle re-entering settlePurchase: the inner call hits the guard, the transfer
        // reverts, the whole settle reverts
        t.arm(e, k[1], 1);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        e.settlePurchase(k[0]);
        // batch: the re-entering transfer fails, so that purchase is skipped and rolled back
        t.arm(e, k[1], 2);
        bytes32[] memory ks = new bytes32[](1);
        ks[0] = k[0];
        vm.prank(keeper);
        assertEq(e.settlePurchases(ks), 0, "re-entered transfer skipped");
        assertEq(uint8(e.getPurchase(k[0]).state), uint8(HedgedEscrow.PurchaseState.Cancelled), "rolled back");
        assertEq(e.getPromo(pr).totalPaidOut, 0, "accounting rolled back");
        assertEq(t.balanceOf(address(e)), 3 * OFFER, "nothing left the vault");
        // claimRefund re-entry from a settle
        t.arm(e, k[2], 3);
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        e.settlePurchase(k[0]);
        // disarmed (a reverted transfer also reverted its own `mode = 0`): everything pays exactly once
        t.arm(e, bytes32(0), 0);
        vm.prank(keeper);
        assertEq(e.settlePurchases(_keys(k[0], k[1], k[2])), 3, "all paid");
        assertEq(t.balanceOf(alice), 3 * OFFER, "exactly the deposits");
        assertEq(t.balanceOf(address(e)), 0, "vault empty");
    }

    function test_blockedRecipient_skippedInBatchStaysPayable() public {
        BlockingToken t = new BlockingToken();
        HedgedEscrow e = new HedgedEscrow(address(t), relayer, TIMEOUT);
        vm.prank(merchant);
        bytes32 pr = e.initializePromo(1, OFFER, deadline, "m");
        t.mint(alice, OFFER);
        t.mint(bob, OFFER);
        vm.prank(alice);
        bytes32 ka = e.deposit(pr, _id(0), OFFER);
        vm.prank(bob);
        bytes32 kb = e.deposit(pr, _id(0), OFFER);
        vm.warp(deadline);
        vm.prank(relayer);
        e.resolvePromo(pr, HedgedEscrow.Outcome.No); // both unhedged -> refunds
        t.setBlocked(alice, true);
        bytes32[] memory ks = new bytes32[](2);
        (ks[0], ks[1]) = (ka, kb);
        vm.prank(keeper);
        assertEq(e.settlePurchases(ks), 1, "bob paid, alice skipped");
        assertEq(uint8(e.getPurchase(ka).state), uint8(DEP), "alice untouched");
        assertEq(e.getPromo(pr).totalPaidOut, OFFER, "only bob counted");
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        e.settlePurchase(ka); // single path reverts
        t.setModes(true, false); // reverting blocklist behaves the same in a batch
        vm.prank(keeper);
        assertEq(e.settlePurchases(ks), 0, "still skipped");
        t.setBlocked(alice, false);
        vm.prank(keeper);
        assertEq(e.settlePurchases(ks), 1, "paid once unblocked");
        assertEq(t.balanceOf(alice), OFFER, "alice refunded exactly once");
    }

    function test_lyingToken_stopsBatch() public {
        BlockingToken t = new BlockingToken();
        HedgedEscrow e = new HedgedEscrow(address(t), relayer, TIMEOUT);
        vm.prank(merchant);
        bytes32 pr = e.initializePromo(1, OFFER, deadline, "m");
        t.mint(alice, OFFER);
        vm.prank(alice);
        bytes32 ka = e.deposit(pr, _id(0), OFFER);
        vm.prank(relayer);
        e.cancelUnhedged(ka);
        t.setModes(false, true);
        bytes32[] memory ks = new bytes32[](1);
        ks[0] = ka;
        vm.prank(keeper);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        e.settlePurchases(ks);
    }
}

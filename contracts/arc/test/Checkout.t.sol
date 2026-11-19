// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EscrowFixture} from "./Base.t.sol";
import {HedgedEscrow} from "../src/HedgedEscrow.sol";
import {Vm} from "./utils/Vm.sol";

/// v2 one-signature checkout: EIP-3009 `depositWithAuthorization` (relayer submits) and EIP-2612
/// `depositWithPermit`, against MockUSDC (same type hashes / domain layout as Arc's FiatToken).
contract CheckoutTest is EscrowFixture {
    uint256 internal constant DAN_PK = 0xD00D; // fresh customer: no approval ever given
    address internal dan;
    bytes32 internal p;

    function setUp() public override {
        super.setUp();
        dan = vm.addr(DAN_PK);
        usdc.mint(dan, 100 * 1e6);
        p = _promo();
    }

    function _digest(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
    }

    function _signAuth(uint256 pk, address to, uint256 value, uint256 validBefore, bytes32 nonce)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        bytes32 h = keccak256(
            abi.encode(usdc.RECEIVE_WITH_AUTHORIZATION_TYPEHASH(), vm.addr(pk), to, value, 0, validBefore, nonce)
        );
        return vm.sign(pk, _digest(h));
    }

    function _signPermit(uint256 pk, uint256 value, uint256 dl) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        address owner = vm.addr(pk);
        bytes32 h = keccak256(abi.encode(usdc.PERMIT_TYPEHASH(), owner, address(esc), value, usdc.nonces(owner), dl));
        return vm.sign(pk, _digest(h));
    }

    function _authDeposit(bytes16 id, address customer, uint64 amount, uint8 v, bytes32 r, bytes32 s)
        internal
        returns (bytes32)
    {
        vm.prank(relayer);
        return esc.depositWithAuthorization(p, id, customer, amount, 0, deadline, v, r, s);
    }

    // ---------------------------------------------------------- EIP-3009

    function test_auth_relayerSubmits_customerIsSigner() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        uint256 d0 = usdc.balanceOf(dan);
        uint256 rl0 = usdc.balanceOf(relayer);
        vm.recordLogs();
        bytes32 got = _authDeposit(id, dan, OFFER, v, r, s);
        assertEq(got, key, "purchase key = 3009 nonce");
        HedgedEscrow.Purchase memory u = esc.getPurchase(key);
        assertEq(u.customer, dan, "customer is the signer, not the relayer");
        assertEq(u.amount, OFFER, "amount");
        assertEq(uint8(u.state), uint8(HedgedEscrow.PurchaseState.Deposited), "Deposited");
        assertEq(usdc.balanceOf(dan), d0 - OFFER, "pulled from the signer");
        assertEq(usdc.balanceOf(relayer), rl0, "relayer pays no USDC (only gas)");
        assertEq(usdc.allowance(dan, address(esc)), 0, "no approval needed");
        assertTrue(usdc.authorizationState(dan, key), "authorization consumed");
        // DepositEvent carries the signer as customer (topic 3)
        bool found;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == HedgedEscrow.DepositEvent.selector) {
                found = address(uint160(uint256(logs[i].topics[3]))) == dan;
            }
        }
        assertTrue(found, "DepositEvent.customer = signer");
    }

    function test_auth_fullLifecycle_autoRefundOnYes() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        _authDeposit(id, dan, OFFER, v, r, s);
        _hedge(key);
        _resolve(p, HedgedEscrow.Outcome.Yes);
        uint256 d0 = usdc.balanceOf(dan);
        vm.prank(relayer);
        esc.settlePurchase(key);
        assertEq(usdc.balanceOf(dan), d0 + OFFER, "refund to the signer");
    }

    function test_auth_cannotRebindSignature() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        // another purchase id
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p, _id(1), dan, OFFER, 0, deadline, v, r, s);
        // another promo with the same price
        bytes32 p2 = _promo(merchant2, 1);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p2, id, dan, OFFER, 0, deadline, v, r, s);
        // another customer (bob claims dan's signature)
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p, id, bob, OFFER, 0, deadline, v, r, s);
        // a different validity window than signed
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline + 1, v, r, s);
        // the genuine one still works exactly once
        _authDeposit(id, dan, OFFER, v, r, s);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.PurchaseAlreadyExists.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline, v, r, s);
        assertEq(esc.getPromo(p).totalDeposited, OFFER, "one deposit");
        assertEq(esc.getPromo(p2).totalDeposited, 0, "other promo untouched");
    }

    function test_auth_tokenRejectsDirectRedeemAndWrongPayee() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        // a front-runner calling the token directly cannot redeem an authorization made out to the escrow
        vm.prank(mallory);
        vm.expectRevert(bytes("FiatTokenV2: caller must be the payee"));
        usdc.receiveWithAuthorization(dan, address(esc), OFFER, 0, deadline, key, v, r, s);
        // a signature made out to someone else is useless to the escrow
        (v, r, s) = _signAuth(DAN_PK, mallory, OFFER, deadline, key);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline, v, r, s);
    }

    function test_auth_depositRulesStillApply() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER - 1, deadline, key);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.WrongAmount.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER - 1, 0, deadline, v, r, s);
        (v, r, s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Unauthorized.selector);
        esc.depositWithAuthorization(p, id, address(0), OFFER, 0, deadline, v, r, s);
        esc.setPaused(true);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.Paused.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline, v, r, s);
        esc.setPaused(false);
        vm.warp(deadline);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.DepositClosed.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline, v, r, s);
    }

    function test_auth_expiredAuthorization() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        uint256 vb = block.timestamp + 10;
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, vb, key);
        vm.warp(vb);
        vm.prank(relayer);
        vm.expectRevert(HedgedEscrow.TokenTransferFailed.selector);
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, vb, v, r, s);
    }

    function test_auth_anyoneMaySubmit() public {
        bytes16 id = _id(0);
        bytes32 key = esc.purchaseKeyOf(p, dan, id);
        (uint8 v, bytes32 r, bytes32 s) = _signAuth(DAN_PK, address(esc), OFFER, deadline, key);
        vm.prank(dan); // the customer can self-submit if the relayer is down
        esc.depositWithAuthorization(p, id, dan, OFFER, 0, deadline, v, r, s);
        assertEq(esc.getPurchase(key).customer, dan, "same purchase");
    }

    // ---------------------------------------------------------- EIP-2612

    function test_permit_depositWithoutApprove() public {
        uint256 dl = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(DAN_PK, OFFER, dl);
        vm.prank(dan);
        bytes32 k = esc.depositWithPermit(p, _id(0), OFFER, dl, v, r, s);
        assertEq(esc.getPurchase(k).customer, dan, "customer = sender");
        assertEq(usdc.balanceOf(address(esc)), OFFER, "pulled");
        assertEq(usdc.allowance(dan, address(esc)), 0, "allowance used up");
    }

    function test_permit_frontRunStillWorks() public {
        uint256 dl = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(DAN_PK, OFFER, dl);
        vm.prank(mallory);
        usdc.permit(dan, address(esc), OFFER, dl, v, r, s); // someone submits the permit first
        vm.prank(dan);
        esc.depositWithPermit(p, _id(0), OFFER, dl, v, r, s);
        assertEq(usdc.balanceOf(address(esc)), OFFER, "deposit still went through");
    }

    function test_permit_badSignature() public {
        uint256 dl = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = _signPermit(0xBEEF, OFFER, dl); // wrong signer
        vm.prank(dan);
        vm.expectRevert(HedgedEscrow.PermitFailed.selector);
        esc.depositWithPermit(p, _id(0), OFFER, dl, v, r, s);
        // someone else cannot use dan's permit to buy for themselves
        (v, r, s) = _signPermit(DAN_PK, OFFER, dl);
        vm.prank(mallory);
        esc.depositWithPermit(p, _id(0), OFFER, dl, v, r, s); // mallory already approved max: her own funds
        assertEq(esc.getPurchase(esc.purchaseKeyOf(p, mallory, _id(0))).customer, mallory, "own purchase");
        assertEq(usdc.balanceOf(dan), 100 * 1e6, "dan's funds untouched");
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev The handful of Foundry cheatcodes the tests use (no forge-std dependency vendored).
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectRevert(bytes calldata) external;
    function expectRevert() external;
    function sign(uint256 privateKey, bytes32 digest) external pure returns (uint8 v, bytes32 r, bytes32 s);
    function assume(bool) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
    function addr(uint256) external pure returns (address);
    function label(address, string calldata) external;
}

abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function assertTrue(bool c, string memory m) internal pure {
        require(c, m);
    }

    function assertEq(uint256 a, uint256 b, string memory m) internal pure {
        if (a != b) revert(string.concat(m, ": ", _u(a), " != ", _u(b)));
    }

    function assertEq(bytes32 a, bytes32 b, string memory m) internal pure {
        require(a == b, m);
    }

    function assertEq(address a, address b, string memory m) internal pure {
        require(a == b, m);
    }

    function _u(uint256 v) private pure returns (string memory) {
        if (v == 0) return "0";
        bytes memory s;
        while (v != 0) {
            s = abi.encodePacked(bytes1(uint8(48 + (v % 10))), s);
            v /= 10;
        }
        return string(s);
    }
}

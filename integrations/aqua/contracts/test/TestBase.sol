// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
    function warp(uint256) external;
}

/// @dev Minimal local test helpers; no network or external test dependency is required.
abstract contract TestBase {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    function assertEq(uint256 actual, uint256 expected) internal pure { require(actual == expected, "uint mismatch"); }
    function assertEq(int256 actual, int256 expected) internal pure { require(actual == expected, "int mismatch"); }
    function assertEq(address actual, address expected) internal pure { require(actual == expected, "address mismatch"); }
    function assertEq(bytes32 actual, bytes32 expected) internal pure { require(actual == expected, "hash mismatch"); }
    function assertTrue(bool condition) internal pure { require(condition, "assertion failed"); }
}

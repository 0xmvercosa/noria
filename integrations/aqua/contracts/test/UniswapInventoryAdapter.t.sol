// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TestBase} from "./TestBase.sol";
import {MockToken, MockUniswapRouter} from "./mocks/ProtocolMocks.sol";
import {UniswapInventoryAdapter} from "../src/UniswapInventoryAdapter.sol";

contract UniswapInventoryAdapterTest is TestBase {
    MockToken internal weth;
    MockToken internal usdc;
    MockToken internal unrelated;
    MockUniswapRouter internal router;
    UniswapInventoryAdapter internal adapter;
    function setUp() public {
        weth = new MockToken(); usdc = new MockToken(); unrelated = new MockToken(); router = new MockUniswapRouter();
        adapter = new UniswapInventoryAdapter(address(router), address(weth), address(usdc), 500);
        weth.mint(address(this), 10_000); usdc.mint(address(this), 10_000);
        weth.approve(address(adapter), type(uint256).max); usdc.approve(address(adapter), type(uint256).max);
    }

    function test_returnsBalanceDeltaInsteadOfUntrustedRouterReturn() public {
        router.configure(700, 99_999, false);
        uint256 received = adapter.swap(address(weth), address(usdc), 300, 650, block.timestamp + 60);
        assertEq(received, 700); assertEq(weth.balanceOf(address(this)), 9_700);
        assertEq(usdc.balanceOf(address(this)), 10_700); assertEq(router.lastRecipient(), address(this));
        assertEq(weth.allowance(address(adapter), address(router)), 0);
    }

    function test_reverseDirectionAndPriorDustRemainSeparated() public {
        usdc.mint(address(adapter), 37); weth.mint(address(adapter), 29);
        router.configure(250, 250, false);
        assertEq(adapter.swap(address(usdc), address(weth), 400, 240, block.timestamp + 1), 250);
        assertEq(usdc.balanceOf(address(adapter)), 37); assertEq(weth.balanceOf(address(adapter)), 29);
        assertEq(usdc.allowance(address(adapter), address(router)), 0);
    }

    function test_partialConsumptionRevertsEntireSwap() public {
        router.configure(100, 100, true);
        vm.expectRevert(UniswapInventoryAdapter.InvalidSwap.selector);
        adapter.swap(address(weth), address(usdc), 300, 90, block.timestamp + 1);
        assertEq(weth.balanceOf(address(this)), 10_000); assertEq(usdc.balanceOf(address(this)), 10_000);
        assertEq(weth.balanceOf(address(router)), 0); assertEq(weth.allowance(address(adapter), address(router)), 0);
    }

    function test_minOutEnforcedAgainstActualTokens() public {
        router.configure(99, 1_000, false);
        vm.expectRevert(UniswapInventoryAdapter.InvalidSwap.selector);
        adapter.swap(address(weth), address(usdc), 300, 100, block.timestamp + 1);
        assertEq(weth.balanceOf(address(this)), 10_000);
    }

    function test_expiredZeroAndForeignPairRejected() public {
        vm.warp(100);
        vm.expectRevert(UniswapInventoryAdapter.InvalidSwap.selector);
        adapter.swap(address(weth), address(usdc), 1, 1, 99);
        vm.expectRevert(UniswapInventoryAdapter.InvalidSwap.selector);
        adapter.swap(address(weth), address(usdc), 1, 0, 101);
        vm.expectRevert(UniswapInventoryAdapter.InvalidSwap.selector);
        adapter.swap(address(unrelated), address(usdc), 1, 1, 101);
    }

    function test_routerReentryBlockedWhileOuterSwapCompletes() public {
        router.configureReentry(address(adapter), abi.encodeCall(adapter.swap, (address(weth), address(usdc), 1, 1, block.timestamp + 60)));
        assertEq(adapter.swap(address(weth), address(usdc), 100, 100, block.timestamp + 60), 100);
        assertTrue(!router.reentrySucceeded());
        assertEq(weth.allowance(address(adapter), address(router)), 0);
    }

    function testFuzz_exactInputNoDustOrAllowancesLeak(uint64 inputSeed, uint64 outputSeed, bool wethIn) public {
        uint256 amount = uint256(inputSeed) + 1;
        uint256 output = uint256(outputSeed) + 1;
        MockToken input = wethIn ? weth : usdc; MockToken out = wethIn ? usdc : weth;
        input.mint(address(this), amount); router.configure(output, type(uint256).max, false);
        uint256 inputBefore = input.balanceOf(address(this)); uint256 outputBefore = out.balanceOf(address(this));
        uint256 received = adapter.swap(address(input), address(out), amount, output, block.timestamp + 1);
        assertEq(input.balanceOf(address(this)) + amount, inputBefore);
        assertEq(out.balanceOf(address(this)), outputBefore + received); assertEq(received, output);
        assertEq(input.balanceOf(address(adapter)), 0); assertEq(input.allowance(address(adapter), address(router)), 0);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TestBase} from "./TestBase.sol";
import {PositionAccount} from "../src/PositionAccount.sol";
import {
    MockToken, MockReceiptToken, MockDebtToken, MockAavePool,
    MockAqua, MockInventoryAdapter, MockSwapVM
} from "./mocks/ProtocolMocks.sol";

/// @dev Mock-backed unit tests. Fill amounts and health factors are controlled fixtures;
///      they do not establish official-protocol execution or economic profitability.
contract PositionAccountTest is TestBase {
    uint256 internal constant BORROW = 1_000e6;
    uint256 internal constant SAFETY = 1.5e18;
    uint256 internal constant COMFORTABLE = 2e18;
    bytes32 internal constant EVIDENCE = keccak256("unit-test inventory journal");
    address internal constant KEEPER = address(0xBEEF);
    address internal constant STRANGER = address(0xBAD);
    MockToken internal weth;
    MockToken internal usdc;
    MockAavePool internal pool;
    MockAqua internal aqua;
    MockSwapVM internal swapVM;
    MockInventoryAdapter internal adapter;
    PositionAccount internal account;

    function setUp() public {
        weth = new MockToken(); usdc = new MockToken();
        pool = new MockAavePool(weth, usdc); aqua = new MockAqua(); swapVM = new MockSwapVM();
        adapter = new MockInventoryAdapter(address(weth), address(usdc));
        account = new PositionAccount(_config(false));
        weth.mint(address(this), 100 ether); usdc.mint(address(this), 1_000_000e6);
        _approveOwner(account);
        usdc.approve(address(aqua), type(uint256).max);
        usdc.approve(address(pool), type(uint256).max);
    }

    function _config(bool usdcCollateral) internal view returns (PositionAccount.Config memory c) {
        c.owner = address(this); c.keeper = KEEPER;
        c.weth = address(weth); c.usdc = address(usdc);
        c.collateral = usdcCollateral ? address(usdc) : address(weth);
        c.debtToken = address(pool.debt());
        c.receiptToken = usdcCollateral ? address(pool.aUsdc()) : address(pool.aWeth());
        c.aave = address(pool); c.aqua = address(aqua); c.swapVM = address(swapVM);
        c.adapter = address(adapter); c.safetyHF = SAFETY; c.comfortableHF = COMFORTABLE;
        c.manifestHash = keccak256("unit-test manifest");
    }

    function _approveOwner(PositionAccount position) internal {
        weth.approve(address(position), type(uint256).max);
        usdc.approve(address(position), type(uint256).max);
    }

    function _open() internal { account.openPosition(2 ether, BORROW); }
    function _mix() internal {
        account.swapInventory(false, account.lpUsdc() / 2, 1, block.timestamp + 60);
    }
    function _readyMixed() internal { _open(); _mix(); }
    function _order() internal view returns (bytes memory) {
        // MockAqua deliberately does not execute this fixture program.
        return abi.encode(PositionAccount.Order({
            maker: address(account), traits: uint256(1) << 254,
            data: abi.encodePacked(uint8(1), account.cycleId() + 1)
        }));
    }
    function _ship() internal { account.shipCycle(_order()); }
    function _fillToCash(uint256 totalRecovered) internal {
        aqua.fill(address(account), address(swapVM), account.strategyHash(), address(usdc),
            totalRecovered - account.lpUsdc(), address(weth), account.lpWeth());
    }
    function _confirm(uint256 w, uint256 u) internal {
        account.confirmInventory(account.cycleId(), account.nonce(), account.dockSnapshotHash(), w, u, EVIDENCE);
    }
    function _confirmCurrent() internal { _confirm(account.lpWeth(), account.lpUsdc()); }
    function _closeToCash(uint256 recovered) internal {
        _ship(); _fillToCash(recovered); account.requestClose(); _confirmCurrent();
    }
    function _outsideRepay(uint256 amount) internal {
        pool.repay(address(usdc), amount, 2, address(account));
    }
    function _assertPhase(PositionAccount.Phase p) internal view { assertEq(uint256(account.phase()), uint256(p)); }

    function test_constructorBindsReceiptAndDebtToCorrectAssetAndPool() public {
        PositionAccount.Config memory c = _config(false);
        c.receiptToken = address(pool.aUsdc());
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
        c = _config(false); c.debtToken = address(new MockDebtToken(address(weth), address(pool)));
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
        c = _config(false); c.receiptToken = address(new MockReceiptToken(address(weth), STRANGER));
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
    }

    function test_constructorRejectsUnsafePolicyAndMissingManifest() public {
        PositionAccount.Config memory c = _config(false); c.safetyHF = 1e18;
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
        c = _config(false); c.comfortableHF = c.safetyHF;
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
        c = _config(false); c.manifestHash = bytes32(0);
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); new PositionAccount(c);
    }

    function test_onlyOwnerCanSpendAttestAllocateOrExit() public {
        bytes[] memory calls = new bytes[](10);
        calls[0] = abi.encodeCall(account.openPosition, (2 ether, BORROW));
        calls[1] = abi.encodeCall(account.addCollateral, (1 ether));
        calls[2] = abi.encodeCall(account.swapInventory, (false, 1, 1, block.timestamp + 1));
        calls[3] = abi.encodeCall(account.shipCycle, (bytes("")));
        calls[4] = abi.encodeCall(account.confirmInventory, (0, 0, bytes32(0), 0, 0, EVIDENCE));
        calls[5] = abi.encodeCall(account.allocateCycle, (0));
        calls[6] = abi.encodeCall(account.reconcileDebt, (1, EVIDENCE));
        calls[7] = abi.encodeCall(account.realizeDefense, (1, block.timestamp + 1));
        calls[8] = abi.encodeCall(account.repayExternal, (1));
        calls[9] = abi.encodeCall(account.exit, ());
        for (uint256 j; j < 2; j++) {
            for (uint256 i; i < calls.length; i++) {
                vm.prank(j == 0 ? KEEPER : STRANGER);
                (bool ok, bytes memory reason) = address(account).call(calls[i]);
                assertTrue(!ok);
                assertEq(keccak256(reason), keccak256(abi.encodeWithSelector(PositionAccount.Unauthorized.selector)));
            }
        }
    }

    function test_openComfortableBoundaryAndAtomicHealthFailure() public {
        pool.setHF(COMFORTABLE - 1);
        uint256 balance = weth.balanceOf(address(this));
        vm.expectRevert(PositionAccount.UnsafeHealth.selector); _open();
        _assertPhase(PositionAccount.Phase.Unfunded);
        assertEq(weth.balanceOf(address(this)), balance);
        assertEq(pool.aWeth().balanceOf(address(account)), 0);
        assertEq(pool.debt().balanceOf(address(account)), 0);
        assertEq(usdc.balanceOf(address(account)), 0);
        pool.setHF(COMFORTABLE); _open();
        _assertPhase(PositionAccount.Phase.Ready);
        assertEq(account.principal(), BORROW); assertEq(account.lpUsdc(), BORROW);
        assertEq(account.debtCheckpoint(), BORROW); assertEq(account.scaledDebtCheckpoint(), BORROW);
        assertEq(weth.allowance(address(account), address(pool)), 0);
    }

    function test_borrowFailureRollsBackCollateralSupply() public {
        pool.setFailBorrow(true);
        uint256 balance = weth.balanceOf(address(this));
        vm.expectRevert(); _open();
        assertEq(weth.balanceOf(address(this)), balance);
        assertEq(weth.balanceOf(address(pool)), 0);
        assertEq(pool.aWeth().balanceOf(address(account)), 0);
        _assertPhase(PositionAccount.Phase.Unfunded);
    }

    function test_usdcCollateralDepositAndTopupNeverEnterLpAccounting() public {
        account = new PositionAccount(_config(true)); _approveOwner(account);
        usdc.mint(address(account), 17e6);
        account.openPosition(3_000e6, BORROW);
        uint256 ownerBefore = usdc.balanceOf(address(this));
        account.addCollateral(250e6);
        assertEq(ownerBefore - usdc.balanceOf(address(this)), 250e6);
        assertEq(pool.aUsdc().balanceOf(address(account)), 3_250e6);
        assertEq(account.principal(), BORROW); assertEq(account.lpUsdc(), BORROW);
        assertEq(pool.debt().balanceOf(address(account)), BORROW);
        assertEq(usdc.balanceOf(address(account)), BORROW + 17e6);
        assertEq(usdc.allowance(address(account), address(pool)), 0);
    }

    function test_conversionRequiresSafetyMarginAndRespectsTrackedInventory() public {
        _open(); pool.setHF(SAFETY);
        vm.expectRevert(PositionAccount.UnsafeHealth.selector);
        account.swapInventory(false, 500e6, 1, block.timestamp + 60);
        pool.setHF(SAFETY + 1);
        account.swapInventory(false, 500e6, 0.25 ether, block.timestamp + 60);
        assertEq(account.lpUsdc(), 500e6); assertEq(account.lpWeth(), 0.25 ether);
        assertEq(usdc.allowance(address(account), address(adapter)), 0);
        usdc.mint(address(account), BORROW);
        vm.expectRevert(PositionAccount.InvalidInventory.selector);
        account.swapInventory(false, 500e6 + 1, 1, block.timestamp + 60);
        vm.expectRevert(PositionAccount.InvalidInventory.selector);
        account.swapInventory(true, 1, 1, block.timestamp + 15 minutes + 1);
    }

    function test_shipRequiresComfortableHealthAndLocksFurtherTrades() public {
        _readyMixed(); pool.setHF(COMFORTABLE - 1);
        bytes memory order = _order();
        vm.expectRevert(PositionAccount.UnsafeHealth.selector); account.shipCycle(order);
        pool.setHF(COMFORTABLE); account.shipCycle(order);
        _assertPhase(PositionAccount.Phase.Active); assertEq(account.cycleId(), 1);
        assertEq(weth.allowance(address(account), address(aqua)), type(uint256).max);
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.swapInventory(false, 1, 1, block.timestamp + 60);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.shipCycle(order);
    }

    function test_shipRejectsForeignMakerTraitsEmptyAndNoncanonicalProgram() public {
        _readyMixed();
        bytes memory foreignMaker = abi.encode(PositionAccount.Order(STRANGER, uint256(1) << 254, hex"01"));
        vm.expectRevert(PositionAccount.InvalidProgram.selector); account.shipCycle(foreignMaker);
        bytes memory unsafeTraits = abi.encode(PositionAccount.Order(address(account), 0, hex"01"));
        vm.expectRevert(PositionAccount.InvalidProgram.selector); account.shipCycle(unsafeTraits);
        bytes memory empty = abi.encode(PositionAccount.Order(address(account), uint256(1) << 254, bytes("")));
        vm.expectRevert(PositionAccount.InvalidProgram.selector); account.shipCycle(empty);
        bytes memory noncanonical = bytes.concat(_order(), hex"00");
        vm.expectRevert(PositionAccount.InvalidProgram.selector); account.shipCycle(noncanonical);
    }

    function test_keeperCanDockButCannotConfirmOrTrade() public {
        _readyMixed(); _ship();
        vm.prank(STRANGER); vm.expectRevert(PositionAccount.Unauthorized.selector); account.requestClose();
        vm.prank(KEEPER); account.requestClose();
        _assertPhase(PositionAccount.Phase.Closing); assertEq(account.nonce(), 1);
        assertEq(weth.allowance(address(account), address(aqua)), 0);
        assertEq(usdc.allowance(address(account), address(aqua)), 0);
        uint256 cycle = account.cycleId(); uint256 nonce = account.nonce(); bytes32 snapshot = account.dockSnapshotHash();
        vm.prank(KEEPER); vm.expectRevert(PositionAccount.Unauthorized.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.swapInventory(true, 0.25 ether, 1, block.timestamp + 60);
    }

    function test_inventoryConfirmationBindsCycleNonceSnapshotAndCannotReplay() public {
        _readyMixed(); _ship(); account.requestClose();
        uint256 cycle = account.cycleId(); uint256 nonce = account.nonce(); bytes32 snapshot = account.dockSnapshotHash();
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle + 1, nonce, snapshot, 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle, nonce + 1, snapshot, 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle, nonce, bytes32(0), 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6, bytes32(0));
        vm.expectRevert(PositionAccount.InvalidInventory.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6 + 1, EVIDENCE);
        _confirmCurrent();
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.allocateCycle(0);
        account.swapInventory(true, 0.25 ether, 500e6, block.timestamp + 60); account.allocateCycle(0);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.allocateCycle(0);
    }

    function test_directDonationsAndPublicPushAreExcludedByOwnerAttestation() public {
        _readyMixed(); usdc.mint(address(account), 777e6); weth.mint(address(account), 0.1 ether); _ship();
        usdc.mint(STRANGER, 100e6);
        vm.prank(STRANGER); usdc.approve(address(aqua), 100e6);
        bytes32 strategy = account.strategyHash();
        vm.prank(STRANGER); aqua.push(address(account), address(swapVM), strategy, address(usdc), 100e6);
        account.requestClose(); assertEq(account.lpUsdc(), 600e6);
        _confirm(0.25 ether, 500e6);
        account.swapInventory(true, 0.25 ether, 500e6, block.timestamp + 60); account.allocateCycle(0);
        assertEq(account.principal(), BORROW); assertEq(account.lpUsdc(), BORROW);
        assertEq(account.debtCheckpoint(), BORROW); assertEq(account.lossCarry(), 0);
        assertEq(usdc.balanceOf(address(account)), BORROW + 877e6);
        assertEq(weth.balanceOf(address(account)), 0.1 ether);
    }

    function test_positiveCycleRepaysInterestThenSplitsEligibleResult() public {
        _readyMixed(); pool.setIndex(1.01e27); _closeToCash(1_210e6); account.allocateCycle(0);
        _assertPhase(PositionAccount.Phase.Allocated);
        assertEq(account.principal(), 1_100e6); assertEq(account.lpUsdc(), 1_100e6);
        assertEq(account.debtCheckpoint(), 900e6); assertEq(account.lossCarry(), 0);
        assertEq(usdc.allowance(address(account), address(pool)), 0);
    }

    function test_lossRecoveryPrecedesFutureProfitSplitAcrossCycles() public {
        _readyMixed(); _closeToCash(800e6); account.allocateCycle(0);
        assertEq(account.principal(), 800e6); assertEq(account.lossCarry(), 200e6);
        assertEq(account.debtCheckpoint(), BORROW);
        _mix(); _closeToCash(900e6); account.allocateCycle(0);
        assertEq(account.principal(), 900e6); assertEq(account.lossCarry(), 100e6);
        assertEq(account.debtCheckpoint(), BORROW);
        _mix(); _closeToCash(1_100e6); account.allocateCycle(0);
        assertEq(account.principal(), 1_050e6); assertEq(account.lossCarry(), 0);
        assertEq(account.debtCheckpoint(), 950e6); assertEq(account.cycleId(), 3); assertEq(account.nonce(), 3);
    }

    function test_allocationAtSafetyBlockedAndAttentionUsesAllEligibleCash() public {
        _readyMixed(); _closeToCash(1_200e6); pool.setHF(SAFETY);
        vm.expectRevert(PositionAccount.UnsafeHealth.selector); account.allocateCycle(0);
        assertEq(account.lpUsdc(), 1_200e6); _assertPhase(PositionAccount.Phase.Closing);
        pool.setHF(SAFETY + 1); account.allocateCycle(0);
        assertEq(account.principal(), BORROW); assertEq(account.debtCheckpoint(), 800e6);
    }

    function test_nonzeroProvisionCannotLockAnUnsettledReserve() public {
        _readyMixed(); _closeToCash(1_200e6);
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector); account.allocateCycle(1);
        assertEq(account.reserves(), 0); assertEq(account.lpUsdc(), 1_200e6);
    }

    function test_idleInterestRemainsInNextCycleCheckpoint() public {
        _readyMixed(); _closeToCash(BORROW); account.allocateCycle(0);
        pool.setIndex(1.01e27); _mix(); _closeToCash(1_210e6); account.allocateCycle(0);
        assertEq(account.debtCheckpoint(), 900e6); assertEq(account.principal(), 1_100e6);
    }

    function test_foreignDebtIncreaseCannotBeConfirmedOrReconciled() public {
        _readyMixed(); _ship(); pool.debt().mintDebt(address(account), 1e6); account.requestClose();
        uint256 cycle = account.cycleId(); uint256 nonce = account.nonce(); bytes32 snapshot = account.dockSnapshotHash();
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6, EVIDENCE);
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.reconcileDebt(1e6, EVIDENCE);
    }

    function test_foreignDebtChangeBlocksNewShipment() public {
        _readyMixed(); _outsideRepay(1e6);
        bytes memory order = _order();
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.shipCycle(order);
        _assertPhase(PositionAccount.Phase.Ready);
        assertEq(weth.allowance(address(account), address(aqua)), 0);
    }

    function test_missingWalletBackingCannotShipOrBeConfirmed() public {
        _readyMixed(); usdc.burn(address(account), 1);
        bytes memory order = _order();
        vm.expectRevert(PositionAccount.InvalidInventory.selector); account.shipCycle(order);
        usdc.mint(address(account), 1); account.shipCycle(order); account.requestClose();
        weth.burn(address(account), 1);
        uint256 cycle = account.cycleId(); uint256 nonce = account.nonce(); bytes32 snapshot = account.dockSnapshotHash();
        vm.expectRevert(PositionAccount.InvalidInventory.selector);
        account.confirmInventory(cycle, nonce, snapshot, 0.25 ether, 500e6, EVIDENCE);
        assertTrue(!account.inventoryConfirmed());
    }

    function test_externalRepayRequiresReconciliationAndFreshInventoryAuthorization() public {
        _readyMixed(); _closeToCash(1_210e6); pool.setIndex(1.01e27); _outsideRepay(100e6);
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.allocateCycle(0);
        uint256 oldNonce = account.nonce(); bytes32 oldSnapshot = account.dockSnapshotHash();
        account.reconcileDebt(100e6, EVIDENCE);
        assertTrue(!account.inventoryConfirmed()); assertEq(account.carriedInterest(), 10e6);
        assertEq(account.debtCheckpoint(), 910e6); assertEq(account.principal(), BORROW);
        assertEq(account.nonce(), oldNonce + 1); assertTrue(account.dockSnapshotHash() != oldSnapshot);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.allocateCycle(0);
        uint256 cycle = account.cycleId();
        vm.expectRevert(PositionAccount.InvalidState.selector);
        account.confirmInventory(cycle, oldNonce, oldSnapshot, 0, 1_210e6, EVIDENCE);
        _confirmCurrent(); account.allocateCycle(0);
        assertEq(account.carriedInterest(), 0); assertEq(account.debtCheckpoint(), 800e6);
        assertEq(account.principal(), 1_100e6);
    }

    function test_reconcileRequiresEvidenceDebtReductionAndStoppedFills() public {
        _readyMixed();
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.reconcileDebt(10e6, EVIDENCE);
        _ship(); _outsideRepay(10e6);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.reconcileDebt(10e6, EVIDENCE);
        account.requestClose();
        vm.expectRevert(PositionAccount.InvalidState.selector); account.reconcileDebt(10e6, bytes32(0));
        account.reconcileDebt(10e6, EVIDENCE);
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.reconcileDebt(10e6, EVIDENCE);
    }

    function test_delayedReconciliationDoesNotChargeInterestOnExternallyBurnedDebt() public {
        _open(); pool.setIndex(1.01e27);
        uint256 firstPeriodInterest = pool.debt().balanceOf(address(account)) - BORROW;
        _outsideRepay(100e6);
        uint256 afterExternalRepay = pool.debt().balanceOf(address(account));
        pool.setIndex(1.02e27);
        uint256 actualInterest = firstPeriodInterest + pool.debt().balanceOf(address(account)) - afterExternalRepay;
        account.reconcileDebt(100e6, EVIDENCE);
        // The old counterfactual index projection charged 20 USDC, including
        // 0.990099 USDC of fictitious interest on principal already repaid.
        assertEq(actualInterest, 19_009_901);
        assertEq(account.carriedInterest(), actualInterest);
        assertEq(account.debtCheckpoint(), 919_009_901);
    }

    function test_reconciliationRejectsImpossibleExternalReductionClaims() public {
        _open(); pool.setIndex(1.01e27); _outsideRepay(100e6);
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.reconcileDebt(1, EVIDENCE);
        vm.expectRevert(PositionAccount.ExternalDebtMovement.selector); account.reconcileDebt(100e6 + 3, EVIDENCE);
        account.reconcileDebt(100e6, EVIDENCE);
        assertEq(account.carriedInterest(), 10e6); assertEq(account.debtCheckpoint(), 910e6);
    }

    function test_repeatedReconciliationCarriesEarlierInterestWithoutDoubleCounting() public {
        _open(); pool.setIndex(1.01e27); _outsideRepay(100e6);
        account.reconcileDebt(100e6, EVIDENCE);
        uint256 firstInterest = account.carriedInterest(); uint256 secondCheckpoint = account.debtCheckpoint();
        pool.setIndex(1.02e27); _outsideRepay(100e6);
        uint256 currentDebt = pool.debt().balanceOf(address(account));
        account.reconcileDebt(100e6, keccak256("second repayment journal"));
        assertEq(account.carriedInterest(), firstInterest + currentDebt + 100e6 - secondCheckpoint);
        assertEq(account.carriedInterest(), 19_009_901);
        assertEq(account.nonce(), 2);
    }

    function test_terminalDebtZeroCannotConvertOrStartAnotherCycle() public {
        _readyMixed(); _closeToCash(3_000e6); account.allocateCycle(0);
        assertEq(account.debtCheckpoint(), 0); assertEq(account.principal(), 0); assertEq(account.lpUsdc(), 2_000e6);
        vm.expectRevert(PositionAccount.UnsafeHealth.selector);
        account.swapInventory(false, 1e6, 1, block.timestamp + 60);
        bytes memory order = _order();
        vm.expectRevert(PositionAccount.InvalidState.selector); account.shipCycle(order);
        uint256 ownerWeth = weth.balanceOf(address(this)); uint256 ownerUsdc = usdc.balanceOf(address(this));
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
        assertEq(weth.balanceOf(address(this)), ownerWeth + 2 ether);
        assertEq(usdc.balanceOf(address(this)), ownerUsdc + 2_000e6);
        assertEq(account.lpUsdc(), 0); assertEq(pool.withdrawCalls(), 1);
    }

    function test_reconciledZeroDebtCannotShipExistingMixedInventory() public {
        _readyMixed(); _outsideRepay(BORROW); account.reconcileDebt(BORROW, EVIDENCE);
        bytes memory order = _order();
        vm.expectRevert(PositionAccount.UnsafeHealth.selector); account.shipCycle(order);
        vm.expectRevert(PositionAccount.UnsafeHealth.selector);
        account.swapInventory(false, 1, 1, block.timestamp + 60);
    }

    function test_keeperDefenseBoundaryStopsFillsAndOwnerRealizesResidualWeth() public {
        _readyMixed(); _ship(); pool.setHF(SAFETY + 1);
        vm.prank(KEEPER); vm.expectRevert(PositionAccount.Unauthorized.selector); account.defend();
        pool.setHF(SAFETY);
        vm.prank(STRANGER); vm.expectRevert(PositionAccount.Unauthorized.selector); account.defend();
        vm.prank(KEEPER); account.defend(); _assertPhase(PositionAccount.Phase.Defended);
        assertEq(account.debtCheckpoint(), 500e6); assertEq(account.lpWeth(), 0.25 ether);
        assertEq(account.lpUsdc(), 0); assertEq(weth.allowance(address(account), address(aqua)), 0);
        vm.prank(KEEPER); vm.expectRevert(PositionAccount.Unauthorized.selector);
        account.realizeDefense(500e6, block.timestamp + 60);
        vm.expectRevert(PositionAccount.InvalidState.selector); account.exit();
        account.realizeDefense(500e6, block.timestamp + 60);
        assertEq(account.debtCheckpoint(), 0); assertEq(account.lpWeth(), 0);
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
    }

    function test_ownerCanDefendAboveSafetyAndExternalRepayDoesNotCreateProfit() public {
        _readyMixed(); account.defend();
        assertEq(account.debtCheckpoint(), 500e6); assertEq(account.principal(), BORROW);
        uint256 ownerBefore = usdc.balanceOf(address(this));
        account.repayExternal(600e6);
        assertEq(ownerBefore - usdc.balanceOf(address(this)), 600e6);
        assertEq(account.debtCheckpoint(), 0); assertEq(account.principal(), BORROW);
        assertEq(usdc.balanceOf(address(account)), 100e6); assertEq(account.lossCarry(), 0);
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
    }

    function test_zeroCollateralAndDebtExitSkipsAaveZeroWithdrawal() public {
        _open(); account.defend();
        pool.aWeth().burn(address(account), 2 ether);
        pool.setFailWithdraw(true);
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
        assertEq(pool.withdrawCalls(), 0);
    }

    function test_ownerRecoveryDoesNotRequireAHealthRead() public {
        _readyMixed(); _ship(); pool.setFailHealthRead(true);
        vm.prank(KEEPER); vm.expectRevert(); account.defend();
        account.defend(); _assertPhase(PositionAccount.Phase.Defended);
        assertEq(weth.allowance(address(account), address(aqua)), 0);
        assertEq(usdc.allowance(address(account), address(aqua)), 0);
        account.realizeDefense(500e6, block.timestamp + 60);
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
    }

    function test_ownerExternalRepaymentSurvivesHealthReadFailure() public {
        _readyMixed(); pool.setFailHealthRead(true);
        account.defend(); account.repayExternal(500e6);
        assertEq(pool.debt().balanceOf(address(account)), 0);
        account.exit(); _assertPhase(PositionAccount.Phase.Closed);
    }

    function test_newExposureRevertsWhenHealthCannotBeRead() public {
        pool.setFailHealthRead(true);
        vm.expectRevert(); _open(); _assertPhase(PositionAccount.Phase.Unfunded);
        pool.setFailHealthRead(false); _open(); pool.setFailHealthRead(true);
        uint256 amount = account.lpUsdc() / 2;
        vm.expectRevert(); account.swapInventory(false, amount, 1, block.timestamp + 60);
        pool.setFailHealthRead(false); _mix(); pool.setFailHealthRead(true);
        bytes memory order = _order();
        vm.expectRevert(); account.shipCycle(order); _assertPhase(PositionAccount.Phase.Ready);
    }

    function test_realWithdrawalFailureKeepsPositionAndFundsRecoverable() public {
        _open(); account.defend(); pool.setFailWithdraw(true);
        usdc.mint(address(account), 5e6);
        vm.expectRevert(); account.exit();
        _assertPhase(PositionAccount.Phase.Defended);
        assertEq(pool.aWeth().balanceOf(address(account)), 2 ether);
        assertEq(usdc.balanceOf(address(account)), 5e6);
        pool.setFailWithdraw(false); account.exit(); _assertPhase(PositionAccount.Phase.Closed);
    }

    function testFuzz_donationsNeverExpandSpendableLp(uint64 donation, uint64 collateralTopup) public {
        _open(); usdc.mint(address(account), donation);
        uint256 topup = uint256(collateralTopup) + 1;
        weth.mint(address(this), topup); account.addCollateral(topup);
        assertEq(account.principal(), BORROW); assertEq(account.lpUsdc(), BORROW);
        assertEq(account.debtCheckpoint(), BORROW);
        assertEq(usdc.balanceOf(address(account)), BORROW + donation);
        assertEq(pool.aWeth().balanceOf(address(account)), 2 ether + topup);
    }

    function testFuzz_cycleSettlementConservesActualTokensAndDebt(uint64 recoveredSeed, bool healthy) public {
        uint256 recovered = 500e6 + uint256(recoveredSeed) % 3_000e6;
        _readyMixed(); _closeToCash(recovered);
        pool.setHF(healthy ? COMFORTABLE : SAFETY + 1);
        uint256 profit = recovered > BORROW ? recovered - BORROW : 0;
        uint256 repayment = healthy ? profit / 2 : profit;
        if (repayment > BORROW) repayment = BORROW;
        account.allocateCycle(0);
        assertEq(pool.debt().balanceOf(address(account)), BORROW - repayment);
        assertEq(usdc.balanceOf(address(account)), recovered - repayment);
        assertEq(account.lpUsdc(), recovered - repayment);
        assertEq(account.principal(), repayment == BORROW ? 0 : recovered - repayment);
        assertEq(account.lossCarry(), recovered < BORROW ? BORROW - recovered : 0);
        assertEq(weth.balanceOf(address(account)), 0);
        assertEq(usdc.allowance(address(account), address(pool)), 0);
    }
}

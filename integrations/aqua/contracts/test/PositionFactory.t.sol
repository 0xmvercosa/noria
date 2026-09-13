// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {TestBase} from "./TestBase.sol";
import {PositionFactory} from "../src/PositionFactory.sol";
import {PositionAccount} from "../src/PositionAccount.sol";
import {
    MockToken,
    MockReceiptToken,
    MockDebtToken,
    MockAavePool,
    MockAqua,
    MockInventoryAdapter,
    MockSwapVM
} from "./mocks/ProtocolMocks.sol";

interface FactoryTestVm {
    function expectEmit(bool, bool, bool, bool, address) external;
}

/// @dev Unit fixtures prove factory registration and configuration, not public deployment.
contract PositionFactoryTest is TestBase {
    address internal constant ALICE = address(0xA11CE);
    address internal constant BOB = address(0xB0B);
    address internal constant STRANGER = address(0xBAD);
    bytes32 internal constant ID = keccak256("first owner position");
    bytes32 internal constant NEXT_ID = keccak256("second owner position");
    bytes32 internal constant MANIFEST = keccak256("reviewed unit-test manifest");
    uint256 internal constant SAFETY = 1.5e18;
    uint256 internal constant COMFORTABLE = 2e18;

    MockToken internal weth;
    MockToken internal usdc;
    MockAavePool internal pool;
    MockAqua internal aqua;
    MockSwapVM internal swapVM;
    MockInventoryAdapter internal adapter;
    PositionFactory internal factory;

    event PositionCreated(
        address indexed owner,
        address indexed account,
        bytes32 indexed id,
        address collateral,
        bytes32 manifestHash,
        uint256 safetyHF,
        uint256 comfortableHF
    );

    function setUp() public {
        weth = new MockToken();
        usdc = new MockToken();
        pool = new MockAavePool(weth, usdc);
        aqua = new MockAqua();
        swapVM = new MockSwapVM();
        adapter = new MockInventoryAdapter(address(weth), address(usdc));
        factory = new PositionFactory(_protocols());
    }

    function _protocols() internal view returns (PositionFactory.Protocols memory p) {
        p = PositionFactory.Protocols({
            weth: address(weth),
            usdc: address(usdc),
            aWeth: address(pool.aWeth()),
            aUsdc: address(pool.aUsdc()),
            debtUSDC: address(pool.debt()),
            aave: address(pool),
            aqua: address(aqua),
            swapVM: address(swapVM),
            adapter: address(adapter)
        });
    }

    function _create(address owner, bytes32 id, address collateral) internal returns (PositionAccount) {
        vm.prank(owner);
        return PositionAccount(factory.createPosition(id, collateral, SAFETY, COMFORTABLE, MANIFEST));
    }

    function _config(address owner, address collateral) internal view returns (PositionAccount.Config memory c) {
        c = PositionAccount.Config({
            owner: owner,
            keeper: owner,
            weth: address(weth),
            usdc: address(usdc),
            collateral: collateral,
            debtToken: address(pool.debt()),
            receiptToken: collateral == address(weth) ? address(pool.aWeth()) : address(pool.aUsdc()),
            aave: address(pool),
            aqua: address(aqua),
            swapVM: address(swapVM),
            adapter: address(adapter),
            safetyHF: SAFETY,
            comfortableHF: COMFORTABLE,
            manifestHash: MANIFEST
        });
    }

    function _predicted(address owner, bytes32 id, address collateral) internal view returns (address) {
        bytes32 salt = keccak256(abi.encode(owner, id));
        bytes32 initHash =
            keccak256(abi.encodePacked(type(PositionAccount).creationCode, abi.encode(_config(owner, collateral))));
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, initHash)))));
    }

    function _assertIdentity(PositionAccount account, address owner, address collateral) internal view {
        assertEq(account.owner(), owner);
        assertEq(account.keeper(), owner);
        assertEq(address(account.weth()), address(weth));
        assertEq(address(account.usdc()), address(usdc));
        assertEq(address(account.collateral()), collateral);
        assertEq(address(account.debtToken()), address(pool.debt()));
        assertEq(
            address(account.receiptToken()), collateral == address(weth) ? address(pool.aWeth()) : address(pool.aUsdc())
        );
        assertEq(address(account.aave()), address(pool));
        assertEq(address(account.aqua()), address(aqua));
        assertEq(account.swapVM(), address(swapVM));
        assertEq(address(account.adapter()), address(adapter));
        assertEq(account.safetyHF(), SAFETY);
        assertEq(account.comfortableHF(), COMFORTABLE);
        assertEq(account.manifestHash(), MANIFEST);
        assertEq(uint256(account.phase()), uint256(PositionAccount.Phase.Unfunded));
    }

    function test_configurationAndRuntimeAreFixedWithoutAnAdmin() public {
        assertEq(keccak256(abi.encode(factory.protocols())), keccak256(abi.encode(_protocols())));
        PositionFactory.Protocols memory p = _protocols();
        p.adapter = address(new MockInventoryAdapter(address(weth), address(usdc)));
        PositionFactory another = new PositionFactory(p);
        assertEq(address(factory).codehash, address(another).codehash);
        assertTrue(address(factory).code.length < 24_576);
        assertTrue(address(factory).code.length > 0);
        (bool ok,) = address(factory).call(
            abi.encodeWithSignature(
                "setProtocols((address,address,address,address,address,address,address,address,address))", p
            )
        );
        assertTrue(!ok);
        assertEq(keccak256(abi.encode(factory.protocols())), keccak256(abi.encode(_protocols())));
    }

    function test_bothCollateralChoicesBindEveryAccountIdentityAndCreationEvent() public {
        address[2] memory tokens = [address(weth), address(usdc)];
        for (uint256 i; i < tokens.length; i++) {
            bytes32 id = i == 0 ? ID : NEXT_ID;
            address predicted = _predicted(ALICE, id, tokens[i]);
            FactoryTestVm(address(vm)).expectEmit(true, true, true, true, address(factory));
            emit PositionCreated(ALICE, predicted, id, tokens[i], MANIFEST, SAFETY, COMFORTABLE);
            PositionAccount account = _create(ALICE, id, tokens[i]);
            assertEq(address(account), predicted);
            _assertIdentity(account, ALICE, tokens[i]);
            assertEq(factory.getPosition(ALICE, id), address(account));
            assertEq(factory.latestPosition(ALICE), address(account));
            assertTrue(factory.isPosition(address(account)));
        }
    }

    function test_sameIdCannotBeClaimedForAnotherOwnerAndRegistrationsRemainIndependent() public {
        PositionAccount bob = _create(BOB, ID, address(weth));
        assertEq(factory.getPosition(ALICE, ID), address(0));
        assertEq(factory.latestPosition(ALICE), address(0));
        PositionAccount alice = _create(ALICE, ID, address(weth));
        assertTrue(address(alice) != address(bob));
        assertEq(factory.getPosition(ALICE, ID), address(alice));
        assertEq(factory.getPosition(BOB, ID), address(bob));
        PositionAccount next = _create(ALICE, NEXT_ID, address(usdc));
        assertEq(factory.latestPosition(ALICE), address(next));
        assertEq(factory.latestPosition(BOB), address(bob));
        assertEq(factory.getPosition(ALICE, ID), address(alice));
        assertTrue(!factory.isPosition(ALICE));
        assertTrue(!factory.isPosition(address(0)));
    }

    function test_factoryAndDeployerHaveNoControlOverCreatedAccounts() public {
        PositionAccount account = _create(ALICE, ID, address(weth));
        address[4] memory unauthorized = [address(factory), address(this), BOB, STRANGER];
        for (uint256 i; i < unauthorized.length; i++) {
            vm.expectRevert(PositionAccount.Unauthorized.selector);
            vm.prank(unauthorized[i]);
            account.openPosition(1 ether, 1e6);
            vm.expectRevert(PositionAccount.Unauthorized.selector);
            vm.prank(unauthorized[i]);
            account.requestClose();
        }
        weth.mint(ALICE, 2 ether);
        vm.prank(ALICE);
        weth.approve(address(account), 2 ether);
        vm.prank(ALICE);
        account.openPosition(2 ether, 1_000e6);
        assertEq(uint256(account.phase()), uint256(PositionAccount.Phase.Ready));
    }

    function test_creationDoesNotMoveOwnerFundsOrGrantFactoryAllowances() public {
        weth.mint(ALICE, 2 ether);
        usdc.mint(ALICE, 2_000e6);
        PositionAccount account = _create(ALICE, ID, address(weth));
        assertEq(weth.balanceOf(ALICE), 2 ether);
        assertEq(usdc.balanceOf(ALICE), 2_000e6);
        assertEq(weth.balanceOf(address(account)), 0);
        assertEq(usdc.balanceOf(address(account)), 0);
        assertEq(weth.balanceOf(address(factory)), 0);
        assertEq(usdc.balanceOf(address(factory)), 0);
        assertEq(weth.allowance(ALICE, address(factory)), 0);
        assertEq(usdc.allowance(ALICE, address(factory)), 0);
    }

    function test_zeroDuplicateIdAndUnsupportedCollateralDoNotOverwriteTheRegistry() public {
        vm.expectRevert(PositionFactory.InvalidId.selector);
        _create(ALICE, bytes32(0), address(weth));
        assertEq(factory.latestPosition(ALICE), address(0));
        PositionAccount first = _create(ALICE, ID, address(weth));
        vm.expectRevert(PositionFactory.PositionExists.selector);
        _create(ALICE, ID, address(usdc));
        vm.expectRevert(PositionFactory.UnsupportedCollateral.selector);
        _create(ALICE, NEXT_ID, address(0));
        vm.expectRevert(PositionFactory.UnsupportedCollateral.selector);
        _create(ALICE, NEXT_ID, address(adapter));
        assertEq(factory.getPosition(ALICE, ID), address(first));
        assertEq(factory.getPosition(ALICE, NEXT_ID), address(0));
        assertEq(factory.latestPosition(ALICE), address(first));
    }

    function _replaceProtocol(PositionFactory.Protocols memory p, uint256 index, address replacement)
        internal
        pure
        returns (PositionFactory.Protocols memory)
    {
        if (index == 0) p.weth = replacement;
        else if (index == 1) p.usdc = replacement;
        else if (index == 2) p.aWeth = replacement;
        else if (index == 3) p.aUsdc = replacement;
        else if (index == 4) p.debtUSDC = replacement;
        else if (index == 5) p.aave = replacement;
        else if (index == 6) p.aqua = replacement;
        else if (index == 7) p.swapVM = replacement;
        else p.adapter = replacement;
        return p;
    }

    function test_constructorRequiresCodeAtEveryProtocolAddress() public {
        for (uint256 i; i < 9; i++) {
            PositionFactory.Protocols memory p = _replaceProtocol(_protocols(), i, address(0));
            vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
            new PositionFactory(p);
            p = _replaceProtocol(_protocols(), i, STRANGER);
            vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
            new PositionFactory(p);
        }
    }

    function test_constructorRejectsOverlappingAssetsAndReceiptDebtRoles() public {
        PositionFactory.Protocols memory p = _protocols();
        p.usdc = p.weth;
        vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
        new PositionFactory(p);
        p = _protocols();
        p.debtUSDC = p.aUsdc;
        vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
        new PositionFactory(p);
        p = _protocols();
        p.debtUSDC = p.aWeth;
        vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
        new PositionFactory(p);
    }

    function test_constructorChecksReceiptAndDebtUnderlyingAssetsAndPools() public {
        address[3] memory wrongAsset = [
            address(new MockReceiptToken(address(usdc), address(pool))),
            address(new MockReceiptToken(address(weth), address(pool))),
            address(new MockDebtToken(address(weth), address(pool)))
        ];
        address[3] memory wrongPool = [
            address(new MockReceiptToken(address(weth), STRANGER)),
            address(new MockReceiptToken(address(usdc), STRANGER)),
            address(new MockDebtToken(address(usdc), STRANGER))
        ];
        for (uint256 i; i < 3; i++) {
            PositionFactory.Protocols memory p = _replaceProtocol(_protocols(), i + 2, wrongAsset[i]);
            vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
            new PositionFactory(p);
            p = _replaceProtocol(_protocols(), i + 2, wrongPool[i]);
            vm.expectRevert(PositionFactory.InvalidConfiguration.selector);
            new PositionFactory(p);
        }
    }

    function test_accountConstructorRejectsUnsafePolicyAndZeroManifestAtomically() public {
        uint256[5] memory safety = [uint256(0), 1e18, SAFETY, SAFETY, 10e18];
        uint256[5] memory comfortable = [COMFORTABLE, COMFORTABLE, SAFETY, uint256(10e18 + 1), 10e18];
        for (uint256 i; i < safety.length; i++) {
            vm.expectRevert(PositionAccount.InvalidConfiguration.selector);
            vm.prank(ALICE);
            factory.createPosition(ID, address(weth), safety[i], comfortable[i], MANIFEST);
            assertEq(factory.getPosition(ALICE, ID), address(0));
            assertEq(factory.latestPosition(ALICE), address(0));
        }
        vm.expectRevert(PositionAccount.InvalidConfiguration.selector);
        vm.prank(ALICE);
        factory.createPosition(ID, address(weth), SAFETY, COMFORTABLE, bytes32(0));
        assertEq(factory.getPosition(ALICE, ID), address(0));
        PositionAccount valid = _create(ALICE, ID, address(weth));
        assertTrue(factory.isPosition(address(valid)));
    }

    function test_safeHealthFactorBoundariesRemainAvailable() public {
        vm.prank(ALICE);
        PositionAccount low = PositionAccount(factory.createPosition(ID, address(weth), 1e18 + 1, 1e18 + 2, MANIFEST));
        assertEq(low.safetyHF(), 1e18 + 1);
        assertEq(low.comfortableHF(), 1e18 + 2);
        vm.prank(ALICE);
        PositionAccount high =
            PositionAccount(factory.createPosition(NEXT_ID, address(usdc), 10e18 - 1, 10e18, MANIFEST));
        assertEq(high.comfortableHF(), 10e18);
    }

    function testFuzz_ownerSelectedIdsStayUnique(bytes32 id) public {
        if (id == bytes32(0)) return;
        PositionAccount first = _create(ALICE, id, address(weth));
        PositionAccount second = _create(BOB, id, address(weth));
        assertTrue(address(first) != address(second));
        assertEq(factory.getPosition(ALICE, id), address(first));
        assertEq(factory.getPosition(BOB, id), address(second));
        vm.expectRevert(PositionFactory.PositionExists.selector);
        _create(ALICE, id, address(usdc));
    }
}

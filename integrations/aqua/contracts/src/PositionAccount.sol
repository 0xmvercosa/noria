// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20, IScaledToken, IAavePool, IAqua, IInventoryAdapter} from "./interfaces/Protocols.sol";
import {TokenOps} from "./TokenOps.sol";
import {CycleAccounting} from "./CycleAccounting.sol";

/// @title Noria Position Account
/// @notice One owner's Aave collateral/debt and Aqua maker inventory, on the same account.
/// @dev The owner authorizes programs and inventory provenance. A keeper may stop exposure,
///      but cannot trade, attest profit, change policy, borrow again or withdraw funds.
///      No public-chain deployment is implied by the local-fork reference implementation.
contract PositionAccount {
    using TokenOps for IERC20;

    enum Phase {
        Unfunded,
        Ready,
        Active,
        Closing,
        Allocated,
        Defended,
        Closed
    }

    struct Config {
        address owner;
        address keeper;
        address weth;
        address usdc;
        address collateral;
        address debtToken;
        address receiptToken;
        address aave;
        address aqua;
        address swapVM;
        address adapter;
        uint256 safetyHF;
        uint256 comfortableHF;
        bytes32 manifestHash;
    }

    struct Order {
        address maker;
        uint256 traits;
        bytes data;
    }

    address public immutable owner;
    address public immutable keeper;
    IERC20 public immutable weth;
    IERC20 public immutable usdc;
    IERC20 public immutable collateral;
    IScaledToken public immutable debtToken;
    IScaledToken public immutable receiptToken;
    IAavePool public immutable aave;
    IAqua public immutable aqua;
    address public immutable swapVM;
    IInventoryAdapter public immutable adapter;
    uint256 public immutable safetyHF;
    uint256 public immutable comfortableHF;
    bytes32 public immutable manifestHash;
    Phase public phase;
    uint256 public cycleId;
    uint256 public nonce;
    uint256 public principal;
    uint256 public lpWeth;
    uint256 public lpUsdc;
    uint256 public reserves;
    uint256 public lossCarry;
    uint256 public debtCheckpoint;
    uint256 public scaledDebtCheckpoint;
    uint256 public carriedInterest;
    bytes32 public strategyHash;
    bytes32 public dockSnapshotHash;
    bool public inventoryConfirmed;
    bool private entered;

    error Unauthorized();
    error InvalidState();
    error InvalidConfiguration();
    error UnsafeHealth();
    error InvalidInventory();
    error ExternalDebtMovement();
    error InvalidProgram();

    event Opened(address indexed collateral, uint256 supplied, uint256 borrowed, uint256 healthFactor);
    event CollateralAdded(uint256 amount, uint256 healthFactor);
    event InventoryConverted(address indexed tokenIn, uint256 amountIn, uint256 amountOut);
    event CycleShipped(uint256 indexed cycleId, bytes32 indexed strategyHash, uint256 wethAmount, uint256 usdcAmount);
    event CycleDocked(
        uint256 indexed cycleId, uint256 nonce, bytes32 snapshotHash, uint256 wethAmount, uint256 usdcAmount
    );
    event InventoryConfirmed(
        uint256 indexed cycleId, uint256 nonce, bytes32 evidenceRoot, uint256 wethAmount, uint256 usdcAmount
    );
    event CycleAllocated(
        uint256 indexed cycleId,
        uint256 recovered,
        uint256 interest,
        int256 resultAfterProvision,
        uint256 eligible,
        uint256 repayment,
        uint256 nextPrincipal,
        uint256 provision,
        uint256 nextLossCarry
    );
    event Defended(uint256 indexed cycleId, uint256 repaid, uint256 residualDebt, uint256 residualWeth);
    event DebtReconciled(bytes32 indexed evidenceRoot, uint256 externalDebtReduction, uint256 carriedInterest);
    event Closed(uint256 collateralReturned, uint256 usdcReturned, uint256 wethReturned);

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert InvalidState();
        entered = true;
        _;
        entered = false;
    }

    constructor(Config memory c) {
        if (
            c.owner == address(0) || c.safetyHF <= 1e18 || c.comfortableHF <= c.safetyHF || c.comfortableHF > 10e18
                || c.weth == c.usdc || (c.collateral != c.weth && c.collateral != c.usdc) || c.manifestHash == bytes32(0)
                || c.weth.code.length == 0 || c.usdc.code.length == 0 || c.debtToken.code.length == 0
                || c.receiptToken.code.length == 0 || c.aave.code.length == 0 || c.aqua.code.length == 0
                || c.swapVM.code.length == 0 || c.adapter.code.length == 0
        ) revert InvalidConfiguration();
        if (
            IScaledToken(c.debtToken).UNDERLYING_ASSET_ADDRESS() != c.usdc || IScaledToken(c.debtToken).POOL() != c.aave
                || IScaledToken(c.receiptToken).UNDERLYING_ASSET_ADDRESS() != c.collateral
                || IScaledToken(c.receiptToken).POOL() != c.aave
        ) revert InvalidConfiguration();
        owner = c.owner;
        keeper = c.keeper;
        weth = IERC20(c.weth);
        usdc = IERC20(c.usdc);
        collateral = IERC20(c.collateral);
        debtToken = IScaledToken(c.debtToken);
        receiptToken = IScaledToken(c.receiptToken);
        aave = IAavePool(c.aave);
        aqua = IAqua(c.aqua);
        swapVM = c.swapVM;
        adapter = IInventoryAdapter(c.adapter);
        safetyHF = c.safetyHF;
        comfortableHF = c.comfortableHF;
        manifestHash = c.manifestHash;
    }

    /// @notice Supply WETH or USDC as collateral, then borrow USDC. There is no automatic reborrow.
    /// @param collateralAmount Amount in the chosen collateral token's base units.
    /// @param borrowUSDC USDC base units; the planner sizes this below Aave's capacity.
    function openPosition(uint256 collateralAmount, uint256 borrowUSDC) external onlyOwner nonReentrant {
        if (phase != Phase.Unfunded || collateralAmount == 0 || borrowUSDC == 0) revert InvalidState();
        _supply(collateralAmount);
        uint256 beforeUSDC = usdc.balanceOf(address(this));
        aave.borrow(address(usdc), borrowUSDC, 2, 0, address(this));
        if (usdc.balanceOf(address(this)) - beforeUSDC != borrowUSDC) revert InvalidInventory();
        if (healthFactor() < comfortableHF) revert UnsafeHealth();
        principal = borrowUSDC;
        lpUsdc = borrowUSDC;
        phase = Phase.Ready;
        _checkpointDebt();
        emit Opened(address(collateral), collateralAmount, borrowUSDC, healthFactor());
    }

    /// @notice Adds collateral without growing the debt or treating a deposit as LP profit.
    function addCollateral(uint256 amount) external onlyOwner nonReentrant {
        if (phase == Phase.Unfunded || phase == Phase.Closed || amount == 0) revert InvalidState();
        _supply(amount);
        emit CollateralAdded(amount, healthFactor());
    }

    /// @notice Convert only tracked LP inventory through the immutable pair-specific adapter.
    /// @dev The owner provides a separately verified slippage bound and short deadline.
    function swapInventory(bool wethIn, uint256 amount, uint256 minOut, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 received)
    {
        if (!(phase == Phase.Ready || phase == Phase.Allocated || (phase == Phase.Closing && inventoryConfirmed))) {
            revert InvalidState();
        }
        if (healthFactor() <= safetyHF || debtToken.balanceOf(address(this)) == 0 || principal == 0) {
            revert UnsafeHealth();
        }
        IERC20 tokenIn = wethIn ? weth : usdc;
        IERC20 tokenOut = wethIn ? usdc : weth;
        if (amount == 0 || amount > (wethIn ? lpWeth : lpUsdc) || deadline > block.timestamp + 15 minutes) {
            revert InvalidInventory();
        }
        tokenIn.safeApprove(address(adapter), amount);
        received = adapter.swap(address(tokenIn), address(tokenOut), amount, minOut, deadline);
        tokenIn.safeApprove(address(adapter), 0);
        if (wethIn) {
            lpWeth -= amount;
            lpUsdc += received;
        } else {
            lpUsdc -= amount;
            lpWeth += received;
        }
        _checkBacking();
        emit InventoryConverted(address(tokenIn), amount, received);
    }

    /// @notice Ship a new official SDK program. Owner review is required for every new range.
    /// @dev Requires the deployed SDK 0.4.4 Aqua format, maker-only receipt and no hooks.
    ///      Only WETH/USDC virtual balances and approvals are supplied; takers name the direction.
    function shipCycle(bytes calldata encodedOrder) external onlyOwner nonReentrant {
        if ((phase != Phase.Ready && phase != Phase.Allocated) || lpWeth == 0 || lpUsdc == 0) {
            revert InvalidState();
        }
        _checkDebt();
        _checkBacking();
        if (healthFactor() < comfortableHF || debtToken.balanceOf(address(this)) == 0 || principal == 0) {
            revert UnsafeHealth();
        }
        Order memory order = abi.decode(encodedOrder, (Order));
        uint256 expectedTraits = uint256(1) << 254;
        if (
            order.maker != address(this) || order.traits != expectedTraits || order.data.length == 0
                || keccak256(encodedOrder) != keccak256(abi.encode(order))
        ) revert InvalidProgram();
        address[] memory tokens = _tokens();
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = lpWeth;
        amounts[1] = lpUsdc;
        // Aqua's virtual balances cap each strategy. These allowances also support changing
        // inventory across bidirectional fills. Only one strategy may be active at a time.
        weth.safeApprove(address(aqua), type(uint256).max);
        usdc.safeApprove(address(aqua), type(uint256).max);
        strategyHash = aqua.ship(swapVM, encodedOrder, tokens, amounts);
        phase = Phase.Active;
        inventoryConfirmed = false;
        cycleId++;
        emit CycleShipped(cycleId, strategyHash, lpWeth, lpUsdc);
    }

    /// @notice Atomically stop fills and commit virtual inventory before any settlement.
    function requestClose() external nonReentrant {
        if (msg.sender != owner && msg.sender != keeper) revert Unauthorized();
        if (phase != Phase.Active) revert InvalidState();
        _dock();
        phase = Phase.Closing;
    }

    /// @notice Direct owner confirmation works with a normal wallet or local impersonation.
    /// @dev Aqua.push is public. Balance changes alone never authenticate profit. The evidence
    ///      root commits a journal classifying fills, injections and related-party transfers.
    function confirmInventory(
        uint256 expectedCycle,
        uint256 expectedNonce,
        bytes32 expectedSnapshot,
        uint256 confirmedWeth,
        uint256 confirmedUsdc,
        bytes32 evidenceRoot
    ) external onlyOwner nonReentrant {
        if (
            phase != Phase.Closing || inventoryConfirmed || expectedCycle != cycleId || expectedNonce != nonce
                || expectedSnapshot != dockSnapshotHash || evidenceRoot == bytes32(0)
        ) revert InvalidState();
        _checkDebt();
        if (confirmedWeth > lpWeth || confirmedUsdc > lpUsdc) revert InvalidInventory();
        lpWeth = confirmedWeth;
        lpUsdc = confirmedUsdc;
        _checkBacking();
        inventoryConfirmed = true;
        emit InventoryConfirmed(cycleId, nonce, evidenceRoot, lpWeth, lpUsdc);
    }

    /// @notice Repay accrued interest, recover prior losses, then apply the 50/50 policy.
    /// @dev Close the WETH inventory to USDC first. Provisions remain assets, not expenses.
    function allocateCycle(uint256 provision) external onlyOwner nonReentrant {
        if (phase != Phase.Closing || !inventoryConfirmed || lpWeth != 0) revert InvalidState();
        // Cost reserves require a separate obligation lifecycle. This release settles only
        // real wallet gas/conversion costs in its journal and never locks fictional provisions.
        if (provision != 0) revert InvalidConfiguration();
        _checkDebt();
        _checkBacking();
        if (healthFactor() <= safetyHF) revert UnsafeHealth();
        CycleAccounting.Result memory r = CycleAccounting.calculate(
            CycleAccounting.Input({
                principal: principal,
                recovered: lpUsdc,
                debtCheckpoint: debtCheckpoint,
                debtNow: debtToken.balanceOf(address(this)),
                provision: provision,
                lossCarry: lossCarry,
                healthy: healthFactor() >= comfortableHF,
                carriedInterest: carriedInterest
            })
        );
        uint256 recovered = lpUsdc;
        uint256 repaid = _repay(r.repayment);
        if (repaid != r.repayment) revert InvalidInventory();
        reserves += provision;
        lossCarry = r.nextLossCarry;
        principal = r.nextPrincipal;
        lpUsdc = r.nextPrincipal + r.freeCash;
        phase = Phase.Allocated;
        carriedInterest = 0;
        _checkpointDebt();
        emit CycleAllocated(
            cycleId,
            recovered,
            r.interest,
            r.resultAfterProvision,
            r.eligible,
            repaid,
            r.nextPrincipal,
            provision,
            lossCarry
        );
    }

    /// @notice Reconcile externally burned debt without crediting it to the LP's profit.
    /// @dev The owner attests actual aggregate debt reductions from Aave receipts. Balance
    ///      and current index alone cannot reveal the timing of multiple external burns.
    ///      The no-burn counterfactual bounds the claim; the journal supplies its provenance.
    ///      Collateral liquidation must also be classified separately in that journal.
    function reconcileDebt(uint256 externalDebtReduction, bytes32 evidenceRoot) external onlyOwner nonReentrant {
        if (
            phase == Phase.Active || phase == Phase.Unfunded || phase == Phase.Defended || phase == Phase.Closed
                || evidenceRoot == bytes32(0)
        ) revert InvalidState();
        uint256 scaledNow = debtToken.scaledBalanceOf(address(this));
        if (scaledNow >= scaledDebtCheckpoint) revert ExternalDebtMovement();
        uint256 index = aave.getReserveNormalizedVariableDebt(address(usdc));
        uint256 projected = (scaledDebtCheckpoint * index + 5e26) / 1e27;
        uint256 debtNow = debtToken.balanceOf(address(this));
        uint256 reconstructed = debtNow + externalDebtReduction;
        if (externalDebtReduction == 0 || reconstructed < debtCheckpoint || reconstructed > projected + 2) {
            revert ExternalDebtMovement();
        }
        carriedInterest += reconstructed - debtCheckpoint;
        emit DebtReconciled(evidenceRoot, externalDebtReduction, carriedInterest);
        _checkpointDebt();
        // Any earlier profit authorization is no longer complete after an outside flow.
        inventoryConfirmed = false;
        nonce++;
        dockSnapshotHash = keccak256(
            abi.encode(
                dockSnapshotHash,
                block.chainid,
                address(this),
                nonce,
                lpWeth,
                lpUsdc,
                debtCheckpoint,
                scaledDebtCheckpoint,
                carriedInterest,
                evidenceRoot
            )
        );
    }

    /// @notice Stop and repay available USDC without waiting for a profit checkpoint.
    /// @dev Keeper can act only at/below safety HF. This is terminal: no new LP until a new
    ///      position is explicitly opened. Residual WETH needs owner-controlled realization.
    function defend() external nonReentrant {
        if (msg.sender != owner && (msg.sender != keeper || healthFactor() > safetyHF)) revert Unauthorized();
        if (phase == Phase.Unfunded || phase == Phase.Closed) revert InvalidState();
        if (phase == Phase.Active) _dock();
        weth.safeApprove(address(aqua), 0);
        usdc.safeApprove(address(aqua), 0);
        phase = Phase.Defended;
        inventoryConfirmed = false;
        uint256 repaid = _repay(usdc.balanceOf(address(this)));
        reserves = 0;
        lpUsdc = usdc.balanceOf(address(this));
        lpWeth = weth.balanceOf(address(this));
        _checkpointDebt();
        emit Defended(cycleId, repaid, debtCheckpoint, lpWeth);
    }

    /// @notice Finish defensive realization with owner's explicit slippage limit; no profit is distributed.
    function realizeDefense(uint256 minOut, uint256 deadline) external onlyOwner nonReentrant {
        if (phase != Phase.Defended || deadline > block.timestamp + 15 minutes) revert InvalidState();
        uint256 amount = weth.balanceOf(address(this));
        if (amount == 0) revert InvalidInventory();
        weth.safeApprove(address(adapter), amount);
        uint256 received = adapter.swap(address(weth), address(usdc), amount, minOut, deadline);
        weth.safeApprove(address(adapter), 0);
        emit InventoryConverted(address(weth), amount, received);
        uint256 repaid = _repay(usdc.balanceOf(address(this)));
        lpWeth = 0;
        lpUsdc = usdc.balanceOf(address(this));
        _checkpointDebt();
        emit Defended(cycleId, repaid, debtCheckpoint, 0);
    }

    /// @notice Owner may repay residual debt with external USDC; it never enters profit accounting.
    function repayExternal(uint256 amount) external onlyOwner nonReentrant {
        if (phase != Phase.Defended || amount == 0) revert InvalidState();
        usdc.safeTransferFrom(owner, address(this), amount);
        _repay(amount);
        _checkpointDebt();
    }

    /// @notice Return collateral and all residual inventory only after debt is zero and fills stopped.
    function exit() external onlyOwner nonReentrant {
        if ((phase != Phase.Defended && phase != Phase.Allocated) || debtToken.balanceOf(address(this)) != 0) {
            revert InvalidState();
        }
        phase = Phase.Closed;
        uint256 returned;
        if (receiptToken.balanceOf(address(this)) > 0) {
            returned = aave.withdraw(address(collateral), type(uint256).max, owner);
        }
        uint256 u = usdc.balanceOf(address(this));
        uint256 w = weth.balanceOf(address(this));
        if (u > 0) usdc.safeTransfer(owner, u);
        if (w > 0) weth.safeTransfer(owner, w);
        lpWeth = 0;
        lpUsdc = 0;
        reserves = 0;
        emit Closed(returned, u, w);
    }

    function healthFactor() public view returns (uint256 hf) {
        (,,,,, hf) = aave.getUserAccountData(address(this));
    }

    function _supply(uint256 amount) private {
        collateral.safeTransferFrom(owner, address(this), amount);
        collateral.safeApprove(address(aave), amount);
        aave.supply(address(collateral), amount, address(this), 0);
        aave.setUserUseReserveAsCollateral(address(collateral), true);
        collateral.safeApprove(address(aave), 0);
    }

    function _repay(uint256 amount) private returns (uint256 paid) {
        uint256 debt = debtToken.balanceOf(address(this));
        if (amount > debt) amount = debt;
        if (amount == 0) return 0;
        usdc.safeApprove(address(aave), amount);
        paid = aave.repay(address(usdc), amount, 2, address(this));
        usdc.safeApprove(address(aave), 0);
    }

    function _checkpointDebt() private {
        debtCheckpoint = debtToken.balanceOf(address(this));
        scaledDebtCheckpoint = debtToken.scaledBalanceOf(address(this));
    }

    function _checkDebt() private view {
        if (debtToken.scaledBalanceOf(address(this)) != scaledDebtCheckpoint) revert ExternalDebtMovement();
    }

    function _checkBacking() private view {
        if (weth.balanceOf(address(this)) < lpWeth || usdc.balanceOf(address(this)) < lpUsdc + reserves) {
            revert InvalidInventory();
        }
    }

    function _tokens() private view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(weth);
        tokens[1] = address(usdc);
    }

    function _dock() private {
        (uint248 w, uint8 wc) = aqua.rawBalances(address(this), swapVM, strategyHash, address(weth));
        (uint248 u, uint8 uc) = aqua.rawBalances(address(this), swapVM, strategyHash, address(usdc));
        if (wc != 2 || uc != 2) revert InvalidInventory();
        aqua.dock(swapVM, strategyHash, _tokens());
        weth.safeApprove(address(aqua), 0);
        usdc.safeApprove(address(aqua), 0);
        lpWeth = w;
        lpUsdc = u;
        nonce++;
        dockSnapshotHash = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                cycleId,
                nonce,
                strategyHash,
                w,
                u,
                debtToken.balanceOf(address(this)),
                debtToken.scaledBalanceOf(address(this))
            )
        );
        emit CycleDocked(cycleId, nonce, dockSnapshotHash, w, u);
    }
}

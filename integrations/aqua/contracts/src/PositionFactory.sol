// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {PositionAccount} from "./PositionAccount.sol";
import {IScaledToken} from "./interfaces/Protocols.sol";

/// @title Noria Position Factory
/// @notice Registers a separate, owner-controlled position for each owner-selected identifier.
/// @dev Protocol configuration is written only in the constructor. There are no setters,
///      upgrades, privileged factory operators, token approvals or custody operations.
///      Configuration uses storage so the deployed runtime has one reproducible code hash.
contract PositionFactory {
    struct Protocols {
        address weth;
        address usdc;
        address aWeth;
        address aUsdc;
        address debtUSDC;
        address aave;
        address aqua;
        address swapVM;
        address adapter;
    }

    Protocols private configuredProtocols;
    mapping(address owner => mapping(bytes32 id => address account)) public getPosition;
    mapping(address owner => address account) public latestPosition;
    mapping(address account => bool registered) public isPosition;

    error InvalidConfiguration();
    error InvalidId();
    error PositionExists();
    error UnsupportedCollateral();

    event PositionCreated(
        address indexed owner,
        address indexed account,
        bytes32 indexed id,
        address collateral,
        bytes32 manifestHash,
        uint256 safetyHF,
        uint256 comfortableHF
    );

    constructor(Protocols memory p) {
        if (
            p.weth == p.usdc || p.debtUSDC == p.aUsdc || p.debtUSDC == p.aWeth || p.weth.code.length == 0
                || p.usdc.code.length == 0 || p.aWeth.code.length == 0 || p.aUsdc.code.length == 0
                || p.debtUSDC.code.length == 0 || p.aave.code.length == 0 || p.aqua.code.length == 0
                || p.swapVM.code.length == 0 || p.adapter.code.length == 0
        ) revert InvalidConfiguration();
        _validateScaledToken(p.aWeth, p.weth, p.aave);
        _validateScaledToken(p.aUsdc, p.usdc, p.aave);
        _validateScaledToken(p.debtUSDC, p.usdc, p.aave);
        configuredProtocols = p;
    }

    /// @notice Returns the constructor-fixed addresses used for every registered position.
    function protocols() external view returns (Protocols memory) {
        return configuredProtocols;
    }

    /// @notice Create a position with the caller as both owner and keeper, without moving funds.
    /// @param id Nonzero owner-selected identifier; unique within this caller's registry.
    /// @param collateral Either the configured WETH or native USDC token address.
    /// @param safetyHF Safety health factor, scaled by 1e18 and strictly above 1e18.
    /// @param comfortableHF Comfort health factor, above safetyHF and at most 10e18.
    /// @param manifestHash Nonzero commitment to the owner's reviewed position manifest.
    /// @return account The newly deployed and registered PositionAccount address.
    function createPosition(
        bytes32 id,
        address collateral,
        uint256 safetyHF,
        uint256 comfortableHF,
        bytes32 manifestHash
    ) external returns (address account) {
        if (id == bytes32(0)) revert InvalidId();
        if (getPosition[msg.sender][id] != address(0)) revert PositionExists();
        Protocols memory p = configuredProtocols;
        if (collateral != p.weth && collateral != p.usdc) revert UnsupportedCollateral();

        PositionAccount.Config memory c;
        c.owner = msg.sender;
        c.keeper = msg.sender;
        c.weth = p.weth;
        c.usdc = p.usdc;
        c.collateral = collateral;
        c.debtToken = p.debtUSDC;
        c.receiptToken = collateral == p.weth ? p.aWeth : p.aUsdc;
        c.aave = p.aave;
        c.aqua = p.aqua;
        c.swapVM = p.swapVM;
        c.adapter = p.adapter;
        c.safetyHF = safetyHF;
        c.comfortableHF = comfortableHF;
        c.manifestHash = manifestHash;

        // The account constructor rechecks deployment identities, policy and manifest.
        account = address(new PositionAccount{salt: keccak256(abi.encode(msg.sender, id))}(c));
        getPosition[msg.sender][id] = account;
        latestPosition[msg.sender] = account;
        isPosition[account] = true;
        emit PositionCreated(msg.sender, account, id, collateral, manifestHash, safetyHF, comfortableHF);
    }

    function _validateScaledToken(address token, address asset, address pool) private view {
        if (IScaledToken(token).UNDERLYING_ASSET_ADDRESS() != asset || IScaledToken(token).POOL() != pool) {
            revert InvalidConfiguration();
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal public protocol interfaces. Implementations remain official deployed contracts.
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IScaledToken is IERC20 {
    function scaledBalanceOf(address account) external view returns (uint256);
    function UNDERLYING_ASSET_ADDRESS() external view returns (address);
    function POOL() external view returns (address);
}

interface IAavePool {
    function getReserveNormalizedVariableDebt(address asset) external view returns (uint256);
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
    function borrow(address asset, uint256 amount, uint256 mode, uint16 referralCode, address onBehalfOf) external;
    function repay(address asset, uint256 amount, uint256 mode, address onBehalfOf) external returns (uint256);
    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
    function setUserUseReserveAsCollateral(address asset, bool useAsCollateral) external;
    function getUserAccountData(address user)
        external
        view
        returns (
            uint256 collateralBase,
            uint256 debtBase,
            uint256 availableBorrowsBase,
            uint256 liquidationThreshold,
            uint256 ltv,
            uint256 healthFactor
        );
}

interface IAqua {
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external
        returns (bytes32);
    function dock(address app, bytes32 strategyHash, address[] calldata tokens) external;
    function rawBalances(address maker, address app, bytes32 strategyHash, address token)
        external
        view
        returns (uint248 balance, uint8 tokensCount);
}

interface IInventoryAdapter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        external
        returns (uint256 amountOut);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

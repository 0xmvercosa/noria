// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20, IInventoryAdapter, IUniswapV3Router} from "./interfaces/Protocols.sol";
import {TokenOps} from "./TokenOps.sol";

/// @notice Fixed-route inventory conversion. These trades are NOT Aqua strategy fills.
/// @dev No arbitrary calldata, recipients, token pairs or router selection at execution time.
contract UniswapInventoryAdapter is IInventoryAdapter {
    using TokenOps for IERC20;

    IUniswapV3Router public immutable router;
    address public immutable weth;
    address public immutable usdc;
    uint24 public immutable fee;
    bool private entered;

    error InvalidSwap();

    constructor(address router_, address weth_, address usdc_, uint24 fee_) {
        if (router_.code.length == 0 || weth_.code.length == 0 || usdc_.code.length == 0 || weth_ == usdc_ || fee_ == 0)
        {
            revert InvalidSwap();
        }
        router = IUniswapV3Router(router_);
        weth = weth_;
        usdc = usdc_;
        fee = fee_;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        external
        returns (uint256 received)
    {
        if (
            entered || amountIn == 0 || minOut == 0 || block.timestamp > deadline
                || !((tokenIn == weth && tokenOut == usdc) || (tokenIn == usdc && tokenOut == weth))
        ) revert InvalidSwap();
        entered = true;
        IERC20 input = IERC20(tokenIn);
        uint256 beforeInput = input.balanceOf(address(this));
        input.safeTransferFrom(msg.sender, address(this), amountIn);
        if (input.balanceOf(address(this)) - beforeInput != amountIn) revert InvalidSwap();
        input.safeApprove(address(router), amountIn);
        uint256 beforeOutput = IERC20(tokenOut).balanceOf(msg.sender);
        router.exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: msg.sender,
                deadline: deadline,
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        input.safeApprove(address(router), 0);
        received = IERC20(tokenOut).balanceOf(msg.sender) - beforeOutput;
        if (received < minOut || input.balanceOf(address(this)) != beforeInput) revert InvalidSwap();
        entered = false;
    }
}

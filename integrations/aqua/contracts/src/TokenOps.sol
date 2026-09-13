// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "./interfaces/Protocols.sol";

/// @notice Handles ERC20 implementations returning either true or no value.
library TokenOps {
    error TokenCallFailed(address token);

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(token.transfer, (to, amount)));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(token.transferFrom, (from, to, amount)));
    }

    function safeApprove(IERC20 token, address spender, uint256 amount) internal {
        if (token.allowance(address(this), spender) != 0) _call(token, abi.encodeCall(token.approve, (spender, 0)));
        if (amount != 0) _call(token, abi.encodeCall(token.approve, (spender, amount)));
    }

    function _call(IERC20 token, bytes memory data) private {
        if (address(token).code.length == 0) revert TokenCallFailed(address(token));
        (bool ok, bytes memory result) = address(token).call(data);
        if (!ok || (result.length != 0 && (result.length != 32 || !abi.decode(result, (bool))))) {
            revert TokenCallFailed(address(token));
        }
    }
}

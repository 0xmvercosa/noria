// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20, IUniswapV3Router} from "../../src/interfaces/Protocols.sol";

/// @dev These are unit-test fixtures, not substitutes for the separate official-protocol fork suite.
contract MockToken {
    mapping(address => uint256) internal balances;
    mapping(address => mapping(address => uint256)) public allowance;
    function balanceOf(address account) public view virtual returns (uint256) { return balances[account]; }
    function mint(address to, uint256 amount) external { balances[to] += amount; }
    function burn(address from, uint256 amount) external { balances[from] -= amount; }
    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount; return true;
    }
    function transfer(address to, uint256 amount) external returns (bool) { _transfer(msg.sender, to, amount); return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        if (allowance[from][msg.sender] != type(uint256).max) allowance[from][msg.sender] -= amount;
        _transfer(from, to, amount); return true;
    }
    function _transfer(address from, address to, uint256 amount) internal { balances[from] -= amount; balances[to] += amount; }
}

contract MockReceiptToken is MockToken {
    address public immutable UNDERLYING_ASSET_ADDRESS;
    address public immutable POOL;
    constructor(address asset, address pool) { UNDERLYING_ASSET_ADDRESS = asset; POOL = pool; }
    function scaledBalanceOf(address account) external view returns (uint256) { return balances[account]; }
}

interface IIndexSource { function getReserveNormalizedVariableDebt(address asset) external view returns (uint256); }

contract MockDebtToken is MockToken {
    uint256 internal constant RAY = 1e27;
    address public immutable UNDERLYING_ASSET_ADDRESS;
    address public immutable POOL;
    constructor(address asset, address pool) { UNDERLYING_ASSET_ADDRESS = asset; POOL = pool; }
    function balanceOf(address account) public view override returns (uint256) {
        return (balances[account] * IIndexSource(POOL).getReserveNormalizedVariableDebt(UNDERLYING_ASSET_ADDRESS) + RAY / 2) / RAY;
    }
    function scaledBalanceOf(address account) external view returns (uint256) { return balances[account]; }
    function mintDebt(address account, uint256 amount) external {
        uint256 index = IIndexSource(POOL).getReserveNormalizedVariableDebt(UNDERLYING_ASSET_ADDRESS);
        balances[account] += (amount * RAY + index / 2) / index;
    }
    function burnDebt(address account, uint256 amount) external {
        if (amount == balanceOf(account)) { balances[account] = 0; return; }
        uint256 index = IIndexSource(POOL).getReserveNormalizedVariableDebt(UNDERLYING_ASSET_ADDRESS);
        balances[account] -= (amount * RAY + index / 2) / index;
    }
}

contract MockAavePool {
    MockToken public immutable weth;
    MockToken public immutable usdc;
    MockReceiptToken public immutable aWeth;
    MockReceiptToken public immutable aUsdc;
    MockDebtToken public immutable debt;
    uint256 public index = 1e27;
    uint256 public configuredHF = 2e18;
    bool public failBorrow;
    bool public failWithdraw;
    bool public failHealthRead;
    uint256 public withdrawCalls;
    constructor(MockToken w, MockToken u) {
        weth = w; usdc = u;
        aWeth = new MockReceiptToken(address(w), address(this));
        aUsdc = new MockReceiptToken(address(u), address(this));
        debt = new MockDebtToken(address(u), address(this));
    }
    function setIndex(uint256 value) external { require(value >= index, "index decreases"); index = value; }
    function setHF(uint256 value) external { configuredHF = value; }
    function setFailBorrow(bool value) external { failBorrow = value; }
    function setFailWithdraw(bool value) external { failWithdraw = value; }
    function setFailHealthRead(bool value) external { failHealthRead = value; }
    function getReserveNormalizedVariableDebt(address asset) external view returns (uint256) {
        require(asset == address(usdc), "wrong debt asset"); return index;
    }
    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        _receipt(asset).mint(onBehalfOf, amount);
    }
    function setUserUseReserveAsCollateral(address, bool) external {}
    function borrow(address asset, uint256 amount, uint256 mode, uint16, address onBehalfOf) external {
        require(!failBorrow && asset == address(usdc) && mode == 2, "borrow rejected");
        debt.mintDebt(onBehalfOf, amount); usdc.mint(msg.sender, amount);
    }
    function repay(address asset, uint256 amount, uint256 mode, address onBehalfOf) external returns (uint256) {
        require(asset == address(usdc) && mode == 2, "wrong repay");
        uint256 current = debt.balanceOf(onBehalfOf);
        if (amount > current) amount = current;
        usdc.transferFrom(msg.sender, address(this), amount); debt.burnDebt(onBehalfOf, amount); return amount;
    }
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        require(!failWithdraw, "withdraw unavailable");
        MockReceiptToken receipt = _receipt(asset);
        if (amount == type(uint256).max) amount = receipt.balanceOf(msg.sender);
        require(amount > 0, "Aave zero withdrawal");
        withdrawCalls++; receipt.burn(msg.sender, amount); IERC20(asset).transfer(to, amount); return amount;
    }
    function getUserAccountData(address account) external view returns (uint256,uint256,uint256,uint256,uint256,uint256) {
        require(!failHealthRead, "health unavailable");
        uint256 owed = debt.balanceOf(account);
        return (0, owed, 0, 0, 0, owed == 0 ? type(uint256).max : configuredHF);
    }
    function _receipt(address asset) private view returns (MockReceiptToken) {
        require(asset == address(weth) || asset == address(usdc), "unsupported collateral");
        return asset == address(weth) ? aWeth : aUsdc;
    }
}

contract MockAqua {
    struct Balance { uint248 amount; uint8 count; }
    mapping(bytes32 => mapping(address => Balance)) private balances;
    function _key(address maker, address app, bytes32 hash) private pure returns (bytes32) {
        return keccak256(abi.encode(maker, app, hash));
    }
    function ship(address app, bytes calldata strategy, address[] calldata tokens, uint256[] calldata amounts)
        external returns (bytes32 hash)
    {
        hash = keccak256(strategy); bytes32 key = _key(msg.sender, app, hash);
        for (uint256 i; i < tokens.length; i++) {
            require(balances[key][tokens[i]].count == 0, "immutable strategy");
            balances[key][tokens[i]] = Balance(uint248(amounts[i]), uint8(tokens.length));
        }
    }
    function rawBalances(address maker, address app, bytes32 hash, address token) external view returns (uint248,uint8) {
        Balance memory b = balances[_key(maker, app, hash)][token]; return (b.amount, b.count);
    }
    function dock(address app, bytes32 hash, address[] calldata tokens) external {
        bytes32 key = _key(msg.sender, app, hash);
        for (uint256 i; i < tokens.length; i++) {
            require(balances[key][tokens[i]].count == tokens.length, "incomplete dock");
            balances[key][tokens[i]] = Balance(0, 255);
        }
    }
    function push(address maker, address app, bytes32 hash, address token, uint256 amount) external {
        Balance storage b = balances[_key(maker, app, hash)][token];
        require(b.count > 0 && b.count != 255, "inactive");
        IERC20(token).transferFrom(msg.sender, maker, amount); b.amount += uint248(amount);
    }
    /// @dev A test-controlled fill with actual token movement; this fixture does not model AMM pricing.
    function fill(address maker, address app, bytes32 hash, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut) external {
        bytes32 key = _key(maker, app, hash);
        require(balances[key][tokenIn].count == 2 && balances[key][tokenOut].count == 2, "inactive");
        balances[key][tokenOut].amount -= uint248(amountOut);
        balances[key][tokenIn].amount += uint248(amountIn);
        IERC20(tokenIn).transferFrom(msg.sender, maker, amountIn);
        IERC20(tokenOut).transferFrom(maker, msg.sender, amountOut);
    }
}

contract MockInventoryAdapter {
    address public immutable weth;
    address public immutable usdc;
    uint256 public price = 2_000e6;
    constructor(address w, address u) { weth = w; usdc = u; }
    function setPrice(uint256 value) external { price = value; }
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        external returns (uint256 amountOut)
    {
        require(block.timestamp <= deadline && minOut != 0, "invalid execution bound");
        require((tokenIn == weth && tokenOut == usdc) || (tokenIn == usdc && tokenOut == weth), "wrong pair");
        amountOut = tokenIn == weth ? amountIn * price / 1e18 : amountIn * 1e18 / price;
        require(amountOut >= minOut, "slippage");
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn); MockToken(tokenOut).mint(msg.sender, amountOut);
    }
}

contract MockUniswapRouter {
    uint256 public output = 100;
    uint256 public reportedOutput = 100;
    bool public partialInput;
    address public reenterTarget;
    bytes public reenterData;
    bool public reentrySucceeded;
    address public lastRecipient;
    function configure(uint256 actual, uint256 reported, bool consumePartially) external {
        output = actual; reportedOutput = reported; partialInput = consumePartially;
    }
    function configureReentry(address target, bytes calldata data) external { reenterTarget = target; reenterData = data; }
    function exactInputSingle(IUniswapV3Router.ExactInputSingleParams calldata p) external payable returns (uint256) {
        lastRecipient = p.recipient;
        IERC20(p.tokenIn).transferFrom(msg.sender, address(this), partialInput ? p.amountIn / 2 : p.amountIn);
        if (reenterTarget != address(0)) (reentrySucceeded,) = reenterTarget.call(reenterData);
        MockToken(p.tokenOut).mint(p.recipient, output); return reportedOutput;
    }
}

contract MockSwapVM { }

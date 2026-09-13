# Aqua position architecture

Noria supplies the owner's ETH (wrapped to WETH) or USDC as collateral in Aave, borrows a conservatively sized amount of USDC, and uses the borrowed funds for a concentrated WETH/USDC position on Aqua. The owner chooses collateral amount, safety health factor and comfortable health factor. The discovery tool chooses a source pool and range from eligible historical evidence. The source Uniswap pool is an information source; the new liquidity position is executed by official SwapVM against official Aqua balances.

## Ownership and capital

`PositionAccount` is the Aave collateral holder, USDC debt holder and Aqua maker. Its owner retains administrative control. Existing Aave debt on a different wallet is not automatically migrated or repaid. WETH deposited in Aave becomes an aWETH balance; it is not simultaneously spendable WETH inventory in Aqua. The equivalent distinction holds for USDC and aUSDC.

For ETH funding, the position retains directional ETH collateral exposure and acquires additional ETH exposure through LP inventory. For USDC funding, collateral and debt are both USDC, but the WETH/USDC LP still introduces ETH inventory risk. USDC supply yield can be lower than its borrow rate. This structure is useful only when the realized pool result and collateral yield compensate for borrowing, conversions and execution costs; neither funding path guarantees positive carry.

The loan uses the tighter of Aave's LTV capacity and the requested comfortable HF, with another 50 basis points of sizing headroom. Integer arithmetic uses Aave's actual reserve configuration and oracle prices at a single block. Aave rechecks reserve caps and available liquidity during execution. A failed borrow atomically reverts the supply as well.

## Closed-cycle policy

1. The owner authorizes a new range encoded by `@1inch/swap-vm-sdk`.
2. Aqua records virtual WETH and USDC balances; spendable tokens remain on the position account.
3. A compatible taker calls official SwapVM, which prices the fill and uses Aqua to move actual tokens.
4. Closing reads both virtual balances, docks the strategy and revokes Aqua allowances atomically.
5. The owner confirms a journal commitment classifying fills, external capital and related-party flows. Public `Aqua.push` calls can change both virtual and physical balances, so a balance increase alone is never proof of profit.
6. The owner converts the authenticated remaining WETH inventory to USDC through a fixed-pair inventory adapter.
7. Allocation deducts accrued USDC interest, carries forward earlier losses, and determines eligible surplus. At or above comfortable HF, half the eligible surplus amortizes principal and half grows the next LP budget. Between safety and comfortable HF, all eligible surplus amortizes debt. Interest is repaid first. A loss can reduce the next LP budget; it cannot become distributable yield.
8. The next cycle requires a fresh comfortable HF and explicit owner authorization. There is no automatic additional borrowing. Debt zero blocks all further investment and permits exit.

Amounts and thresholds are integers: USDC has six decimals, WETH eighteen, and HF uses eighteen. The final odd USDC base unit goes to retained capital. The execution contract currently rejects nonzero cost provisions: real gas is reconciled from payer wallet equity, and conversion costs already affect recovered inventory. There are no unfunded reserve obligations hidden in the balance sheet.

## Safety and reconciliation

The keeper may dock a strategy. It may initiate defense at or below safety HF, revoking approvals and repaying available USDC immediately without waiting for the owner to attest profit. Selling WETH during defense still requires the owner's slippage authorization. This is limited automatic defense, not a liquidation guarantee. Oracle moves, keeper latency, Aave liquidity and swap liquidity can all prevent timely recovery.

Scaled USDC debt is checkpointed after controlled borrowing/repayment. Unexpected debt burns suspend ordinary accounting, including burns masked by interest accrual. An owner-authorized reconciliation commits the aggregate actual debt reductions from Aave receipts. Current debt plus those reductions minus the previous checkpoint reconstructs accrued interest, including the intervals after an external repayment. The original scaled debt projected through Aave's variable-debt index provides a conservative upper bound, not an exact inference of timing. Reconciliation preserves the interest owed, classifies external support and invalidates the prior nonce and inventory confirmation. Liquidation losses also require explicit journal classification. Defense is terminal; no implicit reopening follows.

Only one Aqua strategy is active. The deployed-format order must name this account as maker, receive proceeds back to the maker and contain no hooks. The account supplies virtual balances and approvals only for WETH/USDC. Aave collateral receipt and debt tokens are checked against their underlying assets and pool. The inventory adapter exposes no arbitrary targets, recipients or calldata, checks actual token deltas and resets its router allowance after each conversion.

## Discovery versus routing

Noria's Graph module returns historical evidence; it does not send money or authorize transactions. Aqua's `Shipped` event publishes the strategy bytes and hash onchain. Noria also exports the order in the rehearsal manifest. A compatible taker can read the order, obtain an official quote and submit a swap. These are the demonstrated official paths.

Publication does not imply 1inch's commercial routers index, approve or route order flow to the strategy. The configured access-token instruction restricts eligible transaction origins. A local credential issued by impersonating the real NFT owner is a test fixture, not a production credential. Production participation requires the official access process and actual taker integration. `routingStatus` therefore remains `not_validated` even after a local swap succeeds.

## Version binding

The tested Arbitrum deployment accepts `swap((address,uint256,bytes),address,address,uint256,bytes)`. Its order data and traits match SwapVM SDK 0.4.4. The current upstream `main` branch has a different interface and must not be substituted on assumption. Every run records SDK versions, official code hashes, source block/hash, program bytes and strategy hash. No official protocol bytecode is replaced in the rehearsal.

## Implementation map

| Concern                             | Implementation                                                |
| ----------------------------------- | ------------------------------------------------------------- |
| Capital, HF and discovery schemas   | `integrations/aqua/src/boundary.ts`                           |
| Canonical Aave sizing               | `integrations/aqua/src/financing.ts`                          |
| Historical selection and refusals   | `integrations/aqua/src/planner.ts`                            |
| Canonical source pool verification  | `integrations/aqua/src/verifier.ts`                           |
| Official concentrated SwapVM order  | `integrations/aqua/src/official.ts`                           |
| Position lifecycle                  | `integrations/aqua/contracts/src/PositionAccount.sol`         |
| Closed-cycle integer arithmetic     | `integrations/aqua/contracts/src/CycleAccounting.sol`         |
| Actual inventory conversion         | `integrations/aqua/contracts/src/UniswapInventoryAdapter.sol` |
| Isolated fork and operation journal | `integrations/aqua/scripts/rehearse.ts`                       |

The contracts are a reviewed reference implementation with local-fork evidence, not a formal audit or an authorization to deploy with real funds.

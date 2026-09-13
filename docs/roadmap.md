# Roadmap

Noria currently discovers and explains Uniswap v3 liquidity plans and provides an [Arbitrum WETH/native-USDC reference handoff](aqua-integration.md) for an external Aqua system. The next proposed module coordinates borrowed capital and liquidity through **Aave and 1inch Aqua**, for a separate 1inch track effort. **Aave borrowing, Aqua execution and realized-surplus accounting remain planned and not implemented.** No current tool connects a wallet, borrows, provides liquidity, realizes surplus or repays debt.

| Area               | Current behavior                                                   | Planned work                                                          |
| ------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Market evidence    | Graph discovery/history, canonical RPC checks, USD references      | Keep evidence requirements at every decision point                    |
| Liquidity planning | Uniswap v3 ranges, inventory, capacity and exact-pair Aqua handoff | Aqua strategy mapping and execution adapter                           |
| Funding            | Models target inventory; the Aqua handoff values a raw USDC budget | ETH collateral in Aave, USDC borrowing within owner-approved limits   |
| Execution          | Informational output only                                          | Owner-authorized wallet actions and Aqua integration                  |
| Accounting         | Dated explanatory example                                          | Separate maker, taker and consolidated accounts                       |
| Capital allocation | No allocation actions                                              | Eligible realized surplus split 50% reinvestment / 50% debt repayment |
| Health management  | No debt-management tooling                                         | Reduce exposure and debt when collateral health deteriorates          |

## Proposed capital flow

The owner would supply ETH as Aave collateral and authorize bounded USDC borrowing. A future adapter would place approved liquidity through Aqua. The current Uniswap discovery output may inform market review, but **a Uniswap v3 range is not directly executable on Aqua**. Strategy mapping, inventory rules, execution costs and integration tests must be designed for Aqua itself.

The initial design uses an **owner-authorized accounting checkpoint after the Aqua dock step**. That checkpoint would reconcile actual balances, debt, interest and costs before approving another allocation. It is not a fully onchain or autonomous accounting loop, and docking alone would not prove realized profit.

The initial execution demonstration is planned with the team's own actors. Its simulator would authorize the inventory checkpoint through a direct owner-wallet call in a fork, using a provenance report. The product must not present that mechanism as entirely onchain verification or automation without a user authority.

## User lifecycle

Before opening, disclose the ETH allocated to collateral and retained outside the operation, USDC debt and its variable rate, target WETH/USDC inventory, range, swap fee, combined ETH exposure and downside scenarios. Include initial debt health, action thresholds, the 50/50 rule, operating provisions and exit conditions. Supplying WETH to Aave is not staking; keep its supply interest separate from LP performance.

During operation, show assets, debt and health; LP fees and inventory result; realized versus unrealized amounts; eligible surplus; interest coverage versus economic principal repayment; reinvestment; and the next action. Also show active range, inventory, time since the last fill, operational funds, losses to recover, executor availability and pending operations. Do not extrapolate APY from a few fills.

Closing would withdraw liquidity, realize inventory, repay debt as far as proceeds allow and show releasable collateral. If LP proceeds cannot clear the debt, display the remaining obligation. Collateral sales require a separate explicit authorization and amount limit; they never happen silently.

## Eligible realized surplus

Borrowing proceeds, deposited principal and unrealized mark-to-market gains are not surplus. The planned accounting waterfall is:

1. Reconcile realized results and actual balances, including adverse execution and realized losses.
2. Deduct accrued interest, execution/protocol costs and required cost or liability provisions.
3. Recover carried losses before treating any remainder as eligible surplus.
4. When collateral health permits, allocate **50% of eligible realized net surplus to reinvestment and 50% to debt repayment**.

If the remainder is zero or negative, there is no surplus to split. The same expense or loss must not be charged twice across the checkpoint and carry-forward ledger. Accrual and settlement records must be distinguishable so an unpaid obligation cannot disappear from the calculation.

## Account boundaries

| View               | What it must show                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| Maker              | Liquidity inventory, principal, realized fees/results, exposure and attributable costs                   |
| Taker              | Trade cash flows, acquisition/disposal results, execution costs and associated obligations               |
| Consolidated group | Combined assets, liabilities, accrued interest, costs, realized results and remaining unrecovered losses |

Transfers between maker and taker accounts are not consolidated profit. A positive maker result cannot conceal a larger taker loss, debt cost or deterioration in total owner equity. Reinvestment must be supported by the consolidated eligible surplus as well as the accounts that produced it.

## Health takes priority

If collateral health deteriorates, the proposed policy prioritizes reducing liquidity exposure and debt ahead of the normal 50/50 surplus split. The implementation must define explicit health thresholds, data freshness, withdrawal limits and failure handling before enabling actions. It must not assume all liquidity is immediately available or that current USD marks are realizable quotes.

Selling ETH collateral requires **fresh, explicit, bounded owner authorization**, including the maximum amount and execution bounds. Permission to deposit collateral, borrow or dock liquidity is not permission to sell collateral.

## Implementation gates

Before this module can be described as working, it needs an Aqua adapter, Aave position reads, a reconciled accounting ledger, bounded owner approvals, transaction simulation, integration tests and security review. The first milestone should demonstrate a complete owner-reviewed cycle with actual receipts and explain a loss or refused action as clearly as a successful one.

These are execution requirements, not a claim that Aave borrowing or Aqua liquidity provision already exists. The Graph integration and informational Aqua handoff are implemented.

The initial audience understands LP and deliberately chooses credit funding. The product coordinates borrowing, inventory, realization and deleveraging with inspectable accounts; it does not presume that borrowed LP outperforms unleveraged LP or simply holding ETH.

# Aqua validation and review

The execution module has **26 passing TypeScript tests and 51 passing Solidity tests**, including four Solidity fuzz properties at 256 cases each. Foundry 1.0.0, Solidity 0.8.30, Aqua SDK 0.3.4, SwapVM SDK 0.4.4 and viem 2.38.6 are the tested toolchain. Ordinary CI runs deterministic tests; the official fork script exercises public upstream state separately.

## Independent findings resolved

| Finding                                                                 | Resolution and regression evidence                                                                                                                                                  |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reported amortization exceeded small residual debt                      | Return requested and actual amortization separately; actual cash repayment is capped                                                                                                |
| Interest could hide a third-party debt burn                             | Scaled-debt checkpoint blocks ordinary settlement until authenticated reconciliation                                                                                                |
| Delayed reconciliation overcharged interest on already-repaid principal | Reconstruct using actual aggregate external debt reduction from receipts; current-index counterfactual is only a bound. The timing regression charges 19.009901 rather than 20 USDC |
| Sparse or stale observations passed standalone ranking                  | Require minimum observations, recent window and canonical indexed block/hash binding                                                                                                |
| A debt-free account could reopen LP with principal zero                 | Reject new inventory investment/shipment at zero debt or principal                                                                                                                  |
| A third-party repay permanently terminated the position                 | Owner reconciliation preserves accrued interest and invalidates earlier nonce/snapshot authorization                                                                                |
| Unsettled cost reserves had no lifecycle                                | Nonzero provisions are explicitly rejected in this release; actual wallet gas is reported separately                                                                                |
| Exit could fail with zero remaining collateral                          | Skip withdrawal only for zero verified receipt-token balance; genuine Aave withdrawal errors still revert                                                                           |
| Duplicate actor addresses could inflate consolidation                   | Reject duplicates both at input and when generating reports                                                                                                                         |
| Collateral yield used a pre-withdrawal snapshot                         | Use `Closed.collateralReturned` from the actual withdrawal transaction                                                                                                              |
| Reference price was incorrectly described as final                      | Record its actual post-preparation block and use that same price at both economic endpoints                                                                                         |

Contract review and tests were performed independently from the production implementation. This was a bounded engineering review, not a formal security audit.

## Official execution evidence

Both ETH-collateral and USDC-collateral paths execute against real Aqua, SwapVM, Aave, WETH, USDC, access-NFT and Uniswap contracts on a local Arbitrum fork. The official bytecode is not replaced. Each run tests both swap directions, failed access checks, checkpoint authorization/replay, an external debt repayment, reconciliation, allocation, a subsequent cycle and terminal defense/exit.

Curated runs are indexed under [evidence](evidence/README.md). Every fixture, success and expected revert is included. A complete run ends with zero position debt, no stranded WETH/USDC and zero Aqua allowances.

The default two rounds of related-party swaps can produce a positive **LP surplus after borrowing interest and before wallet-paid gas**, triggering the 50/50 allocation. That is distinct from total user profit. Full-wallet accounting includes gas and collateral yield; the group result also includes the taker's costs. Historical pool fees and internal taker payments never prove external demand.

The parameterized script is an execution proof, not a profitability backtest. Tests separately cover losses, loss recovery, safety/comfortable HF boundaries, donation exclusion, terminal debt, withdrawal failure and malformed requests. The Graph application integration must use actual research outputs and its asymmetric target inventory; it must not substitute the standalone fork's explicit fixture range or 50/50 initial inventory.

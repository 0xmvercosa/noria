# 1inch judge entry point

**Noria's Aqua component coordinates an Aave-backed concentrated-liquidity position.** The owner supplies ETH or USDC collateral, sets two health-factor limits, and uses the resulting USDC loan for a WETH/USDC strategy on Arbitrum. Official Aqua and SwapVM execute the actual token transfers. Realized LP surplus pays interest, recovers prior losses and then supports debt amortization and the next cycle.

The Graph component supplies pool/range research. Source-pool selection, financing, Aqua execution and counterparty availability are separate, inspectable steps.

## Start here

1. [Architecture and financial policy](architecture.md): what the product does, who owns the assets, why a user would use it and where losses arise.
2. [Reproduce the demo](rehearsal.md): run the official contracts on an isolated Arbitrum fork using your public wallet addresses.
3. [Validation and review](validation.md): test counts, findings, fixes and recorded results.
4. [English source code](../../integrations/aqua): contracts, SDK program builder, financing, tests and report generation.
5. [Product integration](integration.md): the implemented collateral → Graph research → Aqua rehearsal round trip, endpoints, examples and Privy configuration.

## Sponsor scope

| Question                                         | Evidence                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is implemented for 1inch?                   | Official SwapVM program generation; real Aqua shipment, bidirectional fills and docking; lifecycle integration with Aave                         |
| Where does liquidity live?                       | Free WETH/USDC stays in `PositionAccount`; Aqua records virtual balances and pulls approved amounts                                              |
| What belongs to Aave?                            | WETH or USDC collateral receipts, USDC variable debt, interest and repayments on that same account                                               |
| What is sophisticated about the position?        | Bounded collateral financing, concentrated liquidity, loss recovery, surplus allocation, health-factor controls and external-flow reconciliation |
| Is the source Uniswap pool the LP destination?   | No. Its research informs a new Aqua position. Uniswap swaps only prepare/realize inventory                                                       |
| Are demo takers independent customers?           | No. Reports consolidate related wallets and do not treat internal fees as outside revenue                                                        |
| Does shipment imply aggregator routing?          | No. The demonstrated route is an eligible taker's official quote/swap; commercial route admission is unverified                                  |
| Are transfers real?                              | Yes, EVM token transfers on a local Arbitrum fork using unchanged official bytecode                                                              |
| Is this a formal audit or production deployment? | No. It is a reviewed implementation with unit/fuzz and local-fork evidence                                                                       |

The repo preserves incremental commits, focused PRs and review findings. It contains no wallet private keys, silently fabricated market fills or single-commit reconstructed history.

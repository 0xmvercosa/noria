# Aqua validation and review

The execution module has **37 passing TypeScript tests and 51 passing Solidity tests**, including four Solidity fuzz properties at 256 cases each. Foundry 1.0.0, Solidity 0.8.30, Aqua SDK 0.3.4, SwapVM SDK 0.4.4 and viem 2.38.6 are the tested toolchain. Ordinary CI runs deterministic tests; the official fork script exercises public upstream state separately.

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

## Final product integration

The integrated execution source is commit `17f1a5c490e196959a8abff5ea01b0a59b28c49c`, including the published Graph/hosted-MCP base `19fe6ae`. Relevant working trees were clean when the three new fork reports were captured. Documentation/evidence commits may follow without changing that execution source.

| Check                                 | Result                                                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Root unit tests                       | 88 passed, including real recorded Graph mapping and job-boundary regressions                                                  |
| Standalone Aqua TypeScript            | 37 passed, including 11 strict downloaded-plan cases                                                                           |
| Solidity                              | 51 passed; four fuzz properties use 256 runs each                                                                              |
| Production browser                    | 23 passed locally with installed Chrome; GitHub also runs bundled Chromium                                                     |
| Production build and runtime assets   | Passed; Graph hosted MCP/agent assets remain traced                                                                            |
| Installation                          | Root npm ci and independent frozen-pnpm CI passed without peer-dependency bypasses                                             |
| Live Graph → position API → local job | ETH and USDC paths completed with 46 journal operations each                                                                   |
| Increased related-taker activity      | 10 bidirectional rounds, 62 operations, positive eligible LP surplus                                                           |
| Local job transport                   | HTTP 202 start, HTTP 409 concurrent rejection, HTTP 200 report with byte-identical HTML                                        |
| Privy                                 | Unconfigured state and execution gating tested; configured real-wallet connection awaits the public App ID and allowed origins |

The integrated report index is [here](evidence/README.md), with a [machine-readable summary](evidence/integration-summary.json). It preserves actual Graph requests/responses, asymmetric targets, canonical source evidence, official transfers, decoded events and final economics. These are current-data executions at their recorded dates, not synthetic Graph fixtures or profitability forecasts.

The normal two-round cases had zero eligible LP surplus and correctly carried the losses forward. The increased-turnover case recorded **0.035625 USDC** eligible LP surplus: **0.017812 USDC** principal amortization and **0.017813 USDC** next-cycle growth. Its consolidated group result was still **−0.113160 USDC**. Related-wallet payments do not establish outside revenue.

Each rehearsal advances the local EVM by 24 hours to exercise actual Aave accrual while retaining fork market state. This is an explicit time-travel fixture, not a market replay, a forecast or a scheduled six-hour review. Plan expiry uses the real wall clock and is rechecked before opening/shipment. Future public operation would need fresh market research for each cycle; these reports do not prove that deployment.

### Final independent review

A separate reviewer inspected the UI, evidence boundary, adapter and local-run lifecycle. All actionable findings were resolved before final evidence capture:

| Finding                                                                    | Resolution                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Downloaded execution fields could diverge from the embedded Graph evidence | Bind range, inventory, fee, source hashes/block, observations and original expiry; producer uses the same validator |
| Fixed fixture balances could be smaller than valid collateral              | Explicitly fund the requested collateral plus fixture operating capital                                             |
| Failed runs hid their partial operation report                             | Preserve and serve any generated report after failure, within the local report directory                            |
| A single timeout signal could leave Forge/Anvil running                    | Private POSIX process group, SIGTERM then bounded SIGKILL escalation; Forge also has a bounded build timeout        |
| A plan could expire during asynchronous verification                       | Recheck wall-clock expiry after verification and before Aave opening and each shipment                              |

The reviewer reported no remaining actionable findings within this scope. The final one-USDC minimum-input message has its own HTTP regression. This remains an engineering review, not a formal audit.

### Dependency and environment limits

Privy is pinned to 3.42.0 with its required Stripe peer. Root overrides patch Axios and wallet-side viem WebSocket dependencies; the standalone pnpm lock also patches ws. The root npm audit still reports 33 advisories (8 low, 24 moderate, 1 high), including the linked Aqua viem 2.38.6 dependency's ws 8.18.3. The Aqua integration explicitly uses HTTP transports and does not expose that Node WebSocket server. This records the residual dependency state; it is not a claim that dependencies are vulnerability-free. No force/legacy-peer-deps install or broad audit-fix was used.

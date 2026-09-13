# Owner-confirmed Aqua launch

The `/aqua` interface turns a reviewed Graph/Aave plan into individually confirmed Arbitrum transactions through the user's Privy embedded wallet. The HTTP API only reads, simulates and verifies. It has no private key, broadcast endpoint or arbitrary-call facility.

## Deployment boundary

Set `NORIA_AQUA_FACTORY_ADDRESS` to the deployed Arbitrum `PositionFactory`, then redeploy the application. Without it, `GET /api/aqua/v1/launch?owner=…` returns `deployment-required`. A fixture or an unverified factory is never substituted.

The factory creates an owner-controlled `PositionAccount` and registers its address. The caller becomes both owner and keeper. Protocol addresses are set once in the constructor, with no factory upgrade/admin functions. A position identifier is unique per owner; creation does not move collateral.

The API checks the exact reviewed factory runtime, the constructor-fixed official protocols, registration and ownership, position configuration, and the inventory adapter runtime including its immutable configuration. Canonical Aave reserve identities and official Aqua/SwapVM code are independently checked. The source of truth is [launch-service.ts](../../src/integrations/aqua/launch-service.ts), not a caller-provided deployment object.

Build with the committed Foundry settings in [foundry.toml](../../integrations/aqua/contracts/foundry.toml). Deploy [UniswapInventoryAdapter](../../integrations/aqua/contracts/src/UniswapInventoryAdapter.sol) first with these constructor parameters:

| Parameter | Arbitrum value                               |
| --------- | -------------------------------------------- |
| `router_` | `0xe592427a0aece92de3edee1f18e0157c05861564` |
| `weth_`   | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` |
| `usdc_`   | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` |
| `fee_`    | `500`                                        |

Then deploy [PositionFactory](../../integrations/aqua/contracts/src/PositionFactory.sol) with its single `Protocols` tuple, in declaration order:

| Field      | Address                                                          |
| ---------- | ---------------------------------------------------------------- |
| `weth`     | `0x82af49447d8a07e3bd95bd0d56f35241523fbab1`                     |
| `usdc`     | `0xaf88d065e77c8cc2239327c5edb3a432268e5831`                     |
| `aWeth`    | `0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8`                     |
| `aUsdc`    | `0x724dc807b04555b71ed48a6896b6f41593b8c637`                     |
| `debtUSDC` | `0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6`                     |
| `aave`     | `0x794a61358d6845594f94dc1db02a252b5b4814ad`                     |
| `aqua`     | `0x1111113ccf1426a8e30e2bff5e005d929bf6a90a`                     |
| `swapVM`   | `0x111111338c5091e8440b67b168bae16a668ac0de`                     |
| `adapter`  | The actual adapter address from the preceding deployment receipt |

Use a wallet-controlled deployment workflow, preserve both deployment receipts and verify source on the explorer. Do not paste private keys into application configuration. The reviewed [factory artifact](../../public/aqua/position-factory-artifact.json) supplies the ABI and expected runtime identity. The public deployment has not been completed merely because artifacts exist or local factory tests pass.

## Transaction sequence

| Stage                        | Wallet-confirmed operation                | Result                                                                                                            |
| ---------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Create                       | Factory `createPosition`                  | Registered account; owner and health policy committed                                                             |
| ETH preparation, when needed | WETH `deposit`                            | Wallet ETH becomes WETH                                                                                           |
| Exact collateral approval    | Token `approve(account, amount)`          | Account may pull only that collateral amount                                                                      |
| Open                         | Account `openPosition`                    | Supplies collateral to Aave, then borrows USDC into the account                                                   |
| Prepare inventory            | Account `swapInventory`                   | Fixed Uniswap route buys the Graph-selected WETH amount; quote checked against target, with a 0.5% slippage bound |
| Launch                       | Account `shipCycle`                       | Official SwapVM order allocated through Aqua; inventory stays in the account                                      |
| Stop                         | Account `defend`                          | Docks active liquidity and repays available USDC                                                                  |
| Sell inventory, if needed    | Account `realizeDefense`                  | Sells residual WETH through a bounded quote and repays debt                                                       |
| Fund a repayment shortfall   | Exact USDC approval, then `repayExternal` | Explicit additional wallet payment; unused cash remains in the account                                            |
| Exit                         | Account `exit`                            | Allowed only after zero debt; returns collateral and remaining inventory to owner                                 |
| Unwrap, when chosen          | WETH `withdraw`                           | Returned wallet WETH becomes ETH                                                                                  |

An interrupted launch can be resumed by loading its registered account. Refreshing research for a funded account keeps its original principal budget and committed collateral/health policy; it does not borrow again. Closing controls require no fresh Graph recommendation. Allowance revocation is available when a preceding approval remains unused.

The initial strategy is a concentrated WETH/USDC Aqua position. The selected Uniswap pool is a research reference, not the LP deposit destination. Actual Aqua fills require eligible takers and the official access-token policy. An active strategy hash is evidence of shipment, not automatic aggregator admission. The separate [routing explanation](integration.md) and fork reports describe this boundary.

## Cycle policy and automation scope

[CycleAccounting.sol](../../integrations/aqua/contracts/src/CycleAccounting.sol) and the account implement the debt/loss-aware 50/50 eligible-surplus policy. Owner provenance checkpoints are required before allocation. The wallet interface implements launch and the stop/repay/exit path; it does not invent profit attestations or run an unattended keeper. A verified token balance increase alone is not cycle profit. Wallet gas is reported separately.

## API and client boundaries

`GET /api/aqua/v1/launch?owner=…&account=…` reads a registered account, or the owner's latest account when `account` is omitted. It returns deployment state, timestamped wallet balances and position collateral, debt, health factor, phase, inventory and allowances.

`POST` accepts a strict discriminated request:

- `{ "operation": "prepare", "request": { … }, "plan": { … } }`: unsigned review. The complete plan is required only for `open`, `convert` and `ship`.
- `{ "operation": "verify", "prepared": { … }, "hash": "0x…" }`: checks exact transaction identity, canonical receipt and expected token/protocol effects. A missing receipt is pending, not a failure authorizing a retry.
- `{ "operation": "plan", "owner": "0x…", "account": "0x…", "intent": { … } }`: refreshes Graph research for an owned account while preserving its existing principal.

Prepared reviews expire after one minute. The browser reconstructs calldata and the official SwapVM program from typed fields, rechecks wallet identity and obtains a fresh simulation before invoking Privy. A worse swap minimum requires a new visible review. The wallet confirmation remains cancellable.

The browser saves intent **before** invoking Privy, and saves the returned hash **before** clearing the intent. Definite EIP-1193 rejection can clear an attempt; ambiguous SDK/RPC failures retain it. Recovery must match the exact receipt or require an explicit user acknowledgment after inspecting wallet activity. Reserve and Aqua share an owner lock and durable pending-operation gate. History is per browser origin; it is not cross-device coordination.

## Reviewer source map

| File                                                                             | What to inspect                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [AquaLaunchWorkbench.tsx](../../src/components/AquaLaunchWorkbench.tsx)          | Staged launch, recovery, balances, close/repay/exit and report                   |
| [NoriaWalletProvider.tsx](../../src/components/NoriaWalletProvider.tsx)          | Explicit embedded-wallet signing and Privy confirmation UI                       |
| [launch-contract.ts](../../src/integrations/aqua/launch-contract.ts)             | Strict schemas, state rules, calldata and official SwapVM order construction     |
| [launch-service.ts](../../src/integrations/aqua/launch-service.ts)               | Deployment identity, canonical reads, executable quotes, simulation and receipts |
| [launch-client.ts](../../src/integrations/aqua/launch-client.ts)                 | Request binding, persistence, uncertainty recovery and statement export          |
| [launch-http.ts](../../src/integrations/aqua/launch-http.ts)                     | Bounded read-only HTTP operations and sanitized failures                         |
| [coordination.ts](../../src/integrations/privy/coordination.ts)                  | Shared wallet lock and unresolved-operation marker                               |
| [PositionFactory.sol](../../integrations/aqua/contracts/src/PositionFactory.sol) | Registration and owner-controlled account creation                               |
| [PositionAccount.sol](../../integrations/aqua/contracts/src/PositionAccount.sol) | Aave financing, official Aqua settlement and debt-gated exit                     |

See [validation](validation.md) for the evidence actually recorded. Live Privy signing, public deployment, local protocol execution and organic taker flow are separate acceptance facts.

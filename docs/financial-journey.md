# Financial journey and interface review

Noria has one wallet and two distinct uses of capital: optional USDC savings owned directly by the wallet, and a leveraged Aqua position owned through a dedicated account. The interface shows where the money is, which debt remains and the next reviewed action.

## User path

| Stage              | User action                                                                  | Financial effect                                                                                |
| ------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Sign in            | Google, email or wallet login; embedded wallet address                       | Authentication only; no deposit or transaction                                                  |
| Fund               | EUR checkout or funding from another wallet; separate ETH funding            | Provider delivery or incoming Arbitrum transfer; balances establish receipt                     |
| Choose             | Aqua position, optional Aave savings, or transfer out                        | Navigation only; savings is not a prerequisite for Aqua                                         |
| Save, optionally   | Exact approval, then a separate deposit confirmation                         | Wallet USDC becomes wallet-owned aUSDC; no borrowing in this route                              |
| Plan               | Collateral, health-factor limits, loan, reference pool/range and inventory   | Read-only Aave and Graph analysis; no funds move                                                |
| Create and open    | Create account, wrap if needed, approve, supply/borrow                       | Position account owns collateral and Aave debt                                                  |
| Prepare and launch | Review inventory quote, then Aqua shipment                                   | Borrowed USDC becomes WETH/USDC inventory, allocated through official Aqua/SwapVM               |
| Monitor            | Inspect debt, health factor, inventory and strategy hash                     | Interest continues; fees require eligible taker fills                                           |
| Close              | Stop, repay using available inventory, fund any shortfall, return collateral | Collateral returns only once debt is zero; optional WETH unwrap follows                         |
| Transfer out       | Review exact USDC/ETH amount, Arbitrum recipient and fee                     | User-confirmed crypto transfer; no bank/EUR off-ramp                                            |
| Inspect            | Balances, receipt history and downloadable statements                        | Read-only verification; approval and provider requests remain distinct from completed transfers |

The selected Uniswap pool is a research reference. Launching does not mint a Uniswap LP NFT. Actual routing/demand and the manual stop/repay path are explained alongside the launch controls.

## Review findings and changes

1. **Savings looked mandatory.** Wallet navigation now offers Aqua, optional savings and transfer as distinct choices. Funding links return to the planner without requiring savings.
2. **The plan lacked a next step.** A passing result links to launch review and summarizes collateral, borrowed USDC, variable interest, inventory custody and possible losses.
3. **Navigation discarded input.** Editable fields survive in session storage. Fresh research is required after return. The USDC handoff query is consumed once so OAuth/reload cannot overwrite later edits with an old amount.
4. **Controls did not reflect the position state.** The next operation and progress checklist follow the lifecycle. Research is restricted to supported phases. A defended position can apply subsequently received USDC to its debt without suggesting a redundant stop on an empty balance.
5. **Repayment could suggest more than the wallet held.** Current debt, interest headroom, available funds and shortfall are distinct. Partial payments are labeled as leaving debt. Zero debt leads directly to collateral return without requiring a WETH sale.
6. **Health labels implied automatic protection.** They now explain liquidation below one, continuing interest and user-confirmed action. No automatic keeper is claimed.
7. **Wallet initialization could spin indefinitely.** After 15 seconds the UI offers a retry without deleting receipts. Privy must also authorize the exact stable origin.
8. **Reloaded receipts required repetitive checks.** Wallet history can check outstanding receipts sequentially without resubmission. Individual checks and ambiguous-request recovery remain available.

## Source map

| Responsibility                                             | Source                                                                                                                       |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Funding, balances, savings, transfers and wallet statement | [ReserveWorkbench](../src/components/ReserveWorkbench.tsx)                                                                   |
| Research, financial explanation and handoff                | [AquaWorkbench](../src/components/AquaWorkbench.tsx)                                                                         |
| Editable-only draft persistence                            | [planner-draft](../src/integrations/aqua/planner-draft.ts)                                                                   |
| Position states and repayment presentation                 | [presentation helper](../src/components/aqua-launch-presentation.ts), [launch UI](../src/components/AquaLaunchWorkbench.tsx) |
| Signing, initialization recovery and login                 | [Privy provider](../src/components/NoriaWalletProvider.tsx)                                                                  |
| OAuth callback and safe return paths                       | [WalletReturn](../src/components/WalletReturn.tsx), [navigation](../src/integrations/privy/navigation.ts)                    |
| Per-request CSP                                            | [middleware](../src/middleware.ts), [CSP](../src/security/csp.ts), [security guide](privy/security.md)                       |

## Acceptance boundaries

A real Privy wallet was observed on the stable domain with 1 USDC, 0.000398882932576 ETH and no Aave savings at Arbitrum block 504711218. This is a dated balance observation, not evidence that Noria performed the incoming transfer or EUR purchase.

Public Aqua deployment, user-confirmed launch and a qualifying Privy transaction require their own receipts and demo. The agent never signs or spends user funds. See [live launch](1inch/live-launch.md) for constructor parameters and deployment checks, and [Privy validation](privy/validation.md) for pending acceptance evidence.

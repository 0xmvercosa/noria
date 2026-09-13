# Privy reviewer guide — Best financial flow

**Noria Reserve lets a user create a wallet, fund it with USDC, supply to Aave and withdraw to the same wallet.** It is the cash-management entry point to Noria's liquidity research. Privy handles login, embedded-wallet creation, funding UI and each transaction confirmation; the user does not need a browser extension or to construct approvals manually.

Open **`/reserve`**. The scope is **Arbitrum One (42161), native USDC and Aave V3**. The existing `/` Graph research and `/aqua` local execution remain separate sponsor entry points.

## Submission status

The source implements the financial flow and a protocol-only local fork check. The public App ID is configured, and the real email/wallet login modal was checked on [the deployed reserve](https://noria-blue.vercel.app/reserve). **Authenticated embedded-wallet creation and a public-chain financial operation have not yet been recorded.** See the [configured startup check](validation.md#configured-startup-check--13-september-2026). A passing build, login modal, wallet connection, approved allowance, mocked wallet or Anvil impersonation is not claimed as a completed Privy financial flow.

| Prize requirement                            | Implementation                                                                                                | Evidence required for submission                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Privy is core to the product                 | Email/wallet login creates an embedded wallet; funding and all public operations use Privy                    | Show the actual wallet creation/login and financial journey                                |
| Create or use at least one Privy wallet      | `createOnLogin: "all-users"`, explicit `useCreateWallet` fallback, `getEmbeddedConnectedWallet`               | Record the wallet address from the configured Privy session                                |
| Functional generally available wallet action | `useSendTransaction`: exact USDC approval, Aave `supply`, Aave `withdraw`, allowance revocation               | A verified supply or withdrawal hash from the Privy wallet; approval alone is insufficient |
| Funding tools simplify the flow              | `useFundWallet` offers supported USDC and ETH funding methods                                                 | Optional funding demonstration; modal dismissal is not settlement                          |
| Working demo and source                      | [Public reserve](https://noria-blue.vercel.app/reserve), this repository, tests and report download           | A recording of the authenticated financial journey is still required                       |
| Explain UX improvement                       | One wallet, native-USDC/network defaults, exact approvals, fee preview, receipt recovery and operation report | Demonstrate this sequence rather than only a connection button                             |
| Commercial/guided features do not count      | No cards, commercial Earn access, sponsored gas or guided onboarding dependency                               | The qualifying operation is an ordinary user-confirmed Ethereum transaction                |

The deposited USDC earns Aave's variable supply interest and becomes aUSDC in the same Privy wallet. This is **a direct Aave integration**, not the separately branded Privy Earn product. Returns, access to onramps and withdrawal liquidity are not guaranteed.

## Demo sequence

1. Configure Privy as described in [setup](setup.md), then open `/reserve` on an allowed origin.
2. Sign in, create/open the embedded wallet, and show its address. External wallets may authenticate or fund it; Noria's transaction signer is explicitly the embedded wallet.
3. Add native USDC and ETH on Arbitrum. The UI defaults the optional funding prompts to 10 USDC and 0.001 ETH; these are prompts, not transfers made automatically. Wait for canonical wallet balances.
4. Enter a small amount you choose, review the exact approval and confirm it in Privy. Show its receipt. If you cancel the deposit afterward, use **Review allowance removal**.
5. Review the deposit and confirm the separate Aave supply transaction in Privy. Require **Onchain effect verified**: the correct USDC transfer and Aave `Supply` event must match the signer, beneficiary and amount.
6. Switch to withdrawal, use the observed supplied balance and confirm. Aave scaled accounting can differ by one raw USDC unit at mint/burn; the interface uses the observed balance rather than assuming deposited principal can be withdrawn exactly.
7. Download the operation report. Show the public explorer transactions and distinguish network fees, supplied balance, earlier balances and interest. A before/after balance difference alone is not earnings.
8. Continue to **Plan an Aqua position**. The chosen amount pre-fills USDC collateral planning. The Graph selects a reference pool/range; the Aqua lifecycle is rehearsed locally with fixture funds. This does not move the live reserve.

If a receipt is pending or an effect cannot be verified, the UI retains the hash and blocks new reserve operations until it is checked. Reloaded history is reverified; locally saved success flags are ignored. Operation history is specific to the browser and wallet, not a complete account indexer.

## Relationship to Aqua

The live reserve is owned by the Privy EOA. The Aqua `PositionAccount` is a different account that must own its own collateral, debt and inventory. Supplying USDC here does not grant it borrowing capacity in that account. A future public migration needs an explicit withdrawal and funding transaction; this release offers only the existing local rehearsal.

The Aqua product policy is unchanged: **USDC collateral → USDC loan → Graph-selected WETH/USDC inventory**, with 50/50 allocation of eligible cycle surplus between debt amortization and next-cycle capital. The reserve page itself does not borrow or impose ETH exposure.

## Source map

| File                                                                                                                               | Responsibility                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`NoriaWalletProvider.tsx`](../../src/components/NoriaWalletProvider.tsx)                                                          | Privy login/creation, embedded-wallet selection, funding and explicitly addressed confirmations |
| [`ReserveWorkbench.tsx`](../../src/components/ReserveWorkbench.tsx)                                                                | Funding, review, supply/withdrawal, recovery, report and Aqua handoff                           |
| [`reserve.ts`](../../src/integrations/privy/reserve.ts)                                                                            | Strict action schema, amount limits, supported deployment and locally reconstructed calldata    |
| [`service.ts`](../../src/integrations/privy/service.ts)                                                                            | Pinned block reads, simulation, exact transaction/event/receipt verification                    |
| [`http.ts`](../../src/integrations/privy/http.ts)                                                                                  | Bounded read-only HTTP API; no broadcast or arbitrary calldata endpoint                         |
| [`client.ts`](../../src/integrations/privy/client.ts)                                                                              | Review binding/expiry, history validation and downloadable reports                              |
| [`validate-privy-reserve.ts`](../../scripts/validate-privy-reserve.ts)                                                             | Official Aave/USDC local fork check, explicitly without Privy signing                           |
| [`privy-reserve.test.ts`](../../tests/unit/privy-reserve.test.ts), [`privy-client.test.ts`](../../tests/unit/privy-client.test.ts) | Financial boundaries, event integrity, failure/reload semantics                                 |
| [`privy.spec.ts`](../../tests/browser/privy.spec.ts)                                                                               | Unconfigured UI, mobile, API rejection and Aqua handoff                                         |

Read the [validation record](validation.md) and [setup/acceptance guide](setup.md). Sponsor criteria were supplied by the project owner; final eligibility remains subject to organizer review.

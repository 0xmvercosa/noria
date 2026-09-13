# Privy integration validation

## What has been validated

- Exact calldata construction for Arbitrum native-USDC approval, supply, withdrawal and revocation. No user-selected beneficiary or arbitrary transaction endpoint.
- Six-decimal amount parsing, per-operation cap, zero-debt policy, reserve availability, sufficient balances, exact allowance and gas headroom.
- Correct receipt inclusion, chain, sender, destination, calldata and value. Successful approval/supply/withdrawal also requires the matching events from the official contracts. Similar-looking events or a successful but unrelated receipt cannot establish a financial effect.
- Request size limits, rejection of extra executable fields, sanitized errors and read-only server behavior.
- Review expiry and request binding. Reloaded history retains hashes and discards untrusted saved success labels. Approval/funding completion is not mislabeled as a qualifying flow.
- Anvil execution of the actual official Aave and USDC contracts, using the same preparation and verification service as the web application. See the [recorded protocol-only evidence](evidence/README.md).

## Recorded checks

Validated from clean source `5fecb04b7521086e91a979555e38e6383bebf619`:

| Check                                                       | Result                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Root unit tests                                             | 123 passed, including 35 Privy policy/client tests                              |
| Existing Aqua TypeScript                                    | 37 passed                                                                       |
| Existing Aqua Solidity                                      | 51 passed, including the existing fuzz properties                               |
| Production browser scenarios                                | 27 passed; unconfigured Privy, mobile and Aqua handoff included                 |
| TypeScript, formatting, production build and runtime assets | Passed                                                                          |
| Official Aave/USDC protocol fork                            | Five operations verified at fork block 504611699; zero final debt and allowance |
| Real Privy session and financial action                     | Pending App ID, allowed origins and a user-confirmed transaction                |

Production build retains optional upstream warnings for the unused Farcaster Solana adapter and viem Tempo dynamic dependency. Noria configures Ethereum wallets and Arbitrum only for this reserve. These warnings do not substitute for the pending configured wallet acceptance test.

## Configured startup check — 13 September 2026

The public App ID was configured in Vercel Production, Preview and Development, and in the ignored local environment. Production was rebuilt without the existing build cache from commit `483592213747218cfa480f2758e4ada5452c6792`. Deployment `FY3nE3SRhEFXuH5NiaHEQMsFc7uo` reached **Ready**, and [the production reserve](https://noria-blue.vercel.app/reserve) enabled **Create or open my Privy wallet** and opened the actual Privy email/wallet login modal. No authenticated session, funded wallet or financial transaction was used for this check. Preview domains and dashboard origin settings were not independently verified.

The configured local build initially remained at **Loading wallet**. Follow-up commit `48f89360d0f632539e81e1ae42cce910bc9ff816` separates login availability from wallet initialization: unauthenticated users wait for Privy authentication readiness; authenticated users still wait for wallet readiness and any in-progress creation. After rebuilding, the local page enabled login and opened the actual modal; deposit review stayed disabled without a wallet. The configured production build and local follow-up build both passed TypeScript/build checks. An independent review found no newly reachable financial action before an authenticated embedded wallet is ready.

These manual startup checks supplement the original automated checks above. They do not establish wallet creation, transaction signing or financial-flow eligibility.

## Protocol-only reproduction

```sh
npm ci
# Put forge/anvil on PATH; the script owns and stops its own local Anvil.
npm run validate:privy-protocol
```

The script forks Arbitrum, verifies the owned local node before mutations, impersonates a labeled fixture wallet, and funds USDC through the official local minter functions. It executes exact approval, 10-USDC supply, withdrawal of the observed aUSDC balance, another approval and revocation. Each operation is verified against the real contracts. It asserts zero debt, zero allowance and token reconciliation allowing at most two raw USDC units for scaled mint/burn rounding. Every fixture and operation is journaled under `.runtime/privy-protocol/`.

This is **not Privy authentication, funding or signing evidence**, and is not a market replay or profitability result. The recorded `privyWalletActionValidated` field stays false. No fork transaction exists on the public explorer. Aave scaled accounting produced 9.999999 aUSDC for a 10-USDC deposit in the development check; the correct withdrawal amount is the observed balance.

## Review findings

An independent test review found that malformed numeric strings could reach `BigInt` in a Zod refinement. Explicit lexical guards now reject decimal/exponent inputs without throwing outside validation. A regression test covers this.

Public signing is intentionally constrained to the recipe and always prompts in Privy. The app rechecks balances/simulation before submitting. A local in-flight guard and required Web Locks coordinate concurrent sends in the same origin. Wallet identity, pending records and fresh stored history are rechecked after acquiring the lock; browsers without Web Locks refuse to submit. Submitted hashes survive a verification failure. Receipt checking updates in-memory evidence without rewriting another tab's stored history. An explicit download-and-clear action permits a new session at the 100-record limit, but only after every record has a terminal verified/reverted receipt. Cross-device activity and changes while a wallet prompt is open remain outside this local coordination.

The review also found an async gap between preparation and signing: a storage event could make another tab's pending hash appear known without preventing the send. The lock-scoped guard and regression tests now cover both delivered and undelivered storage events, account changes and unresolved receipts.

The submission lifecycle also needs to distinguish explicit wallet cancellation from an ambiguous SDK/RPC error after submission. The browser stores an intent before asking Privy to send; an interrupted or uncertain attempt blocks another send until it is reconciled. Recovery must use a matching receipt or an explicit user acknowledgment after inspecting wallet activity; no timeout automatically retries a financial operation.

## Authenticated wallet observation — 13 September 2026

The user connected an actual Privy embedded wallet on the configured Vercel deployment. The reserve displayed the full embedded address and canonical balances at Arbitrum block **504679670**: **0 USDC, 0 ETH and 0 aUSDC**. This establishes use of a Privy wallet in the UI; it does not establish funding, a deposit, a transfer or a signed Aqua transaction. No private key or public financial signature was collected by the implementation agent.

The EUR checkout uses `useFiatOnramp` with the EUR source and exact native-Arbitrum-USDC destination. It is marked experimental in pinned SDK 3.42.0; the required generally available integration remains `useSendTransaction` for a transfer or Aave supply/withdrawal. Provider statuses are recorded separately from chain evidence.

## Evidence still required

The final financial session still needs a verified user-confirmed transaction and recording. Login and an authenticated embedded-wallet connection have been observed. The later balance observation below confirms available funds, but does not establish that Noria initiated their arrival or that a EUR purchase settled. Browser fixtures do not count toward financial-flow eligibility.

The final submission must include at least one verified transfer, supply or withdrawal through the Privy wallet, its report and the demo showing Privy's involvement. No cards, onramp mock or protocol fork is used to fill that gap.

## Extended wallet and launch checks — 13 September 2026

The implementation through `6d81c72` adds EUR request tracking, strict USDC/ETH transfers, current balance observations, exact recipients/fees in reports, the shared pending-operation gate and the owner-confirmed Aqua frontend.

- Root unit tests: **156 passed**, including transfer verification, 15 launch API/policy tests and recovery/persistence failure cases.
- TypeScript, production build, required runtime assets and formatting: **passed**.
- Configured browser run: **26 passed**, with **2 unconfigured-only scenarios skipped** because the build contained a Privy App ID. This local run used installed Chrome; the bundled Chromium download timed out. CI runs the unconfigured build separately.
- The local interface exposed transfer controls and the complete planning/launch handoff. The missing factory API returned `deployment-required`; preparation refused with no fallback deployment.

These checks do not establish payment-provider availability in a particular region, an EUR charge, receipt of USDC, or a public Privy signature. The provider-returned status is recorded as such, independently of wallet balances and verified onchain operations.

## Financial journey and security review — 13 September 2026

The stable judging origin was corrected to `https://noria-blue.vercel.app` in the authorized Privy dashboard session. The wallet initialized and showed **1 USDC**, **0.000398882932576 ETH**, **0 aUSDC** and **1 USDC Aave allowance** at Arbitrum block **504711218**. The agent did not sign the approval, deposit, funding or transfer. Existing allowance and incoming balances are not substitute evidence of an app-executed flow.

The review adds Google/callback configuration, initialization recovery, per-request nonce CSP, preserved planner input, optional savings navigation and position-state guidance. See [financial journey](../financial-journey.md) and [browser security](security.md).

- **173 root unit tests passed**; lifecycle tests include new cash arriving after defense, partial repayment and zero-debt exit.
- **33 configured browser tests passed** with installed Chrome; two tests specifically requiring an unconfigured App ID were skipped. The configured run includes initialization-failure recovery. CI runs the unconfigured scenarios separately.
- TypeScript, production build, formatting and runtime-asset tracing passed.
- Independent source review identified stale query restoration and repayment of newly received position cash. Both were corrected, covered by regressions and re-reviewed with no remaining finding in that scope.
- CSP browser checks use a parser-inserted untrusted script, verify it cannot execute, and confirm normal hydration with a different nonce on every application document. Browser automation's privileged evaluation is not used as evidence of CSP enforcement.

These are application checks. Public Aqua deployment and user-confirmed financial receipts remain separate acceptance work. The EUR hook remains experimental in SDK 3.42.0; ordinary Privy transaction actions remain the generally available qualifying integration.

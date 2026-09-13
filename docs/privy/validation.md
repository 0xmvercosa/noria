# Privy integration validation

## What has been validated

- Exact calldata construction for Arbitrum native-USDC approval, supply, withdrawal and revocation. No user-selected beneficiary or arbitrary transaction endpoint.
- Six-decimal amount parsing, per-operation cap, zero-debt policy, reserve availability, sufficient balances, exact allowance and gas headroom.
- Correct receipt inclusion, chain, sender, destination, calldata and value. Successful approval/supply/withdrawal also requires the matching events from the official contracts. Similar-looking events or a successful but unrelated receipt cannot establish a financial effect.
- Request size limits, rejection of extra executable fields, sanitized errors and read-only server behavior.
- Review expiry and request binding. Reloaded history retains hashes and discards untrusted saved success labels. Approval/funding completion is not mislabeled as a qualifying flow.
- Anvil execution of the actual official Aave and USDC contracts, using the same preparation and verification service as the web application. See the protocol-only evidence once recorded below.

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

## Evidence still required

A real `NEXT_PUBLIC_PRIVY_APP_ID`, configured allowed origins and a user-controlled funded Privy wallet are needed to record the final session. The embedded login/create/fund/sign UI has not been accepted against a real Privy app in this environment. Browser fixtures cover the unconfigured page, mobile layout, API refusal and amount handoff only; they do not emulate a funded wallet or count toward eligibility.

The final submission must include at least one verified supply or withdrawal through the Privy wallet, its report and the demo showing Privy's involvement. No cards, onramp mock or protocol fork is used to fill that gap.

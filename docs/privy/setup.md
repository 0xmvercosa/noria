# Privy setup and real-wallet acceptance

## Application configuration

1. Create or open the Noria application in the [Privy dashboard](https://dashboard.privy.io/).
2. Enable email and/or wallet login and Ethereum embedded wallets. The code requests an embedded wallet for all login users, including those who authenticate with an external wallet.
3. Add the exact local and deployed origins you intend to use, for example `http://127.0.0.1:3100` and the actual HTTPS judging domain. Use your own deployment's URL, not an invented example origin.
4. Set the **public** `NEXT_PUBLIC_PRIVY_APP_ID` in `.env.local` for local builds and the deployment environment for Vercel. Rebuild after changing it: Next.js bundles this value at build time. No Privy app secret, private key or server-wallet authorization key is used.
5. Enable supported funding methods in the dashboard if you want the funding modal. Direct native-USDC/ETH transfers to the displayed wallet also work. Regional/provider requirements and fees can apply.
6. Run `npm ci`, `npm run build`, `npm start`, then open `/reserve`.

The same provider is used on `/aqua` for the public owner address of a local rehearsal. Privy authentication may request a login signature for wallet-based login; that signature is not a reserve transfer or an Aqua transaction.

## Supported SDK path

The repository pins `@privy-io/react-auth` **3.42.0**. It uses established React APIs: `PrivyProvider`, `usePrivy`, `useWallets`, `getEmbeddedConnectedWallet`, `useCreateWallet`, `useFundWallet` and `useSendTransaction`.

In that installed version, the newer `useAddFunds` and `useFiatOnramp` are marked experimental. Noria uses the older `useFundWallet` (deprecated, not experimental), which supports external-wallet funding, MoonPay and Coinbase; it does not expose Stripe. The qualifying integration is `useSendTransaction` executing Aave supply/withdrawal. Funding provider availability is not required to prove that action if the wallet receives an ordinary transfer.

The provider explicitly sets `embeddedWallets.showWalletUIs: true` and each send call also sets `showWalletUIs: true`, `isCancellable: true` and the embedded wallet's `address`. No background signer, delegated authority or gas sponsorship is assumed.

## Financial behavior

- Chain: Arbitrum One, 42161. No testnet or user-selected RPC is accepted by the product API.
- Asset: native USDC, six decimals, `0xaf88d065e77c8cc2239327c5edb3a432268e5831`. USDC.e is not interchangeable.
- Network fees: ETH in the Privy wallet. The review uses an RPC estimate with a 20% buffer; Privy displays the current signing fee. Estimates can change.
- Amount: positive, at most 1,000 USDC per operation. Revocation alone uses zero. No unlimited approvals or maximum-uint withdrawal.
- Beneficiary: the same embedded wallet, hardcoded into locally reconstructed calldata.
- Savings: requires no existing Aave debt. Aave's official simulation also enforces caps, pauses and withdrawal liquidity.
- Approval: exactly the selected deposit amount, consumed by supply. A cancelled/failed supply can leave allowance; explicit revocation remains available even if the account later has debt.
- Transaction preflight: fresh state, exact request, balance/allowance rules, estimated gas, then another simulation before Privy's confirmation. Protocol state can change while the wallet prompt is open; Aave enforces its own rules during execution.
- Browser coordination: a current browser with the Web Locks API is required for sends and history clearing. The app refuses to send when another tab owns the lock or has an unchecked hash.
- History: public addresses, amounts, hashes and reports are stored locally. No access tokens or private keys are stored by this feature. Preserve exported hashes before clearing browser storage. After all receipts have been checked, the explicit download-and-clear action starts a new history session; pending/unverified records cannot be cleared through the app.
- Interrupted submission: a durable intent is saved before the wallet request. A definite user rejection may be retried; ambiguous errors and reloads require recovery. A user-supplied transaction hash must match the original operation. Clearing an uncertain request without a hash requires explicit acknowledgment after inspecting wallet activity and can cause a duplicate if that assertion is wrong.
- Finality: receipt checks verify current Arbitrum sequencer inclusion and the canonical receipt block. They do not claim Ethereum settlement finality.

## Read-only API

`GET /api/privy/v1/reserve?owner=0x…` returns balances, allowance, debt and reserve availability at one block. It uses the server-side `ARBITRUM_RPC_URL` or the configured public default.

`POST /api/privy/v1/reserve` accepts exactly one of:

```json
{
  "operation": "prepare",
  "action": {
    "owner": "0x1111111111111111111111111111111111111111",
    "kind": "supply",
    "amountUnits": "10000000"
  }
}
```

```json
{
  "operation": "verify",
  "action": {
    "owner": "0x1111111111111111111111111111111111111111",
    "kind": "supply",
    "amountUnits": "10000000"
  },
  "hash": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
}
```

These addresses/hashes are schema examples, not evidence. Preparation returns a pinned snapshot, one-minute expiry and gas estimate. It accepts `approve`, `supply`, `withdraw` or `revoke`; it is not an authorization token. The browser reconstructs calldata from the action. Verification checks the exact transaction and canonical token/protocol events; missing receipts return HTTP 202. The API never signs, broadcasts, accepts a recipient, executes an arbitrary call or authenticates Privy wallet authorship from an address alone.

## Required acceptance artifact

Record a real configured session showing wallet creation/use, funding balance, a user-confirmed supply or withdrawal, the receipt and the downloaded report. Record the build commit and judging domain. A transaction receipt alone does not identify the wallet vendor, so the session recording/source path establishes Privy's role.

Do not substitute the protocol-only fork report or automated browser fixtures. Approval, revocation and login alone do not meet this submission's required financial flow. No live transaction has been made by the implementation agent without a configured user wallet and the user's transaction confirmation.

## Official references

- [React quickstart](https://docs.privy.io/basics/get-started/quickstart)
- [Automatic wallet creation](https://docs.privy.io/basics/react/advanced/automatic-wallet-creation)
- [Create a wallet](https://docs.privy.io/wallets/wallets/create/create-a-wallet)
- [Send an Ethereum transaction](https://docs.privy.io/wallets/using-wallets/ethereum/send-a-transaction)
- [Confirmation modals](https://docs.privy.io/recipes/react/manage-wallet-UIs)
- [Network configuration](https://docs.privy.io/basics/react/advanced/configuring-evm-networks)
- [Current funding documentation](https://docs.privy.io/wallets/funding/add-funds)
- [Direct Aave integration recipe](https://docs.privy.io/recipes/yield/aave-guide)

SDK behavior and signatures were checked against the installed 3.42.0 declarations. Current documentation may describe newer APIs; do not migrate to an experimental/guided feature without revisiting the prize requirement and tests.

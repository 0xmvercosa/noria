# Wallet launch backend — official-protocol fork evidence

Both reports use the same strict prepare/verify services as the wallet frontend, with official Arbitrum Aave, Aqua, SwapVM, Uniswap and token contracts. Each case owns an isolated Anvil process. `NORIA_OWNER` selects a public wallet address for **local impersonation only**; fixture balances are explicitly recorded. No Privy signature, fiat purchase, public deployment or public transfer took place in these runs.

| Case | Fork block | Verified owner operations | Final position |
| --- | --- | --- | --- |
| [USDC collateral](usdc.json) | 504693665 | 13 | Closed; zero debt, receipts, WETH and USDC |
| [ETH collateral](eth.json) | 504694522 | 16 | Closed; zero debt, receipts, WETH and USDC; returned WETH unwrapped |

The sequence covers factory creation, exact collateral approval, Aave supply/borrow, inventory conversion, official Aqua shipment, defense, inventory sale, external repayment, collateral exit and allowance removal. ETH adds wrapping/unwrapping and separate repayment-allowance revocation. Both cases also verify USDC and ETH wallet transfers through the reserve backend. Each repayment is submitted after a 30-second local time advance to exercise accrued interest and the explicit 0.1% repayment headroom.

The reports contain labeled fixture actions, deployment constructor parameters, Graph source identities, prepared reviews, exact transaction fields, receipts/events, network fees and timestamped before/after snapshots. All **29** owner operations have `verification.status: "verified"`. They demonstrate launch and exit, not organic trading or profit. Earlier [cycle reports](../README.md) separately exercise related-taker fills and the 50/50 accounting policy.

Reviewed backend: `99ddbb9`. Factory: `02a7304`. Reproduction script: `ed3752f`. Capture date: **13 September 2026**. These commit identifiers describe the implementation used, not a production audit or deployment certificate.

From the repository root, with Foundry on `PATH` and a configured Arbitrum read RPC:

```sh
npm ci
npm run validate:aqua-launch
# Optional: use your public address locally, without a private key.
NORIA_OWNER=0x1111111111111111111111111111111111111111 \
  npm run validate:aqua-launch -- --asset=USDC
```

The example address is a placeholder, not the captured owner. `--asset=ETH` runs the ETH case; omitting the flag runs both. Each fetches fresh Graph evidence and creates a separate fork after that evidence is available. Unavailable data, expired plans or changed Aave capacity are legitimate refusals; the script does not loosen checks to obtain a pass. Reports are written to `.runtime/aqua-launch-validation-usdc.json` and `-eth.json`, independently, including partial failure reports.

Verify the published bytes from this directory:

```sh
shasum -a 256 -c SHA256SUMS
```

Fork transaction hashes do not exist on the public explorer. The wallet UI's actual Privy confirmations and public factory deployment still need their own acceptance recording. See the [launch guide](../../live-launch.md) and [Privy validation](../../../privy/validation.md).

# Recorded protocol validation — 13 September 2026

This is an **isolated Anvil fork**, with no Privy wallet/signature and no public-chain transfer. It validates the official Aave/USDC transaction recipes used by the reserve UI. It does not satisfy the live Privy acceptance requirement.

- Source commit: `5fecb04b7521086e91a979555e38e6383bebf619`; working tree clean.
- Fork block: **504611699**, hash `0xa1d13f279fd16f0b4c15c4a1fc620104d7ad4d815193f4e2d9bb1b3e67f1e899`.
- Started at: `2026-09-13T03:48:26.492Z`.
- Fixture wallet: `0x00000000000000000000000000000000000a11ce`; local impersonation and minter funding are labeled in the report.
- Five operations verified; final debt and allowance are zero.
- [Full report](protocol-arbitrum-2026-09-13.json) contains every fixture, exact transaction calldata, before/after state, receipt logs and fee units.
- [SHA-256 checksum](SHA256SUMS) identifies the raw report bytes.

| Operation | USDC amount | Wallet USDC after | aUSDC after | Execution fee (wei) | Receipt effect |
| --------- | ----------: | ----------------: | ----------: | ------------------: | -------------- |
| approve   |   10.000000 |         10.000000 |    0.000000 |        743289206466 | verified       |
| supply    |   10.000000 |          0.000000 |    9.999999 |       2731759176850 | verified       |
| withdraw  |    9.999999 |          9.999999 |    0.000000 |       2011784918058 | verified       |
| approve   |    1.000000 |          9.999999 |    0.000000 |        497945722467 | verified       |
| revoke    |    0.000000 |          9.999999 |    0.000000 |        263298362418 | verified       |

Aave scaled accounting can round mint/burn quantities by a raw USDC unit. Withdrawal uses the observed aUSDC balance; no principal balance is silently invented. Gas is denominated in ETH and not subtracted from the USDC column. Local Anvil gas is not a prediction of Arbitrum's full data fees. No profitable yield or market replay is claimed.

Reproduce using `npm run validate:privy-protocol` with Anvil on PATH. A later fork can produce different rounding and fees; retain the actual report rather than editing it to match this example.

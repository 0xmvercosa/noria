# ETH dollar equivalents

Noria displays ETH and WETH quantities with an adjacent two-decimal USD estimate, for example `0.001 ETH ($2.50)`. This includes wallet balances, transfer/collateral/unwrap inputs, launch reviews, inventory, fees and operation history. Graph inventory valuations remain tied to their recorded token prices. Raw transaction amounts and downloaded source evidence are unchanged.

The [public ETH reference](../src/app/api/market/eth-usd/route.ts) reuses the existing [price reader](../src/providers/prices.ts): DeFiLlama's `coingecko:ethereum` reference, with the established CoinGecko fallback. Requests are coalesced and cached for up to 60 seconds per server process. No wallet or authentication data is sent to a price provider.

Source timestamps are preserved. Current references receive an aged notice after five minutes and become unavailable after fifteen minutes, including while a page remains open. Missing, invalid or expired prices display **USD unavailable**, never a fabricated zero. A known zero token amount can display `$0.00` without a quote. Decimal arithmetic preserves the full token amount; only the dollar display rounds to cents.

Wallet balances and past transaction fees use the latest available reference, so historical USD equivalents are current revaluations rather than transaction-time costs. The UI explains that distinction. Planner collateral instead uses its recorded Aave oracle price and source block timestamp. Graph-selected WETH inventory uses the exact token's recorded USD reference; no current price is substituted into a historical report.

## Source and validation map

- [EthUsd](../src/components/EthUsd.tsx): shared reference state, expiration, amount/suffix display and source note.
- [Valuation helpers](../src/domain/eth-usd.ts): decimal arithmetic, validation and recorded token references.
- [Reference service](../src/providers/eth-usd.ts): read-only, coalesced quote retrieval.
- [ReserveWorkbench](../src/components/ReserveWorkbench.tsx), [AquaWorkbench](../src/components/AquaWorkbench.tsx), [AquaLaunchWorkbench](../src/components/AquaLaunchWorkbench.tsx): balances, inputs, reviews and receipts.
- [LiveAnalysis](../src/components/LiveAnalysis.tsx): token inventory and full-conversion equivalents at recorded prices.
- [Unit tests](../tests/unit/eth-usd.test.ts): exact arithmetic above JavaScript's safe-integer limit, cent rounding, unavailable/expired references, recorded prices and cache expiry.
- [Browser tests](../tests/browser/eth-usd.spec.ts): exact inputs, narrow layouts, quote failures and expiration without successful refreshes.

The Noria-authored ETH transfer description sent to Privy also includes the estimate. Privy's own internal payment and network-fee screens control their own formatting. This display feature does not change transaction construction, simulation, allowances, debt policy, receipt verification or recovery.

Validation on September 13, 2026: 179 unit tests and 47 configured browser scenarios passed; two unconfigured-Privy scenarios are covered by the separate CI configuration. Production build, type checking, formatting and runtime assets passed. Independent source review reported no actionable findings. Connected-wallet amounts were additionally checked with an isolated synthetic-wallet fixture; this is presentation evidence and does not establish a real transfer or payment.

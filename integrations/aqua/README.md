# Noria Aqua

An independently runnable 1inch Aqua / SwapVM / Aave module for **Arbitrum (42161), WETH and native USDC**. The owner supplies ETH or USDC as Aave collateral, borrows USDC under an explicit health-factor policy and operates concentrated liquidity through official Aqua/SwapVM contracts.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm contracts:test
pnpm example:plan
pnpm fork:rehearse
```

[Judge entry point](../../docs/1inch/README.md) · [Architecture](../../docs/1inch/architecture.md) · [Rehearsal and reports](../../docs/1inch/rehearsal.md)

## Layout

- `src/`: strict discovery/position intent, canonical checks, loan sizing, official SDK programs, integer accounting and financial reports.
- `contracts/src/`: one-owner position account, fixed inventory adapter and accounting library.
- `contracts/test/`: lifecycle, security boundary and fuzz tests with explicitly local mocks.
- `scripts/rehearse.ts`: official-contract fork execution with a complete operation journal.
- `scripts/report.ts`: re-render reports from existing receipts without executing transactions.
- `test/`: TypeScript selection, financing, accounting, encoding and reporting tests.
- `examples/`: explicitly synthetic standalone discovery examples.

The module never broadcasts to the upstream RPC. It starts its own loopback Anvil and can impersonate public wallet addresses locally; no private key is required. Generated runs are ignored by Git. Curated judge evidence is published under `docs/1inch/evidence/` with its source block, commit and integrity hashes.

Source-pool history is not an Aqua yield forecast. A related-party fill is not organic flow. The documented Graph research endpoint and automatic application integration are separate from the standalone fixture demonstration.

# Noria Aqua

An independently runnable **1inch Aqua / Aave** module for Noria, limited to **Arbitrum (42161), WETH and native USDC**. The Graph side discovers and explains source pools and ranges; this module validates proposals, builds official Aqua programs and rehearses capital coordination.

Implementation is in progress on this branch. Do not interpret the presence of a source pool as an instruction to deposit into Uniswap: its data informs a separate Aqua position. A direct, related-party fork fill is not evidence of organic order flow.

## Boundaries

- `src/`: versioned discovery contract, deterministic eligibility/ranking, accounting, official SDK integration and reports.
- `contracts/`: position ownership, Aave liabilities, bounded execution and cycle allocation.
- `scripts/`: dedicated local-fork rehearsal and evidence capture.
- `test/`: integration-contract, selection, accounting and reporting checks.
- `examples/`: explicitly synthetic examples for the other Noria system.
- `docs/1inch/` at repository root: judge entry point and protocol walkthrough.

No private key, mainnet transaction or autonomous real-funds execution is required to run the local rehearsal. Fixture preparation is recorded separately from product operations.


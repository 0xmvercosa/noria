---
name: noria-discovery
description: Use Noria MCP tools to discover Uniswap v3 pools, inspect position ranges and capacity, compare capital or intent, and explain source evidence. Applies when the user wants Noria liquidity research; does not execute wallet, Aave or Aqua actions.
---

# Noria liquidity discovery

Use the configured Noria MCP connection. A hosted deployment exposes Streamable HTTP at `/api/mcp`; a cloned repository provides stdio through `npm --silent run mcp`. If Noria tools are unavailable, point the user to the deployment's `/agent` page. Do not invent a connection or substitute simulated results for live data.

## Choose and inspect

- `noria_networks` lists configured networks, not provider health.
- `noria_search_pools` takes `network` and an optional `query` (up to 100 characters). It searches a bounded universe and preserves exclusions.
- `noria_find_opportunity` takes `network`, `capitalUsd`, `intent`, `horizonHours`, optional `query` and `discountBps`. It tries up to four ranked candidates and can legitimately return `report: null`.
- `noria_analyze_position` uses the same analysis inputs with `poolAddress` instead of `query`. Use the selected address for comparisons so repeated discovery does not silently change the pool.

Supported networks: `ethereum`, `base`, `arbitrum`, `unichain`. Public MCP capital presets: `1000`, `5000`, `10000` USD. Horizons: `6`, `24` hours. Intents: `earn-fees`, `buy-token0`. Optional `discountBps`: integer 25–1,000. If requested inputs are unsupported, explain the available values; do not substitute silently. The separate Aqua HTTP API has its own raw-USDC budget contract.

Treat token contracts and network as identity; symbol or query order does not define token0/token1. `buy-token0` starts with token1 below spot, and conversion can reverse before withdrawal. `earn-fees` assumes the required token inventory is already held; Noria has not inspected the wallet. A range outside spot earns no fees until price enters it.

## Preserve the evidence

Report source provider, chain, pool and token contracts, source block/time, USD reference age and expiry. Separate data checks, construction/capacity and `economics: not-established`. Scores, volume and the 1% capacity policy do not prove profitability or predicted APR. Explain excluded candidates and provider failures without inventing a fallback or weakening checks.

For comparisons, keep the pool fixed and show that calls may observe different market states. Include required inventory, modeled residual and unpriced preparation/exit costs. The horizon is a review interval, not a return prediction.

## Verify and explain

Call `noria_verify_report` with `{ "report": <complete unmodified report> }` after analysis or discovery. Preserve every field and its serialized order; truncated chart history cannot reproduce the digest. HTTP is stateless. Only local stdio also supports `{ "reportId": "..." }` within the session that created the report.

Check `hashMatches`, `budgetConserved`, `expired` and `validUntil` individually. A self-consistent unkeyed hash is not proof of issuer authenticity, current provider data, transaction simulation or economic merit. Anyone can recompute it after edits. Refresh expired data before relying on an analysis.

`noria_historical_case` returns a dated simulation. Keep its period, inventory benchmarks, fees and external costs visible and separate from live opportunities. These tools supply informational analysis only. Wallet connection, collateral choices, Aave health factors and Aqua execution belong to the separate integration.

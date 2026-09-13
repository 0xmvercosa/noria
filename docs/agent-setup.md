# Use Noria with an AI agent

Your MCP client supplies the language model. Noria supplies six deterministic, read-only tools, and The Graph Subgraph MCP supplies live indexed data. The Noria server does not require a model API key and cannot sign or submit transactions.

The external Aqua application uses the separate [versioned HTTP reference API](aqua-integration.md). Its raw-USDC budgets and exact-pair scope do not change the six MCP tools or their documented inputs below.

## Connect the server

Install dependencies with `npm ci`. Configure your MCP client to launch:

| Setting           | Value                      |
| ----------------- | -------------------------- |
| Transport         | stdio                      |
| Command           | `npm`                      |
| Arguments         | `--silent`, `run`, `mcp`   |
| Working directory | The cloned repository root |

The client must launch from that working directory; use its working-directory setting or launcher mechanism. The npm script loads optional `.env.local` and starts `src/mcp/server.ts`. `--silent` keeps npm's banner out of the JSON-RPC stream.

The default Graph route needs no API key. Copy `.env.example` to `.env.local` only if you want to configure `GRAPH_API_KEY` or `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` and `UNICHAIN_RPC_URL`. The key selects The Graph gateway; RPC overrides belong to the server environment.

## Tools and inputs

| Tool                     | Inputs                                   | Result and boundary                                                      |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| `noria_networks`         | `{}`                                     | Configured networks; not a live provider-health check                    |
| `noria_search_pools`     | `network`, optional `query`              | Bounded candidate search with reasons and exclusions                     |
| `noria_find_opportunity` | Shared analysis fields, optional `query` | First passing result among up to four ranked attempts, or `report: null` |
| `noria_analyze_position` | Shared analysis fields and `poolAddress` | Explicit-pool report; capacity or freshness can prevent a review plan    |
| `noria_historical_case`  | `{}`                                     | Dated simulation with accounting bases; no current-market conclusion     |
| `noria_verify_report`    | `reportId`                               | Same-session hash, budget conservation and expiry check                  |

Shared analysis fields:

| Field          | Accepted values                                      |
| -------------- | ---------------------------------------------------- |
| `network`      | `ethereum`, `base`, `arbitrum`, `unichain`           |
| `capitalUsd`   | `1000`, `5000`, `10000`                              |
| `intent`       | `earn-fees`, `buy-token0`                            |
| `horizonHours` | `6`, `24`                                            |
| `discountBps`  | Optional integer 25–1,000; conversion default is 100 |

Discovery/search queries can name a token, pair or pool contract and are limited to 100 characters. Explicit analysis requires a 20-byte hex pool address. Schemas reject unsupported amounts and extra fields; do not silently substitute inputs.

## Example prompt

> Use Noria to list the configured networks, then find a Uniswap v3 pool on Base for $1,000 of fee exposure with a six-hour review. Start without a preferred pool. Show the actual selection reasons, search limits, token contracts, required inventory and source age. Verify the report if one is returned. Then analyze the same pool for $5,000 and compare capacity. Keep data validity, construction and economics separate. If a call refuses the analysis, explain the recorded reasons.

For a capital comparison, reuse the selected pool address with `noria_analyze_position`. Repeating discovery may select a different pool. Live calls can also observe different source states, so the comparison is not a controlled fixed-snapshot experiment.

For planned conversion, explain that `buy-token0` uses the pool's token1 to acquire token0 below spot. The token order is contractual, not the word order of the user's query. The displayed full-conversion quantity is a boundary calculation; conversion can reverse while liquidity remains.

## Interpretation rules

- Preserve the network, contract addresses, source timestamps, provider names and expiry in the explanation. A configured network is not a promise that its sources currently pass.
- Treat `report: null` and `incomplete-history` as legitimate outcomes. Preserve exclusions; do not fill missing data or invent a selected pool.
- Describe the 1% capacity threshold as a research policy. Keep `economics: not-established` visible; do not translate candidate scores or pool volume into APR, predicted fees or profitable fills.
- State the inventory assumption and unpriced costs. No wallet has been inspected, and an `earn-fees` range can be outside spot.
- Use `noria_verify_report` in the session that created the report. It checks internal integrity and expiry, not new provider data, transaction simulation or profitability.
- Keep historical simulation results dated and separate from live opportunities. Aave/Aqua actions are entirely planned and unavailable through these tools.

## Exercise the protocol without a model

```sh
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts list
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts noria_search_pools '{"network":"arbitrum","query":"WETH USDC"}'
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts noria_find_opportunity '{"network":"base","capitalUsd":1000,"intent":"earn-fees","horizonHours":6}'
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts noria_historical_case '{}'
```

The helper starts a server session, calls the requested tool and verifies a returned report in that same session. It then exits. This is a transport demonstration, not an AI agent. Compact CLI output can omit chart points, so it may not reproduce the full report hash from the printed JSON alone.

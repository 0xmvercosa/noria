# Noria

![Noria logo](public/brand/noria-lockup.svg)

**Discover liquidity. Coordinate capital.**

Noria gives people and AI agents a reviewable Uniswap v3 liquidity plan from live market data. Choose a network, capital and objective; inspect the suggested pool, range, required inventory, source evidence and capacity—or the reasons no candidate qualifies.

Noria targets **ETHOnline 2026 · The Graph · Best AI Tooling or AI Use Case with The Graph (From Scratch)** and **1inch · Build an Aqua App**. The two sponsor entry points are `/` and `/aqua`, with separate evidence guides. The Graph supplies indexed pool discovery and price history through its Subgraph MCP. Canonical RPC reads and independent USD references support verification. The language model belongs to the external AI client; Noria provides six reusable, deterministic MCP tools.

| Capability                                                         | Status                                                                        |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Live Uniswap v3 discovery on Ethereum, Base, Arbitrum and Unichain | Implemented; each request still depends on available, valid sources           |
| Fee-exposure ranges and planned token1 → token0 conversion         | Implemented as informational calculations                                     |
| Web interface, source evidence, downloads and six MCP tools        | Implemented                                                                   |
| Arbitrum WETH/native-USDC product                                  | Real Aave financing → Graph selection → Aqua plan and local rehearsal         |
| Dated historical simulation for accounting comparison              | Included as an example; never used as a live fallback                         |
| Privy external-wallet connection                                   | Implemented; requires a public App ID and allowed origins; no signing         |
| Aave ETH/USDC collateral, USDC borrowing and official Aqua/SwapVM  | Implemented and demonstrated on isolated Arbitrum forks                       |
| Cycle accounting, debt repayment and next-cycle capital            | Implemented with owner provenance checkpoints; wallet gas reported separately |

## For hackathon reviewers

1. Start the application and open `/` for the full The Graph demonstration. No wallet is needed.
2. Use the [agent setup](docs/agent-setup.md) to connect the six MCP tools to an external AI client.
3. Inspect the [The Graph integration](docs/the-graph.md), [methodology and architecture](docs/architecture.md), and [validation evidence](docs/validation.md).
4. Open `/aqua` and the [1inch judge guide](docs/1inch/README.md) for collateral financing, real Graph pool/range selection, official Aqua/SwapVM execution and operation reports.

The Graph discovery remains informational. The Aqua module separately proves capital-moving behavior on local forks. Public-chain deployment, real Privy connection on a configured deployment and aggregator route admission are distinct acceptance checks; local related-party fills do not establish customer demand or profit.

## Run locally

Use **Node.js 22.9 or later**; Node.js 22 LTS is recommended.

```sh
git clone https://github.com/0xmvercosa/noria.git
cd noria
npm ci
npm run dev
```

Open [http://127.0.0.1:3100](http://127.0.0.1:3100). The default data route uses The Graph Subgraph MCP without a Graph API key. To configure an optional gateway key or network RPC overrides, copy `.env.example` to `.env.local` and edit the values locally.

For a production build:

```sh
npm run build
npm start
```

The same deployment serves `/` and `/aqua`. See [deployment](docs/deployment.md) for the judging domain, server-side settings and a signed-out access check.

## Try the discovery flow

Start with Base, **$1,000**, **Earn fees** and a **6-hour review**, leaving the pool preference blank. Noria screens a bounded live pool universe, attempts full analysis of up to four ranked candidates and shows the first passing result. An empty result retains the exclusions; it does not establish that no suitable pool exists on the network.

Supported capital amounts are **$1,000 / $5,000 / $10,000**, with **6 / 24-hour** review intervals. Planned conversion uses token1 to acquire token0 below spot, at **25–1,000 bps** discount targets. Token order comes from the actual pool. Review intervals are prompts for later review, not fee forecasts or scheduled execution.

Every report separates:

- **Data:** source identities, timestamps, canonical state checks and expiry.
- **Construction:** modeled liquidity share within a **1% per-range-segment policy**. This is a research constraint, not a protocol limit.
- **Economics:** `not-established`. A passing range does not establish profitable fees, fills or net returns.

The required inventory is assumed already held. Fee-exposure ranges can be outside spot and earn no swap fees until price enters them. Planned conversion can reverse while liquidity remains. Gas is an estimate outside the modeled inventory budget; preparation/exit swaps and L2 data fees are unpriced.

## Use an AI agent

Open `/agent` on the deployed site and connect a Streamable HTTP MCP client to its `/api/mcp` URL. The page includes a copyable endpoint, example prompt and downloadable skill. Local clients can use `npm --silent run mcp` from the repository root. No model API key is required by Noria. See [agent setup](docs/agent-setup.md) for configuration and accepted inputs. Hosted report verification accepts the complete report, so it works across serverless instances.

| MCP tool                 | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `noria_networks`         | List configured networks                                     |
| `noria_search_pools`     | Inspect the bounded pool search and exclusions               |
| `noria_find_opportunity` | Discover and analyze candidates, or return no recommendation |
| `noria_analyze_position` | Analyze a specified network and pool                         |
| `noria_historical_case`  | Read the dated explanatory simulation                        |
| `noria_verify_report`    | Check a complete report's hash, budget and expiry            |

You can inspect the tools without an AI client:

```sh
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts list
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts noria_find_opportunity '{"network":"base","capitalUsd":1000,"intent":"earn-fees","horizonHours":6}'
```

The CLI is a transport client, with no LLM. Report verification checks internal consistency; it does not refresh market data or establish execution safety.

## Inspect the Graph research contract

The Aqua backend initiates the flow through `POST /api/aqua/v1/recommendation`. It sends a native-USDC budget, an objective and a review interval. Noria selects an exact Arbitrum WETH/USDC reference pool and returns an aligned price range, raw inventory amounts, source evidence, expiry and refusal reasons. The full multi-network interface remains available at `/`.

```sh
curl --request POST http://127.0.0.1:3100/api/aqua/v1/recommendation \
  --header 'Content-Type: application/json' \
  --data-binary @examples/aqua/request.json
```

This endpoint accepts 1–100,000 USDC, including fractional amounts, using integer raw units. The regular web/MCP discovery presets remain $1,000 / $5,000 / $10,000. See the [integration guide](docs/aqua-integration.md), [OpenAPI specification](public/aqua/openapi.json), [typed client](examples/aqua/client.ts) and [dated live response](examples/aqua/response.recorded.json).

This research endpoint retains `executionReady: false`. The implemented Aqua product consumes it through the separate position-planning endpoint below; research itself never authorizes a transaction.

## Run the Aqua product

In `/aqua`, enter **ETH or USDC collateral**, a safety HF and a comfortable HF. The position endpoint reads Aave, sends the sized loan budget to the real Graph service and preserves its selected pool, range and asymmetric inventory. The USDC path deposits USDC as collateral before borrowing USDC. The 50/50 rule applies to eligible cycle surplus, not opening inventory.

```sh
curl --request POST http://127.0.0.1:3100/api/aqua/v1/position \
  --header 'Content-Type: application/json' \
  --data-binary @examples/aqua/position-request.usdc.json
```

Set `NEXT_PUBLIC_PRIVY_APP_ID` before building and configure allowed origins in Privy. Connecting supplies an external wallet address; no signature or public-chain transaction is requested. With Foundry on `PATH`, enable `NORIA_ENABLE_LOCAL_FORK=1` on a loopback server to run the downloaded plan with local wallet impersonation and a complete operation report. Public deployments expose planning; the local runner is disabled on Vercel.

Read the [product and integration specification](docs/1inch/integration.md), [rehearsal guide](docs/1inch/rehearsal.md), [OpenAPI](public/aqua/position-openapi.json), [financial policy](docs/1inch/architecture.md) and [recorded execution evidence](docs/1inch/evidence/README.md). Root `npm ci` installs the integrated app. Standalone pnpm installation belongs in a separate checkout.

## Technology

| Layer                | Tools                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| Web                  | Next.js 15, React 19, TypeScript, CSS modules and SVG                                                  |
| Indexed market data  | The Graph Subgraph MCP; optional Graph gateway                                                         |
| Independent checks   | viem RPC reads, DeFiLlama prices, exact-contract CoinGecko fallback                                    |
| Position math        | Uniswap v3 SDK, SDK Core, Decimal.js and integer quantities                                            |
| Contracts and agents | Solidity 0.8.30, official Aqua/SwapVM SDKs, Aave, Foundry, Zod, HTTP and read-only MCP over HTTP/stdio |
| Wallet connection    | Privy external wallets, Arbitrum only in Aqua, no public transaction UI                                |
| Verification         | Node test runner with tsx, Playwright, TypeScript, Prettier and GitHub Actions                         |

## Why The Graph matters

The Graph provides the searchable pool universe, hourly observations for range selection and initialized ticks for capacity analysis. Noria adds independent valuation, transparent screening, canonical verification, range/inventory math and structured refusal reasons. If indexed ticks fail validation, a bounded canonical RPC bitmap window can recover the required tick coverage; missing Graph history still prevents analysis.

The [integration guide](docs/the-graph.md) maps sponsor data to product behavior. The [architecture](docs/architecture.md) explains the source boundaries, algorithms and report limits.

## Verify and explore

```sh
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

See [validation](docs/validation.md) for fixture scope, recorded results and optional live checks. Browser tests use Playwright's bundled Chromium; they do not establish live provider availability.

The Graph evidence includes a **420-configuration recorded Arbitrum matrix** and dated live reference HTTP checks. The [Aqua validation guide](docs/1inch/validation.md) separately records unit/fuzz tests, integration checks and actual local-fork execution. GitHub Actions builds the application. Dependency installation requires no funded wallet or model API key.

| Start here                                                                              | What it contains                                                        |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [Discovery service](src/services/discovery.ts)                                          | Candidate universe, screening, ranking and analysis attempts            |
| [Analysis service](src/services/analysis.ts)                                            | Snapshot reuse and analysis orchestration                               |
| [Snapshot provider](src/providers/snapshot.ts) / [report builder](src/domain/report.ts) | Canonical verification, ranges, capacity and reports                    |
| [Graph provider](src/providers/graph.ts)                                                | Subgraph MCP and optional gateway transport                             |
| [Domain](src/domain)                                                                    | Types, Uniswap math, tick validation and price policy                   |
| [Web interface](src/components/NoriaApp.tsx) / [MCP server](src/mcp/server.ts)          | Human and agent entry points                                            |
| [Roadmap](docs/roadmap.md)                                                              | Current implementation, remaining deployment work and accounting limits |
| [Aqua API](src/integrations/aqua) / [integration guide](docs/aqua-integration.md)       | Exact-pair selection, request/response contract and execution boundary  |
| [Hackathon guide](docs/hackathon.md)                                                    | Track fit, demo sequence and submission status                          |

The [Aqua execution module](integrations/aqua) maps the economic range to official SwapVM and independently checks execution. [MIT licensed](LICENSE).

Deployment is configured for Vercel in [`vercel.json`](vercel.json); follow the [deployment checklist](docs/deployment.md). The [Graph-to-Aqua handoff](docs/graph-integration-handoff.md) records the stable APIs and ownership used by the implemented financing/wallet integration.

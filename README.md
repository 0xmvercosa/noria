# Noria

![Noria logo](public/brand/noria-lockup.svg)

**Discover liquidity. Coordinate capital.**

Noria gives people and AI agents a reviewable Uniswap v3 liquidity plan from live market data. Choose a network, capital and objective; inspect the suggested pool, range, required inventory, source evidence and capacity—or the reasons no candidate qualifies.

The current release targets **ETHOnline 2026 · The Graph · Best AI Tooling or AI Use Case with The Graph (From Scratch)**. The Graph supplies indexed pool discovery and price history through its Subgraph MCP. Canonical RPC reads and independent USD references support verification. The language model belongs to the external AI client; Noria provides six reusable, deterministic MCP tools.

| Capability                                                         | Status                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Live Uniswap v3 discovery on Ethereum, Base, Arbitrum and Unichain | Implemented; each request still depends on available, valid sources |
| Fee-exposure ranges and planned token1 → token0 conversion         | Implemented as informational calculations                           |
| Web interface, source evidence, downloads and six MCP tools        | Implemented                                                         |
| Arbitrum WETH/native-USDC reference API and focused Aqua preview   | Implemented; inventory guidance only, with no Aqua execution        |
| Dated historical simulation for accounting comparison              | Included as an example; never used as a live fallback               |
| Wallet connection, transaction preparation, signing and execution  | Not implemented                                                     |
| Aave ETH collateral, USDC borrowing and 1inch Aqua liquidity       | Planned for a separate 1inch track module; not implemented          |
| Realized-surplus reinvestment and debt repayment                   | Planned; no autonomous capital management exists                    |

## For hackathon reviewers

1. Start the application and open `/` for the full The Graph demonstration. No wallet is needed.
2. Use the [agent setup](docs/agent-setup.md) to connect the six MCP tools to an external AI client.
3. Inspect the [The Graph integration](docs/the-graph.md), [methodology and architecture](docs/architecture.md), and [validation evidence](docs/validation.md).
4. Open `/aqua` for the Arbitrum WETH/native-USDC slice. The [Aqua handoff contract](docs/aqua-integration.md) connects discovery to the future execution product.

The current milestone is for **The Graph track**. The combined product also targets **the 1inch track**, whose Aqua execution, Aave borrowing and realized-surplus accounting are still to be developed. A passing Noria reference is not evidence that those execution features work.

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

Connect an MCP client with the repository root as its working directory and the command `npm --silent run mcp`. No model API key is required by Noria. See [agent setup](docs/agent-setup.md) for configuration, accepted inputs and an example prompt.

| MCP tool                 | Purpose                                                      |
| ------------------------ | ------------------------------------------------------------ |
| `noria_networks`         | List configured networks                                     |
| `noria_search_pools`     | Inspect the bounded pool search and exclusions               |
| `noria_find_opportunity` | Discover and analyze candidates, or return no recommendation |
| `noria_analyze_position` | Analyze a specified network and pool                         |
| `noria_historical_case`  | Read the dated explanatory simulation                        |
| `noria_verify_report`    | Check a same-session report's hash, budget and expiry        |

You can inspect the tools without an AI client:

```sh
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts list
node --env-file-if-exists=.env.local --import tsx scripts/call-tool.ts noria_find_opportunity '{"network":"base","capitalUsd":1000,"intent":"earn-fees","horizonHours":6}'
```

The CLI is a transport client, with no LLM. Report verification checks internal consistency; it does not refresh market data or establish execution safety.

## Connect the Aqua product

The Aqua backend initiates the flow through `POST /api/aqua/v1/recommendation`. It sends a native-USDC budget, an objective and a review interval. Noria selects an exact Arbitrum WETH/USDC reference pool and returns an aligned price range, raw inventory amounts, source evidence, expiry and refusal reasons. The full multi-network interface remains available at `/`.

```sh
curl --request POST http://127.0.0.1:3100/api/aqua/v1/recommendation \
  --header 'Content-Type: application/json' \
  --data-binary @examples/aqua/request.json
```

This endpoint accepts 1–100,000 USDC, including fractional amounts, using integer raw units. The regular web/MCP discovery presets remain $1,000 / $5,000 / $10,000. See the [integration guide](docs/aqua-integration.md), [OpenAPI specification](public/aqua/openapi.json), [typed client](examples/aqua/client.ts) and [dated live response](examples/aqua/response.recorded.json).

The caller must map the economic range to a supported Aqua strategy, quote preparation and exit costs, assess Aave health and obtain authorization. The response always retains `executionReady: false`; no Aqua transaction is generated.

## Technology

| Layer                | Tools                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| Web                  | Next.js 15, React 19, TypeScript, CSS modules and SVG                          |
| Indexed market data  | The Graph Subgraph MCP; optional Graph gateway                                 |
| Independent checks   | viem RPC reads, DeFiLlama prices, exact-contract CoinGecko fallback            |
| Position math        | Uniswap v3 SDK, SDK Core, Decimal.js and integer quantities                    |
| Contracts and agents | Zod validation, versioned HTTP contract, read-only MCP stdio tools             |
| Verification         | Node test runner with tsx, Playwright, TypeScript, Prettier and GitHub Actions |

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

The published checks include **70 unit tests**, **16 browser scenarios**, a **420-configuration recorded Arbitrum matrix**, and four dated live Aqua-reference HTTP checks. Live checks tested information retrieval and construction only. GitHub Actions also builds the production application. Dependency installation requires no funded wallet or model API key.

| Start here                                                                              | What it contains                                                       |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Discovery service](src/services/discovery.ts)                                          | Candidate universe, screening, ranking and analysis attempts           |
| [Analysis service](src/services/analysis.ts)                                            | Snapshot reuse and analysis orchestration                              |
| [Snapshot provider](src/providers/snapshot.ts) / [report builder](src/domain/report.ts) | Canonical verification, ranges, capacity and reports                   |
| [Graph provider](src/providers/graph.ts)                                                | Subgraph MCP and optional gateway transport                            |
| [Domain](src/domain)                                                                    | Types, Uniswap math, tick validation and price policy                  |
| [Web interface](src/components/NoriaApp.tsx) / [MCP server](src/mcp/server.ts)          | Human and agent entry points                                           |
| [Roadmap](docs/roadmap.md)                                                              | Planned Aave/Aqua module and its accounting rules                      |
| [Aqua API](src/integrations/aqua) / [integration guide](docs/aqua-integration.md)       | Exact-pair selection, request/response contract and execution boundary |
| [Hackathon guide](docs/hackathon.md)                                                    | Track fit, demo sequence and submission status                         |

The Aave/Aqua module needs its own execution adapter: a Uniswap v3 range is not directly executable on Aqua. [MIT licensed](LICENSE).

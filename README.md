# Noria

![Noria logo](public/brand/noria-lockup.svg)

**Discover liquidity. Coordinate capital.**

Noria connects a Privy wallet, The Graph's market research and an owner-controlled Aqua liquidity position. The intended journey is **fund in euros → hold USDC → review a pool and range → supply collateral to Aave → borrow USDC → provide WETH/USDC liquidity through Aqua/SwapVM → repay debt and reinvest eligible surplus → close and withdraw**. Each capital-moving step requires a wallet confirmation. A separate Aave savings route lets users earn variable supply interest without opening the leveraged Aqua position.

People and AI agents can also use the research on its own: choose a network, capital and objective, then inspect the suggested pool, range, inventory, source evidence and capacity—or the reasons no candidate qualifies.

Noria targets **ETHOnline 2026 · The Graph · Best AI Tooling or AI Use Case with The Graph (From Scratch)**, **1inch · Build an Aqua App** and **Privy · Best financial flow**. Sponsor entry points are `/`, `/aqua` and `/reserve`, with separate evidence guides. The Graph supplies indexed pool discovery and price history through its Subgraph MCP. Canonical RPC reads and independent USD references support verification. The language model belongs to the external AI client; Noria provides six reusable, deterministic MCP tools.

| Capability                                                         | Status                                                                                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Live Uniswap v3 discovery on Ethereum, Base, Arbitrum and Unichain | Implemented; each request still depends on available, valid sources                                                             |
| Fee-exposure ranges and planned token1 → token0 conversion         | Implemented as informational calculations                                                                                       |
| Web interface, source evidence, downloads and six MCP tools        | Implemented                                                                                                                     |
| Arbitrum WETH/native-USDC product                                  | Aave financing → Graph selection → reviewed wallet launch, plus local rehearsal                                                 |
| Dated historical simulation for accounting comparison              | Included as an example; never used as a live fallback                                                                           |
| Privy wallet, EUR onramp and USDC reserve                          | Embedded wallet, EUR checkout, USDC/ETH transfers, Aave savings and statements implemented; public financial acceptance pending |
| Aave ETH/USDC collateral, USDC borrowing and official Aqua/SwapVM  | Implemented and demonstrated on isolated Arbitrum forks                                                                         |
| Cycle accounting, debt repayment and next-cycle capital            | Implemented with owner provenance checkpoints; wallet gas reported separately                                                   |

## For hackathon reviewers

This is one product with three independently inspectable integrations. Use the same README, then follow the row for your track:

| Track                                          | Product entry point and contribution                                                                                                                                                  | Start in the code                                                                                                                                                                                                                                                                                                                                                                    | Guide and evidence                                                                                                                                                                                    |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The Graph — Best AI Tooling or AI Use Case** | [`/`](https://noria-blue.vercel.app/) and [`/agent`](https://noria-blue.vercel.app/agent): indexed pool discovery, history and ticks; six deterministic tools for external AI clients | [Graph transport](src/providers/graph.ts), [discovery](src/services/discovery.ts), [analysis](src/services/analysis.ts), [MCP tools](src/mcp/server.ts)                                                                                                                                                                                                                              | [Graph guide](docs/the-graph.md), [agent setup](docs/agent-setup.md), [validation](docs/validation.md)                                                                                                |
| **1inch — Build an Aqua App**                  | [`/aqua`](https://noria-blue.vercel.app/aqua): Arbitrum WETH/native-USDC position financed through Aave and executed through official Aqua/SwapVM                                     | [Launch UI](src/components/AquaLaunchWorkbench.tsx), [launch service](src/integrations/aqua/launch-service.ts), [position planning](src/integrations/aqua/position-service.ts), [position account](integrations/aqua/contracts/src/PositionAccount.sol), [factory](integrations/aqua/contracts/src/PositionFactory.sol), [official order builder](integrations/aqua/src/official.ts) | [1inch guide](docs/1inch/README.md), [wallet launch/deployment](docs/1inch/live-launch.md), [financial policy](docs/1inch/architecture.md), [fork transaction reports](docs/1inch/evidence/README.md) |
| **Privy — Best financial flow**                | [`/reserve`](https://noria-blue.vercel.app/reserve): embedded wallet, EUR funding, balances, Aave savings, transfers and statements; the same wallet confirms the Aqua lifecycle      | [Privy provider](src/components/NoriaWalletProvider.tsx), [wallet interface](src/components/ReserveWorkbench.tsx), [EUR configuration](src/integrations/privy/fiat.ts), [transaction verification](src/integrations/privy/service.ts)                                                                                                                                                | [Privy guide](docs/privy/README.md), [setup](docs/privy/setup.md), [validation](docs/privy/validation.md)                                                                                             |

**Acceptance status:** The Graph discovery is implemented, and the Aqua lifecycle has onchain execution evidence from isolated Arbitrum forks. A real Privy embedded wallet connection has been observed. The EUR/transfer interface and public Aqua launch are implemented in source; public factory deployment and a user-confirmed public financial transaction remain pending. A connected wallet, an approval, a provider checkout or a fork impersonation does not prove the required Privy financial flow. Shipment to Aqua does not establish aggregator admission or organic taker demand.

## The complete financial journey

1. **Create and fund the wallet — Privy.** Sign in by email or wallet and open the embedded Ethereum wallet. On `/reserve`, choose **Buy USDC with euros** to request a provider quote in EUR for native USDC on Arbitrum. The provider handles available payment methods, eligibility, exchange rate and fees. Alternatively, fund from another wallet. Keep ETH in the wallet for network fees. Noria reads actual balances from Arbitrum; closing the checkout is not proof of payment or delivery.
2. **Choose savings or an Aqua position.** Direct savings supplies wallet USDC to Aave and returns aUSDC to that wallet. Aqua uses a separate `PositionAccount` that must own its collateral, debt and inventory. A reserve deposit is not automatically available as Aqua collateral: withdraw it to the wallet first, then explicitly fund the position. The handoff button pre-fills a planning amount and does not move money.
3. **Plan the position — Aave + The Graph.** Start at `/aqua` with ETH or USDC collateral and health-factor limits. Noria reads Aave financing parameters, sizes a USDC loan and asks The Graph service for an Arbitrum WETH/USDC reference pool, aligned range and required inventory. **USDC entry means supply USDC as collateral and borrow USDC for liquidity.** ETH entry wraps ETH to WETH before collateral supply. Refused candidates remain visible; research never authorizes a transaction.
4. **Review and launch — Privy + 1inch.** Against a configured, verified public factory, the owner creates a position account, approves the exact collateral amount, supplies and borrows through Aave, converts the required inventory and ships the official SwapVM strategy through Aqua. These are separate reviewed wallet operations. The frontend must show deployment-required until that factory exists; no demo address or fixture replaces it.
5. **Provide liquidity — official Aqua/SwapVM.** Assets remain in the position account under the owner's controls, with liquidity allocated through Aqua. A taker executes the published SwapVM order and token transfers settle through the official contracts. The Graph pool is the research reference: launching does **not** mint a Uniswap LP NFT or deposit the inventory into that pool. A separate Uniswap adapter prepares or sells inventory. Routing/admission and actual taker flow are separate from strategy creation.
6. **Account, repay and reinvest.** After a cycle is closed and inventory provenance is confirmed, the contract applies its debt/loss-aware accounting policy. Eligible surplus is split **50% to USDC debt repayment and 50% to next-cycle capital**. This is not 50% of principal, turnover, gross fees or a token balance increase. Losses, borrowing interest and health limits affect what can be allocated; wallet gas is reported separately. This version uses explicit owner checkpoints, not unattended execution.
7. **Close, withdraw and transfer.** Stop the Aqua strategy, repay available USDC, sell remaining WETH if needed, and supply any repayment shortfall explicitly. Collateral exits only when debt is zero. ETH collateral is returned as WETH and can be unwrapped. Once funds are back in the Privy wallet, transfer USDC or ETH to an address on Arbitrum. This transfer is a crypto withdrawal; selling back to EUR or sending to a bank is not implemented.
8. **Inspect the statement.** Review action, asset, exact amount, recipient, timestamp, transaction hash, verification result and network fee, alongside observed wallet and Aave balances. Download the JSON report. EUR requests/provider status are recorded separately from onchain receipts. Browser history covers operations recorded by Noria on that origin; it is not a complete wallet indexer or a profit calculation.

The strategy targets users willing to manage collateral-backed WETH/USDC liquidity. Net returns depend on actual fills and fees, inventory price changes, loan interest, conversion costs and gas. USDC collateral does not remove the ETH exposure acquired for liquidity. A valid plan or a successful demo does not establish positive returns in sideways, rising or falling markets.

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

The same deployment serves `/`, `/aqua` and `/reserve`. See [deployment](docs/deployment.md) for the judging domain, server-side settings and a signed-out access check.

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

Set `NEXT_PUBLIC_PRIVY_APP_ID` before building and configure allowed origins in Privy. Login creates/opens a Privy embedded wallet. `/reserve` offers explicitly confirmed public wallet/Aave actions. The public Aqua lifecycle additionally requires a deployed, verified `PositionFactory`; deployment configuration must be explicit. With Foundry on `PATH`, enable `NORIA_ENABLE_LOCAL_FORK=1` on a loopback server to run the downloaded plan with local wallet impersonation and a complete operation report. The local runner is disabled on Vercel and does not use the wallet's real funds.

Read the [product and integration specification](docs/1inch/integration.md), [rehearsal guide](docs/1inch/rehearsal.md), [OpenAPI](public/aqua/position-openapi.json), [financial policy](docs/1inch/architecture.md) and [recorded execution evidence](docs/1inch/evidence/README.md). Root `npm ci` installs the integrated app. Standalone pnpm installation belongs in a separate checkout.

## Use the Privy reserve

Open `/reserve`, create/open a Privy wallet and use the EUR onramp or another wallet to add native USDC plus ETH for fees on Arbitrum. Review an exact approval, then separately confirm the Aave deposit. Withdraw to the same wallet, or review a USDC/ETH transfer to another Arbitrum address. Download the operation report with the latest balance observation. This direct Aave savings flow does not borrow or automatically fund an Aqua account. The chosen amount can pre-fill the Aqua planner.

The pinned Privy SDK is **3.42.0**. Wallet actions use `useSendTransaction` with the explicit embedded wallet address and cancellable confirmation. EUR checkout uses the documented `useFiatOnramp` API with `source.defaultAsset: "eur"` and native Arbitrum USDC as its destination. That hook is marked experimental in this SDK; the prize's generally available functional integration is the ordinary signed transfer or Aave supply/withdrawal. Funding-provider availability depends on region and dashboard configuration. No Privy Cards, commercial Earn feature, gas sponsorship or bank off-ramp is assumed.

See [Privy setup](docs/privy/setup.md), [judge guide](docs/privy/README.md) and [validation](docs/privy/validation.md). The App ID is configured and wallet connection has been observed; public funding and a user-confirmed financial action still need acceptance evidence. `npm run validate:privy-protocol` checks the official contracts on a local fork; impersonation is not Privy signing evidence.

## Technology

| Layer                | Tools                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Web                  | Next.js 15, React 19, TypeScript, CSS modules and SVG                                                                              |
| Indexed market data  | The Graph Subgraph MCP; optional Graph gateway                                                                                     |
| Independent checks   | viem RPC reads, DeFiLlama prices, exact-contract CoinGecko fallback                                                                |
| Position math        | Uniswap v3 SDK, SDK Core, Decimal.js and integer quantities                                                                        |
| Contracts and agents | Solidity 0.8.30, official Aqua/SwapVM SDKs, Aave, Foundry, Zod, HTTP and read-only MCP over HTTP/stdio                             |
| Wallet and reserve   | Privy embedded wallet, EUR onramp, confirmed Arbitrum transfers and Aave supply/withdrawal; [scope and setup](docs/privy/setup.md) |
| Verification         | Node test runner with tsx, Playwright, TypeScript, Prettier and GitHub Actions                                                     |

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

The [wallet launch evidence](docs/1inch/evidence/wallet-launch/README.md) adds **29 verified operations** across USDC and ETH collateral: create, supply/borrow, convert, ship, stop, repay accrued debt, exit and transfer. Each report includes exact requests, transaction receipts, balances and fees. Reproduce with `npm run validate:aqua-launch`; these are isolated-fork results, not public Privy signing evidence.

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

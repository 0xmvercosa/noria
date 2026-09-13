# Validation

Noria separates deterministic checks, browser behavior and dated live observations. Offline fixtures are test inputs, never production fallbacks. They do not establish current provider availability, profitable execution or future fee income.

## Reproduce the checks

Use Node.js 22.9 or later and install the locked dependencies:

```sh
npm ci
npm test
npm run typecheck
npm run build
npx playwright install chromium
npm run test:browser
```

Browser tests use Playwright's bundled Chromium. CI installs Chromium and its system dependencies. The browser suite expects the production build and uses port **3101** by default, separate from the demo on 3100. `PLAYWRIGHT_PORT` can override it. Locally, `PLAYWRIGHT_CHANNEL=chrome npm run test:browser` uses installed Chrome. Stop a server using the same build output before rebuilding.

| Check                       | Purpose                                                                         |
| --------------------------- | ------------------------------------------------------------------------------- |
| `npm test`                  | Domain/service regressions, source validation and recorded-input matrix         |
| `npm run typecheck`         | Type contracts across UI, API, providers and MCP                                |
| `npm run build`             | Production application compilation                                              |
| `npm run test:browser`      | Fixture-driven user flows, evidence, failure states and downloads               |
| `npm run validate:arbitrum` | Optional recorded-source replay or explicitly requested live capture; see below |

## Published implementation checks

The Noria checkout was validated on **13 September 2026**:

| Check                   | Result                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Unit tests              | 70 passed, including the recorded 420-configuration Arbitrum replay and Aqua contract/HTTP regressions |
| TypeScript              | Passed across sources, tests, scripts and the typed Aqua client example                                |
| Production build        | Passed for `/`, `/aqua`, both APIs and the SVG favicon                                                 |
| Browser scenarios       | 16 passed: 12 full-discovery scenarios and 4 Aqua integration scenarios                                |
| MCP stdio smoke checks  | Tool listing, configured networks and the dated historical example passed                              |
| Logo                    | Self-contained SVGs inspected at favicon and header sizes                                              |
| Live Aqua reference API | Four actual HTTP 200 recommendations at the source times listed below                                  |

GitHub Actions checks formatting, types, unit tests, the production build and browser behavior on pull requests. Each publication PR has a recorded agent-assisted review; these are not independent human audits. Tests validate implementation behavior, not profitable execution.

## Curated recorded-input baseline

The curated Arbitrum inputs were captured on **12 September 2026**. They cover 14 pool snapshots and 30 supported configurations per pool: three capital amounts, two review intervals, and fee exposure plus conversion discounts of 25, 100, 250 and 1,000 bps. Replaying a snapshot uses its original observation time, not the current wall clock.

| Recorded matrix outcome                            | Configurations |
| -------------------------------------------------- | -------------: |
| Complete calculation within the 1% capacity policy |             56 |
| Complete calculation above the 1% capacity policy  |            304 |
| Explicit refusal for incomplete history            |             60 |
| Total                                              |            420 |

The 60 history refusals correspond to two pools with fewer than 168 required observations. These refusals are expected outputs, not successful recommendations. No capacity threshold was relaxed to increase passing results. The matrix is one component of the current 70-test suite; it is not 420 additional top-level unit tests.

The public fixture set is limited to inputs needed for regression and browser coverage. It is not a complete market archive. Recorded snapshots and the [historical accounting example](../data/examples/historical-case.json) are different artifacts: the matrix tests current calculation behavior on dated inputs, while the example explains a supplied historical result.

For a standalone offline matrix replay, first copy the fixtures into a fresh output directory because the script writes its summary there:

```sh
mkdir -p .runtime
cp -R tests/fixtures/arbitrum .runtime/arbitrum-replay
npm run validate:arbitrum -- --output=.runtime/arbitrum-replay
```

## What the tests cover

Unit coverage includes canonical pool/block identity, tick bounds and ordering, liquidity reconstruction, full-distribution/window equivalence, bitmap edge bits, negative ticks, recovery coverage, partial reads, capacity, expiry, query filters and price fallback rules. Range-window checks cover every integer discount from 25 through 1,000 bps across the supported fee spacings.

Browser scenarios cover automatic/manual selection, empty and excluded results, retries, input changes, cancellation, preserving a dated report on failure, selecting another candidate, evidence, mixed price providers, downloads and expiry. They use explicit fixtures; a passing browser suite does not imply live Graph/RPC success.

The Aqua scenarios also cover USDC raw-unit funding, exact token contracts, below-spot buy ranges, large-budget capacity refusal, fractional inputs, expiry, mobile layout, provider failures and the public OpenAPI/capability endpoints. Contract tests reject USDC.e, wrong chains, explicit pool selection, unsupported amounts and stale or mismatched evidence. They verify the recorded example's original report hash.

## Dated live integration checks

Actual HTTP calls to the Aqua reference API used live The Graph, canonical RPC and independent USD providers. The [compact results](../examples/aqua/live-checks.json) preserve the source blocks, ranges and report IDs. A [complete 1,000-USDC response](../examples/aqua/response.recorded.json) preserves the original evidence. These files are already expired and never replace live data.

| UTC on 13 Sep 2026 |     Funding | Objective        | Result                   | Maximum reference share |
| ------------------ | ----------: | ---------------- | ------------------------ | ----------------------: |
| 01:38:47           |  1,000 USDC | Earn fees        | Active range recommended |                0.04963% |
| 01:41:20           |  5,000 USDC | Earn fees        | Active range recommended |                0.24768% |
| 01:41:25           | 10,000 USDC | Earn fees        | Active range recommended |                0.49413% |
| 01:41:30           |  1,000 USDC | Buy ETH, 100 bps | Waiting range below spot |                0.26186% |

All four selected the native-USDC/WETH 0.05% reference pool `0xc6962004f452be9203591991d15f6b388e09e8d0`. That address is an observed result, not an input or production default. Responses took approximately 5–7 seconds. The 0.01% candidate failed range capacity, and other fee tiers failed discovery thresholds. The requests observed different times, so this is a dated smoke check rather than a controlled return comparison.

No swap, Aqua dock, Aave borrowing, wallet signing, realized P&L or fee forecast was tested by these read-only calls. Those execution features remain planned.

## Optional live validation

Live validation contacts external providers and records new dated observations. It is outside the default unit/browser suite and requires working provider access. Use a fresh output directory for a new capture:

```sh
npm run validate:arbitrum -- --live --output=.runtime/arbitrum-live
```

Preserve source blocks, original quote timestamps, provider names, exclusions and any errors when reporting a run. A new capture can yield different candidates or refusals from the recorded matrix. Do not treat a changed result as a regression until its source evidence and invariants have been compared.

## Limits of the evidence

The 1% capacity policy checks present modeled liquidity share. Neither that policy nor the 420-case matrix establishes net profitability, token safety or executable inventory. Report hashes check internal consistency; downloaded reports omit raw tick distributions and do not independently reproduce capacity. The historical example's compact ledger supports arithmetic inspection rather than a complete historical replay.

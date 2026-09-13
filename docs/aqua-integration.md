# Aqua integration: Arbitrum WETH / native USDC

Noria provides the **informational strategy selection** step in the combined The Graph + Aqua product. The Aqua application initiates the flow, sends a USDC inventory budget and objective, and receives an inspected Uniswap v3 reference pool, price range, target inventory and source evidence. Aqua execution and Aave debt management remain separate work.

The full multi-network demonstration remains at `/`. The focused preview is at `/aqua`. Both use the same Graph, price, canonical-state and range calculation modules. The focused integration never asks the caller to select a pool.

## Calling contract

`POST /api/aqua/v1/recommendation`, with `Content-Type: application/json`.

- [OpenAPI 3.1 specification](../public/aqua/openapi.json), also served at `/aqua/openapi.json`.
- [TypeScript request and response types](../src/integrations/aqua/contract.ts).
- [Request example](../examples/aqua/request.json) and [typed client example](../examples/aqua/client.ts).
- `GET` on the endpoint returns capabilities and an example without contacting market providers.

The server-to-server endpoint is public and read-only. Call it from the Aqua backend; the demo does not configure cross-origin browser access or authenticate a wallet. Never send private keys, signatures, RPC credentials or loan approvals. Put deployment access controls and provider quotas at the hosting boundary when connecting a production caller.

```json
{
  "schemaVersion": "noria.aqua.v1",
  "requestId": "aqua-preview-001",
  "chainId": 42161,
  "funding": {
    "tokenAddress": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    "amountRaw": "1000000000"
  },
  "objective": "earn-fees",
  "reviewAfterHours": 6
}
```

| Field                  | Meaning and accepted values                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`        | Exactly `noria.aqua.v1`.                                                                                                                        |
| `requestId`            | Caller-generated correlation ID, 1–64 letters, digits, `_` or `-`. It is not an idempotency key: repeated requests may observe different state. |
| `chainId`              | Exactly `42161` (Arbitrum One).                                                                                                                 |
| `funding.tokenAddress` | Exact native USDC contract above, case-insensitive. USDC.e is excluded.                                                                         |
| `funding.amountRaw`    | Integer string in USDC base units, with six decimals. From `1000000` to `100000000000` inclusive: 1–100,000 USDC.                               |
| `objective`            | `earn-fees` or `buy-eth`.                                                                                                                       |
| `reviewAfterHours`     | `6` or `24`. A review prompt, not a holding-period limit, scheduled job or fee forecast.                                                        |
| `discountBps`          | Only for `buy-eth`; integer 25–1,000, default 100. Rejected for `earn-fees`.                                                                    |

Other fields, networks, tokens and caller-selected pools are rejected. Examples: 1,000 USDC is `1000000000`; 5,000 is `5000000000`; 10,000 is `10000000000`; 1,234.56789 is `1234567890`. Send the amount actually available for target inventory. The USDC/USD mark comes from Noria's verified snapshot; USDC is not assumed to be worth exactly one dollar.

The caller retains collateral, debt, interest, health and execution-limit state. Noria does not need those fields to perform this reference search and does not imply that a passing reference is suitable for leveraged use.

```sh
curl --request POST http://127.0.0.1:3100/api/aqua/v1/recommendation \
  --header 'Content-Type: application/json' \
  --data-binary @examples/aqua/request.json
```

For a planned ETH purchase, set `objective` to `buy-eth` and optionally add `discountBps`. The exact pair is WETH token0 and USDC token1, so the range starts entirely in USDC below spot. Conversion can reverse while the position remains open.

## What Noria does

1. Resolve the two exact contracts in the public token universe. Apply both contract filters **inside The Graph query before pagination**. WETH is `0x82af49447d8a07e3bd95bd0d56f35241523fbab1` (18 decimals); native USDC is `0xaf88d065e77c8cc2239327c5edb3a432268e5831` (6 decimals).
2. Screen supported Uniswap v3 fee tiers `100 / 500 / 3000 / 10000`, positive liquidity and pools older than seven days. Existing discovery thresholds require at least $250k independently re-marked token balances, $50k approximate completed-day volume and swaps in 18 of 24 completed hours.
3. Rank by the current disclosed heuristic: 35% active hours, 25% volume scale, 20% liquidity scale, 20% turnover. Try up to four exact-pair candidates in score order, preserving each refusal.
4. Require complete 168-hour history, canonical factory/token/block checks, valid USD references and verified initialized-tick coverage. If necessary, recover a bounded tick window through canonical RPC.
5. Value the caller's USDC budget using the same USDC quote consumed by the range calculation. For fee exposure, align the 10th and 90th percentiles of seven days of hourly ticks to the fee tier's spacing. For buying ETH, construct a discount band below spot. Ranges can be asymmetric or entirely outside the current price.
6. Size integer token inventory with Uniswap SDK math and require modeled liquidity share of at most 1% on every reference-range segment. Return the highest-ranked passing candidate or an explicit refusal.

“Best” means **highest-ranked passing reference within this bounded search and heuristic**, not a globally optimal pool, range, expected return or Aqua strategy. The review interval does not alter the seven-day lookback. The 1% limit applies to the Uniswap reference distribution and does not establish Aqua fill capacity.

## Successful response

HTTP `200` with `status: "recommended"` includes:

| Response field                    | What the Aqua application receives                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scope` / `request` / `requestId` | Exact network/assets and the normalized request that produced the result.                                                                              |
| `selection`                       | Method, attempted count, candidates, provider, source block, ranking explanation and all exclusions.                                                   |
| `recommendation.referencePool`    | Uniswap reference contract, ordered token contracts/decimals and fee tier. `500` means 0.05%.                                                          |
| `recommendation.range`            | Lower, upper and spot prices **in USDC per WETH**, aligned Uniswap ticks, method, and `active` or `waiting`.                                           |
| `recommendation.targetInventory`  | WETH and USDC raw integer amounts, independently marked USD value and residual marked value.                                                           |
| `recommendation.funding`          | Original raw USDC budget, its USD mark and value, whether a preparation swap is needed, and `swapQuote: null`.                                         |
| `recommendation.validUntil`       | Evidence expiry. Refresh after it; never use `evaluatedAt` to renew a source.                                                                          |
| `recommendation.report`           | Full original report with its digest, source query/response hashes, block identity, RPC evidence, original quote timestamps, capacity and assumptions. |
| `handoff`                         | `executionReady: false`, `aquaStrategy: null`, `transaction: null`, `economics: "not-established"`, required next steps and unpriced costs.            |

The detailed success shape is in OpenAPI and the TypeScript contract. A [complete real response captured on 13 September 2026](../examples/aqua/response.recorded.json) is included; it is expired historical evidence, not a current recommendation. The full report is deliberately preserved rather than reduced to a price band without provenance. Its hash checks internal consistency; it is not a signature or execution authorization.

## No recommendation and errors

A valid request can return HTTP `200` with `status: "no-recommendation"` and `recommendation: null`. Read `selection.discovery.rejected` for capacity, history, expiry, identity or provider failures encountered while attempting candidates. Do not silently resize, change tokens, retry another network or treat a refusal as permission to execute.

```json
{
  "schemaVersion": "noria.aqua.v1",
  "status": "unavailable",
  "code": "source-unavailable",
  "message": "The Graph is temporarily unavailable; the query could not be completed. Please try again shortly."
}
```

| HTTP status | Code / caller behavior                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `400`       | `invalid-input` with field issues, or `invalid-json`. Correct the request; do not automatically retry it. |
| `413`       | `body-too-large`: maximum 4,096 UTF-8 bytes.                                                              |
| `415`       | `content-type`: use `application/json`.                                                                   |
| `503`       | `source-unavailable`: observe `Retry-After: 15`, then back off. No market response is substituted.        |

Responses use `Cache-Control: no-store`. Discovery has a short internal source cache; report age is recomputed from original evidence. Request time depends on providers and bounded candidate checks. Use a generous backend timeout, avoid concurrent duplicate requests, and re-request on expiry or material changes rather than polling every block. There is no automated monitoring loop in this delivery.

## Responsibilities after the handoff

The Aqua application must:

1. Assess the Aave loan and user exposure before using the reference. WETH collateral and WETH in LP both count toward total ETH exposure. Keep collateral supply yield separate from LP results.
2. Translate the **economic price range and target inventory** into its actual supported Aqua strategy. A Uniswap pool address, ticks, liquidity integer and fee tier are not directly executable Aqua parameters. Select and validate the Aqua strategy contract, maker setup, fee rules and fills independently.
3. Obtain executable USDC → WETH preparation quotes where required. Include swap fees, slippage limits and price impact in sizing. If the quote cannot acquire the target inventory within the available budget, reduce the _request budget explicitly_ and ask Noria again; do not describe the original inventory as executable.
4. Keep gas/operating funds in the separate account and count their economic cost. Noria's `report.costs.estimatedCycleGasUsd` is a Uniswap reference estimate, **not an Aqua, Aave or Arbitrum total**. Aqua operations, L1 data charges, preparation/exit swaps, slippage, price impact and borrowing interest remain unpriced here; no fixed reserve is withheld.
5. Re-check current prices, inventory, capacity and execution constraints immediately before user authorization. An informational recommendation is never a signing payload.
6. Maintain realized versus unrealized P&L, maker/taker/group accounting, interest, prior-loss recovery, operational provisions and the eligible 50/50 allocation. Deteriorating debt health overrides reinvestment. The owner-authorized checkpoint and bounded collateral-sale authorization remain responsibilities of the execution product.

The 50/50 allocation rule applies to eligible **realized net surplus**, not the starting WETH/USDC inventory ratio. The proposed downstream accounting and exit rules are documented in the [roadmap](roadmap.md).

## Validation and deployment

The integration has deterministic service/HTTP tests, a replay across 1,000 / 5,000 / 10,000 USDC plus fractional funding, and browser coverage for selection, expiry, buy ranges, refusals, invalid input and mobile behavior. See [validation](validation.md) for actual results and dated live observations.

Deploy the same Next.js application with Node.js 22.9+ and sufficient request duration. The Graph MCP route works without a configured Graph API key; optional Graph gateway and RPC credentials remain server-side. The caller only needs the final origin, for example `https://your-noria-domain.example`, plus the versioned endpoint path. No deployment domain is hard-coded into the adapter.

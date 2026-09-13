import { z } from "zod";
import { PositionIntentSchema, uint, address, USDC, WETH } from "./boundary.js";

const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const graphHash = z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/);
const instant = z.iso.datetime();
const positiveNumber = z.number().finite().positive();
const blockNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const feeTier = z.union([
  z.literal(100),
  z.literal(500),
  z.literal(3000),
  z.literal(10000),
]);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const normalizedHash = (value: string) =>
  `0x${value.replace(/^0x/, "").toLowerCase()}`;
const asset = (expected: string, decimals: 6 | 18) =>
  z
    .object({
      address: address.refine((value) => same(value, expected)),
      decimals: z.literal(decimals),
    })
    .passthrough();

/** Validate fields used by the handoff while retaining the complete source report. */
const GraphEvidenceSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.v1"),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    status: z.literal("recommended"),
    evaluatedAt: instant,
    scope: z
      .object({
        chainId: z.literal(42161),
        network: z.literal("arbitrum"),
        referenceVenue: z.literal("uniswap-v3"),
        weth: asset(WETH, 18),
        usdc: asset(USDC, 6),
      })
      .passthrough(),
    request: z
      .object({
        schemaVersion: z.literal("noria.aqua.v1"),
        requestId: z.string(),
        chainId: z.literal(42161),
        funding: z
          .object({
            tokenAddress: address.refine((value) => same(value, USDC)),
            amountRaw: uint,
          })
          .passthrough(),
        objective: z.literal("earn-fees"),
        reviewAfterHours: z.union([z.literal(6), z.literal(24)]),
      })
      .passthrough(),
    selection: z
      .object({
        method: z.literal("highest-ranked-passing-reference-pool"),
        discovery: z
          .object({
            network: z.literal("arbitrum"),
            sourceBlock: blockNumber,
          })
          .passthrough(),
      })
      .passthrough(),
    recommendation: z
      .object({
        referencePool: z
          .object({
            venue: z.literal("uniswap-v3"),
            address,
            feeTier,
            token0: asset(WETH, 18),
            token1: asset(USDC, 6),
          })
          .passthrough(),
        range: z
          .object({
            priceUnit: z.literal("USDC per WETH"),
            lower: positiveNumber,
            upper: positiveNumber,
            spot: positiveNumber,
            tickLower: z.number().int(),
            tickUpper: z.number().int(),
            location: z.literal("active"),
            method: z.literal("seven-day-hourly-tick-quantiles"),
          })
          .passthrough(),
        targetInventory: z
          .object({
            wethAmountRaw: uint,
            usdcAmountRaw: uint,
          })
          .passthrough(),
        funding: z
          .object({
            usdcAmountRaw: uint,
            inventoryPreparationRequired: z.literal(true),
            swapQuote: z.null(),
          })
          .passthrough(),
        validUntil: instant,
        report: z
          .object({
            version: z.literal(1),
            classification: z.literal("live-construction-analysis"),
            createdAt: instant,
            validUntil: instant,
            input: z
              .object({
                network: z.literal("arbitrum"),
                poolAddress: address,
                intent: z.literal("earn-fees"),
                horizonHours: z.union([z.literal(6), z.literal(24)]),
              })
              .passthrough(),
            source: z
              .object({
                blockNumber,
                blockHash: hash,
                blockTimestamp: blockNumber,
                queryHash: graphHash,
                responseHash: graphHash,
                rpcMatched: z.literal(true),
              })
              .passthrough(),
            pool: z
              .object({
                address,
                network: z.literal("arbitrum"),
                token0Address: address.refine((value) => same(value, WETH)),
                token1Address: address.refine((value) => same(value, USDC)),
                token0Decimals: z.literal(18),
                token1Decimals: z.literal(6),
                feePercent: positiveNumber,
                relativePrice: positiveNumber,
                historyHours: z.literal(168),
                history: z
                  .array(
                    z
                      .object({
                        timestamp: blockNumber,
                        price: positiveNumber,
                      })
                      .passthrough(),
                  )
                  .length(168),
              })
              .passthrough(),
            position: z
              .object({
                tickLower: z.number().int(),
                tickUpper: z.number().int(),
                lowerPrice: positiveNumber,
                upperPrice: positiveNumber,
                amount0Raw: uint,
                amount1Raw: uint,
                maxSharePercent: z.number().finite().min(0).max(1),
                location: z.literal("active"),
              })
              .passthrough(),
            checks: z
              .object({
                data: z.literal("verified"),
                construction: z.literal("feasible"),
                economics: z.literal("not-established"),
              })
              .passthrough(),
          })
          .passthrough(),
      })
      .passthrough(),
    handoff: z
      .object({
        executionReady: z.literal(false),
        aquaStrategy: z.null(),
        transaction: z.null(),
        economics: z.literal("not-established"),
      })
      .passthrough(),
  })
  .passthrough();

/** Strategy data only. No executable calldata, key or RPC is accepted by the runner. */
export const RehearsalPlanSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.position.v1"),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    status: z.literal("ready-for-local-rehearsal"),
    evaluatedAt: instant,
    validUntil: instant,
    intent: PositionIntentSchema,
    financing: z
      .object({
        collateralAsset: address,
        collateralAmountUnits: uint,
        loanUSDCUnits: uint,
        collateralPriceBase: uint,
        usdcPriceBase: uint,
        ltvBps: uint,
        liquidationThresholdBps: uint,
        blockNumber: uint,
        blockHash: hash,
        timestamp: instant,
        headroomBps: z.literal(50),
      })
      .strict(),
    execution: z
      .object({
        chainId: z.literal(42161),
        sourcePool: address,
        sourceFeeTierPips: feeTier,
        lowerPriceE6: uint,
        upperPriceE6: uint,
        lpFeeBps: z.number().int().min(1).max(100),
        targetWethUnits: uint,
        targetUsdcUnits: uint,
        convertUsdcUnits: uint,
        selectionMethod: z.literal("highest-ranked-passing-reference-pool"),
        observationCount: z.number().int().min(24).max(720),
        inRangeObservations: z.number().int().min(0).max(720),
        coverageBps: z.number().int().min(8000).max(10000),
        observedWindowStart: instant,
        observedWindowEnd: instant,
        graphQueryHash: hash,
        graphResponseHash: hash,
        graphHashAlgorithm: z.literal("sha256"),
        graphIndexedBlock: uint,
        graphIndexedBlockHash: hash,
        canonicalSourceLiquidity: uint,
        canonicalCurrentBlock: uint,
        programBuilder: z.literal("@1inch/swap-vm-sdk@0.4.4"),
      })
      .strict(),
    graph: GraphEvidenceSchema,
    reasons: z.array(z.string()),
    routingStatus: z.literal("not_validated"),
    economics: z.literal("not-established"),
  })
  .strict();
export type RehearsalPlan = z.infer<typeof RehearsalPlanSchema>;

// The adapter uses Decimal(number), i.e. the number's decimal string. Avoid binary
// multiplication rounding a bound across a micro-USDC boundary in this package.
function priceE6(value: number, roundUp: boolean): bigint {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  const coefficient = BigInt(whole! + fraction);
  const shift = Number(exponent) + 6 - fraction.length;
  if (shift >= 0) return coefficient * 10n ** BigInt(shift);
  const divisor = 10n ** BigInt(-shift);
  const quotient = coefficient / divisor;
  return roundUp && coefficient % divisor !== 0n ? quotient + 1n : quotient;
}

/** Checks internal consistency of unsigned JSON; this does not authenticate Graph data. */
export function parseRehearsalPlan(
  raw: unknown,
  now = Date.now(),
): RehearsalPlan {
  const plan = RehearsalPlanSchema.parse(raw);
  const e = plan.execution,
    f = plan.financing,
    g = plan.graph;
  const rec = g.recommendation,
    r = rec.report,
    range = rec.range;
  const evaluatedAt = Date.parse(plan.evaluatedAt);
  const validUntil = Date.parse(plan.validUntil);
  const financingAt = Date.parse(f.timestamp);
  if (
    !Number.isFinite(now) ||
    validUntil <= now ||
    evaluatedAt > now + 60_000 ||
    evaluatedAt > validUntil ||
    financingAt > now + 60_000 ||
    Date.parse(g.evaluatedAt) > now + 60_000 ||
    Date.parse(g.evaluatedAt) >= Date.parse(rec.validUntil) ||
    Date.parse(r.createdAt) > now + 60_000 ||
    Date.parse(r.createdAt) >= Date.parse(r.validUntil) ||
    Date.parse(rec.validUntil) !== Date.parse(r.validUntil) ||
    validUntil >
      Math.min(
        evaluatedAt + 300_000,
        Date.parse(rec.validUntil),
        Date.parse(r.validUntil),
        financingAt + 3_600_000,
      ) ||
    r.source.blockTimestamp * 1000 > now + 60_000 ||
    now - r.source.blockTimestamp * 1000 > 3_600_000
  )
    throw new Error("position_plan_expired_or_invalid_clock");

  if (
    f.collateralAmountUnits !== plan.intent.collateralAmountUnits ||
    !same(
      f.collateralAsset,
      plan.intent.fundingAsset === "ETH" ? WETH : USDC,
    ) ||
    BigInt(f.loanUSDCUnits) < 1_000_000n ||
    BigInt(f.loanUSDCUnits) > 100_000_000_000n ||
    BigInt(f.collateralPriceBase) === 0n ||
    BigInt(f.usdcPriceBase) === 0n ||
    BigInt(f.ltvBps) === 0n ||
    BigInt(f.ltvBps) >= BigInt(f.liquidationThresholdBps) ||
    BigInt(f.liquidationThresholdBps) > 10_000n ||
    BigInt(f.blockNumber) === 0n ||
    BigInt(e.targetWethUnits) === 0n ||
    BigInt(e.targetUsdcUnits) === 0n ||
    BigInt(e.convertUsdcUnits) === 0n ||
    BigInt(e.convertUsdcUnits) + BigInt(e.targetUsdcUnits) !==
      BigInt(f.loanUSDCUnits) ||
    BigInt(e.lowerPriceE6) <= 0n ||
    BigInt(e.lowerPriceE6) >= BigInt(e.upperPriceE6) ||
    e.lpFeeBps !== e.sourceFeeTierPips / 100 ||
    e.inRangeObservations > e.observationCount ||
    Math.floor((e.inRangeObservations * 10000) / e.observationCount) !==
      e.coverageBps ||
    BigInt(e.canonicalSourceLiquidity) === 0n ||
    BigInt(e.canonicalCurrentBlock) < BigInt(e.graphIndexedBlock)
  )
    throw new Error("inconsistent_position_plan");

  if (
    g.requestId !== plan.requestId ||
    g.request.requestId !== plan.requestId ||
    g.request.funding.amountRaw !== f.loanUSDCUnits ||
    rec.funding.usdcAmountRaw !== f.loanUSDCUnits ||
    r.input.horizonHours !== g.request.reviewAfterHours ||
    !same(e.sourcePool, rec.referencePool.address) ||
    !same(e.sourcePool, r.pool.address) ||
    !same(e.sourcePool, r.input.poolAddress) ||
    e.sourceFeeTierPips !== rec.referencePool.feeTier ||
    r.pool.feePercent !== e.sourceFeeTierPips / 10000 ||
    range.lower >= range.upper ||
    range.tickLower >= range.tickUpper ||
    range.lower !== r.position.lowerPrice ||
    range.upper !== r.position.upperPrice ||
    range.tickLower !== r.position.tickLower ||
    range.tickUpper !== r.position.tickUpper ||
    range.spot !== r.pool.relativePrice ||
    !(range.lower < range.spot && range.spot < range.upper) ||
    BigInt(e.lowerPriceE6) !== priceE6(range.lower, false) ||
    BigInt(e.upperPriceE6) !== priceE6(range.upper, true) ||
    e.targetWethUnits !== rec.targetInventory.wethAmountRaw ||
    e.targetWethUnits !== r.position.amount0Raw ||
    e.targetUsdcUnits !== rec.targetInventory.usdcAmountRaw ||
    e.targetUsdcUnits !== r.position.amount1Raw ||
    !same(e.graphQueryHash, normalizedHash(r.source.queryHash)) ||
    !same(e.graphResponseHash, normalizedHash(r.source.responseHash)) ||
    e.graphIndexedBlock !== String(r.source.blockNumber) ||
    !same(e.graphIndexedBlockHash, r.source.blockHash)
  )
    throw new Error("inconsistent_graph_position_plan");

  const history = [...r.pool.history].sort((a, b) => a.timestamp - b.timestamp);
  const windowEnd = Math.floor(r.source.blockTimestamp / 3600) * 3600;
  const inRange = history.filter(
    (h) => h.price >= range.lower && h.price <= range.upper,
  ).length;
  // The Graph method consumes the previous 168 complete, consecutive hours.
  if (
    history.some((h, i) => h.timestamp !== windowEnd - 604800 + i * 3600) ||
    e.observationCount !== history.length ||
    e.inRangeObservations !== inRange ||
    e.coverageBps !== Math.floor((inRange * 10000) / history.length) ||
    Date.parse(e.observedWindowStart) !== history[0]!.timestamp * 1000 ||
    Date.parse(e.observedWindowEnd) !== windowEnd * 1000 ||
    now - windowEnd * 1000 > 3_600_000
  )
    throw new Error("inconsistent_graph_observations");
  return plan;
}

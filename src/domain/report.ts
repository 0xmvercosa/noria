import { formatUnits } from "viem";
import { networkConfig } from "../config/networks";
import {
  ReportInputSchema,
  DataSchema,
  FEE_SPACING,
  digest,
  type Snapshot,
} from "./analysis-data";
import {
  PRICE_MARK_FRESH_AGE_SECONDS,
  PRICE_MARK_MAX_AGE_SECONDS,
} from "./price-mark";
import {
  PRICE_RATIO_MAX_DEVIATION_PERCENT,
  verifyReferenceRatio,
} from "./price-references";
import {
  designPosition,
  humanPrice,
  sqrtRatioAtTick,
  convertedPrincipal,
  type PoolDefinition,
} from "./uniswap";
import { minimumRangeLiquidity } from "./ticks";
import type { LiveReport, PriceReferenceAssessment } from "./types";

export class HistoryDataError extends Error {
  readonly code = "incomplete-history";
  constructor(observed: number) {
    super(
      `Seven-day Graph history is incomplete (${observed}/168 hourly records returned; all hours must be consecutive). No range was recommended. Try another candidate or refresh after the indexer has complete history.`,
    );
    this.name = "HistoryDataError";
  }
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) * q)];
}

// With a supplied decision time, construction is deterministic and makes no
// provider requests. Source collection preserves the evidence consumed here.
export function buildReport(
  rawInput: unknown,
  snapshot: Snapshot,
  now = Math.floor(Date.now() / 1000),
): LiveReport {
  const input = ReportInputSchema.parse(rawInput),
    data = DataSchema.parse(snapshot.data),
    meta = data._meta,
    n = networkConfig(input.network);
  if (input.network !== snapshot.network || input.poolAddress !== data.pool.id)
    throw new Error(
      "Snapshot does not belong to the requested network and pool.",
    );
  if (
    !snapshot.rpcMatched ||
    snapshot.prices.timestamp > now ||
    meta.block.timestamp > now ||
    Date.parse(snapshot.receivedAt) > now * 1000 + 999
  )
    throw new Error("Evidence was not available at the decision time.");
  if (
    [...snapshot.prices.usd, snapshot.prices.nativeUsd].some(
      (p) => !Number.isFinite(p) || p <= 0,
    ) ||
    !/^\d+$/.test(snapshot.gasPriceWei)
  )
    throw new Error("Invalid price or gas input.");
  const hours = data.pool.poolHourData,
    end = Math.floor(meta.block.timestamp / 3600) * 3600;
  if (
    hours.length !== 168 ||
    hours.some(
      (h, i) =>
        h.periodStartUnix !== end - 604800 + i * 3600 ||
        !Number.isFinite(Number(h.volumeUSD)) ||
        Number(h.volumeUSD) < 0,
    )
  )
    throw new HistoryDataError(hours.length);
  const tick = Number(data.pool.tick),
    spacing = snapshot.tickSpacing;
  if (spacing !== FEE_SPACING[Number(data.pool.feeTier)])
    throw new Error("Tick spacing does not match the fee tier.");
  let lo: number, hi: number;
  if (input.intent === "buy-token0") {
    const discount = (input.discountBps ?? 100) / 10000;
    hi =
      Math.floor((tick + Math.log(1 - discount) / Math.log(1.0001)) / spacing) *
      spacing;
    lo =
      Math.floor(
        (tick + Math.log(1 - discount * 1.5) / Math.log(1.0001)) / spacing,
      ) * spacing;
  } else {
    lo =
      Math.floor(
        quantile(
          hours.map((h) => Number(h.tick)),
          0.1,
        ) / spacing,
      ) * spacing;
    hi =
      Math.ceil(
        quantile(
          hours.map((h) => Number(h.tick)),
          0.9,
        ) / spacing,
      ) * spacing;
  }
  if (input.intent === "buy-token0") lo = Math.min(lo, hi - 2 * spacing);
  else hi = Math.max(hi, lo + 2 * spacing);
  if (
    lo < -887272 ||
    hi > 887272 ||
    (input.intent === "buy-token0" && hi >= tick)
  )
    throw new Error(
      "The requested range cannot be aligned below spot within protocol tick bounds.",
    );
  const a0 = data.pool.token0,
    a1 = data.pool.token1,
    d0 = Number(a0.decimals),
    d1 = Number(a1.decimals);
  const definition: PoolDefinition = {
    chainId: n.chain.id,
    token0: { address: a0.id, symbol: a0.symbol, decimals: d0 },
    token1: { address: a1.id, symbol: a1.symbol, decimals: d1 },
    fee: Number(data.pool.feeTier),
    tickSpacing: spacing,
  };
  const sqrt = BigInt(data.pool.sqrtPrice),
    relativePrice = Number(humanPrice(sqrt, d0, d1));
  const consistency = verifyReferenceRatio(relativePrice, snapshot.prices.usd),
    priceAge = now - snapshot.prices.timestamp;
  const priceReferences: PriceReferenceAssessment = {
    provider: snapshot.prices.source,
    freshness:
      priceAge > PRICE_MARK_MAX_AGE_SECONDS
        ? "expired"
        : priceAge > PRICE_MARK_FRESH_AGE_SECONDS
          ? "aged"
          : "fresh",
    oldestTimestamp: snapshot.prices.timestamp,
    ageSeconds: priceAge,
    freshAgeSeconds: PRICE_MARK_FRESH_AGE_SECONDS,
    maxAgeSeconds: PRICE_MARK_MAX_AGE_SECONDS,
    ...consistency,
    quotes: (snapshot.prices.references ?? []).map((quote) => ({
      ...quote,
      symbol:
        quote.role === "token0"
          ? a0.symbol
          : quote.role === "token1"
            ? a1.symbol
            : n.chain.nativeCurrency.symbol,
    })),
  };
  const range = designPosition(
    sqrt,
    data.pool.liquidity,
    tick,
    lo,
    hi,
    input.capitalUsd,
    snapshot.prices.usd,
    definition,
  );
  const tickEvidence = snapshot.ticks;
  if (
    tickEvidence &&
    (tickEvidence.provider !== "RPC" ||
      tickEvidence.scope !== "range-and-spot" ||
      tickEvidence.poolAddress !== data.pool.id ||
      tickEvidence.blockNumber !== meta.block.number ||
      tickEvidence.blockHash !== meta.block.hash ||
      tickEvidence.tickCount !== data.ticks.length)
  )
    throw new Error(
      "RPC tick evidence does not belong to this pool and pinned block.",
    );
  const minLiquidity = minimumRangeLiquidity(
      data.ticks,
      spacing,
      tick,
      BigInt(data.pool.liquidity),
      lo,
      hi,
      tickEvidence
        ? { lower: tickEvidence.lowerTick, upper: tickEvidence.upperTick }
        : undefined,
    ),
    share =
      Number(
        (range.liquidity * 1000000000000n) / (minLiquidity + range.liquidity),
      ) / 1e12;
  const fresh =
      now - meta.block.timestamp <= 120 &&
      now - snapshot.prices.timestamp <= PRICE_MARK_MAX_AGE_SECONDS,
    feasible = share <= 0.01,
    location = tick >= lo && tick < hi ? "active" : "waiting";
  const afterBuy =
      input.intent === "buy-token0"
        ? convertedPrincipal(lo, hi, range.liquidity, definition)
        : null,
    amount0 = formatUnits(range.amount0, d0),
    amount1 = formatUnits(range.amount1, d1);
  const approvals = (range.amount0 > 0n ? 1 : 0) + (range.amount1 > 0n ? 1 : 0),
    gasUnits = 650000 + approvals * 60000,
    gasUsd =
      (Number(snapshot.gasPriceWei) / 1e18) *
      gasUnits *
      snapshot.prices.nativeUsd;
  const createdAt = new Date(
      Math.max(now * 1000, Date.parse(snapshot.receivedAt)),
    ).toISOString(),
    validUntil = new Date(
      Math.min(
        meta.block.timestamp + 120,
        snapshot.prices.timestamp + PRICE_MARK_MAX_AGE_SECONDS,
        now + 60,
      ) * 1000,
    ).toISOString();
  const reasons = [
    fresh
      ? "Graph state and USD references satisfy their separate age policies."
      : "Source evidence expired; refresh the analysis.",
    `Oldest USD reference: ${priceAge}s. Up to ${PRICE_MARK_FRESH_AGE_SECONDS}s is recent; up to ${PRICE_MARK_MAX_AGE_SECONDS}s is usable with an age caveat for informational estimates.`,
    ...(priceReferences.freshness === "aged"
      ? [
          "USD references are aged. Inventory values and gas estimates use the original quotes, not updated USD prices.",
        ]
      : []),
    `USD reference ratio differs from the pool's relative price by ${consistency.deviationPercent.toFixed(3)}% (limit ${PRICE_RATIO_MAX_DEVIATION_PERCENT}%). This cannot detect a shared USD valuation error in both tokens.`,
    feasible
      ? "Modeled liquidity stays within the 1% research capacity policy on every range segment."
      : "Modeled liquidity exceeds the 1% research capacity policy in at least one segment.",
    "Current profitability is not established. Pool volume is context, not this range's future fees.",
  ];
  const report: LiveReport = {
    version: 1,
    id: "",
    classification: "live-construction-analysis",
    input,
    createdAt,
    validUntil,
    priceReferences,
    source: {
      provider: snapshot.route,
      subgraphId: n.subgraphId,
      deployment: meta.deployment,
      blockNumber: meta.block.number,
      blockHash: meta.block.hash,
      blockTimestamp: meta.block.timestamp,
      receivedAt: snapshot.receivedAt,
      queryHash: snapshot.queryHash,
      responseHash: snapshot.responseHash,
      rpcMatched: true,
      elapsedMs: snapshot.elapsedMs,
      stateAgeSeconds: now - meta.block.timestamp,
      tickCount: data.ticks.length,
      ...(tickEvidence ? { ticks: tickEvidence } : {}),
    },
    pool: {
      address: data.pool.id,
      network: input.network,
      chain: n.label,
      token0: a0.symbol,
      token1: a1.symbol,
      token0Address: a0.id,
      token1Address: a1.id,
      token0Decimals: d0,
      token1Decimals: d1,
      explorerUrl: n.explorerUrl,
      feePercent: Number(data.pool.feeTier) / 10000,
      relativePrice,
      token0Usd: snapshot.prices.usd[0],
      token1Usd: snapshot.prices.usd[1],
      priceTimestamp: snapshot.prices.timestamp,
      volume24hUsd: hours
        .slice(-24)
        .reduce((s, h) => s + Number(h.volumeUSD), 0),
      historyHours: hours.length,
      history: hours.map((h) => ({
        timestamp: h.periodStartUnix,
        price: Number(humanPrice(sqrtRatioAtTick(Number(h.tick)), d0, d1)),
        volumeUsd: Number(h.volumeUSD),
      })),
    },
    position: {
      tickLower: lo,
      tickUpper: hi,
      lowerPrice: Number(humanPrice(sqrtRatioAtTick(lo), d0, d1)),
      upperPrice: Number(humanPrice(sqrtRatioAtTick(hi), d0, d1)),
      amount0,
      amount1,
      amount0Raw: String(range.amount0),
      amount1Raw: String(range.amount1),
      liquidityRaw: String(range.liquidity),
      deployedUsd: Number(range.deployedUsd),
      residualUsd: Number(range.residualUsd),
      maxSharePercent: share * 100,
      location,
      fullConversionAmount0: afterBuy
        ? formatUnits(afterBuy.amount0, d0)
        : null,
      fullConversionAveragePrice:
        afterBuy && afterBuy.amount0 > 0n
          ? Number(amount1) / Number(formatUnits(afterBuy.amount0, d0))
          : null,
    },
    checks: {
      data: fresh ? "verified" : "expired",
      construction: feasible ? "feasible" : "capacity-exceeded",
      economics: "not-established",
      reasons,
    },
    costs: {
      estimatedCycleGasUsd: gasUsd,
      estimatedGasUnits: gasUnits,
      gasPriceGwei: Number(snapshot.gasPriceWei) / 1e9,
      swapPreparationUsd: 0,
      explanation: `Observed ${n.chain.nativeCurrency.symbol} gas price × estimated lifecycle units. Native gas is external. Required token inventory is assumed held; preparation and exit swaps are not priced. L2 data fees are not included in this first estimate.`,
    },
    decision: {
      action: fresh && feasible ? "review-plan" : "wait",
      title:
        fresh && feasible ? "A range to investigate" : "Wait before proceeding",
      explanation:
        input.intent === "buy-token0"
          ? `A ${a1.symbol}-funded range below the current ${a0.symbol}/${a1.symbol} price. Traversal converts toward ${a0.symbol}; conversion can reverse before withdrawal.`
          : "Suggested range from the previous seven days' 10th–90th percentile ticks. Inventory and capacity are modeled; economic merit remains unestablished.",
      management: [
        "Refresh market data and review inventory and cost assumptions before relying on this analysis.",
        input.intent === "buy-token0"
          ? "Review at the intended conversion target; conversion can reverse while liquidity remains."
          : "Compare holding, adjusting and exiting after costs; a border touch is not an automatic rebalance.",
        `Review the objective after ${input.horizonHours} hours. This interval does not predict fees or a fill.`,
      ],
      assumptions: [
        "The Graph provides discovery and range history; RPC reconciles the selected chain, factory, pool and active state.",
        tickEvidence
          ? `Indexed ticks failed validation. Capacity uses ${tickEvidence.tickCount} initialized ticks from all ${tickEvidence.bitmapWords} RPC bitmap words covering spot and the modeled ranges, at the same block. Ticks outside this window were not audited.`
          : "Graph ticks reconcile at spot but are not independently audited against every RPC bitmap word.",
        "Token symbols do not verify issuers. Token risk, redemption rights and wallet inventory need separate review.",
        "Capacity is a present-state constraint; future competition and prices may change.",
        location === "waiting"
          ? "This range is outside the current price and earns no swap fees until price enters it."
          : "Swap fees accrue only while price remains inside the range.",
        "USD references are marks, not guaranteed swap proceeds.",
      ],
    },
  };
  report.id = digest(report);
  return report;
}

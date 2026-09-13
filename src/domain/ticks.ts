import { createHash } from "node:crypto";
import type { TickEvidence } from "./types";

export const MIN_TICK = -887272,
  MAX_TICK = 887272;
const MAX_UINT128 = (1n << 128n) - 1n,
  MIN_INT128 = -(1n << 127n),
  MAX_INT128 = (1n << 127n) - 1n;
export interface TickRow {
  tickIdx: string;
  liquidityNet: string;
  liquidityGross: string;
}
export interface TickWindow {
  lower: number;
  upper: number;
}
export class TickDataError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly tick?: number,
  ) {
    super(message);
    this.name = "TickDataError";
  }
}
const fail = (code: string, message: string, tick?: number): never => {
  throw new TickDataError(code, message, tick);
};
export function validateTickRows(rows: readonly TickRow[], spacing: number) {
  if (!Number.isSafeInteger(spacing) || spacing <= 0)
    fail("spacing", "Invalid tick spacing.");
  let previous = MIN_TICK - 1;
  for (const row of rows) {
    const tick = Number(row.tickIdx);
    if (
      !/^-?\d+$/.test(row.tickIdx) ||
      !Number.isSafeInteger(tick) ||
      tick < MIN_TICK ||
      tick > MAX_TICK
    )
      fail(
        "bounds",
        `Initialized tick ${row.tickIdx} is outside protocol bounds.`,
        tick,
      );
    if (tick <= previous)
      fail(
        "ordering",
        `Initialized ticks are duplicated or out of order at ${tick}.`,
        tick,
      );
    if (tick % spacing !== 0)
      fail(
        "alignment",
        `Initialized tick ${tick} is not aligned to spacing ${spacing}.`,
        tick,
      );
    if (!/^-?\d+$/.test(row.liquidityNet) || !/^\d+$/.test(row.liquidityGross))
      fail("integer", `Invalid liquidity encoding at tick ${tick}.`, tick);
    const net = BigInt(row.liquidityNet),
      gross = BigInt(row.liquidityGross);
    if (
      gross <= 0n ||
      gross > MAX_UINT128 ||
      net < MIN_INT128 ||
      net > MAX_INT128
    )
      fail(
        "liquidity-bounds",
        `Initialized tick ${tick} has liquidity outside its contract type bounds.`,
        tick,
      );
    if ((net < 0n ? -net : net) > gross)
      fail(
        "net-gross",
        `Initialized tick ${tick} has |net liquidity| greater than gross liquidity.`,
        tick,
      );
    previous = tick;
  }
}
function checkActive(value: bigint, tick: number) {
  if (value < 0n || value > MAX_UINT128)
    fail(
      "active-liquidity",
      `Reconstructed liquidity is outside uint128 bounds at tick ${tick}.`,
      tick,
    );
}

/** Full indexed distribution: zero at both extremes and equal to canonical active liquidity. */
export function validateFullTicks(
  rows: readonly TickRow[],
  spacing: number,
  spotTick: number,
  spotLiquidity: bigint,
) {
  validateTickRows(rows, spacing);
  checkActive(spotLiquidity, spotTick);
  let active = 0n,
    atSpot = 0n;
  for (const row of rows) {
    const tick = Number(row.tickIdx);
    active += BigInt(row.liquidityNet);
    checkActive(active, tick);
    if (tick <= spotTick) atSpot = active;
  }
  if (active !== 0n)
    fail(
      "terminal-sum",
      "Graph tick distribution has a nonzero terminal liquidity sum.",
    );
  if (atSpot !== spotLiquidity)
    fail(
      "spot-mismatch",
      "Graph tick distribution does not reconcile with RPC active liquidity.",
    );
}

/**
 * Capacity depends on complete ticks between spot and both range edges, not on
 * remote ticks. The RPC window is anchored to canonical slot0/liquidity.
 * No synthetic boundary ticks or guessed liquidity are introduced.
 */
export function minimumRangeLiquidity(
  rows: readonly TickRow[],
  spacing: number,
  spotTick: number,
  spotLiquidity: bigint,
  lower: number,
  upper: number,
  scope?: TickWindow,
): bigint {
  if (
    !Number.isSafeInteger(spotTick) ||
    spotTick < MIN_TICK ||
    spotTick > MAX_TICK ||
    !Number.isSafeInteger(lower) ||
    !Number.isSafeInteger(upper) ||
    lower >= upper ||
    lower < MIN_TICK ||
    upper > MAX_TICK ||
    lower % spacing ||
    upper % spacing
  )
    fail("range", "Invalid spot tick or position boundaries.");
  if (!scope) validateFullTicks(rows, spacing, spotTick, spotLiquidity);
  else {
    validateTickRows(rows, spacing);
    checkActive(spotLiquidity, spotTick);
    if (
      !Number.isSafeInteger(scope.lower) ||
      !Number.isSafeInteger(scope.upper) ||
      scope.lower > Math.min(lower, spotTick) ||
      scope.upper < Math.max(upper, spotTick) ||
      scope.lower < MIN_TICK ||
      scope.upper > MAX_TICK
    )
      fail(
        "coverage",
        "RPC tick window does not cover spot and the complete requested range.",
      );
    if (
      rows.some(
        (row) =>
          Number(row.tickIdx) < scope.lower ||
          Number(row.tickIdx) > scope.upper,
      )
    )
      fail("coverage", "A tick lies outside the declared RPC window.");
    let active = spotLiquidity;
    for (const row of rows)
      if (Number(row.tickIdx) > scope.lower && Number(row.tickIdx) <= spotTick)
        active -= BigInt(row.liquidityNet);
    checkActive(active, scope.lower);
    for (const row of rows)
      if (Number(row.tickIdx) > scope.lower) {
        active += BigInt(row.liquidityNet);
        checkActive(active, Number(row.tickIdx));
      }
  }
  let active = spotLiquidity;
  for (const row of rows) {
    const tick = Number(row.tickIdx),
      net = BigInt(row.liquidityNet);
    if (lower < spotTick && tick > lower && tick <= spotTick) active -= net;
    else if (lower > spotTick && tick > spotTick && tick <= lower)
      active += net;
  }
  checkActive(active, lower);
  let minimum = active;
  for (const row of rows) {
    const tick = Number(row.tickIdx);
    if (tick > lower && tick < upper) {
      active += BigInt(row.liquidityNet);
      checkActive(active, tick);
      if (active < minimum) minimum = active;
    }
  }
  return minimum;
}

/** Superset of every currently supported fee/conversion range, for safe snapshot reuse. */
export function supportedTickWindow(
  spotTick: number,
  spacing: number,
  historicalTicks: readonly number[],
): TickWindow {
  if (
    !Number.isSafeInteger(spotTick) ||
    spotTick < MIN_TICK ||
    spotTick > MAX_TICK ||
    !Number.isSafeInteger(spacing) ||
    spacing <= 0
  )
    fail("range", "Invalid spot tick or spacing for an RPC window.");
  if (
    !historicalTicks.length ||
    historicalTicks.some(
      (t) => !Number.isSafeInteger(t) || t < MIN_TICK || t > MAX_TICK,
    )
  )
    fail("history", "Historical ticks are missing or outside protocol bounds.");
  const sorted = [...historicalTicks].sort((a, b) => a - b);
  const feeLower =
    Math.floor(sorted[Math.floor((sorted.length - 1) * 0.1)] / spacing) *
    spacing;
  const feeUpper = Math.max(
    Math.ceil(sorted[Math.floor((sorted.length - 1) * 0.9)] / spacing) *
      spacing,
    feeLower + 2 * spacing,
  );
  // Maximum input discount is 1,000 bps; the lower edge uses 1.5× discount.
  const buyUpper =
    Math.floor((spotTick + Math.log(0.9) / Math.log(1.0001)) / spacing) *
    spacing;
  const buyLower = Math.min(
    Math.floor((spotTick + Math.log(0.85) / Math.log(1.0001)) / spacing) *
      spacing,
    buyUpper - 2 * spacing,
  );
  return {
    lower: Math.max(MIN_TICK, Math.min(spotTick, feeLower, buyLower)),
    upper: Math.min(MAX_TICK, Math.max(spotTick, feeUpper)),
  };
}
export function bitmapWords(scope: TickWindow, spacing: number): number[] {
  if (
    !Number.isSafeInteger(spacing) ||
    spacing <= 0 ||
    !Number.isSafeInteger(scope.lower) ||
    !Number.isSafeInteger(scope.upper) ||
    scope.lower > scope.upper ||
    scope.lower < MIN_TICK ||
    scope.upper > MAX_TICK
  )
    fail("bitmap-bounds", "Invalid bitmap window or tick spacing.");
  const first = Math.floor(Math.floor(scope.lower / spacing) / 256),
    last = Math.floor(Math.floor(scope.upper / spacing) / 256);
  if (
    !Number.isSafeInteger(first) ||
    !Number.isSafeInteger(last) ||
    first > last ||
    first < -32768 ||
    last > 32767
  )
    fail("bitmap-bounds", "Invalid bitmap word interval.");
  if (last - first + 1 > 128)
    fail(
      "bitmap-budget",
      "The requested range exceeds the 128-word RPC tick budget.",
    );
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}
export interface RpcTickReader {
  bitmaps(
    words: readonly number[],
    blockNumber: bigint,
  ): Promise<readonly bigint[]>;
  ticks(
    indices: readonly number[],
    blockNumber: bigint,
  ): Promise<
    readonly {
      liquidityGross: bigint;
      liquidityNet: bigint;
      initialized: boolean;
    }[]
  >;
}
export async function readRpcTickWindow(
  reader: RpcTickReader,
  args: {
    pool: string;
    blockNumber: number;
    blockHash: string;
    spacing: number;
    scope: TickWindow;
    reason: string;
    graphTickCount: number;
    signal?: AbortSignal;
  },
): Promise<{ ticks: TickRow[]; evidence: TickEvidence }> {
  const words = bitmapWords(args.scope, args.spacing),
    values: bigint[] = [],
    indices: number[] = [];
  const block = BigInt(args.blockNumber);
  for (let offset = 0; offset < words.length; offset += 64) {
    args.signal?.throwIfAborted();
    const batch = words.slice(offset, offset + 64),
      response = await reader.bitmaps(batch, block);
    if (response.length !== batch.length)
      fail("bitmap-missing", "RPC returned an incomplete bitmap batch.");
    for (const value of response) {
      if (typeof value !== "bigint" || value < 0n || value >= 1n << 256n)
        fail("bitmap-value", "RPC returned an invalid tick bitmap.");
      values.push(value);
    }
  }
  words.forEach((word, i) => {
    for (let bit = 0; bit < 256; bit++)
      if ((values[i] & (1n << BigInt(bit))) !== 0n) {
        const tick = (word * 256 + bit) * args.spacing;
        if (tick < MIN_TICK || tick > MAX_TICK)
          fail(
            "bitmap-tick",
            "RPC bitmap contains an out-of-bounds initialized tick.",
            tick,
          );
        if (tick >= args.scope.lower && tick <= args.scope.upper)
          indices.push(tick);
      }
  });
  if (indices.length > 5000)
    fail(
      "tick-budget",
      "The requested range exceeds the 5,000-tick RPC budget.",
    );
  const ticks: TickRow[] = [];
  for (let offset = 0; offset < indices.length; offset += 64) {
    args.signal?.throwIfAborted();
    const batch = indices.slice(offset, offset + 64),
      response = await reader.ticks(batch, block);
    if (response.length !== batch.length)
      fail(
        "ticks-missing",
        "RPC returned an incomplete initialized-tick batch.",
      );
    response.forEach((row, i) => {
      if (!row.initialized)
        fail(
          "bitmap-mismatch",
          `RPC bitmap and tick ${batch[i]} disagree on initialization.`,
          batch[i],
        );
      ticks.push({
        tickIdx: String(batch[i]),
        liquidityGross: String(row.liquidityGross),
        liquidityNet: String(row.liquidityNet),
      });
    });
  }
  validateTickRows(ticks, args.spacing);
  const hash = (v: unknown) =>
    createHash("sha256").update(JSON.stringify(v)).digest("hex");
  return {
    ticks,
    evidence: {
      provider: "RPC",
      scope: "range-and-spot",
      poolAddress: args.pool,
      lowerTick: args.scope.lower,
      upperTick: args.scope.upper,
      bitmapWords: words.length,
      tickCount: ticks.length,
      graphTickCount: args.graphTickCount,
      reason: args.reason,
      blockNumber: args.blockNumber,
      blockHash: args.blockHash,
      queryHash: hash({
        pool: args.pool,
        blockNumber: args.blockNumber,
        blockHash: args.blockHash,
        words,
        indices,
      }),
      responseHash: hash({ bitmaps: values.map(String), ticks }),
    },
  };
}

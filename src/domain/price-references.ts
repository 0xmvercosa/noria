import { z } from "zod";
import {
  classifyPriceMark,
  formatPriceMarkDiagnostic,
  type PriceMarkResult,
} from "./price-mark";
import type { Snapshot } from "./analysis-data";

// Validate and assemble supplied quotes without fetching or renewing them.
export function validatePriceMarks(
  raw: unknown,
  tokenKeys: readonly [string, string],
  nativeKey: string,
  now = Math.floor(Date.now() / 1000),
): Snapshot["prices"] {
  const data = z.object({ coins: z.record(z.unknown()) }).parse(raw);
  return assemblePriceMarks(
    new Map(
      [...tokenKeys, nativeKey].map((key) => [
        key,
        { ...classifyPriceMark(data.coins[key], now), provider: "DeFiLlama" },
      ]),
    ),
    tokenKeys,
    nativeKey,
  );
}
export function assemblePriceMarks(
  marks: Map<string, PriceMarkResult>,
  tokenKeys: readonly [string, string],
  nativeKey: string,
): Snapshot["prices"] {
  const p = [...tokenKeys, nativeKey].map((key) => {
    const mark = marks.get(key) ?? {
      status: "invalid" as const,
      code: "missing" as const,
      provider: "DeFiLlama",
    };
    if (mark.status !== "valid")
      throw new Error(
        `${mark.provider ?? "Price provider"} — ${formatPriceMarkDiagnostic(key === nativeKey ? `Gas reference (${key})` : key, mark)}`,
      );
    return mark;
  });
  const roles = ["token0", "token1", "gas"] as const,
    keys = [...tokenKeys, nativeKey];
  return {
    usd: [p[0].price, p[1].price],
    nativeUsd: p[2].price,
    timestamp: Math.min(...p.map((x) => x.timestamp)),
    source: [...new Set(p.map((mark) => mark.provider ?? "Unknown"))].join(
      " + ",
    ),
    references: p.map((mark, i) => ({
      role: roles[i],
      key: keys[i],
      usd: mark.price,
      timestamp: mark.timestamp,
      confidence: mark.confidence,
      provider: mark.provider,
    })),
  };
}

// Operational consistency guard for informative valuations, not a validated
// accuracy bound or an independent USD oracle. Symmetric under token inversion.
export const PRICE_RATIO_MAX_DEVIATION_PERCENT = 2;
export function verifyReferenceRatio(
  poolRatio: number,
  usd: readonly [number, number],
) {
  const referenceRatio = usd[0] / usd[1];
  if (
    [poolRatio, referenceRatio, ...usd].some(
      (p) => !Number.isFinite(p) || p <= 0,
    )
  )
    throw new Error(
      "USD references cannot be compared with the pool's relative price.",
    );
  const deviationPercent =
    (Math.max(poolRatio / referenceRatio, referenceRatio / poolRatio) - 1) *
    100;
  if (
    !Number.isFinite(deviationPercent) ||
    deviationPercent > PRICE_RATIO_MAX_DEVIATION_PERCENT + 1e-10
  )
    throw new Error(
      `USD reference ratio differs from the Graph/RPC pool price by ${deviationPercent.toFixed(2)}%; the informational consistency limit is ${PRICE_RATIO_MAX_DEVIATION_PERCENT}%.`,
    );
  return {
    poolRatio,
    referenceRatio,
    deviationPercent,
    maxDeviationPercent: PRICE_RATIO_MAX_DEVIATION_PERCENT,
  };
}

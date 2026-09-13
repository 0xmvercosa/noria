import Decimal from "decimal.js";
import { z } from "zod";
import type { LiveReport } from "./types";
import {
  PRICE_MARK_FRESH_AGE_SECONDS,
  PRICE_MARK_MAX_AGE_SECONDS,
} from "./price-mark";

const Money = Decimal.clone({
  precision: 110,
  rounding: Decimal.ROUND_HALF_UP,
});
const decimal = /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i;
export const UsdReferenceSchema = z.object({
  usd: z
    .string()
    .max(100)
    .regex(decimal)
    .refine((v) => {
      if (!decimal.test(v) || v.length > 100) return false;
      const price = new Money(v);
      return price.isFinite() && price.gt(0);
    }),
  timestamp: z.number().int().positive().max(8_640_000_000_000),
  provider: z.string().min(1).max(100),
});
export type UsdReference = z.infer<typeof UsdReferenceSchema>;
export const EthUsdResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), reference: UsdReferenceSchema }),
  z.object({ status: z.literal("unavailable") }),
]);
export type EthUsdResponse = z.infer<typeof EthUsdResponseSchema>;

export function ethUsdFreshness(
  reference: UsdReference | null,
  nowSeconds: number,
) {
  if (!reference || !UsdReferenceSchema.safeParse(reference).success)
    return "unavailable";
  const age = nowSeconds - reference.timestamp;
  if (age < 0 || age > PRICE_MARK_MAX_AGE_SECONDS) return "unavailable";
  return age > PRICE_MARK_FRESH_AGE_SECONDS ? "aged" : "fresh";
}

/** Display only: neither ETH amounts nor transaction values pass through Number. */
export function ethUsdValue(
  amount: string,
  reference: UsdReference | null,
): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(amount) || amount.length > 100) return null;
  const eth = new Money(amount);
  if (eth.isZero()) return "$0.00";
  if (!reference || !UsdReferenceSchema.safeParse(reference).success)
    return null;
  const [whole, cents] = eth.mul(reference.usd).toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents}`;
}

export function ethUsdSuffix(
  amount: string,
  reference: UsdReference | null,
  loading = false,
) {
  const value = ethUsdValue(amount, reference);
  return value
    ? `(${value})`
    : loading
      ? "(USD loading…)"
      : "(USD unavailable)";
}

/** Retain the exact token's recorded price and timestamp, never today's ETH mark. */
export function usdReferenceFromReport(
  report: LiveReport,
  tokenAddress: string,
): UsdReference | null {
  const address = tokenAddress.toLowerCase();
  const role =
    address === report.pool.token0Address.toLowerCase()
      ? "token0"
      : address === report.pool.token1Address.toLowerCase()
        ? "token1"
        : null;
  if (!role) return null;
  const quote = report.priceReferences?.quotes.find((q) => q.role === role);
  const reference = {
    usd: String(
      quote?.usd ??
        (role === "token0" ? report.pool.token0Usd : report.pool.token1Usd),
    ),
    timestamp: quote?.timestamp ?? report.pool.priceTimestamp,
    provider:
      quote?.provider ?? report.priceReferences?.provider ?? "Recorded report",
  };
  const parsed = UsdReferenceSchema.safeParse(reference);
  return parsed.success ? parsed.data : null;
}

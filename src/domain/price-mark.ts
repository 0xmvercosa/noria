/** References older than five minutes require a visible aged-reference warning. */
export const PRICE_MARK_FRESH_AGE_SECONDS = 300;
/**
 * Fifteen minutes is an operational cutoff for informational analysis only.
 * Acceptance within this window does not guarantee price accuracy or executability.
 */
export const PRICE_MARK_MAX_AGE_SECONDS = 900;
export const PRICE_MARK_MIN_CONFIDENCE = 0.8;

export type PriceMarkInvalidCode =
  | "missing"
  | "invalid-price"
  | "missing-confidence"
  | "invalid-confidence"
  | "low-confidence"
  | "invalid-timestamp"
  | "future"
  | "stale";

export interface PriceMarkDiagnostics {
  provider?: string;
  /** The provider's numeric field, not a statistical probability of correctness. */
  confidence?: number;
  timestamp?: number;
  /** Negative only when the provider timestamp is in the future. */
  ageSeconds?: number;
}

export type PriceMarkResult =
  | {
      status: "valid";
      freshness: "fresh" | "aged";
      price: number;
      confidence: number | null;
      provider?: string;
      timestamp: number;
      ageSeconds: number;
    }
  | ({ status: "invalid"; code: PriceMarkInvalidCode } & PriceMarkDiagnostics);

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positiveTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Classifies one raw DeFiLlama coin entry, without coercion, network access or fallback.
 * The first failed check determines the code; available age/confidence data remain
 * attached so a low-confidence entry can also reveal an old timestamp.
 * Valid references retain their original timestamp and become aged after 300s;
 * the 900s informational cutoff does not make them current market quotes.
 */
export function classifyPriceMark(
  raw: unknown,
  nowSeconds: number,
): PriceMarkResult {
  if (!positiveTimestamp(nowSeconds)) {
    throw new RangeError(
      "nowSeconds must be a positive safe integer Unix timestamp.",
    );
  }
  if (raw === undefined || raw === null)
    return { status: "invalid", code: "missing" };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { status: "invalid", code: "invalid-price" };
  }

  const mark = raw as Record<string, unknown>;
  const diagnostics: PriceMarkDiagnostics = {};
  if (finiteNumber(mark.confidence)) diagnostics.confidence = mark.confidence;
  if (positiveTimestamp(mark.timestamp)) {
    diagnostics.timestamp = mark.timestamp;
    diagnostics.ageSeconds = nowSeconds - mark.timestamp;
  }
  const invalid = (code: PriceMarkInvalidCode): PriceMarkResult => ({
    status: "invalid",
    code,
    ...diagnostics,
  });

  if (!finiteNumber(mark.price) || mark.price <= 0)
    return invalid("invalid-price");
  if (mark.confidence === undefined || mark.confidence === null)
    return invalid("missing-confidence");
  if (
    !finiteNumber(mark.confidence) ||
    mark.confidence < 0 ||
    mark.confidence > 1
  ) {
    return invalid("invalid-confidence");
  }
  if (mark.confidence < PRICE_MARK_MIN_CONFIDENCE)
    return invalid("low-confidence");
  if (!positiveTimestamp(mark.timestamp)) return invalid("invalid-timestamp");

  const ageSeconds = nowSeconds - mark.timestamp;
  if (ageSeconds < 0) return invalid("future");
  if (ageSeconds > PRICE_MARK_MAX_AGE_SECONDS) return invalid("stale");
  return {
    status: "valid",
    freshness: ageSeconds <= PRICE_MARK_FRESH_AGE_SECONDS ? "fresh" : "aged",
    price: mark.price,
    confidence: mark.confidence,
    timestamp: mark.timestamp,
    ageSeconds,
  };
}

const INVALID_REASON: Record<PriceMarkInvalidCode, string> = {
  missing: "price reference missing",
  "invalid-price": "price must be a finite number greater than zero",
  "missing-confidence": "provider confidence missing",
  "invalid-confidence":
    "provider confidence must be a finite number from 0 to 1",
  "low-confidence": `provider confidence below ${PRICE_MARK_MIN_CONFIDENCE}`,
  "invalid-timestamp": "price timestamp must be a positive safe integer",
  future: "price timestamp is in the future",
  stale: `price older than the ${PRICE_MARK_MAX_AGE_SECONDS}s informational limit`,
};

/** Short evidence-based copy; provider confidence is never presented as a probability. */
export function formatPriceMarkDiagnostic(
  symbol: string,
  result: PriceMarkResult,
): string {
  const context: string[] = [];
  if (result.ageSeconds !== undefined) {
    context.push(
      result.ageSeconds < 0
        ? `timestamp ${-result.ageSeconds}s ahead`
        : `age ${result.ageSeconds}s`,
    );
  }
  if (typeof result.confidence === "number")
    context.push(`provider confidence ${result.confidence}`);
  const reason =
    result.status === "valid"
      ? result.freshness === "aged"
        ? "aged price reference for informational analysis"
        : "price reference accepted"
      : INVALID_REASON[result.code];
  return `${symbol.trim() || "Token"}: ${reason}${context.length ? ` (${context.join("; ")})` : ""}.`;
}

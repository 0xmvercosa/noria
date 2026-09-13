import {
  classifyPriceMark,
  PRICE_MARK_FRESH_AGE_SECONDS,
  PRICE_MARK_MAX_AGE_SECONDS,
  type PriceMarkResult,
} from "../domain/price-mark";

const platforms: Record<string, string> = {
  ethereum: "ethereum",
  base: "base",
  arbitrum: "arbitrum-one",
  unichain: "unichain",
};

/** CoinGecko supplies a source timestamp, but no comparable confidence field. */
export function classifyCoinGeckoMark(
  raw: unknown,
  now: number,
): PriceMarkResult {
  if (!Number.isSafeInteger(now) || now <= 0)
    throw new RangeError("Invalid price assessment time.");
  const provider = "CoinGecko";
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return { status: "invalid", code: "missing", provider };
  const { usd, last_updated_at: timestamp } = raw as Record<string, unknown>;
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0)
    return { status: "invalid", code: "invalid-price", provider };
  if (
    typeof timestamp !== "number" ||
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0
  )
    return { status: "invalid", code: "invalid-timestamp", provider };
  const ageSeconds = now - timestamp;
  if (ageSeconds < 0)
    return {
      status: "invalid",
      code: "future",
      provider,
      timestamp,
      ageSeconds,
    };
  if (ageSeconds > PRICE_MARK_MAX_AGE_SECONDS)
    return {
      status: "invalid",
      code: "stale",
      provider,
      timestamp,
      ageSeconds,
    };
  return {
    status: "valid",
    provider,
    price: usd,
    timestamp,
    ageSeconds,
    confidence: null,
    freshness: ageSeconds > PRICE_MARK_FRESH_AGE_SECONDS ? "aged" : "fresh",
  };
}

/** Bounded, sequential fallback with original quote timestamps and exact contracts. */
export function createPriceReader(
  runtime: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const request = runtime.fetch ?? fetch,
    now = runtime.now ?? (() => Math.floor(Date.now() / 1000));
  const cache = new Map<string, { saved: number; raw: unknown }>();
  let queue: Promise<unknown> = Promise.resolve(),
    calls: number[] = [],
    blockedUntil = 0;
  function fallback(key: string): Promise<PriceMarkResult | undefined> {
    const operation = queue.then(async () => {
      const at = now(),
        cached = cache.get(key);
      if (cached && at - cached.saved < 60)
        return classifyCoinGeckoMark(cached.raw, at);
      calls = calls.filter((t) => at - t < 60);
      if (at < blockedUntil || calls.length >= 8) return undefined;
      const [chain, id] = key.split(":"),
        platform = platforms[chain];
      if (
        !(chain === "coingecko" && id === "ethereum") &&
        (!platform || !/^0x[\da-f]{40}$/.test(id))
      )
        return undefined;
      const url = new URL(
        chain === "coingecko"
          ? "https://api.coingecko.com/api/v3/simple/price"
          : `https://api.coingecko.com/api/v3/simple/token_price/${platform}`,
      );
      url.searchParams.set(
        chain === "coingecko" ? "ids" : "contract_addresses",
        id,
      );
      url.searchParams.set("vs_currencies", "usd");
      url.searchParams.set("include_last_updated_at", "true");
      calls.push(at);
      try {
        const response = await request(url, {
          signal: AbortSignal.timeout(8000),
          cache: "no-store",
        });
        if (response.status === 429) {
          const retry = Number(response.headers.get("retry-after"));
          blockedUntil =
            now() +
            Math.max(60, Math.min(Number.isFinite(retry) ? retry : 60, 300));
          return undefined;
        }
        if (!response.ok) return undefined;
        const data = await response.json(),
          raw = data?.[id];
        cache.set(key, { saved: now(), raw });
        if (cache.size > 100) cache.delete(cache.keys().next().value!);
        return classifyCoinGeckoMark(raw, now());
      } catch {
        return undefined;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return async function readPrices(
    keys: readonly string[],
  ): Promise<Map<string, PriceMarkResult>> {
    const unique = [...new Set(keys)],
      marks = new Map<string, PriceMarkResult>();
    for (let offset = 0; offset < unique.length; offset += 45) {
      const batch = unique.slice(offset, offset + 45);
      let coins: Record<string, unknown> = {};
      try {
        const response = await request(
          `https://coins.llama.fi/prices/current/${batch.join(",")}`,
          { signal: AbortSignal.timeout(12000), cache: "no-store" },
        );
        if (response.ok) {
          const raw = await response.json();
          if (
            raw?.coins &&
            typeof raw.coins === "object" &&
            !Array.isArray(raw.coins)
          )
            coins = raw.coins;
        }
      } catch {
        /* Exact-contract fallbacks below; no stale quote is silently renewed. */
      }
      for (const key of batch) {
        const primary: PriceMarkResult = {
          ...classifyPriceMark(coins[key], now()),
          provider: "DeFiLlama",
        };
        // An explicit low-confidence or malformed primary is not overridden.
        const alternate =
          primary.status === "invalid" &&
          (primary.code === "missing" || primary.code === "stale")
            ? await fallback(key)
            : undefined;
        marks.set(key, alternate?.status === "valid" ? alternate : primary);
      }
    }
    // A long collection cannot preserve the earlier validity of a quote.
    for (const [key, mark] of marks)
      if (mark.status === "valid") {
        const ageSeconds = now() - mark.timestamp;
        marks.set(
          key,
          ageSeconds > PRICE_MARK_MAX_AGE_SECONDS
            ? {
                status: "invalid",
                code: "stale",
                provider: mark.provider,
                timestamp: mark.timestamp,
                ageSeconds,
                ...(typeof mark.confidence === "number"
                  ? { confidence: mark.confidence }
                  : {}),
              }
            : {
                ...mark,
                ageSeconds,
                freshness:
                  ageSeconds > PRICE_MARK_FRESH_AGE_SECONDS ? "aged" : "fresh",
              },
        );
      }
    return marks;
  };
}
export const readPriceMarks = createPriceReader();

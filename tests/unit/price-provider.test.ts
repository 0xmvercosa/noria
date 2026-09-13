import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCoinGeckoMark,
  createPriceReader,
} from "../../src/providers/prices";
import { assemblePriceMarks } from "../../src/services/analysis";

const at = 1789242000,
  address = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  key = `arbitrum:${address}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });

test("CoinGecko preserves last_updated_at and explicitly has no confidence score", () => {
  const mark = classifyCoinGeckoMark(
    { usd: 2500, last_updated_at: at - 329 },
    at,
  );
  assert.equal(mark.status, "valid");
  if (mark.status !== "valid") return;
  assert.equal(mark.confidence, null);
  assert.equal(mark.provider, "CoinGecko");
  assert.equal(mark.timestamp, at - 329);
  assert.equal(mark.ageSeconds, 329);
  assert.equal(mark.freshness, "aged");
  for (const raw of [
    undefined,
    {},
    { usd: 1 },
    { usd: 1, last_updated_at: at + 1 },
    { usd: 1, last_updated_at: at - 901 },
    { usd: 1, last_updated_at: "1789241900" },
    { usd: Infinity, last_updated_at: at },
    { usd: 0, last_updated_at: at },
  ])
    assert.equal(classifyCoinGeckoMark(raw, at).status, "invalid");
  assert.equal(
    classifyCoinGeckoMark({ usd: 1, last_updated_at: at - 900 }, at).status,
    "valid",
  );
});

test("valid DeFiLlama quotes use no fallback request", async () => {
  const urls: string[] = [];
  const read = createPriceReader({
    now: () => at,
    fetch: async (input) => {
      urls.push(String(input));
      return json({
        coins: { [key]: { price: 2500, timestamp: at - 10, confidence: 0.99 } },
      });
    },
  });
  const marks = await read([key, key]);
  assert.equal(urls.length, 1);
  assert.equal(marks.get(key)?.provider, "DeFiLlama");
});

test("stale primary falls back by exact contract on the correct platform and caches without renewing timestamps", async () => {
  let now = at;
  const urls: URL[] = [];
  const read = createPriceReader({
    now: () => now,
    fetch: async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return url.hostname === "coins.llama.fi"
        ? json({
            coins: {
              [key]: { price: 2400, timestamp: at - 1000, confidence: 0.99 },
            },
          })
        : json({ [address]: { usd: 2500, last_updated_at: at - 890 } });
    },
  });
  const first = await read([key]);
  assert.equal(first.get(key)?.provider, "CoinGecko");
  assert.equal(urls[1].pathname, "/api/v3/simple/token_price/arbitrum-one");
  assert.equal(urls[1].searchParams.get("contract_addresses"), address);
  assert.equal(urls[1].searchParams.get("include_last_updated_at"), "true");
  now += 20;
  const second = await read([key]);
  assert.equal(second.get(key)?.status, "invalid");
  assert.equal(
    urls.filter((u) => u.hostname === "api.coingecko.com").length,
    1,
  );
});

test("fallback cannot bypass explicit low confidence or malformed primary prices", async () => {
  let count = 0;
  const read = createPriceReader({
    now: () => at,
    fetch: async () => {
      count++;
      return json({
        coins: { [key]: { price: 2500, timestamp: at - 10, confidence: 0.5 } },
      });
    },
  });
  const mark = (await read([key])).get(key)!;
  assert.equal(count, 1);
  assert.equal(mark.status, "invalid");
  if (mark.status === "invalid") assert.equal(mark.code, "low-confidence");
});

test("provider failure still permits an exact-contract quote; absent/future fallback never fabricates a dollar price", async () => {
  for (const raw of [
    undefined,
    { usd: 1, last_updated_at: at + 1 },
    { usd: 1 },
    { usd: 1, last_updated_at: at - 901 },
  ]) {
    const read = createPriceReader({
      now: () => at,
      fetch: async (input) =>
        String(input).includes("coins.llama.fi")
          ? json({}, 503)
          : json({ [address]: raw }),
    });
    assert.equal((await read([key])).get(key)?.status, "invalid");
  }
  const read = createPriceReader({
    now: () => at,
    fetch: async (input) =>
      String(input).includes("coins.llama.fi")
        ? json({}, 503)
        : json({ [address]: { usd: 0.982, last_updated_at: at - 10 } }),
  });
  const mark = (await read([key])).get(key)!;
  assert.equal(mark.status, "valid");
  if (mark.status === "valid") assert.equal(mark.price, 0.982);
});

test("CoinGecko calls are sequential, deduplicated and capped at eight per minute", async () => {
  let active = 0,
    maxActive = 0,
    calls = 0;
  const keys = Array.from(
    { length: 10 },
    (_, i) => `arbitrum:0x${(i + 1).toString(16).padStart(40, "0")}`,
  );
  const read = createPriceReader({
    now: () => at,
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "coins.llama.fi") return json({ coins: {} });
      calls++;
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return json({
        [url.searchParams.get("contract_addresses")!]: {
          usd: 10,
          last_updated_at: at - 10,
        },
      });
    },
  });
  const [one, two] = await Promise.all([read(keys), read(keys)]);
  assert.equal(calls, 8);
  assert.equal(maxActive, 1);
  assert.equal([...one.values()].filter((m) => m.status === "valid").length, 8);
  assert.equal([...two.values()].filter((m) => m.status === "valid").length, 8);
});

test("429 starts a cooldown without retries and the gas asset uses its explicit ID", async () => {
  let now = at,
    calls = 0;
  const requests: URL[] = [];
  const read = createPriceReader({
    now: () => now,
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.hostname === "coins.llama.fi") return json({ coins: {} });
      calls++;
      requests.push(url);
      return calls === 1
        ? new Response("", { status: 429, headers: { "retry-after": "120" } })
        : json({ ethereum: { usd: 2500, last_updated_at: now - 5 } });
    },
  });
  await read([key, "coingecko:ethereum"]);
  assert.equal(calls, 1);
  now += 119;
  await read(["coingecko:ethereum"]);
  assert.equal(calls, 1);
  now++;
  const mark = (await read(["coingecko:ethereum"])).get("coingecko:ethereum")!;
  assert.equal(mark.status, "valid");
  assert.equal(calls, 2);
  assert.equal(requests[1].searchParams.get("ids"), "ethereum");
});

test("mixed providers retain per-quote origin and the oldest source timestamp in reports", async () => {
  const token1 = "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    gas = "coingecko:ethereum";
  const read = createPriceReader({
    now: () => at,
    fetch: async (input) =>
      String(input).includes("coins.llama.fi")
        ? json({
            coins: {
              [token1]: { price: 0.998, timestamp: at - 5, confidence: 0.99 },
              [gas]: { price: 2500, timestamp: at - 5, confidence: 0.99 },
            },
          })
        : json({ [address]: { usd: 2500, last_updated_at: at - 100 } }),
  });
  const prices = assemblePriceMarks(
    await read([key, token1, gas]),
    [key, token1],
    gas,
  );
  assert.equal(prices.source, "CoinGecko + DeFiLlama");
  assert.equal(prices.timestamp, at - 100);
  assert.equal(prices.references![0].confidence, null);
  assert.equal(prices.references![0].provider, "CoinGecko");
});

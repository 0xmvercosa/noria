import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ethUsdValue,
  ethUsdSuffix,
  ethUsdFreshness,
  usdReferenceFromReport,
} from "../../src/domain/eth-usd";
import { createEthUsdReader } from "../../src/providers/eth-usd";
import type { PriceMarkResult } from "../../src/domain/price-mark";
import type { LiveReport } from "../../src/domain/types";

const reference = {
  usd: "2500",
  timestamp: 1_789_300_000,
  provider: "Test reference",
};

test("ETH dollar equivalents retain all input digits and round only the USD display", () => {
  assert.equal(ethUsdValue("0.000398882932576", reference), "$1.00");
  assert.equal(
    ethUsdValue("9007199254740993.000000000000000001", reference),
    "$22,517,998,136,852,482,500.00",
  );
  assert.equal(ethUsdValue("0.000002", reference), "$0.01");
  assert.equal(ethUsdValue("0.000000000000000001", reference), "$0.00");
});

test("missing and invalid prices never become a zero-dollar balance", () => {
  assert.equal(ethUsdSuffix("1", null), "(USD unavailable)");
  assert.equal(ethUsdSuffix("1", null, true), "(USD loading…)");
  assert.equal(ethUsdSuffix("0", null), "($0.00)");
  for (const usd of ["0", "-1", "NaN", "Infinity", "bad"])
    assert.equal(ethUsdValue("1", { ...reference, usd }), null);
  for (const amount of ["", ".", "1,25", "-1", "1e3"])
    assert.equal(ethUsdValue(amount, reference), null);
});

test("quote freshness expires against the original provider timestamp", () => {
  assert.equal(ethUsdFreshness(reference, reference.timestamp + 300), "fresh");
  assert.equal(ethUsdFreshness(reference, reference.timestamp + 301), "aged");
  assert.equal(ethUsdFreshness(reference, reference.timestamp + 900), "aged");
  assert.equal(
    ethUsdFreshness(reference, reference.timestamp + 901),
    "unavailable",
  );
  assert.equal(
    ethUsdFreshness(reference, reference.timestamp - 1),
    "unavailable",
  );
});

test("recorded token valuation uses its own quote and never today's ETH price", () => {
  const fixture = JSON.parse(
    readFileSync("examples/aqua/response.recorded.json", "utf8"),
  );
  const report = fixture.recommendation.report as LiveReport;
  report.priceReferences = {
    ...report.priceReferences!,
    provider: "Mixed",
    quotes: [
      {
        role: "token1",
        key: "fixture",
        symbol: report.pool.token1,
        usd: 1234.567,
        timestamp: 1_700_000_000,
        provider: "Recorded provider",
        confidence: null,
      },
    ],
  };
  assert.deepEqual(
    usdReferenceFromReport(report, report.pool.token1Address.toUpperCase()),
    {
      usd: "1234.567",
      timestamp: 1_700_000_000,
      provider: "Recorded provider",
    },
  );
  assert.equal(
    usdReferenceFromReport(
      report,
      "0x0000000000000000000000000000000000000000",
    ),
    null,
  );
});

test("public ETH reader coalesces requests and never renews a cached quote", async () => {
  let at = reference.timestamp + 850,
    calls = 0;
  const reader = createEthUsdReader({
    now: () => at,
    read: async () => {
      calls++;
      await Promise.resolve();
      return new Map<string, PriceMarkResult>([
        [
          "coingecko:ethereum",
          {
            status: "valid",
            price: 2500,
            timestamp: reference.timestamp,
            provider: reference.provider,
            freshness: "aged",
            confidence: 0.99,
            ageSeconds: 850,
          },
        ],
      ]);
    },
  });
  const [first, second] = await Promise.all([reader(), reader()]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "available");
  assert.equal(calls, 1);
  at = reference.timestamp + 901;
  assert.deepEqual(await reader(), { status: "unavailable" });
  assert.equal(calls, 1);
  at += 10;
  assert.deepEqual(await reader(), { status: "unavailable" });
  assert.equal(calls, 2);
});

test("a price provider failure returns explicit unavailability", async () => {
  const reader = createEthUsdReader({
    read: async () => {
      throw new Error("offline");
    },
  });
  assert.deepEqual(await reader(), { status: "unavailable" });
});

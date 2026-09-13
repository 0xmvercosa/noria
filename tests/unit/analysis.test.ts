import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  buildReport,
  digest,
  validatePriceMarks,
  verifyReferenceRatio,
  type Snapshot,
} from "../../src/services/analysis";
import { bitmapWords, supportedTickWindow } from "../../src/domain/ticks";
import type { AnalyzeInput, HistoricalCase } from "../../src/domain/types";

const stored = JSON.parse(
  readFileSync(
    new URL("../fixtures/graph-snapshot.json", import.meta.url),
    "utf8",
  ),
);
const original: Snapshot = {
  ...stored,
  network: "ethereum",
  tickSpacing: 10,
  prices: { ...stored.prices, nativeUsd: stored.prices.usd[1] },
};
const TOKENS = [original.data.pool.token0.id, original.data.pool.token1.id];
const priceKeys = TOKENS.map((t) => `ethereum:${t}`) as [string, string];
const at = Math.ceil(Date.parse(original.receivedAt) / 1000);
const input: AnalyzeInput = {
  network: "ethereum",
  poolAddress: original.data.pool.id,
  capitalUsd: 1000,
  intent: "buy-token0",
  horizonHours: 6,
  discountBps: 100,
};
const fresh = () => structuredClone(original);

test("a WETH-funded buy waits below spot, conserves its budget, and never claims economic approval", () => {
  const r = buildReport(input, fresh(), at);
  assert.equal(r.position.amount0Raw, "0");
  assert.equal(r.position.location, "waiting");
  assert.ok(r.position.upperPrice < r.pool.relativePrice);
  assert.ok(r.position.deployedUsd <= 1000);
  assert.ok(
    Math.abs(r.position.deployedUsd + r.position.residualUsd - 1000) < 1e-8,
  );
  assert.ok(
    r.position.fullConversionAveragePrice! >= r.position.lowerPrice &&
      r.position.fullConversionAveragePrice! <= r.position.upperPrice * 1.00001,
  );
  assert.equal(r.checks.economics, "not-established");
  assert.equal(r.id, digest({ ...r, id: "" }));
});

test("larger capital consumes capacity instead of inheriting the small position's verdict", () => {
  const small = buildReport(input, fresh(), at),
    large = buildReport({ ...input, capitalUsd: 10000 }, fresh(), at);
  assert.equal(small.checks.construction, "feasible");
  assert.equal(large.checks.construction, "capacity-exceeded");
  assert.equal(large.decision.action, "wait");
  assert.ok(large.position.maxSharePercent > small.position.maxSharePercent);
  assert.ok(
    BigInt(large.position.amount1Raw) > BigInt(small.position.amount1Raw) * 9n,
  );
});

test("intent and desired discount materially change the range", () => {
  const buy = buildReport(input, fresh(), at),
    lower = buildReport({ ...input, discountBps: 200 }, fresh(), at),
    fees = buildReport({ ...input, intent: "earn-fees" }, fresh(), at);
  assert.ok(lower.position.tickUpper < buy.position.tickLower);
  assert.notEqual(fees.position.tickLower, buy.position.tickLower);
  assert.equal(fees.position.fullConversionAmount0, null);
});

test("expired input remains expired; a recent calculation cannot renew its source", () => {
  const r = buildReport(input, fresh(), at + 500);
  assert.equal(r.checks.data, "expired");
  assert.equal(r.decision.action, "wait");
  assert.ok(Date.parse(r.validUntil) < (at + 500) * 1000);
});

test("future data, missing hours and altered liquidity fail closed", () => {
  const future = fresh();
  future.prices.timestamp = at + 10;
  assert.throws(() => buildReport(input, future, at), /available/);
  const missing = fresh();
  missing.data.pool.poolHourData.splice(5, 1);
  assert.throws(() => buildReport(input, missing, at), /incomplete/);
  const corrupt = fresh();
  corrupt.data.ticks[0].liquidityNet = String(
    BigInt(corrupt.data.ticks[0].liquidityNet) + 1n,
  );
  assert.throws(() => buildReport(input, corrupt, at), /liquidity|tick/);
  const duplicate = fresh();
  duplicate.data.ticks.splice(2, 0, duplicate.data.ticks[1]);
  assert.throws(() => buildReport(input, duplicate, at), /tick/);
});

test("unsupported capital and invented approval fields cannot enter the analysis", () => {
  assert.throws(() =>
    buildReport({ ...input, capitalUsd: 1000000 }, fresh(), at),
  );
  assert.throws(() =>
    buildReport({ ...input, forceProfitable: true }, fresh(), at),
  );
  assert.throws(() => buildReport({ ...input, discountBps: -1 }, fresh(), at));
});

test("USD marks must have finite confidence, positive prices and a usable timestamp", () => {
  const marks = () => ({
    coins: Object.fromEntries(
      TOKENS.map((t) => [
        `ethereum:${t}`,
        { price: 100, timestamp: at - 10, confidence: 0.99 },
      ]),
    ),
  });
  assert.deepEqual(
    validatePriceMarks(marks(), priceKeys, priceKeys[1], at).usd,
    [100, 100],
  );
  for (const confidence of [undefined, null, NaN, 0.79, 1.1]) {
    const malformed: any = marks();
    malformed.coins[`ethereum:${TOKENS[0]}`].confidence = confidence;
    assert.throws(() =>
      validatePriceMarks(malformed, priceKeys, priceKeys[1], at),
    );
  }
  for (const timestamp of [at + 1, at - 901]) {
    const invalid = marks();
    invalid.coins[`ethereum:${TOKENS[0]}`].timestamp = timestamp;
    assert.throws(() =>
      validatePriceMarks(invalid, priceKeys, priceKeys[1], at),
    );
  }
});

test("USD mark failures identify provider, contract or gas reference, and the actual failure", () => {
  const nativeKey = "coingecko:ethereum";
  const marks = () => ({
    coins: Object.fromEntries(
      [...priceKeys, nativeKey].map((key) => [
        key,
        { price: 100, timestamp: at - 10, confidence: 0.99 },
      ]),
    ),
  });
  const stale = marks();
  stale.coins[priceKeys[0]].timestamp = at - 901;
  assert.throws(
    () => validatePriceMarks(stale, priceKeys, nativeKey, at),
    (error) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(`DeFiLlama — ${priceKeys[0]}`));
      assert.match(
        error.message,
        /older than the 900s informational limit \(age 901s; provider confidence 0.99\)/,
      );
      return true;
    },
  );
  const missing = marks();
  delete missing.coins[priceKeys[0]];
  assert.throws(
    () => validatePriceMarks(missing, priceKeys, nativeKey, at),
    /price reference missing/,
  );
  const gas = marks();
  gas.coins[nativeKey].confidence = 0.7;
  assert.throws(
    () => validatePriceMarks(gas, priceKeys, nativeKey, at),
    /Gas reference \(coingecko:ethereum\): provider confidence below 0.8/,
  );
});

test("a 329-second reference produces an explicitly aged report and keeps each original quote", () => {
  const snapshot = fresh(),
    nativeKey = "coingecko:ethereum",
    keys = [...priceKeys, nativeKey];
  const raw = {
    coins: Object.fromEntries(
      keys.map((key, i) => [
        key,
        {
          price: i === 0 ? snapshot.prices.usd[0] : snapshot.prices.usd[1],
          timestamp: at - (i === 0 ? 329 : 30),
          confidence: 0.99,
        },
      ]),
    ),
  };
  snapshot.prices = validatePriceMarks(raw, priceKeys, nativeKey, at);
  const report = buildReport(input, snapshot, at),
    marks = report.priceReferences!;
  assert.equal(report.checks.data, "verified");
  assert.equal(marks.freshness, "aged");
  assert.equal(marks.ageSeconds, 329);
  assert.equal(marks.oldestTimestamp, at - 329);
  assert.equal(report.pool.priceTimestamp, at - 329);
  assert.equal(marks.quotes.length, 3);
  assert.deepEqual(
    marks.quotes.map((q) => [q.key, q.timestamp, q.confidence]),
    keys.map((key, i) => [key, at - (i === 0 ? 329 : 30), 0.99]),
  );
  assert.equal(report.pool.token0Usd, raw.coins[priceKeys[0]].price);
  assert.equal(report.pool.token1Usd, raw.coins[priceKeys[1]].price);
  assert.match(report.checks.reasons.join(" "), /USD references are aged/);
  assert.equal(report.checks.economics, "not-established");
  assert.ok(Date.parse(report.validUntil) <= (at - 329 + 900) * 1000);
});

test("reference age is recomputed from source timestamps and caps validity at the 15-minute boundary", () => {
  const snapshot = fresh();
  snapshot.prices.timestamp = at - 899;
  const report = buildReport(input, snapshot, at);
  assert.equal(report.priceReferences!.ageSeconds, 899);
  assert.equal(report.priceReferences!.freshness, "aged");
  assert.equal(Date.parse(report.validUntil), (at + 1) * 1000);
  const later = buildReport(input, snapshot, at + 2);
  assert.equal(later.priceReferences!.ageSeconds, 901);
  assert.equal(later.priceReferences!.oldestTimestamp, at - 899);
  assert.equal(later.checks.data, "expired");
  assert.equal(later.priceReferences!.freshness, "expired");
  assert.equal(later.decision.action, "wait");
});

test("USD-ratio consistency is symmetric and rejects conflicting quotes even when recent", () => {
  assert.equal(verifyReferenceRatio(10, [10, 1]).deviationPercent, 0);
  assert.ok(
    Math.abs(verifyReferenceRatio(10.2, [10, 1]).deviationPercent - 2) < 1e-10,
  );
  for (const poolRatio of [10.201, 10 / 1.0201])
    assert.throws(
      () => verifyReferenceRatio(poolRatio, [10, 1]),
      /consistency limit/,
    );
  const direct = verifyReferenceRatio(30.5, [77000, 2530]),
    inverse = verifyReferenceRatio(1 / 30.5, [2530, 77000]);
  assert.ok(
    Math.abs(direct.deviationPercent - inverse.deviationPercent) < 1e-10,
  );
  for (const invalid of [0, -1, NaN, Infinity])
    assert.throws(() => verifyReferenceRatio(invalid, [10, 1]));
  const corrupt = fresh();
  corrupt.prices.usd[0] *= 1.05;
  assert.throws(
    () => buildReport(input, corrupt, at),
    /USD reference ratio differs/,
  );
});

test("the curated historical example conserves its ledger and separates fees from token exposure", () => {
  const h: HistoricalCase = JSON.parse(
    readFileSync(
      new URL("../../data/examples/historical-case.json", import.meta.url),
      "utf8",
    ),
  );
  for (const source of h.sourceFiles) {
    const bytes = readFileSync(
      new URL(`../../${source.path}`, import.meta.url),
    );
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      source.sha256,
    );
  }
  const ledger = JSON.parse(
    readFileSync(
      new URL("../../data/examples/historical-ledger.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(ledger.classification, "curated-historical-simulation-ledger");
  assert.equal(ledger.caseId, h.id);
  assert.ok(
    Math.abs(
      ledger.lpGrossExitValueUsd -
        ledger.lpExternalCostsUsd -
        ledger.lpNetExitValueUsd,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      ledger.lpNetExitValueUsd -
        ledger.originalHoldNetExitValueUsd -
        h.excessOriginalHoldUsd,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(
      ledger.lpNetExitValueUsd -
        ledger.preparedHoldNetExitValueUsd -
        h.excessPreparedHoldUsd,
    ) < 1e-8,
  );
  assert.ok(
    Math.abs(h.entryWalletUsd + h.pnlUsd - ledger.lpNetExitValueUsd) < 1e-8,
  );
  assert.ok(
    Math.abs(
      h.nominalCapitalUsd + h.pnlFromDecisionUsd - ledger.lpNetExitValueUsd,
    ) < 1e-8,
  );
  assert.equal(h.costsUsd, ledger.lpExternalCostsUsd);
  assert.equal(h.feesUsd, ledger.feesMarkedAtExitUsd);
  assert.ok(h.pnlUsd > h.feesUsd * 50);
  assert.equal(h.classification, "historical-simulation");
});

test("a buy range stays fully below spot across coarse fee spacings", () => {
  for (const [fee, spacing] of [
    [100, 1],
    [500, 10],
    [3000, 60],
    [10000, 200],
  ]) {
    for (const discountBps of [25, 100, 250]) {
      const s = fresh();
      s.tickSpacing = spacing;
      s.data.pool.feeTier = String(fee);
      const liquidity = s.data.pool.liquidity,
        edge = Math.floor(887272 / spacing) * spacing;
      s.data.ticks = [
        {
          tickIdx: String(-edge),
          liquidityNet: liquidity,
          liquidityGross: liquidity,
        },
        {
          tickIdx: String(edge),
          liquidityNet: "-" + liquidity,
          liquidityGross: liquidity,
        },
      ];
      const r = buildReport({ ...input, discountBps }, s, at);
      assert.equal(r.position.amount0Raw, "0");
      assert.equal(r.position.location, "waiting");
      assert.ok(r.position.upperPrice < r.pool.relativePrice);
      assert.ok(
        r.position.fullConversionAveragePrice! >= r.position.lowerPrice &&
          r.position.fullConversionAveragePrice! <=
            r.position.upperPrice * 1.00001,
      );
    }
  }
});

test("a snapshot for another chain or pool is rejected", () => {
  assert.throws(
    () => buildReport({ ...input, network: "base" }, fresh(), at),
    /requested network and pool/,
  );
  assert.throws(
    () =>
      buildReport(
        { ...input, poolAddress: "0x0000000000000000000000000000000000000001" },
        fresh(),
        at,
      ),
    /requested network and pool/,
  );
});

function fixtureWithRpcWindow(): Snapshot {
  // Offline integration fixture: the complete indexed distribution provides
  // the same rows that a canonical bitmap scan would find inside this window.
  // These hashes identify fixture data; this test makes no live RPC request.
  const s = fresh(),
    scope = supportedTickWindow(
      Number(s.data.pool.tick),
      s.tickSpacing,
      s.data.pool.poolHourData.map((h) => Number(h.tick)),
    );
  const graphTickCount = s.data.ticks.length;
  s.data.ticks = s.data.ticks.filter(
    (t) => Number(t.tickIdx) >= scope.lower && Number(t.tickIdx) <= scope.upper,
  );
  s.ticks = {
    provider: "RPC",
    scope: "range-and-spot",
    poolAddress: s.data.pool.id,
    lowerTick: scope.lower,
    upperTick: scope.upper,
    bitmapWords: bitmapWords(scope, s.tickSpacing).length,
    tickCount: s.data.ticks.length,
    graphTickCount,
    reason:
      "Offline fixture: canonical-equivalent window from a validated complete distribution.",
    blockNumber: s.data._meta.block.number,
    blockHash: s.data._meta.block.hash,
    queryHash: digest({
      fixture: true,
      pool: s.data.pool.id,
      block: s.data._meta.block,
      scope,
    }),
    responseHash: digest({ fixture: true, ticks: s.data.ticks }),
  };
  return s;
}

test("full Graph and RPC-window reports preserve positions and checks across every capital, intent, review interval and representative discount", () => {
  const windowed = fixtureWithRpcWindow();
  assert.ok(windowed.data.ticks.length < original.data.ticks.length);
  for (const capitalUsd of [1000, 5000, 10000] as const) {
    for (const intent of ["earn-fees", "buy-token0"] as const) {
      for (const horizonHours of [6, 24] as const) {
        for (const discountBps of [25, 100, 1000]) {
          const settings = {
            ...input,
            capitalUsd,
            intent,
            horizonHours,
            discountBps,
          };
          const full = buildReport(settings, fresh(), at),
            window = buildReport(settings, windowed, at);
          assert.deepEqual(
            window.position,
            full.position,
            JSON.stringify(settings),
          );
          assert.deepEqual(window.checks, full.checks);
          assert.deepEqual(window.pool, full.pool);
          assert.deepEqual(window.costs, full.costs);
          assert.equal(window.decision.action, full.decision.action);
          assert.equal(window.validUntil, full.validUntil);
          assert.deepEqual(window.source.ticks, windowed.ticks);
          assert.equal(window.source.queryHash, full.source.queryHash);
          assert.equal(window.source.responseHash, full.source.responseHash);
          assert.equal(window.source.tickCount, windowed.data.ticks.length);
          assert.equal(
            window.source.ticks!.graphTickCount,
            original.data.ticks.length,
          );
          assert.notEqual(window.id, full.id);
          assert.equal(window.id, digest({ ...window, id: "" }));
        }
      }
    }
  }
});

test("RPC-window report evidence must identify this pool, block and complete tick result", () => {
  for (const mutate of [
    (s: Snapshot) => {
      s.ticks!.poolAddress = "0x0000000000000000000000000000000000000001";
    },
    (s: Snapshot) => {
      s.ticks!.blockNumber += 1;
    },
    (s: Snapshot) => {
      s.ticks!.blockHash = `0x${"00".repeat(32)}`;
    },
    (s: Snapshot) => {
      s.ticks!.tickCount += 1;
    },
  ]) {
    const s = fixtureWithRpcWindow();
    mutate(s);
    assert.throws(
      () => buildReport(input, s, at),
      /RPC tick evidence does not belong/,
    );
  }
  const missingCoverage = fixtureWithRpcWindow();
  missingCoverage.ticks!.lowerTick = Number(missingCoverage.data.pool.tick) + 1;
  assert.throws(
    () => buildReport(input, missingCoverage, at),
    /does not cover spot and the complete requested range/,
  );
  const tooShort = fixtureWithRpcWindow(),
    fees = buildReport({ ...input, intent: "earn-fees" }, fresh(), at);
  tooShort.ticks!.upperTick = fees.position.tickUpper - 1;
  assert.throws(
    () => buildReport({ ...input, intent: "earn-fees" }, tooShort, at),
    /does not cover spot and the complete requested range/,
  );
  const missingEvidence = fixtureWithRpcWindow();
  delete missingEvidence.ticks;
  assert.throws(
    () => buildReport(input, missingEvidence, at),
    /Reconstructed liquidity|terminal liquidity sum|reconcile with RPC/,
  );
});

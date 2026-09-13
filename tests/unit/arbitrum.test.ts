import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildReport,
  HistoryDataError,
  type Snapshot,
} from "../../src/services/analysis";
import { validateFullTicks, TickDataError } from "../../src/domain/ticks";
import type { AnalyzeInput } from "../../src/domain/types";

const read = (file: string) =>
  JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
const evidence = "../fixtures/arbitrum/";

test("the originally reported Arbitrum tick corruption remains invalid", () => {
  const old: Snapshot = read("../fixtures/arbitrum-invalid-ticks.json");
  const impossible = old.data.ticks.filter((row) => {
    const net = BigInt(row.liquidityNet);
    return (net < 0n ? -net : net) > BigInt(row.liquidityGross);
  });
  assert.equal(impossible.length, 83);
  assert.throws(
    () =>
      validateFullTicks(
        old.data.ticks,
        old.tickSpacing,
        Number(old.data.pool.tick),
        BigInt(old.data.pool.liquidity),
      ),
    (error) => error instanceof TickDataError && error.code === "net-gross",
  );
});

test("all 420 captured Arbitrum configurations reproduce capacity, ranges, inventory conservation or explicit history refusal", () => {
  const summary = read(evidence + "summary.json"),
    snapshots = new Map<string, Snapshot>();
  for (const pool of summary.snapshots)
    snapshots.set(pool.address, read(evidence + pool.address + ".json"));
  assert.equal(snapshots.size, 14);
  assert.equal(summary.rows.length, 360);
  assert.equal(summary.refusals.length, 60);
  assert.deepEqual(summary.failures, []);
  let feasible = 0,
    capacity = 0;
  for (const row of summary.rows) {
    const input = row.input as AnalyzeInput,
      snapshot = snapshots.get(input.poolAddress)!;
    const report = buildReport(input, snapshot, row.at);
    assert.deepEqual(
      {
        construction: report.checks.construction,
        action: report.decision.action,
        lower: report.position.tickLower,
        upper: report.position.tickUpper,
        sharePercent: report.position.maxSharePercent,
        location: report.position.location,
      },
      {
        construction: row.construction,
        action: row.action,
        lower: row.lower,
        upper: row.upper,
        sharePercent: row.sharePercent,
        location: row.location,
      },
    );
    assert.equal(report.checks.data, "verified");
    assert.equal(report.checks.economics, "not-established");
    assert.ok(report.position.deployedUsd <= input.capitalUsd);
    assert.ok(
      Math.abs(
        report.position.deployedUsd +
          report.position.residualUsd -
          input.capitalUsd,
      ) < 1e-6,
    );
    if (input.intent === "buy-token0") {
      assert.equal(report.position.amount0Raw, "0");
      assert.equal(report.position.location, "waiting");
    }
    if (report.checks.construction === "feasible") feasible++;
    else capacity++;
  }
  assert.equal(feasible, 56);
  assert.equal(capacity, 304);
  for (const refusal of summary.refusals) {
    const snapshot = snapshots.get(refusal.input.poolAddress)!;
    assert.ok([148, 166].includes(snapshot.data.pool.poolHourData.length));
    assert.throws(
      () =>
        buildReport(
          refusal.input,
          snapshot,
          Math.ceil(Date.parse(snapshot.receivedAt) / 1000),
        ),
      (error) =>
        error instanceof HistoryDataError && error.code === refusal.code,
    );
  }
});

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  collectSnapshot,
  buildReport,
  HistoryDataError,
  type Snapshot,
} from "../src/services/analysis";
import { searchPools } from "../src/services/discovery";
import type { AnalyzeInput, Discovery } from "../src/domain/types";

const folder = path.resolve(
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
    ".runtime/arbitrum-validation",
);
const live = process.argv.includes("--live");
const queries = [
  "",
  "USDC",
  "WETH/USDC",
  "WBTC/WETH",
  "ARB",
  "WETH/LINK",
  "0xc6962004f452be9203591991d15f6b388e09e8d0",
  "NOT_A_LISTED_TOKEN",
];
const inputs: Omit<AnalyzeInput, "poolAddress">[] = [];
for (const capitalUsd of [1000, 5000, 10000] as const)
  for (const horizonHours of [6, 24] as const) {
    inputs.push({
      network: "arbitrum",
      capitalUsd,
      horizonHours,
      intent: "earn-fees",
    });
    for (const discountBps of [25, 100, 250, 1000])
      inputs.push({
        network: "arbitrum",
        capitalUsd,
        horizonHours,
        intent: "buy-token0",
        discountBps,
      });
  }

async function main() {
  await mkdir(folder, { recursive: true });
  const searches: { query: string; result: Discovery }[] = [],
    failures: { stage: string; subject: string; reason: string }[] = [];
  let addresses: string[] = [];
  if (live) {
    for (const query of queries) {
      try {
        const result = await searchPools("arbitrum", query);
        searches.push({ query, result });
        console.log(
          JSON.stringify({
            stage: "search",
            query,
            considered: result.considered,
            candidates: result.pools.length,
            rejected: result.rejected.length,
          }),
        );
      } catch (error) {
        failures.push({
          stage: "search",
          subject: query,
          reason: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
    addresses = [
      ...new Set(
        searches.flatMap(({ result }) =>
          result.pools.map((pool) => pool.address),
        ),
      ),
    ].slice(0, 40);
    await writeFile(
      path.join(folder, "searches.json"),
      JSON.stringify(searches, null, 2),
    );
    await writeFile(
      path.join(folder, "pools.json"),
      JSON.stringify(addresses, null, 2),
    );
  } else {
    addresses = JSON.parse(
      await readFile(path.join(folder, "pools.json"), "utf8"),
    );
  }
  const rows: unknown[] = [],
    refusals: { input: AnalyzeInput; code: string; reason: string }[] = [],
    snapshots: {
      address: string;
      pair: string;
      sourceBlock: number;
      receivedAt: string;
      ticks: string;
      tickCount: number;
      priceProvider: string;
    }[] = [];
  for (const poolAddress of addresses) {
    let snapshot: Snapshot;
    try {
      snapshot = live
        ? await collectSnapshot("arbitrum", poolAddress)
        : JSON.parse(
            await readFile(path.join(folder, `${poolAddress}.json`), "utf8"),
          );
      if (live)
        await writeFile(
          path.join(folder, `${poolAddress}.json`),
          JSON.stringify(snapshot, null, 2),
        );
    } catch (error) {
      failures.push({
        stage: "snapshot",
        subject: poolAddress,
        reason: error instanceof Error ? error.message : "Unknown error",
      });
      continue;
    }
    snapshots.push({
      address: poolAddress,
      pair: `${snapshot.data.pool.token0.symbol}/${snapshot.data.pool.token1.symbol}`,
      sourceBlock: snapshot.data._meta.block.number,
      receivedAt: snapshot.receivedAt,
      ticks: snapshot.ticks?.provider ?? "Graph",
      tickCount: snapshot.data.ticks.length,
      priceProvider: snapshot.prices.source,
    });
    // Replay at actual receipt time. Never relabel old evidence as today's live data.
    const at = Math.ceil(Date.parse(snapshot.receivedAt) / 1000);
    for (const settings of inputs) {
      const input = { ...settings, poolAddress };
      try {
        const r = buildReport(input, snapshot, at);
        assert.equal(r.checks.data, "verified");
        assert.equal(r.checks.economics, "not-established");
        assert.ok(r.position.deployedUsd <= input.capitalUsd + 1e-8);
        assert.ok(
          Math.abs(
            r.position.deployedUsd + r.position.residualUsd - input.capitalUsd,
          ) < 1e-6,
        );
        assert.ok(
          Number.isFinite(r.position.maxSharePercent) &&
            r.position.maxSharePercent >= 0 &&
            r.position.maxSharePercent <= 100,
        );
        if (input.intent === "buy-token0") {
          assert.equal(r.position.amount0Raw, "0");
          assert.equal(r.position.location, "waiting");
          assert.ok(r.position.tickUpper < Number(snapshot.data.pool.tick));
        }
        rows.push({
          input,
          at,
          construction: r.checks.construction,
          action: r.decision.action,
          lower: r.position.tickLower,
          upper: r.position.tickUpper,
          sharePercent: r.position.maxSharePercent,
          location: r.position.location,
        });
      } catch (error) {
        if (error instanceof HistoryDataError) {
          // Missing history is an expected refusal only when observed independently.
          const hours = snapshot.data.pool.poolHourData,
            end = Math.floor(snapshot.data._meta.block.timestamp / 3600) * 3600;
          assert.ok(
            hours.length !== 168 ||
              hours.some(
                (h, i) =>
                  h.periodStartUnix !== end - 604800 + i * 3600 ||
                  !Number.isFinite(Number(h.volumeUSD)) ||
                  Number(h.volumeUSD) < 0,
              ),
          );
          refusals.push({ input, code: error.code, reason: error.message });
        } else
          failures.push({
            stage: "matrix",
            subject: JSON.stringify(input),
            reason: error instanceof Error ? error.message : "Unknown error",
          });
      }
    }
    console.log(
      JSON.stringify({
        stage: "matrix",
        pool: poolAddress,
        pair: snapshots.at(-1)!.pair,
        cases: inputs.length,
        ticks: snapshot.ticks?.provider ?? "Graph",
      }),
    );
  }
  const summary = {
    classification: "recorded-source input replay",
    createdAt: new Date().toISOString(),
    collectionMode: live
      ? "live capture then offline input matrix"
      : "offline replay",
    inputsPerPool: inputs.length,
    poolsRequested: addresses.length,
    poolsCaptured: snapshots.length,
    calculationsPassed: rows.length,
    expectedRefusals: refusals.length,
    failures,
    snapshots,
    rows,
    refusals,
  };
  await writeFile(
    path.join(folder, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    JSON.stringify(
      {
        ...summary,
        rows: undefined,
        snapshots: undefined,
        refusals: undefined,
      },
      null,
      2,
    ),
  );
  if (!snapshots.length || failures.length) process.exitCode = 1;
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

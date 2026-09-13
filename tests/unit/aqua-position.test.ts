import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WETH, USDC, type CanonicalEvidence } from "@noria/aqua/boundary";
import { parseRehearsalPlan } from "@noria/aqua/rehearsal-plan";
import type { AquaResponse } from "../../src/integrations/aqua/contract";
import {
  createPositionService,
  type PositionRuntime,
} from "../../src/integrations/aqua/position-service";
import {
  PositionRequestSchema,
  type PositionRequest,
} from "../../src/integrations/aqua/position-contract";
import { createPositionPostHandler } from "../../src/integrations/aqua/position-http";
import {
  createLocalRehearsalHandlers,
  localRehearsalEnabled,
  readLocalRun,
  readLocalReport,
  startLocalRun,
} from "../../src/integrations/aqua/local-rehearsal";

// Real dated Graph response; financing and independent RPC are explicit test doubles.
const recorded: AquaResponse = JSON.parse(
  readFileSync("examples/aqua/response.recorded.json", "utf8"),
);
const now = Date.parse(recorded.evaluatedAt);
const request: PositionRequest = {
  schemaVersion: "noria.aqua.position.v1",
  requestId: recorded.requestId,
  intent: {
    fundingAsset: "USDC",
    collateralAmountUnits: "2500000000",
    safetyHFWad: "1400000000000000000",
    comfortableHFWad: "2000000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  },
  reviewAfterHours: 6,
};
function harness(
  options: {
    loan?: bigint;
    graph?: (g: AquaResponse) => void;
    evidence?: (e: CanonicalEvidence, current: boolean) => void;
  } = {},
) {
  const calls: unknown[] = [];
  const rec = recorded.recommendation!;
  const at = BigInt(rec.report.source.blockNumber);
  const runtime: PositionRuntime = {
    finance: async (intent) => ({
      intent,
      asset: intent.fundingAsset === "USDC" ? USDC : WETH,
      blockNumber: at + 10n,
      blockHash: `0x${"a".repeat(64)}`,
      timestamp: BigInt(now / 1000),
      oracle: WETH,
      terms: {
        collateralUnits: BigInt(intent.collateralAmountUnits),
        collateralDecimals: intent.fundingAsset === "USDC" ? 6 : 18,
        collateralPriceBase: 100000000n,
        usdcPriceBase: 100000000n,
        ltvBps: 7500n,
        liquidationThresholdBps: 8000n,
        comfortableHFWad: BigInt(intent.comfortableHFWad),
      },
      collateralBase: 250000000000n,
      loanUSDCUnits: options.loan ?? 1000000000n,
      headroomBps: 50,
      constraint: "comfortable_hf",
    }),
    recommend: async (input) => {
      calls.push(input);
      const result = structuredClone(recorded);
      options.graph?.(result);
      return result;
    },
    verify: async (pool, block) => {
      const evidence: CanonicalEvidence = {
        pool,
        chainId: 42161,
        token0: WETH,
        token1: USDC,
        feeTierPips: rec.referencePool.feeTier,
        liquidity: "99999999999999",
        spotUSDCPerWethE6: String(Math.round(rec.range.spot * 1e6)),
        blockNumber: String(block),
        blockHash:
          block === at ? rec.report.source.blockHash : `0x${"a".repeat(64)}`,
        timestamp: new Date(now).toISOString(),
        mode: "rpc",
        canonicalFactoryPool: true,
      };
      options.evidence?.(evidence, block !== at);
      return evidence;
    },
    head: async () => at + 10n,
    now: () => now,
  };
  return { plan: createPositionService(runtime), calls };
}

test("position planning sends the Aave loan to real Graph selection and preserves asymmetric inventory/provenance", async () => {
  for (const fundingAsset of ["ETH", "USDC"] as const) {
    const { plan, calls } = harness();
    const result = await plan({
      ...request,
      intent: { ...request.intent, fundingAsset },
    });
    assert.equal(result.status, "ready-for-local-rehearsal");
    assert.equal(
      result.financing.collateralAsset,
      fundingAsset === "ETH" ? WETH : USDC,
    );
    assert.deepEqual(calls, [recorded.request]);
    const e = result.execution!;
    assert.equal(e.targetWethUnits, "24445944561000366");
    assert.equal(e.targetUsdcUnits, "938263537");
    assert.equal(e.convertUsdcUnits, "61736463");
    assert.notEqual(e.convertUsdcUnits, "500000000");
    assert.equal(e.graphIndexedBlock, "504581345");
    assert.equal(result.graph!.selection.discovery.sourceBlock, 504581327);
    assert.equal(e.canonicalSourceLiquidity, "99999999999999");
    assert.equal(
      e.graphQueryHash,
      `0x${recorded.recommendation!.report.source.queryHash}`,
    );
    assert.equal(e.graphHashAlgorithm, "sha256");
    assert.equal(e.observationCount, 168);
    assert.equal(e.inRangeObservations, 135);
    assert.equal(e.coverageBps, 8035);
    assert.equal(e.selectionMethod, recorded.selection.method);
    assert.equal(result.validUntil, recorded.recommendation!.validUntil);
    assert.equal(result.routingStatus, "not_validated");
    assert.equal(
      parseRehearsalPlan(result, now).execution.targetUsdcUnits,
      e.targetUsdcUnits,
    );
  }
});

test("position planning refuses unusable Graph evidence without silently replacing its range or targets", async () => {
  const cases: [string, (g: AquaResponse) => void][] = [
    [
      "request",
      (g) => {
        g.requestId = "another";
      },
    ],
    [
      "expired",
      (g) => {
        g.recommendation!.validUntil = new Date(now - 1).toISOString();
      },
    ],
    [
      "scope",
      (g) => {
        g.recommendation!.referencePool.token1 = {
          ...g.recommendation!.referencePool.token1,
          address: WETH as typeof USDC,
        };
      },
    ],
    [
      "two-token",
      (g) => {
        g.recommendation!.targetInventory.wethAmountRaw = "0";
      },
    ],
    [
      "two-token",
      (g) => {
        g.recommendation!.range.location = "waiting";
      },
    ],
    [
      "capacity",
      (g) => {
        g.recommendation!.report.position.maxSharePercent = 2;
      },
    ],
    [
      "stale",
      (g) => {
        g.recommendation!.report.source.blockTimestamp -= 4000;
      },
    ],
    [
      "observations",
      (g) => {
        g.recommendation!.report.pool.history.pop();
        g.recommendation!.report.pool.history.push(
          g.recommendation!.report.pool.history[0],
        );
      },
    ],
    [
      "80%",
      (g) => {
        g.recommendation!.report.pool.history.forEach((h) => {
          h.price = 1;
        });
      },
    ],
    [
      "no matching",
      (g) => {
        g.status = "no-recommendation";
        g.recommendation = null;
        g.selection.discovery.selectedReason = "no matching source";
      },
    ],
  ];
  for (const [reason, graph] of cases) {
    const result = await harness({ graph }).plan(request);
    assert.equal(result.status, "refused", reason);
    assert.equal(result.execution, null);
    assert.match(result.reasons.join(" "), new RegExp(reason, "i"));
  }
  await assert.rejects(
    harness({
      graph: (g) => {
        g.recommendation!.report.source.queryHash = "unavailable";
      },
    }).plan(request),
    /invalid_graph_provenance_hash/,
  );
});

test("canonical verification binds source block and current block, pair, price and clock", async () => {
  const changes: ((e: CanonicalEvidence, current: boolean) => void)[] = [
    (e) => {
      e.canonicalFactoryPool = false;
    },
    (e, current) => {
      if (!current) e.blockHash = `0x${"0".repeat(64)}`;
    },
    (e, current) => {
      if (current) e.blockNumber = "1";
    },
    (e) => {
      e.token1 = WETH;
    },
    (e) => {
      e.feeTierPips = 3000;
    },
    (e) => {
      e.spotUSDCPerWethE6 = "0";
    },
    (e, current) => {
      if (current) e.spotUSDCPerWethE6 = "2600000000";
    },
    (e, current) => {
      if (current) e.timestamp = new Date(now - 121000).toISOString();
    },
  ];
  for (const evidence of changes)
    assert.equal((await harness({ evidence }).plan(request)).status, "refused");
  for (const loan of [999999n, 100000000001n]) {
    const { plan, calls } = harness({ loan });
    assert.equal((await plan(request)).status, "refused");
    assert.deepEqual(calls, []);
  }
});

test("downloaded plans reject expiry, accounting changes, invalid fee/coverage and injected calldata", async () => {
  const valid = await harness().plan(request);
  assert.throws(() => parseRehearsalPlan(valid, now + 61000), /expired/);
  for (const change of [
    (p: typeof valid) => {
      p.execution!.convertUsdcUnits = "500000000";
    },
    (p: typeof valid) => {
      p.execution!.coverageBps = 10000;
    },
    (p: typeof valid) => {
      p.execution!.lpFeeBps = 30;
    },
    (p: typeof valid) => {
      p.financing.collateralAmountUnits = "1";
    },
  ]) {
    const altered = structuredClone(valid);
    change(altered);
    assert.throws(() => parseRehearsalPlan(altered, now), /inconsistent/);
  }
  assert.throws(() =>
    parseRehearsalPlan({ ...valid, calldata: "0x1234" }, now),
  );
  assert.equal(
    PositionRequestSchema.safeParse({
      ...request,
      intent: { ...request.intent, comfortableHFWad: "1300000000000000000" },
    }).success,
    false,
  );
});

test("position HTTP validates collateral intent and bounds streams before provider calls", async () => {
  const make = (body: string, type = "application/json") =>
    new Request("http://localhost/api/aqua/v1/position", {
      method: "POST",
      headers: { "content-type": type },
      body,
    });
  const handler = createPositionPostHandler(harness().plan);
  const good = await handler(make(JSON.stringify(request)));
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  for (const [body, status] of [
    ["{", 400],
    ["{}", 400],
    ["x".repeat(4097), 413],
  ] as const)
    assert.equal((await handler(make(body))).status, status);
  assert.equal((await handler(make("{}", "text/plain"))).status, 415);
  const unavailable = await createPositionPostHandler(async () => {
    throw new Error("private provider URL");
  })(make(JSON.stringify(request)));
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.text()).includes("private provider"), false);
});

test("local runner HTTP is opt-in, loopback-only, same-origin and validates its job envelope", async () => {
  const old = process.env.NORIA_ENABLE_LOCAL_FORK;
  const oldVercel = process.env.VERCEL;
  let calls = 0;
  const handlers = createLocalRehearsalHandlers(async () => {
    calls++;
    return { runId: "test", status: "running" };
  });
  const make = (url: string, body = "{}", origin?: string) =>
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      body,
    });
  const url = "http://127.0.0.1:3100/api/aqua/v1/local-rehearsal";
  try {
    delete process.env.VERCEL;
    delete process.env.NORIA_ENABLE_LOCAL_FORK;
    assert.equal((await handlers.POST(make(url))).status, 403);
    process.env.NORIA_ENABLE_LOCAL_FORK = "1";
    assert.equal(
      localRehearsalEnabled(new Request("https://noria.example/api")),
      false,
    );
    process.env.VERCEL = "1";
    assert.equal(localRehearsalEnabled(new Request(url)), false);
    delete process.env.VERCEL;
    assert.equal(
      (await handlers.POST(make(url, "{}", "https://another.example"))).status,
      403,
    );
    assert.equal(
      (await handlers.POST(make(url, "x".repeat(1500001)))).status,
      413,
    );
    assert.equal(
      (
        await handlers.POST(
          make(url, JSON.stringify({ owner: WETH, plan: {}, command: "bad" })),
        )
      ).status,
      400,
    );
    assert.equal(calls, 0);
    assert.equal(
      (
        await handlers.POST(
          make(
            url,
            JSON.stringify({ owner: WETH, plan: {} }),
            "http://127.0.0.1:3100",
          ),
        )
      ).status,
      202,
    );
    assert.equal(calls, 1);
    await assert.rejects(readLocalRun("../escape"), /invalid_run_id/);
  } finally {
    if (old === undefined) delete process.env.NORIA_ENABLE_LOCAL_FORK;
    else process.env.NORIA_ENABLE_LOCAL_FORK = old;
    if (oldVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = oldVercel;
  }
});

test("local job lock rejects concurrent execution and failed jobs retain confined partial reports", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const plan = await harness().plan(request);
  const originalCwd = process.cwd();
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "noria-rehearsal-test-")),
  );
  const runId = "11111111-1111-4111-8111-111111111111";
  const storage = join(directory, ".runtime/aqua-rehearsals");
  const job = join(storage, runId);
  const report = join(directory, "integrations/aqua/runs/partial");
  try {
    await mkdir(job, { recursive: true });
    await writeFile(join(storage, "active.lock"), runId);
    process.chdir(directory);
    await assert.rejects(
      startLocalRun(plan, "0x00000000000000000000000000000000000a11ce"),
      /rehearsal_already_running/,
    );
    await mkdir(report, { recursive: true });
    await writeFile(
      join(report, "report.html"),
      "<h1>Partial operation report</h1>",
    );
    await writeFile(
      join(job, "status.json"),
      JSON.stringify({
        runId,
        status: "failed",
        reportUrl: `/api/aqua/v1/local-rehearsal/report?runId=${runId}`,
      }),
    );
    await writeFile(
      join(job, "report-location.json"),
      JSON.stringify({ directory: report }),
    );
    assert.match(await readLocalReport(runId), /Partial operation report/);
    await writeFile(
      join(job, "report-location.json"),
      JSON.stringify({ directory }),
    );
    await assert.rejects(readLocalReport(runId), /invalid_report_location/);
  } finally {
    process.chdir(originalCwd);
    await rm(directory, { recursive: true, force: true });
  }
});

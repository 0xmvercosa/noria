import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRehearsalPlan } from "../src/rehearsal-plan.js";
import { USDC, WETH } from "../src/boundary.js";

// A dated Graph response is used only as a compatibility fixture. Financing and
// canonical liquidity below are test data, not a live quote or authenticated plan.
const recorded = JSON.parse(
  readFileSync(
    new URL("../../../examples/aqua/response.recorded.json", import.meta.url),
    "utf8",
  ),
);
const now = Date.parse(recorded.evaluatedAt);
const otherHash = `0x${"f".repeat(64)}`;

function fixture() {
  const graph = structuredClone(recorded);
  const rec = graph.recommendation;
  const history = rec.report.pool.history as {
    timestamp: number;
    price: number;
  }[];
  return {
    schemaVersion: "noria.aqua.position.v1",
    requestId: graph.requestId as string,
    status: "ready-for-local-rehearsal",
    evaluatedAt: graph.evaluatedAt as string,
    validUntil: rec.validUntil as string,
    intent: {
      fundingAsset: "USDC",
      collateralAmountUnits: "2500000000",
      safetyHFWad: "1400000000000000000",
      comfortableHFWad: "2000000000000000000",
      financingMode: "aave_collateral_then_borrow_usdc",
    },
    financing: {
      collateralAsset: USDC as string,
      collateralAmountUnits: "2500000000",
      loanUSDCUnits: "1000000000",
      collateralPriceBase: "100000000",
      usdcPriceBase: "100000000",
      ltvBps: "7500",
      liquidationThresholdBps: "8000",
      blockNumber: String(rec.report.source.blockNumber + 10),
      blockHash: otherHash,
      timestamp: new Date(now).toISOString(),
      headroomBps: 50,
    },
    execution: {
      chainId: 42161,
      sourcePool: rec.referencePool.address as string,
      sourceFeeTierPips: 500,
      lowerPriceE6: "2460235238",
      upperPriceE6: "2527563060",
      lpFeeBps: 5,
      targetWethUnits: "24445944561000366",
      targetUsdcUnits: "938263537",
      convertUsdcUnits: "61736463",
      selectionMethod: "highest-ranked-passing-reference-pool",
      observationCount: 168,
      inRangeObservations: 135,
      coverageBps: 8035,
      observedWindowStart: new Date(history[0]!.timestamp * 1000).toISOString(),
      observedWindowEnd: new Date(
        (history.at(-1)!.timestamp + 3600) * 1000,
      ).toISOString(),
      graphQueryHash: `0x${rec.report.source.queryHash}`,
      graphResponseHash: `0x${rec.report.source.responseHash}`,
      graphHashAlgorithm: "sha256",
      graphIndexedBlock: String(rec.report.source.blockNumber),
      graphIndexedBlockHash: rec.report.source.blockHash as string,
      canonicalSourceLiquidity: "99999999999999",
      canonicalCurrentBlock: String(rec.report.source.blockNumber + 10),
      programBuilder: "@1inch/swap-vm-sdk@0.4.4",
    },
    graph,
    reasons: [
      "Historical test fixture; unsigned JSON is not authenticated evidence.",
    ],
    routingStatus: "not_validated",
    economics: "not-established",
  };
}
type Fixture = ReturnType<typeof fixture>;
const rejects = (mutate: (plan: Fixture) => void, message?: RegExp) => {
  const plan = fixture();
  mutate(plan);
  if (message) assert.throws(() => parseRehearsalPlan(plan, now), message);
  else assert.throws(() => parseRehearsalPlan(plan, now));
};

test("a consistent download preserves the complete Graph evidence and its separate discovery block", () => {
  const plan = fixture();
  plan.graph.extraEvidence = { note: "retained, not trusted", raw: [1, 2, 3] };
  plan.graph.recommendation.report.source.extraEvidence = { received: true };
  plan.graph.recommendation.report.pool.history[0].extraEvidence = "hour note";
  const parsed = parseRehearsalPlan(plan, now);
  assert.deepEqual(parsed, plan);
  assert.equal(parsed.execution.graphIndexedBlock, "504581345");
  assert.equal(parsed.graph.selection.discovery.sourceBlock, 504581327);
  assert.equal(parsed.execution.coverageBps, 8035);
  assert.equal(parsed.execution.convertUsdcUnits, "61736463");
  assert.equal(parsed.graph.recommendation.report.source.queryHash.length, 64);
});

test("collateral identity follows the ETH or USDC intent", () => {
  const plan = fixture();
  plan.intent.fundingAsset = "ETH";
  plan.financing.collateralAsset = WETH;
  assert.equal(parseRehearsalPlan(plan, now).financing.collateralAsset, WETH);
  rejects((p) => {
    p.financing.collateralAsset = WETH;
  }, /inconsistent_position_plan/);
  rejects((p) => {
    p.financing.collateralAmountUnits = "1";
  }, /inconsistent_position_plan/);
  rejects((p) => {
    p.financing.liquidationThresholdBps = "7500";
  }, /inconsistent_position_plan/);
});

test("missing, refused or mismatched Graph envelopes cannot become execution plans", () => {
  const changes: ((p: Fixture) => void)[] = [
    (p) => {
      p.graph = null;
    },
    (p) => {
      p.graph = {};
    },
    (p) => {
      p.graph.status = "no-recommendation";
    },
    (p) => {
      p.graph.recommendation = null;
    },
    (p) => {
      p.graph.requestId = "different";
    },
    (p) => {
      p.graph.request.requestId = "different";
    },
    (p) => {
      p.graph.request.funding.amountRaw = "2000000000";
    },
    (p) => {
      p.graph.request.funding.tokenAddress = WETH;
    },
    (p) => {
      p.graph.request.chainId = 1;
    },
    (p) => {
      p.graph.scope.usdc.decimals = 18;
    },
    (p) => {
      p.graph.selection.method = "manual";
    },
    (p) => {
      p.graph.recommendation.report.input.horizonHours = 24;
    },
    (p) => {
      p.graph.handoff.executionReady = true;
    },
  ];
  for (const change of changes) rejects(change);
});

test("execution cannot substitute a range, inventory, pool or fee while keeping original Graph evidence", () => {
  const changes: ((p: Fixture) => void)[] = [
    (p) => {
      p.execution.lowerPriceE6 = "2000000000";
    },
    (p) => {
      p.execution.upperPriceE6 = "3000000000";
    },
    (p) => {
      p.execution.sourcePool = WETH;
    },
    (p) => {
      p.execution.targetWethUnits = "24445944561000367";
    },
    (p) => {
      p.execution.targetUsdcUnits = "938263538";
      p.execution.convertUsdcUnits = "61736462";
    },
    (p) => {
      p.execution.sourceFeeTierPips = 3000;
      p.execution.lpFeeBps = 30;
    },
    (p) => {
      p.financing.loanUSDCUnits = "1000000001";
      p.execution.convertUsdcUnits = "61736464";
    },
  ];
  for (const change of changes)
    rejects(change, /inconsistent_graph_position_plan/);
});

test("recommendation fields remain bound to the detailed report", () => {
  const changes: ((p: Fixture) => void)[] = [
    (p) => {
      p.graph.recommendation.report.position.lowerPrice -= 1;
    },
    (p) => {
      p.graph.recommendation.report.position.amount0Raw = "1";
    },
    (p) => {
      p.graph.recommendation.report.position.amount1Raw = "1";
    },
    (p) => {
      p.graph.recommendation.report.position.tickLower += 1;
    },
    (p) => {
      p.graph.recommendation.report.pool.address = WETH;
    },
    (p) => {
      p.graph.recommendation.report.input.poolAddress = WETH;
    },
    (p) => {
      p.graph.recommendation.report.pool.relativePrice -= 1;
    },
    (p) => {
      p.graph.recommendation.report.pool.feePercent = 0.3;
    },
    (p) => {
      p.graph.recommendation.funding.usdcAmountRaw = "1000000001";
    },
    (p) => {
      p.graph.recommendation.referencePool.token0.decimals = 6;
    },
    (p) => {
      p.graph.recommendation.report.checks.construction = "capacity-exceeded";
    },
    (p) => {
      p.graph.recommendation.report.position.maxSharePercent = 1.01;
    },
  ];
  for (const change of changes) rejects(change);
});

test("coverage and observation windows are recomputed from all 168 complete hourly observations", () => {
  const changes: ((p: Fixture) => void)[] = [
    (p) => {
      p.execution.inRangeObservations = 168;
      p.execution.coverageBps = 10000;
    },
    (p) => {
      p.execution.observationCount = 24;
      p.execution.inRangeObservations = 24;
      p.execution.coverageBps = 10000;
    },
    (p) => {
      p.execution.observedWindowStart = new Date(now).toISOString();
    },
    (p) => {
      p.execution.observedWindowEnd = new Date(now).toISOString();
    },
    (p) => {
      p.graph.recommendation.report.pool.history.pop();
    },
    (p) => {
      p.graph.recommendation.report.pool.history[0].timestamp += 3600;
    },
    (p) => {
      p.graph.recommendation.report.pool.history[0].timestamp += 1;
    },
    (p) => {
      p.graph.recommendation.report.pool.history[0].price = 0;
    },
    (p) => {
      p.graph.recommendation.report.pool.history[0].price = 1;
    },
  ];
  for (const change of changes) rejects(change);
});

test("query hashes, response hashes and indexed block identity must match the original source", () => {
  const changes: ((p: Fixture) => void)[] = [
    (p) => {
      p.execution.graphQueryHash = otherHash;
    },
    (p) => {
      p.execution.graphResponseHash = otherHash;
    },
    (p) => {
      p.execution.graphIndexedBlockHash = otherHash;
    },
    (p) => {
      p.execution.graphIndexedBlock = "504581327";
    },
    (p) => {
      p.graph.recommendation.report.source.rpcMatched = false;
    },
    (p) => {
      p.execution.canonicalCurrentBlock = "1";
    },
    (p) => {
      p.execution.canonicalSourceLiquidity = "0";
    },
  ];
  for (const change of changes) rejects(change);
  const plan = fixture();
  plan.graph.recommendation.report.source.queryHash =
    plan.execution.graphQueryHash.toUpperCase().replace("0X", "0x");
  assert.equal(
    parseRehearsalPlan(plan, now).execution.graphQueryHash,
    fixture().execution.graphQueryHash,
  );
});

test("changing the outer expiry cannot extend the original recommendation or report lifetime", () => {
  rejects((p) => {
    p.validUntil = new Date(now + 120_000).toISOString();
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.recommendation.validUntil = new Date(now + 120_000).toISOString();
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.recommendation.report.validUntil = new Date(now - 1).toISOString();
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.financing.timestamp = new Date(now - 3_570_000).toISOString();
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.validUntil =
      p.graph.recommendation.validUntil =
      p.graph.recommendation.report.validUntil =
        new Date(now + 300_001).toISOString();
  }, /expired_or_invalid_clock/);
  assert.throws(
    () => parseRehearsalPlan(fixture(), now + 60_000),
    /expired_or_invalid_clock/,
  );
});

test("stale or future embedded evidence cannot be refreshed by changing plan clocks", () => {
  const future = new Date(now + 61_000).toISOString();
  rejects((p) => {
    p.financing.timestamp = future;
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.evaluatedAt = future;
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.recommendation.report.createdAt = future;
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.recommendation.report.source.blockTimestamp = now / 1000 - 3601;
  }, /expired_or_invalid_clock/);
  rejects((p) => {
    p.graph.recommendation.report.source.blockTimestamp = now / 1000 + 61;
  }, /expired_or_invalid_clock/);
  assert.throws(
    () => parseRehearsalPlan(fixture(), Number.NaN),
    /expired_or_invalid_clock/,
  );
});

test("range rounding uses the decimal source value at exact micro-USDC boundaries", () => {
  const plan = fixture();
  const rec = plan.graph.recommendation;
  // Synthetic range chosen to expose binary multiplication rounding in both directions.
  rec.range.lower = rec.report.position.lowerPrice = 1.000001;
  rec.range.upper = rec.report.position.upperPrice = 2.000001;
  rec.range.spot = rec.report.pool.relativePrice = 1.5;
  for (const hour of rec.report.pool.history) hour.price = 1.5;
  plan.execution.lowerPriceE6 = "1000001";
  plan.execution.upperPriceE6 = "2000001";
  plan.execution.inRangeObservations = 168;
  plan.execution.coverageBps = 10000;
  const parsed = parseRehearsalPlan(plan, now);
  assert.equal(parsed.execution.lowerPriceE6, "1000001");
  assert.equal(parsed.execution.upperPriceE6, "2000001");
  plan.execution.lowerPriceE6 = "1000000";
  assert.throws(
    () => parseRehearsalPlan(plan, now),
    /inconsistent_graph_position_plan/,
  );
});

test("source extras remain evidence while executable envelope injection is rejected", () => {
  const plan = fixture();
  plan.graph.recommendation.report.extraEvidence = {
    transaction: "not executable",
  };
  assert.deepEqual(
    parseRehearsalPlan(plan, now).graph.recommendation.report.extraEvidence,
    { transaction: "not executable" },
  );
  assert.throws(() => parseRehearsalPlan({ ...plan, calldata: "0x1234" }, now));
  assert.throws(() =>
    parseRehearsalPlan(
      {
        ...plan,
        execution: { ...plan.execution, rpc: "https://example.invalid" },
      },
      now,
    ),
  );
});

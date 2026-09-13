import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AnalyzeSchema,
  digest,
  type Snapshot,
} from "../../src/domain/analysis-data";
import type { Discovery, PoolCandidate } from "../../src/domain/types";
import {
  AQUA_REQUEST_EXAMPLE,
  AQUA_SCOPE,
  AquaRequestSchema,
} from "../../src/integrations/aqua/contract";
import { createAquaRecommendationService } from "../../src/integrations/aqua/service";
import { createAquaPostHandler } from "../../src/integrations/aqua/http";

const addresses = [
  "0x6f38e884725a116c9c7fbf208e79fe8828a2595f",
  "0xc6962004f452be9203591991d15f6b388e09e8d0",
];
const snapshots: Snapshot[] = addresses.map((address) =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/arbitrum/${address}.json`, import.meta.url),
      "utf8",
    ),
  ),
);
const now = Math.ceil(Date.parse(snapshots[1].receivedAt) / 1000);
const candidates: PoolCandidate[] = snapshots.map((snapshot, i) => ({
  network: "arbitrum",
  address: snapshot.data.pool.id,
  token0: AQUA_SCOPE.weth,
  token1: AQUA_SCOPE.usdc,
  feeTier: Number(snapshot.data.pool.feeTier),
  tvlUsd: 1e6,
  volume24hUsd: 1e6,
  activeHours: 24,
  score: 90 - i,
  reasons: [
    "Synthetic ranking for deterministic adapter testing; source snapshots are dated captures.",
  ],
}));
const discovery = (): Discovery => ({
  network: "arbitrum",
  provider: "offline fixture",
  sourceBlock: snapshots[1].data._meta.block.number,
  receivedAt: snapshots[1].receivedAt,
  considered: 2,
  pools: structuredClone(candidates),
  selectedReason: "Offline adapter fixture",
  limitations: ["Synthetic ranking; not live market selection."],
  rejected: [],
});
function harness(
  options: {
    time?: number;
    result?: Discovery;
    mutate?: (snapshot: Snapshot) => void;
  } = {},
) {
  const calls: string[] = [];
  const recommend = createAquaRecommendationService({
    search: async (network, query) => {
      assert.equal(network, "arbitrum");
      assert.equal(
        query,
        `${AQUA_SCOPE.weth.address} ${AQUA_SCOPE.usdc.address}`,
      );
      return options.result ?? discovery();
    },
    snapshot: async (network, address) => {
      assert.equal(network, "arbitrum");
      calls.push(address);
      const snapshot = structuredClone(snapshots[addresses.indexOf(address)]);
      options.mutate?.(snapshot);
      return snapshot;
    },
    now: () => options.time ?? now,
  });
  return { recommend, calls };
}

test("Aqua finds the first passing exact pair, preserves the hash, and values real USDC funding", async () => {
  for (const amountRaw of [
    "1000000000",
    "5000000000",
    "10000000000",
    "1234567890",
  ]) {
    const { recommend, calls } = harness();
    const result = await recommend({
      ...AQUA_REQUEST_EXAMPLE,
      funding: { ...AQUA_REQUEST_EXAMPLE.funding, amountRaw },
    });
    assert.equal(result.status, "recommended");
    assert.deepEqual(calls, addresses);
    assert.equal(result.selection.attempted, 2);
    assert.match(result.selection.discovery.rejected[0].reason, /capacity/);
    const recommendation = result.recommendation!;
    const report = recommendation.report;
    assert.equal(recommendation.referencePool.address, addresses[1]);
    assert.equal(recommendation.range.priceUnit, "USDC per WETH");
    assert.ok(recommendation.range.lower < recommendation.range.upper);
    assert.equal(recommendation.funding.usdcAmountRaw, amountRaw);
    assert.ok(
      Math.abs(
        recommendation.funding.valuationUsd -
          (Number(amountRaw) / 1e6) * report.pool.token1Usd,
      ) < 1e-8,
    );
    assert.notEqual(report.pool.token1Usd, 1);
    assert.ok(
      Math.abs(
        report.position.deployedUsd +
          report.position.residualUsd -
          recommendation.funding.valuationUsd,
      ) < 1e-7,
    );
    assert.equal(recommendation.funding.swapQuote, null);
    assert.equal(result.handoff.executionReady, false);
    assert.equal(result.handoff.aquaStrategy, null);
    assert.equal(result.handoff.transaction, null);
    assert.equal(report.id, digest({ ...report, id: "" }));
    assert.equal(report.checks.economics, "not-established");
  }
});

test("Aqua buy-eth is USDC-only below spot and fails capacity rather than downsizing silently", async () => {
  const { recommend } = harness();
  const small = await recommend({
    ...AQUA_REQUEST_EXAMPLE,
    objective: "buy-eth",
    discountBps: 100,
  });
  assert.equal(small.status, "recommended");
  const rec = small.recommendation!;
  assert.equal(rec.targetInventory.wethAmountRaw, "0");
  assert.equal(rec.range.location, "waiting");
  assert.ok(rec.range.upper < rec.range.spot);
  assert.equal(rec.funding.inventoryPreparationRequired, false);
  const large = await recommend({
    ...AQUA_REQUEST_EXAMPLE,
    objective: "buy-eth",
    funding: { ...AQUA_REQUEST_EXAMPLE.funding, amountRaw: "10000000000" },
  });
  assert.equal(large.status, "no-recommendation");
  assert.equal(large.recommendation, null);
  assert.equal(large.selection.discovery.rejected.length, 2);
});

test("Aqua excludes bridged USDC, wrong chains and misleading symbols before snapshot collection", async () => {
  const found = discovery();
  found.pools = [
    {
      ...candidates[0],
      token1: {
        ...AQUA_SCOPE.usdc,
        address: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
      },
    },
    { ...candidates[1], network: "base" },
  ];
  const { recommend, calls } = harness({ result: found });
  const result = await recommend(AQUA_REQUEST_EXAMPLE);
  assert.equal(result.status, "no-recommendation");
  assert.equal(result.selection.discovery.rejected.length, 2);
  assert.deepEqual(calls, []);
});

test("Aqua refuses stale, incomplete and mismatched canonical evidence", async () => {
  const expired = await harness({ time: now + 1000 }).recommend(
    AQUA_REQUEST_EXAMPLE,
  );
  assert.equal(expired.status, "no-recommendation");
  assert.match(expired.selection.discovery.rejected[0].reason, /expired/);
  for (const mutate of [
    (s: Snapshot) => {
      s.data.pool.poolHourData.pop();
    },
    (s: Snapshot) => {
      s.data.pool.token1.id = "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8";
    },
    (s: Snapshot) => {
      s.data._meta.block.hash = `0x${"0".repeat(64)}`;
    },
  ]) {
    const result = await harness({ mutate }).recommend(AQUA_REQUEST_EXAMPLE);
    assert.equal(result.status, "no-recommendation");
    assert.equal(result.recommendation, null);
    assert.equal(result.selection.discovery.rejected.length, 2);
  }
});

test("Aqua rejects unsupported inputs before contacting providers; public discovery presets remain strict", async () => {
  for (const patch of [
    { chainId: 1 },
    { poolAddress: addresses[0] },
    { discountBps: 100 },
    { schemaVersion: "2" },
    { requestId: "bad request id" },
    { reviewAfterHours: 30 },
    ...["1000.0", "0", "-1", "abc", "100000000001", "0001000000", "1"].map(
      (amountRaw) => ({
        funding: { ...AQUA_REQUEST_EXAMPLE.funding, amountRaw },
      }),
    ),
    {
      funding: {
        ...AQUA_REQUEST_EXAMPLE.funding,
        tokenAddress: "0xff970a61a04b1ca14834a43f5de4533ebddb5cc8",
      },
    },
  ]) {
    const result = AquaRequestSchema.safeParse({
      ...AQUA_REQUEST_EXAMPLE,
      ...patch,
    });
    assert.equal(result.success, false, JSON.stringify(patch));
  }
  assert.throws(() =>
    AnalyzeSchema.parse({
      network: "arbitrum",
      poolAddress: addresses[1],
      capitalUsd: 1234.5,
      intent: "earn-fees",
      horizonHours: 6,
    }),
  );
});

test("Aqua HTTP returns structured refusal, validation, size, JSON and provider errors", async () => {
  const request = (body: string, contentType = "application/json") =>
    new Request("http://localhost/api/aqua/v1/recommendation", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  const handler = createAquaPostHandler(harness().recommend);
  const ok = await handler(request(JSON.stringify(AQUA_REQUEST_EXAMPLE)));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal((await ok.json()).status, "recommended");
  assert.equal((await handler(request("{"))).status, 400);
  assert.equal((await handler(request("{}"))).status, 400);
  assert.equal((await handler(request("x".repeat(4097)))).status, 413);
  assert.equal((await handler(request("{}", "text/plain"))).status, 415);
  const empty = discovery();
  empty.pools = [];
  const none = await createAquaPostHandler(
    harness({ result: empty }).recommend,
  )(request(JSON.stringify(AQUA_REQUEST_EXAMPLE)));
  assert.equal(none.status, 200);
  assert.equal((await none.json()).status, "no-recommendation");
  const failed = await createAquaPostHandler(async () => {
    throw new Error("Unavailable https://rpc.example/private-key");
  })(request(JSON.stringify(AQUA_REQUEST_EXAMPLE)));
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("retry-after"), "15");
  assert.equal((await failed.json()).message, "Unavailable [provider]");
  for (const providerFailure of [
    () => {
      AquaRequestSchema.parse({});
    },
    () => {
      JSON.parse("{");
    },
  ]) {
    const invalidSource = await createAquaPostHandler(async () => {
      providerFailure();
      throw new Error("Unreachable");
    })(request(JSON.stringify(AQUA_REQUEST_EXAMPLE)));
    assert.equal(invalidSource.status, 503);
    assert.equal((await invalidSource.json()).code, "source-unavailable");
  }
});

test("published Aqua examples and OpenAPI preserve exact asset and raw-unit boundaries", () => {
  const example = JSON.parse(
    readFileSync("examples/aqua/request.json", "utf8"),
  );
  assert.deepEqual(AquaRequestSchema.parse(example), AQUA_REQUEST_EXAMPLE);
  const schema = JSON.parse(readFileSync("public/aqua/openapi.json", "utf8"));
  const funding =
    schema.components.schemas.AquaRequest.properties.funding.properties;
  const address = new RegExp(funding.tokenAddress.pattern);
  assert.ok(address.test(AQUA_SCOPE.usdc.address));
  assert.ok(
    address.test(`0x${AQUA_SCOPE.usdc.address.slice(2).toUpperCase()}`),
  );
  assert.equal(
    address.test("0xff970a61a04b1ca14834a43f5de4533ebddb5cc8"),
    false,
  );
  const amounts = new RegExp(funding.amountRaw.pattern);
  for (const amount of ["1000000", "1234567890", "100000000000"])
    assert.ok(amounts.test(amount));
  for (const amount of ["999999", "100000000001", "1000.0"])
    assert.equal(amounts.test(amount), false);
  const recorded = JSON.parse(
    readFileSync("examples/aqua/response.recorded.json", "utf8"),
  );
  const report = recorded.recommendation.report;
  assert.equal(report.id, digest({ ...report, id: "" }));
  assert.equal(recorded.handoff.executionReady, false);
});

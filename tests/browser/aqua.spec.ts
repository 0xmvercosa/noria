import { test, expect, type Page } from "@playwright/test";

test("public launch fails closed without a configured factory and never substitutes a local fixture", async ({
  request,
}) => {
  test.skip(
    Boolean(process.env.NORIA_AQUA_FACTORY_ADDRESS),
    "This scenario requires no configured public factory.",
  );
  const owner = "0x1111111111111111111111111111111111111111";
  const response = await request.get(`/api/aqua/v1/launch?owner=${owner}`);
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({
    status: "deployment-required",
    chainId: 42161,
    owner,
  });
  const prepare = await request.post("/api/aqua/v1/launch", {
    data: {
      operation: "prepare",
      request: {
        owner,
        kind: "create",
        id: `0x${"1".repeat(64)}`,
        intent: {
          fundingAsset: "USDC",
          collateralAmountUnits: "10000000",
          safetyHFWad: "1400000000000000000",
          comfortableHFWad: "2000000000000000000",
          financingMode: "aave_collateral_then_borrow_usdc",
        },
      },
    },
  });
  expect(prepare.status()).toBe(409);
  expect(await prepare.json()).toMatchObject({ code: "deployment-required" });
});
import { readFileSync } from "node:fs";
import type { AquaResponse } from "../../src/integrations/aqua/contract";
import type {
  PositionRequest,
  PositionPlanResponse,
} from "../../src/integrations/aqua/position-contract";

// Browser-state fixtures only. Updated clocks and financing values below are
// synthetic and do not establish current Graph, Aave, wallet, or fork evidence.
const recorded: AquaResponse = JSON.parse(
  readFileSync("examples/aqua/response.recorded.json", "utf8"),
);
const at = Date.UTC(2026, 8, 13, 10, 0, 0);

function planFixture(input: PositionRequest): PositionPlanResponse {
  const graph = structuredClone(recorded);
  graph.requestId = input.requestId;
  graph.request = {
    ...graph.request,
    requestId: input.requestId,
    funding: { ...graph.request.funding, amountRaw: "1000000000" },
  };
  graph.evaluatedAt = new Date(at).toISOString();
  graph.selection.discovery.provider = "Offline browser fixture";
  const rec = graph.recommendation!;
  rec.validUntil = new Date(at + 60_000).toISOString();
  rec.report.validUntil = rec.validUntil;
  rec.report.source.provider = "Offline browser fixture";
  const history = rec.report.pool.history;
  const inRange = history.filter(
    (hour) => hour.price >= rec.range.lower && hour.price <= rec.range.upper,
  ).length;
  return {
    schemaVersion: "noria.aqua.position.v1",
    requestId: input.requestId,
    status: "ready-for-local-rehearsal",
    evaluatedAt: new Date(at).toISOString(),
    validUntil: rec.validUntil,
    intent: input.intent,
    financing: {
      collateralAsset:
        input.intent.fundingAsset === "ETH"
          ? graph.scope.weth.address
          : graph.scope.usdc.address,
      collateralAmountUnits: input.intent.collateralAmountUnits,
      loanUSDCUnits: "1000000000",
      collateralPriceBase:
        input.intent.fundingAsset === "ETH" ? "250000000000" : "100000000",
      usdcPriceBase: "100000000",
      ltvBps: "8000",
      liquidationThresholdBps: "8400",
      blockNumber: String(rec.report.source.blockNumber),
      blockHash: rec.report.source.blockHash,
      timestamp: new Date(at).toISOString(),
      headroomBps: 50,
    },
    graph,
    execution: {
      chainId: 42161,
      sourcePool: rec.referencePool.address,
      sourceFeeTierPips: rec.referencePool.feeTier,
      lowerPriceE6: String(Math.floor(rec.range.lower * 1e6)),
      upperPriceE6: String(Math.ceil(rec.range.upper * 1e6)),
      lpFeeBps: 5,
      targetWethUnits: rec.targetInventory.wethAmountRaw,
      targetUsdcUnits: rec.targetInventory.usdcAmountRaw,
      convertUsdcUnits: String(
        1_000_000_000n - BigInt(rec.targetInventory.usdcAmountRaw),
      ),
      selectionMethod: graph.selection.method,
      observationCount: history.length,
      inRangeObservations: inRange,
      coverageBps: Math.floor((inRange * 10000) / history.length),
      observedWindowStart: new Date(history[0].timestamp * 1000).toISOString(),
      observedWindowEnd: new Date(
        (history.at(-1)!.timestamp + 3600) * 1000,
      ).toISOString(),
      graphQueryHash: `0x${rec.report.source.queryHash}`,
      graphResponseHash: `0x${rec.report.source.responseHash}`,
      graphHashAlgorithm: "sha256",
      graphIndexedBlock: String(rec.report.source.blockNumber),
      graphIndexedBlockHash: rec.report.source.blockHash,
      canonicalSourceLiquidity: "123456789",
      canonicalCurrentBlock: String(rec.report.source.blockNumber),
      programBuilder: "@1inch/swap-vm-sdk@0.4.4",
    },
    reasons: [
      "Offline browser fixture; no market or wallet execution occurred.",
    ],
    routingStatus: "not_validated",
    economics: "not-established",
  };
}

async function localAvailability(page: Page, enabled: boolean) {
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled } }),
  );
}

async function mockPosition(
  page: Page,
  requests: PositionRequest[],
  respond = planFixture,
) {
  await page.route("**/api/aqua/v1/position", (route) => {
    const input = route.request().postDataJSON() as PositionRequest;
    requests.push(input);
    return route.fulfill({ json: respond(input) });
  });
}

test("collateral and HF inputs produce a position request, preserve asymmetric inventory, and download complete evidence", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at) });
  await localAvailability(page, false);
  const requests: PositionRequest[] = [];
  await mockPosition(page, requests);
  let directResearchCalls = 0;
  await page.route("**/api/aqua/v1/recommendation", async (route) => {
    directResearchCalls++;
    await route.fulfill({
      status: 500,
      json: { message: "The workbench must call the position orchestrator." },
    });
  });
  await page.goto("/aqua");
  await expect(
    page.getByRole("heading", { name: "The pool comes from the search" }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.getByLabel("Collateral amount (USDC)").fill("1234.56789");
  await page.getByLabel("Safety health factor", { exact: true }).fill("1.45");
  await page
    .getByLabel("Comfortable health factor", { exact: true })
    .fill("2.125");
  await page.getByRole("button", { name: "Find my pool and range" }).click();
  await expect(
    page.getByRole("heading", { name: "WETH / USDC", exact: true }),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].intent).toEqual({
    fundingAsset: "USDC",
    collateralAmountUnits: "1234567890",
    safetyHFWad: "1450000000000000000",
    comfortableHFWad: "2125000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  });
  expect(requests[0]).not.toHaveProperty("poolAddress");
  expect(requests[0]).not.toHaveProperty("funding");
  expect(directResearchCalls).toBe(0);
  await expect(page.getByText("1,000 USDC", { exact: true })).toBeVisible();
  await expect(
    page.getByText("0.024445944561000366", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("938.263537", { exact: true })).toBeVisible();
  await expect(
    page.getByText("80.35% historical coverage", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("135 of 168 hourly prices inside this range.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Inspect the source pool" }),
  ).toHaveAttribute(
    "href",
    `https://arbiscan.io/address/${recorded.recommendation!.referencePool.address}`,
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download complete plan JSON" })
    .click();
  const download = await downloaded;
  const saved = JSON.parse(readFileSync((await download.path())!, "utf8"));
  expect(saved.intent).toEqual(requests[0].intent);
  expect(saved.execution.targetWethUnits).toBe("24445944561000366");
  expect(saved.graph.recommendation.report.source.blockHash).toBe(
    recorded.recommendation!.report.source.blockHash,
  );
  expect(saved.graph.recommendation.report.pool.history).toHaveLength(168);
  await page.clock.fastForward(61_000);
  await expect(
    page.getByText("Evidence expired · refresh required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run local rehearsal", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Safety health factor", { exact: true }).fill("1.5");
  await expect(
    page.getByRole("heading", { name: "The pool comes from the search" }),
  ).toBeVisible();
  await expect(page.getByText("1,000 USDC", { exact: true })).toHaveCount(0);
});

test("ETH preserves eighteen decimals and invalid token precision or HF ordering sends no request", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at) });
  await localAvailability(page, false);
  const requests: PositionRequest[] = [];
  await mockPosition(page, requests);
  await page.goto("/aqua");
  const submit = page.getByRole("button", { name: "Find my pool and range" });
  await page.getByLabel("Collateral amount (USDC)").fill("1.0000001");
  await expect(submit).toBeDisabled();
  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("ETH");
  await page.getByLabel("Collateral amount (ETH)").fill("1.000000000000000001");
  await expect(submit).toBeEnabled();
  await page.getByLabel("Safety health factor", { exact: true }).fill("2");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Safety health factor", { exact: true }).fill("1");
  await expect(submit).toBeDisabled();
  await page.getByLabel("Safety health factor", { exact: true }).fill("1.4");
  await page
    .getByLabel("Comfortable health factor", { exact: true })
    .fill("10.000000000000000001");
  await expect(submit).toBeDisabled();
  expect(requests).toHaveLength(0);
  await page.getByLabel("Comfortable health factor", { exact: true }).fill("2");
  await submit.click();
  await expect(
    page.getByRole("heading", { name: "WETH / USDC", exact: true }),
  ).toBeVisible();
  expect(requests[0].intent.fundingAsset).toBe("ETH");
  expect(requests[0].intent.collateralAmountUnits).toBe("1000000000000000001");
});

test("a refusal retains its reason and evidence without enabling rehearsal", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at) });
  await localAvailability(page, true);
  await mockPosition(page, [], (input) => ({
    ...planFixture(input),
    status: "refused",
    execution: null,
    reasons: ["This release requires an active two-token position."],
  }));
  await page.goto("/aqua");
  await page.getByRole("button", { name: "Find my pool and range" }).click();
  await expect(
    page.getByRole("heading", { name: "Why this plan was refused" }),
  ).toBeVisible();
  await expect(
    page.getByText("This release requires an active two-token position.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run local rehearsal", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Download complete plan JSON" }),
  ).toBeEnabled();
  await page
    .getByText("Source evidence, exclusions and complete plan", { exact: true })
    .click();
  await expect(
    page.getByText(recorded.recommendation!.report.source.blockHash, {
      exact: true,
    }),
  ).toBeVisible();
});

test("unconfigured Privy stays honest and cannot start a local run even with a ready plan", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    "The unconfigured deployment case requires an absent public Privy App ID.",
  );
  await page.clock.install({ time: new Date(at) });
  const privyRequests: string[] = [];
  let localPosts = 0;
  page.on("request", (request) => {
    if (/privy\.io/.test(request.url())) privyRequests.push(request.url());
    if (
      request.url().includes("/local-rehearsal") &&
      request.method() === "POST"
    )
      localPosts++;
  });
  await localAvailability(page, true);
  await mockPosition(page, []);
  await page.goto("/aqua");
  await expect(
    page.getByText("Wallet unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect wallet", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Find my pool and range" }).click();
  await expect(
    page.getByText("Plan ready for review", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run local rehearsal", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Wallet connection is not configured for this deployment.", {
      exact: false,
    }),
  ).toBeVisible();
  expect(localPosts).toBe(0);
  expect(privyRequests).toHaveLength(0);
  await page
    .getByText("Local workflow and downloadable evidence", { exact: true })
    .click();
  await expect(
    page.locator("pre").filter({ hasText: "NORIA_PLAN_FILE=" }),
  ).toContainText(
    'NORIA_PLAN_FILE="/path/to/download.json" pnpm fork:rehearse',
  );
});

test("mobile position analysis shows source errors and stays within the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await localAvailability(page, false);
  await page.route("**/api/aqua/v1/position", (route) =>
    route.fulfill({
      status: 503,
      json: { message: "The Graph is temporarily unavailable." },
    }),
  );
  await page.goto("/aqua");
  await page.getByRole("button", { name: "Find my pool and range" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Analysis unavailable" }),
  ).toContainText("The Graph is temporarily unavailable.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("the separate research API still publishes capabilities and OpenAPI without provider calls", async ({
  request,
}) => {
  const capability = await request.get("/api/aqua/v1/recommendation");
  expect(capability.ok()).toBe(true);
  expect((await capability.json()).scope.chainId).toBe(42161);
  const specification = await request.get("/aqua/openapi.json");
  expect(specification.ok()).toBe(true);
  expect((await specification.json()).openapi).toBe("3.1.0");
});

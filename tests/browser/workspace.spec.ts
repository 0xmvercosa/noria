import { test, expect, type Page, type Route } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildReport, type Snapshot } from "../../src/services/analysis";
import type {
  DiscoveryResult,
  HistoricalCase,
  PoolCandidate,
  PriceReferenceQuote,
  TickEvidence,
} from "../../src/domain/types";

// Deliberately mocked browser-state checks. Live discovery evidence is recorded separately.
const stored = JSON.parse(
  readFileSync("tests/fixtures/graph-snapshot.json", "utf8"),
);
const snapshot: Snapshot = {
  ...stored,
  network: "ethereum",
  tickSpacing: 10,
  prices: { ...stored.prices, nativeUsd: stored.prices.usd[1] },
};
const at = Math.ceil(Date.parse(snapshot.receivedAt) / 1000);
const candidate: PoolCandidate = {
  network: "ethereum",
  address: snapshot.data.pool.id,
  token0: {
    address: snapshot.data.pool.token0.id,
    symbol: "WBTC",
    decimals: 8,
  },
  token1: {
    address: snapshot.data.pool.token1.id,
    symbol: "WETH",
    decimals: 18,
  },
  feeTier: 500,
  tvlUsd: 2e6,
  volume24hUsd: 3e6,
  activeHours: 24,
  score: 90,
  reasons: ["Test candidate from a disclosed fixture"],
};
// The optional age shifts only the fixture's reference timestamp to exercise clock states.
function response(input: any, priceAgeSeconds?: number): DiscoveryResult {
  const state =
    priceAgeSeconds === undefined
      ? snapshot
      : {
          ...snapshot,
          prices: { ...snapshot.prices, timestamp: at - priceAgeSeconds },
        };
  const report = buildReport(
    { ...input, poolAddress: candidate.address },
    state,
    at,
  );
  return {
    report,
    discovery: {
      network: input.network,
      provider: "The Graph test fixture",
      sourceBlock: snapshot.data._meta.block.number,
      receivedAt: snapshot.receivedAt,
      pools: [candidate],
      considered: 12,
      selectedReason: "Fixture recommendation from scanned candidates",
      limitations: ["Mocked browser test, not live market data"],
      rejected: [],
    },
  };
}

// These values exercise rendering only; no browser fixture is market evidence.
const historicalFixture: HistoricalCase = {
  id: "noria-browser-history-fixture",
  classification: "historical-simulation",
  title: "Historical browser fixture",
  start: new Date((at - 86400) * 1000).toISOString(),
  end: new Date(at * 1000).toISOString(),
  entryWalletUsd: 9952.65,
  nominalCapitalUsd: 10000,
  deployedUsd: 9900,
  pnlUsd: 0,
  feesUsd: 0,
  costsUsd: 0,
  activePercent: 0,
  excessOriginalHoldUsd: 0,
  excessPreparedHoldUsd: 0,
  pnlFromDecisionUsd: 0,
  explanation:
    "Explicitly mocked values used to verify historical panel rendering.",
  chain: "Ethereum",
  pool: candidate.address,
  maximumSharePercent: 0,
  lowerPrice: 25,
  upperPrice: 35,
  tickLower: 0,
  tickUpper: 10,
  limitations: [
    "Browser rendering fixture only; not market evidence or an investment result.",
  ],
  sourceFiles: [],
};

async function mockSearchApi(
  page: Page,
  handle: (route: Route) => Promise<void>,
) {
  await page.route("**/api/noria**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") === "networks")
      return route.fulfill({
        json: {
          networks: [
            { id: "ethereum", label: "Ethereum", available: true },
            { id: "base", label: "Base", available: true },
            { id: "arbitrum", label: "Arbitrum", available: true },
            { id: "unichain", label: "Unichain", available: true },
          ],
        },
      });
    // The history panel uses a disclosed rendering fixture; no browser check calls a live API.
    if (
      route.request().method() === "GET" &&
      url.searchParams.get("view") !== "pools"
    )
      return route.fulfill({ json: historicalFixture });
    await handle(route);
  });
}

function arbitrumDiscovery(
  overrides: Partial<DiscoveryResult["discovery"]> = {},
): DiscoveryResult["discovery"] {
  return {
    network: "arbitrum",
    provider: "The Graph search fixture",
    sourceBlock: 123456,
    receivedAt: snapshot.receivedAt,
    pools: [],
    considered: 0,
    selectedReason: "No pool records matched this bounded search.",
    limitations: [
      "Mocked bounded scan of up to 40 pools; not every pool on the network is scanned.",
    ],
    rejected: [],
    ...overrides,
  };
}

test("manual search distinguishes filtered pools from zero records and lets inputs or the search be revised", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(at * 1000) });
  const sent: string[] = [];
  const liquidityReason =
    "Discovery liquidity and recurring-activity thresholds were not met.";
  const priceReason =
    "USD price references were unavailable for this candidate.";
  const rejected = Array.from({ length: 40 }, (_, i) => ({
    address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
    reason: i < 20 ? liquidityReason : priceReason,
  }));
  await mockSearchApi(page, async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("network")).toBe("arbitrum");
    const query = url.searchParams.get("q") ?? "";
    sent.push(query);
    await route.fulfill({
      json:
        query === "NOTLISTED"
          ? arbitrumDiscovery()
          : arbitrumDiscovery({
              considered: 40,
              rejected,
              selectedReason:
                "No pool met the discovery filters in this bounded scan.",
            }),
    });
  });
  await page.goto("/");
  await page.getByLabel("Network", { exact: true }).selectOption("arbitrum");
  const preference = page.getByRole("searchbox", { name: /Pool preference/ });
  await preference.fill("USDC");
  await page
    .getByText("Advanced: choose a pool yourself", { exact: true })
    .click();
  await page.getByRole("button", { name: "Search pools", exact: true }).click();
  const results = page.getByRole("region", {
    name: "Manual pool search results",
    exact: true,
  });
  await expect(
    results.getByRole("heading", {
      name: "Pools found, but none passed the search filters",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    results.getByText("40 pools considered", { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText("0 candidates listed", { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText("40 with exclusion reasons", { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText("The Graph search fixture · block 123,456", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    results
      .getByRole("list")
      .first()
      .getByText(liquidityReason, { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByRole("list").first().getByText(priceReason, { exact: true }),
  ).toBeVisible();
  await expect(results.getByText("20 pools", { exact: true })).toHaveCount(2);
  await results
    .getByText("Inspect pool addresses and individual reasons", { exact: true })
    .click();
  await expect(
    results.getByText(rejected[0].address, { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await results
    .getByRole("button", { name: "Search again", exact: true })
    .click();
  await expect(
    results.getByText("40 pools considered", { exact: true }),
  ).toBeVisible();
  expect(sent).toEqual(["USDC", "USDC"]);
  await results
    .getByRole("button", { name: "Review search inputs", exact: true })
    .click();
  await expect(preference).toBeFocused();
  await preference.fill("NOTLISTED");
  await expect(results).toHaveCount(0);
  await page.getByRole("button", { name: "Search pools", exact: true }).click();
  await expect(
    results.getByRole("heading", {
      name: "No pools found in this search",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    results.getByText("0 pools considered", { exact: true }),
  ).toBeVisible();
  await expect(results.getByText(liquidityReason, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    results.getByRole("heading", {
      name: "Why candidates were not selected",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByLabel("Network", { exact: true }).selectOption("ethereum");
  await expect(results).toHaveCount(0);
});

test("Arbitrum discovery without a query reveals source and exclusions and can be retried", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at * 1000) });
  let attempts = 0;
  const reason = "The indexed pool did not meet discovery activity thresholds.";
  await mockSearchApi(page, async (route) => {
    expect(route.request().method()).toBe("POST");
    const input = route.request().postDataJSON();
    expect(input.network).toBe("arbitrum");
    expect(input).not.toHaveProperty("query");
    expect(input).not.toHaveProperty("poolAddress");
    attempts++;
    await route.fulfill({
      json: {
        report: null,
        discovery: arbitrumDiscovery(
          attempts === 1
            ? {}
            : {
                considered: 40,
                rejected: Array.from({ length: 40 }, (_, i) => ({
                  address: `0x${(i + 1).toString(16).padStart(40, "0")}`,
                  reason,
                })),
                selectedReason:
                  "No pool met the discovery filters in this bounded scan.",
              },
        ),
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Network", { exact: true }).selectOption("arbitrum");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  const decision = page.getByRole("region", {
    name: "Pool discovery decision",
    exact: true,
  });
  await expect(
    decision.getByRole("heading", {
      name: "No range recommended",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    decision.getByRole("heading", {
      name: "No pools found in this search",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    decision.getByText("The Graph search fixture · block 123,456", {
      exact: true,
    }),
  ).toBeVisible();
  await decision
    .getByRole("button", { name: "Run discovery again", exact: true })
    .click();
  await expect(
    decision.getByRole("heading", {
      name: "Pools found, but none passed the search filters",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    decision.getByText("40 pools considered", { exact: true }),
  ).toBeVisible();
  await expect(
    decision.getByRole("list").first().getByText(reason, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No accepted candidate", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("No candidate met the checks.", { exact: true }),
  ).toHaveCount(0);
  await decision
    .getByRole("button", { name: "Review search inputs", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: /Pool preference/ }),
  ).toBeFocused();
});

test("editing the preference cancels a pending manual search and does not restore its old results", async ({
  page,
}) => {
  let releaseOldSearch!: () => void;
  const oldSearchGate = new Promise<void>((resolve) => {
    releaseOldSearch = resolve;
  });
  let finishOldSearch!: () => void;
  const oldSearchFinished = new Promise<void>((resolve) => {
    finishOldSearch = resolve;
  });
  let startOldSearch!: () => void;
  const oldSearchStarted = new Promise<void>((resolve) => {
    startOldSearch = resolve;
  });
  await mockSearchApi(page, async (route) => {
    if (new URL(route.request().url()).searchParams.get("q") === "USDC") {
      startOldSearch();
      await oldSearchGate;
      await route
        .fulfill({
          json: arbitrumDiscovery({
            considered: 40,
            rejected: [
              { address: candidate.address, reason: "Old search exclusion." },
            ],
          }),
        })
        .catch(() => {});
      finishOldSearch();
      return;
    }
    await route.fulfill({ json: arbitrumDiscovery() });
  });
  await page.goto("/");
  await page.getByLabel("Network", { exact: true }).selectOption("arbitrum");
  const preference = page.getByRole("searchbox", { name: /Pool preference/ });
  await preference.fill("USDC");
  await page
    .getByText("Advanced: choose a pool yourself", { exact: true })
    .click();
  await page.getByRole("button", { name: "Search pools", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Searching pools…", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("Searching indexed pools on Arbitrum…", { exact: true }),
  ).toBeVisible();
  await oldSearchStarted;
  await preference.fill("NEW");
  releaseOldSearch();
  await oldSearchFinished;
  await expect(
    page.getByRole("region", {
      name: "Manual pool search results",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Searching indexed pools on Arbitrum…", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Search pools", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "No pools found in this search",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Old search exclusion.", { exact: true }),
  ).toHaveCount(0);
});

test("failed full checks keep candidates analyzable and preserve the dated prior report with its own evidence", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at * 1000) });
  let discoveries = 0;
  const original = response({
    network: "ethereum",
    capitalUsd: 5000,
    intent: "earn-fees",
    horizonHours: 24,
  });
  original.report!.input.network = "arbitrum";
  original.report!.pool.network = "arbitrum";
  original.report!.pool.chain = "Arbitrum";
  const pools = Array.from({ length: 4 }, (_, i) => ({
    ...candidate,
    network: "arbitrum" as const,
    address:
      i === 0
        ? candidate.address
        : `0x${(i + 1).toString(16).padStart(40, "0")}`,
  }));
  const originalDiscovery = arbitrumDiscovery({
    pools: [pools[0]],
    considered: 40,
    selectedReason: "Original successful fixture discovery.",
  });
  const failedDiscovery = arbitrumDiscovery({
    pools,
    considered: 40,
    selectedReason:
      "The four highest-ranked candidates did not pass full range checks.",
    rejected: pools.map((pool) => ({
      address: pool.address,
      reason:
        "Initialized tick data could not be reconciled for this snapshot.",
    })),
  });
  await mockSearchApi(page, async (route) => {
    if (
      new URL(route.request().url()).searchParams.get("view") === "discover"
    ) {
      discoveries++;
      return route.fulfill({
        json: {
          report: discoveries === 1 ? original.report : null,
          discovery: discoveries === 1 ? originalDiscovery : failedDiscovery,
        },
      });
    }
    const input = route.request().postDataJSON();
    expect(input.poolAddress).toBe(candidate.address);
    expect(input.network).toBe("arbitrum");
    await route.fulfill({
      json: { ...original.report, id: `${original.report!.id}-manual-retry` },
    });
  });
  await page.goto("/");
  await page.getByLabel("Network", { exact: true }).selectOption("arbitrum");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  const decision = page.getByRole("region", {
    name: "Pool discovery decision",
    exact: true,
  });
  await expect(
    decision.getByRole("heading", {
      name: "No range recommended",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    decision
      .getByRole("list")
      .first()
      .getByText(
        "Initialized tick data could not be reconciled for this snapshot.",
        { exact: true },
      ),
  ).toBeVisible();
  await expect(
    page.getByText("Previous analysis — not refreshed", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Previous snapshot", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified snapshot", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toHaveCount(0);
  const retained = page
    .getByRole("status")
    .filter({ hasText: "Previous analysis — not refreshed" });
  await expect(retained).toContainText("Created");
  await expect(retained).toContainText("UTC");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const file = await download;
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(exported.report.id).toBe(original.report!.id);
  expect(exported.report.createdAt).toBe(original.report!.createdAt);
  expect(exported.report.validUntil).toBe(original.report!.validUntil);
  expect(exported.discovery).toEqual(originalDiscovery);
  const analyzeButtons = decision.getByRole("button", {
    name: "Analyze this pool",
    exact: true,
  });
  await expect(analyzeButtons).toHaveCount(4);
  await expect(analyzeButtons.first()).toBeEnabled();
  await analyzeButtons.first().click();
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Previous analysis — not refreshed", { exact: true }),
  ).toHaveCount(0);
  await expect(decision).toHaveCount(0);
});

test("an incomplete-history 422 explains the missing hours and keeps other shortlisted pools usable", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at * 1000) });
  const original = response({
    network: "ethereum",
    capitalUsd: 5000,
    intent: "earn-fees",
    horizonHours: 24,
  });
  const report = original.report!;
  report.input.network = "arbitrum";
  report.pool.network = "arbitrum";
  report.pool.chain = "Arbitrum";
  const accepted = { ...candidate, network: "arbitrum" as const };
  const incomplete = {
    ...accepted,
    address: `0x${"1".repeat(40)}`,
    token0: { ...accepted.token0, symbol: "WETH" },
    token1: { ...accepted.token1, symbol: "LINK" },
    feeTier: 3000,
  };
  const rejectedReason =
    "An excluded fixture pool did not meet the liquidity threshold.";
  const discovery = arbitrumDiscovery({
    pools: [accepted, incomplete],
    considered: 40,
    selectedReason:
      "A complete-history candidate is available in this mocked shortlist.",
    rejected: [{ address: `0x${"2".repeat(40)}`, reason: rejectedReason }],
  });
  const explanation =
    "Seven-day Graph history is incomplete (166/168 completed hours). This pool needs a complete hourly history before a range can be analyzed.";
  const analyzed: string[] = [];
  await mockSearchApi(page, async (route) => {
    if (new URL(route.request().url()).searchParams.get("view") === "pools")
      return route.fulfill({ json: discovery });
    if (new URL(route.request().url()).searchParams.get("view") === "discover")
      return route.fulfill({ json: { report, discovery } });
    const input = route.request().postDataJSON();
    expect(input.network).toBe("arbitrum");
    analyzed.push(input.poolAddress);
    if (input.poolAddress === incomplete.address)
      return route.fulfill({
        status: 422,
        json: { code: "incomplete-history", error: explanation },
      });
    expect(input.poolAddress).toBe(accepted.address);
    await route.fulfill({
      json: { ...report, id: `${report.id}-after-history-refusal` },
    });
  });
  await page.goto("/");
  await page.getByLabel("Network", { exact: true }).selectOption("arbitrum");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  await page
    .getByText("Inspect candidates, source & exclusions", { exact: true })
    .click();
  await page
    .getByRole("region", { name: "Pool discovery decision", exact: true })
    .getByRole("button", { name: "Analyze this pool", exact: true })
    .click();
  const refusal = page
    .getByRole("alert")
    .filter({ hasText: "This pool needs more history" });
  await expect(refusal).toBeVisible();
  await expect(refusal.getByText(explanation, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Live analysis could not be verified", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Previous analysis — not refreshed", { exact: true }),
  ).toBeVisible();
  const results = page.getByRole("region", {
    name: "Manual pool search results",
    exact: true,
  });
  const candidates = results.getByRole("button", {
    name: "Analyze this pool",
    exact: true,
  });
  const disclosure = results.locator("details").first();
  const disclosureSummary = results.getByText(
    "Inspect search candidates, source & exclusions",
    { exact: true },
  );
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(candidates).toHaveCount(2);
  await expect(candidates.first()).toBeEnabled();
  await expect(candidates.last()).toBeEnabled();
  await expect(
    results.getByText("The Graph search fixture · block 123,456", {
      exact: true,
    }),
  ).toBeVisible();
  await disclosureSummary.click();
  await expect(disclosure).toHaveJSProperty("open", false);
  await refusal
    .getByRole("link", { name: "Choose another candidate", exact: true })
    .click();
  await expect(results).toBeFocused();
  await expect(disclosure).toHaveJSProperty("open", true);
  await refusal
    .getByRole("button", { name: "Review search inputs", exact: true })
    .click();
  await expect(
    page.getByRole("searchbox", { name: /Pool preference/ }),
  ).toBeFocused();
  await candidates.first().click();
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  await expect(refusal).toHaveCount(0);
  await expect(
    page.getByText("Previous analysis — not refreshed", { exact: true }),
  ).toHaveCount(0);
  await expect(disclosure).toHaveJSProperty("open", false);
  await expect(disclosureSummary).toBeVisible();
  await expect(
    results.getByText("The Graph search fixture · block 123,456", {
      exact: true,
    }),
  ).not.toBeVisible();
  await expect(
    page.locator('section[aria-labelledby="plan-heading"]'),
  ).toBeFocused();
  await disclosureSummary.click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(
    results
      .getByRole("list")
      .first()
      .getByText(rejectedReason, { exact: true }),
  ).toBeVisible();
  await expect(
    results.getByText(discovery.limitations[0], { exact: true }),
  ).toBeVisible();
  await disclosureSummary.click();
  await expect(disclosure).toHaveJSProperty("open", false);
  await page
    .getByText("Advanced: choose a pool yourself", { exact: true })
    .click();
  await page.getByRole("button", { name: "Search pools", exact: true }).click();
  await expect(disclosure).toHaveJSProperty("open", true);
  await expect(
    results.getByText("The Graph search fixture · block 123,456", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    results.getByRole("button", { name: "Analyze this pool", exact: true }),
  ).toBeEnabled();
  expect(analyzed).toEqual([incomplete.address, accepted.address]);
});

test("RPC tick recovery shows its bounded interval and keeps provenance hashes in the evidence expansion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(at * 1000) });
  const supplied = response({
    network: "ethereum",
    capitalUsd: 5000,
    intent: "earn-fees",
    horizonHours: 24,
  });
  const report = supplied.report!;
  const tickEvidence: TickEvidence = {
    provider: "RPC",
    scope: "range-and-spot",
    poolAddress: report.pool.address,
    lowerTick: -12000,
    upperTick: 16000,
    bitmapWords: 12,
    tickCount: 112,
    graphTickCount: 565,
    reason: "Indexed tick rows did not form a valid liquidity distribution.",
    blockNumber: report.source.blockNumber,
    blockHash: report.source.blockHash,
    queryHash: "a".repeat(64),
    responseHash: "b".repeat(64),
  };
  report.source.ticks = tickEvidence;
  await mockSearchApi(page, async (route) => {
    await route.fulfill({ json: supplied });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  const recovery = page.getByRole("region", {
    name: "RPC tick recovery",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  await expect(
    recovery.getByRole("heading", {
      name: "Ticks recovered from RPC",
      exact: true,
    }),
  ).toBeVisible();
  await expect(recovery).toContainText("Ticks -12,000 through 16,000");
  await expect(recovery).toContainText(
    "RPC tick coverage is limited to the interval",
  );
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Live analysis could not be verified", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("RPC tick query SHA-256", { exact: true }),
  ).not.toBeVisible();
  await page
    .getByText("Inspect source & construction evidence", { exact: true })
    .click();
  const provenance = page.getByRole("region", {
    name: "Tick data provenance",
    exact: true,
  });
  await expect(provenance).toBeVisible();
  await expect(
    provenance.getByText("range-and-spot", { exact: true }),
  ).toBeVisible();
  await expect(provenance.getByText("112", { exact: true })).toBeVisible();
  await expect(provenance.getByText("565", { exact: true })).toBeVisible();
  await expect(provenance.getByText("12", { exact: true })).toBeVisible();
  await expect(provenance).toContainText(tickEvidence.reason);
  await expect(
    page.getByText("RPC tick query SHA-256", { exact: true }).locator(".."),
  ).toContainText(tickEvidence.queryHash);
  await expect(
    page.getByText("RPC tick response SHA-256", { exact: true }).locator(".."),
  ).toContainText(tickEvidence.responseHash);
  await expect(
    page.getByText("RPC tick block hash", { exact: true }).locator(".."),
  ).toContainText(tickEvidence.blockHash);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("mixed price providers preserve absent confidence and original quote timestamps", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at * 1000) });
  const supplied = response({
    network: "ethereum",
    capitalUsd: 5000,
    intent: "earn-fees",
    horizonHours: 24,
  });
  const report = supplied.report!;
  const quotes: PriceReferenceQuote[] = [
    {
      role: "token0",
      key: `ethereum:${report.pool.token0Address}`,
      symbol: report.pool.token0,
      usd: report.pool.token0Usd,
      timestamp: report.pool.priceTimestamp,
      confidence: 0.99,
      provider: "DeFiLlama contract prices",
    },
    {
      role: "token1",
      key: `ethereum:${report.pool.token1Address}`,
      symbol: report.pool.token1,
      usd: report.pool.token1Usd,
      timestamp: report.pool.priceTimestamp,
      confidence: null,
      provider: "CoinGecko contract prices",
    },
    {
      role: "gas",
      key: "coingecko:ethereum",
      symbol: "ETH",
      usd: report.pool.token1Usd,
      timestamp: report.pool.priceTimestamp,
      confidence: 0,
      provider: "DeFiLlama contract prices",
    },
  ];
  report.priceReferences = {
    ...report.priceReferences!,
    provider: "DeFiLlama + CoinGecko contract prices",
    quotes,
  };
  await mockSearchApi(page, async (route) => {
    await route.fulfill({ json: supplied });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await page
    .getByText("Inspect source & construction evidence", { exact: true })
    .click();
  const references = page.getByRole("region", {
    name: "Individual USD references",
    exact: true,
  });
  const fallbackQuote = references.getByRole("group", {
    name: `${report.pool.token1} token1 USD reference`,
    exact: true,
  });
  await expect(
    fallbackQuote.getByText("CoinGecko contract prices", { exact: true }),
  ).toBeVisible();
  await expect(
    fallbackQuote.getByText("Not supplied by provider", { exact: true }),
  ).toBeVisible();
  await expect(
    fallbackQuote.getByText("0 · provider field, not a probability", {
      exact: true,
    }),
  ).toHaveCount(0);
  const numericQuote = references.getByRole("group", {
    name: `${report.pool.token0} token0 USD reference`,
    exact: true,
  });
  await expect(
    numericQuote.getByText("DeFiLlama contract prices", { exact: true }),
  ).toBeVisible();
  await expect(
    numericQuote.getByText("0.99 · provider field, not a probability", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    references
      .getByRole("group", { name: "ETH gas USD reference", exact: true })
      .getByText("0 · provider field, not a probability", { exact: true }),
  ).toBeVisible();
  const quotedAt = fallbackQuote
    .getByText("Quoted at", { exact: true })
    .locator("..")
    .locator("dd");
  const originalTimestamp = await quotedAt.textContent();
  await page.clock.fastForward(10000);
  await expect(quotedAt).toHaveText(originalTimestamp!);
  await expect(
    page.getByText("Collection duration", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Graph request duration", { exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const file = await download;
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(exported.report.priceReferences.quotes).toEqual(quotes);
  expect(exported.report.priceReferences.quotes[1].confidence).toBeNull();
  expect(exported.report.validUntil).toBe(report.validUntil);
});

test("older price quotes without their own provider retain the recorded report provider", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(at * 1000) });
  const supplied = response({
    network: "ethereum",
    capitalUsd: 5000,
    intent: "earn-fees",
    horizonHours: 24,
  });
  const report = supplied.report!;
  report.priceReferences = {
    ...report.priceReferences!,
    provider: "DeFiLlama contract prices",
    quotes: [
      {
        role: "token0",
        key: `ethereum:${report.pool.token0Address}`,
        symbol: report.pool.token0,
        usd: report.pool.token0Usd,
        timestamp: report.pool.priceTimestamp,
        confidence: 0.99,
      },
    ],
  };
  await mockSearchApi(page, async (route) => {
    await route.fulfill({ json: supplied });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await page
    .getByText("Inspect source & construction evidence", { exact: true })
    .click();
  const quote = page.getByRole("group", {
    name: `${report.pool.token0} token0 USD reference`,
    exact: true,
  });
  await expect(
    quote.getByText("DeFiLlama contract prices", { exact: true }),
  ).toBeVisible();
  await expect(
    quote.getByText("0.99 · provider field, not a probability", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    quote.getByText("Not supplied by provider", { exact: true }),
  ).toHaveCount(0);
});

test("discover without a pool input; display candidates, expiry, refusal and clear state on network change", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install({ time: new Date(at * 1000) });
  let fail = false,
    noRecommendation = false;
  const sent: any[] = [];
  await mockSearchApi(page, async (route) => {
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Test provider unavailable" },
      });
    const input = route.request().postDataJSON();
    sent.push(input);
    const { query, ...args } = input;
    const result = response(args);
    if (noRecommendation) {
      result.report = null;
      result.discovery.selectedReason = "No candidate passed full range checks";
      result.discovery.rejected = [
        {
          address: candidate.address,
          reason: "Range exceeds the capacity policy",
        },
      ];
    }
    return route.fulfill({ json: result });
  });
  await page.goto("/");
  await expect(
    page.getByText("NO POOL IS PRESELECTED", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("$9,952.65", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "$1,000", exact: true }).click();
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Range above market", { exact: true }),
  ).toBeVisible();
  expect(sent[0]).not.toHaveProperty("poolAddress");
  expect(sent[0].network).toBe("ethereum");
  await page.getByRole("button", { name: /Planned conversion/ }).click();
  await page.getByLabel("Entry discount", { exact: true }).fill("100");
  await expect(page.getByText(/Your inputs changed/)).toBeVisible();
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Range below market", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Mechanically feasible", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^noria-.*\.json$/);
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(exported.discovery.considered).toBe(12);
  expect(exported.report.pool.address).toBe(candidate.address);
  expect(exported.report.id).toBe(exported.id);
  await page.clock.fastForward(180000);
  await expect(
    page.getByText("Expired snapshot", { exact: true }),
  ).toBeVisible();
  fail = true;
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Test provider unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified snapshot", { exact: true }),
  ).toHaveCount(0);
  fail = false;
  noRecommendation = true;
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "No range recommended", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Network", { exact: true }).selectOption("base");
  await expect(
    page.getByText("Discovery enabled on Base", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: /Polygon|Robinhood/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText("No range recommended", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile discovery exposes network choice and fits results without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(at * 1000) });
  await mockSearchApi(page, async (route) => {
    const { query, ...input } = route.request().postDataJSON();
    return route.fulfill({ json: response(input, 329) });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  await expect(
    page.getByText("Pool & range recommendation", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Aged USD price references",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByText("Inspect candidates, source & exclusions", { exact: true })
    .click();
  await page
    .getByText("Inspect source & construction evidence", { exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: ".runtime/browser-discovery-mobile.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", { name: /connect|sign|execute|mint/i }),
  ).toHaveCount(0);
});

test("a 329-second reference is visibly aged and its downloaded timestamps remain original", async ({
  page,
}) => {
  await page.clock.install({ time: new Date((at - 1) * 1000) });
  await page.clock.pauseAt(new Date(at * 1000));
  let supplied: DiscoveryResult | undefined;
  await mockSearchApi(page, async (route) => {
    const { query, ...input } = route.request().postDataJSON();
    supplied = response(input, 329);
    return route.fulfill({ json: supplied });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  const references = page.getByRole("region", {
    name: "Aged USD price references",
    exact: true,
  });
  await expect(references).toBeVisible();
  expect(
    await references.evaluate((node) => node.closest("details") === null),
  ).toBe(true);
  await expect(
    references.getByText("329 seconds", { exact: true }),
  ).toBeVisible();
  await expect(
    references.getByText("DeFiLlama contract prices", { exact: true }),
  ).toBeVisible();
  await expect(
    references.getByText(
      "At least one USD reference is between 5 and 15 minutes old. Inventory and cost estimates include aged quotes.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    references.getByText(/Aged references are not current quotes/),
  ).toBeVisible();
  await expect(
    page.getByText("Verified with price caveat", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Graph/RPC matched · review USD references", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified snapshot", { exact: true }),
  ).toHaveCount(0);
  const quotedAt = references
    .getByText("Oldest quoted at", { exact: true })
    .locator("..")
    .locator("dd");
  const originalText = await quotedAt.textContent();
  expect(originalText).toContain("UTC");
  await page.clock.fastForward(10000);
  await expect(
    references.getByText("339 seconds", { exact: true }),
  ).toBeVisible();
  await expect(quotedAt).toHaveText(originalText!);
  await page
    .getByText("Inspect source & construction evidence", { exact: true })
    .click();
  const consistency = page.getByRole("region", {
    name: "USD reference consistency",
    exact: true,
  });
  await expect(
    consistency.getByText("2% tolerance", { exact: true }),
  ).toBeVisible();
  await expect(
    consistency.getByText(
      /not a second USD source or a guarantee of absolute price accuracy/,
    ),
  ).toBeVisible();
  const quotes = page.getByRole("region", {
    name: "Individual USD references",
    exact: true,
  });
  await expect(
    quotes.getByText(/Individual quote details were not included/),
  ).toBeVisible();
  await expect(
    quotes.getByText("Provider confidence", { exact: true }),
  ).toHaveCount(0);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const file = await download;
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(exported.report.priceReferences.oldestTimestamp).toBe(at - 329);
  expect(exported.report.priceReferences.ageSeconds).toBe(329);
  expect(exported.report.priceReferences.freshness).toBe("aged");
  expect(exported.report.priceReferences.quotes).toEqual([]);
  expect(exported.report.pool.priceTimestamp).toBe(at - 329);
  expect(exported.report.validUntil).toBe(supplied!.report!.validUntil);
  expect(exported.report.id).toBe(supplied!.report!.id);
});

test("the clock changes fresh references to aged without renewing report validity or quote timestamps", async ({
  page,
}) => {
  await page.clock.install({ time: new Date((at - 1) * 1000) });
  await page.clock.pauseAt(new Date(at * 1000));
  let supplied: DiscoveryResult | undefined;
  await mockSearchApi(page, async (route) => {
    const { query, ...input } = route.request().postDataJSON();
    supplied = response(input, 300);
    return route.fulfill({ json: supplied });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Find a pool & range", exact: true })
    .click();
  const references = page.locator(
    'section[aria-labelledby="price-references-heading"]',
  );
  await expect(
    page.getByRole("heading", { name: "USD price references", exact: true }),
  ).toBeVisible();
  await expect(
    references.getByText("300 seconds", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified snapshot", { exact: true }),
  ).toBeVisible();
  const quotedAt = references
    .getByText("Oldest quoted at", { exact: true })
    .locator("..")
    .locator("dd");
  const originalText = await quotedAt.textContent();
  await page.clock.fastForward(1000);
  await expect(
    page.getByRole("heading", {
      name: "Aged USD price references",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    references.getByText("301 seconds", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Verified with price caveat", { exact: true }),
  ).toBeVisible();
  await expect(quotedAt).toHaveText(originalText!);
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download JSON", exact: true })
    .click();
  const file = await download;
  const exported = JSON.parse(readFileSync((await file.path())!, "utf8"));
  expect(exported.report.priceReferences.oldestTimestamp).toBe(at - 300);
  expect(exported.report.priceReferences.ageSeconds).toBe(300);
  expect(exported.report.priceReferences.freshness).toBe("fresh");
  expect(exported.report.pool.priceTimestamp).toBe(at - 300);
  expect(exported.report.validUntil).toBe(supplied!.report!.validUntil);
  expect(exported.report.id).toBe(supplied!.report!.id);
  await page.clock.fastForward(60000);
  await expect(
    page.getByText("Expired snapshot", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Aged USD price references",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    references.getByText("361 seconds", { exact: true }),
  ).toBeVisible();
});

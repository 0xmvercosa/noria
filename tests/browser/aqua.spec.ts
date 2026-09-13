import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Snapshot } from "../../src/domain/analysis-data";
import type { AquaRequest } from "../../src/integrations/aqua/contract";
import { AQUA_SCOPE } from "../../src/integrations/aqua/contract";
import { createAquaRecommendationService } from "../../src/integrations/aqua/service";

const snapshot: Snapshot = JSON.parse(
  readFileSync(
    "tests/fixtures/arbitrum/0xc6962004f452be9203591991d15f6b388e09e8d0.json",
    "utf8",
  ),
);
const now = Math.ceil(Date.parse(snapshot.receivedAt) / 1000);
const recommend = createAquaRecommendationService({
  now: () => now,
  snapshot: async () => structuredClone(snapshot),
  search: async () => ({
    network: "arbitrum",
    provider: "offline browser fixture",
    sourceBlock: snapshot.data._meta.block.number,
    receivedAt: snapshot.receivedAt,
    considered: 1,
    selectedReason: "Fixture",
    limitations: ["Offline browser test"],
    rejected: [],
    pools: [
      {
        network: "arbitrum",
        address: snapshot.data.pool.id,
        token0: AQUA_SCOPE.weth,
        token1: AQUA_SCOPE.usdc,
        feeTier: 500,
        tvlUsd: 1e6,
        volume24hUsd: 1e6,
        activeHours: 24,
        score: 80,
        reasons: ["Synthetic fixture ranking"],
      },
    ],
  }),
});

test("Aqua discovers from USDC funding and preserves dollar amounts, contract identity and expiry", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(now * 1000) });
  const requests: AquaRequest[] = [];
  await page.route("**/api/aqua/v1/recommendation", async (route) => {
    const input = route.request().postDataJSON() as AquaRequest;
    requests.push(input);
    await route.fulfill({ json: await recommend(input) });
  });
  await page.goto("/aqua");
  await expect(
    page.getByRole("heading", { name: "Your pool comes from the search" }),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  for (const capital of ["1000", "5000", "10000"]) {
    await page.getByLabel("Available USDC").fill(capital);
    await page
      .getByRole("button", { name: "Find a reference strategy" })
      .click();
    await expect(
      page.getByRole("heading", { name: "WETH / USDC 0.05%" }),
    ).toBeVisible();
    const sent = requests.at(-1)!;
    expect(sent.chainId).toBe(42161);
    expect(sent.funding.amountRaw).toBe(`${capital}000000`);
    expect(sent.funding.tokenAddress).toBe(AQUA_SCOPE.usdc.address);
    expect(sent).not.toHaveProperty("poolAddress");
  }
  await expect(
    page.getByText("A USDC → WETH preparation swap must be quoted", {
      exact: false,
    }),
  ).toBeVisible();
  await page.clock.fastForward(61_000);
  await expect(
    page.getByText("Evidence expired · refresh the analysis"),
  ).toBeVisible();
  await page.getByLabel("Available USDC").fill("1200");
  await expect(
    page.getByRole("heading", { name: "Your pool comes from the search" }),
  ).toBeVisible();
});

test("Aqua buy ranges retain waiting status and a capacity refusal at larger funding", async ({
  page,
}) => {
  await page.clock.install({ time: new Date(now * 1000) });
  await page.route("**/api/aqua/v1/recommendation", async (route) =>
    route.fulfill({ json: await recommend(route.request().postDataJSON()) }),
  );
  await page.goto("/aqua");
  await page.getByLabel("Objective").selectOption("buy-eth");
  await page.getByRole("button", { name: "Find a reference strategy" }).click();
  await expect(page.getByText("Range waiting · feasible")).toBeVisible();
  await expect(
    page.getByText("This range initially requires USDC only.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByLabel("Available USDC").fill("10000");
  await page.getByRole("button", { name: "Find a reference strategy" }).click();
  await expect(
    page.getByRole("heading", { name: "No reference strategy recommended" }),
  ).toBeVisible();
  await page.getByText("Selection, exclusions and complete response").click();
  await expect(
    page.getByText(/Range exceeds the 1% per-segment/, { exact: false }),
  ).toBeVisible();
});

test("Aqua mobile preview validates fractional amounts and exposes actionable source failure", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/aqua/v1/recommendation", async (route) =>
    route.fulfill({
      status: 503,
      json: {
        schemaVersion: "noria.aqua.v1",
        status: "unavailable",
        code: "source-unavailable",
        message: "The Graph is temporarily unavailable.",
      },
    }),
  );
  await page.goto("/aqua");
  await page.getByLabel("Available USDC").fill("0.01");
  await expect(
    page.getByRole("button", { name: "Find a reference strategy" }),
  ).toBeDisabled();
  await page.getByLabel("Available USDC").fill("1234.56789");
  await page.getByRole("button", { name: "Find a reference strategy" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Analysis unavailable" }),
  ).toContainText("The Graph is temporarily unavailable.");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("Aqua publishes capabilities and a machine-readable request contract without provider calls", async ({
  request,
}) => {
  const capability = await request.get("/api/aqua/v1/recommendation");
  expect(capability.ok()).toBe(true);
  expect((await capability.json()).scope.chainId).toBe(42161);
  const specification = await request.get("/aqua/openapi.json");
  expect(specification.ok()).toBe(true);
  expect((await specification.json()).openapi).toBe("3.1.0");
});

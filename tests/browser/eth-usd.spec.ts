import { test, expect } from "@playwright/test";

const at = new Date("2026-09-13T12:00:00Z");
const quote = {
  status: "available",
  reference: {
    usd: "2500",
    provider: "Browser price fixture",
    timestamp: Math.floor(at.getTime() / 1000),
  },
};

test("ETH input equivalents use a quote without changing exact transfer or collateral amounts", async ({
  page,
}) => {
  await page.clock.install({ time: at });
  await page.route("**/api/market/eth-usd", (route) =>
    route.fulfill({ json: quote }),
  );
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/reserve");
  await page.getByLabel("Asset to send", { exact: true }).selectOption("ETH");
  const transfer = page.getByLabel("Amount to send (ETH)");
  await transfer.fill("0.000398882932576");
  await expect(page.getByText("($1.00)", { exact: true })).toBeVisible();
  await expect(transfer).toHaveValue("0.000398882932576");
  await expect(
    page.getByText(/ETH\/WETH dollar estimates: Browser price fixture/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/aqua");
  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("ETH");
  const collateral = page.getByLabel("Collateral amount (ETH)");
  await collateral.fill("0.100000000000000001");
  await expect(page.getByText("($250.00)", { exact: true })).toBeVisible();
  await expect(collateral).toHaveValue("0.100000000000000001");
});

test("missing USD prices remain explicit and do not hide the ETH amount", async ({
  page,
}) => {
  await page.route("**/api/market/eth-usd", (route) =>
    route.fulfill({ json: { status: "unavailable" } }),
  );
  await page.goto("/reserve");
  await page.getByLabel("Asset to send", { exact: true }).selectOption("ETH");
  await page.getByLabel("Amount to send (ETH)").fill("0.001");
  await expect(
    page.getByText("(USD unavailable)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("($0.00)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Amount to send (ETH)")).toHaveValue("0.001");
});

test("a displayed reference ages and expires even if refresh requests fail", async ({
  page,
}) => {
  await page.clock.install({ time: at });
  let calls = 0;
  await page.route("**/api/market/eth-usd", (route) => {
    calls++;
    return calls === 1 ? route.fulfill({ json: quote }) : route.abort();
  });
  await page.goto("/reserve");
  await page.getByLabel("Asset to send", { exact: true }).selectOption("ETH");
  await page.getByLabel("Amount to send (ETH)").fill("1");
  await expect(page.getByText("($2,500.00)", { exact: true })).toBeVisible();
  await page.clock.fastForward(301_000);
  await expect(
    page.getByText(/This reference is over five minutes old/),
  ).toBeVisible();
  await page.clock.fastForward(600_000);
  await expect(
    page.getByText("(USD unavailable)", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("($2,500.00)", { exact: true })).toHaveCount(0);
});

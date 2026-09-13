import { test, expect } from "@playwright/test";

test("reserve explains real custody and disables unconfigured Privy without sending financial requests", async ({
  page,
}) => {
  test.skip(
    Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID),
    "This scenario requires an unconfigured public App ID.",
  );
  const requests: string[] = [];
  page.on("request", (request) => {
    if (/privy\.io|\/api\/privy\//.test(request.url()))
      requests.push(request.url());
  });
  await page.goto("/reserve");
  await expect(
    page.getByRole("heading", { name: "Your USDC. Ready for your next move." }),
  ).toBeVisible();
  await expect(
    page.getByText("Wallet unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Privy is not configured for this deployment.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("No transactions recorded in this browser", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("This flow uses real USDC and ETH on Arbitrum One.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Your live reserve is not moved or borrowed against by the rehearsal.",
      { exact: false },
    ),
  ).toBeVisible();
  await page.getByLabel("Operation", { exact: true }).selectOption("withdraw");
  await page.getByLabel("Amount (USDC)").fill("1.000001");
  await expect(
    page.getByRole("button", { name: "Review withdrawal", exact: true }),
  ).toBeDisabled();
  expect(requests).toEqual([]);
});

test("reserve passes only the chosen USDC amount into Aqua's existing collateral planner", async ({
  page,
}) => {
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/reserve");
  await page.getByLabel("Amount (USDC)").fill("12.345678");
  await page.getByRole("link", { name: "Plan an Aqua position" }).click();
  await expect(
    page.getByLabel("Collateral asset", { exact: true }),
  ).toHaveValue("USDC");
  await expect(page.getByLabel("Collateral amount (USDC)")).toHaveValue(
    "12.345678",
  );
  await expect(
    page.getByRole("button", { name: "Run local rehearsal", exact: true }),
  ).toBeDisabled();
});

test("mobile reserve has no horizontal overflow and exposes canonical custody details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reserve");
  await page
    .getByText("Supported contracts and custody", { exact: true })
    .click();
  await expect(
    page.getByText("0xaf88d065e77c8cc2239327c5edb3a432268e5831", {
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("public reserve API rejects arbitrary execution requests and has no send endpoint", async ({
  request,
}) => {
  const response = await request.post("/api/privy/v1/reserve", {
    data: {
      operation: "sendTransaction",
      to: "0x1111111111111111111111111111111111111111",
      data: "0x",
    },
  });
  expect(response.status()).toBe(400);
  expect(response.headers()["cache-control"]).toBe("no-store");
});

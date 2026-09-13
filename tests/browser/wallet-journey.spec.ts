import { test, expect } from "@playwright/test";

test("every app document has an uncached, fresh CSP nonce and security headers", async ({
  request,
  page,
}) => {
  const nonces = new Set<string>();
  for (const path of [
    "/",
    "/aqua",
    "/reserve",
    "/agent",
    "/auth/callback",
    "/reserve",
  ]) {
    const response = await request.get(path, {
      headers: { "x-nonce": "visitor-supplied" },
    });
    expect(response.ok()).toBe(true);
    const policy = response.headers()["content-security-policy"];
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(nonce).not.toBe("visitor-supplied");
    expect(nonces.has(nonce!)).toBe(false);
    nonces.add(nonce!);
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(policy).not.toContain("'unsafe-eval'");
    const html = await response.text();
    const scripts = html.match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`);
  }
  // Simulate parser-inserted HTML from an XSS. CDP evaluate has browser-level
  // privileges and is not a valid way to test page CSP enforcement.
  await page.route("**/reserve", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(
        "</body>",
        "<script>window.__noriaUntrustedScriptRan = true</script></body>",
      ),
    });
  });
  await page.goto("/reserve");
  await page.getByLabel("Amount (USDC)").fill("12.345678");
  await page.getByLabel("Amount (USDC)").blur();
  await expect(page.getByLabel("Amount (USDC)")).toHaveValue("12.345678");
  expect(await page.evaluate(() => "__noriaUntrustedScriptRan" in window)).toBe(
    false,
  );
});

test("funding navigation preserves only planner inputs and explains optional savings", async ({
  page,
}) => {
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/aqua");
  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("ETH");
  await page.getByLabel("Collateral amount (ETH)").fill("0.100000000000000001");
  await page.getByLabel("Safety health factor", { exact: true }).fill("1.5");
  await page.getByRole("link", { name: "Wallet & funds", exact: true }).click();
  await expect(
    page.getByText("Savings below are optional", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Review an Aqua position", exact: true })
    .click();
  await expect(page.getByLabel("Collateral amount (ETH)")).toHaveValue(
    "0.100000000000000001",
  );
  await expect(
    page.getByLabel("Safety health factor", { exact: true }),
  ).toHaveValue("1.5");
  await expect(
    page.getByText("Your saved inputs were restored.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Plan ready for review", { exact: false }),
  ).toHaveCount(0);
  await page.goto("/aqua?collateralUSDC=12.345678");
  await expect(
    page.getByLabel("Collateral asset", { exact: true }),
  ).toHaveValue("USDC");
  await expect(page.getByLabel("Collateral amount (USDC)")).toHaveValue(
    "12.345678",
  );
  await expect(page).toHaveURL(/\/aqua$/);
  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("ETH");
  await page.getByLabel("Collateral amount (ETH)").fill("0.25");
  await page.reload();
  await expect(page.getByLabel("Collateral amount (ETH)")).toHaveValue("0.25");
});

test("a failed Privy initialization offers recovery without erasing saved operations", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    "Requires a configured public App ID.",
  );
  await page.route("https://auth.privy.io/**", (route) => route.abort());
  await page.goto("/reserve");
  await page.evaluate(() =>
    localStorage.setItem("noria.test.preserved", "receipt"),
  );
  const retry = page.getByRole("button", {
    name: "Retry wallet connection",
    exact: true,
  });
  await expect(retry).toBeVisible({ timeout: 25_000 });
  await page
    .getByRole("button", { name: "Dismiss message", exact: true })
    .click();
  // Closing the mobile error sheet must leave recovery available in the header.
  await expect(retry).toBeVisible();
  await expect(retry).toBeEnabled();
  await retry.click();
  expect(
    await page.evaluate(() => localStorage.getItem("noria.test.preserved")),
  ).toBe("receipt");
  await expect(
    page.getByRole("heading", { name: "Your USDC. Ready for your next move." }),
  ).toBeVisible();
});

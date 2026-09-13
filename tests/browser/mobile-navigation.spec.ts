import { test, expect, type Page } from "@playwright/test";

const links = [
  { name: /^Discover pools/, href: "/" },
  { name: /^Aqua positions/, href: "/aqua" },
  { name: /^Wallet & funds/, href: "/reserve" },
  { name: /^Buy with euros/, href: "/reserve#fund-heading" },
  { name: /^For agents/, href: "/agent" },
];
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

for (const width of [320, 375, 390, 768, 1100, 1101, 1440]) {
  test(`all product destinations and Privy access remain available at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
      route.fulfill({ json: { enabled: false } }),
    );
    for (const [path, active] of [
      ["/", /^Discover pools/],
      ["/aqua", /^Aqua positions/],
      ["/reserve", /^Wallet & funds/],
      ["/agent", /^For agents/],
    ] as const) {
      await page.goto(path);
      const header = page.getByRole("banner");
      await expect(
        header.getByRole("link", { name: "Noria home" }),
      ).toBeVisible();
      if (process.env.NEXT_PUBLIC_PRIVY_APP_ID) {
        await expect(
          header.getByRole("button", {
            name: /Create or open wallet|Loading wallet/,
          }),
        ).toBeVisible();
      } else
        await expect(
          header.getByText("Wallet unavailable", { exact: true }),
        ).toBeVisible();
      if (width <= 1100) {
        const trigger = header.getByRole("button", {
          name: "Open navigation menu",
        });
        await expect(trigger).toHaveAttribute("aria-expanded", "false");
        await trigger.click();
        await expect(
          header.getByRole("button", { name: "Close navigation menu" }),
        ).toHaveAttribute("aria-expanded", "true");
      }
      const navigation = header.getByRole("navigation", {
        name: "Main navigation",
      });
      for (const link of links) {
        const item = navigation.getByRole("link", { name: link.name });
        await expect(item).toBeVisible();
        await expect(item).toHaveAttribute("href", link.href);
        expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await expect(
        navigation.getByRole("link", { name: active }),
      ).toHaveAttribute("aria-current", "page");
      if (width > 1100)
        await navigation.getByText("More", { exact: true }).click();
      for (const name of [
        "Workspace",
        "Historical case",
        "Agent toolkit",
        "Graph API",
      ])
        await expect(
          navigation.getByRole("link", { name, exact: true }),
        ).toBeVisible();
      await noOverflow(page);
    }
  });
}

test("phone menu supports keyboard closing, page navigation and the EUR funding handoff", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 667 });
  const sends: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      /\/api\/(privy|aqua)\//.test(request.url())
    )
      sends.push(request.url());
  });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open navigation menu" });
  await trigger.click();
  await page.keyboard.press("Tab");
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /^Discover pools/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Aqua positions/ })
    .click();
  await expect(page).toHaveURL(/\/aqua$/);
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /^Buy with euros/ })
    .click();
  await expect(page).toHaveURL(/\/reserve#fund-heading$/);
  await expect(
    page.getByRole("heading", { name: "Add funds", exact: true }),
  ).toBeInViewport();
  await page.getByLabel("Amount to send (USDC)").fill("123456.123456");
  await expect(page.getByLabel("Amount to send (USDC)")).toHaveValue(
    "123456.123456",
  );
  const field = page.getByLabel("Recipient address");
  await field.fill("0x1111111111111111111111111111111111111111");
  expect(
    await field.evaluate((element) => getComputedStyle(element).fontSize),
  ).toBe("16px");
  await noOverflow(page);
  expect(sends).toEqual([]);
});

test("menu survives orientation changes without duplicate visible navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reserve");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: /navigation menu/ }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 420 });
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await page
    .getByRole("link", { name: "Graph API", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    page.getByRole("link", { name: "Graph API", exact: true }),
  ).toBeInViewport();
  await noOverflow(page);
});

test("the real Privy login remains reachable from mobile discovery", async ({
  page,
}) => {
  test.skip(
    !process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    "Requires the configured public Privy App ID.",
  );
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/");
  const login = page
    .getByRole("banner")
    .getByRole("button", { name: "Create or open wallet", exact: true });
  await expect(login).toBeEnabled({ timeout: 20_000 });
  await login.click();
  const dialog = page.getByRole("dialog", { name: "log in or sign up" });
  // The mobile SDK wrapper has zero height around fixed-position children.
  // Assert the actual controls users see, including their viewport bounds.
  await expect(
    dialog.getByRole("button", { name: "Google", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole("button", { name: "Continue with a wallet", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    dialog.getByRole("button", { name: "close modal", exact: true }),
  ).toBeInViewport();
  await expect(dialog.getByPlaceholder("your@email.com")).toBeInViewport({
    ratio: 1,
  });
  await noOverflow(page);
  await dialog
    .getByRole("button", { name: "close modal", exact: true })
    .click();
});

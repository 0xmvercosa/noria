import { test, expect } from "@playwright/test";

test("the agent section opens a working setup page with this deployment's MCP endpoint", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const agentSection = page.locator("#agent-toolkit");
  await expect(agentSection).toBeVisible();
  await agentSection.locator('a[href="/agent"]').click();
  await expect(page).toHaveURL(/\/agent$/);
  await expect(
    page.getByRole("heading", { name: "Connect your AI agent", exact: true }),
  ).toBeVisible();
  const endpoint = new URL("/api/mcp", page.url()).href;
  await expect(page.locator("code").filter({ hasText: endpoint })).toHaveText(
    endpoint,
  );
  await expect(page.locator('a[href="/agent/skill"]')).toBeVisible();
  await expect(page.locator('a[href="/api/noria?doc=agent"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test("the setup page copies the exact endpoint and workflow prompt to the clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/agent");
  const endpointButton = page.getByRole("button", { name: /copy endpoint/i });
  await expect(endpointButton).toBeEnabled();
  await endpointButton.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(new URL("/api/mcp", page.url()).href);
  await expect(endpointButton.locator("..").getByRole("status")).toContainText(
    /copied/i,
  );

  const prompt = await page.locator("pre").textContent();
  expect(prompt).toContain("noria_verify_report");
  const promptButton = page.getByRole("button", { name: /copy prompt/i });
  await promptButton.click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(prompt);
  await expect(promptButton.locator("..").getByRole("status")).toContainText(
    /copied/i,
  );
});

test("denied clipboard access offers manual copying without reporting false success", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException(
            "Clipboard permission denied",
            "NotAllowedError",
          );
        },
      },
    });
  });
  await page.goto("/agent");
  for (const name of [/copy endpoint/i, /copy prompt/i]) {
    const button = page.getByRole("button", { name });
    await button.click();
    const status = button.locator("..").getByRole("status");
    await expect(status).toContainText(/select.*copy/i);
    await expect(status).not.toContainText(/copied/i);
  }
  const endpoint = new URL("/api/mcp", page.url()).href;
  const text = page.locator("code").filter({ hasText: endpoint });
  await expect(text).toBeVisible();
  expect(
    await text.evaluate((element) => getComputedStyle(element).userSelect),
  ).not.toBe("none");
  const prompt = page.locator("pre");
  await expect(prompt).toBeVisible();
  expect(
    await prompt.evaluate((element) => getComputedStyle(element).userSelect),
  ).not.toBe("none");
});

test("agent instructions and downloadable skill are served by the production build", async ({
  request,
}) => {
  const instructions = await request.get("/api/noria?doc=agent");
  expect(instructions.ok()).toBe(true);
  expect(instructions.headers()["content-type"]).toMatch(
    /text\/(plain|markdown)/,
  );
  const instructionsText = await instructions.text();
  expect(instructionsText).toContain("/api/mcp");
  expect(instructionsText).toContain("noria_verify_report");

  const skill = await request.get("/agent/skill");
  expect(skill.ok()).toBe(true);
  expect(skill.headers()["content-type"]).toMatch(/text\/markdown/);
  expect(skill.headers()["content-disposition"]).toMatch(
    /attachment;.*SKILL\.md/,
  );
  expect(await skill.text()).toContain("noria_find_opportunity");

  const mcp = await request.post("/api/mcp", {
    headers: { Accept: "application/json, text/event-stream" },
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(mcp.ok()).toBe(true);
  const tools = (await mcp.json()).result.tools;
  expect(tools).toHaveLength(6);
  expect(
    tools.every(
      (tool: { annotations: { readOnlyHint: boolean } }) =>
        tool.annotations.readOnlyHint,
    ),
  ).toBe(true);
});

test("agent connection details fit a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/agent");
  await expect(
    page.getByRole("button", { name: /copy endpoint/i }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: /copy prompt/i }),
  ).toBeVisible();
  await page.screenshot({
    path: ".runtime/browser-agent-mobile.png",
    fullPage: true,
  });
});

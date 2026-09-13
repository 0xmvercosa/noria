import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

const owner = "0xc365B6795443380eb76516dA0Cedd5a00B349d66";
const hash = `0x${"f".repeat(64)}`;
async function setup(
  page: Page,
  options: {
    wrongWallet?: boolean;
    uncertain?: boolean;
    replaceOnBegin?: boolean;
  } = {},
) {
  const review = {
    stage: "adapter",
    owner,
    chainId: 42161,
    nonce: 42,
    expectedAddress: "0x1000000000000000000000000000000000000001",
    data: "0x6000",
    value: "0x0",
    gas: "0x100000",
    gasEstimate: "100000",
    estimatedFeeWei: "1000000000000",
    balanceWei: "1000000000000000",
    blockNumber: "1",
    blockHash: `0x${"a".repeat(64)}`,
    expiresAt: Date.now() + 120_000,
    constructorArgs: [],
    adapter: null,
  };
  const pending = {
    reviewId: "review-1",
    review,
    signingStarted: false,
    hash: null as string | null,
  };
  const state = {
    version: 1,
    owner,
    buildHash: `0x${"b".repeat(64)}`,
    adapter: null,
    factory: null,
    pending: structuredClone(pending),
    operations: [],
  };
  const calls: string[] = [];
  await page.addInitScript(
    ({ address, uncertain }) => {
      const host = window as unknown as { rabby: unknown; sent: unknown[] };
      host.sent = [];
      host.rabby = {
        isRabby: true,
        on() {},
        async request(input: { method: string; params: unknown[] }) {
          if (
            input.method === "eth_accounts" ||
            input.method === "eth_requestAccounts"
          )
            return [address];
          if (input.method === "eth_chainId") return "0xa4b1";
          if (input.method === "wallet_switchEthereumChain") return null;
          if (input.method === "eth_sendTransaction") {
            host.sent.push(input.params);
            if (uncertain) throw new Error("Ambiguous provider failure");
            return `0x${"f".repeat(64)}`;
          }
          throw new Error("Unexpected wallet request");
        },
      };
    },
    {
      address: options.wrongWallet
        ? "0x2000000000000000000000000000000000000002"
        : owner,
      uncertain: options.uncertain,
    },
  );
  await page.route("http://deploy.test/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const files: Record<string, [string, string]> = {
      "/": ["index.html", "text/html"],
      "/app.js": ["app.js", "text/javascript"],
      "/style.css": ["style.css", "text/css"],
    };
    if (files[path]) {
      await route.fulfill({
        body: await readFile(`scripts/deploy/${files[path][0]}`, "utf8"),
        contentType: files[path][1],
      });
      return;
    }
    const respond = (v: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(v),
      });
    if (path === "/api/state") {
      await respond({
        state,
        token: "local-test-token",
        balanceWei: review.balanceWei,
        price: {
          status: "available",
          reference: {
            usd: "2500",
            timestamp: Math.floor(Date.now() / 1000),
            provider: "fixture",
          },
        },
        reportPath: ".runtime/test.json",
      });
      return;
    }
    calls.push(path);
    const body = route.request().postDataJSON();
    if (body.reviewId !== state.pending.reviewId) {
      await respond({ error: "This review changed in another tab." }, 409);
      return;
    }
    if (path === "/api/begin") {
      state.pending.signingStarted = true;
      await respond({
        reviewId: state.pending.reviewId,
        review: options.replaceOnBegin
          ? { ...review, data: "0xdeadbeef" }
          : review,
      });
      return;
    }
    if (path === "/api/submitted") {
      state.pending.hash = body.hash;
      await respond({ saved: true });
      return;
    }
    await respond({ error: "Unexpected API request" }, 400);
  });
  await page.goto("http://deploy.test/");
  await expect(
    page
      .getByText(
        "Connect Rabby to begin. No wallet action occurs automatically.",
      )
      .or(
        page.getByText(
          "A saved operation needs your review. Do not repeat a pending deployment.",
        ),
      ),
  ).toBeVisible();
  return {
    state,
    calls,
    key: `noria-deploy-${owner}-${state.buildHash}-review-1`,
  };
}
const sent = (page: Page) =>
  page.evaluate(() => (window as unknown as { sent: unknown[] }).sent);

test("one explicit Rabby confirmation submits only the reviewed creation and retains its hash", async ({
  page,
}) => {
  const h = await setup(page);
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  expect(await sent(page)).toHaveLength(0);
  await page
    .getByRole("button", { name: "Confirm deployment in Rabby" })
    .click();
  await expect(
    page.getByText(/Transaction submitted. Wait for confirmation/),
  ).toBeVisible();
  expect(await sent(page)).toEqual([
    [
      {
        from: owner,
        data: h.state.pending.review.data,
        value: "0x0",
        chainId: "0xa4b1",
        nonce: "0x2a",
        gas: h.state.pending.review.gas,
      },
    ],
  ]);
  expect(h.state.pending.hash).toBe(hash);
  expect(await page.evaluate((key) => localStorage.getItem(key), h.key)).toBe(
    hash,
  );
  await expect(
    page.getByRole("button", { name: "Confirm deployment in Rabby" }),
  ).toBeHidden();
});

test("Rabby deployment requires the exact wallet, displays USD and fits mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await setup(page, { wrongWallet: true });
  await expect(
    page.getByText("Deployer balance: 0.001 ETH ($2.50)"),
  ).toBeVisible();
  expect(await sent(page)).toHaveLength(0);
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  await expect(
    page.getByRole("button", { name: "Confirm deployment in Rabby" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await sent(page)).toHaveLength(0);
});
test("stale review cannot sign a different server operation or erase its recovery hash", async ({
  page,
}) => {
  const h = await setup(page);
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  h.state.pending.reviewId = "review-2";
  const otherKey = h.key.replace("review-1", "review-2");
  await page.evaluate(({ key, hash }) => localStorage.setItem(key, hash), {
    key: otherKey,
    hash,
  });
  await page
    .getByRole("button", { name: "Confirm deployment in Rabby" })
    .click();
  await expect(
    page.getByText("This review changed in another tab."),
  ).toBeVisible();
  expect(await sent(page)).toHaveLength(0);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), otherKey),
  ).toBe(hash);
});
test("a changed creation payload is rejected before opening the wallet", async ({
  page,
}) => {
  await setup(page, { replaceOnBegin: true });
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  await page
    .getByRole("button", { name: "Confirm deployment in Rabby" })
    .click();
  await expect(page.getByText(/returned deployment differs/)).toBeVisible();
  expect(await sent(page)).toHaveLength(0);
});
test("ambiguous wallet outcome keeps recovery active and never auto-resubmits", async ({
  page,
}) => {
  const h = await setup(page, { uncertain: true });
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  await page
    .getByRole("button", { name: "Confirm deployment in Rabby" })
    .click();
  await expect(
    page.getByText(/Rabby did not return a definite outcome/),
  ).toBeVisible();
  expect(h.state.pending.signingStarted).toBe(true);
  expect(await sent(page)).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "Confirm deployment in Rabby" }),
  ).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Clear after my inspection" }),
  ).toBeDisabled();
});
test("an existing recovery hash prevents another signature without deleting evidence", async ({
  page,
}) => {
  const h = await setup(page);
  await page.getByRole("button", { name: "Connect Rabby" }).click();
  await page.evaluate(({ key, hash }) => localStorage.setItem(key, hash), {
    key: h.key,
    hash,
  });
  await page
    .getByRole("button", { name: "Confirm deployment in Rabby" })
    .click();
  await expect(
    page.getByText(/transaction hash is saved for this review/),
  ).toBeVisible();
  expect(await sent(page)).toHaveLength(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), h.key)).toBe(
    hash,
  );
});

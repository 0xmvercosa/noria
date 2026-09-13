import { test, expect, type Locator } from "@playwright/test";

async function paste(input: Locator, text: string) {
  await input.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}

test("amounts group at rest and keep native editing, selection, paste and exact eighteen decimals", async ({
  page,
}) => {
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  await page.goto("/aqua");
  const amount = page.getByLabel("Collateral amount (USDC)");
  await expect(amount).toHaveValue("20,000");
  await amount.focus();
  await expect(amount).toHaveValue("20000");
  await amount.fill("1234.567890");
  await amount.blur();
  await expect(amount).toHaveValue("1,234.567890");
  await amount.focus();
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(1, 3));
  await page.keyboard.type("00");
  await expect(amount).toHaveValue("1004.567890");
  await page.keyboard.press("Backspace");
  await expect(amount).toHaveValue("104.567890");
  expect(
    await amount.evaluate((el: HTMLInputElement) => el.selectionStart),
  ).toBe(2);
  await amount.selectText();
  await paste(amount, "1.234,567890");
  await expect(amount).toHaveValue("1234.567890");
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(0, 4));
  await paste(amount, "25");
  await expect(amount).toHaveValue("25.567890");
  expect(
    await amount.evaluate((el: HTMLInputElement) => el.selectionStart),
  ).toBe(2);
  await amount.fill("1.");
  await paste(amount, "000001");
  await expect(amount).toHaveValue("1.000001");
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(2, 5));
  await paste(amount, "002");
  await expect(amount).toHaveValue("1.002001");
  await amount.fill("12.50");
  await amount.evaluate((el: HTMLInputElement) => el.setSelectionRange(3, 5));
  await paste(amount, "50");
  await page.keyboard.type("1");
  await expect(amount).toHaveValue("12.501");
  await amount.fill("");
  await page.keyboard.type("12,50");
  await expect(amount).toHaveValue("12.50");
  await amount.fill("");
  await amount.evaluate((element: HTMLInputElement) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, "12,50");
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "12,50",
        isComposing: true,
      }),
    );
  });
  await expect(amount).toHaveValue("12,50");
  await amount.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "12,50" }),
    ),
  );
  await expect(amount).toHaveValue("12.50");

  await amount.fill("1.234.");
  await amount.evaluate((element: HTMLInputElement) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(element, "1.234.567");
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: "567",
        inputType: "insertCompositionText",
        isComposing: true,
      }),
    );
    element.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "567" }),
    );
  });
  await expect(amount).toHaveValue("1.234.567");
  await expect(amount).toHaveAttribute("aria-invalid", "true");

  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("ETH");
  const eth = page.getByLabel("Collateral amount (ETH)");
  await eth.fill("1000.000000000000000001");
  await eth.blur();
  await expect(eth).toHaveValue("1,000.000000000000000001");
  await expect(eth).toHaveAttribute("aria-invalid", "false");
  await page
    .getByLabel("Collateral asset", { exact: true })
    .selectOption("USDC");
  await expect(amount).toHaveValue("1000.000000000000000001");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("button", { name: "Find my pool and range" }),
  ).toBeDisabled();
});

test("ambiguous or malformed paste and excessive precision invalidate the amount without changing it", async ({
  page,
}) => {
  await page.route("**/api/aqua/v1/local-rehearsal", (route) =>
    route.fulfill({ json: { enabled: false } }),
  );
  let requests = 0;
  await page.route("**/api/aqua/v1/position", (route) => {
    requests++;
    return route.abort();
  });
  await page.goto("/aqua");
  const amount = page.getByLabel("Collateral amount (USDC)");
  for (const value of ["1,234", "-100", "1e3", "1.0000001"]) {
    await amount.fill("");
    await paste(amount, value);
    await amount.blur();
    await expect(amount).toHaveValue(value);
    await expect(amount).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("button", { name: "Find my pool and range" }),
    ).toBeDisabled();
  }
  expect(requests).toBe(0);
  await amount.fill("12,50");
  await expect(amount).toHaveValue("12.50");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
  await amount.fill("");
  await page.keyboard.type("1,234,567");
  await expect(amount).toHaveValue("1.234.567");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await amount.fill("1.234.");
  await paste(amount, "567");
  await expect(amount).toHaveValue("1.234.567");
  await expect(amount).toHaveAttribute("aria-invalid", "true");
  await amount.selectText();
  await paste(amount, "1.234.567");
  await expect(amount).toHaveValue("1234567");
  await expect(amount).toHaveAttribute("aria-invalid", "false");
});

test("reserve formats exact amounts, preserves full recipients and fits mobile screens", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/reserve");
  const reserve = page.getByLabel("Amount (USDC)", { exact: true });
  await reserve.fill("1000.000000");
  await reserve.blur();
  await expect(reserve).toHaveValue("1,000.000000");
  await expect(
    page.getByRole("link", { name: "Plan an Aqua position" }),
  ).toHaveAttribute("href", "/aqua?collateralUSDC=1000.000000");
  const recipient = page.getByLabel("Recipient address", { exact: true });
  const address = "0x52908400098527886E0F7030069857D2E4169EE7";
  await recipient.fill(` ${address} `);
  await expect(recipient).toHaveValue(address);
  await expect(recipient).toHaveAttribute("aria-invalid", "false");
  await recipient.fill(address + "a");
  await expect(recipient).toHaveValue(address + "a");
  await expect(recipient).toHaveAttribute("aria-invalid", "true");
  await recipient.fill(address.replace("E0", "e0"));
  await expect(recipient).toHaveAttribute("aria-invalid", "true");
  await expect(recipient).toHaveAttribute("spellcheck", "false");
  await expect(recipient).toHaveAttribute("autocomplete", "off");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("basis points reject exponent, hexadecimal and fractional notation and stay in sync with the slider", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Planned conversion/ }).click();
  const discount = page.getByLabel("Entry discount", { exact: true });
  for (const value of ["1e2", "0x100", "250.5", "1001", "24"]) {
    await discount.fill(value);
    await expect(discount).toHaveValue(value);
    await expect(discount).toHaveAttribute("aria-invalid", "true");
  }
  await discount.fill("1000");
  await discount.blur();
  await expect(discount).toHaveValue("1,000");
  const slider = page.getByRole("slider", {
    name: "Entry discount in basis points",
  });
  await expect(slider).toHaveValue("1000");
  await slider.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(discount).toHaveValue("975");
});

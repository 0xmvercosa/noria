import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amountInputError,
  formatAmountInput,
  normalizeAmountInput,
  normalizeIdentifierInput,
} from "../../src/components/input-format";
import { EuroAmountSchema } from "../../src/integrations/privy/fiat";
import {
  OwnerSchema,
  parseTransferAmount,
} from "../../src/integrations/privy/reserve";
import { LaunchHashSchema } from "../../src/integrations/aqua/launch-contract";

test("numeric formatting preserves exact token units, large integers and trailing precision", () => {
  for (const [raw, formatted, asset, units] of [
    ["1234.567890", "1,234.567890", "USDC", "1234567890"],
    [
      "1000.000000000000000001",
      "1,000.000000000000000001",
      "ETH",
      "1000000000000000000001",
    ],
    [
      "9007199254740993.000001",
      "9,007,199,254,740,993.000001",
      "USDC",
      "9007199254740993000001",
    ],
  ] as const) {
    const decimals = asset === "USDC" ? 6 : 18;
    assert.equal(formatAmountInput(raw, decimals), formatted);
    assert.equal(normalizeAmountInput(formatted), raw);
    assert.equal(
      parseTransferAmount(normalizeAmountInput(formatted), asset),
      units,
    );
  }
});

test("locale normalization only accepts unambiguous syntax", () => {
  for (const [raw, expected] of [
    [" 1234.56 ", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["12,50", "12.50"],
    ["1,234,567", "1234567"],
    ["1.234.567", "1234567"],
    ["1,234", "1,234"],
    ["0,001", "0,001"],
    ["1.234", "1.234"],
    ["00050.00", "50.00"],
    [".5", "0.5"],
    [",", "0."],
    ["", ""],
  ])
    assert.equal(normalizeAmountInput(raw), expected);
  assert.match(amountInputError("1,234", 6)!, /Ambiguous/);
  assert.match(amountInputError("0,001", 6)!, /Ambiguous/);
  assert.equal(
    EuroAmountSchema.safeParse(normalizeAmountInput("50,00")).success,
    true,
  );
  assert.equal(
    EuroAmountSchema.safeParse(normalizeAmountInput("1.234")).success,
    false,
  );
  assert.equal(normalizeAmountInput("1.234.567", false), "1.234.567");
  assert.equal(normalizeAmountInput("1,234.56", false), "1,234.56");
  assert.equal(normalizeAmountInput("1.000001", false), "1.000001");
});

test("invalid and overprecise money is preserved and refused, never repaired or rounded", () => {
  for (const raw of [
    "-100",
    "+100",
    "1e3",
    "0x100",
    "$100",
    "12,34.56",
    "1.2.3",
    "1 000",
    "NaN",
    "Infinity",
    "1\n2",
    "1\u200b2",
  ]) {
    assert.equal(normalizeAmountInput(raw), raw);
    assert.equal(formatAmountInput(raw, 6), raw);
    assert.ok(amountInputError(raw, 6));
    assert.equal(parseTransferAmount(normalizeAmountInput(raw), "USDC"), null);
  }
  for (const [raw, decimals] of [
    ["1.001", 2],
    ["1.0000001", 6],
    ["1.0000000000000000001", 18],
  ] as const) {
    assert.equal(normalizeAmountInput(raw), raw);
    assert.equal(formatAmountInput(raw, decimals), raw);
    assert.match(amountInputError(raw, decimals)!, /not been rounded/);
  }
  assert.equal(amountInputError("1.000000000000000001", 18), null);
  assert.ok(amountInputError("1.000000000000000001", 6));
  assert.ok(amountInputError("250.0", 0));
});

test("canonical amount edits stay lossless through every supported decimal precision", () => {
  for (let decimals = 1; decimals <= 18; decimals++) {
    for (const whole of ["0", "1", "1234", "9007199254740993"]) {
      const raw = `${whole}.${"123456789012345678".slice(0, decimals)}`;
      assert.equal(normalizeAmountInput(formatAmountInput(raw, decimals)), raw);
      assert.equal(amountInputError(raw, decimals), null);
    }
  }
});

test("identifiers keep case, invalid characters and excess length for existing validators", () => {
  const address = "0x52908400098527886E0F7030069857D2E4169EE7";
  assert.equal(normalizeIdentifierInput(` ${address}\n`), address);
  assert.equal(
    OwnerSchema.safeParse(normalizeIdentifierInput(address)).success,
    true,
  );
  for (const raw of [
    address + "0",
    address.replace("E0", "e0"),
    address.replace("529", "5 29"),
    "0x" + "0".repeat(40),
  ]) {
    assert.equal(normalizeIdentifierInput(raw), raw);
    assert.equal(OwnerSchema.safeParse(raw).success, false);
  }
  const hash = `0x${"Ab".repeat(32)}`;
  assert.equal(normalizeIdentifierInput(hash), hash);
  assert.equal(LaunchHashSchema.safeParse(hash).success, true);
  assert.equal(normalizeIdentifierInput(hash + "c"), hash + "c");
  assert.equal(LaunchHashSchema.safeParse(hash + "c").success, false);
});

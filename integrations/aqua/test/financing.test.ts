import test from "node:test";
import assert from "node:assert/strict";
import { sizeLoan } from "../src/financing.js";
import { PositionIntentSchema } from "../src/boundary.js";
const terms = {
  collateralUnits: 10n ** 19n,
  collateralDecimals: 18,
  collateralPriceBase: 2500n * 10n ** 8n,
  usdcPriceBase: 10n ** 8n,
  ltvBps: 8000n,
  liquidationThresholdBps: 8300n,
  comfortableHFWad: 2n * 10n ** 18n,
};
test("ETH and USDC collateral size their USDC debt below comfortable HF with no double-counted collateral", () => {
  const eth = sizeLoan(terms);
  assert.equal(eth.loanUSDCUnits, 10323125000n);
  const usdc = sizeLoan({
    ...terms,
    collateralUnits: 25000n * 10n ** 6n,
    collateralDecimals: 6,
    collateralPriceBase: 10n ** 8n,
  });
  assert.equal(usdc.loanUSDCUnits, eth.loanUSDCUnits);
  assert.ok(eth.loanUSDCUnits < 25000n * 10n ** 6n);
});
test("LTV remains binding even when the owner selects a low comfortable HF", () => {
  const q = sizeLoan({ ...terms, comfortableHFWad: 101n * 10n ** 16n });
  assert.equal(q.constraint, "ltv");
  assert.equal(q.loanUSDCUnits, 19900n * 10n ** 6n);
});
test("health ordering, zero oracle price and unsupported collateral precision refuse financing", () => {
  const intent = {
    fundingAsset: "USDC",
    collateralAmountUnits: "1000000000",
    safetyHFWad: "1800000000000000000",
    comfortableHFWad: "1700000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  };
  assert.equal(PositionIntentSchema.safeParse(intent).success, false);
  assert.throws(() => sizeLoan({ ...terms, usdcPriceBase: 0n }));
  assert.throws(() => sizeLoan({ ...terms, collateralDecimals: 8 }));
});

test("malformed HF input produces validation issues instead of a BigInt exception", () => {
  const intent = {
    fundingAsset: "USDC",
    collateralAmountUnits: "1000000000",
    safetyHFWad: "abc",
    comfortableHFWad: "1700000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  };
  assert.equal(PositionIntentSchema.safeParse(intent).success, false);
});

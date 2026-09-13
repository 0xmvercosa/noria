import test from "node:test";
import assert from "node:assert/strict";
import { summarizeEconomics } from "../src/rehearsal-report.js";
import { DEPLOYMENTS } from "../src/official.js";
const owner = "0x" + "1".repeat(40),
  account = "0x" + "2".repeat(40);
const wallet = (address: string) => ({
  address,
  native: "0",
  weth: "0",
  usdc: "0",
  aWeth: "0",
  aUSDC: "0",
  debt: "0",
});
function fixture() {
  return {
    account,
    intent: { fundingAsset: "USDC", collateralAmountUnits: "1000" },
    financing: { loanUSDCUnits: "500" },
    valuationPriceUSDCPerWethE6: "2000000000",
    valuationBlock: { number: "42", hash: "0xabc", timestamp: "123" },
    economicStart: {
      wallets: [
        { ...wallet(owner), usdc: "1000", aUSDC: "100" },
        wallet(account),
      ],
    },
    economicEnd: {
      wallets: [
        { ...wallet(owner), usdc: "990", aUSDC: "103" },
        wallet(account),
      ],
    },
  };
}
test("uses withdrawal receipts, excludes unrelated wallet accrual, and does not charge gas twice", () => {
  const m = fixture();
  const e = summarizeEconomics(m, [
    {
      events: [
        {
          eventName: "Repay",
          address: DEPLOYMENTS.aavePool,
          args: { user: account, amount: "503" },
        },
        {
          eventName: "Closed",
          address: account,
          args: { collateralReturned: "1002" },
        },
      ],
    },
  ])!;
  assert.equal(e.collateralYieldUnits, 2n);
  assert.equal(e.totalBorrowInterestUSDCUnits, 3n);
  assert.equal(e.relatedPartyGroupNetUSDCUnits, -7n);
  assert.equal(e.strategyGroupNetUSDCUnits, -10n);
  assert.equal(e.organicDemandProven, false);
  assert.equal(e.referenceBlock?.number, "42");
});
test("duplicate or missing actors cannot produce consolidated profit", () => {
  const m = fixture();
  m.economicStart.wallets.push(m.economicStart.wallets[0]!);
  assert.throws(() => summarizeEconomics(m, []), /duplicate_or_missing_actor/);
});

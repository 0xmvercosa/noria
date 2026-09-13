import test from "node:test";
import assert from "node:assert/strict";
import { allocate, groupProfit, valueWeth } from "../src/accounting.js";

const unit = 1_000_000n;
const base = {
  principal: 8000n * unit,
  debtCheckpoint: 8000n * unit,
  debtNow: 8080n * unit,
  provision: 20n * unit,
  lossCarry: 0n,
  healthy: true,
};
for (const [name, recovered, loss, eligible, nextLoss, repay, nextCapital] of [
  ["positive", 8200, 0, 100, 0, 130, 8050],
  ["fees_but_loss", 8050, 0, 0, 50, 80, 7950],
  ["flat", 8100, 0, 0, 0, 80, 8000],
  ["partial_recovery", 8200, 150, 0, 50, 80, 8100],
  ["recovery_and_growth", 8200, 50, 50, 0, 105, 8075],
  ["inventory_loss", 7800, 0, 0, 300, 80, 7700],
] as const) {
  test(name, () => {
    const a = allocate({
      ...base,
      recovered: BigInt(recovered) * unit,
      lossCarry: BigInt(loss) * unit,
    });
    assert.equal(a.eligible, BigInt(eligible) * unit);
    assert.equal(a.nextLossCarry, BigInt(nextLoss) * unit);
    assert.equal(a.repayment, BigInt(repay) * unit);
    assert.equal(a.nextPrincipal, BigInt(nextCapital) * unit);
  });
}
test("idle interest is charged from the continuous post-repay checkpoint", () => {
  const a = allocate({
    ...base,
    principal: 8050n * unit,
    debtCheckpoint: 7950n * unit,
    debtNow: 8050n * unit,
    recovered: 8250n * unit,
  });
  assert.equal(a.interest, 100n * unit);
  assert.equal(a.eligible, 80n * unit);
});
test("debt paid off leaves all residual in cash and never starts another LP", () => {
  const a = allocate({
    ...base,
    debtCheckpoint: 10n * unit,
    debtNow: 11n * unit,
    recovered: 8500n * unit,
  });
  assert.equal(a.finalDebt, 0n);
  assert.equal(a.nextPrincipal, 0n);
  assert.equal(a.freeCash, 8469n * unit);
});
test("unsafe debt changes and insufficient cash require reconciliation/defense", () => {
  assert.throws(
    () => allocate({ ...base, recovered: 8200n * unit, debtNow: 7000n * unit }),
    /reconciliation/,
  );
  assert.throws(() => allocate({ ...base, recovered: 1n }), /defense/);
});
test("rounding conserves the final base unit; related-party fee is not group revenue", () => {
  const a = allocate({
    principal: 100n,
    recovered: 101n,
    debtCheckpoint: 100n,
    debtNow: 100n,
    provision: 0n,
    lossCarry: 0n,
    healthy: true,
  });
  assert.equal(a.principalAmortization, 0n);
  assert.equal(a.growthFromEligible, 1n);
  assert.equal(
    groupProfit([
      { initialEquity: 1000n, finalEquity: 1100n, externalCapital: 0n },
      { initialEquity: 1000n, finalEquity: 800n, externalCapital: 0n },
    ]),
    -100n,
  );
  assert.equal(valueWeth(10n ** 18n, 3000n * unit), 3000n * unit);
});

test("principal amortization is capped to debt and carried interest survives external repayments", () => {
  const terminal = allocate({
    principal: 100n,
    recovered: 200n,
    debtCheckpoint: 10n,
    debtNow: 10n,
    provision: 0n,
    lossCarry: 0n,
    healthy: true,
  });
  assert.equal(terminal.requestedPrincipalAmortization, 50n);
  assert.equal(terminal.principalAmortization, 10n);
  const reconciled = allocate({
    principal: 8000n,
    recovered: 8200n,
    debtCheckpoint: 8040n,
    debtNow: 8045n,
    carriedInterest: 80n,
    provision: 0n,
    lossCarry: 0n,
    healthy: true,
  });
  assert.equal(reconciled.interest, 85n);
  assert.equal(reconciled.eligible, 115n);
});

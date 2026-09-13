import test from "node:test";
import assert from "node:assert/strict";
import {
  LAUNCH,
  type LaunchIntent,
  type LaunchPosition,
} from "../../src/integrations/aqua/launch-contract";
import {
  describeLaunchJourney,
  describeRepayment,
  newWalletWeth,
} from "../../src/components/aqua-launch-presentation";

const intent: LaunchIntent = {
  fundingAsset: "USDC",
  collateralAmountUnits: "2500000000",
  safetyHFWad: "1400000000000000000",
  comfortableHFWad: "2000000000000000000",
  financingMode: "aave_collateral_then_borrow_usdc",
};
function position(overrides: Partial<LaunchPosition> = {}) {
  return {
    phase: 0,
    collateral: LAUNCH.usdc,
    collateralAllowanceUnits: "0",
    principal: "1000000",
    debtUSDCUnits: "0",
    wethUnits: "0",
    usdcUnits: "0",
    lpWethUnits: "0",
    lpUsdcUnits: "1000000",
    healthFactor: "2100000000000000000",
    safetyHF: intent.safetyHFWad,
    comfortableHF: intent.comfortableHFWad,
    ...overrides,
  };
}
const wallet = { wethUnits: "0" };

test("unavailable health guides recovery without claiming healthy exposure", () => {
  for (const phase of [1, 2, 4]) {
    const journey = describeLaunchJourney(
      position({ phase, debtUSDCUnits: "1000000", healthFactor: null }),
      wallet,
    );
    assert.equal(journey.next, "defend");
    assert.equal(journey.closing, true);
    assert.equal(journey.canRefreshResearch, false);
    assert.match(journey.title, /Health factor unavailable/);
  }
  assert.equal(
    describeLaunchJourney(position({ healthFactor: null }), wallet, intent)
      .next,
    null,
  );
  assert.equal(
    describeLaunchJourney(
      position({ phase: 5, healthFactor: null, debtUSDCUnits: "1000000" }),
      wallet,
    ).next,
    "repayment",
  );
  assert.equal(
    describeLaunchJourney(position({ phase: 5, healthFactor: null }), wallet)
      .next,
    "exit",
  );
});

test("setup has one next action and wraps only the missing WETH before approving", () => {
  assert.equal(
    describeLaunchJourney(position(), wallet, intent).next,
    "approve-collateral",
  );
  assert.equal(
    describeLaunchJourney(
      position({ collateralAllowanceUnits: intent.collateralAmountUnits }),
      wallet,
      intent,
    ).next,
    "open",
  );
  const ethIntent = {
    ...intent,
    fundingAsset: "ETH" as const,
    collateralAmountUnits: "1000000000000000000",
  };
  const next = describeLaunchJourney(
    position({ collateral: LAUNCH.weth }),
    { wethUnits: "250000000000000000" },
    ethIntent,
  );
  assert.equal(next.next, "wrap");
  assert.equal(next.amountUnits, "750000000000000000");
  assert.equal(describeLaunchJourney(position(), wallet).next, null);
});

test("ready inventory launches only after conversion; a safety breach points to stopping", () => {
  assert.equal(
    describeLaunchJourney(
      position({ phase: 1, debtUSDCUnits: "1000000" }),
      wallet,
    ).next,
    "convert",
  );
  assert.equal(
    describeLaunchJourney(
      position({ phase: 1, debtUSDCUnits: "1000000", lpWethUnits: "1" }),
      wallet,
    ).next,
    "ship",
  );
  assert.equal(
    describeLaunchJourney(
      position({
        phase: 1,
        debtUSDCUnits: "1000000",
        healthFactor: intent.safetyHFWad,
      }),
      wallet,
    ).next,
    "defend",
  );
  assert.equal(
    describeLaunchJourney(position({ phase: 1 }), wallet).next,
    "defend",
  );
  const unsafe = describeLaunchJourney(
    position({
      phase: 1,
      debtUSDCUnits: "1000000",
      healthFactor: intent.safetyHFWad,
    }),
    wallet,
  );
  assert.equal(unsafe.closing, true);
  assert.deepEqual(
    unsafe.steps.map((step) => step.status),
    ["current", "pending", "pending"],
  );
  assert.equal(
    describeLaunchJourney(
      position({ phase: 4, debtUSDCUnits: "1000000", lpUsdcUnits: "900000" }),
      wallet,
    ).next,
    "defend",
  );
});

test("stopped debt selects sale or repayment, never repeat defense; zero debt always returns collateral", () => {
  const stopped = position({
    phase: 5,
    debtUSDCUnits: "1000000",
    wethUnits: "1",
  });
  const sell = describeLaunchJourney(stopped, wallet);
  assert.equal(sell.next, "realize-defense");
  assert.equal(sell.canStop, false);
  assert.equal(sell.canRefreshResearch, false);
  assert.equal(
    describeLaunchJourney({ ...stopped, wethUnits: "0" }, wallet).next,
    "repayment",
  );
  const cleared = describeLaunchJourney(
    { ...stopped, debtUSDCUnits: "0" },
    wallet,
  );
  assert.equal(cleared.next, "exit");
  assert.equal(cleared.steps[1]!.status, "complete");
  assert.equal(
    describeLaunchJourney(position({ phase: 4 }), wallet).next,
    "exit",
  );
});

test("active and already-stopping positions keep an explicit path to stop before repayment", () => {
  const active = describeLaunchJourney(
    position({ phase: 2, debtUSDCUnits: "1000000" }),
    wallet,
  );
  assert.equal(active.next, "defend");
  assert.equal(active.canStop, true);
  assert.equal(
    active.steps.every((step) => step.status === "complete"),
    true,
  );
  const stopping = describeLaunchJourney(
    position({ phase: 3, debtUSDCUnits: "1000000" }),
    wallet,
  );
  assert.equal(stopping.next, "defend");
  assert.equal(stopping.closing, true);
  assert.equal(stopping.steps[0]!.status, "current");
  assert.equal(stopping.steps[1]!.status, "pending");
});

test("USDC received after stopping can repay from the position before asking for wallet funds", () => {
  const result = describeLaunchJourney(
    position({ phase: 5, debtUSDCUnits: "1000000", usdcUnits: "500000" }),
    wallet,
  );
  assert.equal(result.next, "defend");
  assert.equal(result.canStop, false);
  assert.equal(
    describeLaunchJourney(
      position({ phase: 5, debtUSDCUnits: "0", usdcUnits: "500000" }),
      wallet,
    ).next,
    "exit",
  );
});

test("research is offered only in supported phases with remaining debt and launch principal", () => {
  for (const phase of [0, 1, 4])
    assert.equal(
      describeLaunchJourney(
        position({ phase, debtUSDCUnits: phase ? "1000000" : "0" }),
        wallet,
      ).canRefreshResearch,
      true,
    );
  for (const phase of [2, 3, 5, 6])
    assert.equal(
      describeLaunchJourney(
        position({ phase, debtUSDCUnits: "1000000" }),
        wallet,
      ).canRefreshResearch,
      false,
    );
  for (const phase of [1, 4]) {
    assert.equal(
      describeLaunchJourney(position({ phase, debtUSDCUnits: "0" }), wallet)
        .canRefreshResearch,
      false,
    );
    const noPrincipal = describeLaunchJourney(
      position({ phase, debtUSDCUnits: "1000000", principal: "0" }),
      wallet,
    );
    assert.equal(noPrincipal.canRefreshResearch, false);
    assert.equal(noPrincipal.next, "defend");
  }
});

test("closed positions offer optional unwrap without selling wallet or position inventory", () => {
  const closed = describeLaunchJourney(position({ phase: 6 }), {
    wethUnits: "500",
  });
  assert.equal(closed.next, "unwrap");
  assert.equal(closed.canStop, false);
  assert.equal(
    closed.steps.every((step) => step.status === "complete"),
    true,
  );
  assert.equal(
    describeLaunchJourney(position({ phase: 6 }), wallet).next,
    null,
  );
  assert.equal(newWalletWeth("100", "750"), "650");
  assert.equal(newWalletWeth("750", "100"), "0");
});

test("repayment separates full payoff with headroom from available partial funds using exact units", () => {
  assert.deepEqual(describeRepayment("1000000", "900000"), {
    limitUnits: "1001001",
    availableUnits: "900000",
    shortfallUnits: "101001",
    fullyFunded: false,
  });
  assert.deepEqual(describeRepayment("1000000", "2000000"), {
    limitUnits: "1001001",
    availableUnits: "1001001",
    shortfallUnits: "0",
    fullyFunded: true,
  });
  assert.deepEqual(describeRepayment("0", "2000000"), {
    limitUnits: "0",
    availableUnits: "0",
    shortfallUnits: "0",
    fullyFunded: true,
  });
});

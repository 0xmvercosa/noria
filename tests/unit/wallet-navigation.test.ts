import test from "node:test";
import assert from "node:assert/strict";
import { safeWalletReturn } from "../../src/integrations/privy/navigation";
import { restorePlannerDraft } from "../../src/integrations/aqua/planner-draft";

test("OAuth return stays on known app pages and never retains authentication parameters", () => {
  assert.equal(
    safeWalletReturn(
      "/aqua?collateralUSDC=12.345678&code=secret&state=token#hash",
    ),
    "/aqua?collateralUSDC=12.345678",
  );
  assert.equal(safeWalletReturn("/?privy_oauth_code=secret"), "/");
  assert.equal(safeWalletReturn("/reserve?code=secret"), "/reserve");
  assert.equal(safeWalletReturn("/aqua?collateralUSDC=12.3456789"), "/aqua");
  for (const value of [
    null,
    "https://attacker.test",
    "//attacker.test",
    "/\\attacker.test",
    "javascript:alert(1)",
    "/auth/callback?code=secret",
    "/unknown",
    "/aqua/../api/noria",
  ]) {
    assert.equal(safeWalletReturn(value), "/reserve", String(value));
  }
});

test("planner restoration preserves exact editable amounts but cannot restore execution evidence", () => {
  const draft = {
    fundingAsset: "ETH",
    amount: "0.000000000000000001",
    safetyHF: "1.4",
    comfortableHF: "2",
    hours: 6,
  };
  assert.deepEqual(restorePlannerDraft(JSON.stringify(draft)), draft);
  assert.equal(
    restorePlannerDraft(
      JSON.stringify({ ...draft, plan: { status: "ready" } }),
    ),
    null,
  );
  assert.equal(
    restorePlannerDraft(JSON.stringify({ ...draft, amount: "1e18" })),
    null,
  );
  assert.equal(
    restorePlannerDraft(JSON.stringify({ ...draft, hours: 1 })),
    null,
  );
  assert.equal(restorePlannerDraft("{"), null);
  assert.equal(restorePlannerDraft("x".repeat(1001)), null);
});

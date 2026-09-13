import test from "node:test";
import assert from "node:assert/strict";
import factoryArtifact from "../../public/aqua/position-factory-artifact.json";
import {
  submitLaunchAttempt,
  restoreLaunchRecords,
  serializeLaunchRecords,
  launchRecordFromAttempt,
  assertLaunchHistoryCurrent,
  type LaunchAttempt,
} from "../../src/integrations/aqua/launch-client";
import type { LaunchPrepared } from "../../src/integrations/aqua/launch-contract";
const owner = "0x1111111111111111111111111111111111111111" as const;
const factory = "0x2222222222222222222222222222222222222222" as const;
const hash = `0x${"a".repeat(64)}` as `0x${string}`;
const now = 1789290000000;
function attempt(): LaunchAttempt {
  const prepared: LaunchPrepared = {
    schemaVersion: "noria.aqua.launch.prepared.v1",
    request: {
      kind: "create",
      owner,
      id: hash,
      intent: {
        fundingAsset: "USDC",
        collateralAmountUnits: "10000000",
        safetyHFWad: "1400000000000000000",
        comfortableHFWad: "2000000000000000000",
        financingMode: "aave_collateral_then_borrow_usdc",
      },
    },
    before: {
      schemaVersion: "noria.aqua.launch.snapshot.v1",
      status: "ready",
      chainId: 42161,
      owner,
      blockNumber: "1",
      blockHash: hash,
      blockTimestamp: now / 1000,
      deployment: {
        factory,
        factoryRuntimeHash: factoryArtifact.runtimeCodeHash,
        adapter: factory,
        adapterRuntimeHash: hash,
      },
      wallet: {
        nativeWei: "1000000000000000000",
        usdcUnits: "10000000",
        wethUnits: "0",
        aUsdcUnits: "0",
      },
      position: null,
    },
    plan: null,
    quote: null,
    expiresAt: now + 60000,
    estimatedGasWei: "1000",
  };
  return {
    id: "11111111-1111-4111-8111-111111111111",
    prepared,
    startedAt: new Date(now).toISOString(),
  };
}
test("Aqua saves intent before SDK and keeps ambiguous submissions recoverable", async () => {
  const calls: string[] = [];
  await assert.rejects(
    submitLaunchAttempt({
      attempt: attempt(),
      save: () => {
        calls.push("saved");
      },
      send: async () => {
        calls.push("sent");
        throw new Error("timeout after broadcast");
      },
      record: () => {
        calls.push("recorded");
        return true;
      },
      clear: () => {
        calls.push("cleared");
      },
    }),
  );
  assert.deepEqual(calls, ["saved", "sent"]);
  calls.length = 0;
  await assert.rejects(
    submitLaunchAttempt({
      attempt: attempt(),
      save: () => {
        throw new Error("storage unavailable");
      },
      send: async () => {
        calls.push("sent");
        return hash;
      },
      record: () => true,
      clear: () => {},
    }),
  );
  assert.deepEqual(calls, []);
});
test("a durable hash precedes clearing intent, and only definite rejection resolves cancellation", async () => {
  const calls: string[] = [];
  await submitLaunchAttempt({
    attempt: attempt(),
    save: () => {
      calls.push("saved");
    },
    send: async () => hash,
    record: () => {
      calls.push("recorded");
      return true;
    },
    clear: (reason) => {
      calls.push(reason);
    },
  });
  assert.deepEqual(calls, ["saved", "recorded", "recorded"]);
  for (const failure of [
    { code: 4001 },
    { code: "4001" },
    { message: "User rejected" },
    { code: -32000 },
  ]) {
    let cleared = false;
    await assert.rejects(
      submitLaunchAttempt({
        attempt: attempt(),
        save: () => {},
        send: async () => {
          throw failure;
        },
        record: () => true,
        clear: () => {
          cleared = true;
        },
      }),
    );
    assert.equal(cleared, "code" in failure && failure.code === 4001);
  }
  let cleared = false;
  await assert.rejects(
    submitLaunchAttempt({
      attempt: attempt(),
      save: () => {},
      send: async () => hash,
      record: () => false,
      clear: () => {
        cleared = true;
      },
    }),
  );
  assert.equal(cleared, false);
});
test("saved success labels do not authorize another send and concurrent history is rechecked", () => {
  const entry = launchRecordFromAttempt(attempt(), hash);
  const raw = JSON.stringify([
    { ...entry, verification: { status: "verified" } },
  ]);
  const restored = restoreLaunchRecords(raw, owner);
  assert.equal(restored[0].verification, undefined);
  assert.throws(() => restoreLaunchRecords(raw, factory));
  assert.throws(() =>
    assertLaunchHistoryCurrent(
      owner,
      owner,
      [],
      serializeLaunchRecords([entry]),
      null,
      null,
    ),
  );
  assert.throws(() =>
    assertLaunchHistoryCurrent(owner, owner, restored, raw, null, null),
  );
  assert.throws(() =>
    assertLaunchHistoryCurrent(owner, factory, [], null, null, null),
  );
  assert.throws(() =>
    assertLaunchHistoryCurrent(
      owner,
      owner,
      [],
      null,
      null,
      JSON.stringify(attempt()),
    ),
  );
  assert.equal(
    assertLaunchHistoryCurrent(
      owner,
      owner,
      [],
      null,
      null,
      JSON.stringify(attempt()),
      true,
    )?.id,
    attempt().id,
  );
});

test("a changed wallet cannot recover another owner's in-memory intent or history when local storage is empty", () => {
  const foreign = attempt();
  foreign.prepared.request.owner = factory;
  foreign.prepared.before.owner = factory;
  assert.throws(
    () =>
      assertLaunchHistoryCurrent(owner, owner, [], null, foreign, null, true),
    /wallet changed/i,
  );
  const foreignRecord = launchRecordFromAttempt(foreign, hash);
  assert.throws(
    () =>
      assertLaunchHistoryCurrent(
        owner,
        owner,
        [foreignRecord],
        null,
        attempt(),
        null,
        true,
      ),
    /wallet changed/i,
  );
});

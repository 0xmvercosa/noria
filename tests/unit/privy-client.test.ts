import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPrepared,
  restoreRecords,
  serializedRecords,
  reserveReport,
  recordFromAttempt,
  restoreAttempt,
  submitReserveAttempt,
  verifyReserveAttempt,
  verifyReserve,
  withCheckedReserveHistory,
  type ReserveAttempt,
  type ReserveRecord,
} from "../../src/integrations/privy/client";
import type {
  PreparedReserveAction,
  TransferAction,
} from "../../src/integrations/privy/reserve";

const now = Date.UTC(2026, 8, 13);
const owner = "0x1111111111111111111111111111111111111111";
function prepared(): PreparedReserveAction {
  return {
    action: { owner, kind: "approve", amountUnits: "10000000" },
    expiresAt: now + 60_000,
    estimatedGasWei: "1000",
    before: {
      owner,
      chainId: 42161,
      blockNumber: "1",
      blockHash: `0x${"a".repeat(64)}`,
      blockTimestamp: now / 1000,
      usdcUnits: "10000000",
      aUsdcUnits: "0",
      nativeWei: "100000",
      allowanceUnits: "0",
      debtBase: "0",
      supplyAvailable: true,
      withdrawAvailable: true,
    },
  };
}
function record(): ReserveRecord {
  return {
    id: "894ddf3f-a460-42b0-b17c-273bf16b0bfc",
    prepared: prepared(),
    hash: `0x${"b".repeat(64)}`,
    submittedAt: new Date(now).toISOString(),
  };
}

function checkedRecord(
  index = 0,
  status: "verified" | "reverted" | "effect-unverified" = "verified",
): ReserveRecord {
  const r = record();
  r.id = `894ddf3f-a460-42b0-b17c-${index.toString(16).padStart(12, "0")}`;
  r.hash = `0x${index.toString(16).padStart(64, "0")}`;
  r.verification = {
    schemaVersion: "noria.privy.operation.v1",
    action: r.prepared.action,
    hash: r.hash as `0x${string}`,
    chainId: 42161,
    status,
    checkedAt: new Date(now).toISOString(),
    after: r.prepared.before,
    networkFeeWei: "1000",
    transaction: {
      from: owner,
      to: owner,
      input: "0x",
      value: "0",
      nonce: index,
    },
    receipt: {
      blockNumber: "1",
      blockHash: `0x${"a".repeat(64)}`,
      status: status === "reverted" ? "reverted" : "success",
      gasUsed: "1000",
      effectiveGasPrice: "1",
      logs: [],
    },
    finality: "Unit fixture; no live Privy evidence.",
  };
  return r;
}

function lockManager(beforeGrant = () => {}, available = true) {
  return {
    request: (async (
      name: string,
      options: LockOptions,
      callback: LockGrantedCallback<unknown>,
    ) => {
      assert.equal(name, `noria-reserve:${owner}`);
      assert.deepEqual(options, { ifAvailable: true });
      beforeGrant();
      return callback(available ? ({ name } as Lock) : null);
    }) as LockManager["request"],
  };
}

function historyState(records: ReserveRecord[] = []) {
  return {
    activeOwner: owner as string | null,
    records,
    saved: serializedRecords(records),
    attempt: null as ReserveAttempt | null,
    savedAttempt: null as string | null,
  };
}

function attempt(): ReserveAttempt {
  return {
    id: record().id,
    prepared: prepared(),
    startedAt: new Date(now).toISOString(),
  };
}

test("client binds review to exact requested wallet, amount and action before signing", () => {
  const p = prepared();
  assert.deepEqual(assertPrepared(p, p.action, now), p);
  for (const action of [
    { ...p.action, amountUnits: "9999999" },
    { ...p.action, kind: "supply" as const },
    {
      ...p.action,
      owner: "0x2222222222222222222222222222222222222222" as const,
    },
  ])
    assert.throws(() => assertPrepared(p, action, now), /does not match/);
  assert.throws(
    () =>
      assertPrepared(
        {
          ...p,
          before: {
            ...p.before,
            owner: "0x2222222222222222222222222222222222222222",
          },
        },
        p.action,
        now,
      ),
    /wallet changed/,
  );
});

test("expired, excessively long and stale-state reviews cannot reach wallet submission", () => {
  const p = prepared();
  assert.throws(() => assertPrepared(p, p.action, p.expiresAt), /expired/);
  assert.throws(
    () => assertPrepared({ ...p, expiresAt: now + 62_000 }, p.action, now),
    /expired/,
  );
  assert.throws(
    () =>
      assertPrepared(
        { ...p, before: { ...p.before, blockTimestamp: now / 1000 - 91 } },
        p.action,
        now,
      ),
    /expired/,
  );
});

test("transfer reviews bind normalized explicit recipient and check ETH value plus network fees", () => {
  const action: TransferAction = {
    owner,
    kind: "transfer-eth",
    recipient: "0x0000000000000000000000000000000000000B0b",
    amountUnits: "99000",
  };
  const p = { ...prepared(), action };
  assert.deepEqual(
    assertPrepared(
      p,
      {
        ...action,
        recipient: action.recipient.toLowerCase() as `0x${string}`,
        amountUnits: "00099000",
      },
      now,
    ),
    p,
  );
  assert.throws(
    () => assertPrepared(p, { ...action, recipient: owner }, now),
    /does not match/,
  );
  assert.throws(
    () =>
      assertPrepared(
        { ...p, before: { ...p.before, nativeWei: "99999" } },
        action,
        now,
      ),
    /transfer and network fees/,
  );
  assert.throws(
    () => assertPrepared({ ...p, estimatedGasWei: "0" }, action, now),
    /fee estimate is invalid/,
  );
  assert.throws(() =>
    assertPrepared({ ...p, estimatedGasWei: "1e3" }, action, now),
  );
});

test("old reserve records coexist with full-balance transfer records and preserve exact transfer recovery", () => {
  const old = record();
  const transfer = record();
  transfer.id = "d7b31ebe-a65a-4361-a8fe-d1978ccdc437";
  transfer.prepared.action = {
    owner,
    kind: "transfer-usdc",
    recipient: "0x2222222222222222222222222222222222222222",
    amountUnits: "5000000000",
  };
  transfer.prepared.before.usdcUnits = "5000000000";
  assert.deepEqual(restoreRecords(serializedRecords([old, transfer]), owner), [
    old,
    transfer,
  ]);
  const legacyPadded = {
    ...old,
    prepared: {
      ...old.prepared,
      action: { ...old.prepared.action, amountUnits: "00010000000" },
    },
  };
  assert.deepEqual(restoreRecords(JSON.stringify([legacyPadded]), owner), [
    old,
  ]);
  const intent = {
    id: transfer.id,
    prepared: transfer.prepared,
    startedAt: transfer.submittedAt,
  };
  assert.deepEqual(restoreAttempt(JSON.stringify(intent), owner), intent);
  assert.deepEqual(recordFromAttempt(intent, transfer.hash), transfer);
  assert.throws(() =>
    restoreRecords(
      JSON.stringify([
        {
          ...transfer,
          prepared: {
            ...transfer.prepared,
            action: { ...transfer.prepared.action, recipient: "bad" },
          },
        },
      ]),
      owner,
    ),
  );
});

test("client receipt binding normalizes transfer action but rejects a changed recipient", async (t) => {
  const r = checkedRecord();
  r.prepared.action = {
    owner,
    kind: "transfer-usdc",
    recipient: "0x2222222222222222222222222222222222222222",
    amountUnits: "10000000",
  };
  let recipient = r.prepared.action.recipient;
  let reportOwner = owner;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      ...r.verification,
      action: { ...r.prepared.action, recipient, amountUnits: "00010000000" },
      after: { ...r.verification!.after, owner: reportOwner },
    }),
  );
  const verified = await verifyReserve(r);
  assert.equal(verified?.status, "verified");
  assert.deepEqual(verified?.action, r.prepared.action);
  recipient = owner;
  await assert.rejects(verifyReserve(r), /did not match/);
  recipient = r.prepared.action.recipient;
  reportOwner = recipient;
  await assert.rejects(verifyReserve(r), /did not match this wallet/);
});

test("saved transaction hashes survive reload but locally written success labels never do", () => {
  const r = record();
  const edited = JSON.stringify([
    { ...r, verification: { status: "verified", claimedProfit: 1234 } },
  ]);
  assert.deepEqual(restoreRecords(edited, owner), [r]);
  assert.deepEqual(restoreRecords(serializedRecords([r]), owner), [r]);
  assert.deepEqual(restoreRecords(null, owner), []);
  assert.throws(
    () => restoreRecords(edited, "0x2222222222222222222222222222222222222222"),
    /different wallet/,
  );
  assert.throws(
    () => restoreRecords("x".repeat(1_000_001), owner),
    /too large/,
  );
  assert.throws(() => restoreRecords("{bad", owner));
  assert.throws(() =>
    restoreRecords(JSON.stringify([{ ...r, hash: "not-a-hash" }]), owner),
  );
});

test("export preserves partial operations without declaring approval or funding dismissal a completed financial flow", () => {
  const report = reserveReport([record()]);
  assert.equal(report.operations.length, 1);
  assert.equal(report.operations[0].verification, undefined);
  assert.match(
    report.boundaries.join(" "),
    /Approval and revocation are permissions/,
  );
  assert.match(
    report.boundaries.join(" "),
    /Funding modal completion is not counted/,
  );
  assert.match(
    report.boundaries.join(" "),
    /Aqua borrowing and execution use a separately verified PositionAccount deployment/,
  );
  assert.match(
    report.walletActionTransport,
    /accompanying login\/demo evidence/,
  );
});

test("submission rejects a receipt added to memory by another tab while preparation was awaiting RPC", async () => {
  const state = historyState();
  let sends = 0;
  await assert.rejects(
    withCheckedReserveHistory({
      owner,
      locks: lockManager(() => {
        // A storage event already made this hash known, but it is not checked.
        state.records = [record()];
        state.saved = serializedRecords(state.records);
      }),
      operation: "submit",
      read: () => state,
      run: async () => {
        sends++;
      },
    }),
    /outstanding transaction receipts/,
  );
  assert.equal(sends, 0);
});

test("the wallet lock checks fresh persisted history even before its storage event arrives", async () => {
  const state = historyState([checkedRecord()]);
  let sends = 0;
  await assert.rejects(
    withCheckedReserveHistory({
      owner,
      locks: lockManager(() => {
        state.saved = serializedRecords([...state.records, checkedRecord(1)]);
      }),
      operation: "submit",
      read: () => state,
      run: async () => {
        sends++;
      },
    }),
    /Another tab changed operation history/,
  );
  assert.equal(sends, 0);
});

test("account changes, unresolved effects and the history limit are rechecked at submission", async () => {
  const scenarios = [
    {
      state: { ...historyState(), activeOwner: null },
      error: /wallet changed/,
    },
    {
      state: {
        ...historyState(),
        activeOwner: "0x2222222222222222222222222222222222222222",
      },
      error: /wallet changed/,
    },
    {
      state: historyState([checkedRecord(0, "effect-unverified")]),
      error: /outstanding/,
    },
    {
      state: historyState(
        Array.from({ length: 100 }, (_, i) => checkedRecord(i)),
      ),
      error: /Download and clear/,
    },
  ];
  for (const scenario of scenarios) {
    let state = historyState();
    let sends = 0;
    await assert.rejects(
      withCheckedReserveHistory({
        owner,
        locks: lockManager(() => {
          state = scenario.state;
        }),
        operation: "submit",
        read: () => state,
        run: async () => {
          sends++;
        },
      }),
      scenario.error,
    );
    assert.equal(sends, 0);
  }
});

test("no submission or clearing runs without an available Web Lock", async () => {
  for (const operation of ["submit", "clear"] as const) {
    for (const locks of [undefined, lockManager(undefined, false)]) {
      let operations = 0;
      await assert.rejects(
        withCheckedReserveHistory({
          owner,
          locks,
          operation,
          read: () => historyState(),
          run: async () => {
            operations++;
          },
        }),
        /Web Locks support|operation open in another tab/,
      );
      assert.equal(operations, 0);
    }
  }
});

test("checked in-memory hashes survive a previous storage write failure", async () => {
  const records = [checkedRecord(), checkedRecord(1, "reverted")];
  const state = {
    ...historyState(records),
    saved: serializedRecords([records[0]]),
  };
  const history = await withCheckedReserveHistory({
    owner,
    locks: lockManager(),
    operation: "submit",
    read: () => state,
    run: async (checked) => checked,
  });
  assert.deepEqual(history, records);
  assert.notEqual(history, records);
});

test("clearing frees a full checked history but never clears pending, restored or unverified entries", async () => {
  const full = Array.from({ length: 100 }, (_, i) =>
    checkedRecord(i, i % 2 ? "reverted" : "verified"),
  );
  const downloaded = await withCheckedReserveHistory({
    owner,
    locks: lockManager(),
    operation: "clear",
    read: () => historyState(full),
    run: async (checked) => reserveReport(checked),
  });
  assert.deepEqual(downloaded.operations, full);
  for (const records of [
    [record()],
    restoreRecords(serializedRecords(full), owner),
    [checkedRecord(0, "effect-unverified")],
  ]) {
    let clears = 0;
    await assert.rejects(
      withCheckedReserveHistory({
        owner,
        locks: lockManager(),
        operation: "clear",
        read: () => historyState(records),
        run: async () => {
          clears++;
        },
      }),
      /outstanding transaction receipts/,
    );
    assert.equal(clears, 0);
  }
});

test("a durable exact intent is required before opening the SDK and survives ambiguous failures and reload", async () => {
  let sends = 0;
  await assert.rejects(
    submitReserveAttempt({
      attempt: attempt(),
      save: () => {
        throw new Error("storage unavailable");
      },
      send: async () => {
        sends++;
        return record().hash;
      },
      record: () => true,
      clear: () => assert.fail("nothing may clear before intent is durable"),
    }),
    /storage unavailable/,
  );
  assert.equal(sends, 0);

  const state = historyState();
  await assert.rejects(
    submitReserveAttempt({
      attempt: attempt(),
      save: (intent) => {
        state.savedAttempt = JSON.stringify(intent);
      },
      send: async () => {
        sends++;
        throw new Error("RPC timed out after broadcast");
      },
      record: () => assert.fail("no hash was returned"),
      clear: () => assert.fail("ambiguous failures must preserve their intent"),
    }),
    /timed out/,
  );
  assert.deepEqual(restoreAttempt(state.savedAttempt, owner), attempt());
  for (const operation of ["submit", "clear"] as const) {
    await assert.rejects(
      withCheckedReserveHistory({
        owner,
        locks: lockManager(),
        operation,
        read: () => state,
        run: async () =>
          assert.fail("a reloaded intent must block signing and clearing"),
      }),
      /no resolved outcome/,
    );
  }
  assert.equal(sends, 1);
});

test("only definite numeric EIP-1193 user rejection clears an unsuccessful SDK attempt", async () => {
  for (const failure of [
    Object.assign(new Error("The user rejected the request"), { code: 4001 }),
    new Error("user rejected"),
    Object.assign(new Error("network failed"), { code: -32603 }),
  ]) {
    let unresolved = false;
    await assert.rejects(
      submitReserveAttempt({
        attempt: attempt(),
        save: () => {
          unresolved = true;
        },
        send: async () => {
          throw failure;
        },
        record: () => assert.fail("rejections have no hash"),
        clear: () => {
          unresolved = false;
        },
      }),
      failure,
    );
    assert.equal(unresolved, !("code" in failure && failure.code === 4001));
  }
});

test("a returned hash is persisted before intent removal; failed history persistence retains recovery state", async () => {
  for (const saved of [true, false]) {
    const events: string[] = [];
    const submitted = submitReserveAttempt({
      attempt: attempt(),
      save: () => {
        events.push("intent saved");
      },
      send: async () => {
        events.push("SDK returned hash");
        return record().hash;
      },
      record: (entry) => {
        assert.deepEqual(entry.prepared, prepared());
        assert.equal(entry.hash, record().hash);
        events.push("hash persisted");
        return saved;
      },
      clear: () => {
        events.push("intent cleared");
      },
    });
    if (saved) {
      const result = await submitted;
      assert.equal(result.hash, record().hash);
      assert.deepEqual(events, [
        "intent saved",
        "SDK returned hash",
        "hash persisted",
        "intent cleared",
      ]);
    } else {
      await assert.rejects(submitted, /history could not be saved/);
      assert.deepEqual(events, [
        "intent saved",
        "SDK returned hash",
        "hash persisted",
      ]);
    }
  }
});

test("recovery preserves exact intent and requires the same wallet plus an available lock", async () => {
  const state = historyState([record()]);
  state.savedAttempt = JSON.stringify(attempt());
  const recovered = await withCheckedReserveHistory({
    owner,
    locks: lockManager(),
    operation: "recover",
    read: () => state,
    run: async (_history, unresolved) => {
      assert.ok(unresolved);
      return recordFromAttempt(unresolved, record().hash);
    },
  });
  assert.deepEqual(recovered.prepared.action, prepared().action);
  assert.equal(recovered.verification, undefined);
  assert.throws(
    () =>
      restoreAttempt(
        state.savedAttempt,
        "0x2222222222222222222222222222222222222222",
      ),
    /different wallet/,
  );
  assert.throws(() => restoreAttempt("x".repeat(16_385), owner), /invalid/);
  assert.throws(() => recordFromAttempt(attempt(), "made-up-hash"));
  state.activeOwner = null;
  await assert.rejects(
    withCheckedReserveHistory({
      owner,
      locks: lockManager(),
      operation: "recover",
      read: () => state,
      run: async () => assert.fail("account changed before recovery"),
    }),
    /wallet changed/,
  );
  const report = reserveReport([], attempt());
  assert.deepEqual(report.unresolvedAttempt, attempt());
  assert.deepEqual(report.operations, []);
});

test("hash recovery cannot use an older identical operation to resolve a new wallet request", async (t) => {
  let blockNumber = "1";
  const verification = checkedRecord().verification!;
  t.mock.method(
    globalThis,
    "fetch",
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      assert.deepEqual(JSON.parse(init?.body as string), {
        operation: "verify",
        action: prepared().action,
        hash: record().hash,
      });
      return Response.json({
        ...verification,
        hash: record().hash,
        after: { ...verification.after, blockNumber },
        receipt: { ...verification.receipt, blockNumber },
      });
    },
  );
  await assert.rejects(
    verifyReserveAttempt(attempt(), record().hash),
    /predates/,
  );
  blockNumber = "2";
  const recovered = await verifyReserveAttempt(attempt(), record().hash);
  assert.equal(recovered?.verification.status, "verified");
  assert.equal(recovered?.hash, record().hash);
});

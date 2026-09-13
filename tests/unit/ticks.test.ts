import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_TICK,
  MAX_TICK,
  TickDataError,
  validateTickRows,
  validateFullTicks,
  minimumRangeLiquidity,
  supportedTickWindow,
  bitmapWords,
  readRpcTickWindow,
  type TickRow,
  type RpcTickReader,
} from "../../src/domain/ticks";

const row = (
  tick: number,
  net: bigint,
  gross = net < 0n ? -net : net,
): TickRow => ({
  tickIdx: String(tick),
  liquidityNet: String(net),
  liquidityGross: String(gross),
});
const complete = [
  row(-100, 100n),
  row(-30, 40n),
  row(0, -20n),
  row(20, -30n),
  row(50, -90n),
];
const hasCode = (code: string) => (error: unknown) =>
  error instanceof TickDataError && error.code === code;
const activeAt = (ticks: readonly TickRow[], spot: number) =>
  ticks.reduce(
    (sum, t) =>
      Number(t.tickIdx) <= spot ? sum + BigInt(t.liquidityNet) : sum,
    0n,
  );

test("full and RPC-window capacity agree below, above and across spot, including exact boundaries", () => {
  // Independent piecewise distribution: [-100,-30)=100, [-30,0)=140,
  // [0,20)=120, [20,50)=90, and zero outside [-100,50).
  const cases = [
    { spot: 5, lower: -50, upper: -10, expected: 100n },
    { spot: 5, lower: 10, upper: 40, expected: 90n },
    { spot: 5, lower: -20, upper: 30, expected: 90n },
    { spot: 0, lower: 0, upper: 20, expected: 120n },
    { spot: 20, lower: 0, upper: 20, expected: 120n },
    { spot: 20, lower: 20, upper: 50, expected: 90n },
    { spot: -30, lower: -30, upper: 0, expected: 140n },
    { spot: 5, lower: -200, upper: -100, expected: 0n },
    { spot: 5, lower: 50, upper: 100, expected: 0n },
  ];
  for (const c of cases) {
    const liquidity = activeAt(complete, c.spot),
      scope = {
        lower: Math.min(c.lower, c.spot),
        upper: Math.max(c.upper, c.spot),
      };
    const partial = complete.filter(
      (t) =>
        Number(t.tickIdx) >= scope.lower && Number(t.tickIdx) <= scope.upper,
    );
    assert.equal(
      minimumRangeLiquidity(complete, 10, c.spot, liquidity, c.lower, c.upper),
      c.expected,
      JSON.stringify(c, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    );
    assert.equal(
      minimumRangeLiquidity(
        partial,
        10,
        c.spot,
        liquidity,
        c.lower,
        c.upper,
        scope,
      ),
      c.expected,
    );
  }
});

test("window reconstruction may have nonzero edge liquidity and zero initialized ticks", () => {
  const scope = { lower: 1, upper: 19 };
  assert.equal(minimumRangeLiquidity([], 1, 5, 120n, 2, 18, scope), 120n);
  assert.throws(
    () => validateFullTicks([], 1, 5, 120n),
    hasCode("spot-mismatch"),
  );
  // The partial window deliberately omits remote opening and closing ticks.
  assert.equal(
    minimumRangeLiquidity([row(0, -20n)], 10, 5, 120n, -10, 10, {
      lower: -10,
      upper: 10,
    }),
    120n,
  );
});

test("an RPC window must cover spot and every requested range segment", () => {
  assert.throws(
    () =>
      minimumRangeLiquidity([], 10, 5, 120n, 10, 20, { lower: 6, upper: 20 }),
    hasCode("coverage"),
  );
  assert.throws(
    () =>
      minimumRangeLiquidity([], 10, 5, 120n, -10, 20, {
        lower: -10,
        upper: 19,
      }),
    hasCode("coverage"),
  );
  assert.throws(
    () =>
      minimumRangeLiquidity([row(-20, 10n)], 10, 5, 120n, -10, 20, {
        lower: -10,
        upper: 20,
      }),
    hasCode("coverage"),
  );
  // Anchoring at spot must still reject impossible liquidity on either side.
  assert.throws(
    () =>
      minimumRangeLiquidity([row(0, 200n)], 10, 5, 120n, -10, 20, {
        lower: -10,
        upper: 20,
      }),
    hasCode("active-liquidity"),
  );
  assert.throws(
    () =>
      minimumRangeLiquidity([row(20, -200n)], 10, 5, 120n, -10, 20, {
        lower: -10,
        upper: 20,
      }),
    hasCode("active-liquidity"),
  );
});

test("full distributions reject nonzero terminal sums, spot disagreement and negative intermediate liquidity", () => {
  assert.doesNotThrow(() => validateFullTicks(complete, 10, 5, 120n));
  assert.throws(
    () => validateFullTicks([row(-10, 10n)], 10, 0, 10n),
    hasCode("terminal-sum"),
  );
  assert.throws(
    () => validateFullTicks(complete, 10, 5, 121n),
    hasCode("spot-mismatch"),
  );
  assert.throws(
    () => validateFullTicks([row(-10, -10n), row(10, 10n)], 10, 0, 0n),
    hasCode("active-liquidity"),
  );
  const maxInt128 = (1n << 127n) - 1n;
  const overflowing = [row(-40, maxInt128), row(-30, maxInt128), row(-20, 2n)];
  assert.throws(
    () => validateFullTicks(overflowing, 10, 0, 0n),
    hasCode("active-liquidity"),
  );
});

test("tick rows retain signed negative indices and reject encoding, ordering, alignment and liquidity errors", () => {
  assert.doesNotThrow(() =>
    validateTickRows([row(-2560, 30n), row(-10, -30n)], 10),
  );
  const invalid: Array<{ rows: TickRow[]; spacing?: number; code: string }> = [
    { rows: [], spacing: 0, code: "spacing" },
    { rows: [], spacing: 1.5, code: "spacing" },
    { rows: [row(MAX_TICK + 1, 1n)], code: "bounds" },
    { rows: [row(MIN_TICK - 1, 1n)], code: "bounds" },
    { rows: [{ ...row(0, 1n), tickIdx: "1e2" }], code: "bounds" },
    { rows: [row(-10, 1n), row(-10, 1n)], code: "ordering" },
    { rows: [row(10, 1n), row(0, 1n)], code: "ordering" },
    { rows: [row(-11, 1n)], spacing: 10, code: "alignment" },
    { rows: [{ ...row(0, 1n), liquidityNet: "0.5" }], code: "integer" },
    { rows: [{ ...row(0, 1n), liquidityGross: "-1" }], code: "integer" },
    { rows: [row(0, 0n, 0n)], code: "liquidity-bounds" },
    { rows: [row(0, 0n, 1n << 128n)], code: "liquidity-bounds" },
    { rows: [row(0, 1n << 127n, 1n << 127n)], code: "liquidity-bounds" },
    {
      rows: [row(0, -(1n << 127n) - 1n, (1n << 127n) + 1n)],
      code: "liquidity-bounds",
    },
    { rows: [row(0, 2n, 1n)], code: "net-gross" },
    { rows: [row(0, -2n, 1n)], code: "net-gross" },
  ];
  for (const c of invalid)
    assert.throws(
      () => validateTickRows(c.rows, c.spacing ?? 1),
      hasCode(c.code),
    );
  for (const [lower, upper] of [
    [10, 10],
    [20, 10],
    [-11, 10],
    [0, MAX_TICK + 1],
  ]) {
    assert.throws(
      () => minimumRangeLiquidity(complete, 10, 5, 120n, lower, upper),
      hasCode("range"),
    );
  }
});

test("supported RPC windows enclose fee quantiles and every supported conversion discount", () => {
  for (const spacing of [1, 10, 60, 200])
    for (const spot of [-198055, 0, MAX_TICK - 100, MIN_TICK + 100]) {
      const history = Array.from({ length: 168 }, (_, i) =>
        Math.max(MIN_TICK, Math.min(MAX_TICK, spot + (i - 83) * 7)),
      );
      const scope = supportedTickWindow(spot, spacing, history),
        sorted = [...history].sort((a, b) => a - b);
      assert.ok(scope.lower <= spot && scope.upper >= spot);
      assert.ok(scope.lower >= MIN_TICK && scope.upper <= MAX_TICK);
      const lower =
        Math.floor(sorted[Math.floor((sorted.length - 1) * 0.1)] / spacing) *
        spacing;
      const upper = Math.max(
        Math.ceil(sorted[Math.floor((sorted.length - 1) * 0.9)] / spacing) *
          spacing,
        lower + 2 * spacing,
      );
      if (lower >= MIN_TICK && upper <= MAX_TICK) {
        assert.ok(scope.lower <= lower);
        assert.ok(scope.upper >= upper);
      }
      for (let bps = 25; bps <= 1000; bps++) {
        const discount = bps / 10000,
          hi =
            Math.floor(
              (spot + Math.log(1 - discount) / Math.log(1.0001)) / spacing,
            ) * spacing;
        const lo = Math.min(
          Math.floor(
            (spot + Math.log(1 - discount * 1.5) / Math.log(1.0001)) / spacing,
          ) * spacing,
          hi - 2 * spacing,
        );
        if (lo >= MIN_TICK && hi <= MAX_TICK) {
          assert.ok(scope.lower <= lo);
          assert.ok(scope.upper >= hi);
        }
      }
    }
  assert.throws(() => supportedTickWindow(0, 1, []), hasCode("history"));
  assert.throws(
    () => supportedTickWindow(0, 1, [MAX_TICK + 1]),
    hasCode("history"),
  );
  for (const [spot, spacing] of [
    [MAX_TICK + 1, 1],
    [MIN_TICK - 1, 1],
    [0, 0],
    [0, -1],
    [0, 1.5],
    [NaN, 1],
  ]) {
    assert.throws(
      () => supportedTickWindow(spot, spacing, [0]),
      hasCode("range"),
    );
  }
});

test("bitmap words use floor division across negative compressed ticks and enforce request budgets", () => {
  assert.deepEqual(bitmapWords({ lower: -2560, upper: -10 }, 10), [-1]);
  assert.deepEqual(bitmapWords({ lower: -2561, upper: 0 }, 10), [-2, -1, 0]);
  assert.deepEqual(bitmapWords({ lower: -1, upper: 0 }, 10), [-1, 0]);
  assert.throws(
    () => bitmapWords({ lower: 0, upper: 128 * 256 }, 1),
    hasCode("bitmap-budget"),
  );
  for (const [lower, upper, spacing] of [
    [2, 1, 1],
    [MIN_TICK - 1, 0, 1],
    [0, MAX_TICK + 1, 1],
    [0, 0, 0],
    [0, 0, -1],
    [0, 0, 1.5],
    [NaN, 0, 1],
  ]) {
    assert.throws(
      () => bitmapWords({ lower, upper }, spacing),
      hasCode("bitmap-bounds"),
    );
  }
});

const defaultArgs = {
  pool: "0x0000000000000000000000000000000000000001",
  blockNumber: 123456,
  blockHash: `0x${"ab".repeat(32)}`,
  spacing: 10,
  scope: { lower: -2560, upper: 0 },
  reason: "Graph ticks failed validation",
  graphTickCount: 0,
};
function bitmapReader(indices: readonly number[], spacing: number) {
  const calls: {
    kind: "bitmaps" | "ticks";
    indices: number[];
    block: bigint;
  }[] = [];
  const reader: RpcTickReader = {
    async bitmaps(words, block) {
      calls.push({ kind: "bitmaps", indices: [...words], block });
      return words.map((word) =>
        indices.reduce((value, tick) => {
          const compressed = tick / spacing;
          return Math.floor(compressed / 256) === word
            ? value | (1n << BigInt(compressed - word * 256))
            : value;
        }, 0n),
      );
    },
    async ticks(ticks, block) {
      calls.push({ kind: "ticks", indices: [...ticks], block });
      return ticks.map(() => ({
        liquidityGross: 10n,
        liquidityNet: 0n,
        initialized: true,
      }));
    },
  };
  return { reader, calls };
}

test("RPC bitmap enumeration finds ticks absent from Graph, including negative word bits 0 and 255", async () => {
  const { reader, calls } = bitmapReader([-2560, -10, 0, 10], 10);
  const result = await readRpcTickWindow(reader, defaultArgs);
  assert.deepEqual(
    result.ticks.map((t) => Number(t.tickIdx)),
    [-2560, -10, 0],
  );
  assert.deepEqual(calls, [
    { kind: "bitmaps", indices: [-1, 0], block: 123456n },
    { kind: "ticks", indices: [-2560, -10, 0], block: 123456n },
  ]);
  assert.equal(result.evidence.provider, "RPC");
  assert.equal(result.evidence.scope, "range-and-spot");
  assert.equal(result.evidence.poolAddress, defaultArgs.pool);
  assert.equal(result.evidence.graphTickCount, 0);
  assert.equal(result.evidence.tickCount, 3);
  assert.equal(result.evidence.lowerTick, -2560);
  assert.equal(result.evidence.upperTick, 0);
  assert.equal(result.evidence.blockHash, defaultArgs.blockHash);
  assert.equal(result.evidence.blockNumber, 123456);
  assert.match(result.evidence.queryHash, /^[0-9a-f]{64}$/);
  assert.match(result.evidence.responseHash, /^[0-9a-f]{64}$/);
});

test("RPC reads batches of at most 64 at one block and handles an empty window", async () => {
  const { reader, calls } = bitmapReader(
    Array.from({ length: 70 }, (_, i) => i),
    1,
  );
  const result = await readRpcTickWindow(reader, {
    ...defaultArgs,
    spacing: 1,
    scope: { lower: 0, upper: 64 * 256 },
  });
  assert.equal(result.ticks.length, 70);
  assert.deepEqual(
    calls.filter((c) => c.kind === "bitmaps").map((c) => c.indices.length),
    [64, 1],
  );
  assert.deepEqual(
    calls.filter((c) => c.kind === "ticks").map((c) => c.indices.length),
    [64, 6],
  );
  assert.ok(calls.every((c) => c.block === 123456n));
  const empty = bitmapReader([], 1),
    value = await readRpcTickWindow(empty.reader, {
      ...defaultArgs,
      spacing: 1,
    });
  assert.deepEqual(value.ticks, []);
  assert.equal(empty.calls.filter((c) => c.kind === "ticks").length, 0);
});

test("RPC refuses incomplete batches, bitmap mismatches, invalid values and impossible tick liquidity", async () => {
  const base = () => bitmapReader([-10], 10).reader;
  const variants: Array<{ reader: RpcTickReader; code: string }> = [
    { reader: { ...base(), bitmaps: async () => [] }, code: "bitmap-missing" },
    {
      reader: { ...base(), bitmaps: async (words) => words.map(() => -1n) },
      code: "bitmap-value",
    },
    {
      reader: {
        ...base(),
        bitmaps: async (words) => words.map(() => 1n << 256n),
      },
      code: "bitmap-value",
    },
    { reader: { ...base(), ticks: async () => [] }, code: "ticks-missing" },
    {
      reader: {
        ...base(),
        ticks: async () => [
          { liquidityGross: 10n, liquidityNet: 0n, initialized: false },
        ],
      },
      code: "bitmap-mismatch",
    },
    {
      reader: {
        ...base(),
        ticks: async () => [
          { liquidityGross: 1n, liquidityNet: 2n, initialized: true },
        ],
      },
      code: "net-gross",
    },
  ];
  for (const c of variants)
    await assert.rejects(
      readRpcTickWindow(c.reader, defaultArgs),
      hasCode(c.code),
    );
  const outOfBounds = bitmapReader([MAX_TICK + 1], 1);
  await assert.rejects(
    readRpcTickWindow(outOfBounds.reader, {
      ...defaultArgs,
      spacing: 1,
      scope: { lower: MAX_TICK - 10, upper: MAX_TICK },
    }),
    hasCode("bitmap-tick"),
  );
  const many = bitmapReader(
    Array.from({ length: 5001 }, (_, i) => i),
    1,
  );
  await assert.rejects(
    readRpcTickWindow(many.reader, {
      ...defaultArgs,
      spacing: 1,
      scope: { lower: 0, upper: 5000 },
    }),
    hasCode("tick-budget"),
  );
  assert.equal(many.calls.filter((c) => c.kind === "ticks").length, 0);
});

test("RPC collection honors cancellation before issuing requests", async () => {
  const { reader, calls } = bitmapReader([-10], 10),
    controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await assert.rejects(
    readRpcTickWindow(reader, { ...defaultArgs, signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(calls, []);
});

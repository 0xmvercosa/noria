import test from "node:test";
import assert from "node:assert/strict";
import {
  discoveryPoolFilter,
  discoveryTokenSelection,
  parseListedTokens,
  scoreCandidate,
  type RawCandidate,
} from "../../src/services/discovery";
import {
  designPosition,
  sqrtRatioAtTick,
  type PoolDefinition,
} from "../../src/domain/uniswap";
const end = 1789218000;
const p: RawCandidate = {
  id: "0x0000000000000000000000000000000000000001",
  token0: {
    id: "0x0000000000000000000000000000000000000002",
    symbol: "A",
    decimals: "6",
  },
  token1: {
    id: "0x0000000000000000000000000000000000000003",
    symbol: "B",
    decimals: "18",
  },
  feeTier: "500",
  liquidity: "10000000000000000",
  totalValueLockedToken0: "500000",
  totalValueLockedToken1: "500000",
  poolHourData: Array.from({ length: 24 }, (_, i) => ({
    periodStartUnix: end - 86400 + i * 3600,
    volumeToken0: "10000",
    volumeToken1: "10000",
  })),
};

test("compiled token list retains bridge tokens, isolates chains and deduplicates EVM addresses", () => {
  const token = {
    chainId: 130,
    address: "0x00000000000000000000000000000000000000aB",
    symbol: "WETH",
    decimals: 18,
  };
  const list = {
    tokens: [
      token,
      { ...token, address: token.address.toLowerCase() },
      { chainId: 8453, address: p.id, symbol: "BASE", decimals: 6 },
      { chainId: 501, address: "NonEvmAddress", symbol: "SOL", decimals: 9 },
    ],
  };
  assert.deepEqual(parseListedTokens(list, 130), [
    { address: token.address.toLowerCase(), symbol: "WETH", decimals: 18 },
  ]);
  assert.throws(() => parseListedTokens(list, 42161), /empty/);
  assert.throws(() =>
    parseListedTokens({ tokens: [{ ...token, address: "invalid" }] }, 130),
  );
  assert.throws(
    () =>
      parseListedTokens({ tokens: [token, { ...token, decimals: 6 }] }, 130),
    /Conflicting/,
  );
});

test("token preference puts all constraints inside each Graph OR branch and matches either token leg", () => {
  const universe = [p.token0.id, p.token1.id],
    match = [p.token1.id];
  const filter = discoveryPoolFilter(universe, [match], "B", end);
  assert.ok(filter);
  assert.deepEqual(Object.keys(filter), ["or"]);
  assert.ok("or" in filter);
  assert.equal(filter.or.length, 2);
  assert.deepEqual(
    filter.or.map((branch) => [branch.token0_in, branch.token1_in]),
    [
      [match, universe],
      [universe, match],
    ],
  );
  for (const branch of filter.or) {
    assert.equal(branch.createdAtTimestamp_lte, end - 604800);
    assert.equal(branch.liquidity_gt, "0");
    assert.deepEqual(branch.feeTier_in, ["100", "500", "3000", "10000"]);
    assert.equal("or" in branch, false);
  }
  const empty = discoveryPoolFilter(universe, [], "", end);
  assert.ok(empty);
  assert.equal("or" in empty, false);
  assert.equal("id" in empty, false);
  const address = discoveryPoolFilter(universe, [], p.id.toUpperCase(), end);
  assert.ok(address);
  assert.ok("id" in address);
  assert.equal(address.id, p.id);
});

test("pair filters require both token terms before the top-40 cutoff, in both contract orders", () => {
  const a = [p.token0.id, "0x0000000000000000000000000000000000000004"];
  const b = [p.token1.id, "0x0000000000000000000000000000000000000005"];
  const other = "0x0000000000000000000000000000000000000006";
  const filter = discoveryPoolFilter([...a, ...b, other], [a, b], "A/B", end);
  assert.ok(filter && "or" in filter);
  assert.deepEqual(Object.keys(filter), ["or"]);
  assert.deepEqual(
    filter.or.map((branch) => [branch.token0_in, branch.token1_in]),
    [
      [a, b],
      [b, a],
    ],
  );
  for (const branch of filter.or) {
    assert.equal(branch.createdAtTimestamp_lte, end - 604800);
    assert.equal(branch.liquidity_gt, "0");
    assert.deepEqual(branch.feeTier_in, ["100", "500", "3000", "10000"]);
    assert.equal("or" in branch, false);
  }
  const matches = (token0: string, token1: string) =>
    filter.or.some(
      (branch) =>
        branch.token0_in.includes(token0) && branch.token1_in.includes(token1),
    );
  for (const left of a)
    for (const right of b) {
      assert.ok(matches(left, right));
      assert.ok(matches(right, left));
    }
  assert.equal(matches(a[0], other), false);
  assert.equal(matches(other, b[0]), false);
  assert.equal(matches(a[0], a[1]), false);
  assert.equal(matches(b[0], b[1]), false);
  // Forty unrelated, higher-TVL pools must not crowd the matching pair out.
  const ranked = [
    ...Array.from({ length: 40 }, () => ({ token0: a[0], token1: other })),
    { token0: a[0], token1: b[0] },
  ];
  assert.deepEqual(
    ranked.filter((pool) => matches(pool.token0, pool.token1)).slice(0, 40),
    [{ token0: a[0], token1: b[0] }],
  );
});

test("every token term must resolve and address terms preserve pool-address semantics", () => {
  const tokens = [
    { address: p.token0.id, symbol: "ARB", decimals: 18 },
    { address: p.token1.id, symbol: "WETH", decimals: 18 },
  ];
  for (const query of [
    "ARB unknown",
    "unknown WETH",
    "unknown",
    "ARB WETH unknown",
    " / ",
  ]) {
    const { addresses, termMatches } = discoveryTokenSelection(tokens, query);
    assert.equal(discoveryPoolFilter(addresses, termMatches, query, end), null);
  }
  const pair = discoveryTokenSelection(tokens, "arb / WETH");
  assert.deepEqual(pair.termMatches, [[p.token0.id], [p.token1.id]]);
  const addressPair = discoveryTokenSelection(
    tokens,
    `${p.token0.id.toUpperCase()} WETH`,
  );
  assert.deepEqual(addressPair.termMatches, pair.termMatches);
  assert.deepEqual(
    discoveryPoolFilter(
      addressPair.addresses,
      addressPair.termMatches,
      `${p.token0.id} WETH`,
      end,
    ),
    discoveryPoolFilter(pair.addresses, pair.termMatches, "ARB WETH", end),
  );
  const exact = discoveryTokenSelection(tokens, p.id.toUpperCase());
  assert.deepEqual(exact.termMatches, []);
  const exactFilter = discoveryPoolFilter(
    exact.addresses,
    exact.termMatches,
    p.id.toUpperCase(),
    end,
  );
  assert.ok(exactFilter && "id" in exactFilter);
  assert.equal(exactFilter.id, p.id);
  assert.deepEqual(
    exact.addresses,
    tokens.map((token) => token.address),
  );
});

test("the named discovery universe includes common Arbitrum assets only when listed", () => {
  const symbols = [
    "ARB",
    "GMX",
    "PENDLE",
    "RDNT",
    "MAGIC",
    "GNS",
    "UNLISTED-PREFERENCE",
  ];
  const tokens = symbols.map((symbol, index) => ({
    address: `0x${(index + 10).toString(16).padStart(40, "0")}`,
    symbol,
    decimals: 18,
  }));
  const selection = discoveryTokenSelection(tokens, "");
  assert.deepEqual(
    selection.addresses,
    tokens.slice(0, -1).map((token) => token.address),
  );
  assert.deepEqual(selection.termMatches, []);
  assert.deepEqual(
    discoveryTokenSelection(tokens, "PREFERENCE").addresses,
    tokens.map((token) => token.address),
  );
});

test("discovery values both swap legs once, without consuming an untrusted USD TVL field", () => {
  const scored = scoreCandidate("ethereum", p, [1, 1], end)!;
  assert.equal(scored.volume24hUsd, 240000);
  assert.equal(scored.tvlUsd, 1000000);
  assert.equal(scored.activeHours, 24);
  const injected = { ...p, totalValueLockedUSD: "10000000000000000000000000" };
  assert.deepEqual(scoreCandidate("ethereum", injected, [1, 1], end), scored);
});

test("discovery rejects thin, intermittent, duplicate-hour and extreme valuations", () => {
  assert.equal(
    scoreCandidate(
      "ethereum",
      { ...p, totalValueLockedToken0: "1", totalValueLockedToken1: "1" },
      [1, 1],
      end,
    ),
    null,
  );
  assert.equal(
    scoreCandidate(
      "ethereum",
      { ...p, poolHourData: p.poolHourData.slice(0, 17) },
      [1, 1],
      end,
    ),
    null,
  );
  assert.equal(
    scoreCandidate(
      "ethereum",
      { ...p, poolHourData: [...p.poolHourData, p.poolHourData[0]] },
      [1, 1],
      end,
    ),
    null,
  );
  assert.equal(
    scoreCandidate(
      "ethereum",
      { ...p, totalValueLockedToken0: "1e25" },
      [1, 1],
      end,
    ),
    null,
  );
  assert.equal(
    scoreCandidate(
      "ethereum",
      {
        ...p,
        totalValueLockedToken0: "-1000000",
        totalValueLockedToken1: "1400000",
      },
      [1, 1],
      end,
    ),
    null,
  );
  assert.equal(
    scoreCandidate(
      "ethereum",
      {
        ...p,
        poolHourData: p.poolHourData.map((h) => ({
          ...h,
          volumeToken0: "-10000",
          volumeToken1: "20000",
        })),
      },
      [1, 1],
      end,
    ),
    null,
  );
});

test("generic SDK adapter conserves a budget with six/eighteen decimals and one-tick spacing", () => {
  const definition: PoolDefinition = {
    chainId: 1,
    token0: { address: p.token0.id, symbol: "A", decimals: 6 },
    token1: { address: p.token1.id, symbol: "B", decimals: 18 },
    fee: 100,
    tickSpacing: 1,
  };
  const tick = Math.floor(Math.log(1e12 / 2500) / Math.log(1.0001));
  const r = designPosition(
    sqrtRatioAtTick(tick),
    "1000000000000000000",
    tick,
    tick - 100,
    tick + 100,
    5000,
    [1, 2500],
    definition,
  );
  const marked = Number(r.amount0) / 1e6 + (Number(r.amount1) / 1e18) * 2500;
  assert.ok(marked <= 5000);
  assert.ok(Math.abs(marked + Number(r.residualUsd) - 5000) < 1e-8);
  assert.ok(r.amount0 > 0n && r.amount1 > 0n);
});

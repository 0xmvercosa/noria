import test from "node:test";
import assert from "node:assert/strict";
import {
  designPosition,
  sqrtRatioAtTick,
  type PoolDefinition,
} from "../../src/domain/uniswap";

const token0 = "0x0000000000000000000000000000000000000002",
  token1 = "0x0000000000000000000000000000000000000003";

test("SDK inventory conserves every supported capital across token decimals and fee spacings", () => {
  for (const [decimals0, decimals1, usd0, usd1] of [
    [6, 18, 1, 2500],
    [18, 6, 2500, 1],
    [8, 18, 77500, 2500],
  ]) {
    for (const [fee, spacing] of [
      [100, 1],
      [500, 10],
      [3000, 60],
      [10000, 200],
    ]) {
      const definition: PoolDefinition = {
        chainId: 1,
        token0: { address: token0, symbol: "A", decimals: decimals0 },
        token1: { address: token1, symbol: "B", decimals: decimals1 },
        fee,
        tickSpacing: spacing,
      };
      const tick = Math.floor(
        Math.log((usd0 / usd1) * 10 ** (decimals1 - decimals0)) /
          Math.log(1.0001),
      );
      const lower = Math.floor(tick / spacing) * spacing - 2 * spacing,
        upper = Math.ceil(tick / spacing) * spacing + 2 * spacing;
      for (const capital of [1000, 5000, 10000]) {
        const result = designPosition(
          sqrtRatioAtTick(tick),
          "1000000000000000000",
          tick,
          lower,
          upper,
          capital,
          [usd0, usd1],
          definition,
        );
        const inventoryUsd =
          (Number(result.amount0) / 10 ** decimals0) * usd0 +
          (Number(result.amount1) / 10 ** decimals1) * usd1;
        assert.ok(result.amount0 > 0n && result.amount1 > 0n);
        assert.ok(inventoryUsd <= capital + 1e-9);
        assert.ok(
          Math.abs(inventoryUsd + Number(result.residualUsd) - capital) < 1e-8,
        );
      }
    }
  }
});

test("a range below spot holds only token1 and a range above spot holds only token0", () => {
  const definition: PoolDefinition = {
    chainId: 1,
    token0: { address: token0, symbol: "A", decimals: 18 },
    token1: { address: token1, symbol: "B", decimals: 18 },
    fee: 500,
    tickSpacing: 10,
  };
  const below = designPosition(
    sqrtRatioAtTick(0),
    "1000000000000000000",
    0,
    -200,
    -100,
    1000,
    [1, 1],
    definition,
  );
  const above = designPosition(
    sqrtRatioAtTick(0),
    "1000000000000000000",
    0,
    100,
    200,
    1000,
    [1, 1],
    definition,
  );
  assert.equal(below.amount0, 0n);
  assert.ok(below.amount1 > 0n);
  assert.equal(above.amount1, 0n);
  assert.ok(above.amount0 > 0n);
});

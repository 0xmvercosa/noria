import Decimal from "decimal.js";
import { Token } from "@uniswap/sdk-core";
import { Pool, Position, TickMath, type FeeAmount } from "@uniswap/v3-sdk";
import JSBI from "jsbi";
import type { PoolAsset } from "./types";

export interface PoolDefinition {
  chainId: number;
  token0: PoolAsset;
  token1: PoolAsset;
  fee: number;
  tickSpacing: number;
}
const D = Decimal.clone({ precision: 90 });
export const sqrtRatioAtTick = (tick: number) =>
  BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
export function humanPrice(sqrt: bigint, decimals0: number, decimals1: number) {
  return new D(sqrt.toString())
    .pow(2)
    .div(new D(2).pow(192))
    .mul(new D(10).pow(decimals0 - decimals1))
    .toFixed();
}
export function sdkPosition(
  sqrt: bigint,
  activeLiquidity: string,
  tick: number,
  lower: number,
  upper: number,
  liquidity: bigint,
  definition: PoolDefinition,
) {
  const t0 = new Token(
    definition.chainId,
    definition.token0.address,
    definition.token0.decimals,
    definition.token0.symbol,
  );
  const t1 = new Token(
    definition.chainId,
    definition.token1.address,
    definition.token1.decimals,
    definition.token1.symbol,
  );
  const pool = new Pool(
    t0,
    t1,
    definition.fee as FeeAmount,
    sqrt.toString(),
    activeLiquidity,
    tick,
  );
  return new Position({
    pool,
    tickLower: lower,
    tickUpper: upper,
    liquidity: liquidity.toString(),
  });
}
/** All token quantities and integer rounding come from the public Uniswap SDK. */
export function designPosition(
  sqrt: bigint,
  activeLiquidity: string,
  tick: number,
  lower: number,
  upper: number,
  capitalUsd: number,
  prices: readonly [number, number],
  definition: PoolDefinition,
) {
  if (
    ![lower, upper].every(
      (t) => Number.isInteger(t) && t % definition.tickSpacing === 0,
    ) ||
    lower >= upper ||
    !Number.isFinite(capitalUsd) ||
    capitalUsd <= 0 ||
    prices.some((p) => !Number.isFinite(p) || p <= 0)
  )
    throw new Error("Invalid position parameters.");
  const value = (p: Position) => {
    const a = p.mintAmounts;
    return new D(a.amount0.toString())
      .div(new D(10).pow(definition.token0.decimals))
      .mul(prices[0])
      .add(
        new D(a.amount1.toString())
          .div(new D(10).pow(definition.token1.decimals))
          .mul(prices[1]),
      );
  };
  const position = (l: bigint) =>
    sdkPosition(sqrt, activeLiquidity, tick, lower, upper, l, definition);
  const seed = 1000000000000000000n,
    cost = value(position(seed));
  if (!cost.isPositive()) throw new Error("Unpriced position.");
  let left = 0n,
    right =
      BigInt(
        new D(capitalUsd).div(cost).mul(seed.toString()).ceil().toFixed(0),
      ) + 1n;
  const max = (1n << 128n) - 1n;
  while (right < max && value(position(right)).lte(capitalUsd))
    right = right * 2n > max ? max : right * 2n;
  if (right > max) throw new Error("Position exceeds uint128.");
  while (right - left > 1n) {
    const middle = (left + right) / 2n;
    if (value(position(middle)).lte(capitalUsd)) left = middle;
    else right = middle;
  }
  if (!left) throw new Error("Capital rounds to zero liquidity.");
  const chosen = position(left),
    amounts = chosen.mintAmounts,
    deployed = value(chosen);
  return {
    liquidity: left,
    amount0: BigInt(amounts.amount0.toString()),
    amount1: BigInt(amounts.amount1.toString()),
    deployedUsd: deployed.toFixed(),
    residualUsd: new D(capitalUsd).sub(deployed).toFixed(),
  };
}
export function convertedPrincipal(
  lower: number,
  upper: number,
  liquidity: bigint,
  definition: PoolDefinition,
) {
  const sqrt = sqrtRatioAtTick(lower),
    tick = TickMath.getTickAtSqrtRatio(JSBI.BigInt(sqrt.toString()));
  const p = sdkPosition(sqrt, "0", tick, lower, upper, liquidity, definition);
  return {
    amount0: BigInt(p.amount0.quotient.toString()),
    amount1: BigInt(p.amount1.quotient.toString()),
  };
}

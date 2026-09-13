import { Address, AquaXYCAmmStrategy, MakerTraits, Order } from '@1inch/swap-vm-sdk';
import { WETH, USDC } from './boundary.js';

export const DEPLOYMENTS = {
  chainId: 42161,
  aqua: '0x1111113ccf1426a8e30e2bff5e005d929bf6a90a',
  swapVm: '0x111111338c5091e8440b67b168bae16a668ac0de',
  kycNft: '0x26ffc7d378e8e49be2c483295a3e3e511f96a468',
  aavePool: '0x794a61358d6845594f94dc1db02a252b5b4814ad',
  aWeth: '0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8',
  variableDebtUSDC: '0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6',
  uniswapFactory: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
  uniswapRouter: '0xe592427a0aece92de3edee1f18e0157c05861564',
  sourcePool500: '0xc6962004f452be9203591991d15f6b388e09e8d0',
  weth: WETH, usdc: USDC,
} as const;

/**
 * For Arbitrum WETH(18dp) < USDC(6dp) by address, SwapVM's raw ratio scaled by
 * 1e18 equals the human USDC-per-WETH price scaled by 1e6. Inverting or applying
 * Ethereum-mainnet token ordering would silently build the wrong range.
 */
export function buildOfficialOrder(input: {
  maker: string; lowerPriceE6: bigint; upperPriceE6: bigint; lpFeeBps: number; salt: bigint;
}) {
  if (BigInt(WETH) >= BigInt(USDC)) throw new Error('unexpected_token_order');
  if (input.lowerPriceE6 <= 0n || input.lowerPriceE6 >= input.upperPriceE6) throw new Error('invalid_range');
  if (!Number.isInteger(input.lpFeeBps) || input.lpFeeBps < 1 || input.lpFeeBps > 100) throw new Error('fee_out_of_policy');
  const program = AquaXYCAmmStrategy.newConcentrate({
    rawPriceMin: input.lowerPriceE6, rawPriceMax: input.upperPriceE6,
  }).withTxOriginAccessToken(new Address(DEPLOYMENTS.kycNft))
    .withFeeTokenIn(input.lpFeeBps).withSalt(input.salt).build();
  const order = Order.new({ maker: new Address(input.maker), program, traits: MakerTraits.default() });
  return { order, bytes: order.encode().toString() as `0x${string}`,
    strategyHash: order.hash().toString() as `0x${string}` };
}


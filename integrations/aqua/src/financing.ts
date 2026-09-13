import { createPublicClient, http, parseAbi } from "viem";
import { arbitrum } from "viem/chains";
import {
  PositionIntentSchema,
  USDC,
  WETH,
  type PositionIntent,
} from "./boundary.js";
import { DEPLOYMENTS } from "./official.js";

/** Integer sizing, 50bps below the tighter of LTV capacity and the comfortable HF. */
export function sizeLoan(input: {
  collateralUnits: bigint;
  collateralDecimals: number;
  collateralPriceBase: bigint;
  usdcPriceBase: bigint;
  ltvBps: bigint;
  liquidationThresholdBps: bigint;
  comfortableHFWad: bigint;
}) {
  const i = input;
  if (
    i.collateralUnits <= 0n ||
    i.collateralPriceBase <= 0n ||
    i.usdcPriceBase <= 0n ||
    i.ltvBps <= 0n ||
    i.ltvBps >= i.liquidationThresholdBps ||
    i.liquidationThresholdBps > 10000n ||
    i.comfortableHFWad <= 10n ** 18n ||
    ![6, 18].includes(i.collateralDecimals)
  )
    throw new Error("invalid_financing_inputs");
  const collateralBase =
    (i.collateralUnits * i.collateralPriceBase) /
    10n ** BigInt(i.collateralDecimals);
  const byHF =
    (collateralBase * i.liquidationThresholdBps * 10n ** 18n) /
    (10000n * i.comfortableHFWad);
  const byLTV = (collateralBase * i.ltvBps) / 10000n;
  const loanUSDCUnits =
    ((byHF < byLTV ? byHF : byLTV) * 1_000_000n * 9950n) /
    (i.usdcPriceBase * 10000n);
  if (loanUSDCUnits < 1_000_000n) throw new Error("loan_below_one_usdc");
  return {
    collateralBase,
    loanUSDCUnits,
    headroomBps: 50,
    constraint: byHF <= byLTV ? "comfortable_hf" : "ltv",
  };
}

const poolABI = parseAbi([
  "function getConfiguration(address) view returns ((uint256 data))",
  "function ADDRESSES_PROVIDER() view returns(address)",
]);
/** Canonical Aave reads are pinned to one block. Aave enforces caps/liquidity again on execution. */
export async function quoteFinancing(
  intent: PositionIntent,
  rpcUrl: string,
  blockNumber?: bigint,
) {
  intent = PositionIntentSchema.parse(intent);
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl),
  });
  if ((await client.getChainId()) !== 42161) throw new Error("wrong_rpc_chain");
  const at = blockNumber ?? (await client.getBlockNumber());
  const asset = intent.fundingAsset === "ETH" ? WETH : USDC;
  const [cfg, usdcCfg, provider, block] = await Promise.all([
    client.readContract({
      address: DEPLOYMENTS.aavePool,
      abi: poolABI,
      functionName: "getConfiguration",
      args: [asset],
      blockNumber: at,
    }),
    client.readContract({
      address: DEPLOYMENTS.aavePool,
      abi: poolABI,
      functionName: "getConfiguration",
      args: [USDC],
      blockNumber: at,
    }),
    client.readContract({
      address: DEPLOYMENTS.aavePool,
      abi: poolABI,
      functionName: "ADDRESSES_PROVIDER",
      blockNumber: at,
    }),
    client.getBlock({ blockNumber: at }),
  ]);
  const oracle = await client.readContract({
    address: provider,
    abi: parseAbi(["function getPriceOracle() view returns(address)"]),
    functionName: "getPriceOracle",
    blockNumber: at,
  });
  const priceABI = parseAbi([
    "function getAssetPrice(address) view returns(uint256)",
  ]);
  const [collateralPrice, usdcPrice] = await Promise.all(
    [asset, USDC].map((address) =>
      client.readContract({
        address: oracle,
        abi: priceABI,
        functionName: "getAssetPrice",
        args: [address],
        blockNumber: at,
      }),
    ),
  );
  const flag = (d: bigint, bit: bigint) => ((d >> bit) & 1n) === 1n;
  if (
    !flag(cfg.data, 56n) ||
    flag(cfg.data, 57n) ||
    flag(cfg.data, 60n) ||
    !flag(usdcCfg.data, 56n) ||
    !flag(usdcCfg.data, 58n) ||
    flag(usdcCfg.data, 57n) ||
    flag(usdcCfg.data, 60n)
  )
    throw new Error("aave_reserve_unavailable");
  const terms = {
    collateralUnits: BigInt(intent.collateralAmountUnits),
    collateralDecimals: intent.fundingAsset === "ETH" ? 18 : 6,
    collateralPriceBase: collateralPrice!,
    usdcPriceBase: usdcPrice!,
    ltvBps: cfg.data & 65535n,
    liquidationThresholdBps: (cfg.data >> 16n) & 65535n,
    comfortableHFWad: BigInt(intent.comfortableHFWad),
  };
  return {
    intent,
    asset,
    blockNumber: at,
    blockHash: block.hash,
    timestamp: block.timestamp,
    oracle,
    terms,
    ...sizeLoan(terms),
  };
}

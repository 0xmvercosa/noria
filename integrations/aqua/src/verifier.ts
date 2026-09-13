import { createPublicClient, http, parseAbi, type Address } from "viem";
import { arbitrum } from "viem/chains";
import { CHAIN_ID, WETH, USDC, type CanonicalEvidence } from "./boundary.js";
import { DEPLOYMENTS } from "./official.js";

const poolAbi = parseAbi([
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function fee() view returns(uint24)",
  "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
]);
const factoryAbi = parseAbi([
  "function getPool(address,address,uint24) view returns(address)",
]);
export function priceFromSqrt(sqrtPriceX96: bigint, token0: string): bigint {
  if (sqrtPriceX96 <= 0n) throw new Error("invalid_sqrt_price");
  const squared = sqrtPriceX96 * sqrtPriceX96;
  if (token0.toLowerCase() === WETH)
    return (squared * 10n ** 18n) / (1n << 192n);
  if (token0.toLowerCase() === USDC)
    return ((1n << 192n) * 10n ** 18n) / squared;
  throw new Error("unsupported_token0");
}

/** Verify against a single explicit block, including the factory's canonical pool mapping. */
export async function verifySourcePool(
  rpcUrl: string,
  pool: Address,
  blockNumber: bigint,
): Promise<CanonicalEvidence> {
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, { timeout: 15_000 }),
  });
  if ((await client.getChainId()) !== CHAIN_ID)
    throw new Error("wrong_rpc_chain");
  const [token0, token1, feeTierPips, liquidity, slot0, block] =
    await Promise.all([
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token0",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "token1",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "fee",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "liquidity",
        blockNumber,
      }),
      client.readContract({
        address: pool,
        abi: poolAbi,
        functionName: "slot0",
        blockNumber,
      }),
      client.getBlock({ blockNumber }),
    ]);
  const canonical = await client.readContract({
    address: DEPLOYMENTS.uniswapFactory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token0, token1, feeTierPips],
    blockNumber,
  });
  return {
    pool,
    chainId: CHAIN_ID,
    token0,
    token1,
    feeTierPips,
    liquidity: liquidity.toString(),
    spotUSDCPerWethE6: priceFromSqrt(slot0[0], token0).toString(),
    blockNumber: blockNumber.toString(),
    blockHash: block.hash,
    timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    mode: "rpc",
    canonicalFactoryPool: canonical.toLowerCase() === pool.toLowerCase(),
  };
}

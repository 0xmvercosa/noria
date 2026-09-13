import { z } from "zod";
import { createPublicClient, http, parseAbi } from "viem";
import { networkConfig } from "../config/networks";
import {
  AddressSchema,
  DataSchema,
  FEE_SPACING,
  MetaSchema,
  PoolSchema,
  TickSchema,
  digest,
  type GraphData,
  type Snapshot,
} from "../domain/analysis-data";
import { assemblePriceMarks } from "../domain/price-references";
import {
  TickDataError,
  validateFullTicks,
  supportedTickWindow,
  readRpcTickWindow,
  type RpcTickReader,
} from "../domain/ticks";
import type { NetworkId, TickEvidence } from "../domain/types";
import { LiveGraph } from "./graph";
import { readPriceMarks } from "./prices";

// Source collection owns network requests, canonical block reconciliation,
// and provenance. It supplies a snapshot for deterministic report construction.
const abi = parseAbi([
  "function factory() view returns(address)",
  "function token0() view returns(address)",
  "function token1() view returns(address)",
  "function fee() view returns(uint24)",
  "function tickSpacing() view returns(int24)",
  "function liquidity() view returns(uint128)",
  "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
  "function decimals() view returns(uint8)",
  "function getPool(address,address,uint24) view returns(address)",
]);
export function rpcFor(network: NetworkId, signal?: AbortSignal) {
  const n = networkConfig(network);
  return createPublicClient({
    chain: n.chain,
    transport: http(
      process.env[`${network.toUpperCase()}_RPC_URL`]?.trim() || n.rpcUrl,
      {
        timeout: 20000,
        retryCount: 0,
        fetchOptions: signal ? { signal } : undefined,
      },
    ),
  });
}
const tickAbi = parseAbi([
  "function tickBitmap(int16) view returns(uint256)",
  "function ticks(int24) view returns(uint128,int128,uint256,uint256,int56,uint160,uint32,bool)",
]);
export async function recoverRpcTicks(
  network: NetworkId,
  data: GraphData,
  spacing: number,
  reason: string,
) {
  const signal = AbortSignal.timeout(25000),
    rpc = rpcFor(network, signal),
    address = data.pool.id as `0x${string}`;
  const reader: RpcTickReader = {
    bitmaps: async (words, blockNumber) =>
      rpc.multicall({
        contracts: words.map((word) => ({
          address,
          abi: tickAbi,
          functionName: "tickBitmap" as const,
          args: [word] as const,
        })),
        blockNumber,
        allowFailure: false,
        batchSize: 0,
      }),
    ticks: async (indices, blockNumber) =>
      (
        await rpc.multicall({
          contracts: indices.map((tick) => ({
            address,
            abi: tickAbi,
            functionName: "ticks" as const,
            args: [tick] as const,
          })),
          blockNumber,
          allowFailure: false,
          batchSize: 0,
        })
      ).map((row) => ({
        liquidityGross: row[0],
        liquidityNet: row[1],
        initialized: row[7],
      })),
  };
  const result = await readRpcTickWindow(reader, {
    pool: address,
    blockNumber: data._meta.block.number,
    blockHash: data._meta.block.hash,
    spacing,
    scope: supportedTickWindow(
      Number(data.pool.tick),
      spacing,
      data.pool.poolHourData.map((h) => Number(h.tick)),
    ),
    reason,
    graphTickCount: data.ticks.length,
    signal,
  });
  const block = await rpc.getBlock({
    blockNumber: BigInt(data._meta.block.number),
  });
  if (block.hash !== data._meta.block.hash)
    throw new Error(
      "The canonical block changed during RPC tick recovery. Refresh the analysis.",
    );
  return result;
}
export async function pinGraph(graph: LiveGraph, network: NetworkId) {
  const n = networkConfig(network),
    head = await graph.query<{ _meta: unknown }>(
      n.subgraphId,
      "{ _meta { deployment hasIndexingErrors block { number hash timestamp } } }",
    );
  const watermark = MetaSchema.parse(head._meta),
    now = Math.floor(Date.now() / 1000);
  if (watermark.block.timestamp > now)
    throw new Error("Graph returned a future block.");
  const block = await rpcFor(network).getBlock({
    blockNumber: BigInt(Math.max(1, watermark.block.number - n.blockLag)),
  });
  if (!block.hash || block.number === null)
    throw new Error("Canonical Graph query block unavailable.");
  if (now - Number(block.timestamp) > 120)
    throw new Error(
      "Graph source is older than the 120-second policy. Retry when the indexer catches up.",
    );
  return {
    ...watermark,
    block: {
      number: Number(block.number),
      hash: block.hash,
      timestamp: Number(block.timestamp),
    },
  };
}

async function prices(network: NetworkId, pool: z.infer<typeof PoolSchema>) {
  const n = networkConfig(network),
    keys = [
      `${n.llamaChain}:${pool.token0.id}`,
      `${n.llamaChain}:${pool.token1.id}`,
    ] as const;
  return assemblePriceMarks(
    await readPriceMarks([...keys, n.nativePriceKey]),
    keys,
    n.nativePriceKey,
  );
}
export async function collectSnapshot(
  network: NetworkId,
  poolAddress: string,
): Promise<Snapshot> {
  const address = AddressSchema.parse(poolAddress) as `0x${string}`,
    n = networkConfig(network),
    started = Date.now(),
    graph = new LiveGraph();
  try {
    const meta = await pinGraph(graph, network),
      end = Math.floor(meta.block.timestamp / 3600) * 3600,
      pinned = `block:{hash:"${meta.block.hash}"}`;
    const query = `{ _meta(${pinned}) { deployment hasIndexingErrors block { number hash timestamp } } pool(id:"${address}",${pinned}) { id token0 { id symbol decimals } token1 { id symbol decimals } feeTier tick sqrtPrice liquidity poolHourData(first:168,orderBy:periodStartUnix,orderDirection:asc,where:{periodStartUnix_gte:${end - 604800},periodStartUnix_lt:${end}}) { periodStartUnix tick volumeUSD } } ticks(first:1000,orderBy:tickIdx,orderDirection:asc,${pinned},where:{pool:"${address}",liquidityGross_gt:"0"}) { tickIdx liquidityNet liquidityGross } }`;
    const raw = await graph.query(n.subgraphId, query),
      data = DataSchema.parse(raw),
      queries = [query],
      responses: unknown[] = [raw];
    if (
      data.pool.id !== address ||
      data._meta.block.hash !== meta.block.hash ||
      data._meta.deployment !== meta.deployment
    )
      throw new Error("Pinned Graph pool or deployment changed.");
    let page = data.ticks,
      graphTickError: TickDataError | undefined;
    while (page.length === 1000) {
      if (data.ticks.length >= 5000) {
        graphTickError = new TickDataError(
          "graph-budget",
          "The full Graph distribution exceeds the 5,000-tick budget; capacity requires a complete RPC window instead.",
        );
        break;
      }
      const q = `{ ticks(first:1000,orderBy:tickIdx,orderDirection:asc,${pinned},where:{pool:"${address}",liquidityGross_gt:"0",tickIdx_gt:"${page.at(-1)!.tickIdx}"}) { tickIdx liquidityNet liquidityGross } }`;
      const response = await graph.query<{ ticks: unknown }>(n.subgraphId, q);
      page = z.array(TickSchema).parse(response.ticks);
      data.ticks.push(...page);
      queries.push(q);
      responses.push(response);
    }
    const fee = Number(data.pool.feeTier),
      spacing = FEE_SPACING[fee];
    if (!spacing)
      throw new Error("Unsupported fee tier for the public SDK adapter.");
    const rpc = rpcFor(network),
      blockNumber = BigInt(meta.block.number),
      t0 = data.pool.token0.id as `0x${string}`,
      t1 = data.pool.token1.id as `0x${string}`;
    const calls: {
      address: `0x${string}`;
      abi: typeof abi;
      functionName: string;
    }[] = [
      "factory",
      "token0",
      "token1",
      "fee",
      "tickSpacing",
      "liquidity",
      "slot0",
    ].map((functionName) => ({ address, abi, functionName }));
    calls.push(
      { address: t0, abi, functionName: "decimals" },
      { address: t1, abi, functionName: "decimals" },
    );
    const [block, chainId, states, marks, gasPrice] = await Promise.all([
      rpc.getBlock({ blockNumber }),
      rpc.getChainId(),
      rpc.multicall({
        contracts: [
          ...calls,
          {
            address: n.factory,
            abi,
            functionName: "getPool",
            args: [t0, t1, fee],
          },
        ],
        blockNumber,
        allowFailure: false,
      }),
      prices(network, data.pool),
      rpc.getGasPrice(),
    ]);
    const [factory, rt0, rt1, rfee, rspacing, liq, rawSlot, d0, d1, canonical] =
        states as unknown[],
      slot = rawSlot as readonly [
        bigint,
        number,
        number,
        number,
        number,
        number,
        boolean,
      ];
    if (
      chainId !== n.chain.id ||
      block.hash !== meta.block.hash ||
      Number(block.timestamp) !== meta.block.timestamp ||
      String(factory).toLowerCase() !== n.factory.toLowerCase() ||
      String(rt0).toLowerCase() !== t0 ||
      String(rt1).toLowerCase() !== t1 ||
      rfee !== fee ||
      rspacing !== spacing ||
      String(liq) !== data.pool.liquidity ||
      String(slot[0]) !== data.pool.sqrtPrice ||
      slot[1] !== Number(data.pool.tick) ||
      !slot[6] ||
      d0 !== Number(data.pool.token0.decimals) ||
      d1 !== Number(data.pool.token1.decimals) ||
      String(canonical).toLowerCase() !== address
    )
      throw new Error(
        "Graph and RPC disagree on the selected network or canonical pool state.",
      );
    try {
      if (graphTickError) throw graphTickError;
      validateFullTicks(
        data.ticks,
        spacing,
        slot[1],
        BigInt(data.pool.liquidity),
      );
    } catch (error) {
      if (!(error instanceof TickDataError)) throw error;
      graphTickError = error;
    }
    let ticks: TickEvidence | undefined;
    if (graphTickError) {
      try {
        const recovered = await recoverRpcTicks(
          network,
          data,
          spacing,
          `${graphTickError.code}: ${graphTickError.message}`,
        );
        data.ticks = recovered.ticks;
        ticks = recovered.evidence;
      } catch (error) {
        const detail =
          error instanceof TickDataError
            ? error.message
            : "The RPC tick source did not complete a verified response within its request budget.";
        throw new Error(
          `Indexed ticks failed validation (${graphTickError.code}); canonical recovery is unavailable. ${detail} Retry this pool or inspect another candidate.`,
        );
      }
    }
    return {
      network,
      tickSpacing: spacing,
      data,
      receivedAt: new Date().toISOString(),
      queryHash: digest(queries),
      responseHash: digest(responses),
      route: graph.route,
      elapsedMs: Date.now() - started,
      rpcMatched: true,
      ...(ticks ? { ticks } : {}),
      prices: marks,
      gasPriceWei: gasPrice.toString(),
      feeProtocol: slot[5],
    };
  } finally {
    await graph.close();
  }
}

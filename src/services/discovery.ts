import { z } from "zod";
import { LiveGraph } from "../providers/graph";
import { networkConfig } from "../config/networks";
import {
  formatPriceMarkDiagnostic,
  type PriceMarkResult,
} from "../domain/price-mark";
import { readPriceMarks } from "../providers/prices";
import {
  AddressSchema,
  AssetSchema,
  MetaSchema,
  NetworkSchema,
  DiscoverSchema,
} from "../domain/analysis-data";
import { pinGraph } from "../providers/snapshot";
import { analyze } from "./analysis";
import type {
  NetworkId,
  PoolAsset,
  PoolCandidate,
  Discovery,
  DiscoveryResult,
} from "../domain/types";

const tokenCache = new Map<NetworkId, { saved: number; tokens: PoolAsset[] }>();
export const TOKEN_LIST_URL =
  "https://unpkg.com/@uniswap/default-token-list@latest/build/uniswap-default.tokenlist.json";
export function parseListedTokens(raw: unknown, chainId: number): PoolAsset[] {
  const { tokens: rows } = z
    .object({ tokens: z.array(z.unknown()).max(30000) })
    .parse(raw);
  // The compiled list includes generated bridge tokens and non-EVM chains.
  // Select the chain before applying EVM address validation.
  const selected = rows.filter(
    (row) =>
      row !== null &&
      typeof row === "object" &&
      "chainId" in row &&
      row.chainId === chainId,
  );
  const parsed = z
    .array(
      z.object({
        address: AddressSchema,
        symbol: z.string().min(1).max(80),
        decimals: z.number().int().min(0).max(36),
      }),
    )
    .parse(selected);
  const unique = new Map<string, PoolAsset>();
  for (const token of parsed) {
    const previous = unique.get(token.address);
    if (
      previous &&
      (previous.symbol !== token.symbol || previous.decimals !== token.decimals)
    )
      throw new Error("Conflicting token metadata in the public universe.");
    unique.set(token.address, token);
  }
  const tokens = [...unique.values()];
  if (!tokens.length || tokens.length > 1500)
    throw new Error(
      "The token universe is empty or exceeds the discovery query budget.",
    );
  return tokens;
}
async function listedTokens(network: NetworkId): Promise<PoolAsset[]> {
  const n = networkConfig(network),
    cached = tokenCache.get(network);
  if (cached && Date.now() - cached.saved < 3600000) return cached.tokens;
  const response = await fetch(TOKEN_LIST_URL, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "The public token universe is unavailable; no unvetted fallback was used.",
    );
  const tokens = parseListedTokens(await response.json(), n.chain.id);
  tokenCache.set(network, { saved: Date.now(), tokens });
  return tokens;
}
const RawPoolSchema = z.object({
  id: AddressSchema,
  token0: AssetSchema,
  token1: AssetSchema,
  feeTier: z.string(),
  liquidity: z.string(),
  totalValueLockedToken0: z.string(),
  totalValueLockedToken1: z.string(),
  poolHourData: z.array(
    z.object({
      periodStartUnix: z.number().int(),
      volumeToken0: z.string(),
      volumeToken1: z.string(),
    }),
  ),
});
export type RawCandidate = z.infer<typeof RawPoolSchema>;
export function scoreCandidate(
  network: NetworkId,
  p: RawCandidate,
  usd: readonly [number, number],
  end: number,
): PoolCandidate | null {
  if (
    usd.some((x) => !Number.isFinite(x) || x <= 0) ||
    [
      p.totalValueLockedToken0,
      p.totalValueLockedToken1,
      ...p.poolHourData.flatMap((h) => [h.volumeToken0, h.volumeToken1]),
    ].some((x) => !Number.isFinite(Number(x)) || Number(x) < 0)
  )
    return null;
  const tvlUsd =
    Number(p.totalValueLockedToken0) * usd[0] +
    Number(p.totalValueLockedToken1) * usd[1];
  const h = p.poolHourData;
  if (
    new Set(h.map((x) => x.periodStartUnix)).size !== h.length ||
    h.some(
      (x) =>
        x.periodStartUnix < end - 86400 ||
        x.periodStartUnix >= end ||
        x.periodStartUnix % 3600 !== 0,
    )
  )
    return null;
  const volumes = h.map(
    (x) =>
      (Number(x.volumeToken0) * usd[0] + Number(x.volumeToken1) * usd[1]) / 2,
  );
  if (volumes.some((x) => !Number.isFinite(x) || x < 0)) return null;
  const volume24hUsd = volumes.reduce((a, b) => a + b, 0),
    activeHours = volumes.filter((v) => v > 0).length;
  if (
    !Number.isFinite(tvlUsd) ||
    tvlUsd < 250000 ||
    tvlUsd > 1e12 ||
    volume24hUsd < 50000 ||
    volume24hUsd > 1e12 ||
    activeHours < 18 ||
    BigInt(p.liquidity) <= 0n
  )
    return null;
  const turnover = volume24hUsd / tvlUsd;
  const score =
    35 * (activeHours / 24) +
    25 * Math.min(Math.log10(volume24hUsd + 1) / 7, 1) +
    20 * Math.min(Math.log10(tvlUsd + 1) / 7, 1) +
    20 * (1 - Math.exp(-turnover));
  const asset = (a: z.infer<typeof AssetSchema>) => ({
    address: a.id,
    symbol: a.symbol,
    decimals: Number(a.decimals),
  });
  return {
    network,
    address: p.id,
    token0: asset(p.token0),
    token1: asset(p.token1),
    feeTier: Number(p.feeTier),
    tvlUsd,
    volume24hUsd,
    activeHours,
    score: Number(score.toFixed(2)),
    reasons: [
      `${activeHours}/24 completed hours had swaps.`,
      `Approximate 24h turnover ${turnover.toFixed(2)}×; used for discovery, not a position fee estimate.`,
      "TVL and volume re-marked from token quantities; Graph's raw USD valuation is not the final ranking input.",
    ],
  };
}
async function discoveryMarks(
  network: NetworkId,
  addresses: string[],
): Promise<Map<string, PriceMarkResult>> {
  const n = networkConfig(network),
    marks = await readPriceMarks(
      addresses.map((address) => `${n.llamaChain}:${address}`),
    );
  return new Map(
    addresses.map((address) => [
      address,
      marks.get(`${n.llamaChain}:${address}`)!,
    ]),
  );
}
const searchCache = new Map<string, { saved: number; value: Discovery }>();
const searchInflight = new Map<string, Promise<Discovery>>();
const COMMON_DISCOVERY_SYMBOLS = new Set(
  "weth eth usdc usdc.e usdt dai wbtc cbbtc wsteth steth reth cbeth eurc usde susde crvusd link aave uni mkr ldo ezeth weeth tbtc pol wpol wmatic sol fxs frax lusd gho pyusd paxg xaut pepe aerodrome aero snx susd comp bal grt ens arb gmx pendle rdnt magic gns".split(
    " ",
  ),
);
export function discoveryTokenSelection(
  tokens: readonly PoolAsset[],
  query: string,
) {
  const normalized = query.trim().toLowerCase(),
    isPoolAddress = /^0x[\da-f]{40}$/.test(normalized);
  const terms = isPoolAddress
    ? []
    : normalized.split(/[\s/,:<>-]+/).filter(Boolean);
  const termMatches = terms.map((term) =>
    tokens
      .filter(
        (token) =>
          token.symbol.toLowerCase().includes(term) ||
          token.address.toLowerCase() === term,
      )
      .map((token) => token.address),
  );
  const matchedAddresses = new Set(termMatches.flat());
  const addresses = tokens
    .filter(
      (token) =>
        isPoolAddress ||
        COMMON_DISCOVERY_SYMBOLS.has(token.symbol.toLowerCase()) ||
        matchedAddresses.has(token.address),
    )
    .map((token) => token.address);
  return { addresses, termMatches };
}
interface PoolColumnFilter {
  token0_in: readonly string[];
  token1_in: readonly string[];
  liquidity_gt: string;
  feeTier_in: readonly string[];
  createdAtTimestamp_lte: number;
  id?: string;
}
type PoolFilter = PoolColumnFilter | { or: PoolColumnFilter[] };
export function discoveryPoolFilter(
  addresses: readonly string[],
  termMatches: readonly (readonly string[])[],
  query: string,
  timestamp: number,
): PoolFilter | null {
  const base: PoolColumnFilter = {
    token0_in: addresses,
    token1_in: addresses,
    liquidity_gt: "0",
    feeTier_in: ["100", "500", "3000", "10000"],
    createdAtTimestamp_lte: timestamp - 604800,
  };
  const normalized = query.trim().toLowerCase();
  if (/^0x[\da-f]{40}$/.test(normalized)) return { ...base, id: normalized };
  if (!normalized) return base;
  // Every requested term must resolve before a bounded Graph query is made.
  if (
    termMatches.length < 1 ||
    termMatches.length > 2 ||
    termMatches.some((matches) => matches.length === 0)
  )
    return null;
  // Some deployments reject column filters alongside `or`. Distribute the
  // shared constraints into each branch, retaining the universe on both legs.
  if (termMatches.length === 1)
    return {
      or: [
        { ...base, token0_in: termMatches[0] },
        { ...base, token1_in: termMatches[0] },
      ],
    };
  // Apply the pair conjunction before first:40, in both contract orderings.
  // An OR over the union would let unrelated, high-TVL pools crowd out a pair.
  const [first, second] = termMatches;
  return {
    or: [
      { ...base, token0_in: first, token1_in: second },
      { ...base, token0_in: second, token1_in: first },
    ],
  };
}
function serializePoolFilter(filter: PoolFilter): string {
  const columns = (branch: PoolColumnFilter) =>
    Object.entries(branch)
      .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
      .join(",");
  return "or" in filter
    ? `or:[${filter.or.map((branch) => `{${columns(branch)}}`).join(",")}]`
    : columns(filter);
}
async function searchUncached(
  network: NetworkId,
  query: string,
): Promise<Discovery> {
  const n = networkConfig(network),
    tokens = await listedTokens(network),
    { addresses, termMatches } = discoveryTokenSelection(tokens, query);
  if (!discoveryPoolFilter(addresses, termMatches, query, 0))
    return {
      network,
      provider: "The Graph",
      sourceBlock: 0,
      receivedAt: new Date().toISOString(),
      pools: [],
      considered: 0,
      selectedReason:
        "Use one token symbol or a pair with both terms present in the public universe; no broad query was made.",
      limitations: [
        "Search accepts one token preference, two token terms for a pair, or an exact pool contract address. Token-list inclusion is not a risk rating.",
      ],
      rejected: [],
    };
  const graph = new LiveGraph();
  try {
    const meta = await pinGraph(graph, network),
      end = Math.floor(meta.block.timestamp / 3600) * 3600,
      pinned = `block:{hash:"${meta.block.hash}"}`;
    const filter = discoveryPoolFilter(
        addresses,
        termMatches,
        query,
        meta.block.timestamp,
      )!,
      where = serializePoolFilter(filter);
    const q = `{ _meta(${pinned}) { deployment hasIndexingErrors block { number hash timestamp } } pools(first:40,orderBy:totalValueLockedUSD,orderDirection:desc,${pinned},where:{${where}}) { id token0 { id symbol decimals } token1 { id symbol decimals } feeTier liquidity totalValueLockedToken0 totalValueLockedToken1 poolHourData(first:24,orderBy:periodStartUnix,orderDirection:asc,where:{periodStartUnix_gte:${end - 86400},periodStartUnix_lt:${end}}) { periodStartUnix volumeToken0 volumeToken1 } } }`;
    const response = await graph.query(n.subgraphId, q),
      data = z
        .object({ _meta: MetaSchema, pools: z.array(RawPoolSchema) })
        .parse(response);
    if (
      data._meta.block.hash !== meta.block.hash ||
      data._meta.deployment !== meta.deployment
    )
      throw new Error("Discovery Graph block/deployment mismatch.");
    const branches = "or" in filter ? filter.or : [filter];
    const raw = data.pools.filter((p) =>
      branches.some(
        (branch) =>
          branch.token0_in.includes(p.token0.id) &&
          branch.token1_in.includes(p.token1.id) &&
          (!branch.id || branch.id === p.id),
      ),
    );
    const marks = await discoveryMarks(network, [
      ...new Set(raw.flatMap((p) => [p.token0.id, p.token1.id])),
    ]);
    const rejected: Discovery["rejected"] = [],
      pools: PoolCandidate[] = [];
    for (const p of raw) {
      const p0 = marks.get(p.token0.id)!,
        p1 = marks.get(p.token1.id)!;
      if (p0.status !== "valid" || p1.status !== "valid") {
        const failures = ([p.token0, p.token1] as const).flatMap((token) => {
          const mark = marks.get(token.id)!;
          return mark.status === "valid"
            ? []
            : [
                `${mark.provider ?? "Price provider"} — ${formatPriceMarkDiagnostic(`${token.symbol} (${token.id.slice(0, 6)}…${token.id.slice(-4)})`, mark)}`,
              ];
        });
        rejected.push({ address: p.id, reason: failures.join(" ") });
        continue;
      }
      const scored = scoreCandidate(network, p, [p0.price, p1.price], end);
      if (scored) {
        for (const [token, mark] of [
          [p.token0, p0],
          [p.token1, p1],
        ] as const) {
          if (mark.freshness === "aged" || mark.provider === "CoinGecko")
            scored.reasons.push(
              `${mark.provider ?? "Price provider"} — ${formatPriceMarkDiagnostic(`${token.symbol} (${token.id.slice(0, 6)}…${token.id.slice(-4)})`, mark)}`,
            );
        }
        pools.push(scored);
      } else
        rejected.push({
          address: p.id,
          reason:
            "Failed the discovery thresholds: $250k re-marked TVL, $50k approximate 24h volume, swaps in 18/24 hours, or numeric data quality.",
        });
    }
    pools.sort(
      (a, b) => b.score - a.score || a.address.localeCompare(b.address),
    );
    return {
      network,
      provider: graph.route,
      sourceBlock: meta.block.number,
      receivedAt: new Date().toISOString(),
      pools,
      considered: data.pools.length,
      selectedReason: pools.length
        ? "Candidates ranked by recurring activity, re-marked liquidity and turnover; full range checks follow."
        : "No pool met the discovery filters in this bounded scan.",
      limitations: [
        "Bounded scan of up to 40 pools from a named set of commonly traded assets in Uniswap's public token list, expanded by your token query; both contracts must be listed and pools older than seven days. Not every pool on the network is scanned.",
        "The Graph USD TVL orders the initial retrieval only. Final scores use token balances and token volumes re-marked at current independent prices.",
        "Approximate 24h turnover is a triage input, not APR, forward fees or proof of profitability.",
        "Token-list membership and canonical contracts do not establish issuer, depeg, bridge or redemption safety.",
        "Score weights are a transparent research heuristic: 35% active hours, 25% volume scale, 20% liquidity scale, 20% turnover. No predictive validation is claimed.",
      ],
      rejected,
    };
  } finally {
    await graph.close();
  }
}
export async function searchPools(
  rawNetwork: unknown,
  rawQuery: unknown = "",
): Promise<Discovery> {
  const network = NetworkSchema.parse(rawNetwork),
    query = z.string().trim().max(100).parse(rawQuery),
    key = `${network}:${query.toLowerCase()}`;
  const cached = searchCache.get(key);
  if (cached && Date.now() - cached.saved < 15000)
    return structuredClone(cached.value);
  let pending = searchInflight.get(key);
  if (!pending) {
    pending = searchUncached(network, query)
      .then((value) => {
        searchCache.set(key, { saved: Date.now(), value });
        if (searchCache.size > 20)
          searchCache.delete(searchCache.keys().next().value!);
        return value;
      })
      .finally(() => searchInflight.delete(key));
    searchInflight.set(key, pending);
  }
  return structuredClone(await pending);
}
export async function discover(raw: unknown): Promise<DiscoveryResult> {
  const input = DiscoverSchema.parse(raw),
    discovery = await searchPools(input.network, input.query ?? ""),
    { query, ...settings } = input;
  for (const candidate of discovery.pools.slice(0, 4)) {
    try {
      const report = await analyze({
        ...settings,
        poolAddress: candidate.address,
      });
      if (
        report.checks.data !== "verified" ||
        report.checks.construction !== "feasible"
      ) {
        discovery.rejected.push({
          address: candidate.address,
          reason:
            report.checks.data !== "verified"
              ? "Full analysis expired."
              : "Range exceeds the 1% capacity policy for this capital.",
        });
        continue;
      }
      discovery.selectedReason = `${candidate.token0.symbol}/${candidate.token1.symbol} ${candidate.feeTier / 10000}% is the highest-ranked candidate in this scan that passed complete 168-hour history, Graph/RPC identity, USD marks and range-capacity checks for $${input.capitalUsd}. This is a research recommendation, not economic approval.`;
      report.decision.title = "Suggested pool and range";
      report.decision.explanation += ` Selected from ${discovery.considered} scanned pools using recurring flow and liquidity filters.`;
      // Changing the explanation changes the report; its internal digest must change too.
      const { digest } = await import("../domain/analysis-data");
      report.id = digest({ ...report, id: "" });
      return { report, discovery };
    } catch (e) {
      discovery.rejected.push({
        address: candidate.address,
        reason: (e instanceof Error ? e.message : "Analysis unavailable")
          .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
          .slice(0, 240),
      });
    }
  }
  discovery.selectedReason = discovery.pools.length
    ? `The ${Math.min(4, discovery.pools.length)} highest-ranked candidate${discovery.pools.length === 1 ? "" : "s"} did not pass complete range checks. No recommendation is made; reasons are preserved below.`
    : discovery.selectedReason;
  return { report: null, discovery };
}

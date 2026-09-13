import Decimal from "decimal.js";
import { buildReport } from "../../domain/report";
import type { Snapshot } from "../../domain/analysis-data";
import type { Discovery, PoolCandidate } from "../../domain/types";
import { collectSnapshot } from "../../providers/snapshot";
import { searchPools } from "../../services/discovery";
import {
  AQUA_SCHEMA_VERSION,
  AQUA_SCOPE,
  AquaRequestSchema,
  type AquaRecommendation,
  type AquaResponse,
} from "./contract";

type Runtime = {
  search: (network: "arbitrum", query: string) => Promise<Discovery>;
  snapshot: (network: "arbitrum", address: string) => Promise<Snapshot>;
  now: () => number;
};

export function isAquaPair(candidate: PoolCandidate): boolean {
  return (
    candidate.network === "arbitrum" &&
    candidate.token0.address === AQUA_SCOPE.weth.address &&
    candidate.token1.address === AQUA_SCOPE.usdc.address &&
    candidate.token0.decimals === 18 &&
    candidate.token1.decimals === 6 &&
    [100, 500, 3000, 10000].includes(candidate.feeTier)
  );
}

/** The Aqua adapter consumes the same Graph-first engine without choosing a pool in advance. */
export function createAquaRecommendationService(runtime: Runtime) {
  return async function recommend(raw: unknown): Promise<AquaResponse> {
    const input = AquaRequestSchema.parse(raw);
    // Apply exact-contract conjunctions inside The Graph query, before pagination.
    const discovery = structuredClone(
      await runtime.search(
        "arbitrum",
        `${AQUA_SCOPE.weth.address} ${AQUA_SCOPE.usdc.address}`,
      ),
    );
    if (discovery.network !== "arbitrum")
      throw new Error("Discovery returned a different network.");
    const candidates = discovery.pools.filter((candidate) => {
      if (isAquaPair(candidate)) return true;
      discovery.rejected.push({
        address: candidate.address,
        reason:
          "Outside the exact Arbitrum WETH/native-USDC integration scope.",
      });
      return false;
    });
    candidates.sort(
      (a, b) => b.score - a.score || a.address.localeCompare(b.address),
    );
    discovery.pools = candidates;
    let recommendation: AquaRecommendation | null = null;
    let attempted = 0;
    for (const candidate of candidates.slice(0, 4)) {
      attempted++;
      try {
        const snapshot = await runtime.snapshot("arbitrum", candidate.address);
        const pool = snapshot.data.pool;
        if (
          snapshot.network !== "arbitrum" ||
          pool.id !== candidate.address ||
          pool.token0.id !== AQUA_SCOPE.weth.address ||
          pool.token1.id !== AQUA_SCOPE.usdc.address ||
          Number(pool.token0.decimals) !== 18 ||
          Number(pool.token1.decimals) !== 6 ||
          Number(pool.feeTier) !== candidate.feeTier
        )
          throw new Error(
            "The verified snapshot does not match the selected WETH/native-USDC pool.",
          );
        // Value the actual USDC budget at the SAME verified quote used to size inventory.
        // A dollar peg is never assumed. External operating costs stay separate.
        const capitalUsd = new Decimal(input.funding.amountRaw)
          .div(1e6)
          .mul(snapshot.prices.usd[1])
          .toNumber();
        const report = buildReport(
          {
            network: "arbitrum",
            poolAddress: candidate.address,
            capitalUsd,
            intent: input.objective === "buy-eth" ? "buy-token0" : "earn-fees",
            horizonHours: input.reviewAfterHours,
            ...(input.objective === "buy-eth"
              ? { discountBps: input.discountBps ?? 100 }
              : {}),
          },
          snapshot,
          runtime.now(),
        );
        if (
          report.checks.data !== "verified" ||
          Date.parse(report.validUntil) <= runtime.now() * 1000
        )
          throw new Error("Source evidence expired; request a fresh analysis.");
        if (report.checks.construction !== "feasible")
          throw new Error(
            "Range exceeds the 1% per-segment reference liquidity capacity policy for this budget.",
          );
        recommendation = {
          referencePool: {
            venue: "uniswap-v3",
            address: pool.id,
            feeTier: Number(pool.feeTier),
            token0: AQUA_SCOPE.weth,
            token1: AQUA_SCOPE.usdc,
          },
          range: {
            priceUnit: "USDC per WETH",
            lower: report.position.lowerPrice,
            upper: report.position.upperPrice,
            spot: report.pool.relativePrice,
            tickLower: report.position.tickLower,
            tickUpper: report.position.tickUpper,
            location: report.position.location,
            method:
              input.objective === "buy-eth"
                ? "discount-below-spot"
                : "seven-day-hourly-tick-quantiles",
          },
          targetInventory: {
            wethAmountRaw: report.position.amount0Raw,
            usdcAmountRaw: report.position.amount1Raw,
            valuationUsd: report.position.deployedUsd,
            residualValueUsd: report.position.residualUsd,
          },
          funding: {
            usdcAmountRaw: input.funding.amountRaw,
            usdcUsdPrice: report.pool.token1Usd,
            valuationUsd: capitalUsd,
            inventoryPreparationRequired:
              BigInt(report.position.amount0Raw) > 0n,
            swapQuote: null,
          },
          validUntil: report.validUntil,
          report,
        };
        discovery.selectedReason = `${pool.id} is the highest-ranked passing WETH/native-USDC reference pool in this bounded scan. The range is a construction heuristic, not a prediction of Aqua fills or profit.`;
        break;
      } catch (error) {
        discovery.rejected.push({
          address: candidate.address,
          reason: (error instanceof Error
            ? error.message
            : "Analysis unavailable"
          )
            .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
            .slice(0, 300),
        });
      }
    }
    if (!recommendation)
      discovery.selectedReason = `No recommendation: ${attempted} exact-pair candidate(s) attempted; exclusions are preserved.`;
    return {
      schemaVersion: AQUA_SCHEMA_VERSION,
      requestId: input.requestId,
      status: recommendation ? "recommended" : "no-recommendation",
      scope: AQUA_SCOPE,
      request: input,
      evaluatedAt: new Date(runtime.now() * 1000).toISOString(),
      selection: {
        method: "highest-ranked-passing-reference-pool",
        attempted,
        discovery,
      },
      recommendation,
      handoff: {
        executionReady: false,
        aquaStrategy: null,
        transaction: null,
        economics: "not-established",
        requiredNextSteps: [
          "Validate Aave borrowing, total ETH exposure and health in the calling system.",
          "Map the reference price range and inventory to a supported Aqua strategy; Uniswap ticks and fee tiers are not Aqua execution parameters.",
          "Obtain executable inventory swap quotes and apply slippage, price-impact and all cost limits before funding.",
          "Refresh expired evidence; re-check inventory, prices and execution constraints immediately before user authorization.",
          "Keep realized P&L, interest, prior losses and the 50/50 allocation ledger in the execution system.",
        ],
        unpricedCosts: [
          "inventory preparation swap",
          "slippage",
          "price impact",
          "Aqua execution and settlement",
          "Arbitrum L1 data fees",
          "exit swaps",
          "Aave interest",
        ],
      },
    };
  };
}

export const recommendForAqua = createAquaRecommendationService({
  search: searchPools,
  snapshot: collectSnapshot,
  now: () => Math.floor(Date.now() / 1000),
});

import Decimal from "decimal.js";
import { createPublicClient, http, type Address } from "viem";
import { quoteFinancing } from "@noria/aqua/financing";
import { verifySourcePool } from "@noria/aqua/verifier";
import { parseRehearsalPlan } from "@noria/aqua/rehearsal-plan";
import {
  USDC,
  WETH,
  type PositionIntent,
  type CanonicalEvidence,
} from "@noria/aqua/boundary";
import { recommendForAqua } from "./service";
import type { AquaRequest, AquaResponse } from "./contract";
import {
  PositionRequestSchema,
  type PositionFinancing,
  type PositionPlanResponse,
  type PositionExecutionPlan,
} from "./position-contract";

type Financing = Awaited<ReturnType<typeof quoteFinancing>>;
export type PositionRuntime = {
  finance: (intent: PositionIntent) => Promise<Financing>;
  recommend: (input: AquaRequest) => Promise<AquaResponse>;
  verify: (pool: Address, block: bigint) => Promise<CanonicalEvidence>;
  head: () => Promise<bigint>;
  now: () => number;
};
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const hash = (value: string) => {
  if (!/^(0x)?[a-fA-F0-9]{64}$/.test(value))
    throw new Error("invalid_graph_provenance_hash");
  return ("0x" + value.replace(/^0x/, "")).toLowerCase();
};
const units = (value: number, round: Decimal.Rounding) =>
  new Decimal(value).mul(1e6).toDecimalPlaces(0, round).toFixed(0);
const int = (value: string) => /^(0|[1-9][0-9]{0,77})$/.test(value);
function financingWire(f: Financing): PositionFinancing {
  return {
    collateralAsset: f.asset,
    collateralAmountUnits: f.intent.collateralAmountUnits,
    loanUSDCUnits: String(f.loanUSDCUnits),
    collateralPriceBase: String(f.terms.collateralPriceBase),
    usdcPriceBase: String(f.terms.usdcPriceBase),
    ltvBps: String(f.terms.ltvBps),
    liquidationThresholdBps: String(f.terms.liquidationThresholdBps),
    blockNumber: String(f.blockNumber),
    blockHash: f.blockHash,
    timestamp: new Date(Number(f.timestamp) * 1000).toISOString(),
    headroomBps: f.headroomBps,
  };
}

/** Consume the actual Graph research contract without inventing a different ranking or source block. */
export function createPositionService(runtime: PositionRuntime) {
  return async function position(raw: unknown): Promise<PositionPlanResponse> {
    const input = PositionRequestSchema.parse(raw);
    const f = await runtime.finance(input.intent);
    const financing = financingWire(f);
    const now = runtime.now();
    const result: PositionPlanResponse = {
      schemaVersion: "noria.aqua.position.v1",
      requestId: input.requestId,
      status: "refused",
      evaluatedAt: new Date(now).toISOString(),
      validUntil: new Date(now + 300_000).toISOString(),
      intent: input.intent,
      financing,
      graph: null,
      execution: null,
      reasons: [],
      routingStatus: "not_validated",
      economics: "not-established",
    };
    const reject = (reason: string) => {
      result.reasons.push(reason);
      return result;
    };
    if (f.loanUSDCUnits < 1_000_000n || f.loanUSDCUnits > 100_000_000_000n)
      return reject(
        "The sized loan is outside the Graph API inventory budget of 1–100,000 USDC. Change collateral or health limits; no amount was silently clamped.",
      );
    const graph = await runtime.recommend({
      schemaVersion: "noria.aqua.v1",
      requestId: input.requestId,
      chainId: 42161,
      funding: { tokenAddress: USDC, amountRaw: String(f.loanUSDCUnits) },
      objective: "earn-fees",
      reviewAfterHours: input.reviewAfterHours,
    });
    result.graph = graph;
    if (
      graph.schemaVersion !== "noria.aqua.v1" ||
      graph.requestId !== input.requestId ||
      graph.request.requestId !== input.requestId ||
      graph.request.chainId !== 42161 ||
      graph.request.reviewAfterHours !== input.reviewAfterHours ||
      graph.request.funding.amountRaw !== String(f.loanUSDCUnits) ||
      !same(graph.request.funding.tokenAddress, USDC) ||
      graph.request.objective !== "earn-fees" ||
      graph.scope.chainId !== 42161 ||
      graph.selection.method !== "highest-ranked-passing-reference-pool"
    )
      return reject(
        "The Graph response does not match the financed inventory request.",
      );
    const rec = graph.recommendation;
    if (graph.status !== "recommended" || !rec)
      return reject(
        graph.selection.discovery.selectedReason ||
          "No eligible Graph reference.",
      );
    const end = Math.min(
      now + 300_000,
      Date.parse(rec.validUntil),
      Date.parse(rec.report.validUntil),
      Date.parse(financing.timestamp) + 3600_000,
    );
    if (!Number.isFinite(end) || end <= runtime.now())
      return reject(
        "The financing or Graph evidence expired; request a new plan.",
      );
    result.validUntil = new Date(end).toISOString();
    const p = rec.referencePool,
      r = rec.report;
    if (
      p.venue !== "uniswap-v3" ||
      !same(p.token0.address, WETH) ||
      !same(p.token1.address, USDC) ||
      p.token0.decimals !== 18 ||
      p.token1.decimals !== 6 ||
      ![100, 500, 3000, 10000].includes(p.feeTier) ||
      r.pool.network !== "arbitrum" ||
      !same(r.pool.address, p.address) ||
      !same(r.pool.token0Address, WETH) ||
      !same(r.pool.token1Address, USDC)
    )
      return reject(
        "Graph returned a reference outside the exact Arbitrum WETH/native-USDC scope.",
      );
    if (
      rec.range.location !== "active" ||
      r.position.location !== "active" ||
      !int(rec.targetInventory.wethAmountRaw) ||
      !int(rec.targetInventory.usdcAmountRaw) ||
      BigInt(rec.targetInventory.wethAmountRaw) <= 0n ||
      BigInt(rec.targetInventory.usdcAmountRaw) <= 0n ||
      BigInt(rec.targetInventory.usdcAmountRaw) >= f.loanUSDCUnits
    )
      return reject(
        "This release requires an active two-token position. Waiting or single-token research is preserved but cannot be shipped.",
      );
    if (
      rec.range.priceUnit !== "USDC per WETH" ||
      ![rec.range.lower, rec.range.upper, rec.range.spot].every(
        (x) => Number.isFinite(x) && x > 0,
      ) ||
      rec.range.lower >= rec.range.upper
    )
      return reject("Invalid economic range.");
    if (
      r.checks.data !== "verified" ||
      r.checks.construction !== "feasible" ||
      !Number.isFinite(r.position.maxSharePercent) ||
      r.position.maxSharePercent < 0 ||
      r.position.maxSharePercent > 1
    )
      return reject(
        "Graph source or per-segment capacity checks did not pass.",
      );
    if (
      !Number.isSafeInteger(r.source.blockNumber) ||
      r.source.blockNumber <= 0 ||
      !Number.isSafeInteger(r.source.blockTimestamp) ||
      runtime.now() / 1000 - r.source.blockTimestamp > 3600 ||
      r.source.blockTimestamp > runtime.now() / 1000 + 60
    )
      return reject("The indexed block is invalid or stale.");
    const source = await runtime.verify(
      p.address as Address,
      BigInt(r.source.blockNumber),
    );
    const head = await runtime.head();
    const current =
      head === BigInt(r.source.blockNumber)
        ? source
        : await runtime.verify(p.address as Address, head);
    for (const evidence of [source, current]) {
      if (
        evidence.mode !== "rpc" ||
        evidence.chainId !== 42161 ||
        !same(evidence.pool, p.address) ||
        !evidence.canonicalFactoryPool ||
        !same(evidence.token0, WETH) ||
        !same(evidence.token1, USDC) ||
        evidence.feeTierPips !== p.feeTier ||
        BigInt(evidence.liquidity) <= 0n
      )
        return reject(
          "Independent RPC verification rejected the reference pool.",
        );
    }
    if (
      source.blockNumber !== String(r.source.blockNumber) ||
      !same(source.blockHash, r.source.blockHash) ||
      head < BigInt(r.source.blockNumber) ||
      current.blockNumber !== String(head)
    )
      return reject(
        "Graph indexed block identity does not match the canonical chain.",
      );
    if (
      !Number.isFinite(Date.parse(current.timestamp)) ||
      runtime.now() - Date.parse(current.timestamp) > 120_000 ||
      Date.parse(current.timestamp) > runtime.now() + 60_000
    )
      return reject("Current canonical state is stale or from the future.");
    const lower = BigInt(units(rec.range.lower, Decimal.ROUND_FLOOR)),
      upper = BigInt(units(rec.range.upper, Decimal.ROUND_CEIL));
    const currentPrice = BigInt(current.spotUSDCPerWethE6),
      sourcePrice = BigInt(source.spotUSDCPerWethE6),
      graphPrice = BigInt(units(rec.range.spot, Decimal.ROUND_HALF_UP));
    const difference = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
    if (
      currentPrice <= 0n ||
      sourcePrice <= 0n ||
      difference(graphPrice, sourcePrice) * 10000n > sourcePrice * 100n ||
      difference(currentPrice, sourcePrice) * 10000n > sourcePrice * 100n
    )
      return reject(
        "The reference price moved or diverged by more than 1%; replan before preparing inventory.",
      );
    if (!(lower < currentPrice && currentPrice < upper))
      return reject("Current spot is outside the proposed range.");
    const history = r.pool.history;
    if (
      history.length < 24 ||
      history.length > 720 ||
      new Set(history.map((h) => h.timestamp)).size !== history.length ||
      history.some(
        (h) =>
          !Number.isSafeInteger(h.timestamp) ||
          !Number.isFinite(h.price) ||
          h.price <= 0 ||
          h.timestamp > r.source.blockTimestamp,
      )
    )
      return reject("Invalid or insufficient hourly range observations.");
    const ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
    const windowEnd = Math.min(
      r.source.blockTimestamp,
      ordered.at(-1)!.timestamp + 3600,
    );
    if (runtime.now() / 1000 - windowEnd > 3600)
      return reject("The hourly observation window is stale.");
    const count = history.filter(
      (h) => h.price >= rec.range.lower && h.price <= rec.range.upper,
    ).length;
    const coverage = Math.floor((count * 10000) / history.length);
    if (coverage < 8000)
      return reject(
        "Fewer than 80% of the actual hourly observations fall inside this proposed range.",
      );
    const execution: PositionExecutionPlan = {
      chainId: 42161,
      sourcePool: p.address,
      sourceFeeTierPips: p.feeTier,
      lowerPriceE6: String(lower),
      upperPriceE6: String(upper),
      lpFeeBps: p.feeTier / 100,
      targetWethUnits: rec.targetInventory.wethAmountRaw,
      targetUsdcUnits: rec.targetInventory.usdcAmountRaw,
      convertUsdcUnits: String(
        f.loanUSDCUnits - BigInt(rec.targetInventory.usdcAmountRaw),
      ),
      selectionMethod: graph.selection.method,
      observationCount: history.length,
      inRangeObservations: count,
      coverageBps: coverage,
      observedWindowStart: new Date(ordered[0]!.timestamp * 1000).toISOString(),
      observedWindowEnd: new Date(windowEnd * 1000).toISOString(),
      graphQueryHash: hash(r.source.queryHash),
      graphResponseHash: hash(r.source.responseHash),
      graphHashAlgorithm: "sha256",
      graphIndexedBlock: String(r.source.blockNumber),
      graphIndexedBlockHash: r.source.blockHash,
      canonicalSourceLiquidity: source.liquidity,
      canonicalCurrentBlock: current.blockNumber,
      programBuilder: "@1inch/swap-vm-sdk@0.4.4",
    };
    result.execution = execution;
    result.status = "ready-for-local-rehearsal";
    result.reasons = [
      "Source-pool rankings and hourly observations come from the real Graph service; discovery TVL and detailed indexed evidence retain their separate blocks.",
      "Inventory uses the returned asymmetric WETH/USDC targets. Aave collateral is not spendable Aqua inventory.",
      "This is an unsigned plan for review and local rehearsal. Historical fees do not forecast Aqua profit or establish routing.",
    ];
    // The HTTP producer and downloaded-plan consumer enforce the same evidence boundary.
    try {
      parseRehearsalPlan(result, runtime.now());
    } catch {
      result.status = "refused";
      result.execution = null;
      result.reasons = [
        "The returned Graph evidence is inconsistent with the executable plan or expired during verification. Request a new plan.",
      ];
    }
    return result;
  };
}
const rpc = () =>
  process.env.ARBITRUM_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
export const planPosition = createPositionService({
  finance: (intent) => quoteFinancing(intent, rpc()),
  recommend: recommendForAqua,
  verify: (pool, block) => verifySourcePool(rpc(), pool, block),
  head: () => createPublicClient({ transport: http(rpc()) }).getBlockNumber(),
  now: Date.now,
});

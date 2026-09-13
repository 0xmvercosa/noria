import { z } from "zod";

export const CHAIN_ID = 42161 as const;
export const WETH = "0x82af49447d8a07e3bd95bd0d56f35241523fbab1" as const;
export const USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831" as const;
export const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const uint = z
  .string()
  .max(78)
  .regex(/^(0|[1-9][0-9]*)$/)
  .refine((x) => BigInt(x) < 2n ** 256n, "uint256 overflow");
const positive = uint.refine((x) => BigInt(x) > 0n, "must be positive");
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const instant = z.iso.datetime();
const id = z.string().min(1).max(160);
const block = z.strictObject({ number: uint, hash, timestamp: instant });

/** Capital is supplied as collateral; a separately sized USDC loan funds the LP. */
export const PositionIntentSchema = z
  .strictObject({
    fundingAsset: z.enum(["ETH", "USDC"]),
    collateralAmountUnits: positive,
    safetyHFWad: positive,
    comfortableHFWad: positive,
    financingMode: z.literal("aave_collateral_then_borrow_usdc"),
  })
  .refine(
    (x) =>
      BigInt(x.safetyHFWad) > 10n ** 18n &&
      BigInt(x.comfortableHFWad) > BigInt(x.safetyHFWad) &&
      BigInt(x.comfortableHFWad) <= 10n ** 19n,
    "require 1 < safety HF < comfortable HF <= 10",
  );
export type PositionIntent = z.infer<typeof PositionIntentSchema>;

/** Information request initiated by Aqua. It contains no keys, approvals or executable calldata. */
export const DiscoveryRequestSchema = z.strictObject({
  schemaVersion: z.literal("noria.aqua.discovery.v1"),
  requestId: id,
  createdAt: instant,
  expiresAt: instant,
  chainId: z.literal(CHAIN_ID),
  pair: z.strictObject({ base: z.literal(WETH), quote: z.literal(USDC) }),
  capitalUSDCUnits: positive,
  positionIntent: PositionIntentSchema,
  policy: z.strictObject({
    maxSourceAgeSeconds: z.number().int().min(1).max(86400),
    maxCapitalShareBps: z.number().int().min(1).max(1000),
    minCoverageBps: z.number().int().min(0).max(10000),
    maxRangeWidthBps: z.number().int().min(1).max(20000),
    minObservations: z.number().int().min(24).max(10000),
  }),
  objective: z.literal("historical_fee_density_times_range_coverage"),
});

/** A source Uniswap pool informs a NEW Aqua position; its address is never a deposit target. */
export const CandidateSchema = z.strictObject({
  candidateId: id,
  sourcePool: z.strictObject({
    protocol: z.literal("uniswap-v3"),
    address,
    chainId: z.literal(CHAIN_ID),
    token0: address,
    token1: address,
    feeTierPips: z.number().int().min(1).max(10000),
    liquidity: positive,
    tvlUSDCUnits: positive,
    volume24hUSDCUnits: uint,
    spotUSDCPerWethE6: positive,
  }),
  range: z.strictObject({
    lowerUSDCPerWethE6: positive,
    upperUSDCPerWethE6: positive,
    inRangeObservations: z.number().int().min(0),
    totalObservations: z.number().int().min(1),
    windowStart: instant,
    windowEnd: instant,
    method: z.literal("observed_prices_inside_proposed_range"),
  }),
  source: z.strictObject({
    kind: z.literal("the-graph"),
    deployment: z.string().min(1),
    queryHash: hash,
    indexedBlock: block,
    queriedAt: instant,
    mode: z.enum(["live", "synthetic-example"]),
  }),
});
export const CandidateBundleSchema = z.strictObject({
  schemaVersion: z.literal("noria.aqua.candidates.v1"),
  requestId: id,
  candidates: z.array(CandidateSchema).max(100),
});
export type DiscoveryRequest = z.infer<typeof DiscoveryRequestSchema>;
export type Candidate = z.infer<typeof CandidateSchema>;
export type CandidateBundle = z.infer<typeof CandidateBundleSchema>;

export type CanonicalEvidence = {
  pool: string;
  chainId: number;
  token0: string;
  token1: string;
  feeTierPips: number;
  liquidity: string;
  spotUSDCPerWethE6: string;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
  mode: "rpc" | "synthetic-example";
  canonicalFactoryPool: boolean;
};
export type CandidateAssessment = {
  candidateId: string;
  eligible: boolean;
  reasons: string[];
  historicalScorePpm: string;
  historicalPoolFees24hUSDCUnits: string;
  coverageBps: number;
};
export type PlanDecision = {
  schemaVersion: "noria.aqua.decision.v1";
  requestId: string;
  status: "refused" | "eligible_for_owner_review" | "simulation_only";
  selectedCandidateId: string | null;
  assessments: CandidateAssessment[];
  selectedRange: Candidate["range"] | null;
  capitalUSDCUnits: string;
  positionIntent: PositionIntent;
  executionChainId: typeof CHAIN_ID;
  pair: { base: typeof WETH; quote: typeof USDC };
  routingStatus: "not_validated";
  instructions: string[];
};

export function createDiscoveryRequest(
  capitalUSDCUnits: string,
  requestId: string,
  now = new Date(),
  positionIntent: PositionIntent = {
    fundingAsset: "ETH",
    collateralAmountUnits: "10000000000000000000",
    safetyHFWad: "1400000000000000000",
    comfortableHFWad: "2000000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  },
): DiscoveryRequest {
  return DiscoveryRequestSchema.parse({
    schemaVersion: "noria.aqua.discovery.v1",
    requestId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
    chainId: CHAIN_ID,
    pair: { base: WETH, quote: USDC },
    capitalUSDCUnits,
    positionIntent,
    policy: {
      maxSourceAgeSeconds: 3600,
      maxCapitalShareBps: 1000,
      minCoverageBps: 8000,
      maxRangeWidthBps: 6000,
      minObservations: 24,
    },
    objective: "historical_fee_density_times_range_coverage",
  });
}

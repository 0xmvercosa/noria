import { z } from "zod";
import type { Discovery, LiveReport } from "../../domain/types";

/** Contract identity, not a ticker, defines the integration's asset universe. */
export const AQUA_SCOPE = {
  chainId: 42161,
  network: "arbitrum",
  referenceVenue: "uniswap-v3",
  weth: {
    address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    symbol: "WETH",
    decimals: 18,
  },
  usdc: {
    address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    symbol: "USDC",
    decimals: 6,
  },
} as const;

export const AQUA_SCHEMA_VERSION = "noria.aqua.v1" as const;
export const AquaRequestSchema = z
  .object({
    schemaVersion: z.literal(AQUA_SCHEMA_VERSION),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    chainId: z.literal(AQUA_SCOPE.chainId),
    funding: z
      .object({
        tokenAddress: z
          .string()
          .regex(/^0x[\da-fA-F]{40}$/)
          .transform((address) => address.toLowerCase())
          .refine(
            (address) => address === AQUA_SCOPE.usdc.address,
            "Funding must be native USDC on Arbitrum; USDC.e is not supported.",
          ),
        // Integer strings avoid JSON floating-point loss at the boundary.
        amountRaw: z
          .string()
          .regex(/^[1-9][0-9]{0,11}$/)
          .refine(
            (amount) =>
              /^[1-9][0-9]{0,11}$/.test(amount) &&
              BigInt(amount) >= 1_000_000n &&
              BigInt(amount) <= 100_000_000_000n,
            "The informational budget must be between 1 and 100,000 USDC.",
          ),
      })
      .strict(),
    objective: z.enum(["earn-fees", "buy-eth"]),
    reviewAfterHours: z.union([z.literal(6), z.literal(24)]),
    discountBps: z.number().int().min(25).max(1000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.objective === "earn-fees" && input.discountBps !== undefined)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["discountBps"],
        message: "discountBps applies only to buy-eth.",
      });
  });

export type AquaRequest = z.infer<typeof AquaRequestSchema>;

export interface AquaRecommendation {
  referencePool: {
    venue: "uniswap-v3";
    address: string;
    feeTier: number;
    token0: typeof AQUA_SCOPE.weth;
    token1: typeof AQUA_SCOPE.usdc;
  };
  range: {
    priceUnit: "USDC per WETH";
    lower: number;
    upper: number;
    spot: number;
    tickLower: number;
    tickUpper: number;
    location: "active" | "waiting";
    method: "seven-day-hourly-tick-quantiles" | "discount-below-spot";
  };
  targetInventory: {
    wethAmountRaw: string;
    usdcAmountRaw: string;
    valuationUsd: number;
    residualValueUsd: number;
  };
  funding: {
    usdcAmountRaw: string;
    usdcUsdPrice: number;
    valuationUsd: number;
    inventoryPreparationRequired: boolean;
    swapQuote: null;
  };
  validUntil: string;
  /** Full original report, including source hashes and price timestamps. */
  report: LiveReport;
}

export interface AquaResponse {
  schemaVersion: typeof AQUA_SCHEMA_VERSION;
  requestId: string;
  status: "recommended" | "no-recommendation";
  scope: typeof AQUA_SCOPE;
  request: AquaRequest;
  evaluatedAt: string;
  selection: {
    method: "highest-ranked-passing-reference-pool";
    attempted: number;
    discovery: Discovery;
  };
  recommendation: AquaRecommendation | null;
  handoff: {
    executionReady: false;
    aquaStrategy: null;
    transaction: null;
    economics: "not-established";
    requiredNextSteps: string[];
    unpricedCosts: string[];
  };
}

export const AQUA_REQUEST_EXAMPLE: AquaRequest = {
  schemaVersion: AQUA_SCHEMA_VERSION,
  requestId: "aqua-preview-001",
  chainId: 42161,
  funding: {
    tokenAddress: AQUA_SCOPE.usdc.address,
    amountRaw: "1000000000",
  },
  objective: "earn-fees",
  reviewAfterHours: 6,
};

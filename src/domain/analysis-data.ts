import { createHash } from "node:crypto";
import { z } from "zod";
import type { NetworkId, PriceReferenceQuote, TickEvidence } from "./types";

// Shared input and evidence contracts keep provider collection independent
// from deterministic report construction.
export const NetworkSchema = z.enum([
  "ethereum",
  "base",
  "arbitrum",
  "unichain",
]);
export const AddressSchema = z
  .string()
  .regex(/^0x[\da-fA-F]{40}$/)
  .transform((s) => s.toLowerCase());
export const IntentFields = {
  capitalUsd: z.union([z.literal(1000), z.literal(5000), z.literal(10000)]),
  intent: z.enum(["earn-fees", "buy-token0"]),
  horizonHours: z.union([z.literal(6), z.literal(24)]),
  discountBps: z.number().int().min(25).max(1000).optional(),
};
export const AnalyzeSchema = z
  .object({
    ...IntentFields,
    network: NetworkSchema,
    poolAddress: AddressSchema,
  })
  .strict();
export const DiscoverSchema = z
  .object({
    ...IntentFields,
    network: NetworkSchema,
    query: z.string().trim().max(100).optional(),
  })
  .strict();
const intString = z.string().regex(/^-?\d+$/);
export const AssetSchema = z.object({
  id: AddressSchema,
  symbol: z.string().min(1).max(80),
  decimals: z
    .string()
    .regex(/^\d+$/)
    .refine((s) => Number(s) <= 36),
});
export const HourSchema = z.object({
  periodStartUnix: z.number().int(),
  tick: intString,
  volumeUSD: z.string(),
});
export const PoolSchema = z.object({
  id: AddressSchema,
  token0: AssetSchema,
  token1: AssetSchema,
  feeTier: z.string(),
  tick: intString,
  sqrtPrice: intString,
  liquidity: intString,
  poolHourData: z.array(HourSchema),
});
export const MetaSchema = z.object({
  deployment: z.string().min(1),
  hasIndexingErrors: z.literal(false),
  block: z.object({
    number: z.number().int().positive(),
    hash: z.string().regex(/^0x[\da-f]{64}$/),
    timestamp: z.number().int().positive(),
  }),
});
export const TickSchema = z.object({
  tickIdx: intString,
  liquidityNet: intString,
  liquidityGross: intString,
});
export const DataSchema = z.object({
  _meta: MetaSchema,
  pool: PoolSchema,
  ticks: z.array(TickSchema),
});
export type GraphData = z.infer<typeof DataSchema>;

export interface Snapshot {
  network: NetworkId;
  tickSpacing: number;
  data: GraphData;
  receivedAt: string;
  queryHash: string;
  responseHash: string;
  route: string;
  elapsedMs: number;
  rpcMatched: true;
  ticks?: TickEvidence;
  prices: {
    usd: [number, number];
    nativeUsd: number;
    timestamp: number;
    source: string;
    references?: Omit<PriceReferenceQuote, "symbol">[];
  };
  gasPriceWei: string;
  feeProtocol: number;
}

export const FEE_SPACING: Record<number, number> = {
  100: 1,
  500: 10,
  3000: 60,
  10000: 200,
};

export const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");

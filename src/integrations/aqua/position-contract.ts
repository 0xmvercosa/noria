import { z } from "zod";
import {
  PositionIntentSchema,
  type PositionIntent,
} from "@noria/aqua/boundary";
import type { AquaResponse } from "./contract";

/** User capital denotes collateral; only the resulting loan is sent to Graph discovery. */
export const PositionRequestSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.position.v1"),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    intent: z.unknown(),
    reviewAfterHours: z.union([z.literal(6), z.literal(24)]).default(6),
  })
  .strict()
  .transform((value, context) => {
    const parsed = PositionIntentSchema.safeParse(value.intent);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["intent", ...issue.path.map(String)],
          message: issue.message,
        });
      return z.NEVER;
    }
    return { ...value, intent: parsed.data };
  });
export type PositionRequest = z.infer<typeof PositionRequestSchema>;
export type PositionFinancing = {
  collateralAsset: string;
  collateralAmountUnits: string;
  loanUSDCUnits: string;
  collateralPriceBase: string;
  usdcPriceBase: string;
  ltvBps: string;
  liquidationThresholdBps: string;
  blockNumber: string;
  blockHash: string;
  timestamp: string;
  headroomBps: number;
};
export type PositionExecutionPlan = {
  chainId: 42161;
  sourcePool: string;
  sourceFeeTierPips: number;
  lowerPriceE6: string;
  upperPriceE6: string;
  lpFeeBps: number;
  targetWethUnits: string;
  targetUsdcUnits: string;
  convertUsdcUnits: string;
  selectionMethod: "highest-ranked-passing-reference-pool";
  observationCount: number;
  inRangeObservations: number;
  coverageBps: number;
  observedWindowStart: string;
  observedWindowEnd: string;
  graphQueryHash: string;
  graphResponseHash: string;
  graphHashAlgorithm: "sha256";
  graphIndexedBlock: string;
  graphIndexedBlockHash: string;
  canonicalSourceLiquidity: string;
  canonicalCurrentBlock: string;
  // A template, never calldata approved on behalf of a connected wallet.
  programBuilder: "@1inch/swap-vm-sdk@0.4.4";
};
export type PositionPlanResponse = {
  schemaVersion: "noria.aqua.position.v1";
  requestId: string;
  status: "ready-for-local-rehearsal" | "refused";
  evaluatedAt: string;
  validUntil: string;
  intent: PositionIntent;
  financing: PositionFinancing;
  graph: AquaResponse | null;
  execution: PositionExecutionPlan | null;
  reasons: string[];
  routingStatus: "not_validated";
  economics: "not-established";
};

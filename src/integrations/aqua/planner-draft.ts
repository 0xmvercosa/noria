import { z } from "zod";

export const plannerDraftKey = "noria.aqua.planner-draft.v1";

// Keep editable input only. Restoring a draft never restores a quote, an
// authorization or a plan that could be mistaken for fresh chain evidence.
const decimal = z
  .string()
  .max(80)
  .regex(/^\d*(\.\d*)?$/);
const DraftSchema = z
  .object({
    fundingAsset: z.enum(["ETH", "USDC"]),
    amount: decimal,
    safetyHF: decimal,
    comfortableHF: decimal,
    hours: z.union([z.literal(6), z.literal(24)]),
  })
  .strict();
export type PlannerDraft = z.infer<typeof DraftSchema>;

export function restorePlannerDraft(raw: string | null): PlannerDraft | null {
  if (!raw || raw.length > 1000) return null;
  try {
    const parsed = DraftSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

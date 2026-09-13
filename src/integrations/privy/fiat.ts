import { z } from "zod";
import { OwnerSchema, RESERVE } from "./reserve";

/** This is a requested fiat amount. The provider supplies the final quote and fees. */
export const EuroAmountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,4})(?:\.\d{1,2})?$/)
  .refine(
    (value) => Number(value) >= 1 && Number(value) <= 10_000,
    "Enter between 1 and 10,000 EUR, with at most two decimal places.",
  );

/** Pinned Privy 3.42.0 exposes EUR through useFiatOnramp, not legacy useFundWallet. */
export function euroOnrampOptions(owner: string, amount: string) {
  return {
    source: { assets: ["eur" as const], defaultAsset: "eur" as const },
    destination: {
      address: OwnerSchema.parse(owner),
      chain: "eip155:42161" as const,
      asset: RESERVE.usdc,
    },
    environment: "production" as const,
    defaultAmount: EuroAmountSchema.parse(amount),
  };
}

export const FiatPurchaseSchema = z
  .object({
    id: z.string().uuid(),
    owner: OwnerSchema,
    requestedEuroAmount: EuroAmountSchema,
    startedAt: z.string().datetime(),
    status: z.enum([
      "opened",
      "provider-submitted",
      "provider-confirmed",
      "window-closed",
    ]),
  })
  .strict();
export type FiatPurchase = z.infer<typeof FiatPurchaseSchema>;
export const fiatKey = (owner: string) =>
  `noria.privy.eur.v1:${owner.toLowerCase()}`;
export function restoreFiatPurchases(raw: string | null, owner: string) {
  if (!raw) return [] as FiatPurchase[];
  if (raw.length > 200_000)
    throw new Error("The saved funding history is too large.");
  const records = z.array(FiatPurchaseSchema).max(200).parse(JSON.parse(raw));
  if (records.some((r) => r.owner.toLowerCase() !== owner.toLowerCase()))
    throw new Error("The saved funding history belongs to another wallet.");
  return records;
}

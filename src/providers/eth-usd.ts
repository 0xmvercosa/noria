import { readPriceMarks } from "./prices";
import {
  ethUsdFreshness,
  type EthUsdResponse,
  type UsdReference,
} from "../domain/eth-usd";

/** One public ETH reference, shared across balances, fees and editable amounts.
 * The quote never participates in financing, approvals, quotes or transaction data.
 */
export function createEthUsdReader(
  runtime: {
    read?: typeof readPriceMarks;
    now?: () => number;
  } = {},
) {
  const read = runtime.read ?? readPriceMarks;
  const now = runtime.now ?? (() => Math.floor(Date.now() / 1000));
  let cached: { saved: number; response: EthUsdResponse } | null = null;
  let pending: Promise<EthUsdResponse> | null = null;
  const current = (response: EthUsdResponse): EthUsdResponse =>
    response.status === "available" &&
    ethUsdFreshness(response.reference, now()) !== "unavailable"
      ? response
      : { status: "unavailable" };

  return async function getEthUsd(): Promise<EthUsdResponse> {
    if (cached && now() - cached.saved >= 0 && now() - cached.saved < 60)
      return current(cached.response);
    if (pending) return current(await pending);
    pending = (async () => {
      let response: EthUsdResponse = { status: "unavailable" };
      try {
        const mark = (await read(["coingecko:ethereum"])).get(
          "coingecko:ethereum",
        );
        if (mark?.status === "valid" && mark.provider) {
          const reference: UsdReference = {
            usd: String(mark.price),
            timestamp: mark.timestamp,
            provider: mark.provider,
          };
          response = current({ status: "available", reference });
        }
      } catch {
        /* Valuation failure never blocks a wallet operation. */
      }
      cached = { saved: now(), response };
      return response;
    })();
    try {
      return current(await pending);
    } finally {
      pending = null;
    }
  };
}

export const readEthUsd = createEthUsdReader();

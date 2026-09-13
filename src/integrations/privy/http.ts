import { z } from "zod";
import { ActionSchema, OwnerSchema } from "./reserve";
import { createReserveService } from "./service";
import { BodyTooLargeError, readBoundedBody } from "../aqua/request-body";

const RequestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("prepare"), action: ActionSchema }).strict(),
  z
    .object({
      operation: z.literal("verify"),
      action: ActionSchema,
      hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    })
    .strict(),
]);
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export function createReserveHandlers(service = createReserveService()) {
  return {
    async GET(request: Request) {
      const owner = OwnerSchema.safeParse(
        new URL(request.url).searchParams.get("owner"),
      );
      if (!owner.success)
        return json(
          { message: "A valid public wallet address is required." },
          400,
        );
      try {
        return json(await service.snapshot(owner.data));
      } catch {
        return json(
          {
            message:
              "Arbitrum reserve state is unavailable. No transaction was sent.",
          },
          503,
        );
      }
    },
    async POST(request: Request) {
      try {
        const input = RequestSchema.parse(
          JSON.parse(await readBoundedBody(request, 2048)),
        );
        if (input.operation === "prepare") {
          // Preparation is a public read/simulation, not an authorization token.
          try {
            return json(await service.prepare(input.action));
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            // Do not leak RPC URLs, credentials or raw provider errors.
            const safe =
              /^(The wallet changed|This savings flow|Aave USDC supply|Aave withdrawals|The amount exceeds|Add enough|Approve exactly|Add ETH|Leave enough ETH|The network fee estimate|Arbitrum state is stale)/.test(
                message,
              );
            return json(
              {
                message: safe
                  ? message
                  : "This operation could not be simulated on Arbitrum. Refresh balances and try again.",
              },
              422,
            );
          }
        }
        try {
          return json(
            await service.verify(input.action, input.hash as `0x${string}`),
          );
        } catch (error) {
          const name = error instanceof Error ? error.name : "";
          if (
            name === "TransactionReceiptNotFoundError" ||
            name === "TransactionNotFoundError"
          )
            return json(
              {
                status: "pending",
                message:
                  "Receipt not available yet. Check this hash again before sending another transaction.",
              },
              202,
            );
          return json(
            {
              message:
                "This operation could not be verified against Arbitrum. Keep its hash and check again; do not repeat the transfer.",
            },
            422,
          );
        }
      } catch (error) {
        return json(
          { message: "Invalid reserve request." },
          error instanceof BodyTooLargeError ? 413 : 400,
        );
      }
    },
  };
}

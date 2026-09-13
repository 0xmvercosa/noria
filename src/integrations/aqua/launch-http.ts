import { z } from "zod";
import {
  LaunchAddressSchema,
  LaunchError,
  LaunchHashSchema,
  LaunchIntentSchema,
  LaunchPreparedSchema,
  LaunchRequestSchema,
} from "./launch-contract";
import { createLaunchService } from "./launch-service";
import { BodyTooLargeError, readBoundedBody } from "./request-body";

const RequestSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("prepare"),
      request: LaunchRequestSchema,
      plan: z.unknown().optional(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("verify"),
      prepared: LaunchPreparedSchema,
      hash: LaunchHashSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("plan"),
      owner: LaunchAddressSchema,
      account: LaunchAddressSchema,
      intent: LaunchIntentSchema,
      reviewAfterHours: z.union([z.literal(6), z.literal(24)]).default(6),
    })
    .strict(),
]);
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
function failure(error: unknown) {
  if (error instanceof BodyTooLargeError)
    return json(
      { code: "invalid-request", message: "The launch request is too large." },
      413,
    );
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return json(
      {
        code: "invalid-request",
        message:
          "Invalid launch request. Review the wallet, account and operation fields.",
      },
      400,
    );
  if (error instanceof LaunchError)
    return json(
      { code: error.code, message: error.message },
      error.code === "deployment-required" ? 409 : 422,
    );
  if (
    error instanceof Error &&
    ["TransactionReceiptNotFoundError", "TransactionNotFoundError"].includes(
      error.name,
    )
  )
    return json(
      {
        status: "pending",
        message:
          "Receipt not available yet. Keep its hash and check again before signing another operation.",
      },
      202,
    );
  return json(
    {
      code: "unavailable",
      message:
        "The launch operation could not be checked against Arbitrum. Refresh its state and keep any transaction hash; no transaction was sent by this service.",
    },
    503,
  );
}
export function createLaunchHandlers(service = createLaunchService()) {
  return {
    async GET(request: Request) {
      try {
        const query = new URL(request.url).searchParams;
        const owner = LaunchAddressSchema.parse(query.get("owner"));
        const account = query.has("account")
          ? LaunchAddressSchema.parse(query.get("account"))
          : undefined;
        return json(await service.snapshot(owner, account));
      } catch (error) {
        return failure(error);
      }
    },
    async POST(request: Request) {
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        return json(
          { code: "invalid-request", message: "Use application/json." },
          415,
        );
      try {
        const input = RequestSchema.parse(
          JSON.parse(await readBoundedBody(request, 524_288)),
        );
        if (input.operation === "prepare")
          return json(await service.prepare(input.request, input.plan));
        if (input.operation === "plan")
          return json(
            await service.plan(
              input.owner,
              input.account,
              input.intent,
              input.reviewAfterHours,
            ),
          );
        return json(await service.verify(input.prepared, input.hash));
      } catch (error) {
        return failure(error);
      }
    },
  };
}

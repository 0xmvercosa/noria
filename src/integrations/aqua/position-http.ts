import { PositionRequestSchema } from "./position-contract";
import { planPosition } from "./position-service";
import { readBoundedBody, BodyTooLargeError } from "./request-body";

export function createPositionPostHandler(plan = planPosition) {
  return async (request: Request) => {
    const respond = (body: unknown, status = 200) =>
      Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return respond({ message: "Use application/json." }, 415);
    try {
      const body = await readBoundedBody(request, 4096);
      let raw: unknown;
      try {
        raw = JSON.parse(body);
      } catch {
        return respond({ message: "Invalid JSON." }, 400);
      }
      const parsed = PositionRequestSchema.safeParse(raw);
      if (!parsed.success)
        return respond(
          { message: parsed.error.issues.map((x) => x.message).join(" ") },
          400,
        );
      return respond(await plan(parsed.data));
    } catch (error) {
      if (error instanceof BodyTooLargeError)
        return respond({ message: error.message }, 413);
      if (error instanceof Error && error.message === "loan_below_one_usdc")
        return respond(
          {
            message:
              "These collateral and health-factor settings fund less than 1 USDC of LP inventory. Increase collateral or revise the health limits.",
          },
          422,
        );
      return respond(
        {
          message:
            "Live financing or source verification is unavailable. No plan or transaction was authorized.",
        },
        503,
      );
    }
  };
}

import { z } from "zod";
import { AQUA_SCHEMA_VERSION, AquaRequestSchema } from "./contract";
import { recommendForAqua } from "./service";

export const AQUA_NO_STORE = { "Cache-Control": "no-store" };

/** This server-to-server boundary accepts intent only, never credentials or transactions. */
export function createAquaPostHandler(recommend = recommendForAqua) {
  return async function POST(request: Request): Promise<Response> {
    const respond = (body: unknown, status: number, headers = {}) =>
      Response.json(body, {
        status,
        headers: { ...AQUA_NO_STORE, ...headers },
      });
    let inputValidated = false;
    try {
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        return respond(
          {
            schemaVersion: AQUA_SCHEMA_VERSION,
            status: "invalid-request",
            code: "content-type",
            message: "Use application/json.",
          },
          415,
        );
      const text = await request.text();
      if (Buffer.byteLength(text, "utf8") > 4096)
        return respond(
          {
            schemaVersion: AQUA_SCHEMA_VERSION,
            status: "invalid-request",
            code: "body-too-large",
          },
          413,
        );
      const input = AquaRequestSchema.parse(JSON.parse(text));
      inputValidated = true;
      return respond(await recommend(input), 200);
    } catch (error) {
      // Provider payloads can also fail Zod/JSON parsing. Those are source
      // failures, not invalid caller intent, and must retain retry semantics.
      if (!inputValidated && error instanceof z.ZodError)
        return respond(
          {
            schemaVersion: AQUA_SCHEMA_VERSION,
            status: "invalid-request",
            code: "invalid-input",
            issues: error.issues.map(({ path, message }) => ({
              path: path.join("."),
              message,
            })),
          },
          400,
        );
      if (!inputValidated && error instanceof SyntaxError)
        return respond(
          {
            schemaVersion: AQUA_SCHEMA_VERSION,
            status: "invalid-request",
            code: "invalid-json",
          },
          400,
        );
      return respond(
        {
          schemaVersion: AQUA_SCHEMA_VERSION,
          status: "unavailable",
          code: "source-unavailable",
          message: (error instanceof Error
            ? error.message
            : "Analysis unavailable"
          )
            .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
            .slice(0, 300),
        },
        503,
        { "Retry-After": "15" },
      );
    }
  };
}

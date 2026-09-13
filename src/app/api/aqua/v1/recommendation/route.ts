import {
  AQUA_REQUEST_EXAMPLE,
  AQUA_SCHEMA_VERSION,
  AQUA_SCOPE,
} from "../../../../../integrations/aqua/contract";
import {
  AQUA_NO_STORE,
  createAquaPostHandler,
} from "../../../../../integrations/aqua/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = createAquaPostHandler();

export async function GET() {
  return Response.json(
    {
      schemaVersion: AQUA_SCHEMA_VERSION,
      scope: AQUA_SCOPE,
      mode: "informational-reference",
      method: "POST",
      specification: "/aqua/openapi.json",
      example: AQUA_REQUEST_EXAMPLE,
      executionReady: false,
    },
    { headers: AQUA_NO_STORE },
  );
}

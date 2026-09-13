import { createPositionPostHandler } from "../../../../../integrations/aqua/position-http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const POST = createPositionPostHandler();
export async function GET() {
  return Response.json(
    {
      schemaVersion: "noria.aqua.position.v1",
      mode: "collateral-backed-position-plan",
      chainId: 42161,
      collateralAssets: ["ETH", "USDC"],
      executionReady: false,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

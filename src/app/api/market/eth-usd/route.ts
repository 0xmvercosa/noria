import { readEthUsd } from "../../../../providers/eth-usd";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET() {
  return Response.json(await readEthUsd(), {
    headers: { "Cache-Control": "no-store" },
  });
}

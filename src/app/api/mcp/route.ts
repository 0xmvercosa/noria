import { handleMcpRequest } from "../../../mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  return handleMcpRequest(request);
}

export const GET = POST;
export const DELETE = POST;
export const OPTIONS = POST;

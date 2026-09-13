import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createNoriaMcpServer } from "./protocol";
import type { ToolServices } from "./tools";

export const MAX_MCP_BODY_BYTES = 256 * 1024;

function jsonError(
  status: number,
  code: number,
  message: string,
  headers = new Headers({ "Cache-Control": "no-store" }),
) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code, message } },
    { status, headers },
  );
}

async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return JSON.parse("");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_MCP_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Request exceeds the 256 KiB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Stateless JSON responses finish before cleanup, including on Vercel. */
export async function handleMcpRequest(
  request: Request,
  options: { services?: ToolServices } = {},
): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowedOrigins = new Set([
    new URL(request.url).origin,
    ...(process.env.NORIA_MCP_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  ]);
  if (origin && !allowedOrigins.has(origin))
    return jsonError(403, -32000, "Origin is not allowed.");

  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  if (request.method === "OPTIONS") {
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, MCP-Protocol-Version, MCP-Session-Id, Accept",
    );
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    headers.set("Allow", "POST, OPTIONS");
    return Response.json(
      {
        error:
          "Use MCP Streamable HTTP POST; persistent SSE sessions are not supported.",
      },
      { status: 405, headers },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readBody(request);
  } catch (error) {
    return error instanceof RangeError
      ? jsonError(413, -32600, error.message, headers)
      : jsonError(400, -32700, "Invalid JSON.", headers);
  }

  const server = createNoriaMcpServer(options);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, { parsedBody });
    for (const [key, value] of headers) response.headers.set(key, value);
    return response;
  } finally {
    await server.close();
  }
}

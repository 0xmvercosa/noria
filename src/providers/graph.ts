import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export const GRAPH_QUERY_BUDGET_MS = 25_000;
export const GRAPH_RETRY_DELAY_MS = 750;

/** Query/schema failures take precedence even inside a mixed indexer error. */
export function isTransientGraphError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const queryError =
    /\b(?:GRAPHQL_VALIDATION_FAILED|GRAPHQL_PARSE_FAILED|syntax error|validation error|query validation|cannot query field|unknown (?:field|argument|type)|invalid (?:query|filter)|schema error)\b/i;
  const mixedFilters =
    /\b(?:mix(?:ing)?|combin(?:e|ing|ation)|together|alongside)\b[\s\S]*\b(?:or|and|filters?)\b|\b(?:or|and)\b[\s\S]*\b(?:mix(?:ing)?|combin(?:e|ing|ation)|other filters|siblings?)\b/i;
  if (queryError.test(message) || mixedFilters.test(message)) return false;
  if (error instanceof Error && error.name === "TimeoutError") return true;
  if (/^Graph gateway HTTP (?:408|502|503|504)\b/.test(message)) return true;
  if (/\bMCP error -32001\b|\brequest timed out\b/i.test(message)) return true;
  return (
    /\bbad indexers\s*:/i.test(message) &&
    /\bTimeout\b|\bBadResponse\s*\(/i.test(message)
  );
}

export class GraphUnavailableError extends Error {
  readonly failures: readonly unknown[];
  constructor(failures: readonly unknown[]) {
    super(
      "The Graph is temporarily unavailable; the query could not be completed. Please try again shortly.",
      { cause: failures.at(-1) },
    );
    this.name = "GraphUnavailableError";
    this.failures = [...failures];
  }
}

export interface GraphRetryRuntime {
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function deadlineError() {
  const error = new Error(
    "The Graph query exceeded its 25-second request budget.",
  );
  error.name = "TimeoutError";
  return error;
}

/** At most two sequential attempts share one 25-second budget, including the pause. */
export async function withGraphRetry<T>(
  operation: (timeoutMs: number, signal: AbortSignal) => Promise<T>,
  runtime: GraphRetryRuntime = {},
): Promise<T> {
  const now = runtime.now ?? (() => performance.now());
  const wait =
    runtime.wait ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline = now() + GRAPH_QUERY_BUDGET_MS;
  const failures: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = Math.floor(deadline - now());
    if (remaining <= 0) throw new GraphUnavailableError(failures);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const value = await new Promise<T>((resolve, reject) => {
        timer = setTimeout(() => {
          const error = deadlineError();
          controller.abort(error);
          reject(error);
        }, remaining);
        Promise.resolve()
          .then(() => operation(remaining, controller.signal))
          .then(resolve, reject);
      });
      if (now() >= deadline) throw deadlineError();
      return value;
    } catch (error) {
      if (!isTransientGraphError(error)) throw error;
      failures.push(error);
      if (attempt === 1 || deadline - now() <= GRAPH_RETRY_DELAY_MS) {
        throw new GraphUnavailableError(failures);
      }
    } finally {
      clearTimeout(timer);
    }
    await wait(GRAPH_RETRY_DELAY_MS);
  }
  throw new GraphUnavailableError(failures);
}

/** Read-only Graph transport with a shared request deadline and bounded retries. */
export class LiveGraph {
  private client?: Client;
  readonly route = process.env.GRAPH_API_KEY
    ? "The Graph gateway"
    : "The Graph Subgraph MCP";
  constructor(private readonly retryRuntime: GraphRetryRuntime = {}) {}
  async query<T = unknown>(subgraphId: string, query: string): Promise<T> {
    // The closure retains the exact subgraph and query, including any pinned block.
    return withGraphRetry(
      (timeoutMs, signal) =>
        this.queryOnce<T>(subgraphId, query, timeoutMs, signal),
      this.retryRuntime,
    );
  }
  private async queryOnce<T>(
    subgraphId: string,
    query: string,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<T> {
    signal.throwIfAborted();
    let payload: unknown;
    if (process.env.GRAPH_API_KEY) {
      const response = await fetch(
        `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${process.env.GRAPH_API_KEY}`,
          },
          body: JSON.stringify({ query }),
          signal,
          cache: "no-store",
        },
      );
      if (!response.ok)
        throw new Error(`Graph gateway HTTP ${response.status}`);
      payload = await response.json();
    } else {
      // SDK request cancellation does not cover the initial SSE connection by itself.
      const onAbort = () => {
        void this.close().catch(() => {});
      };
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        if (!this.client) {
          const client = new Client({ name: "noria", version: "0.1.0" });
          this.client = client;
          try {
            await client.connect(
              new SSEClientTransport(
                new URL("https://subgraphs.mcp.thegraph.com/sse"),
              ),
              { timeout: timeoutMs, signal },
            );
          } catch (error) {
            if (this.client === client) this.client = undefined;
            await client.close().catch(() => {});
            throw error;
          }
        }
        const result = await this.client.callTool(
          {
            name: "execute_query_by_subgraph_id",
            arguments: { subgraph_id: subgraphId, query },
          },
          undefined,
          { timeout: timeoutMs, signal },
        );
        const content = result.content as { type: string; text?: string }[];
        const text = content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (result.isError)
          throw new Error(
            `The Graph MCP query failed: ${text || JSON.stringify(result.structuredContent) || "no error details"}`,
          );
        payload = result.structuredContent ?? JSON.parse(text);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
    if (!payload || typeof payload !== "object")
      throw new Error("Graph returned no structured data.");
    const envelope = payload as { errors?: { message: string }[]; data?: T };
    if (envelope.errors?.length)
      throw new Error(
        `GraphQL: ${envelope.errors.map((e) => e.message).join("; ")}`,
      );
    return (envelope.data ?? payload) as T;
  }
  async close() {
    const client = this.client;
    this.client = undefined;
    if (client) await client.close();
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  GRAPH_QUERY_BUDGET_MS,
  GRAPH_RETRY_DELAY_MS,
  GraphUnavailableError,
  LiveGraph,
  isTransientGraphError,
  withGraphRetry,
} from "../../src/providers/graph";

const indexerFailure =
  "MCP error -32603: GraphQL error: bad indexers: {0x089f78d8cf0a5ae1b7a581b1910a73f8cb3e4774: Timeout, 0x8bbe94c2894f76406568dfb44e905dac4b7df699: Timeout, 0xf92f430dd8567b0d466358c79594ab58d919a6d4: BadResponse(expected value at line 1 column 1)}";

function clock() {
  let elapsed = 0;
  const waits: number[] = [];
  return {
    waits,
    advance(milliseconds: number) {
      elapsed += milliseconds;
    },
    now: () => elapsed,
    wait: async (milliseconds: number) => {
      waits.push(milliseconds);
      elapsed += milliseconds;
    },
  };
}

test("only recognized transient indexer or transport failures qualify for retry", () => {
  for (const message of [
    indexerFailure,
    "GraphQL: bad indexers: {0x1: Timeout}",
    "Graph gateway HTTP 503",
    "MCP error -32001: Request timed out",
  ]) {
    assert.equal(isTransientGraphError(new Error(message)), true, message);
  }
  for (const message of [
    "GraphQL: Mixing 'or' with other filters is not supported",
    "GraphQL: Cannot combine or and token0_in filters",
    "GraphQL: Cannot query field timeout on type Pool",
    "GraphQL: Unknown argument or on field pools",
    "GraphQL: Syntax error: expected name",
    `${indexerFailure}; GraphQL: Cannot query field unknown on type Pool`,
    "MCP error -32603: Internal error",
    "Graph gateway HTTP 401",
    "Graph gateway HTTP 429",
    "Graph returned no structured data.",
    "Unexpected token '<', not valid JSON",
  ])
    assert.equal(isTransientGraphError(new Error(message)), false, message);
});

test("one delayed retry preserves the remaining shared budget and returns only the actual success", async () => {
  const runtime = clock(),
    timeouts: number[] = [],
    actual = { _meta: { block: { hash: "0xabc" } } };
  const result = await withGraphRetry(async (timeoutMs, signal) => {
    timeouts.push(timeoutMs);
    assert.equal(signal.aborted, false);
    if (timeouts.length === 1) {
      runtime.advance(2000);
      throw new Error(indexerFailure);
    }
    return actual;
  }, runtime);
  assert.equal(result, actual);
  assert.deepEqual(runtime.waits, [GRAPH_RETRY_DELAY_MS]);
  assert.deepEqual(timeouts, [
    GRAPH_QUERY_BUDGET_MS,
    GRAPH_QUERY_BUDGET_MS - 2000 - GRAPH_RETRY_DELAY_MS,
  ]);
});

test("persistent indexer failure stops after two attempts and retains both original errors", async () => {
  const runtime = clock(),
    errors = [new Error(indexerFailure), new Error(indexerFailure)];
  let calls = 0;
  await assert.rejects(
    withGraphRetry(async () => {
      throw errors[calls++];
    }, runtime),
    (error) => {
      assert.ok(error instanceof GraphUnavailableError);
      assert.match(error.message, /The Graph is temporarily unavailable/);
      assert.equal(error.cause, errors[1]);
      assert.deepEqual(error.failures, errors);
      return true;
    },
  );
  assert.equal(calls, 2);
  assert.deepEqual(runtime.waits, [GRAPH_RETRY_DELAY_MS]);
});

test("query/schema failures are propagated unchanged without waiting or retrying", async () => {
  const runtime = clock(),
    original = new Error(
      "GraphQL: Mixing or with other filters is not supported",
    );
  let calls = 0;
  await assert.rejects(
    withGraphRetry(async () => {
      calls++;
      throw original;
    }, runtime),
    (error) => error === original,
  );
  assert.equal(calls, 1);
  assert.deepEqual(runtime.waits, []);
});

test("an exhausted budget skips retry and a pause that consumes the budget starts no extra request", async () => {
  for (const consumed of [
    GRAPH_QUERY_BUDGET_MS,
    GRAPH_QUERY_BUDGET_MS - GRAPH_RETRY_DELAY_MS,
  ]) {
    const runtime = clock();
    let calls = 0;
    await assert.rejects(
      withGraphRetry(async () => {
        calls++;
        runtime.advance(consumed);
        throw new Error(indexerFailure);
      }, runtime),
      GraphUnavailableError,
    );
    assert.equal(calls, 1);
    assert.deepEqual(runtime.waits, []);
  }
  const runtime = clock();
  let calls = 0;
  runtime.wait = async (milliseconds) => {
    runtime.waits.push(milliseconds);
    runtime.advance(GRAPH_QUERY_BUDGET_MS);
  };
  await assert.rejects(
    withGraphRetry(async () => {
      calls++;
      throw new Error(indexerFailure);
    }, runtime),
    GraphUnavailableError,
  );
  assert.equal(calls, 1);
});

test("a request that exceeds the shared deadline is aborted and cannot yield a late success", async () => {
  const runtime = clock();
  let first = true;
  runtime.now = () => {
    if (first) {
      first = false;
      return 0;
    }
    return GRAPH_QUERY_BUDGET_MS - 10;
  };
  let aborted = false,
    calls = 0;
  await assert.rejects(
    withGraphRetry(async (_timeoutMs, signal) => {
      calls++;
      return new Promise((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve({ stale: true });
          },
          { once: true },
        ),
      );
    }, runtime),
    GraphUnavailableError,
  );
  assert.equal(calls, 1);
  assert.equal(aborted, true);
  assert.deepEqual(runtime.waits, []);
});

test("MCP tool errors retain indexer details and retry the identical pinned query", async (t) => {
  const previousKey = process.env.GRAPH_API_KEY;
  delete process.env.GRAPH_API_KEY;
  t.after(() => {
    if (previousKey === undefined) delete process.env.GRAPH_API_KEY;
    else process.env.GRAPH_API_KEY = previousKey;
  });
  t.mock.method(Client.prototype, "connect", async () => {});
  t.mock.method(Client.prototype, "close", async () => {});
  const argumentsSeen: unknown[] = [];
  t.mock.method(Client.prototype, "callTool", async (args: unknown) => {
    argumentsSeen.push(args);
    if (argumentsSeen.length === 1)
      return {
        isError: true,
        content: [{ type: "text", text: indexerFailure }],
      };
    return {
      content: [],
      structuredContent: { data: { pool: { id: "0xpool" } } },
    };
  });
  const runtime = clock(),
    graph = new LiveGraph(runtime),
    query = '{ pool(id:"0xpool",block:{hash:"0xpinned"}) { id } }';
  try {
    assert.deepEqual(await graph.query("same-subgraph", query), {
      pool: { id: "0xpool" },
    });
    assert.equal(argumentsSeen.length, 2);
    assert.deepEqual(argumentsSeen[0], {
      name: "execute_query_by_subgraph_id",
      arguments: { subgraph_id: "same-subgraph", query },
    });
    assert.deepEqual(argumentsSeen[1], argumentsSeen[0]);
    assert.deepEqual(runtime.waits, [GRAPH_RETRY_DELAY_MS]);
  } finally {
    await graph.close();
  }
});

test("gateway GraphQL schema errors keep their details and never retry", async (t) => {
  const previousKey = process.env.GRAPH_API_KEY;
  process.env.GRAPH_API_KEY = "test-only-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.GRAPH_API_KEY;
    else process.env.GRAPH_API_KEY = previousKey;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(
      JSON.stringify({
        errors: [{ message: "Mixing or with other filters is not supported" }],
      }),
      { status: 200 },
    );
  });
  const runtime = clock(),
    graph = new LiveGraph(runtime);
  await assert.rejects(
    graph.query("same-subgraph", "{ pools { id } }"),
    /GraphQL: Mixing or with other filters/,
  );
  assert.equal(calls, 1);
  assert.deepEqual(runtime.waits, []);
});

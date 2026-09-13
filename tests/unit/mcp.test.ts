import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  buildReport,
  digest,
  type Snapshot,
} from "../../src/services/analysis";
import type {
  AnalyzeInput,
  Discovery,
  DiscoveryResult,
  HistoricalCase,
} from "../../src/domain/types";
import {
  createToolExecutor,
  verifyReport,
  type ToolServices,
} from "../../src/mcp/tools";
import { handleMcpRequest, MAX_MCP_BODY_BYTES } from "../../src/mcp/http";

const stored = JSON.parse(
  readFileSync(
    new URL("../fixtures/graph-snapshot.json", import.meta.url),
    "utf8",
  ),
);
const snapshot: Snapshot = {
  ...stored,
  network: "ethereum",
  tickSpacing: 10,
  prices: { ...stored.prices, nativeUsd: stored.prices.usd[1] },
};
const at = Math.ceil(Date.parse(snapshot.receivedAt) / 1000);
const analysisInput: AnalyzeInput = {
  network: "ethereum",
  poolAddress: snapshot.data.pool.id,
  capitalUsd: 1000,
  intent: "buy-token0",
  horizonHours: 6,
  discountBps: 100,
};
const { poolAddress: _poolAddress, ...discoveryInput } = analysisInput;
const fixtureReport = buildReport(analysisInput, snapshot, at);
const fixtureHistory: HistoricalCase = JSON.parse(
  readFileSync(
    new URL("../../data/examples/historical-case.json", import.meta.url),
    "utf8",
  ),
);
const fixtureDiscovery: Discovery = {
  network: "ethereum",
  provider: "Offline Graph snapshot fixture",
  sourceBlock: snapshot.data._meta.block.number,
  receivedAt: snapshot.receivedAt,
  pools: [],
  considered: 1,
  selectedReason: "Offline transport test; not a live recommendation.",
  limitations: ["Provider reads are replaced by a dated test fixture."],
  rejected: [],
};
const endpoint = "https://noria.example/api/mcp";
const rpcHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};
const toolNames = [
  "noria_networks",
  "noria_search_pools",
  "noria_find_opportunity",
  "noria_analyze_position",
  "noria_historical_case",
  "noria_verify_report",
];

function fixtureServices(result?: DiscoveryResult) {
  const calls: { service: keyof ToolServices; args: unknown[] }[] = [];
  const services: ToolServices = {
    analyze: async (...args) => {
      calls.push({ service: "analyze", args });
      return structuredClone(fixtureReport);
    },
    discover: async (...args) => {
      calls.push({ service: "discover", args });
      return structuredClone(
        result ?? { report: fixtureReport, discovery: fixtureDiscovery },
      );
    },
    searchPools: async (...args) => {
      calls.push({ service: "searchPools", args });
      return structuredClone(fixtureDiscovery);
    },
    historicalCase: async (...args) => {
      calls.push({ service: "historicalCase", args });
      return structuredClone(fixtureHistory);
    },
  };
  return { services, calls };
}

function content(raw: unknown): Record<string, unknown> {
  const result = CallToolResultSchema.parse(raw);
  assert.equal(result.isError, false);
  assert.ok(result.structuredContent);
  const first = result.content[0];
  assert.equal(first.type, "text");
  assert.deepEqual(JSON.parse(first.text), result.structuredContent);
  return result.structuredContent;
}

function errorText(raw: unknown): string {
  const result = CallToolResultSchema.parse(raw);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent, undefined);
  const first = result.content[0];
  assert.equal(first.type, "text");
  return first.text;
}

function rpcRequest(body: string, headers: Record<string, string> = {}) {
  return new Request(endpoint, {
    method: "POST",
    headers: { ...rpcHeaders, ...headers },
    body,
  });
}

async function connectHttp(services: ToolServices) {
  const requests: Request[] = [];
  const responses: Response[] = [];
  const client = new Client({ name: "noria-http-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    fetch: async (url, init) => {
      const request = new Request(url, init);
      requests.push(request);
      const response = await handleMcpRequest(request, { services });
      responses.push(response);
      return response;
    },
  });
  await client.connect(transport);
  return { client, transport, requests, responses };
}

async function exerciseTools(client: Client) {
  const listed = await client.listTools();
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    toolNames,
  );
  assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint));
  assert.ok(
    listed.tools.every(
      (tool) => tool.inputSchema.additionalProperties === false,
    ),
  );
  assert.equal(client.getServerVersion()?.name, "noria");

  const networks = content(await client.callTool({ name: "noria_networks" }));
  assert.deepEqual(
    (networks.networks as { id: string }[]).map((network) => network.id),
    ["ethereum", "base", "arbitrum", "unichain"],
  );
  assert.deepEqual(
    content(
      await client.callTool({
        name: "noria_search_pools",
        arguments: { network: "ethereum", query: "WBTC/WETH" },
      }),
    ),
    fixtureDiscovery,
  );
  const discovery = content(
    await client.callTool({
      name: "noria_find_opportunity",
      arguments: discoveryInput,
    }),
  );
  assert.deepEqual(discovery, {
    report: fixtureReport,
    discovery: fixtureDiscovery,
  });
  const report = content(
    await client.callTool({
      name: "noria_analyze_position",
      arguments: { ...analysisInput },
    }),
  );
  assert.deepEqual(report, fixtureReport);
  assert.deepEqual(
    content(await client.callTool({ name: "noria_historical_case" })),
    fixtureHistory,
  );
  const verified = content(
    await client.callTool({
      name: "noria_verify_report",
      arguments: { report },
    }),
  );
  assert.equal(verified.hashMatches, true);
  assert.equal(verified.budgetConserved, true);
  assert.equal(verified.issuerAuthenticated, false);
  assert.equal(verified.economics, "not-established");
  assert.match(
    errorText(await client.callTool({ name: "noria_unknown" })),
    /unknown tool/i,
  );
  return report;
}

test("MCP rejects invalid and unknown input fields before invoking any service", async () => {
  const { services, calls } = fixtureServices();
  const execute = createToolExecutor({ services });
  const invalid: [string, unknown][] = [
    ["noria_networks", { refresh: true }],
    ["noria_networks", null],
    ["noria_historical_case", { live: true }],
    ["noria_search_pools", {}],
    ["noria_search_pools", { network: "polygon" }],
    ["noria_search_pools", { network: "ethereum", query: "x".repeat(101) }],
    ["noria_search_pools", { network: "ethereum", allowUnverified: true }],
    ["noria_analyze_position", { ...analysisInput, capitalUsd: 1234 }],
    ["noria_analyze_position", { ...analysisInput, poolAddress: "0x123" }],
    ["noria_analyze_position", { ...analysisInput, forceProfitable: true }],
    ["noria_analyze_position", { ...analysisInput, horizonHours: 48 }],
    ["noria_analyze_position", { ...analysisInput, discountBps: 24 }],
    ["noria_find_opportunity", { ...discoveryInput, capitalUsd: "1000" }],
    ["noria_find_opportunity", { ...discoveryInput, intent: "maximize-apr" }],
    ["noria_find_opportunity", { ...discoveryInput, discountBps: 1000.1 }],
    [
      "noria_find_opportunity",
      { ...discoveryInput, poolAddress: _poolAddress },
    ],
    ["noria_find_opportunity", { ...discoveryInput, query: "x".repeat(101) }],
    ["noria_verify_report", {}],
    ["noria_verify_report", { reportId: "unknown" }],
    ["noria_verify_report", { report: {} }],
    ["noria_verify_report", { report: fixtureReport, skipExpiry: true }],
    [
      "noria_verify_report",
      { report: fixtureReport, reportId: fixtureReport.id },
    ],
    ["noria_unknown", {}],
  ];
  for (const [name, input] of invalid) {
    const result = await execute(name, input);
    assert.equal(result.isError, true, `${name}: ${JSON.stringify(input)}`);
    assert.equal(result.structuredContent, undefined);
    assert.deepEqual(calls, [], `${name} must validate before using services`);
  }
});

test("MCP passes validated inputs and preserves a discovery refusal without inventing a report", async () => {
  const refusal: DiscoveryResult = {
    report: null,
    discovery: {
      ...fixtureDiscovery,
      selectedReason: "No candidate passed capacity checks.",
      rejected: [{ address: _poolAddress, reason: "Capacity exceeded." }],
    },
  };
  const { services, calls } = fixtureServices(refusal);
  const execute = createToolExecutor({ services, retainReports: true });
  content(await execute("noria_search_pools", { network: "base" }));
  content(
    await execute("noria_search_pools", {
      network: "ethereum",
      query: "  WBTC/WETH  ",
    }),
  );
  assert.deepEqual(
    content(await execute("noria_find_opportunity", discoveryInput)),
    refusal,
  );
  assert.deepEqual(calls, [
    { service: "searchPools", args: ["base", ""] },
    { service: "searchPools", args: ["ethereum", "WBTC/WETH"] },
    { service: "discover", args: [discoveryInput] },
  ]);
  errorText(await execute("noria_verify_report", {}));
  assert.match(
    errorText(
      await execute("noria_verify_report", { reportId: fixtureReport.id }),
    ),
    /not found/i,
  );
  assert.equal(calls.length, 3);
});

test("report verification distinguishes hash integrity, budget, expiry and issuer authentication", () => {
  const expiresAt = Date.parse(fixtureReport.validUntil);
  const valid = verifyReport(fixtureReport, expiresAt - 1);
  assert.equal(valid.hashMatches, true);
  assert.equal(valid.budgetConserved, true);
  assert.equal(valid.expired, false);
  assert.equal(valid.issuerAuthenticated, false);
  assert.equal(verifyReport(fixtureReport, expiresAt).expired, true);
  assert.equal(verifyReport(fixtureReport, expiresAt + 1).expired, true);

  const changed = structuredClone(fixtureReport);
  changed.decision.explanation += " Altered after publication.";
  assert.equal(verifyReport(changed, expiresAt - 1).hashMatches, false);
  assert.equal(verifyReport(changed, expiresAt - 1).budgetConserved, true);

  const overBudget = structuredClone(fixtureReport);
  overBudget.position.residualUsd += 1;
  overBudget.id = digest({ ...overBudget, id: "" });
  const inconsistent = verifyReport(overBudget, expiresAt - 1);
  assert.equal(inconsistent.hashMatches, true);
  assert.equal(inconsistent.budgetConserved, false);
  assert.equal(inconsistent.issuerAuthenticated, false);

  for (const residualUsd of [-1, NaN, Infinity]) {
    const malformed = structuredClone(fixtureReport);
    malformed.position.residualUsd = residualUsd;
    assert.throws(() => verifyReport(malformed, expiresAt - 1));
  }
});

test("report ids belong to the retaining stdio session; full reports work in a fresh executor", async () => {
  const { services, calls } = fixtureServices();
  const local = createToolExecutor({ services, retainReports: true });
  content(await local("noria_analyze_position", analysisInput));
  const verified = content(
    await local("noria_verify_report", { reportId: fixtureReport.id }),
  );
  assert.equal(verified.hashMatches, true);
  assert.equal(verified.reportId, fixtureReport.id);
  errorText(await local("noria_verify_report", {}));

  const otherLocal = createToolExecutor({ services, retainReports: true });
  errorText(
    await otherLocal("noria_verify_report", { reportId: fixtureReport.id }),
  );
  const stateless = createToolExecutor({ services });
  content(await stateless("noria_analyze_position", analysisInput));
  assert.match(
    errorText(
      await stateless("noria_verify_report", { reportId: fixtureReport.id }),
    ),
    /stateless|complete report/i,
  );
  assert.equal(
    content(
      await createToolExecutor({ services })("noria_verify_report", {
        report: fixtureReport,
      }),
    ).hashMatches,
    true,
  );
  assert.deepEqual(
    calls.map((call) => call.service),
    ["analyze", "analyze"],
  );
});

test("MCP reports provider failures without leaking credential-bearing URLs", async () => {
  const { services } = fixtureServices();
  services.searchPools = async () => {
    throw new Error(
      "Provider failed at https://provider.example/private-test-key/graphql",
    );
  };
  const message = errorText(
    await createToolExecutor({ services })("noria_search_pools", {
      network: "base",
    }),
  );
  assert.match(message, /provider failed/i);
  assert.doesNotMatch(message, /private-test-key|provider\.example/);
});

test("the official stdio client initializes and executes all six tools with offline services", async (t) => {
  const payload = JSON.stringify({
    report: fixtureReport,
    discovery: fixtureDiscovery,
    history: fixtureHistory,
  });
  const script = `
    const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
    const { createNoriaMcpServer } = require("./src/mcp/protocol.ts");
    const fixture = ${payload};
    globalThis.fetch = async () => { throw new Error("Network reads are disabled in this test."); };
    const services = {
      analyze: async () => fixture.report,
      discover: async () => ({ report: fixture.report, discovery: fixture.discovery }),
      searchPools: async () => fixture.discovery,
      historicalCase: async () => fixture.history,
    };
    createNoriaMcpServer({ retainReports: true, services }).connect(new StdioServerTransport()).catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `;
  const client = new Client({ name: "noria-stdio-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "--input-type=commonjs", "--eval", script],
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stderr: "pipe",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  t.after(async () => {
    await client.close();
  });
  try {
    await client.connect(transport);
  } catch (error) {
    assert.fail(
      `${error instanceof Error ? error.message : String(error)}\n${stderr}`,
    );
  }
  await exerciseTools(client);
  const verified = content(
    await client.callTool({
      name: "noria_verify_report",
      arguments: { reportId: fixtureReport.id },
    }),
  );
  assert.equal(verified.hashMatches, true);
  assert.equal(stderr, "");
});

test("the official HTTP client executes all six tools without a server session", async (t) => {
  const { services, calls } = fixtureServices();
  const { client, transport, requests, responses } =
    await connectHttp(services);
  t.after(async () => {
    await client.close();
  });
  await exerciseTools(client);
  assert.equal(transport.sessionId, undefined);
  assert.deepEqual(
    calls.map((call) => call.service),
    ["searchPools", "discover", "analyze", "historicalCase"],
  );
  for (const request of requests.filter(
    (request) => request.method === "POST",
  )) {
    assert.match(request.headers.get("accept")!, /application\/json/);
    assert.match(request.headers.get("accept")!, /text\/event-stream/);
    assert.equal(request.headers.get("mcp-session-id"), null);
  }
  for (const response of responses.filter(
    (response) => response.status === 200,
  )) {
    assert.match(response.headers.get("content-type")!, /application\/json/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("mcp-session-id"), null);
  }
});

test("HTTP verification accepts a complete report in a new client and refuses ids and missing reports", async (t) => {
  const firstFixture = fixtureServices();
  const first = await connectHttp(firstFixture.services);
  t.after(async () => {
    await first.client.close();
  });
  const report = content(
    await first.client.callTool({
      name: "noria_analyze_position",
      arguments: { ...analysisInput },
    }),
  );
  assert.match(
    errorText(
      await first.client.callTool({
        name: "noria_verify_report",
        arguments: { reportId: report.id },
      }),
    ),
    /stateless|complete report/i,
  );
  await first.client.close();

  const secondFixture = fixtureServices();
  const second = await connectHttp(secondFixture.services);
  t.after(async () => {
    await second.client.close();
  });
  assert.equal(
    content(
      await second.client.callTool({
        name: "noria_verify_report",
        arguments: { report },
      }),
    ).hashMatches,
    true,
  );
  errorText(
    await second.client.callTool({
      name: "noria_verify_report",
      arguments: {},
    }),
  );
  assert.match(
    errorText(
      await second.client.callTool({
        name: "noria_verify_report",
        arguments: { reportId: report.id },
      }),
    ),
    /stateless|complete report/i,
  );
  assert.deepEqual(secondFixture.calls, []);
});

test("HTTP malformed and null JSON fail without provider calls; GET and DELETE are unsupported", async () => {
  const { services, calls } = fixtureServices();
  for (const body of ["", "{", "null", "1", "{}"]) {
    const response = await handleMcpRequest(rpcRequest(body), { services });
    assert.equal(response.status, 400, body);
    const payload = await response.json();
    assert.equal(payload.jsonrpc, "2.0");
    assert.ok(payload.error);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  for (const method of ["GET", "DELETE"]) {
    const response = await handleMcpRequest(new Request(endpoint, { method }), {
      services,
    });
    assert.equal(response.status, 405);
    assert.match(response.headers.get("allow")!, /POST/);
  }
  assert.deepEqual(calls, []);
});

test("HTTP validates request origins, including an explicitly configured client origin", async (t) => {
  const previous = process.env.NORIA_MCP_ALLOWED_ORIGINS;
  process.env.NORIA_MCP_ALLOWED_ORIGINS =
    " https://agent.example,https://other-agent.example ";
  t.after(() => {
    if (previous === undefined) delete process.env.NORIA_MCP_ALLOWED_ORIGINS;
    else process.env.NORIA_MCP_ALLOWED_ORIGINS = previous;
  });
  const { services, calls } = fixtureServices();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  for (const origin of [
    "https://untrusted.example",
    "null",
    "https://agent.example.evil.test",
  ]) {
    const response = await handleMcpRequest(
      rpcRequest(body, { Origin: origin }),
      { services },
    );
    assert.equal(response.status, 403, origin);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  for (const origin of ["https://noria.example", "https://agent.example"]) {
    const response = await handleMcpRequest(
      rpcRequest(body, { Origin: origin }),
      { services },
    );
    assert.equal(response.status, 200, origin);
    assert.equal(response.headers.get("access-control-allow-origin"), origin);
    assert.match(response.headers.get("vary")!, /Origin/i);
    const preflight = await handleMcpRequest(
      new Request(endpoint, { method: "OPTIONS", headers: { Origin: origin } }),
      { services },
    );
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-methods")!,
      /POST/,
    );
  }
  for (const [body, status] of [
    ["{", 400],
    [" ".repeat(MAX_MCP_BODY_BYTES + 1), 413],
  ] as const) {
    const response = await handleMcpRequest(
      rpcRequest(body, { Origin: "https://agent.example" }),
      { services },
    );
    assert.equal(response.status, status);
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://agent.example",
      "An allowed browser client must be able to read error responses too.",
    );
  }
  assert.deepEqual(calls, []);
});

test("HTTP enforces the 256 KiB body limit in bytes, even without a truthful Content-Length", async () => {
  const { services, calls } = fixtureServices();
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const atLimit = body.padEnd(MAX_MCP_BODY_BYTES, " ");
  assert.equal(Buffer.byteLength(atLimit), MAX_MCP_BODY_BYTES);
  assert.equal(
    (await handleMcpRequest(rpcRequest(atLimit), { services })).status,
    200,
  );

  const multibyte = JSON.stringify({
    text: "é".repeat(MAX_MCP_BODY_BYTES / 2),
  });
  assert.ok(multibyte.length < MAX_MCP_BODY_BYTES);
  assert.ok(Buffer.byteLength(multibyte) > MAX_MCP_BODY_BYTES);
  const tooLarge = await handleMcpRequest(
    rpcRequest(multibyte, { "Content-Length": "1" }),
    { services },
  );
  assert.equal(tooLarge.status, 413);

  let cancelled = false;
  const streamingBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Request(endpoint, {
    method: "POST",
    headers: rpcHeaders,
    body: streamingBody,
    duplex: "half",
  } as RequestInit);
  assert.equal((await handleMcpRequest(streamed, { services })).status, 413);
  assert.equal(cancelled, true);
  assert.deepEqual(calls, []);
});

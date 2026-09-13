import { createInterface } from "node:readline";
import { analyze, historicalCase, digest } from "../services/analysis";
import { discover, searchPools } from "../services/discovery";
import { networkOptions } from "../config/networks";
import type { LiveReport } from "../domain/types";
const reports = new Map<string, LiveReport>();
const networkInput = {
  type: "string",
  enum: ["ethereum", "base", "arbitrum", "unichain"],
};
const discoveryProperties = {
  network: networkInput,
  capitalUsd: { type: "number", enum: [1000, 5000, 10000] },
  intent: { type: "string", enum: ["earn-fees", "buy-token0"] },
  horizonHours: { type: "number", enum: [6, 24] },
  discountBps: { type: "integer", minimum: 25, maximum: 1000 },
  query: { type: "string", maxLength: 100 },
};
const tools = [
  {
    name: "noria_networks",
    description:
      "List the configured networks and discovery support. This is configuration, not a live provider-health check or a guarantee of a valid recommendation.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "noria_search_pools",
    description:
      "Search a bounded live Graph pool universe, re-mark token TVL/volume and apply transparent recurring-flow filters. No fixed pool or APR approval.",
    inputSchema: {
      type: "object",
      properties: {
        network: networkInput,
        query: { type: "string", maxLength: 100 },
      },
      required: ["network"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "noria_find_opportunity",
    description:
      "Find a pool and suggest a range for the chosen network, capital and objective. Tries the top four live candidates, requiring full history, canonical RPC reconciliation, independent USD marks and modeled capacity. Can return no recommendation. Economic merit is not established.",
    inputSchema: {
      type: "object",
      properties: discoveryProperties,
      required: ["network", "capitalUsd", "intent", "horizonHours"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "noria_analyze_position",
    description:
      "Analyze a specified network and pool using live Graph data and canonical RPC checks. Distinguishes verified data, mechanical capacity and unproven economics. earn-fees requires the returned target inventory already held; buy-token0 models buying token0 with token1 below spot. Does not send transactions.",
    inputSchema: {
      type: "object",
      properties: {
        network: networkInput,
        poolAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
        capitalUsd: { type: "number", enum: [1000, 5000, 10000] },
        intent: { type: "string", enum: ["earn-fees", "buy-token0"] },
        horizonHours: { type: "number", enum: [6, 24] },
        discountBps: { type: "integer", minimum: 25, maximum: 1000 },
      },
      required: [
        "network",
        "poolAddress",
        "capitalUsd",
        "intent",
        "horizonHours",
      ],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "noria_historical_case",
    description:
      "Read the dated 26 August 2026 WBTC/WETH simulation, including fees, external costs and excess versus both HOLD portfolios. It is a case study, not live profitability or predictive evidence.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "noria_verify_report",
    description:
      "Check a report created in this MCP session for internal hash integrity, budget conservation and current expiry. This does not replace fresh Graph/RPC reads or wallet/transaction simulation.",
    inputSchema: {
      type: "object",
      properties: { reportId: { type: "string" } },
      required: ["reportId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];
const respond = (id: unknown, result: unknown) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const error = (id: unknown, code: number, message: string) =>
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n",
  );
async function handle(line: string) {
  let r: {
    id?: unknown;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  try {
    if (line.length > 65536) throw new Error();
    r = JSON.parse(line);
  } catch {
    error(null, -32700, "Invalid JSON-RPC request");
    return;
  }
  if (r.id === undefined) return;
  if (r.method === "initialize") {
    respond(r.id, {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "noria", version: "0.1.0" },
      instructions:
        "Report source dates and distinguish construction from profitability. The Graph is queried live by analyze_position. No signing or mainnet broadcast exists.",
    });
    return;
  }
  if (r.method === "ping") {
    respond(r.id, {});
    return;
  }
  if (r.method === "tools/list") {
    respond(r.id, { tools });
    return;
  }
  if (r.method !== "tools/call") {
    error(r.id, -32601, "Method not found");
    return;
  }
  try {
    let result: unknown;
    switch (r.params?.name) {
      case "noria_networks":
        result = { networks: networkOptions() };
        break;
      case "noria_search_pools":
        result = await searchPools(
          r.params.arguments?.network,
          r.params.arguments?.query ?? "",
        );
        break;
      case "noria_find_opportunity": {
        const found = await discover(r.params.arguments);
        if (found.report) {
          reports.set(found.report.id, found.report);
          if (reports.size > 30) reports.delete(reports.keys().next().value!);
        }
        result = found;
        break;
      }
      case "noria_analyze_position": {
        const report = await analyze(r.params.arguments);
        reports.set(report.id, report);
        if (reports.size > 30) reports.delete(reports.keys().next().value!);
        result = report;
        break;
      }
      case "noria_historical_case":
        result = await historicalCase();
        break;
      case "noria_verify_report": {
        const report = reports.get(String(r.params.arguments?.reportId));
        if (!report)
          throw new Error(
            "Report not found in this session. Analyze a position first.",
          );
        result = {
          reportId: report.id,
          hashMatches: digest({ ...report, id: "" }) === report.id,
          budgetConserved:
            Math.abs(
              report.position.deployedUsd +
                report.position.residualUsd -
                report.input.capitalUsd,
            ) < 1e-7,
          expired: Date.now() >= Date.parse(report.validUntil),
          validUntil: report.validUntil,
          economics: report.checks.economics,
          reminder:
            "Internal integrity only. Refresh the source state before relying on the analysis.",
        };
        break;
      }
      default:
        error(r.id, -32602, "Unknown tool");
        return;
    }
    respond(r.id, {
      content: [{ type: "text", text: JSON.stringify(result) }],
      structuredContent: result,
      isError: false,
    });
  } catch (e) {
    respond(r.id, {
      isError: true,
      content: [
        {
          type: "text",
          text: (e instanceof Error ? e.message : "Tool failed")
            .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
            .slice(0, 600),
        },
      ],
    });
  }
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
// A session processes requests sequentially so clients cannot create unbounded upstream calls.
let pending = Promise.resolve();
input.on("line", (line) => {
  pending = pending.then(() => handle(line)).catch(() => undefined);
});

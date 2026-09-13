import { z } from "zod";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  analyze,
  historicalCase,
  digest,
  AnalyzeSchema,
  DiscoverSchema,
  NetworkSchema,
} from "../services/analysis";
import { discover, searchPools } from "../services/discovery";
import { networkOptions } from "../config/networks";
import type { LiveReport } from "../domain/types";

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
export const toolDefinitions: Tool[] = [
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
      "Check internal hash integrity, budget conservation and expiry. Pass the complete unmodified report object for HTTP; reportId is available only in the stdio session that created it. An unkeyed hash does not authenticate the issuer or source data. No new provider reads or transaction simulation.",
    inputSchema: {
      type: "object",
      properties: {
        reportId: {
          type: "string",
          pattern: "^[0-9a-f]{64}$",
          description: "Local stdio session only.",
        },
        report: {
          type: "object",
          additionalProperties: true,
          description:
            "Complete, unmodified LiveReport returned by analysis or discovery. Required for stateless HTTP verification.",
        },
      },
      oneOf: [{ required: ["reportId"] }, { required: ["report"] }],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const EmptySchema = z.object({}).strict();
const SearchSchema = z
  .object({
    network: NetworkSchema,
    query: z.string().trim().max(100).optional(),
  })
  .strict();
const VerifySchema = z
  .object({
    reportId: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    report: z.record(z.unknown()).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.report) !== Boolean(value.reportId), {
    message: "Provide exactly one of report or reportId.",
  });
// Validate only the fields used by verification. Hash the original object, never
// a schema-normalized copy: stripping/reordering keys would change the digest.
const VerificationFields = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[0-9a-f]{64}$/),
  classification: z.literal("live-construction-analysis"),
  createdAt: z.string().datetime({ offset: true }),
  validUntil: z.string().datetime({ offset: true }),
  input: z.object({ capitalUsd: z.number().finite().positive() }),
  position: z.object({
    deployedUsd: z.number().finite().nonnegative(),
    residualUsd: z.number().finite().nonnegative(),
  }),
  checks: z.object({ economics: z.literal("not-established") }),
});

export function verifyReport(raw: unknown, now = Date.now()) {
  const report = VerificationFields.parse(raw);
  return {
    reportId: report.id,
    hashMatches:
      digest({ ...(raw as Record<string, unknown>), id: "" }) === report.id,
    budgetConserved:
      Math.abs(
        report.position.deployedUsd +
          report.position.residualUsd -
          report.input.capitalUsd,
      ) < 1e-7,
    expired: now >= Date.parse(report.validUntil),
    validUntil: report.validUntil,
    economics: report.checks.economics,
    issuerAuthenticated: false,
    reminder:
      "Internal consistency only. Anyone can recompute this unkeyed hash; it does not authenticate Noria or verify provider data. Refresh source state before relying on the analysis.",
  };
}

export interface ToolServices {
  analyze: typeof analyze;
  discover: typeof discover;
  searchPools: typeof searchPools;
  historicalCase: typeof historicalCase;
}
const defaultServices: ToolServices = {
  analyze,
  discover,
  searchPools,
  historicalCase,
};

/** Each local session owns its report cache; HTTP never relies on shared memory. */
export function createToolExecutor({
  retainReports = false,
  services = defaultServices,
}: { retainReports?: boolean; services?: ToolServices } = {}) {
  const reports = new Map<string, LiveReport>();
  function remember(report: LiveReport) {
    if (!retainReports) return;
    reports.set(report.id, report);
    if (reports.size > 30) reports.delete(reports.keys().next().value!);
  }
  return async (name: string, raw: unknown = {}): Promise<CallToolResult> => {
    try {
      let result: object;
      switch (name) {
        case "noria_networks":
          EmptySchema.parse(raw);
          result = { networks: networkOptions() };
          break;
        case "noria_search_pools": {
          const input = SearchSchema.parse(raw);
          result = await services.searchPools(input.network, input.query ?? "");
          break;
        }
        case "noria_find_opportunity": {
          const found = await services.discover(DiscoverSchema.parse(raw));
          if (found.report) remember(found.report);
          result = found;
          break;
        }
        case "noria_analyze_position": {
          const report = await services.analyze(AnalyzeSchema.parse(raw));
          remember(report);
          result = report;
          break;
        }
        case "noria_historical_case":
          EmptySchema.parse(raw);
          result = await services.historicalCase();
          break;
        case "noria_verify_report": {
          const input = VerifySchema.parse(raw);
          const report = input.report ?? reports.get(input.reportId!);
          if (!report)
            throw new Error(
              retainReports
                ? "Report not found in this session. Pass the complete report or analyze a position first."
                : "HTTP is stateless. Pass the complete report object, not reportId.",
            );
          result = verifyReport(report);
          break;
        }
        default:
          throw new Error("Unknown tool.");
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as Record<string, unknown>,
        isError: false,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: (error instanceof Error ? error.message : "Tool failed")
              .replace(/https?:\/\/[^\s"<>]+/g, "[provider]")
              .slice(0, 600),
          },
        ],
      };
    }
  };
}

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createToolExecutor,
  toolDefinitions,
  type ToolServices,
} from "./tools";

export function createNoriaMcpServer(
  options: { retainReports?: boolean; services?: ToolServices } = {},
) {
  const server = new Server(
    { name: "noria", version: "0.1.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Use The Graph-backed discovery and position analysis. Preserve source dates, exclusions and economics: not-established. These tools are read-only. For HTTP verification pass the complete unmodified report; reportId only works within a local stdio session. Verification checks internal consistency, not authenticity or fresh provider data.",
    },
  );
  const execute = createToolExecutor(options);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    execute(request.params.name, request.params.arguments),
  );
  return server;
}

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createNoriaMcpServer } from "./protocol";

const server = createNoriaMcpServer({ retainReports: true });
server.connect(new StdioServerTransport()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MCP server failed");
  process.exitCode = 1;
});

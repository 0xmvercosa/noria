import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  const argv = process.argv.slice(2);
  const remote = argv[0] === "--url" ? (argv.shift(), argv.shift()) : undefined;
  const name = argv.shift();
  if (!name || argv.length > 1)
    throw new Error(
      "Usage: npm run agent:call -- [--url MCP_URL] TOOL JSON_ARGUMENTS",
    );
  const args = JSON.parse(argv[0] ?? "{}");
  const client = new Client({ name: "noria-tool-client", version: "1.0.0" });
  const transport = remote
    ? new StreamableHTTPClientTransport(new URL(remote))
    : new StdioClientTransport({
        command: process.execPath,
        args: [
          "--env-file-if-exists=.env.local",
          "--import",
          "tsx",
          "src/mcp/server.ts",
        ],
        cwd: process.cwd(),
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
        stderr: "inherit",
      });
  try {
    await client.connect(transport);
    if (name === "list") {
      console.log(JSON.stringify(await client.listTools(), null, 2));
      return;
    }
    const result = await client.callTool({ name, arguments: args }, undefined, {
      timeout: 300_000,
    });
    if (result.isError) throw new Error(JSON.stringify(result.content));
    const value = result.structuredContent as
      | Record<string, unknown>
      | undefined;
    const report =
      name === "noria_find_opportunity"
        ? value?.report
        : name === "noria_analyze_position"
          ? value
          : undefined;
    const verification = report
      ? await client.callTool({
          name: "noria_verify_report",
          arguments: { report },
        })
      : undefined;
    if (verification?.isError)
      throw new Error(JSON.stringify(verification.content));
    // Keep the complete report so downstream clients can reproduce its digest.
    console.log(
      JSON.stringify(
        {
          tool: name,
          result: value ?? result,
          verification: verification?.structuredContent,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.close();
  }
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "MCP call failed");
  process.exitCode = 1;
});

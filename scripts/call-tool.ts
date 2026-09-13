import { spawn } from "node:child_process";
const name = process.argv[2],
  args = JSON.parse(process.argv[3] ?? "{}");
if (!name)
  throw new Error(
    "Usage: node --import tsx scripts/call-tool.ts TOOL JSON_ARGUMENTS",
  );
const child = spawn(
  process.execPath,
  ["--env-file-if-exists=.env.local", "--import", "tsx", "src/mcp/server.ts"],
  { stdio: ["pipe", "pipe", "inherit"] },
);
let seq = 0,
  buffer = "";
const pending = new Map<
  number,
  { resolve(v: any): void; reject(e: Error): void }
>();
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let n;
  while ((n = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, n);
    buffer = buffer.slice(n + 1);
    try {
      const r = JSON.parse(line),
        p = pending.get(r.id);
      if (p) {
        pending.delete(r.id);
        if (r.error) p.reject(new Error(r.error.message));
        else p.resolve(r.result);
      }
    } catch {
      /* Ignore no non-protocol stdout from the server. */
    }
  }
});
child.on("exit", () => {
  for (const p of pending.values()) p.reject(new Error("MCP server stopped"));
  pending.clear();
});
const call = (method: string, params: unknown) =>
  new Promise<any>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );
  });
const timeout = setTimeout(() => child.kill(), 90000);
async function main() {
  try {
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "noria-tool-client", version: "1.0" },
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
        "\n",
    );
    const result =
      name === "list"
        ? await call("tools/list", {})
        : await call("tools/call", { name, arguments: args });
    if (result.isError) throw new Error(result.content[0].text);
    const value = result.structuredContent ?? result;
    const report =
      name === "noria_find_opportunity"
        ? value.report
        : name === "noria_analyze_position"
          ? value
          : null;
    const verification = report
      ? (
          await call("tools/call", {
            name: "noria_verify_report",
            arguments: { reportId: report.id },
          })
        ).structuredContent
      : undefined;
    // Omit 168 chart points only from this CLI presentation, never from the MCP result or hashed report.
    const compact = value.pool?.history
      ? {
          ...value,
          pool: {
            ...value.pool,
            history: `[${value.pool.history.length} points omitted from CLI presentation]`,
          },
        }
      : value;
    console.log(
      JSON.stringify({ tool: name, result: compact, verification }, null, 2),
    );
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});

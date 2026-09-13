import { readFile, access } from "node:fs/promises";
import path from "node:path";

const required = {
  "api/noria": ["docs/agent-setup.md", "data/examples/historical-case.json"],
  "api/mcp": ["data/examples/historical-case.json"],
  "agent/skill": [".agents/skills/noria-discovery/SKILL.md"],
};

for (const [route, assets] of Object.entries(required)) {
  const tracePath = path.resolve(
    ".next/server/app",
    route,
    "route.js.nft.json",
  );
  const trace = JSON.parse(await readFile(tracePath, "utf8"));
  const traced = new Set(
    trace.files.map((file) => path.resolve(path.dirname(tracePath), file)),
  );
  for (const asset of assets) {
    const expected = path.resolve(asset);
    if (!traced.has(expected))
      throw new Error(`Production trace for /${route} is missing ${asset}.`);
    await access(expected);
  }
  console.log(`/${route}: ${assets.length} required runtime assets traced.`);
}

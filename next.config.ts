import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/noria": [
      "./docs/agent-setup.md",
      "./data/examples/historical-case.json",
    ],
    "/api/mcp": ["./data/examples/historical-case.json"],
    "/agent/skill": ["./.agents/skills/noria-discovery/SKILL.md"],
  },
};

export default nextConfig;

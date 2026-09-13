import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@noria/aqua"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  webpack(config) {
    // The standalone ESM module uses .js specifiers for TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
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

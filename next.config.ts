import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@noria/aqua"],
  webpack(config) {
    // The standalone ESM module uses .js specifiers for TypeScript sources.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;

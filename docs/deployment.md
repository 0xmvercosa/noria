# Deploy the judging demonstration

Deploy this repository as a Next.js application from its root. Both the full The Graph demo and the focused Aqua reference preview are delivered by the same build; a custom domain does not require a separate application or code fork.

| Setting                | Value                                  |
| ---------------------- | -------------------------------------- |
| Runtime                | Node.js 22.9+; Node 22 LTS recommended |
| Install                | `npm ci`                               |
| Build                  | `npm run build`                        |
| Local production start | `npm start` on `127.0.0.1:3100`        |
| Full demo              | `/`                                    |
| Aqua reference preview | `/aqua`                                |
| Aqua API               | `/api/aqua/v1/recommendation`          |
| OpenAPI                | `/aqua/openapi.json`                   |

Vercel detected and built the application successfully during publication. The final custom domain is supplied by the project owner. Before giving judges the URL, verify access in a signed-out browser and ensure the production domain is not behind deployment protection. An immutable Vercel deployment URL can require authentication even when its build is successful.

## Environment and provider access

The default Graph route connects to The Graph Subgraph MCP without an application-level Graph API key. For the optional gateway, configure `GRAPH_API_KEY` as a server-side secret. Optional RPC overrides are `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` and `UNICHAIN_RPC_URL`. Blank RPC overrides fall back to the registry defaults.

Use `.env.example` to see the supported settings. Never expose these values through `NEXT_PUBLIC_*` variables or commit a populated environment file. No wallet, private key or model API key is required to run Noria.

Live routes declare a 300-second platform execution allowance, while individual Graph queries use a shared 25-second request/retry budget. Hosting limits still apply. Public providers can time out or rate-limit; valid error/refusal responses remain part of the product. The dated example is never a live fallback.

For a Node host outside Vercel, bind the Next.js server to the host's configured interface and port, keep the working directory at the repository root, and include the runtime files required by the build. The API reads `data/examples/historical-case.json` and `docs/agent-setup.md`; Next.js traces these files in the production output. Serve static assets from `public` with the application.

## Post-deployment check

1. Open `/` while signed out. Confirm the logo, network controls and historical example load.
2. Run a live discovery request and inspect its source date. A recorded failure must be shown accurately if a provider is unavailable.
3. Open `/aqua`, request 1,000 USDC and inspect the selected reference or exclusions.
4. Confirm the capability `GET` and OpenAPI URL are reachable from the Aqua backend, then send [`examples/aqua/request.json`](../examples/aqua/request.json) to the versioned endpoint.
5. Configure the Aqua backend with the final origin. It should preserve expiry, handle structured refusals and provide its own execution mapping, cost quotes, authorization and Aave checks.

No automated wallet operation is enabled by deployment. See [the integration contract](aqua-integration.md) and [execution roadmap](roadmap.md).

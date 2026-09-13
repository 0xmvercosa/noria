# Deploy the judging demonstration

Deploy this repository as a Next.js application from its root. Both the full The Graph demo and the Aqua collateral planning interface are delivered by the same build; a custom domain does not require a separate application or code fork.

| Setting                | Value                                  |
| ---------------------- | -------------------------------------- |
| Runtime                | Node.js 22.9+; Node 22 LTS recommended |
| Install                | `npm ci`                               |
| Build                  | `npm run build`                        |
| Local production start | `npm start` on `127.0.0.1:3100`        |
| Full demo              | `/`                                    |
| Aqua position planner  | `/aqua`                                |
| Graph research API     | `/api/aqua/v1/recommendation`          |
| Position API           | `/api/aqua/v1/position`                |
| OpenAPI                | `/aqua/openapi.json`                   |

Vercel detected and built the application successfully during publication. The final custom domain is supplied by the project owner. Before giving judges the URL, verify access in a signed-out browser and ensure the production domain is not behind deployment protection. An immutable Vercel deployment URL can require authentication even when its build is successful.

## Environment and provider access

The default Graph route connects to The Graph Subgraph MCP without an application-level Graph API key. For the optional gateway, configure `GRAPH_API_KEY` as a server-side secret. Optional RPC overrides are `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` and `UNICHAIN_RPC_URL`. Blank RPC overrides fall back to the registry defaults.

Use `.env.example` for settings. Keep provider credentials server-side and never commit a populated environment file. `NEXT_PUBLIC_PRIVY_APP_ID` is a public identifier, intentionally bundled at build time: set it and configure allowed origins in Privy for external-wallet connection. No private wallet key or model API key is required. Without the App ID, connection is explicitly unavailable; planning still works.

Keep `NORIA_ENABLE_LOCAL_FORK` disabled on public deployments. The local rehearsal runner rejects Vercel and non-loopback hosts. It requires Foundry and a persistent local Node process; it is not a serverless execution job.

Live routes declare a 300-second platform execution allowance, while individual Graph queries use a shared 25-second request/retry budget. Hosting limits still apply. Public providers can time out or rate-limit; valid error/refusal responses remain part of the product. The dated example is never a live fallback.

For a Node host outside Vercel, bind the Next.js server to the host's configured interface and port, keep the working directory at the repository root, and include the runtime files required by the build. The API reads `data/examples/historical-case.json` and `docs/agent-setup.md`; Next.js traces these files in the production output. Serve static assets from `public` with the application.

## Post-deployment check

1. Open `/` while signed out. Confirm the logo, network controls and historical example load.
2. Run a live discovery request and inspect its source date. A recorded failure must be shown accurately if a provider is unavailable.
3. Open `/aqua`, enter ETH or USDC collateral and the two HF limits, and inspect the real loan, reference, asymmetric inventory or refusal.
4. Confirm the capability `GET` and OpenAPI URL are reachable from the Aqua backend, then send [`examples/aqua/request.json`](../examples/aqua/request.json) to the versioned endpoint.
5. Verify Privy connection, network display and disconnect using the configured App ID. This is separate from a build check and does not require signing. Rehearse actual Aqua/Aave execution through the local runner described in the [1inch guide](1inch/rehearsal.md).

No public-chain wallet operation is enabled by deployment. See the [position integration contract](1inch/integration.md) and [remaining work](roadmap.md).

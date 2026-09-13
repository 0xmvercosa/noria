# Deploy the judging demonstration

For contract deployment with Rabby, exact commands and the full terminal/UI test sequence, see the [Portuguese walkthrough](1inch/deploy-and-test.pt-BR.md) and [contract readiness review](1inch/contract-review.md).

Deploy this repository as a Next.js application from its root. The Graph demo, Aqua collateral planning interface and Privy reserve are delivered by the same build; a custom domain does not require a separate application or code fork.

| Setting                | Value                                  |
| ---------------------- | -------------------------------------- |
| Runtime                | Node.js 22.x (use current Node 22 LTS) |
| Install                | `npm ci`                               |
| Build                  | `npm run build`                        |
| Local production start | `npm start` on `127.0.0.1:3100`        |
| Full demo              | `/`                                    |
| Aqua position planner  | `/aqua`                                |
| Privy reserve          | `/reserve`                             |
| Graph research API     | `/api/aqua/v1/recommendation`          |
| Position API           | `/api/aqua/v1/position`                |
| OpenAPI                | `/aqua/openapi.json`                   |
| Agent setup            | `/agent`                               |
| Remote MCP             | `/api/mcp` (Streamable HTTP POST)      |
| Downloadable skill     | `/agent/skill`                         |

The repository includes `vercel.json`, a Node 22 runtime declaration and explicit tracing of the files needed by API handlers. Import the GitHub repository into Vercel, select Next.js and leave Root Directory at the repository root. Use Node.js 22.x, `npm ci` and `npm run build`; Output Directory stays at the framework default. The final custom domain is supplied by the project owner. Before giving judges the URL, verify access in a signed-out browser and ensure the production domain is not behind deployment protection. An immutable Vercel deployment URL can require authentication even when its build is successful.

## Repository and deployment fork

All development, issues, code review and merges stay in [rafaelzochling/noria](https://github.com/rafaelzochling/noria). Keep the local `origin` remote pointed there. The existing Vercel project `dev0xmvercosa/noria` is connected to the public [0xmvercosa/noria fork](https://github.com/0xmvercosa/noria), production branch `main`, and continues to serve [noria-blue.vercel.app](https://noria-blue.vercel.app). The fork is a deployment mirror; do not develop independent changes there.

After the upstream pull request passes checks and is merged, a maintainer with write access to the fork runs:

```sh
gh repo sync 0xmvercosa/noria --source rafaelzochling/noria --branch main
```

This is an explicit publishing step, not a scheduled synchronization. A GitHub fork does not follow upstream automatically. The command performs a fast-forward and preserves the upstream commits; **do not add `--force`**. If the branches diverge, stop and inspect the extra commits rather than overwriting them. Verify that the following commands return the same SHA:

```sh
gh api repos/rafaelzochling/noria/commits/main --jq .sha
gh api repos/0xmvercosa/noria/commits/main --jq .sha
```

An updated fork `main` triggers the connected Vercel project. Confirm the deployment is **Ready**, targets **Production**, and reports that SHA before treating the site as updated. Syncing an already-current branch does not create a new commit or guarantee a new build; use Vercel's deployment controls if a build must be started after connecting the repository. Environment variables and Privy settings belong to the existing services, not to the fork; credentials must never be committed or copied into Git.

This arrangement satisfies Vercel's [personal-repository owner requirement](https://vercel.com/docs/git/vercel-for-github#personal-account-repositories) while preserving Rafael's repository as the source. See the official [fork synchronization command](https://cli.github.com/manual/gh_repo_sync) and [Vercel Git integration](https://vercel.com/docs/git/vercel-for-github).

## Environment and provider access

The default Graph route connects to The Graph Subgraph MCP without an application-level Graph API key. For the optional gateway, configure `GRAPH_API_KEY` as a server-side secret. Optional RPC overrides are `ETHEREUM_RPC_URL`, `BASE_RPC_URL`, `ARBITRUM_RPC_URL` and `UNICHAIN_RPC_URL`. Blank RPC overrides fall back to the registry defaults.

Use `.env.example` for settings. Keep provider credentials server-side and never commit a populated environment file. `NEXT_PUBLIC_PRIVY_APP_ID` is a public identifier, intentionally bundled at build time: set it and configure allowed origins in Privy for embedded-wallet login/creation and user-confirmed reserve transactions. Follow [Privy setup](privy/setup.md). No private wallet key or model API key is required. Without the App ID, connection is explicitly unavailable; planning still works.

Keep `NORIA_ENABLE_LOCAL_FORK` disabled on public deployments. The local rehearsal runner rejects Vercel and non-loopback hosts. It requires Foundry and a persistent local Node process; it is not a serverless execution job.

Graph live routes, including `/api/mcp`, declare a 300-second platform execution allowance. The bounded Privy read/simulate/verify endpoint declares 60 seconds. Enable Vercel Fluid Compute and confirm the project plan permits that duration; the declaration does not override a lower account limit. The MCP client should allow up to 300 seconds per live tool call, while individual Graph queries use a shared 25-second request/retry budget. Hosting limits still apply. Public providers can time out or rate-limit; valid error/refusal responses remain part of the product. The dated example is never a live fallback.

For a Node host outside Vercel, bind the Next.js server to the host's configured interface and port, keep the working directory at the repository root, and include the runtime files required by the build. The API reads `data/examples/historical-case.json` and `docs/agent-setup.md`, plus `.agents/skills/noria-discovery/SKILL.md` for the skill download; `next.config.ts` explicitly includes them in the appropriate production functions. Serve static assets from `public` with the application.

## Serverless behavior

MCP requests use the Node runtime and stateless Streamable HTTP with JSON responses. Each request opens and closes its own MCP server. Reports are returned to the client and verified by passing the complete report back; there is no reliance on a warm process, filesystem writes, persistent stdio process or database. The local `npm run mcp` entry point remains available for stdio clients and does not run as a Vercel process.

The default is a public read-only API, with no model key or application authentication. Same-origin browser calls are allowed. If a browser-based agent runs on another origin, list its exact origin in `NORIA_MCP_ALLOWED_ORIGINS` (comma-separated, no wildcard). Native clients need no origin entry. Configure provider quotas and Vercel firewall controls appropriate for public judging traffic. Origin validation alone is not authentication or a global rate limiter.

## Validate before deployment

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run check:runtime-assets
```

The runtime-asset check inspects Next.js tracing manifests so a build cannot quietly omit the historical case, agent guide or downloadable skill. Browser tests use the production server, and MCP protocol tests use the official SDK with disclosed provider fixtures. Live provider checks are recorded separately from deterministic test evidence.

## Post-deployment check

1. Open `/` while signed out. Confirm the logo, network controls and historical example load.
2. Run a live discovery request and inspect its source date. A recorded failure must be shown accurately if a provider is unavailable.
3. Open `/aqua`, enter ETH or USDC collateral and the two HF limits, and inspect the real loan, reference, asymmetric inventory or refusal.
4. Confirm the capability `GET` and OpenAPI URL are reachable from the Aqua backend, then send [`examples/aqua/request.json`](../examples/aqua/request.json) to the versioned endpoint.
5. Open `/agent`, copy the deployed endpoint and connect an external MCP client. Run `npm run agent:call -- --url https://YOUR_DOMAIN/api/mcp list`, then `noria_networks` and `noria_historical_case` with `'{}'` arguments. Try live discovery and verify the full returned report, or inspect the recorded refusal.
6. Download `/agent/skill` and check `/api/noria?doc=agent`. Neither should expose an HTML hosting sign-in page.
7. Open `/reserve` with the configured Privy App ID. Validate embedded wallet creation, funding, a user-confirmed Aave supply/withdrawal and its receipt/report using the [Privy acceptance guide](privy/setup.md). This requires a real funded wallet and is separate from a passing build. Rehearse Aqua/Aave through the isolated local runner in the [1inch guide](1inch/rehearsal.md).

A configured `/reserve` enables EUR funding checkout, user-confirmed USDC/ETH transfers and Aave savings on public Arbitrum. `/aqua` adds the owner-confirmed position lifecycle when `NORIA_AQUA_FACTORY_ADDRESS` identifies the reviewed public deployment; otherwise it explicitly shows deployment-required. Follow the [factory and wallet launch guide](1inch/live-launch.md). See the [position integration contract](1inch/integration.md) and [remaining work](roadmap.md).

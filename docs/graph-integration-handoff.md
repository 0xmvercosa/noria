# Graph application handoff to Aqua

The Graph application keeps its existing discovery and HTTP reference boundaries. This change adds agent access and Vercel deployment support; it does not change the Aqua recommendation request/response schema.

## Stable integration surfaces

- `POST /api/aqua/v1/recommendation`: exact Arbitrum WETH/native-USDC reference selection. Send the LP budget in raw USDC units using the [versioned contract](aqua-integration.md).
- `GET /api/aqua/v1/recommendation`: capabilities and supported boundary.
- `/aqua/openapi.json`: machine-readable schema.
- `examples/aqua/client.ts`: typed client; `request.json` and `response.recorded.json` provide request and dated live-response examples.
- `/aqua`: informational reference preview; the integrating task owns the final wallet and financing workflow.
- `/api/mcp`: six read-only tools for external agents; this is separate from the raw-USDC Aqua boundary. Public MCP capital presets remain 1,000 / 5,000 / 10,000 USD.
- `/agent`: connection page that derives the endpoint from the current domain.

The Graph layer returns evidence, capacity and a reference range. It does not promise the global best pool, profitability, an executable Aqua route or funding approval. Preserve refusals, source age, expiry and inventory assumptions.

## Ownership and financing inputs

The Aqua task owns `integrations/aqua/**`, `docs/1inch/**` and `.github/workflows/aqua.yml` in its separate clone and branch. Those paths are not modified by the agent/Vercel work. Merge or rebase the completed Graph main before the final adapter/UI PR, then run the combined checks.

The final integration includes Privy connection and these user inputs: collateral asset (ETH or USDC), collateral amount, safety health factor and comfortable health factor. For USDC collateral, the intended flow is **supply USDC to Aave, borrow USDC, then prepare the Aqua WETH/USDC inventory**. It is not direct allocation of the supplied collateral to LP. The financing layer should send only the resulting LP funding budget to the existing Graph recommendation API.

The Aqua schema is maintained in `integrations/aqua/src/boundary.ts` by the Aqua task. Its foundation and execution PRs have been merged independently; consume the current main version when connecting the final UI. Health-factor policy, financing, wallet authorization, inventory preparation and execution belong to that layer. The Graph release does not broadcast on a public chain or claim automatic 1inch routing. Final fork execution and combined Graph/Aqua tests belong to the integrating task.

## Deployment boundary

Deploy the repository root as Next.js on Vercel with Node 22.x. The Graph demo, reference API and hosted MCP share the origin. No model key, private key or database is required for these read-only features. The Aqua task must add its own Privy and execution configuration in its focused PRs; those requirements are not inferred by this release. See [deployment instructions](deployment.md).

The agent/Vercel PR and its merge commit identify the Graph-ready base. The completion message records the exact final main SHA for the Aqua task to consume.

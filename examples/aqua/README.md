# Aqua request and response examples

- [`request.json`](request.json): send 1,000 native USDC of intended inventory funding, with a fee-exposure objective and six-hour review.
- [`client.ts`](client.ts): typed backend HTTP client, with correlation/version and expiry checks. It does not build or submit transactions.
- [`response.recorded.json`](response.recorded.json): the full response to a real local HTTP request at **2026-09-13 01:38:47 UTC**, using live The Graph, RPC and independent price sources. It is expired historical evidence, never a production fallback or a current opportunity.
- [`live-checks.json`](live-checks.json): a dated summary of four live HTTP checks, including fee exposure at 1,000 / 5,000 / 10,000 USDC and a 1,000-USDC buy-ETH range.

These examples preserve actual pool addresses and source times. They do not preselect that pool in the application. A future request can select another fee tier, fail capacity or return no recommendation. The reference pool is a Uniswap v3 pool; its ticks, fee tier and liquidity integer are not executable Aqua strategy parameters.

See the [integration guide](../../docs/aqua-integration.md) and [OpenAPI specification](../../public/aqua/openapi.json) for the complete contract and execution-system responsibilities.

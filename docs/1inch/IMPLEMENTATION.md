# Implementation checkpoints

The Aqua implementation is isolated from the discovery application so both teams can work without moving ownership of the same files.

1. Versioned Graph/Aqua request, candidate bundle and decision; strict Arbitrum WETH/USDC constraints; documented fixtures.
2. Official SwapVM program generation and position contracts with Aave ownership and cycle accounting.
3. Dedicated local-fork execution, complete operation journal, related-party consolidation and reproducible reports.
4. Independent review, focused fixes, required checks and merge with the tested commit recorded.

All documentation, code, examples, commits and pull requests are in English. Preserve small commits; do not fabricate historical work or evidence. Program deployment compatibility, source verification, position capacity and economic attractiveness remain separate claims.

5. Integrate the published Graph service with collateral-based financing, preserving its ranking, indexed evidence and asymmetric inventory.
6. Add Privy external-wallet connection and an opt-in loopback rehearsal job, with complete and partial reports.
7. Validate the production build, UI boundaries, real Graph round trip and official fork execution; preserve dated evidence independently from current market claims.

The production adapter is `src/integrations/aqua/position-service.ts`. The earlier standalone candidate protocol is an isolated fixture/test interface, not the production Graph wire contract. See [integration](integration.md) for the current endpoint contracts and wallet configuration.

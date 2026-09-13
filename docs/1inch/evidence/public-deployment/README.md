# Public Arbitrum deployment

The owner deployed `UniswapInventoryAdapter` and `PositionFactory` through Rabby on Arbitrum One (chain ID 42161). Both creation receipts succeeded. Deployer: [`0xc365B6795443380eb76516dA0Cedd5a00B349d66`](https://arbiscan.io/address/0xc365B6795443380eb76516dA0Cedd5a00B349d66).

| Contract                | Public address                                                                                                         | Creation receipt                                                                                                    | Block     | Nonce |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------- | ----- |
| UniswapInventoryAdapter | [`0x2117563619Fa050689EFfB059Ef7b879b1ff2231`](https://arbiscan.io/address/0x2117563619Fa050689EFfB059Ef7b879b1ff2231) | [Successful transaction](https://arbiscan.io/tx/0x8ab04e8ea8aa82b1542ab8f8ea2eaa3e055b65fa44cb76c84e6f5276522d3ff5) | 504752498 | 42    |
| PositionFactory         | [`0x71f29e7828E138a6021cd99696A734D47D62b02F`](https://arbiscan.io/address/0x71f29e7828E138a6021cd99696A734D47D62b02F) | [Successful transaction](https://arbiscan.io/tx/0xbf584ee33de7687aac987a56e404552607b16ddc660c990bba363b1181d0390d) | 504752718 | 43    |

Read-only verification completed at **2026-09-13T13:47:36.623Z**, against block **504753367**, hash `0x362078b7e2fd223200ce5ffbedb0ed654b087d21df289db022e1dd0912969ce1`. The check confirmed successful deployment receipts, exact constructor data, deployed runtime matching source commit `f4fc8f114ef4773736ff160912fa6dca7affe44c`, and the expected official protocol configuration. The launch verifier accepted the factory with status `ready`. This is a dated chain/service check, not a claim that the hosted frontend has been configured.

Build settings: Solidity **0.8.30**, EVM **Cancun**, optimizer enabled with **200 runs**. The [machine-readable record](deployment.json) preserves constructor parameters and runtime hashes. See the [launch verifier](../../../../src/integrations/aqua/launch-service.ts) and [Foundry settings](../../../../integrations/aqua/contracts/foundry.toml).

| Contract                | Gas used | Exact network fee                       |
| ----------------------- | -------- | --------------------------------------- |
| UniswapInventoryAdapter | 635342   | 0.00001281484814 ETH (USD unavailable)  |
| PositionFactory         | 5237927  | 0.000104842346832 ETH (USD unavailable) |
| Total                   | 5873269  | 0.000117657194972 ETH (USD unavailable) |

Fees are recorded in wei in the JSON. No transaction-time ETH/USD price was retained, so no dollar estimate is asserted.

Frontend configuration and a user-confirmed financial flow through Privy remain pending at this record's check time. These deployment transactions do not demonstrate an opened LP position, Aqua fills, organic taker demand, profitability or aggregator admission. Explorer source publication has not been checked; matching runtime here does not assert an explorer verification badge. The separate [fork evidence](../README.md) retains its own execution scope.

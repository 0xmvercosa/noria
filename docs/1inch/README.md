# 1inch judge entry point

This directory is the review entry point for the **Aqua component of Noria**, submitted alongside an independently developed The Graph component.

## Review map

| Question                             | Evidence location                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| What is the 1inch contribution?      | `integrations/aqua/` and this documentation                                      |
| What does The Graph provide?         | Source-pool/range evidence via the versioned discovery boundary                  |
| What is executed in Aqua?            | An official SwapVM WETH/USDC program on Arbitrum, backed by the position account |
| What belongs to Aave?                | WETH collateral, USDC variable debt and repayment in that same account           |
| Are demo counterparties independent? | No: local rehearsals identify the maker/taker economic owner                     |
| Is aggregator routing established?   | No: direct quote/swap proves settlement, not route admission                     |

Implementation and verification status will be updated with actual passing tests and captured fork evidence. Nothing in this initial document claims a completed rehearsal.

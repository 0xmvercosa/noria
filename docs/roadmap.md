# Implementation status and remaining work

Noria combines implemented Graph discovery, an Arbitrum Aqua/Aave module and a [Privy wallet reserve](privy/README.md). The [1inch guide](1inch/README.md) and [integration specification](1inch/integration.md) are the current execution references.

| Area               | Implemented                                                                                         | Remaining boundary                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Market evidence    | Graph discovery/history, canonical RPC, independent USD references                                  | Provider availability and fresh evidence remain required                                 |
| Position planning  | Aave-sized USDC loan → real Graph pool/range and asymmetric targets                                 | No profitability forecast                                                                |
| Funding            | ETH/WETH or USDC collateral; bounded USDC borrowing                                                 | Local fork evidence; no public deployment claimed                                        |
| Aqua execution     | Official shipment, bidirectional quotes/swaps, docking and cycle transition                         | Aggregator admission and independent takers not validated                                |
| Accounting         | Interest, loss carry, external-flow reconciliation, 50/50 eligible LP surplus, consolidated reports | Eligible onchain surplus is before wallet-paid gas; nonzero provisions rejected          |
| Health             | Safety/comfortable gates, terminal defense, explicit owner loss coverage and debt-free exit         | No autonomous collateral sales or guaranteed liquidation prevention                      |
| Wallet and reserve | Privy embedded wallet, EUR funding, transfers, Aave savings, receipt recovery and statements        | App ID and connected wallet observed; public funding and financial acceptance pending    |
| Wallet launch      | Factory creation, exact collateral approval, open/convert/ship, stop/repay/exit and unwrap          | Public factory deployment and a recorded owner-confirmed live journey pending            |
| Local user flow    | Plan download, opt-in loopback runner, full/partial reports                                         | Aqua rehearsals do not sign/broadcast upstream; public reserve has its own confirmations |

The product is for owners who understand LP and deliberately choose credit financing. It does not presume borrowed LP outperforms an unleveraged position or holding ETH. The USDC entry path supplies USDC as Aave collateral and borrows USDC; it does not spend the deposited principal as Aqua inventory.

The 50/50 rule applies after realized inventory, borrowing interest and LP loss recovery. Deposits, borrowing, donations and outside repayments are not surplus. A direct owner checkpoint classifies inventory provenance after docking; this is not completely autonomous or wholly onchain profit verification. Wallet gas is separately included in full-wallet equity. Related maker/taker payments cancel in consolidated P&L, so positive maker surplus can coexist with group losses.

Production operation still requires deployment-specific security review, transaction authorization, independent taker/routing access, monitoring and live cost policies. A signed-out public demo, configured Privy financial operation and organizer acceptance must be recorded separately from a passing build. No prior fork evidence is a production audit or a promise of profit.

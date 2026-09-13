# Curated official-contract fork evidence

The standalone runs below execute unchanged official protocol bytecode on isolated Arbitrum forks. Fixture funds and access credentials are synthetic and explicitly recorded; related takers are not independent customers. These reports prove execution and accounting, not market demand or expected profitability.

| Collateral/report | Source block | Journal operations | Eligible LP surplus (USDC, before wallet gas) | Consolidated strategy group result (USDC) |
| --- | --- | --- | --- | --- |
| [ETH](eth/report.md) | 504589079 | 46 | 5.894270 | -11.015355 |
| [USDC](usdc/report.md) | 504589302 | 46 | 7.651726 | -7.070730 |

Each directory contains a standalone `report.html`, a portable `report.md`, the exact `manifest.json` and `operations.jsonl`, plus `receipts.tar.gz` containing transaction calldata, receipts, raw logs and call traces. Verify file integrity with `shasum -a 256 -c SHA256SUMS` from that directory. The manifest identifies the tested source commit and whether the execution module had uncommitted files at capture time.

To inspect raw evidence, extract `receipts.tar.gz` into a new directory. Local transaction hashes have no public explorer links. To repeat the execution, use the script in [the rehearsal guide](../rehearsal.md), setting the recorded source block with an archive-capable RPC, or select a new block and capture a new independently identified run.

The positive LP surplus partly reflects fees paid by the related taker. The consolidated group result remains negative. No self-trade is counted as organic yield.


## Integrated Graph → Aqua execution

These additional runs use the real position endpoint and its Graph-selected range, fee and asymmetric inventory. Source commit: `17f1a5c490e196959a8abff5ea01b0a59b28c49c`, clean relevant working tree. The full downloaded Graph plan and independent source/current RPC evidence are embedded in each manifest.

| Case/report | Graph block | Fork block | Journal operations | Eligible LP surplus (USDC, before wallet gas) | Consolidated group result (USDC) |
| --- | --- | --- | --- | --- | --- |
| [1 ETH collateral, 2 rounds](integrated-eth/report.md) | 504601337 | 504601358 | 46 | 0 | -0.273826 |
| [2,500 USDC collateral, 2 rounds](integrated-usdc/report.md) | 504601498 | 504601516 | 46 | 0 | -0.101562 |
| [2,500 USDC collateral, 10 rounds](integrated-usdc-turnover/report.md) | 504602154 | 504602174 | 62 | 0.035625 | -0.113160 |

The first two cases exercise loss carry without distributing nonexistent surplus. The third exercises the positive allocation branch: 0.017812 USDC amortizes principal and 0.017813 USDC increases next-cycle capital. Total cycle repayment also includes interest. A positive LP allocation does not make the consolidated group profitable.

All cases end with zero debt, no stranded WETH/USDC and revoked Aqua allowances. Each round contains one fill in each direction by a related fixture taker. The script's 24-hour local time jump tests Aave accrual against retained fork prices; it does not replay a day of market activity. The ten-round case deliberately varies synthetic taker activity, not observed customer demand. The earlier standalone and new integrated cases use different budgets, ranges and fees and should not be ranked as a performance comparison.

[Summary JSON](integration-summary.json) provides exact integer accounting values. Open any directory's report.html for expandable operation details, or extract receipts.tar.gz to inspect raw calldata, receipts, logs and call traces. SHA256SUMS checks the exact archived bytes.

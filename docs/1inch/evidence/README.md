# Curated official-contract fork evidence

Both runs execute unchanged official protocol bytecode on isolated Arbitrum forks. Fixture funds and access credentials are synthetic and explicitly recorded; related takers are not independent customers. These reports prove execution and accounting, not market demand or expected profitability.

| Collateral/report | Source block | Journal operations | Eligible LP surplus (USDC, before wallet gas) | Consolidated strategy group result (USDC) |
| --- | --- | --- | --- | --- |
| [ETH](eth/report.md) | 504589079 | 46 | 5.894270 | -11.015355 |
| [USDC](usdc/report.md) | 504589302 | 46 | 7.651726 | -7.070730 |

Each directory contains a standalone `report.html`, a portable `report.md`, the exact `manifest.json` and `operations.jsonl`, plus `receipts.tar.gz` containing transaction calldata, receipts, raw logs and call traces. Verify file integrity with `shasum -a 256 -c SHA256SUMS` from that directory. The manifest identifies the tested source commit and whether the execution module had uncommitted files at capture time.

To inspect raw evidence, extract `receipts.tar.gz` into a new directory. Local transaction hashes have no public explorer links. To repeat the execution, use the script in [the rehearsal guide](../rehearsal.md), setting the recorded source block with an archive-capable RPC, or select a new block and capture a new independently identified run.

The positive LP surplus partly reflects fees paid by the related taker. The consolidated group result remains negative. No self-trade is counted as organic yield.

# Reproduce the Aqua demo

Requirements: Node 22+, Corepack/pnpm, Foundry with Solidity 0.8.30 and an Arbitrum RPC that retains the selected state. Run from the repository root:

```sh
cd integrations/aqua
pnpm install --frozen-lockfile
pnpm check
pnpm contracts:test
pnpm fork:rehearse
```

The runner starts its own Anvil on a free loopback port, verifies its fork metadata and chain ID, and shuts it down afterward. It never attaches to an existing wallet RPC and never broadcasts to the upstream. The upstream is used only to read fork state.

ETH is the default collateral. To test USDC collateral:

```sh
NORIA_FUNDING_ASSET=USDC NORIA_COLLATERAL_UNITS=20000000000 pnpm fork:rehearse
```

To impersonate your own public wallet addresses locally, set `NORIA_OWNER` and `NORIA_TAKER`. They must be different valid addresses. No private keys are required. Fixture native balances are reset on the local fork, fixture USDC is minted through the official token's actual minter functions, WETH is wrapped through the official contract and a test taker access credential is minted through the real NFT contract using local admin impersonation. The journal identifies these actions. No assets are removed from Aave or the reference Uniswap pool to fund the fixture.

A source block is resolved and fixed before startup. Set `NORIA_FORK_BLOCK` to replay an existing report's block; the upstream must retain its complete historical state. Public RPCs may prune it. Changing the block produces a new run, with its own block hash and results, rather than pretending to reproduce old evidence.

## What is demonstrated

- Supply WETH or USDC to official Aave and borrow USDC under the requested HF policy.
- Convert inventory through the canonical Uniswap router with explicit minimum output.
- Ship a concentrated-liquidity program through official Aqua, using official SwapVM bytecode.
- Reject an uncredentialed taker, then demonstrate real token transfers in both swap directions after a local credential fixture.
- Advance local time and observe actual Aave interest accrual.
- Dock, reject keeper profit authorization and checkpoint replay, then confirm provenance as owner.
- Realize inventory, apply interest/loss/surplus allocation and open another cycle without reborrowing.
- Defend, realize residual inventory, explicitly classify any owner loss coverage and exit only after debt is zero.

The fork's reference range is an explicit fixture. The application integration separately tests automatic selection from the Graph module. This separation allows judges to reproduce official execution independently of Graph credentials or a live indexer's availability.

## Reports and accounting

Each run writes `runs/<run-id>/`:

| File                   | Contents                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `manifest.json`        | Chain/block identity, SDK versions, code hashes, financing inputs, order, assertions and financial reconciliation              |
| `operations.jsonl`     | Ordered fixtures and transactions, inputs, status, gas, before/after wallets, debt, collateral, LP balances and decoded events |
| Transaction JSON files | Actual calldata, receipts, raw logs and call traces                                                                            |
| `report.md`            | Portable operation table and financial results                                                                                 |
| `report.html`          | Standalone expandable operation report                                                                                         |

Transaction hashes belong to the local fork and deliberately have no public explorer links. An expected failed transaction is included with its receipt, gas expense and unchanged token balances. A partial or failed rehearsal still produces a report with the stopping reason.

Use `pnpm report runs/<run-id>` to regenerate the readable summaries from saved receipts and the unchanged operation journal.

The economic baseline starts after synthetic funding and deployment and before the Aave position is opened. Owner, maker account, related taker and keeper are consolidated at the same reference price recorded just after the initial inventory conversion. Transfers within that group cancel; taker fees paid to its own maker are not outside revenue. Native wallet equity already includes execution gas, so it is not deducted again. Collateral yield and USDC borrowing interest are reported separately. Local EVM gas does not estimate Arbitrum's full L1 data fee.

One fill round consists of a USDC-to-WETH fill and a WETH-to-USDC fill. `NORIA_FILL_ROUNDS` can vary related-taker activity to exercise the allocation branches. It is not an assumed demand forecast. A positive maker surplus can coexist with a negative consolidated group result.

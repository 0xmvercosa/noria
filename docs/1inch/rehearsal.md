# Reproduce the Aqua demo

Requirements: Node 22+, Foundry with Solidity 0.8.30 and an Arbitrum RPC that retains the selected state. For the integrated app, run from the repository root:

```sh
npm ci
npm --prefix integrations/aqua run check
npm --prefix integrations/aqua run contracts:test
npm --prefix integrations/aqua run fork:rehearse
```

The runner starts its own Anvil on a free loopback port, verifies its fork metadata and chain ID, and shuts it down afterward. It never attaches to an existing wallet RPC and never broadcasts to the upstream. The upstream is used only to read fork state.

ETH is the default collateral. To test USDC collateral:

```sh
NORIA_FUNDING_ASSET=USDC NORIA_COLLATERAL_UNITS=20000000000 \
  npm --prefix integrations/aqua run fork:rehearse
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

Without a downloaded plan, the reference range and opening inventory are explicit fixtures. This mode reproduces official execution independently of Graph availability. With `NORIA_PLAN_FILE`, the runner uses the actual position plan's selected range, fee and asymmetric inventory. It checks the embedded Graph/envelope consistency, canonical source block, fresh financing, current price and actual prepared inventory. Unsigned JSON cannot authenticate provider authorship.

For the integrated path, open `/aqua`, enter collateral and health limits and download an unexpired plan. Then, from the repository root:

```sh
NORIA_PLAN_FILE=/absolute/path/to/position-plan.json \
  npm --prefix integrations/aqua run fork:rehearse
```

Alternatively, configure the public Privy App ID and enable `NORIA_ENABLE_LOCAL_FORK=1` on the loopback app. Create/open the Privy embedded wallet and request the rehearsal in the UI. The API uses that public address for local impersonation and provides the resulting report, including a partial report if execution stops. No signing or upstream mutation occurs.

A standalone checkout can use `pnpm install --frozen-lockfile` inside the module instead of root `npm ci`. Avoid mixing the two dependency installations in one tree.

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

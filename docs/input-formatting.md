# Financial input formatting

The same input components serve discovery, Privy funding/savings/transfers and the Aqua position lifecycle. Formatting is presentation, not transaction authorization; the existing amount, balance, checksum, health-factor and protocol checks still determine whether an action is allowed.

| Field                                            | Accepted precision                               |
| ------------------------------------------------ | ------------------------------------------------ |
| EUR onramp amount                                | 2 decimals                                       |
| USDC collateral, reserve, transfer and repayment | 6 decimals                                       |
| ETH collateral/transfer and WETH unwrap          | 18 decimals                                      |
| Safety and comfortable health factors            | 18 decimals; existing ordering and bounds remain |
| Entry discount                                   | Whole basis points, 25–1,000                     |

## Amounts

- At rest, `1234.567890` displays as `1,234.567890`. On focus, grouping disappears for normal selection, deletion and insertion. No rounding, truncation, automatic clamping or floating-point conversion is used by the formatting layer.
- Canonical values use a decimal point. A comma typed on a decimal keyboard is converted to a point. Pasting `12,50`, `1,234.56` or `1.234,56` is also supported.
- A pasted single comma followed by three digits, such as `1,234`, is ambiguous and remains invalid. Enter `1234` for a whole amount, `1.234` for a fractional amount, or `1,234.00` for explicitly grouped input. A canonical `1.234` is never reinterpreted as a thousand, even when it exceeds EUR precision.
- Invalid signs, exponents, malformed separators and excess decimals remain visible and block the action. Changing ETH to USDC preserves an existing eighteen-decimal input and marks it invalid instead of rounding it.
- Clipboard insertion applies to the selected text before normalization. For example, pasting `000001` after `1.` produces exactly `1.000001`.
- Grouping is interpreted only for a complete pasted/replaced value. Typing multiple decimal separators or pasting digits into an already malformed decimal never converts it into a different valid whole amount.
- Every edit still clears the corresponding plan or prepared transaction. Review and confirmation use canonical strings converted by the existing exact-unit parsers.

## Addresses, hashes and other controls

Addresses and transaction hashes retain every character and their original case; only outer whitespace is trimmed. Invalid checksums and excessive length remain visible and cannot become a different valid recipient through masking. Autocorrection, capitalization and spelling assistance are disabled. Existing schemas validate addresses and receipt hashes before requests.

Pool search remains free text for symbols, pairs and addresses. Selects, the basis-point slider and acknowledgment checkboxes retain their native controls.

## Reviewer source map

- [Shared inputs](../src/components/FinancialInput.tsx): controlled state, selection/paste handling and accessible field guidance.
- [String formatting](../src/components/input-format.ts): lossless decimal normalization and grouping.
- Call sites: [discovery](../src/components/WorkspaceControls.tsx), [Privy flow](../src/components/ReserveWorkbench.tsx), [Aqua planning](../src/components/AquaWorkbench.tsx) and [Aqua launch/exit](../src/components/AquaLaunchWorkbench.tsx).
- [Unit tests](../tests/unit/input-format.test.ts): exact units, precision, ambiguous input and identifier preservation.
- [Browser regressions](../tests/browser/input-masks.spec.ts): selection, partial paste, deletion, locale keyboard, asset changes, recipients, slider synchronization and mobile layout. [Aqua request tests](../tests/browser/aqua.spec.ts) check exact raw units after formatted input.

These tests exercise formatting and validation. They do not sign transactions, fund wallets or establish live financial execution.

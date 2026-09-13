# Noria Aqua local-fork rehearsal

Status: PASSED. Fork block: 504601358. Funding: ETH.

Official Aqua, SwapVM and Aave bytecode are preserved. Fixture funding, credential issuance and time travel occur only on an isolated local fork. Related taker fees are not organic demand or group profit. Local transaction hashes have no public explorer links.

## Operations

| # | Kind | Operation | Status | Local transaction hash |
|---|---|---|---|---|
| 1 | fixture | Local native gas fixture | local fixture | n/a |
| 2 | fixture | Local wallet impersonation | local fixture | n/a |
| 3 | fixture | Local native gas fixture | local fixture | n/a |
| 4 | fixture | Local wallet impersonation | local fixture | n/a |
| 5 | fixture | Local native gas fixture | local fixture | n/a |
| 6 | fixture | Local wallet impersonation | local fixture | n/a |
| 7 | fixture | Local minter gas | local fixture | n/a |
| 8 | fixture | Local official minter impersonation | local fixture | n/a |
| 9 | transaction | Fixture: authorize USDC minting (local only) | success | 0x7a0997907cb4efb18fedf18c79d3ee866ad873d9586dcd8c6aece74b016f0268 |
| 10 | transaction | Fixture: mint owner USDC (external capital) | success | 0x0de044b0167af803af63d63b3906bc73a2ec84d2176f48131b242338e1a6e015 |
| 11 | transaction | Fixture: mint related taker USDC (external capital) | success | 0x1bed4a810239bc7063d501623fec0f7bea94a924474cf004877cbf4d57f8a9ac |
| 12 | transaction | Wrap owner fixture ETH into official WETH | success | 0xf2317ff837b1a5ec6b02c0beca5e8307f9900498d443680c3983c1184c2b5f43 |
| 13 | transaction | Wrap taker fixture ETH into official WETH | success | 0xfde8b1663058e29c73437ec61263944f892d87f3046e6d41dc44cd0d73e09144 |
| 14 | deployment | Deploy fixed inventory adapter | success | 0xa9b4bf6c55b88f02da30d51f1753c5b152632c921e4978ca874aed3adebed359 |
| 15 | deployment | Deploy owner position account | success | 0x3f5b0145f39dea5e0e0731ba39ff8bcc58754ad56583740e793b1e6906470171 |
| 16 | transaction | Approve initial collateral | success | 0x926776fec75af8fdf7955d94cf43caf5600d2029742453a7517fc26accb879f0 |
| 17 | transaction | Supply collateral and borrow USDC on official Aave | success | 0x660cf415beee0becfdc0e63c11e33819463ff05a1b6fc6e43960635b03058cdc |
| 18 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xf85d9a0f0cc1529e98cdb6826d3e8e7c99dd8fcb5fdd6fe97bfa0e5c4710cf62 |
| 19 | transaction | Ship concentrated liquidity on official Aqua | success | 0xcf882de135e0ce755f331e8184bf082cbe1b4dab59a6518b9876cc2960fa55d4 |
| 20 | transaction | Taker approves official SwapVM for USDC | success | 0xa252d94579c17a23ee3ee55b104f92d17c47b7bab2882b7cf3d05142cec2104c |
| 21 | transaction | Taker approves official SwapVM for WETH | success | 0xebf8967459e34815a882d0b4609ca92f743c749d7e9e9cdc51370a77afcb3405 |
| 22 | transaction | Reject taker without the official access credential | reverted | 0x559d0e3b56dae2e514fc9b9d8cdeebf4686911ab6358e723b1f9673c18bbf035 |
| 23 | fixture | Local credential admin gas | local fixture | n/a |
| 24 | fixture | Local credential admin impersonation | local fixture | n/a |
| 25 | transaction | Fixture: issue official credential on local fork only | success | 0x1f05be8c215e77ee1200051787c58eae058ed013ec84b19cdc5d954cdb240d5e |
| 26 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x0aded48a16e6a89e400bffd515a4a87703c25527b89695c5517b4a2865064aab |
| 27 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xde7fdbdd2fc86de08bab11ce819aa340bdde135264a450192d530c64160499ee |
| 28 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x5377f2e35e48cfc353b2b424e3ea983901ab7a5b40a674ba3dcba8008b1143c2 |
| 29 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xf343531a86a15961494789e4abbe6bd647e27edb35b4ce58b4f923ab3b612dc3 |
| 30 | fixture | Advance local time to accrue real Aave interest | local fixture | n/a |
| 31 | fixture | Mine accrued-interest block | local fixture | n/a |
| 32 | transaction | Dock cycle before settlement | success | 0x09f589ca263c25e2a15f3ee81684add4a0347611465a9c7b77acdeb05eeae12d |
| 33 | transaction | Reject keeper profit authorization | reverted | 0xa40c522d55075e912a71e397c942eaceda8c6f055de847afd44b3dcf9374ebf6 |
| 34 | transaction | Approve related-taker external debt support | success | 0x6ceac318f235ad86f64ba0fbdf417b856f1abc325f1c43bc33e16dbaa4e252d1 |
| 35 | transaction | External debt repayment is capital support, not LP revenue | success | 0xf8fa39578c3d46a9d1056b3874d9e78972fe5d5c69fb8aa7920ac30cea243ab6 |
| 36 | transaction | Reject unclassified external scaled-debt movement | reverted | 0x3fb1b248bb48d3c0e90cf3cce8d60c90ecaf1484379efa2d79f7879530afc13c |
| 37 | transaction | Reconcile outside debt burn while preserving accrued interest | success | 0xd9a0def170b0238d8913740d49070b2ec07052c82f50f3a439af46e5d7d46d83 |
| 38 | transaction | Owner confirms inventory provenance, including related takers | success | 0x8cb912ea988c929e9757645f8fde4ed5195c40ef78069943951819859ab3041a |
| 39 | transaction | Reject checkpoint replay | reverted | 0x9d073329bd0d405cdbcbc596b54d0c85a732c7f980064a447bc13c3e14a0578b |
| 40 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x5f9d8c655776977ada9c483a11a55173a880d36273330c368a054639462cc7ac |
| 41 | transaction | Repay interest and split eligible closed-cycle surplus | success | 0x87ae3a5031484e57c7b5b46b3ff4307444c35cac4c8f7d7ed9aad9dc3e4776bc |
| 42 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xc0432a10718f2153b492b1fbe61640582101e16db37219a63d2b0865dcb6ed12 |
| 43 | transaction | Ship subsequent cycle without reborrowing | success | 0x5903d95ee2fac2d8f786b6783df57a7716fb8c7d685133c78aa8c6e7d7bfaa22 |
| 44 | transaction | Owner-triggered terminal defense, independent of profit attestations | success | 0x3b0b7a7b6b77b38b0e3c25ed105ab82ec20eed7a62f19df0846a77f6af1dc4fa |
| 45 | transaction | Realize defensive WETH and repay debt | success | 0x202cac505f2925cbefbe6df984747beb4df9aa0acba179e0b1d23393b6bda497 |
| 46 | transaction | Return collateral and residual assets after debt is zero | success | 0x9fb23ea7d1f6005113ac21144058afb855f0373ae406870ffd351c6f8cdfd56c |

## Economic reconciliation

```json
{
  "valuation": "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
  "referenceBlock": {
    "number": "504601368",
    "hash": "0x36e7419b77af88c7e8ca7628824719e6a2bf94207e1f6226bea53f3c4616e253",
    "timestamp": "1789268683"
  },
  "actors": [
    {
      "address": "0x00000000000000000000000000000000000a11ce",
      "initialEquityUSDCUnits": "405039340175",
      "finalEquityUSDCUnits": "405040123018",
      "changeUSDCUnits": "782843"
    },
    {
      "address": "0x0000000000000000000000000000000000000b0b",
      "initialEquityUSDCUnits": "352098711499",
      "finalEquityUSDCUnits": "352097655414",
      "changeUSDCUnits": "-1056085"
    },
    {
      "address": "0x000000000000000000000000000000000000c0de",
      "initialEquityUSDCUnits": "252098713000",
      "finalEquityUSDCUnits": "252098712416",
      "changeUSDCUnits": "-584"
    },
    {
      "address": "0x0c7f7040bbfc098538ff17e05c1863f213d11978",
      "initialEquityUSDCUnits": "0",
      "finalEquityUSDCUnits": "0",
      "changeUSDCUnits": "0"
    }
  ],
  "relatedPartyGroupNetUSDCUnits": "-273826",
  "unrelatedExistingAaveAccrualUSDCUnits": "0",
  "strategyGroupNetUSDCUnits": "-273826",
  "totalAaveRepaidUSDCUnits": "1053767981",
  "totalBorrowInterestUSDCUnits": "107092",
  "collateralYieldUnits": "25527831683563",
  "collateralYieldAsset": "ETH",
  "collateralYieldSource": "Closed.collateralReturned at actual withdrawal",
  "organicDemandProven": false,
  "gasCaveat": "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast."
}
```

## Evidence

See manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.

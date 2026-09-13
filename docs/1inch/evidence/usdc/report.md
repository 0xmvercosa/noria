# Noria Aqua local-fork rehearsal

Status: PASSED. Fork block: 504589302. Funding: USDC.

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
| 9 | transaction | Fixture: authorize USDC minting (local only) | success | 0xa8c38315841afc5810d496903ca7436ccb231479cc47ebddba90f7ff90fd5542 |
| 10 | transaction | Fixture: mint owner USDC (external capital) | success | 0xff9200eb0cc82f7bdfdfa2bb5e2e65c9dda120861d73012e57b7d4328126a492 |
| 11 | transaction | Fixture: mint related taker USDC (external capital) | success | 0x48613b1143b810e2be6da524cbcb74278f777c3fa0d2f05aded911c419ef02bf |
| 12 | transaction | Wrap owner fixture ETH into official WETH | success | 0x2f3e94275be88bf3d5c2a241710418a74344a91d643ebaae8002b1daceadb25f |
| 13 | transaction | Wrap taker fixture ETH into official WETH | success | 0xd20b707a245a21ef59719d5f8099be7c02ddb4192af7cec308085b6a7f77b9eb |
| 14 | deployment | Deploy fixed inventory adapter | success | 0x0bb7dd52abf48cc362b0aae577ad71b42b2ce4bbde6978c76edd7dc5a727c87f |
| 15 | deployment | Deploy owner position account | success | 0x3f3d2af343447e69d59edc775df5db414558ecef8b9b86b5a99ba9a192be9002 |
| 16 | transaction | Approve initial collateral | success | 0x019a52b5e19ae76b7bf9c5f7eeaef9e744995be0abc7ab6f33489acb376a8439 |
| 17 | transaction | Supply collateral and borrow USDC on official Aave | success | 0xfc0a0bb1ae2134481cc88ae2a6ca1e5c6353c94b2911aadae183cceeb201897e |
| 18 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x6a5ff2123a612d0caa746cc0164127f580e409d1b7be604a47cf704946b77885 |
| 19 | transaction | Ship concentrated liquidity on official Aqua | success | 0xf8a61b631e29fa0d27d090f74eadc93f0e3107db2bc2fd1eb20eef9b722c9a1e |
| 20 | transaction | Taker approves official SwapVM for USDC | success | 0xbdf25d20af0ab37338c17a17a62140f901337a149c6a1dda92fcaf4d0b218d13 |
| 21 | transaction | Taker approves official SwapVM for WETH | success | 0xa8e5278590db9460b0225e66b30f51234759eb7dc1a20cd262bb36a4a7df7a94 |
| 22 | transaction | Reject taker without the official access credential | reverted | 0x82f5d4f091766354aaa1939176cb92e593c29a43b0ab96029dea47027ba968e0 |
| 23 | fixture | Local credential admin gas | local fixture | n/a |
| 24 | fixture | Local credential admin impersonation | local fixture | n/a |
| 25 | transaction | Fixture: issue official credential on local fork only | success | 0x6cf71e26fe8f42d96624b4fb98e2128c5b5c51ba610bf1b7d173dafe6bbde434 |
| 26 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xfcfaf54374d10180ca48a53d64c60280ebaa3a98a5c48100e8236e36c8decf75 |
| 27 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x599adae1646bc703c7977cdfc34e9fac58ebf7902142b76bc1d955ff07e54c12 |
| 28 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xf043ffb54c1a931a9ace64c8ee5f1b9ec48cb033e486cfb91cfa465e7155b99a |
| 29 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x6180756685b6534ea624c683959c98d9deadbab89c32e67b12bdee933a47c352 |
| 30 | fixture | Advance local time to accrue real Aave interest | local fixture | n/a |
| 31 | fixture | Mine accrued-interest block | local fixture | n/a |
| 32 | transaction | Dock cycle before settlement | success | 0xba8bb5d3502b2ae13cf7d5d89d3b3b9b79b7b3c188cda176d1cadfa0b1e53d76 |
| 33 | transaction | Reject keeper profit authorization | reverted | 0xcf69fca460d206bd45194fa56c4c443ab3ad4ea9d61a80ab1eb9a7f2fa014203 |
| 34 | transaction | Approve related-taker external debt support | success | 0x24670fcb263f2c6d49fafabfb326b5fce4804eb33b6aeb96c08f2ccde4399055 |
| 35 | transaction | External debt repayment is capital support, not LP revenue | success | 0x7a169e25818dbd71eae9d05cdea99b380fac36a573c0c2a07b86022963518100 |
| 36 | transaction | Reject unclassified external scaled-debt movement | reverted | 0x8bcf4e40322dda429cf81a5615725584541219979bd157ef44889904bc741348 |
| 37 | transaction | Reconcile outside debt burn while preserving accrued interest | success | 0x9d1945add7fe1da19cecaf293452082ef1df8b6da56fddfaa035df438529ed74 |
| 38 | transaction | Owner confirms inventory provenance, including related takers | success | 0x434d39fbacc675e76821fe722b7d779af85712cfec6e8a9b2c7fdd88873935e5 |
| 39 | transaction | Reject checkpoint replay | reverted | 0x8dbcc6f99526191934026854468908b8c3569941a13d83b7ddeb19521e2d9f9d |
| 40 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x51de3cc3a3b14f4ef7a9dbeafa043f4f330964f1ec987380166c53c77ffd2b4d |
| 41 | transaction | Repay interest and split eligible closed-cycle surplus | success | 0x03b8381408fd3ac9493f23e6960b9f4074bdc595cb27498df951252d6b7ed179 |
| 42 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xf736dfdf0de152073307b42a5a2e81abc3ba60d8948fd0a79dca92b93e1b7d54 |
| 43 | transaction | Ship subsequent cycle without reborrowing | success | 0x3fca8515cbb9fcb76f44299afca92276486bd579b16754312c022e8dbe39a439 |
| 44 | transaction | Owner-triggered terminal defense, independent of profit attestations | success | 0xca66ab62a850f688ccc8d82049d901695afd6fe328bb9c05385fd2e39f3d904a |
| 45 | transaction | Realize defensive WETH and repay debt | success | 0x303159c3554ac5b3fea2779e7f5325f8684656f5349698479d4d7c0ce7bf2503 |
| 46 | transaction | Return collateral and residual assets after debt is zero | success | 0x2dc6e4fa5c0574f41ca37854cd200ddee1c702ae8b9729fa825fb5e71b598ac9 |

## Economic reconciliation

```json
{
  "valuation": "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
  "referenceBlock": {
    "number": "504589312",
    "hash": "0x3947dd839f99a1e8d6f4f42e8ed91c55db98a3b2ddbd9476678da3347e0faf5c",
    "timestamp": "1789265579"
  },
  "actors": [
    {
      "address": "0x00000000000000000000000000000000000a11ce",
      "initialEquityUSDCUnits": "352395396110",
      "finalEquityUSDCUnits": "352401672863",
      "changeUSDCUnits": "6276753"
    },
    {
      "address": "0x0000000000000000000000000000000000000b0b",
      "initialEquityUSDCUnits": "352395497596",
      "finalEquityUSDCUnits": "352382150699",
      "changeUSDCUnits": "-13346897"
    },
    {
      "address": "0x000000000000000000000000000000000000c0de",
      "initialEquityUSDCUnits": "252395499100",
      "finalEquityUSDCUnits": "252395498514",
      "changeUSDCUnits": "-586"
    },
    {
      "address": "0x0c7f7040bbfc098538ff17e05c1863f213d11978",
      "initialEquityUSDCUnits": "0",
      "finalEquityUSDCUnits": "0",
      "changeUSDCUnits": "0"
    }
  ],
  "relatedPartyGroupNetUSDCUnits": "-7070730",
  "unrelatedExistingAaveAccrualUSDCUnits": "0",
  "strategyGroupNetUSDCUnits": "-7070730",
  "totalAaveRepaidUSDCUnits": "7761788611",
  "totalBorrowInterestUSDCUnits": "788611",
  "collateralYieldUnits": "1525853",
  "collateralYieldAsset": "USDC",
  "collateralYieldSource": "Closed.collateralReturned at actual withdrawal",
  "organicDemandProven": false,
  "gasCaveat": "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast."
}
```

## Evidence

See manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.

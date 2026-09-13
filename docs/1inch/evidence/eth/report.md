# Noria Aqua local-fork rehearsal

Status: PASSED. Fork block: 504589079. Funding: ETH.

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
| 15 | deployment | Deploy owner position account | success | 0x79253890ac09ffa2642d161f37eff8da5b1a3de7c35143676b1dd6c07c0521af |
| 16 | transaction | Approve initial collateral | success | 0x7d64513424265421728124b1d3137026ecd0b8e7eb300eb9f0ed460dffdad619 |
| 17 | transaction | Supply collateral and borrow USDC on official Aave | success | 0x8fc8fa0ebe3151cd908f7ddd6f86f3fdecf7a1ee9871d8fff919775f89949429 |
| 18 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xb520c7512930f8424fe29dc57be91fd68420541a1e0c60ee327b4ea853482088 |
| 19 | transaction | Ship concentrated liquidity on official Aqua | success | 0x6c8ed6bfc52b90343bc1b2962ad59a82f752f473983c1357215edfe0e4cd379d |
| 20 | transaction | Taker approves official SwapVM for USDC | success | 0xbdf25d20af0ab37338c17a17a62140f901337a149c6a1dda92fcaf4d0b218d13 |
| 21 | transaction | Taker approves official SwapVM for WETH | success | 0xa8e5278590db9460b0225e66b30f51234759eb7dc1a20cd262bb36a4a7df7a94 |
| 22 | transaction | Reject taker without the official access credential | reverted | 0x23c4a22b1bd167026110b57b5eee404bf7a3a2ec3f841421f006b90a28a3ffcc |
| 23 | fixture | Local credential admin gas | local fixture | n/a |
| 24 | fixture | Local credential admin impersonation | local fixture | n/a |
| 25 | transaction | Fixture: issue official credential on local fork only | success | 0x6cf71e26fe8f42d96624b4fb98e2128c5b5c51ba610bf1b7d173dafe6bbde434 |
| 26 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x76693ccc3387c7bcb743f3b1853a27eb51423bf168d0875c4891ded21ed13d19 |
| 27 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x2785a3bbcb6a0494ef0164c81a2fe1ae710bbd160207621995e86b56439a1dc5 |
| 28 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x82a88117c2653e866d28a7bb6b687ffc479422678d0c9941711a0edb3e63b711 |
| 29 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x56ce6c1857e5ac0cf491ab2a579c5b3e451221f204cdba87be984afe419939f8 |
| 30 | fixture | Advance local time to accrue real Aave interest | local fixture | n/a |
| 31 | fixture | Mine accrued-interest block | local fixture | n/a |
| 32 | transaction | Dock cycle before settlement | success | 0xba8bb5d3502b2ae13cf7d5d89d3b3b9b79b7b3c188cda176d1cadfa0b1e53d76 |
| 33 | transaction | Reject keeper profit authorization | reverted | 0x521d51f1255123cd79ce6a37fa0ee2f786acb01960c2c7fe6e798f65375856f8 |
| 34 | transaction | Approve related-taker external debt support | success | 0x24670fcb263f2c6d49fafabfb326b5fce4804eb33b6aeb96c08f2ccde4399055 |
| 35 | transaction | External debt repayment is capital support, not LP revenue | success | 0x7a169e25818dbd71eae9d05cdea99b380fac36a573c0c2a07b86022963518100 |
| 36 | transaction | Reject unclassified external scaled-debt movement | reverted | 0x2a3bac9b6472fb96ed446fcd59af35303519d55780d29e438260f19d572a9be3 |
| 37 | transaction | Reconcile outside debt burn while preserving accrued interest | success | 0x84618d1de6fd08d8cd643ce1a241f282f806fd461d943eefcd8b33ec25db2368 |
| 38 | transaction | Owner confirms inventory provenance, including related takers | success | 0x169e7af910b781435bd43680ba0362719d2639d8976ff370ad900a336a1ade46 |
| 39 | transaction | Reject checkpoint replay | reverted | 0x34801221207c2d50ea9ed3d28f27cd889e895bfd2f0c1c6228269118172fb40c |
| 40 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x24d289bcba1aed0b41931bed7b4c287a56e56604291f89c132a88e1e895ecc3d |
| 41 | transaction | Repay interest and split eligible closed-cycle surplus | success | 0x03b8381408fd3ac9493f23e6960b9f4074bdc595cb27498df951252d6b7ed179 |
| 42 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xf30ea59d579b66020aa6c2aabf44b3066508106d212fd8f609e9bd81aeca6207 |
| 43 | transaction | Ship subsequent cycle without reborrowing | success | 0xc8f72ecddb8ba277f250c634bc1027688a5b13b5ac91c159ebe7d49e2d1ff83b |
| 44 | transaction | Owner-triggered terminal defense, independent of profit attestations | success | 0xca66ab62a850f688ccc8d82049d901695afd6fe328bb9c05385fd2e39f3d904a |
| 45 | transaction | Realize defensive WETH and repay debt | success | 0xc03c5ba295ff5e7c44283672e2882c694631dd350415f1db65a9e8fc6426aac1 |
| 46 | transaction | Return collateral and residual assets after debt is zero | success | 0x2dc6e4fa5c0574f41ca37854cd200ddee1c702ae8b9729fa825fb5e71b598ac9 |

## Economic reconciliation

```json
{
  "valuation": "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
  "referenceBlock": {
    "number": "504589089",
    "hash": "0x1d9a89ed8e39198db5dd6ab7cd3eafb1fcebf9079f6b4da6a050ba6aae900388",
    "timestamp": "1789265529"
  },
  "actors": [
    {
      "address": "0x00000000000000000000000000000000000a11ce",
      "initialEquityUSDCUnits": "352399370647",
      "finalEquityUSDCUnits": "352401615423",
      "changeUSDCUnits": "2244776"
    },
    {
      "address": "0x0000000000000000000000000000000000000b0b",
      "initialEquityUSDCUnits": "352399472096",
      "finalEquityUSDCUnits": "352386212551",
      "changeUSDCUnits": "-13259545"
    },
    {
      "address": "0x000000000000000000000000000000000000c0de",
      "initialEquityUSDCUnits": "252399473600",
      "finalEquityUSDCUnits": "252399473014",
      "changeUSDCUnits": "-586"
    },
    {
      "address": "0x0c7f7040bbfc098538ff17e05c1863f213d11978",
      "initialEquityUSDCUnits": "0",
      "finalEquityUSDCUnits": "0",
      "changeUSDCUnits": "0"
    }
  ],
  "relatedPartyGroupNetUSDCUnits": "-11015355",
  "unrelatedExistingAaveAccrualUSDCUnits": "0",
  "strategyGroupNetUSDCUnits": "-11015355",
  "totalAaveRepaidUSDCUnits": "10546067139",
  "totalBorrowInterestUSDCUnits": "1071710",
  "collateralYieldUnits": "255238370532300",
  "collateralYieldAsset": "ETH",
  "collateralYieldSource": "Closed.collateralReturned at actual withdrawal",
  "organicDemandProven": false,
  "gasCaveat": "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast."
}
```

## Evidence

See manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.

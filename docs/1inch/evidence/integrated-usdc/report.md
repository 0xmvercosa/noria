# Noria Aqua local-fork rehearsal

Status: PASSED. Fork block: 504601516. Funding: USDC.

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
| 9 | transaction | Fixture: authorize USDC minting (local only) | success | 0x24066e81289810988c8c6a190c844046a577b75112541d631ea791284b62c0ba |
| 10 | transaction | Fixture: mint owner USDC (external capital) | success | 0x819ac3d7cb818a52b9cd09ae08aa15e6a40a650dc0556e504d39e4b3e3e7edb9 |
| 11 | transaction | Fixture: mint related taker USDC (external capital) | success | 0x6c06165a36f656dc74c699527258a88f42906c3160858a2692172a116bb9c4f4 |
| 12 | transaction | Wrap owner fixture ETH into official WETH | success | 0x57632ca368341822589350c56007cb87248d8ff648733a04afc930b03a53e5df |
| 13 | transaction | Wrap taker fixture ETH into official WETH | success | 0x522fcbec833a8082f96e53168bce9d8181d7e012cb58de5c964cea94ee1559f0 |
| 14 | deployment | Deploy fixed inventory adapter | success | 0x6c1bb181dee7bacb28256f5e751545c639b1d30ef7db6e8e65e240df70e4d815 |
| 15 | deployment | Deploy owner position account | success | 0x994900dd5b5407de83be72ca462ffec9c153163e9758362f49e25dba56202a43 |
| 16 | transaction | Approve initial collateral | success | 0x09a3bfa585b7f1d87a60f022e3b1e6bbf0904afd069a3b474210b47c6e2803f5 |
| 17 | transaction | Supply collateral and borrow USDC on official Aave | success | 0x179a4fb87b003914e94bf2d8506b22e0d3710dd7032ecf76da39e0cb25ead57b |
| 18 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xbd44b745b40ff50370d49d6d181473ace6e289c316e9621c994caea36ab9c55b |
| 19 | transaction | Ship concentrated liquidity on official Aqua | success | 0xd5ef352cdb21a084a8db4b62d170ece004ddfc215e2ea4084ff9e709876b7e95 |
| 20 | transaction | Taker approves official SwapVM for USDC | success | 0x665459af1c35e190d5bbd5adc28e1004a5598fa5b32a88c8ebfdfd7053739766 |
| 21 | transaction | Taker approves official SwapVM for WETH | success | 0x67220902c16683d08d1429c8b085b6385b00473a85c5ed32f671d154b63bae2c |
| 22 | transaction | Reject taker without the official access credential | reverted | 0xa68d3603561ba751457bbb455bb5ca7bf1560c9844678ce71b0f4ff0f1305fea |
| 23 | fixture | Local credential admin gas | local fixture | n/a |
| 24 | fixture | Local credential admin impersonation | local fixture | n/a |
| 25 | transaction | Fixture: issue official credential on local fork only | success | 0x74a87d34749d05e5ea1fe86b6df7a5d8d2c33af1ad4e2f06e935b8e5e4d61d0a |
| 26 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x1a1a0c7b887823509f36138b1ea841af98f40cb8c9103bed998616dc1b5cccd9 |
| 27 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x7ce02d2fe0ea578c0f7551c58ae903e75e847568f01d98d1fca3827c720fc349 |
| 28 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xed473c8d173104d94bc72800f60ccf54bea163aff0af2f8a06d649d7e93e4715 |
| 29 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x5404ce435fb6836db95a8ae543ae25bd89a005a8405bc1705a882a74b58f14e6 |
| 30 | fixture | Advance local time to accrue real Aave interest | local fixture | n/a |
| 31 | fixture | Mine accrued-interest block | local fixture | n/a |
| 32 | transaction | Dock cycle before settlement | success | 0xb135757055bfc728ac2372f1c483ef0a4347fb135d79040aec1b805eab1ff858 |
| 33 | transaction | Reject keeper profit authorization | reverted | 0x1d14b1c3bf960723822bd71f0a9cafdadd064d7048a3f6604f10337f7fa449df |
| 34 | transaction | Approve related-taker external debt support | success | 0xe499b6203ca87a71c15848b81cac5b9965ae712200ea23dc06ac5a7cd256122d |
| 35 | transaction | External debt repayment is capital support, not LP revenue | success | 0x7dc517b699453f77529515e895a11c581e4b6ee5d658007b77ded48517240190 |
| 36 | transaction | Reject unclassified external scaled-debt movement | reverted | 0x41808a18b7811337a00c822cc922b1173cc85fee75488343e6a408698271c6ee |
| 37 | transaction | Reconcile outside debt burn while preserving accrued interest | success | 0x21a0bd679ffe283223cfb887d37941ff72d35ecdd41b8af5ed2626e6d96476aa |
| 38 | transaction | Owner confirms inventory provenance, including related takers | success | 0xb1769eb51fb956531f517f230438ea2b002c57552b3d895ba4120514ff6b1638 |
| 39 | transaction | Reject checkpoint replay | reverted | 0xf8bbdbdc36c434030e533cb9a445713d0d3d9f9da5c043ca0b3c7e8f37c4168e |
| 40 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x99efaa7af7a394f0ccfd7746bb4f43359aa05bdd42166add6f47575280d038cb |
| 41 | transaction | Repay interest and split eligible closed-cycle surplus | success | 0x23caebee2048313dd11b77f80eb761ea0846502e5b1780d383e50014c097b21f |
| 42 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xd89d3aaaa4d93fe93e27aea1c1dd1229bedaf68d7dad48262627509de1a49b17 |
| 43 | transaction | Ship subsequent cycle without reborrowing | success | 0xd0c5413837c41dbdcf00f2da926d6622d3192e167c1552704771a27e2f06bb76 |
| 44 | transaction | Owner-triggered terminal defense, independent of profit attestations | success | 0x4b52d8435f1c1dc274ef8e663f312a4e6ad4fa01322f1ded52d56cbe88ee0e4f |
| 45 | transaction | Realize defensive WETH and repay debt | success | 0x5ba207aadfa34ab32fd5e14c6097684ddd67e2ac259df78c61beef293f44f5c0 |
| 46 | transaction | Return collateral and residual assets after debt is zero | success | 0x3382cd11b1b6ac429a188dc94ab63fa71aaa0ab367608f612c0b3a61bab2fc08 |

## Economic reconciliation

```json
{
  "valuation": "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
  "referenceBlock": {
    "number": "504601526",
    "hash": "0x618fefb8b05608d359ae44c03327972ae81e9b4679d186c3753a4724099b4a0e",
    "timestamp": "1789268723"
  },
  "actors": [
    {
      "address": "0x00000000000000000000000000000000000a11ce",
      "initialEquityUSDCUnits": "405099587871",
      "finalEquityUSDCUnits": "405100534075",
      "changeUSDCUnits": "946204"
    },
    {
      "address": "0x0000000000000000000000000000000000000b0b",
      "initialEquityUSDCUnits": "352166407200",
      "finalEquityUSDCUnits": "352165360018",
      "changeUSDCUnits": "-1047182"
    },
    {
      "address": "0x000000000000000000000000000000000000c0de",
      "initialEquityUSDCUnits": "252166408700",
      "finalEquityUSDCUnits": "252166408116",
      "changeUSDCUnits": "-584"
    },
    {
      "address": "0x0c7f7040bbfc098538ff17e05c1863f213d11978",
      "initialEquityUSDCUnits": "0",
      "finalEquityUSDCUnits": "0",
      "changeUSDCUnits": "0"
    }
  ],
  "relatedPartyGroupNetUSDCUnits": "-101562",
  "unrelatedExistingAaveAccrualUSDCUnits": "0",
  "strategyGroupNetUSDCUnits": "-101562",
  "totalAaveRepaidUSDCUnits": "970223598",
  "totalBorrowInterestUSDCUnits": "98598",
  "collateralYieldUnits": "190806",
  "collateralYieldAsset": "USDC",
  "collateralYieldSource": "Closed.collateralReturned at actual withdrawal",
  "organicDemandProven": false,
  "gasCaveat": "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast."
}
```

## Evidence

See manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.

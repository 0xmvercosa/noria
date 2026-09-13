# Noria Aqua local-fork rehearsal

Status: PASSED. Fork block: 504602174. Funding: USDC.

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
| 9 | transaction | Fixture: authorize USDC minting (local only) | success | 0xac6b6de4f201145d4c6b011a6f1db8a167f0bb9b795fec5526fbc2bf6d97750a |
| 10 | transaction | Fixture: mint owner USDC (external capital) | success | 0x8f9f5e7f2a48f1d010bdff320d4b679dcb2705d92849bb80209e1b106098b42e |
| 11 | transaction | Fixture: mint related taker USDC (external capital) | success | 0xd828aa908b761a85509e79e629c68fa2730c6ff5c80841c5889a11639bcfde3f |
| 12 | transaction | Wrap owner fixture ETH into official WETH | success | 0x501de4db36b878ab463fb7f5d175fafce59f5daf77509e1fb064eaf802372cca |
| 13 | transaction | Wrap taker fixture ETH into official WETH | success | 0x53a72a6c3dd565252e435502a186892874572032e6c0f0086c8aa7e4390ac457 |
| 14 | deployment | Deploy fixed inventory adapter | success | 0xb172a3eb95900a815aa573cc66c1416a6f0c4fde19c0a217fd220a7aa09069fb |
| 15 | deployment | Deploy owner position account | success | 0x5ecea34ea53a4f3c90437ebd03af65307d6220698730b0155a89a9ab62600fd0 |
| 16 | transaction | Approve initial collateral | success | 0xb0f1ccc8dff3ea9314bd73ee592f692afa9b1b789d61e289e52865c55e42210d |
| 17 | transaction | Supply collateral and borrow USDC on official Aave | success | 0x299c0d0aff3b74eb2097a80274a289963f5d9032eb9f0e5a148b3d3acb0f08b8 |
| 18 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xc6136a3f878443549fcc50530342461b379478c47098f68cc9c29d3609939166 |
| 19 | transaction | Ship concentrated liquidity on official Aqua | success | 0xedf054871c882a6ed797de805e2f08d02f6ddc3e61d0aab1c0b7e331a92fae19 |
| 20 | transaction | Taker approves official SwapVM for USDC | success | 0x83eb7b1ed215d1aca945e7ad5a1c97ff227b38a5e1fcd1c88bc8da981d7c54c3 |
| 21 | transaction | Taker approves official SwapVM for WETH | success | 0x6179465e9894caa178d32bdb8fc8e74a33926968cd4b90a32aad70429544e60b |
| 22 | transaction | Reject taker without the official access credential | reverted | 0x654fba423876908b44d41d93a1c60f07f1dfd4ab97afcbe006b1fbba70cc8f99 |
| 23 | fixture | Local credential admin gas | local fixture | n/a |
| 24 | fixture | Local credential admin impersonation | local fixture | n/a |
| 25 | transaction | Fixture: issue official credential on local fork only | success | 0xc861175f0321629cadcc9f2edbed43a6e8809055e3bb1278b65a5488005266e5 |
| 26 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x1b597f52c2bf028247782fb9f8c965ff5a58d63230cbca98a77e6707da79c16b |
| 27 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xd4b9f4c56b71c16e953c96f1781eacb12406d39e201f7763e99b236278494957 |
| 28 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x52bb877729cc54a35ec654b168c4739cfe2cec9f4d57a14600baa45710a7e7ef |
| 29 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x324f23e7d51bb06d08ca194a91899a85dd6c702c4696e44e6007d7faaa91e824 |
| 30 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x2fc2c2ec110602b821a4cf0345cb90a7d4f63d7aca2e359ee670960683b22cfa |
| 31 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x8e6e3176a93b41058337f5256bc35f59494ae1e9bd221461ef0368b5f9ee3d51 |
| 32 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xf850b807ae6b678086a22dcbd28a74672a559db248e0642f896c83fe417998a4 |
| 33 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xe1e52736d5b10be27854f9140979ac79b8248d300f8ee555d6b18d65882231e7 |
| 34 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xc21098be5f7724542050da949b880eaebb489f97c28c9089c7082e1b4a1ab772 |
| 35 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x45d06ac489bf18a3bcdcab8a7336fa7b332127aee228f7181ecce19709be65ab |
| 36 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xa3e3886d4eff030b98f06bc7dfc1c473aae318f622e85c25c022f74b5e89e77e |
| 37 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x1e665839ceb6bd514e30a60792f56230973b489e4456d7f00bbc85043e659fc3 |
| 38 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xc141d5b2aec8bbcf5f2c8f4dbae60edbc623f52ae47126662e1f881c994843c9 |
| 39 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x5ecce5ba977f214731939ed5c1f07ff86f020875f64664e10a0824a6f2ffe07f |
| 40 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0xd1733633d93fbc7c453d6aaa9b483cbf0465f8d279d8f5855b4bec57fb81af5a |
| 41 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xc77fa5db33a03122178a6a84d7ced516f023e119486327d4e26cae083d2d65f4 |
| 42 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x03206e5e6b9a0e141f830aec46519a6298dd5411f1f7c226fea861105137912c |
| 43 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0x8e9ff581e1f3752c12188f5834a9e17dbaaaf6a2073e972e569336e0f1e138b2 |
| 44 | transaction | Official SwapVM fill USDC to WETH (related taker) | success | 0x0cd47d232e1409555571646be7635dca720fcb96b68a9d9ff394c69096dc73c1 |
| 45 | transaction | Official SwapVM fill WETH to USDC (related taker) | success | 0xab932d66a48de3bf8e5334ab245fbed820a0169b9722c168543e93a4cb60b0ad |
| 46 | fixture | Advance local time to accrue real Aave interest | local fixture | n/a |
| 47 | fixture | Mine accrued-interest block | local fixture | n/a |
| 48 | transaction | Dock cycle before settlement | success | 0xd48908251edfee53ab098de16197e53622ecbb8c524516c0cd62264dbb962dfe |
| 49 | transaction | Reject keeper profit authorization | reverted | 0x9795103a4f0539617f022bd0390c4c3e2a27a7e6d7103561e8cb5395f0776fb5 |
| 50 | transaction | Approve related-taker external debt support | success | 0x8b9e148f4efa4643917a8df81e9f1d663b9096afb60b2258bae365ed587511d6 |
| 51 | transaction | External debt repayment is capital support, not LP revenue | success | 0xd351d8abf48b0e513d5f70385a761a147f0289a2544aa718ff7397c740e6cf77 |
| 52 | transaction | Reject unclassified external scaled-debt movement | reverted | 0xe401f900b937d238da4be656f3e3919f90372b52b51ebc0beaef3cc937c752b0 |
| 53 | transaction | Reconcile outside debt burn while preserving accrued interest | success | 0xdc445bc01f39ef06f5d194edc27bea5ea734ea82ba8655b77362c36df545efad |
| 54 | transaction | Owner confirms inventory provenance, including related takers | success | 0x17d685c8642edacee4f112fb495cf4530864906d3745b4178d4f8b11997df617 |
| 55 | transaction | Reject checkpoint replay | reverted | 0x8e4442a617b32c954c61c3715a32e90415270257756480802dc4de73c1ee90c5 |
| 56 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0xf4a1f7a5a9ff981c88520a546a3153e72c9bd6229154b15599e25a63a1e448a3 |
| 57 | transaction | Repay interest and split eligible closed-cycle surplus | success | 0x865567c4ef11bedaf09c717836a89bcd317666d8bc06a6d49eed0a60b259cae2 |
| 58 | transaction | Real inventory conversion (Uniswap; not an Aqua fill) | success | 0x35fc98d1afacc2b766f74240e864243d3c808fa91bc13eafe26c2c37f74ce7eb |
| 59 | transaction | Ship subsequent cycle without reborrowing | success | 0xfb162052824c9387b0313ea27d3ea98c94e24e2f9dd2d350cfa70c3933209610 |
| 60 | transaction | Owner-triggered terminal defense, independent of profit attestations | success | 0x6346b3b2b469d56ed645a4a702891e6ccc064513db3d1775ff4eebeba50ddca7 |
| 61 | transaction | Realize defensive WETH and repay debt | success | 0x2a51dc54f482ffb3e08e84ecf9277f20595a355f67dd79a61afae02670904d9d |
| 62 | transaction | Return collateral and residual assets after debt is zero | success | 0x6b8117d3ca89e79b7e168c3e46b0648557d393aa58dc1ed8ae2cd37b6bd4caa8 |

## Economic reconciliation

```json
{
  "valuation": "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
  "referenceBlock": {
    "number": "504602184",
    "hash": "0x1f9601f16e5f85989a265d0253171a5bbd01f218615cfb031124c1ff6c1e9aa2",
    "timestamp": "1789268891"
  },
  "actors": [
    {
      "address": "0x00000000000000000000000000000000000a11ce",
      "initialEquityUSDCUnits": "405056320504",
      "finalEquityUSDCUnits": "405057439787",
      "changeUSDCUnits": "1119283"
    },
    {
      "address": "0x0000000000000000000000000000000000000b0b",
      "initialEquityUSDCUnits": "352130351099",
      "finalEquityUSDCUnits": "352129118725",
      "changeUSDCUnits": "-1232374"
    },
    {
      "address": "0x000000000000000000000000000000000000c0de",
      "initialEquityUSDCUnits": "252130352600",
      "finalEquityUSDCUnits": "252130352531",
      "changeUSDCUnits": "-69"
    },
    {
      "address": "0x0c7f7040bbfc098538ff17e05c1863f213d11978",
      "initialEquityUSDCUnits": "0",
      "finalEquityUSDCUnits": "0",
      "changeUSDCUnits": "0"
    }
  ],
  "relatedPartyGroupNetUSDCUnits": "-113160",
  "unrelatedExistingAaveAccrualUSDCUnits": "0",
  "strategyGroupNetUSDCUnits": "-113160",
  "totalAaveRepaidUSDCUnits": "970223592",
  "totalBorrowInterestUSDCUnits": "98592",
  "collateralYieldUnits": "190782",
  "collateralYieldAsset": "USDC",
  "collateralYieldSource": "Closed.collateralReturned at actual withdrawal",
  "organicDemandProven": false,
  "gasCaveat": "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast."
}
```

## Evidence

See manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.

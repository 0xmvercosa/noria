# Graph ↔ Aqua integration contract v1

## Initiator and round trip

1. Aqua builds a `noria.aqua.discovery.v1` information request using its capital budget and explicit selection policy.
2. The Graph system discovers Uniswap v3 source pools on **Arbitrum only**, for **WETH/native USDC only**, and returns proposed ranges plus timestamps and provenance.
3. Aqua independently verifies canonical pool metadata and spot price by RPC. It applies its own constraints and ranks eligible candidates.
4. Aqua returns `noria.aqua.decision.v1`: selected candidate/range or explicit refusals, per-candidate assessments and remaining execution conditions.
5. After authorized execution, the operation journal/report provides actual transaction and position results. A plan is not a transaction approval.

**A source Uniswap pool is information, not the destination of the Aqua liquidity.** A new position is programmed in official SwapVM. Inventory conversions are identified separately.

## Files the other team can use

- `integrations/aqua/src/boundary.ts`: strict, versioned request/response schemas and TypeScript types.
- `integrations/aqua/src/discovery-client.ts`: optional POST client for the separate discovery service.
- `integrations/aqua/src/planner.ts`: pure decision function with separately supplied RPC evidence.
- `integrations/aqua/src/verifier.ts`: canonical Uniswap factory/pool checks at one explicit block.
- `integrations/aqua/examples/`: request, candidate bundle and **synthetic** verification fixture.

All monetary values are integer strings. USDC amounts and USDC-per-whole-WETH prices use six decimals; WETH amounts use eighteen. Wrapped ETH is the on-chain asset. USDC.e is not accepted.

## Candidate requirements

Each candidate includes source pool address/tokens/fee/liquidity, TVL and 24-hour volume in USDC units, current source price, proposed price bounds, observed in-range sample counts/window, The Graph deployment/query hash/indexed block and a live-versus-synthetic label.

The source service must not fabricate missing observation counts, query hashes or historical metrics. Return no candidate, or explain absence outside the strict candidate envelope. Never send calldata, keys or spending permissions.

Aqua's RPC evidence is obtained by Aqua, not trusted from candidate JSON. The verifier checks the pool's canonical factory mapping, token ordering, fee, liquidity and price. Indexed liquidity/TVL is still a capacity proxy, not a guarantee of executable size.

## Selection objective

Among eligible candidates, maximize:

```text
historical source-pool fee density
  = (24h source volume × source fee / source TVL)

score = historical fee density × observed proposed-range coverage
```

Use integer arithmetic. Ties use candidateId for deterministic reproduction. The result is the best candidate **under this declared historical objective and policy**, not a globally optimal pool/range or expected Aqua profit.

Reject stale/future snapshots, unsupported pairs, noncanonical pools, excessive source/canonical price divergence, malformed/out-of-spot/wide ranges, insufficient observed coverage and capital above the source-capacity limit. Do not silently loosen a constraint to select something.

## Response semantics

- `refused`: no eligible candidate; each candidate includes reason codes.
- `simulation_only`: the selected proposal or verification evidence is synthetic.
- `eligible_for_owner_review`: source checks passed; Aave health, account inventory, program quote/swap and owner authorization still remain.
- `routingStatus: not_validated`: direct local fills never prove inclusion in the 1inch aggregator.

The demo request clock is explicitly fixed. Production evaluation uses the real evaluation clock and rejects expired requests. Examples are never relabeled live.

## Final integration order

The Aqua module is built and tested independently first. The real adapter to the other Noria system is added **after that system has been pushed to Git**, so its existing request/response contracts can be reconciled without inventing its behavior. The versioned boundary above is the proposal for that handoff.


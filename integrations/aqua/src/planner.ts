import {
  CandidateBundleSchema, DiscoveryRequestSchema, USDC, WETH, CHAIN_ID,
  type CandidateAssessment, type CanonicalEvidence, type PlanDecision,
} from './boundary.js';

const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Choose the best ELIGIBLE evidence-backed candidate under the declared objective.
 * This ranks historical source-pool information, not expected Aqua volume or profit.
 * Canonical evidence is supplied by our RPC verifier, never trusted from the Graph bundle.
 */
export function planAquaPosition(
  rawRequest: unknown, rawBundle: unknown, evidence: readonly CanonicalEvidence[], now = new Date(),
): PlanDecision {
  const request = DiscoveryRequestSchema.parse(rawRequest);
  const bundle = CandidateBundleSchema.parse(rawBundle);
  if (bundle.requestId !== request.requestId) throw new Error('request_id_mismatch');
  if (Date.parse(request.expiresAt) <= now.getTime()) throw new Error('request_expired');
  if (Date.parse(request.createdAt) > now.getTime() + 60_000) throw new Error('request_from_future');
  if (Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) throw new Error('invalid_request_interval');
  const ids = bundle.candidates.map((c) => c.candidateId);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate_candidate_id');
  const assessments: CandidateAssessment[] = bundle.candidates.map((c) => {
    const reasons: string[] = [];
    const p = c.sourcePool;
    const v = evidence.find((x) => equal(x.pool, p.address));
    const age = (now.getTime() - Date.parse(c.source.indexedBlock.timestamp)) / 1000;
    if (age < -60 || age > request.policy.maxSourceAgeSeconds) reasons.push('stale_or_future_source');
    if (Date.parse(c.source.queriedAt) > now.getTime() + 60_000) reasons.push('query_from_future');
    if (!((equal(p.token0, WETH) && equal(p.token1, USDC)) || (equal(p.token1, WETH) && equal(p.token0, USDC)))) reasons.push('unsupported_pair');
    if (!v) reasons.push('canonical_rpc_evidence_missing');
    else {
      if (v.chainId !== CHAIN_ID || !v.canonicalFactoryPool || !equal(v.token0, p.token0) ||
          !equal(v.token1, p.token1) || v.feeTierPips !== p.feeTierPips) reasons.push('canonical_metadata_mismatch');
      if (BigInt(v.liquidity) === 0n) reasons.push('no_canonical_liquidity');
      if (BigInt(v.blockNumber) < BigInt(c.source.indexedBlock.number)) reasons.push('rpc_behind_indexer');
      const rpcAge = (now.getTime() - Date.parse(v.timestamp)) / 1000;
      if (rpcAge < -60 || rpcAge > request.policy.maxSourceAgeSeconds) reasons.push('stale_rpc_evidence');
      const sourcePrice = BigInt(p.spotUSDCPerWethE6);
      const canonicalPrice = BigInt(v.spotUSDCPerWethE6);
      const difference = sourcePrice > canonicalPrice ? sourcePrice - canonicalPrice : canonicalPrice - sourcePrice;
      if (canonicalPrice <= 0n || difference * 10000n > canonicalPrice * 100n) reasons.push('source_price_diverged_over_1pct');
    }
    const low = BigInt(c.range.lowerUSDCPerWethE6);
    const high = BigInt(c.range.upperUSDCPerWethE6);
    const spot = BigInt(v?.spotUSDCPerWethE6 ?? p.spotUSDCPerWethE6);
    if (!(low < spot && spot < high)) reasons.push('range_does_not_contain_spot');
    if (high <= low || (high - low) * 10000n > spot * BigInt(request.policy.maxRangeWidthBps)) reasons.push('invalid_or_excessive_range_width');
    if (c.range.inRangeObservations > c.range.totalObservations) reasons.push('invalid_range_observations');
    if (Date.parse(c.range.windowStart) >= Date.parse(c.range.windowEnd) ||
        Date.parse(c.range.windowEnd) > Date.parse(c.source.indexedBlock.timestamp)) reasons.push('invalid_observation_window');
    const coverageBps = Math.floor(c.range.inRangeObservations * 10000 / c.range.totalObservations);
    if (coverageBps < request.policy.minCoverageBps) reasons.push('insufficient_historical_coverage');
    if (BigInt(request.capitalUSDCUnits) * 10000n > BigInt(p.tvlUSDCUnits) * BigInt(request.policy.maxCapitalShareBps)) reasons.push('capital_exceeds_source_capacity_proxy');
    const fees = BigInt(p.volume24hUSDCUnits) * BigInt(p.feeTierPips) / 1_000_000n;
    const score = fees * 1_000_000n * BigInt(coverageBps) / (BigInt(p.tvlUSDCUnits) * 10000n);
    return { candidateId: c.candidateId, eligible: reasons.length === 0, reasons,
      historicalScorePpm: score.toString(), historicalPoolFees24hUSDCUnits: fees.toString(), coverageBps };
  });
  const ranked = assessments.filter((a) => a.eligible).sort((a, b) => {
    const delta = BigInt(b.historicalScorePpm) - BigInt(a.historicalScorePpm);
    return delta === 0n ? a.candidateId.localeCompare(b.candidateId) : delta > 0n ? 1 : -1;
  });
  const selected = bundle.candidates.find((c) => c.candidateId === ranked[0]?.candidateId);
  const canonical = selected && evidence.find((v) => equal(v.pool, selected.sourcePool.address));
  const synthetic = selected?.source.mode === 'synthetic-example' || canonical?.mode === 'synthetic-example';
  return {
    schemaVersion: 'noria.aqua.decision.v1', requestId: request.requestId,
    status: selected ? synthetic ? 'simulation_only' : 'eligible_for_owner_review' : 'refused',
    selectedCandidateId: selected?.candidateId ?? null, assessments,
    selectedRange: selected?.range ?? null, capitalUSDCUnits: request.capitalUSDCUnits,
    executionChainId: CHAIN_ID, pair: { base: WETH, quote: USDC }, routingStatus: 'not_validated',
    instructions: selected ? [
      'Source-pool data informs a new Aqua position; do not deposit into the source pool.',
      'Revalidate Aave health, available inventory and official program quote/swap before execution.',
      'Owner authorization and a compatible taker are required. This decision is not transaction approval.',
      'Historical fees and range coverage are not an Aqua return forecast.',
    ] : ['No eligible proposal. Refresh evidence or change explicit constraints; do not relax them silently.'],
  };
}


export type Intent = "earn-fees" | "buy-token0";
export type NetworkId = "ethereum" | "base" | "arbitrum" | "unichain";
export interface DiscoverInput {
  network: NetworkId;
  capitalUsd: 1000 | 5000 | 10000;
  intent: Intent;
  horizonHours: 6 | 24;
  discountBps?: number;
  query?: string;
}
export interface AnalyzeInput {
  network: NetworkId;
  poolAddress: string;
  capitalUsd: 1000 | 5000 | 10000;
  intent: Intent;
  horizonHours: 6 | 24;
  discountBps?: number;
}
export interface PoolAsset {
  address: string;
  symbol: string;
  decimals: number;
}
export interface NetworkOption {
  id: NetworkId;
  label: string;
  available: boolean;
  reason?: string;
}
export interface PoolCandidate {
  network: NetworkId;
  address: string;
  token0: PoolAsset;
  token1: PoolAsset;
  feeTier: number;
  tvlUsd: number;
  volume24hUsd: number;
  activeHours: number;
  score: number;
  reasons: string[];
}
export interface Discovery {
  network: NetworkId;
  provider: string;
  sourceBlock: number;
  receivedAt: string;
  pools: PoolCandidate[];
  considered: number;
  selectedReason: string;
  limitations: string[];
  rejected: { address: string; reason: string }[];
}
export interface DiscoveryResult {
  report: LiveReport | null;
  discovery: Discovery;
}
export interface PriceReferenceQuote {
  role: "token0" | "token1" | "gas";
  key: string;
  symbol: string;
  usd: number;
  timestamp: number;
  confidence: number | null;
  provider?: string;
}
export interface PriceReferenceAssessment {
  provider: string;
  freshness: "fresh" | "aged" | "expired";
  oldestTimestamp: number;
  ageSeconds: number;
  freshAgeSeconds: number;
  maxAgeSeconds: number;
  poolRatio: number;
  referenceRatio: number;
  deviationPercent: number;
  maxDeviationPercent: number;
  quotes: PriceReferenceQuote[];
}
export interface TickEvidence {
  provider: "RPC";
  scope: "range-and-spot";
  poolAddress: string;
  lowerTick: number;
  upperTick: number;
  bitmapWords: number;
  tickCount: number;
  graphTickCount: number;
  reason: string;
  blockNumber: number;
  blockHash: string;
  queryHash: string;
  responseHash: string;
}
export interface LiveReport {
  version: 1;
  id: string;
  classification: "live-construction-analysis";
  input: Omit<AnalyzeInput, "capitalUsd"> & { capitalUsd: number };
  createdAt: string;
  validUntil: string;
  priceReferences?: PriceReferenceAssessment;
  source: {
    provider: string;
    subgraphId: string;
    deployment: string;
    blockNumber: number;
    blockHash: string;
    blockTimestamp: number;
    receivedAt: string;
    queryHash: string;
    responseHash: string;
    rpcMatched: boolean;
    elapsedMs: number;
    stateAgeSeconds: number;
    tickCount: number;
    ticks?: TickEvidence;
  };
  pool: {
    address: string;
    network: NetworkId;
    chain: string;
    token0: string;
    token1: string;
    token0Address: string;
    token1Address: string;
    token0Decimals: number;
    token1Decimals: number;
    explorerUrl: string;
    feePercent: number;
    relativePrice: number;
    token0Usd: number;
    token1Usd: number;
    priceTimestamp: number;
    volume24hUsd: number | null;
    historyHours: number;
    history: { timestamp: number; price: number; volumeUsd: number }[];
  };
  position: {
    tickLower: number;
    tickUpper: number;
    lowerPrice: number;
    upperPrice: number;
    amount0: string;
    amount1: string;
    amount0Raw: string;
    amount1Raw: string;
    liquidityRaw: string;
    deployedUsd: number;
    residualUsd: number;
    maxSharePercent: number;
    location: "active" | "waiting";
    fullConversionAmount0: string | null;
    fullConversionAveragePrice: number | null;
  };
  checks: {
    data: "verified" | "expired";
    construction: "feasible" | "capacity-exceeded";
    economics: "not-established";
    reasons: string[];
  };
  costs: {
    estimatedCycleGasUsd: number;
    estimatedGasUnits: number;
    gasPriceGwei: number;
    swapPreparationUsd: number;
    explanation: string;
  };
  decision: {
    action: "review-plan" | "wait";
    title: string;
    explanation: string;
    management: string[];
    assumptions: string[];
  };
}
export interface HistoricalCase {
  id: string;
  classification: "historical-simulation";
  title: string;
  chain: string;
  pool: string;
  start: string;
  end: string;
  nominalCapitalUsd: number;
  deployedUsd: number;
  tickLower: number;
  tickUpper: number;
  lowerPrice: number;
  upperPrice: number;
  entryWalletUsd: number;
  pnlUsd: number;
  pnlFromDecisionUsd: number;
  feesUsd: number;
  costsUsd: number;
  excessOriginalHoldUsd: number;
  excessPreparedHoldUsd: number;
  activePercent: number;
  maximumSharePercent: number;
  sourceFiles: { path: string; sha256: string }[];
  explanation: string;
  limitations: string[];
}

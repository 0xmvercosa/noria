import { ArrowUpRight, Check, Search } from "lucide-react";
import type { DiscoveryResult, PoolCandidate } from "../domain/types";
import {
  compactHash,
  dateLabel,
  number,
  sourceBlockLabel,
  usd,
} from "./format";
import { GraphMark, PoolTokens } from "./ui";
import s from "./NoriaApp.module.css";

type PoolSearchResult = DiscoveryResult["discovery"];

function RejectedPools({
  rejected,
}: {
  rejected: PoolSearchResult["rejected"];
}) {
  if (!rejected.length) return null;
  const reasons = new Map<string, Set<string>>();
  for (const item of rejected) {
    const addresses = reasons.get(item.reason) ?? new Set<string>();
    addresses.add(item.address.toLowerCase());
    reasons.set(item.reason, addresses);
  }
  return (
    <div className={s.rejectedPools}>
      <h4>Why candidates were not selected</h4>
      <ul className={s.rejectionSummary}>
        {Array.from(reasons, ([reason, addresses]) => (
          <li key={reason}>
            <strong>
              {number(addresses.size, 0)} pool{addresses.size === 1 ? "" : "s"}
            </strong>
            <span>{reason}</span>
          </li>
        ))}
      </ul>
      <details className={s.rejectedAddresses}>
        <summary>Inspect pool addresses and individual reasons</summary>
        <ul>
          {rejected.map((item, index) => (
            <li key={`${item.address}:${index}`}>
              <code>{item.address}</code>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function SearchRecovery({
  busy,
  retryDisabled,
  onReview,
  onRetry,
  retryLabel,
}: {
  busy: boolean;
  retryDisabled: boolean;
  onReview: () => void;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div className={s.searchRecovery}>
      <p>
        Review the recorded reasons and search limits. You can change the
        network or pool preference, then search again. Capital and objective
        apply to the full range analysis.
      </p>
      <div>
        <button
          type="button"
          className={s.outlineButton}
          disabled={busy}
          onClick={onReview}
        >
          Review search inputs
          <ArrowUpRight size={13} />
        </button>
        <button
          type="button"
          className={s.outlineButton}
          disabled={busy || retryDisabled}
          onClick={onRetry}
        >
          {retryLabel}
          <Search size={13} />
        </button>
      </div>
    </div>
  );
}

export function PoolCandidates({
  result,
  selectedAddress,
  onSelect,
  busy,
}: {
  result: PoolSearchResult;
  selectedAddress?: string;
  onSelect: (pool: PoolCandidate) => void;
  busy: boolean;
}) {
  const rejectedCount = new Set(
    result.rejected.map((item) => item.address.toLowerCase()),
  ).size;
  const foundPools = result.considered > 0 || rejectedCount > 0;
  return (
    <div className={s.poolCandidates}>
      <div className={s.candidateSource}>
        <GraphMark />
        <span>
          {result.provider} · block {sourceBlockLabel(result.sourceBlock)}
        </span>
        <span>{dateLabel(result.receivedAt, true)}</span>
      </div>
      <div className={s.candidateCounts}>
        <span>{number(result.considered, 0)} pools considered</span>
        <span>{number(result.pools.length, 0)} candidates listed</span>
        <span>{number(rejectedCount, 0)} with exclusion reasons</span>
      </div>
      {result.pools.length === 0 ? (
        <div className={s.noPools} role="status">
          <h4>
            {foundPools
              ? "Pools found, but none passed the search filters"
              : "No pools found in this search"}
          </h4>
          <p>
            {foundPools
              ? rejectedCount > 0
                ? "The scan returned pool records, but none remain as candidates. Review the exclusions below to see what prevented them from being listed."
                : "The scan returned pool records, but no candidates or individual exclusion reasons were provided. Review the search summary and limits."
              : "No pool records were returned for this network and preference within the bounded search. Try another symbol, pair, pool address, or network."}
          </p>
        </div>
      ) : (
        <div className={s.candidateList}>
          {result.pools.map((pool) => {
            const selected =
              selectedAddress?.toLowerCase() === pool.address.toLowerCase();
            return (
              <article
                className={`${s.candidateCard} ${selected ? s.candidateSelected : ""}`}
                key={`${pool.network}:${pool.address}`}
              >
                <div className={s.candidateIdentity}>
                  <PoolTokens
                    token0={pool.token0.symbol}
                    token1={pool.token1.symbol}
                  />
                  <div>
                    <strong>
                      {pool.token0.symbol} / {pool.token1.symbol}
                    </strong>
                    <span title={pool.address}>
                      {compactHash(pool.address)}
                    </span>
                  </div>
                  <span className={s.feeBadge}>
                    {number(Number(pool.feeTier) / 10000, 4)}%
                  </span>
                </div>
                <dl className={s.candidateMetrics}>
                  <div>
                    <dt>Liquidity (TVL)</dt>
                    <dd>
                      {Number.isFinite(pool.tvlUsd)
                        ? usd(pool.tvlUsd, 0)
                        : "Unavailable"}
                    </dd>
                  </div>
                  <div>
                    <dt>24h volume</dt>
                    <dd>
                      {pool.volume24hUsd !== null &&
                      Number.isFinite(pool.volume24hUsd)
                        ? usd(pool.volume24hUsd, 0)
                        : "Unavailable"}
                    </dd>
                  </div>
                </dl>
                {pool.reasons?.length > 0 && (
                  <p className={s.candidateReason}>
                    {pool.reasons.join(" · ")}
                  </p>
                )}
                <button
                  type="button"
                  className={selected ? s.selectedPoolButton : s.outlineButton}
                  disabled={busy || selected}
                  onClick={() => onSelect(pool)}
                >
                  {selected ? (
                    <>
                      <Check size={13} />
                      Current analysis
                    </>
                  ) : (
                    <>
                      Analyze this pool
                      <ArrowUpRight size={13} />
                    </>
                  )}
                </button>
              </article>
            );
          })}
        </div>
      )}
      <RejectedPools rejected={result.rejected} />
      {result.limitations.length > 0 && (
        <ul className={s.searchLimitations}>
          {result.limitations.map((limit, index) => (
            <li key={index}>{limit}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

import {
  Activity,
  ArrowDownRight,
  Check,
  ChevronDown,
  Clock,
  Database,
  Fingerprint,
  Gauge,
  Loader2,
  Search,
  Target,
  TriangleAlert,
} from "lucide-react";
import { LiveAnalysis } from "./LiveAnalysis";
import { PoolCandidates, SearchRecovery } from "./PoolCandidates";
import { number } from "./format";
import type { NoriaWorkspace } from "./useNoriaWorkspace";
import s from "./NoriaApp.module.css";

export function WorkspaceResults({ workspace }: { workspace: NoriaWorkspace }) {
  const {
    analyzing,
    searching,
    currentReport,
    expired,
    secondsLeft,
    discovery,
    report,
    searchResult,
    dataVerified,
    priceCaveat,
    reportIsPrevious,
    selectedPool,
    networkLabel,
    liveError,
    liveErrorHeading,
    liveErrorCode,
    reviewSearchInputs,
    setSearchDetailsOpen,
    searchError,
    inputsChanged,
    analysisContext,
    searchDetailsOpen,
    inputsValid,
    analyze,
    searchAvailable,
    searchPools,
  } = workspace;
  return (
    <div className={s.results} aria-busy={analyzing || searching}>
      <div className={s.resultHeading}>
        <div>
          <span className={s.stepNumber}>02</span>
          <h2>Inspect the decision</h2>
        </div>
        {currentReport ? (
          <span className={expired ? s.expiredBadge : s.snapshotBadge}>
            <Clock size={11} />
            {expired
              ? "Snapshot expired"
              : `Expires in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}
          </span>
        ) : (
          <span className={s.waitingBadge}>
            {discovery
              ? "No range recommended"
              : report
                ? "Previous analysis"
                : searchResult
                  ? "Search complete"
                  : "Awaiting discovery"}
          </span>
        )}
      </div>
      <div className={s.checks}>
        <div className={s.checkCard}>
          <span className={s.checkLabel}>
            <Database size={13} />
            DATA
          </span>
          <strong
            className={
              dataVerified && !priceCaveat
                ? s.tealText
                : reportIsPrevious || expired || priceCaveat
                  ? s.amberText
                  : ""
            }
          >
            {!currentReport
              ? report
                ? "Previous snapshot"
                : discovery
                  ? "No verified plan"
                  : searchResult
                    ? "Pool search only"
                    : "Not queried"
              : dataVerified
                ? priceCaveat
                  ? "Verified with price caveat"
                  : "Verified snapshot"
                : expired
                  ? "Expired snapshot"
                  : "Not verified"}
          </strong>
          <small>
            {!currentReport
              ? report
                ? "Not refreshed by this request"
                : discovery || searchResult
                  ? "Candidate evidence below"
                  : "Graph data + RPC verification"
              : dataVerified
                ? priceCaveat
                  ? "Graph/RPC matched · review USD references"
                  : "The Graph · canonical RPC match"
                : "Refresh before using this plan"}
          </small>
        </div>
        <div className={s.checkCard}>
          <span className={s.checkLabel}>
            <Gauge size={13} />
            CONSTRUCTION
          </span>
          <strong
            className={
              currentReport?.checks.construction === "feasible"
                ? s.limeText
                : report || discovery
                  ? s.amberText
                  : ""
            }
          >
            {!currentReport
              ? discovery
                ? "No accepted candidate"
                : report
                  ? "Previous result"
                  : "Not evaluated"
              : currentReport.checks.construction === "feasible"
                ? "Mechanically feasible"
                : "Capacity exceeded"}
          </strong>
          <small>
            {!currentReport
              ? "Inventory, tick alignment & capacity"
              : `${number(currentReport.position.maxSharePercent, 4)}% maximum liquidity share`}
          </small>
        </div>
        <div className={s.checkCard}>
          <span className={s.checkLabel}>
            <Target size={13} />
            ECONOMICS
          </span>
          <strong className={s.amberText}>Not established</strong>
          <small>No forward profit claim</small>
        </div>
      </div>

      {analyzing && (
        <div className={s.loadingBanner} role="status">
          <Loader2 className={s.spinner} size={15} />
          <span>
            {selectedPool
              ? `Analyzing ${selectedPool.token0.symbol} / ${selectedPool.token1.symbol} with Graph data and ${networkLabel} RPC.`
              : `Searching Graph pool candidates on ${networkLabel} and checking a position against your capital and objective.`}
          </span>
        </div>
      )}
      {searching && (
        <div className={s.loadingBanner} role="status">
          <Loader2 className={s.spinner} size={15} />
          <span>Searching indexed pools on {networkLabel}…</span>
        </div>
      )}
      {liveError && (
        <div className={s.errorBanner} role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>{liveErrorHeading}</strong>
            <p>{liveError}</p>
            {report && (
              <p>
                The previous result is shown below. This failed request did not
                refresh it.
              </p>
            )}
            {liveErrorCode === "incomplete-history" && (
              <div className={s.errorActions}>
                <button
                  type="button"
                  disabled={analyzing || searching}
                  onClick={reviewSearchInputs}
                >
                  Review search inputs
                </button>
                {Boolean(searchResult?.pools.length) && (
                  <a
                    href="#pool-search-results"
                    onClick={() => setSearchDetailsOpen(true)}
                  >
                    Choose another candidate
                    <ArrowDownRight size={13} />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {searchError && (
        <div className={s.errorBanner} role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>Pool search unavailable</strong>
            <p>{searchError}</p>
          </div>
        </div>
      )}
      {inputsChanged && !analyzing && (
        <div className={s.changedBanner}>
          <Activity size={14} />
          <span>
            Your inputs changed. Analyze again to build a matching plan.
          </span>
        </div>
      )}

      {searchResult && (
        <section
          id="pool-search-results"
          tabIndex={-1}
          className={`${s.discoveryPanel} ${!searchResult.pools.length ? s.discoveryRefusal : ""}`}
          aria-label="Manual pool search results"
        >
          <div className={s.discoveryHeading}>
            <Search size={17} />
            <div>
              <h3>Pool search results</h3>
              <p>
                {searchResult.pools.length
                  ? currentReport &&
                    analysisContext?.manual &&
                    !searchDetailsOpen
                    ? "The selected pool’s range is shown below. Reopen this search to inspect evidence or choose another candidate."
                    : "Choose a candidate to analyze with the current capital and objective. Listing is not economic approval."
                  : searchResult.selectedReason}
              </p>
            </div>
          </div>
          <details
            className={s.details}
            open={searchDetailsOpen}
            onToggle={(event) => setSearchDetailsOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Inspect search candidates, source & exclusions</span>
              <ChevronDown size={15} />
            </summary>
            <PoolCandidates
              result={searchResult}
              selectedAddress={
                currentReport && !inputsChanged && !expired
                  ? currentReport.pool.address
                  : undefined
              }
              busy={analyzing || !inputsValid}
              onSelect={(pool) => void analyze(pool, searchResult)}
            />
            {!searchResult.pools.length && (
              <SearchRecovery
                busy={analyzing || searching}
                retryDisabled={!searchAvailable}
                onReview={reviewSearchInputs}
                onRetry={() => void searchPools()}
                retryLabel="Search again"
              />
            )}
          </details>
        </section>
      )}
      {discovery && (
        <section
          className={`${s.discoveryPanel} ${!currentReport ? s.discoveryRefusal : ""}`}
          aria-label="Pool discovery decision"
        >
          <div className={s.discoveryHeading}>
            <Target size={18} />
            <div>
              <h3>
                {currentReport
                  ? "Pool & range recommendation"
                  : "No range recommended"}
              </h3>
              <p>{discovery.selectedReason}</p>
            </div>
          </div>
          <div className={s.discoveryFacts}>
            <span>{number(discovery.considered, 0)} candidates considered</span>
            <span>{networkLabel}</span>
            {analysisContext?.query && (
              <span>Preference: {analysisContext.query}</span>
            )}
            <span>Heuristic selection · no profit forecast</span>
          </div>
          {!currentReport && (
            <SearchRecovery
              busy={analyzing || searching}
              retryDisabled={!inputsValid || !searchAvailable}
              onReview={reviewSearchInputs}
              onRetry={() => void analyze()}
              retryLabel="Run discovery again"
            />
          )}
          <details className={s.details} open={!currentReport}>
            <summary>
              <span>Inspect candidates, source & exclusions</span>
              <ChevronDown size={15} />
            </summary>
            <PoolCandidates
              result={discovery}
              selectedAddress={
                currentReport && !inputsChanged && !expired
                  ? currentReport.pool.address
                  : undefined
              }
              busy={analyzing || !inputsValid}
              onSelect={(pool) => void analyze(pool, discovery)}
            />
          </details>
        </section>
      )}

      {!report ? (
        !discovery &&
        !searchResult && (
          <>
            <section className={s.emptyPlan}>
              <div className={s.emptyVisual} aria-hidden="true">
                <div className={s.visualBracketLeft} />
                <div className={s.visualLine} />
                <div className={s.visualShield}>
                  <Fingerprint size={38} strokeWidth={1.15} />
                </div>
                <div className={s.visualBracketRight} />
                <span className={s.visualLabelLeft}>YOUR INTENT</span>
                <span className={s.visualLabelRight}>POOL STATE</span>
              </div>
              <div className={s.emptyCopy}>
                <span className={s.miniEyebrow}>NO POOL IS PRESELECTED</span>
                <h3>Find a pool. Inspect its range.</h3>
                <p>
                  Choose a network, your capital, and a goal. We’ll search pool
                  candidates and model a range, with the source and selection
                  reasons attached.
                </p>
              </div>
              <div className={s.emptySteps}>
                <span>
                  <Check size={13} />
                  Aligned price range
                </span>
                <span>
                  <Check size={13} />
                  Token inventory
                </span>
                <span>
                  <Check size={13} />
                  Source evidence
                </span>
              </div>
            </section>
            <div className={s.emptyContext}>
              <div>
                <Activity size={18} />
                <h3>Market context, included.</h3>
                <p>
                  Your analysis requests 168 hours of hourly pool prices.
                  Coverage is reported with the chart.
                </p>
              </div>
              <div>
                <Fingerprint size={18} />
                <h3>The inputs are inspectable.</h3>
                <p>
                  Check the source block, query and response hashes, position
                  parameters, and cost assumptions.
                </p>
              </div>
            </div>
          </>
        )
      ) : (
        <LiveAnalysis workspace={workspace} />
      )}
    </div>
  );
}

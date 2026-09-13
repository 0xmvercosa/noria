import {
  ChevronDown,
  Clock,
  Download,
  Fingerprint,
  Layers,
  Loader2,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { HistoricalCase } from "../domain/types";
import { dateLabel, downloadJson, number, signedUsd, usd } from "./format";
import { TokenPair } from "./ui";
import s from "./NoriaApp.module.css";

export function HistoricalStudy({
  historical,
  loading,
  error,
  retry,
}: {
  historical: HistoricalCase | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}) {
  return (
    <section
      className={s.historicalSection}
      id="historical-case"
      aria-labelledby="historical-heading"
    >
      <div className={s.sectionHeading}>
        <div>
          <div className={s.eyebrow}>
            <span className={s.amberDot} />
            THE HISTORICAL CASE
          </div>
          <h2 id="historical-heading">A result you can trace back.</h2>
        </div>
        <span className={s.historicalBadge}>
          <Clock size={12} />
          Historical simulation · not a forecast
        </span>
      </div>
      {loading && (
        <div className={s.historyLoading} role="status">
          <Loader2 className={s.spinner} size={18} />
          <span>Loading the dated evidence bundle…</span>
        </div>
      )}
      {error && (
        <div className={s.errorBanner} role="alert">
          <TriangleAlert size={18} />
          <div>
            <strong>Historical case unavailable</strong>
            <p>{error}</p>
          </div>
          <button onClick={retry}>Retry</button>
        </div>
      )}
      {historical && !loading && (
        <div className={s.historicalCard}>
          <div className={s.historicalIntro}>
            <div className={s.historicalPool}>
              <TokenPair small />
              <div>
                <h3>{historical.title}</h3>
                <p>
                  WBTC / WETH · Ethereum · 0.05% ·{" "}
                  {dateLabel(historical.start, true)} →{" "}
                  {dateLabel(historical.end, true)}
                </p>
              </div>
            </div>
            <div className={s.historicalCapital}>
              <span>Wallet at entry</span>
              <strong>{usd(historical.entryWalletUsd)}</strong>
            </div>
          </div>
          <div className={s.historicalMetrics}>
            <div className={s.historicalPnl}>
              <span>Net PnL since entry</span>
              <strong>{signedUsd(historical.pnlUsd)}</strong>
              <small>After modeled fees and costs</small>
            </div>
            <div>
              <span>Fees earned</span>
              <strong>{usd(historical.feesUsd)}</strong>
              <small>Historical fee estimate</small>
            </div>
            <div>
              <span>Total modeled costs</span>
              <strong>{usd(historical.costsUsd)}</strong>
              <small>Included in net PnL</small>
            </div>
            <div>
              <span>Time in range</span>
              <strong>
                {number(historical.activePercent, 1)}
                <em>%</em>
              </strong>
              <small>Over this specific window</small>
            </div>
          </div>
          <div className={s.benchmarkRow}>
            <div>
              <Layers size={16} />
              <span>vs. original inventory HOLD</span>
              <strong>{signedUsd(historical.excessOriginalHoldUsd)}</strong>
            </div>
            <div>
              <Wallet size={16} />
              <span>vs. prepared inventory HOLD</span>
              <strong>{signedUsd(historical.excessPreparedHoldUsd)}</strong>
            </div>
          </div>
          <p className={s.historyExplanation}>
            {historical.explanation} From the earlier decision with{" "}
            {usd(historical.nominalCapitalUsd, 0)} nominal capital, net PnL was{" "}
            {signedUsd(historical.pnlFromDecisionUsd)}; token prices changed
            before entry.
          </p>
          <details className={s.details}>
            <summary>
              <span>
                <Fingerprint size={15} />
                Inspect historical methodology & source hashes
              </span>
              <ChevronDown size={16} />
            </summary>
            <div className={s.detailsBody}>
              <dl className={s.evidenceGrid}>
                <div>
                  <dt>Classification</dt>
                  <dd>Historical simulation</dd>
                </div>
                <div>
                  <dt>Chain / pool</dt>
                  <dd>
                    {historical.chain} · {historical.pool}
                  </dd>
                </div>
                <div>
                  <dt>Deployed capital</dt>
                  <dd>{usd(historical.deployedUsd)}</dd>
                </div>
                <div>
                  <dt>Maximum active-liquidity share</dt>
                  <dd>{number(historical.maximumSharePercent, 4)}%</dd>
                </div>
                <div>
                  <dt>Price range, WETH per WBTC</dt>
                  <dd>
                    {number(historical.lowerPrice, 6)} –{" "}
                    {number(historical.upperPrice, 6)}
                  </dd>
                </div>
                <div>
                  <dt>Aligned ticks</dt>
                  <dd>
                    {historical.tickLower} / {historical.tickUpper}
                  </dd>
                </div>
              </dl>
              <div className={s.evidenceNotes}>
                <h4>What this case can and cannot tell you</h4>
                <ul>
                  {historical.limitations.map((limitation, index) => (
                    <li key={index}>{limitation}</li>
                  ))}
                </ul>
                <p>
                  Original HOLD preserves the starting inventory. Prepared HOLD
                  preserves the inventory after position preparation. These are
                  two separate comparisons.
                </p>
              </div>
              <dl className={s.hashList}>
                {historical.sourceFiles.map((file) => (
                  <div key={file.path}>
                    <dt>{file.path}</dt>
                    <dd>SHA-256 {file.sha256}</dd>
                  </div>
                ))}
              </dl>
              <button
                className={s.outlineButton}
                onClick={() => downloadJson(historical)}
              >
                <Download size={14} />
                Download historical evidence
              </button>
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

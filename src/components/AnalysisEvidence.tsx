import {
  ChevronDown,
  Code2,
  Database,
  Download,
  ExternalLink,
  Fingerprint,
} from "lucide-react";
import type { DiscoveryResult, LiveReport } from "../domain/types";
import {
  blockExplorer,
  dateLabel,
  downloadJson,
  number,
  priceNumber,
  priceUnit,
  usd,
} from "./format";
import s from "./NoriaApp.module.css";

export function AnalysisEvidence({
  report,
  discovery,
}: {
  report: LiveReport;
  discovery: DiscoveryResult["discovery"] | null;
}) {
  const ticks = report.source.ticks;
  return (
    <section
      className={s.evidencePanel}
      id="live-evidence"
      aria-label="Live analysis evidence"
    >
      <div className={s.evidenceHeading}>
        <div className={s.iconHeading}>
          <Fingerprint size={19} />
          <div>
            <h3>An analysis you can inspect.</h3>
            <p>Source state, position math, and limits. Inspect them all.</p>
          </div>
        </div>
        <button
          className={s.outlineButton}
          onClick={() =>
            downloadJson(
              discovery ? { id: report.id, report, discovery } : report,
            )
          }
        >
          <Download size={14} />
          Download JSON
        </button>
      </div>
      {ticks && (
        <section className={s.tickRecovery} aria-label="RPC tick recovery">
          <Database size={17} />
          <div>
            <h4>Ticks recovered from RPC</h4>
            <p>
              Ticks {number(ticks.lowerTick, 0)} through{" "}
              {number(ticks.upperTick, 0)} · block{" "}
              {number(ticks.blockNumber, 0)}.
            </p>
            <p>
              The Graph supplies discovery and hourly history. RPC tick coverage
              is limited to the interval between spot and the supported ranges,
              anchored to active liquidity at the same block.
            </p>
          </div>
        </section>
      )}
      <details className={s.details}>
        <summary>
          <span>Inspect source & construction evidence</span>
          <ChevronDown size={16} />
        </summary>
        <div className={s.detailsBody}>
          <dl className={s.evidenceGrid}>
            <div>
              <dt>Provider</dt>
              <dd>{report.source.provider}</dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{report.pool.chain}</dd>
            </div>
            <div>
              <dt>Source block</dt>
              <dd>
                {blockExplorer(report) ? (
                  <a
                    href={blockExplorer(report)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {report.source.blockNumber.toLocaleString("en-US")}{" "}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  report.source.blockNumber.toLocaleString("en-US")
                )}
              </dd>
            </div>
            <div>
              <dt>RPC reconciliation</dt>
              <dd>
                {report.source.rpcMatched
                  ? "Matched canonical onchain state"
                  : "Not matched"}
              </dd>
            </div>
            <div>
              <dt>Block timestamp</dt>
              <dd>{dateLabel(report.source.blockTimestamp, true)}</dd>
            </div>
            <div>
              <dt>Analysis created</dt>
              <dd>{dateLabel(report.createdAt, true)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{dateLabel(report.validUntil, true)}</dd>
            </div>
            <div>
              <dt>State age at analysis</dt>
              <dd>{number(report.source.stateAgeSeconds, 0)} seconds</dd>
            </div>
            <div>
              <dt>
                {ticks
                  ? "Initialized ticks in RPC interval"
                  : "Initialized ticks returned"}
              </dt>
              <dd>
                {(ticks?.tickCount ?? report.source.tickCount).toLocaleString(
                  "en-US",
                )}
              </dd>
            </div>
            <div>
              <dt>Collection duration</dt>
              <dd>{number(report.source.elapsedMs, 0)} ms</dd>
            </div>
            <div>
              <dt>Price timestamp</dt>
              <dd>{dateLabel(report.pool.priceTimestamp, true)}</dd>
            </div>
          </dl>
          {ticks && (
            <section
              className={s.evidenceNotes}
              aria-label="Tick data provenance"
            >
              <h4>Tick data provenance</h4>
              <dl className={s.evidenceGrid}>
                <div>
                  <dt>Tick provider</dt>
                  <dd>{ticks.provider}</dd>
                </div>
                <div>
                  <dt>Coverage scope</dt>
                  <dd>{ticks.scope}</dd>
                </div>
                <div>
                  <dt>Lower covered tick</dt>
                  <dd>{number(ticks.lowerTick, 0)}</dd>
                </div>
                <div>
                  <dt>Upper covered tick</dt>
                  <dd>{number(ticks.upperTick, 0)}</dd>
                </div>
                <div>
                  <dt>Bitmap words read</dt>
                  <dd>{number(ticks.bitmapWords, 0)}</dd>
                </div>
                <div>
                  <dt>Initialized ticks from RPC</dt>
                  <dd>{number(ticks.tickCount, 0)}</dd>
                </div>
                <div>
                  <dt>Ticks returned by The Graph</dt>
                  <dd>{number(ticks.graphTickCount, 0)}</dd>
                </div>
                <div>
                  <dt>Tick source block</dt>
                  <dd>{number(ticks.blockNumber, 0)}</dd>
                </div>
              </dl>
              <p>Reason for recovery: {ticks.reason}</p>
            </section>
          )}
          {report.priceReferences && (
            <section
              className={s.evidenceNotes}
              aria-label="USD reference consistency"
            >
              <h4>Relative price consistency</h4>
              <dl className={s.evidenceGrid}>
                <div>
                  <dt>Pool ratio at the source block</dt>
                  <dd>
                    {priceNumber(report.priceReferences.poolRatio)}{" "}
                    {priceUnit(report)}
                  </dd>
                </div>
                <div>
                  <dt>Ratio from USD references</dt>
                  <dd>
                    {priceNumber(report.priceReferences.referenceRatio)}{" "}
                    {priceUnit(report)}
                  </dd>
                </div>
                <div>
                  <dt>Relative ratio deviation</dt>
                  <dd>{number(report.priceReferences.deviationPercent, 4)}%</dd>
                </div>
                <div>
                  <dt>Allowed relative deviation</dt>
                  <dd>
                    {number(report.priceReferences.maxDeviationPercent, 2)}%
                    tolerance
                  </dd>
                </div>
              </dl>
              <p>
                This compares the pool ratio with {report.pool.token0} USD ÷{" "}
                {report.pool.token1} USD from the quoted references. It checks
                relative consistency, not a second USD source or a guarantee of
                absolute price accuracy.
              </p>
            </section>
          )}
          <section
            className={s.evidenceNotes}
            aria-label="Individual USD references"
          >
            <h4>Individual USD references</h4>
            {report.priceReferences?.quotes.length ? (
              <div className={s.quoteList}>
                {report.priceReferences.quotes.map((quote) => (
                  <div
                    className={s.quoteRow}
                    role="group"
                    aria-label={`${quote.symbol} ${quote.role} USD reference`}
                    key={`${quote.role}:${quote.key}`}
                  >
                    <div className={s.quoteHeading}>
                      <strong>{quote.symbol}</strong>
                      <span>
                        {quote.role === "gas"
                          ? "Gas asset"
                          : quote.role === "token0"
                            ? "Token0"
                            : "Token1"}
                      </span>
                    </div>
                    <dl className={s.evidenceGrid}>
                      <div>
                        <dt>USD reference</dt>
                        <dd>
                          {quote.usd > 0 && quote.usd < 0.01
                            ? `$${priceNumber(quote.usd)}`
                            : usd(quote.usd)}
                        </dd>
                      </div>
                      <div>
                        <dt>Quoted at</dt>
                        <dd>{dateLabel(quote.timestamp, true)}</dd>
                      </div>
                      <div>
                        <dt>Price provider</dt>
                        <dd>
                          {quote.provider ??
                            report.priceReferences?.provider ??
                            "Provider not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Provider confidence</dt>
                        <dd>
                          {typeof quote.confidence === "number" &&
                          Number.isFinite(quote.confidence)
                            ? `${number(quote.confidence, 4)} · provider field, not a probability`
                            : "Not supplied by provider"}
                        </dd>
                      </div>
                      <div>
                        <dt>Reference key</dt>
                        <dd>{quote.key}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                Individual quote details were not included in this report. Only
                the aggregate price timestamp is available; no per-token
                confidence is assumed.
              </p>
            )}
          </section>
          <dl className={s.hashList}>
            <div>
              <dt>Pool</dt>
              <dd>{report.pool.address}</dd>
            </div>
            <div>
              <dt>
                {report.pool.token0} contract · {report.pool.token0Decimals}{" "}
                decimals
              </dt>
              <dd>{report.pool.token0Address}</dd>
            </div>
            <div>
              <dt>
                {report.pool.token1} contract · {report.pool.token1Decimals}{" "}
                decimals
              </dt>
              <dd>{report.pool.token1Address}</dd>
            </div>
            <div>
              <dt>Canonical block hash</dt>
              <dd>{report.source.blockHash}</dd>
            </div>
            <div>
              <dt>Subgraph ID</dt>
              <dd>{report.source.subgraphId}</dd>
            </div>
            <div>
              <dt>Deployment</dt>
              <dd>{report.source.deployment}</dd>
            </div>
            <div>
              <dt>Query SHA-256</dt>
              <dd>{report.source.queryHash}</dd>
            </div>
            <div>
              <dt>Response SHA-256</dt>
              <dd>{report.source.responseHash}</dd>
            </div>
            {ticks && (
              <>
                <div>
                  <dt>RPC tick block hash</dt>
                  <dd>{ticks.blockHash}</dd>
                </div>
                <div>
                  <dt>RPC tick query SHA-256</dt>
                  <dd>{ticks.queryHash}</dd>
                </div>
                <div>
                  <dt>RPC tick response SHA-256</dt>
                  <dd>{ticks.responseHash}</dd>
                </div>
              </>
            )}
            <div>
              <dt>Liquidity, raw</dt>
              <dd>{report.position.liquidityRaw}</dd>
            </div>
            <div>
              <dt>{report.pool.token0} amount, raw</dt>
              <dd>{report.position.amount0Raw}</dd>
            </div>
            <div>
              <dt>{report.pool.token1} amount, raw</dt>
              <dd>{report.position.amount1Raw}</dd>
            </div>
          </dl>
          <div className={s.evidenceNotes}>
            <h4>Checks & assumptions</h4>
            <ul>
              {[...report.checks.reasons, ...report.decision.assumptions].map(
                (reason, index) => (
                  <li key={index}>{reason}</li>
                ),
              )}
            </ul>
          </div>
          <div className={s.evidenceNotes}>
            <h4>Cost model</h4>
            <p>{report.costs.explanation}</p>
            <p>
              {report.costs.estimatedGasUnits.toLocaleString("en-US")} estimated
              gas units at {number(report.costs.gasPriceGwei, 4)} gwei.
            </p>
          </div>
          <div className={s.receiptNote}>
            <Code2 size={16} />
            <p>
              The JSON is an informational analysis report: source data,
              position parameters, inventory, and assumptions.
            </p>
          </div>
        </div>
      </details>
    </section>
  );
}

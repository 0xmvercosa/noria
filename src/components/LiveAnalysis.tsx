import {
  ArrowDownRight,
  ChevronDown,
  Clock,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { LiveReport } from "../domain/types";
import { AnalysisEvidence } from "./AnalysisEvidence";
import { EthUsdEquivalent } from "./EthUsd";
import { usdReferenceFromReport } from "../domain/eth-usd";
import { MarketChart, RangeChart } from "./PoolCharts";
import {
  compactHash,
  dateLabel,
  intentLabel,
  number,
  priceNumber,
  priceReferenceState,
  tokenAmount,
  usd,
} from "./format";
import { GraphMark, PoolTokens } from "./ui";
import type { NoriaWorkspace } from "./useNoriaWorkspace";
import s from "./NoriaApp.module.css";

function PriceReferences({
  report,
  state,
}: {
  report: LiveReport;
  state: ReturnType<typeof priceReferenceState>;
}) {
  const warning = state.freshness !== "fresh";
  const heading =
    state.freshness === "aged"
      ? "Aged USD price references"
      : state.freshness === "expired"
        ? "USD price references expired"
        : state.freshness === "unknown"
          ? "USD reference timing unavailable"
          : "USD price references";
  return (
    <section
      className={`${s.priceReferences} ${warning ? s.priceReferenceWarning : ""}`}
      aria-labelledby="price-references-heading"
    >
      <div className={s.priceReferenceHeading}>
        {warning ? <TriangleAlert size={18} /> : <Clock size={18} />}
        <div>
          <h3 id="price-references-heading">{heading}</h3>
          {state.freshness === "aged" ? (
            <p>
              At least one USD reference is between{" "}
              {number(state.freshAgeSeconds / 60, 0)} and{" "}
              {number(state.maxAgeSeconds / 60, 0)} minutes old. Inventory and
              cost estimates include aged quotes.
            </p>
          ) : state.freshness === "expired" ? (
            <p>
              The oldest USD reference exceeds the{" "}
              {number(state.maxAgeSeconds / 60, 0)}-minute informational limit.
              Refresh before using the inventory or cost estimates.
            </p>
          ) : state.freshness === "unknown" ? (
            <p>
              The age of the USD references cannot be confirmed from this
              report. Refresh before using the estimates.
            </p>
          ) : (
            <p>
              USD inventory and cost estimates use these reference marks. Report
              expiry is checked separately.
            </p>
          )}
        </div>
      </div>
      <dl className={s.priceReferenceFacts}>
        <div>
          <dt>USD reference source</dt>
          <dd>{report.priceReferences?.provider ?? "Provider not recorded"}</dd>
        </div>
        <div>
          <dt>Oldest reference age</dt>
          <dd>
            {state.ageSeconds === null || state.ageSeconds < 0
              ? "Unavailable"
              : `${number(state.ageSeconds, 0)} seconds`}
          </dd>
        </div>
        <div>
          <dt>Oldest quoted at</dt>
          <dd>{dateLabel(state.oldestTimestamp, true)}</dd>
        </div>
      </dl>
      {state.freshness === "aged" && (
        <p className={s.priceReferencePolicy}>
          Aged references are not current quotes. The{" "}
          {number(state.maxAgeSeconds / 60, 0)}-minute limit is an operational
          policy for informational analysis, not a guarantee of accuracy. The
          report’s separate expiry still applies.
        </p>
      )}
    </section>
  );
}

export function LiveAnalysis({ workspace }: { workspace: NoriaWorkspace }) {
  const {
    report,
    reportDiscovery,
    reportIsPrevious,
    expired,
    priceState,
    planPanel,
    priceCaveat,
  } = workspace;
  if (!report) return null;
  return (
    <>
      {reportIsPrevious && (
        <div className={s.previousReport} role="status">
          <Clock size={16} />
          <div>
            <strong>Previous analysis — not refreshed</strong>
            <p>
              Created {dateLabel(report.createdAt, true)} ·{" "}
              {expired ? "Expired" : "Valid until"}{" "}
              {dateLabel(report.validUntil, true)}. The report below belongs to
              that earlier request.
            </p>
          </div>
        </div>
      )}
      {priceState && <PriceReferences report={report} state={priceState} />}
      <section
        ref={planPanel}
        tabIndex={-1}
        className={s.planPanel}
        aria-labelledby="plan-heading"
      >
        <div className={s.analyzedPool}>
          <PoolTokens token0={report.pool.token0} token1={report.pool.token1} />
          <div>
            <strong>
              {report.pool.token0} / {report.pool.token1}
            </strong>
            <span>
              {report.pool.chain} · Uniswap v3 ·{" "}
              {number(report.pool.feePercent, 4)}%
            </span>
          </div>
          <code title={report.pool.address}>
            {compactHash(report.pool.address)}
          </code>
        </div>
        <div className={s.planHeader}>
          <span className={s.miniEyebrow}>
            {intentLabel(
              report.input.intent,
              report.pool.token0,
              report.pool.token1,
            ).toUpperCase()}{" "}
            · {usd(report.input.capitalUsd, 0)} · REVIEW IN{" "}
            {report.input.horizonHours}H
          </span>
          <span
            className={
              report.position.location === "active"
                ? s.positionActive
                : s.positionWaiting
            }
          >
            <span />
            {report.position.location === "active"
              ? "Price inside range"
              : report.position.upperPrice < report.pool.relativePrice
                ? "Range below market"
                : "Range above market"}
          </span>
        </div>
        <h3 id="plan-heading">{report.decision.title}</h3>
        <p className={s.decisionExplanation}>{report.decision.explanation}</p>
        {report.position.location === "waiting" && (
          <p className={s.fieldHelp}>
            Outside the current price: this position earns no swap fees until
            the price enters its range.
          </p>
        )}
        <RangeChart report={report} />
        <div className={s.inventoryHeader}>
          <span>Position inventory</span>
          <span>
            {priceCaveat
              ? "USD estimates · see price caveat"
              : "At reference USD prices"}
          </span>
        </div>
        <div className={s.inventory}>
          <div>
            <span>
              <i className={s.smallAsset}>{report.pool.token0.slice(0, 1)}</i>
              {report.pool.token0}
            </span>
            <strong>
              {tokenAmount(report.position.amount0, report.pool.token0Decimals)}{" "}
              <EthUsdEquivalent
                amount={report.position.amount0}
                reference={usdReferenceFromReport(
                  report,
                  report.pool.token0Address,
                )}
              />
            </strong>
          </div>
          <div>
            <span>
              <i className={`${s.smallAsset} ${s.secondAsset}`}>
                {report.pool.token1.slice(0, 1)}
              </i>
              {report.pool.token1}
            </span>
            <strong>
              {tokenAmount(report.position.amount1, report.pool.token1Decimals)}{" "}
              <EthUsdEquivalent
                amount={report.position.amount1}
                reference={usdReferenceFromReport(
                  report,
                  report.pool.token1Address,
                )}
              />
            </strong>
          </div>
          <div>
            <span>
              <Wallet size={15} />
              Residual cash
            </span>
            <strong>{usd(report.position.residualUsd)}</strong>
            <small>Preserved in the budget</small>
          </div>
        </div>
        <div className={s.capitalBar}>
          <svg
            viewBox="0 0 800 4"
            preserveAspectRatio="none"
            aria-label={`${usd(report.position.deployedUsd)} deployed out of ${usd(report.input.capitalUsd)}`}
            role="img"
          >
            <rect width="800" height="4" rx="2" fill="#29352c" />
            <rect
              width={Math.min(
                800,
                Math.max(
                  0,
                  (report.position.deployedUsd / report.input.capitalUsd) * 800,
                ),
              )}
              height="4"
              rx="2"
              fill="#b7d985"
            />
          </svg>
          <span>{usd(report.position.deployedUsd)} deployed</span>
          <span>{usd(report.input.capitalUsd, 0)} budget</span>
        </div>
        {report.input.intent === "buy-token0" &&
          report.position.fullConversionAmount0 !== null && (
            <div className={s.conversionNote}>
              <ArrowDownRight size={16} />
              <p>
                At full conversion:{" "}
                <strong>
                  {tokenAmount(
                    report.position.fullConversionAmount0,
                    report.pool.token0Decimals,
                  )}{" "}
                  {report.pool.token0}{" "}
                  <EthUsdEquivalent
                    amount={report.position.fullConversionAmount0}
                    reference={usdReferenceFromReport(
                      report,
                      report.pool.token0Address,
                    )}
                  />
                </strong>
                {report.position.fullConversionAveragePrice !== null && (
                  <>
                    {" "}
                    at an average{" "}
                    {priceNumber(
                      report.position.fullConversionAveragePrice,
                    )}{" "}
                    {report.pool.token1} / {report.pool.token0}
                  </>
                )}
                . Conversion depends on the price crossing the full range.
              </p>
            </div>
          )}
        <p className={s.fieldHelp}>
          Assumes you already hold the displayed tokens. Preparing a different
          inventory adds swap fees, slippage and price impact; these are not
          estimated here.
        </p>
        <div className={s.costRow}>
          <div>
            <span>Estimated cycle gas</span>
            <strong>{usd(report.costs.estimatedCycleGasUsd)}</strong>
          </div>
          <div>
            <span>Preparation swap</span>
            <strong>Not modeled</strong>
          </div>
          <div>
            <span>{report.pool.token0} reference price</span>
            <strong>
              {report.pool.token0Usd > 0 && report.pool.token0Usd < 0.01
                ? `$${priceNumber(report.pool.token0Usd)}`
                : usd(report.pool.token0Usd)}
            </strong>
          </div>
        </div>
        <details className={s.managementDetails}>
          <summary>
            <span>Management notes</span>
            <ChevronDown size={15} />
          </summary>
          <ul>
            {report.decision.management.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </details>
      </section>

      <section className={s.marketPanel} aria-labelledby="market-heading">
        <div className={s.marketHeading}>
          <div>
            <span className={s.miniEyebrow}>
              THE CONTEXT BEHIND THE CONSTRUCTION
            </span>
            <h3 id="market-heading">One pool. A wider perspective.</h3>
          </div>
          <span className={s.historyWindow}>
            168h requested <span>·</span> {number(report.pool.historyHours, 0)}h
            available
          </span>
        </div>
        <MarketChart report={report} />
        <div className={s.marketFooter}>
          <span>
            <GraphMark />
            The Graph · block{" "}
            <a href="#live-evidence">
              {report.source.blockNumber.toLocaleString("en-US")}
            </a>
          </span>
          <span>
            {report.pool.volume24hUsd === null
              ? "24h volume unavailable"
              : `${usd(report.pool.volume24hUsd, 0)} Graph-reported 24h volume`}
          </span>
        </div>
      </section>
      <div className={s.snapshotLine}>
        <Clock size={12} />
        <span>
          Source: {dateLabel(report.source.blockTimestamp, true)}{" "}
          <span className={s.inlineDivider}>/</span> Block hash{" "}
          <a href="#live-evidence" title={report.source.blockHash}>
            {compactHash(report.source.blockHash)}
          </a>
        </span>
      </div>
      <AnalysisEvidence report={report} discovery={reportDiscovery} />
    </>
  );
}

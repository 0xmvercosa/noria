import { Activity } from "lucide-react";
import type { LiveReport } from "../domain/types";
import { dateLabel, priceNumber, priceUnit } from "./format";
import s from "./NoriaApp.module.css";

export function RangeChart({ report }: { report: LiveReport }) {
  const { lowerPrice, upperPrice } = report.position;
  const spot = report.pool.relativePrice;
  const minimum = Math.min(lowerPrice, spot);
  const maximum = Math.max(upperPrice, spot);
  const padding = Math.max((maximum - minimum) * 0.17, spot * 0.0002);
  const domainMin = minimum - padding;
  const domainMax = maximum + padding;
  const x = (price: number) =>
    22 + ((price - domainMin) / (domainMax - domainMin)) * 716;
  const lowerX = x(lowerPrice);
  const upperX = x(upperPrice);
  const spotX = x(spot);
  return (
    <div className={s.rangeChart}>
      <div className={s.chartCaption}>
        <span>Your liquidity range</span>
        <span>{priceUnit(report)}</span>
      </div>
      <svg
        viewBox="0 0 760 118"
        role="img"
        aria-label={`Proposed price range ${priceNumber(lowerPrice)} to ${priceNumber(upperPrice)} ${priceUnit(report)}. Current pool price ${priceNumber(spot)}.`}
      >
        <defs>
          <linearGradient id="noria-range" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d3f78b" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#d3f78b" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((index) => (
          <line
            key={index}
            x1={22 + index * 89.5}
            x2={22 + index * 89.5}
            y1="31"
            y2="94"
            stroke="#27332c"
            strokeDasharray="2 6"
          />
        ))}
        <line x1="22" x2="738" y1="91" y2="91" stroke="#344037" />
        <rect
          x={lowerX}
          y="40"
          width={Math.max(upperX - lowerX, 1)}
          height="51"
          rx="2"
          fill="url(#noria-range)"
        />
        <line
          x1={lowerX}
          x2={upperX}
          y1="40"
          y2="40"
          stroke="#d3f78b"
          strokeWidth="2"
        />
        <line
          x1={lowerX}
          x2={lowerX}
          y1="34"
          y2="98"
          stroke="#d3f78b"
          strokeWidth="1.5"
        />
        <line
          x1={upperX}
          x2={upperX}
          y1="34"
          y2="98"
          stroke="#d3f78b"
          strokeWidth="1.5"
        />
        <line
          x1={spotX}
          x2={spotX}
          y1="27"
          y2="99"
          stroke="#6dddc3"
          strokeDasharray="3 3"
        />
        <circle
          cx={spotX}
          cy="40"
          r="5"
          fill="#6dddc3"
          stroke="#101612"
          strokeWidth="2"
        />
        <text
          x={Math.max(57, Math.min(703, spotX))}
          y="16"
          textAnchor="middle"
          fill="#6dddc3"
          fontSize="11"
          fontFamily="monospace"
        >
          CURRENT PRICE
        </text>
      </svg>
      <div className={s.rangeValues}>
        <div>
          <span>Lower bound</span>
          <strong>{priceNumber(lowerPrice)}</strong>
          <small>
            Tick {report.position.tickLower.toLocaleString("en-US")}
          </small>
        </div>
        <div>
          <span>Pool price</span>
          <strong className={s.tealText}>{priceNumber(spot)}</strong>
          <small>At the source block</small>
        </div>
        <div>
          <span>Upper bound</span>
          <strong>{priceNumber(upperPrice)}</strong>
          <small>
            Tick {report.position.tickUpper.toLocaleString("en-US")}
          </small>
        </div>
      </div>
    </div>
  );
}

export function MarketChart({ report }: { report: LiveReport }) {
  const points = report.pool.history
    .filter(
      (point) =>
        Number.isFinite(point.timestamp) &&
        Number.isFinite(point.price) &&
        point.price > 0,
    )
    .toSorted((a, b) => a.timestamp - b.timestamp);
  if (points.length < 2) {
    return (
      <div className={s.chartUnavailable}>
        <Activity size={24} />
        <p>Not enough hourly observations to draw the market history.</p>
        <span>
          The source returned {points.length} valid observation
          {points.length === 1 ? "" : "s"}.
        </span>
      </div>
    );
  }
  const first = points[0];
  const last = points[points.length - 1];
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = Math.max((max - min) * 0.22, max * 0.001);
  const yMin = min - pad;
  const yMax = max + pad;
  const x = (timestamp: number) =>
    18 +
    ((timestamp - first.timestamp) /
      Math.max(last.timestamp - first.timestamp, 1)) *
      710;
  const y = (price: number) => 18 + ((yMax - price) / (yMax - yMin)) * 150;
  let path = "";
  points.forEach((point, index) => {
    const newSegment =
      index === 0 || point.timestamp - points[index - 1].timestamp > 5400;
    path += `${newSegment ? "M" : "L"}${x(point.timestamp).toFixed(2)},${y(point.price).toFixed(2)} `;
  });
  const rangeTop = Math.max(18, y(report.position.upperPrice));
  const rangeBottom = Math.min(168, y(report.position.lowerPrice));
  const hasRangeOverlay = rangeBottom > rangeTop;
  const chartDate = (timestamp: number) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      hour12: false,
      timeZone: "UTC",
    }).format(new Date(timestamp * 1000));
  return (
    <>
      <svg
        className={s.marketChart}
        viewBox="0 0 808 208"
        role="img"
        aria-label={`${points.length} observed hourly prices, from ${dateLabel(first.timestamp, true)} through ${dateLabel(last.timestamp, true)}. Prices in ${priceUnit(report)}. Missing hours are not interpolated.`}
      >
        <defs>
          <clipPath id="noria-market-clip">
            <rect x="18" y="17" width="711" height="153" />
          </clipPath>
        </defs>
        {[0, 1, 2, 3].map((index) => {
          const value = yMax - ((yMax - yMin) * index) / 3;
          return (
            <g key={index}>
              <line
                x1="18"
                x2="728"
                y1={y(value)}
                y2={y(value)}
                stroke="#27312c"
                strokeDasharray="3 5"
              />
              <text
                x="747"
                y={y(value) + 4}
                fill="#738177"
                fontSize="11"
                fontFamily="monospace"
              >
                {priceNumber(value)}
              </text>
            </g>
          );
        })}
        <g clipPath="url(#noria-market-clip)">
          {hasRangeOverlay && (
            <rect
              x="18"
              y={rangeTop}
              width="710"
              height={rangeBottom - rangeTop}
              fill="#d3f78b"
              fillOpacity="0.065"
            />
          )}
          {report.position.upperPrice < yMax &&
            report.position.upperPrice > yMin && (
              <line
                x1="18"
                x2="728"
                y1={y(report.position.upperPrice)}
                y2={y(report.position.upperPrice)}
                stroke="#a3bd73"
                strokeOpacity="0.6"
                strokeDasharray="4 5"
              />
            )}
          {report.position.lowerPrice < yMax &&
            report.position.lowerPrice > yMin && (
              <line
                x1="18"
                x2="728"
                y1={y(report.position.lowerPrice)}
                y2={y(report.position.lowerPrice)}
                stroke="#a3bd73"
                strokeOpacity="0.6"
                strokeDasharray="4 5"
              />
            )}
          <path
            d={path}
            fill="none"
            stroke="#75dac1"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx={x(last.timestamp)}
            cy={y(last.price)}
            r="4"
            fill="#75dac1"
            stroke="#13201a"
            strokeWidth="2"
          />
        </g>
        <text x="18" y="197" fill="#738177" fontSize="11">
          {chartDate(first.timestamp)}
        </text>
        <text x="373" y="197" textAnchor="middle" fill="#738177" fontSize="11">
          {chartDate((first.timestamp + last.timestamp) / 2)}
        </text>
        <text x="728" y="197" textAnchor="end" fill="#738177" fontSize="11">
          {chartDate(last.timestamp)}
        </text>
      </svg>
      <div className={s.chartLegend}>
        <span>
          <i className={s.priceLegend} />
          Observed hourly price
        </span>
        {hasRangeOverlay && (
          <span>
            <i className={s.rangeLegend} />
            Proposed range
          </span>
        )}
        <span>UTC · {priceUnit(report)}</span>
      </div>
    </>
  );
}

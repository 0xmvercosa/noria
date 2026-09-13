import type {
  DiscoveryResult,
  HistoricalCase,
  Intent,
  LiveReport,
} from "../domain/types";

export const usd = (value: number, digits = 2) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);

export const number = (value: number, digits = 4) =>
  new Intl.NumberFormat(
    "en-US",
    Math.abs(value) > 0 && Math.abs(value) < 0.01
      ? {
          maximumSignificantDigits: Math.max(4, Math.min(digits, 8)),
          ...(Math.abs(value) < 1e-6
            ? { notation: "scientific" as const }
            : {}),
        }
      : { maximumFractionDigits: digits },
  ).format(value);
export const priceNumber = (value: number) =>
  value !== 0 && (Math.abs(value) < 0.0001 || Math.abs(value) >= 1e7)
    ? value.toExponential(4)
    : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 }).format(
        value,
      );
export const tokenAmount = (value: string, decimals: number) =>
  Number(value) !== 0 && Math.abs(Number(value)) < 1e-6
    ? Number(value).toExponential(5)
    : number(Number(value), Math.min(decimals, 8));

export const signedUsd = (value: number) =>
  `${value >= 0 ? "+" : "−"}${usd(Math.abs(value))}`;
export const compactHash = (value: string) =>
  value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
export const intentLabel = (
  intent: Intent,
  token0?: string,
  token1?: string,
) =>
  intent === "earn-fees"
    ? "Earn fees"
    : token0 && token1
      ? `Buy ${token0} with ${token1}`
      : "Planned conversion";
export const priceUnit = (report: LiveReport) =>
  `${report.pool.token1} per ${report.pool.token0}`;
export const blockExplorer = (report: LiveReport) =>
  report.pool.explorerUrl
    ? `${report.pool.explorerUrl.replace(/\/$/, "")}/block/${report.source.blockNumber}`
    : null;

export function sourceBlockLabel(source: unknown) {
  if (typeof source === "number" && Number.isSafeInteger(source) && source > 0)
    return source.toLocaleString("en-US");
  if (
    source &&
    typeof source === "object" &&
    "number" in source &&
    typeof source.number === "number" &&
    Number.isSafeInteger(source.number) &&
    source.number > 0
  )
    return source.number.toLocaleString("en-US");
  return "not provided";
}

export function dateLabel(value: string | number, includeTime = false) {
  const date = new Date(typeof value === "number" ? value * 1000 : value);
  if (!Number.isFinite(date.getTime())) return "Timestamp unavailable";
  return (
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
      ...(includeTime
        ? {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }
        : {}),
    }).format(date) + (includeTime ? " UTC" : "")
  );
}

export function priceReferenceState(report: LiveReport, now: number) {
  const references = report.priceReferences;
  const oldestTimestamp =
    references?.oldestTimestamp ?? report.pool.priceTimestamp;
  const freshAgeSeconds = references?.freshAgeSeconds ?? 300;
  const maxAgeSeconds = references?.maxAgeSeconds ?? 900;
  const ageSeconds =
    Number.isSafeInteger(oldestTimestamp) && oldestTimestamp > 0
      ? Math.floor(now / 1000) - oldestTimestamp
      : null;
  const freshness =
    ageSeconds === null || ageSeconds < 0
      ? "unknown"
      : ageSeconds > maxAgeSeconds
        ? "expired"
        : ageSeconds > freshAgeSeconds
          ? "aged"
          : "fresh";
  return {
    oldestTimestamp,
    freshAgeSeconds,
    maxAgeSeconds,
    ageSeconds,
    freshness,
  };
}

export function downloadJson(
  value: LiveReport | HistoricalCase | (DiscoveryResult & { id: string }),
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `noria-${value.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

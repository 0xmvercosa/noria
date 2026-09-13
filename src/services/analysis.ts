import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnalyzeSchema, type Snapshot } from "../domain/analysis-data";
import { buildReport } from "../domain/report";
import type { LiveReport, HistoricalCase } from "../domain/types";
import { collectSnapshot } from "../providers/snapshot";

// Keep the service entry point stable for consumers while the domain and
// provider modules expose their responsibilities directly.
export {
  NetworkSchema,
  AddressSchema,
  IntentFields,
  AnalyzeSchema,
  DiscoverSchema,
  AssetSchema,
  HourSchema,
  PoolSchema,
  MetaSchema,
  FEE_SPACING,
  digest,
  type GraphData,
  type Snapshot,
} from "../domain/analysis-data";
export {
  PRICE_RATIO_MAX_DEVIATION_PERCENT,
  verifyReferenceRatio,
  validatePriceMarks,
  assemblePriceMarks,
} from "../domain/price-references";
export { HistoryDataError, buildReport } from "../domain/report";
export {
  rpcFor,
  recoverRpcTicks,
  pinGraph,
  collectSnapshot,
} from "../providers/snapshot";

// Cache collected evidence, then rebuild the report against the current time.
const snapshots = new Map<string, { snapshot: Snapshot; saved: number }>(),
  inflight = new Map<string, Promise<Snapshot>>();
export async function analyze(raw: unknown): Promise<LiveReport> {
  const input = AnalyzeSchema.parse(raw),
    key = `${input.network}:${input.poolAddress}`;
  let cached = snapshots.get(key);
  if (!cached || Date.now() - cached.saved > 15000) {
    let pending = inflight.get(key);
    if (!pending) {
      pending = collectSnapshot(input.network, input.poolAddress)
        .then((snapshot) => {
          snapshots.set(key, { snapshot, saved: Date.now() });
          if (snapshots.size > 20)
            snapshots.delete(snapshots.keys().next().value!);
          return snapshot;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    await pending;
    cached = snapshots.get(key);
  }
  return buildReport(input, cached!.snapshot);
}
export async function historicalCase(): Promise<HistoricalCase> {
  return JSON.parse(
    await readFile(
      path.join(process.cwd(), "data/examples/historical-case.json"),
      "utf8",
    ),
  );
}

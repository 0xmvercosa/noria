import { z } from "zod";
import {
  LaunchPreparedSchema,
  LaunchRequestSchema,
  LaunchReadySnapshotSchema,
  LaunchSnapshotSchema,
  LaunchHashSchema,
  LaunchUintSchema,
  assertPreparedLaunch,
  type LaunchRequest,
  type LaunchPrepared,
  type LaunchIntent,
} from "./launch-contract";
import type { PositionPlanResponse } from "./position-contract";
import { restoreAttempt, restoreRecords, verifyReserve } from "../privy/client";
import {
  assertOtherRouteClear,
  readWalletPending,
} from "../privy/coordination";

export const launchEndpoint = "/api/aqua/v1/launch";
export const launchHistoryKey = (owner: string) =>
  `noria.aqua.operations.v1:${owner.toLowerCase()}`;
export const launchAttemptKey = (owner: string) =>
  `noria.aqua.attempt.v1:${owner.toLowerCase()}`;
const RecordSchema = z.object({
  id: z.string().uuid(),
  prepared: LaunchPreparedSchema,
  hash: LaunchHashSchema,
  submittedAt: z.string().datetime(),
});
const AttemptSchema = z
  .object({
    id: z.string().uuid(),
    prepared: LaunchPreparedSchema,
    startedAt: z.string().datetime(),
  })
  .strict();
const VerificationSchema = z
  .object({
    schemaVersion: z.literal("noria.aqua.launch.operation.v1"),
    request: LaunchRequestSchema,
    hash: LaunchHashSchema,
    chainId: z.literal(42161),
    status: z.enum(["verified", "reverted", "effect-unverified"]),
    after: LaunchReadySnapshotSchema,
    networkFeeWei: LaunchUintSchema,
  })
  .passthrough();
export type LaunchVerification = z.infer<typeof VerificationSchema>;
export type LaunchRecord = z.infer<typeof RecordSchema> & {
  verification?: LaunchVerification;
};
export type LaunchAttempt = z.infer<typeof AttemptSchema>;
const sameRequest = (a: LaunchRequest, b: LaunchRequest) =>
  JSON.stringify(LaunchRequestSchema.parse(a)) ===
  JSON.stringify(LaunchRequestSchema.parse(b));

async function post(body: unknown) {
  const response = await fetch(launchEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.message === "string"
        ? data.message
        : "The position service is unavailable.",
    );
  return { response, data };
}
export async function readLaunch(
  owner: string,
  account?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ owner });
  if (account) query.set("account", account);
  const response = await fetch(`${launchEndpoint}?${query}`, {
    cache: "no-store",
    signal,
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "Position balances are unavailable.",
    );
  const snapshot = LaunchSnapshotSchema.parse(body);
  if (
    snapshot.owner.toLowerCase() !== owner.toLowerCase() ||
    (account &&
      snapshot.status === "ready" &&
      snapshot.position?.address.toLowerCase() !== account.toLowerCase())
  )
    throw new Error(
      "The position response belongs to a different wallet or account.",
    );
  return snapshot;
}
export async function prepareLaunch(request: LaunchRequest, plan?: unknown) {
  const { data } = await post({
    operation: "prepare",
    request,
    ...(["open", "convert", "ship"].includes(request.kind) ? { plan } : {}),
  });
  return assertPreparedLaunch(data, request, plan);
}
export async function refreshLaunchPlan(
  owner: string,
  account: string,
  intent: LaunchIntent,
  reviewAfterHours: 6 | 24 = 6,
) {
  const { data } = await post({
    operation: "plan",
    owner,
    account,
    intent,
    reviewAfterHours,
  });
  if (
    data.schemaVersion !== "noria.aqua.position.v1" ||
    !["ready-for-local-rehearsal", "refused"].includes(data.status)
  )
    throw new Error("The position research response is invalid.");
  return data as PositionPlanResponse; // Each transaction separately validates the complete evidence.
}
export async function verifyLaunch(record: LaunchRecord) {
  const { response, data } = await post({
    operation: "verify",
    prepared: record.prepared,
    hash: record.hash,
  });
  if (response.status === 202) return null;
  const result = VerificationSchema.parse(data);
  if (
    result.hash !== record.hash.toLowerCase() ||
    !sameRequest(result.request, record.prepared.request) ||
    result.after.owner.toLowerCase() !==
      record.prepared.request.owner.toLowerCase()
  )
    throw new Error(
      "The receipt report does not match this position operation.",
    );
  if (
    BigInt(result.after.blockNumber) <=
    BigInt(record.prepared.before.blockNumber)
  )
    throw new Error(
      "This receipt predates the reviewed operation. Inspect the correct transaction hash.",
    );
  return result;
}
export function restoreLaunchRecords(
  raw: string | null,
  owner: string,
): LaunchRecord[] {
  if (!raw) return [];
  if (raw.length > 4_000_000)
    throw new Error("The saved position history is too large.");
  const records = z.array(RecordSchema).max(100).parse(JSON.parse(raw));
  if (
    records.some(
      (r) => r.prepared.request.owner.toLowerCase() !== owner.toLowerCase(),
    )
  )
    throw new Error("The position history belongs to another wallet.");
  return records; // Ignore persisted success labels; each receipt is reverified.
}
export function serializeLaunchRecords(records: LaunchRecord[]) {
  return JSON.stringify(records.map((r) => RecordSchema.parse(r)));
}
export function restoreLaunchAttempt(raw: string | null, owner: string) {
  if (!raw) return null;
  if (raw.length > 40_000)
    throw new Error("The unresolved position operation is invalid.");
  const result = AttemptSchema.parse(JSON.parse(raw));
  if (result.prepared.request.owner.toLowerCase() !== owner.toLowerCase())
    throw new Error(
      "The unresolved position operation belongs to another wallet.",
    );
  return result;
}
export function launchRecordFromAttempt(
  attempt: LaunchAttempt,
  hash: string,
): LaunchRecord {
  return RecordSchema.parse({
    id: attempt.id,
    prepared: attempt.prepared,
    hash,
    submittedAt: attempt.startedAt,
  });
}
/** The intent must survive ambiguous SDK failures, reloads and failed hash persistence. */
export async function submitLaunchAttempt(options: {
  attempt: LaunchAttempt;
  save: (attempt: LaunchAttempt) => void;
  send: () => Promise<string>;
  record: (entry: LaunchRecord) => boolean;
  clear: (reason: "rejected" | "recorded") => void;
}) {
  const attempt = AttemptSchema.parse(options.attempt);
  options.save(attempt);
  let hash: string;
  try {
    hash = await options.send();
  } catch (failure) {
    if (
      typeof failure === "object" &&
      failure !== null &&
      "code" in failure &&
      failure.code === 4001
    )
      options.clear("rejected");
    throw failure;
  }
  const entry = launchRecordFromAttempt(attempt, hash);
  if (!options.record(entry))
    throw new Error(
      `The transaction hash ${hash} could not be saved. Keep it and recover the outstanding request before continuing.`,
    );
  options.clear("recorded");
  return entry;
}
/** Called while holding the shared owner lock. Older reserve records have no shared marker. */
export async function assertReserveSettledForLaunch(
  owner: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
) {
  assertOtherRouteClear(readWalletPending(storage, owner), "aqua");
  if (
    restoreAttempt(
      storage.getItem(`noria.privy.attempt.v1:${owner.toLowerCase()}`),
      owner,
    )
  )
    throw new Error(
      "Resolve the earlier wallet request on /reserve before launching.",
    );
  const records = restoreRecords(
    storage.getItem(`noria.privy.operations.v1:${owner.toLowerCase()}`),
    owner,
  );
  // Deliberately recheck chain evidence instead of trusting saved UI labels.
  const results = await Promise.all(records.map(verifyReserve));
  if (results.some((v) => !v || v.status === "effect-unverified"))
    throw new Error(
      "Check outstanding transaction receipts on /reserve before launching.",
    );
}
export function assertLaunchHistoryCurrent(
  owner: string,
  activeOwner: string | null,
  records: LaunchRecord[],
  saved: string | null,
  attempt: LaunchAttempt | null,
  savedAttempt: string | null,
  recovering = false,
) {
  if (activeOwner?.toLowerCase() !== owner.toLowerCase())
    throw new Error("The wallet changed. Review again.");
  const disk = restoreLaunchRecords(saved, owner);
  const diskAttempt = restoreLaunchAttempt(savedAttempt, owner);
  const known = new Map(records.map((r) => [r.hash, r]));
  if (
    disk.some(
      (r) =>
        !known.has(r.hash) ||
        JSON.stringify(RecordSchema.parse(known.get(r.hash))) !==
          JSON.stringify(r),
    )
  )
    throw new Error(
      "Another tab changed position history. Refresh and check receipts before continuing.",
    );
  if (
    attempt &&
    diskAttempt &&
    JSON.stringify(attempt) !== JSON.stringify(diskAttempt)
  )
    throw new Error(
      "The unresolved position operation changed. Inspect it again.",
    );
  const unresolved = diskAttempt ?? attempt;
  if (recovering) {
    if (!unresolved)
      throw new Error("There is no unresolved operation to recover.");
  } else {
    if (unresolved)
      throw new Error(
        "Resolve the earlier position request before signing again.",
      );
    if (
      records.some(
        (r) => !r.verification || r.verification.status === "effect-unverified",
      )
    )
      throw new Error(
        "Check all outstanding position receipts before continuing.",
      );
    if (records.length >= 100)
      throw new Error(
        "Download and clear checked position history before continuing.",
      );
  }
  return unresolved;
}
export function launchReport(
  records: LaunchRecord[],
  attempt: LaunchAttempt | null,
  snapshot: unknown,
) {
  return {
    schemaVersion: "noria.aqua.wallet-flow.v1",
    exportedAt: new Date().toISOString(),
    chainId: 42161,
    walletTransport:
      "Privy useSendTransaction; the session recording establishes wallet provenance.",
    boundaries: [
      "This report covers Noria operations saved in this browser, not all wallet or position activity.",
      "Unverified or pending requests are not completed transfers. Reloaded receipt status is checked again.",
      "Balances are timestamped end-of-block observations; token and protocol events establish individual effects.",
      "Shipment does not establish aggregator admission, taker demand, positive returns or automatic cycle settlement.",
      "The 50/50 policy applies to eligible cycle surplus after explicit accounting checkpoints. Network fees are separate.",
      "Arbitrum sequencer inclusion is not Ethereum settlement finality.",
    ],
    balanceSnapshot: snapshot,
    unresolvedAttempt: attempt,
    operations: records,
  };
}

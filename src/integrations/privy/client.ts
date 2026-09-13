import { z } from "zod";
import {
  ActionSchema,
  PreparedSchema,
  SnapshotSchema,
  assertReserveAction,
  assertReserveGas,
  sameReserveAction,
  type ReserveAction,
  type PreparedReserveAction,
} from "./reserve";
import type { ReserveVerification } from "./service";

export const endpoint = "/api/privy/v1/reserve";
export const RecordSchema = z.object({
  id: z.string().uuid(),
  prepared: PreparedSchema,
  hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  submittedAt: z.string().datetime(),
});
export type ReserveRecord = z.infer<typeof RecordSchema> & {
  verification?: ReserveVerification;
};
const AttemptSchema = z
  .object({
    id: z.string().uuid(),
    prepared: PreparedSchema,
    startedAt: z.string().datetime(),
  })
  .strict();
export type ReserveAttempt = z.infer<typeof AttemptSchema>;

export function restoreAttempt(
  raw: string | null,
  owner: string,
): ReserveAttempt | null {
  if (!raw) return null;
  if (raw.length > 16_384)
    throw new Error("The unresolved wallet operation is invalid.");
  const attempt = AttemptSchema.parse(JSON.parse(raw));
  if (attempt.prepared.action.owner.toLowerCase() !== owner.toLowerCase())
    throw new Error(
      "The unresolved wallet operation belongs to a different wallet.",
    );
  return attempt;
}

export function recordFromAttempt(
  attempt: ReserveAttempt,
  hash: string,
): ReserveRecord {
  return RecordSchema.parse({
    id: attempt.id,
    prepared: attempt.prepared,
    hash,
    submittedAt: attempt.startedAt,
  });
}

/** A failed broadcast response is not proof that the network rejected the transaction. */
export async function submitReserveAttempt(options: {
  attempt: ReserveAttempt;
  save: (attempt: ReserveAttempt) => void;
  send: () => Promise<string>;
  record: (entry: ReserveRecord) => boolean;
  clear: () => void;
}): Promise<ReserveRecord> {
  const attempt = AttemptSchema.parse(options.attempt);
  options.save(attempt); // Must succeed before entering the wallet SDK.
  let hash: string;
  try {
    hash = await options.send();
  } catch (error) {
    // Pinned Privy emits an EIP-1193 code 4001 for a definite user rejection.
    // Error messages, timeouts and other RPC codes never establish cancellation.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 4001
    )
      options.clear();
    throw error;
  }
  const entry = recordFromAttempt(attempt, hash);
  if (!options.record(entry))
    throw new Error(
      "The transaction returned a hash, but browser history could not be saved. Keep the hash and resolve the outstanding wallet operation before continuing.",
    );
  options.clear(); // Never erase the intent before its hash is durable.
  return entry;
}

async function post(body: unknown) {
  const response = await fetch(endpoint, {
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
        : "Reserve service unavailable.",
    );
  return { response, data };
}
export async function readReserve(owner: string, signal?: AbortSignal) {
  const response = await fetch(
    `${endpoint}?owner=${encodeURIComponent(owner)}`,
    { cache: "no-store", signal },
  );
  if (!response.ok)
    throw new Error("Reserve balances are unavailable. Try refreshing.");
  return SnapshotSchema.parse(await response.json());
}
export function assertPrepared(
  input: PreparedReserveAction,
  action: ReserveAction,
  now = Date.now(),
) {
  const prepared = PreparedSchema.parse(input);
  const expected = ActionSchema.parse(action);
  if (!sameReserveAction(prepared.action, expected))
    throw new Error("The review does not match your requested operation.");
  if (
    now >= prepared.expiresAt ||
    prepared.expiresAt > now + 61_000 ||
    Math.abs(now / 1000 - prepared.before.blockTimestamp) > 90
  )
    throw new Error("This review expired. Refresh before signing.");
  assertReserveAction(expected, prepared.before);
  assertReserveGas(expected, prepared.before, prepared.estimatedGasWei);
  return prepared;
}
export async function prepareReserve(action: ReserveAction) {
  const { data } = await post({ operation: "prepare", action });
  return assertPrepared(data, action);
}
export async function verifyReserve(
  record: ReserveRecord,
): Promise<ReserveVerification | null> {
  const { response, data } = await post({
    operation: "verify",
    action: record.prepared.action,
    hash: record.hash,
  });
  if (response.status === 202) return null;
  // Response metadata must bind the local history entry before it can be shown as confirmed.
  if (
    data.schemaVersion !== "noria.privy.operation.v1" ||
    data.hash !== record.hash ||
    data.chainId !== 42161 ||
    !sameReserveAction(data.action, record.prepared.action) ||
    !["verified", "reverted", "effect-unverified"].includes(data.status)
  )
    throw new Error("The operation report did not match this transaction.");
  const after = SnapshotSchema.parse(data.after);
  const action = ActionSchema.parse(data.action);
  if (after.owner !== action.owner)
    throw new Error("The operation report did not match this wallet.");
  return { ...data, action, after } as ReserveVerification;
}

export async function verifyReserveAttempt(
  attempt: ReserveAttempt,
  hash: string,
) {
  const entry = recordFromAttempt(attempt, hash);
  const verification = await verifyReserve(entry);
  if (!verification) return null;
  if (
    BigInt(verification.after.blockNumber) <=
    BigInt(attempt.prepared.before.blockNumber)
  )
    throw new Error(
      "This transaction predates the unresolved wallet request. Find the hash for this request before continuing.",
    );
  return { ...entry, verification };
}

/** Persist submitted hashes before verification. On reload every hash is rechecked;
 * a locally edited success label is never accepted as chain evidence. */
export function restoreRecords(
  raw: string | null,
  owner: string,
): ReserveRecord[] {
  if (!raw) return [];
  if (raw.length > 1_000_000)
    throw new Error("The local operation history is too large.");
  const records = z.array(RecordSchema).max(100).parse(JSON.parse(raw));
  if (
    records.some(
      (r) => r.prepared.action.owner.toLowerCase() !== owner.toLowerCase(),
    )
  )
    throw new Error("The saved history belongs to a different wallet.");
  return records;
}
export function serializedRecords(records: ReserveRecord[]) {
  return JSON.stringify(records.map((r) => RecordSchema.parse(r)));
}

/** Read current history only after obtaining the wallet lock. A review can become
 * invalid while preparation is awaiting RPC or another tab is submitting. */
export async function withCheckedReserveHistory<T>(options: {
  owner: string;
  locks: Pick<LockManager, "request"> | undefined;
  operation: "submit" | "clear" | "recover";
  read: () => {
    activeOwner: string | null;
    records: ReserveRecord[];
    saved: string | null;
    attempt: ReserveAttempt | null;
    savedAttempt: string | null;
  };
  run: (records: ReserveRecord[], attempt: ReserveAttempt | null) => Promise<T>;
}): Promise<T> {
  if (!options.locks)
    throw new Error(
      "This browser cannot coordinate wallet operations between tabs. Use a browser with Web Locks support.",
    );
  return options.locks.request(
    `noria-reserve:${options.owner.toLowerCase()}`,
    { ifAvailable: true },
    async (held) => {
      if (!held)
        throw new Error("This wallet has an operation open in another tab.");
      const state = options.read();
      if (
        state.activeOwner?.toLowerCase() !== options.owner.toLowerCase() ||
        state.records.some(
          (r) =>
            r.prepared.action.owner.toLowerCase() !==
            options.owner.toLowerCase(),
        )
      )
        throw new Error("The wallet changed. Review this operation again.");
      const saved = restoreRecords(state.saved, options.owner);
      const savedAttempt = restoreAttempt(state.savedAttempt, options.owner);
      const attempt = savedAttempt ?? state.attempt;
      if (
        (state.attempt &&
          state.attempt.prepared.action.owner.toLowerCase() !==
            options.owner.toLowerCase()) ||
        (savedAttempt &&
          state.attempt &&
          JSON.stringify(savedAttempt) !==
            JSON.stringify(AttemptSchema.parse(state.attempt)))
      )
        throw new Error(
          "The unresolved wallet operation changed. Refresh before continuing.",
        );
      if (attempt && options.operation !== "recover")
        throw new Error(
          "An earlier wallet operation has no resolved outcome. Inspect Privy and Arbiscan before continuing; do not repeat it.",
        );
      if (!attempt && options.operation === "recover")
        throw new Error("There is no unresolved wallet operation to recover.");
      const known = new Map(state.records.map((r) => [r.hash, r]));
      if (
        saved.some((r) => {
          const existing = known.get(r.hash);
          return (
            !existing ||
            JSON.stringify(RecordSchema.parse(existing)) !== JSON.stringify(r)
          );
        })
      )
        throw new Error(
          "Another tab changed operation history. Refresh and check its receipts first.",
        );
      if (
        options.operation !== "recover" &&
        state.records.some(
          (r) =>
            r.verification?.status !== "verified" &&
            r.verification?.status !== "reverted",
        )
      )
        throw new Error(
          "Check all outstanding transaction receipts before continuing.",
        );
      if (options.operation === "submit" && state.records.length >= 100)
        throw new Error(
          "Download and clear checked history before starting another operation.",
        );
      // Preserve checked in-memory records when an earlier storage write failed.
      return options.run([...state.records], attempt);
    },
  );
}

export function reserveReport(
  records: ReserveRecord[],
  unresolvedAttempt: ReserveAttempt | null = null,
) {
  return {
    schemaVersion: "noria.privy.flow.v1",
    exportedAt: new Date().toISOString(),
    chainId: 42161,
    walletActionTransport:
      "Privy React useSendTransaction; wallet origin requires the accompanying login/demo evidence.",
    boundaries: [
      "Funding modal completion is not counted as settled funding or a completed deposit.",
      "Each verified operation matches canonical transaction sender, destination, calldata and value, plus token/protocol events where applicable.",
      "Wallet transfers report the exact sent asset, recipient and amount. Network fees are paid separately in ETH.",
      "This statement covers operations recorded in this browser; it is not a complete wallet activity index.",
      "Snapshots are end-of-block observations and can include other activity; exact transaction value or matched event amounts prove this operation.",
      "Aave balances can include earlier deposits, transfers and interest; balance changes alone are not profit.",
      "Approval and revocation are permissions, not completed financial flows. Use a verified transfer, supply or withdrawal.",
      "Aave savings uses the Privy wallet. Aqua borrowing and execution use a separately verified PositionAccount deployment and are not part of this wallet statement.",
      "Sequencer inclusion is not Ethereum finality. These client-side records are not cryptographic Privy provenance.",
      "An unresolved wallet request is not a verified transaction or a cancellation. Inspect wallet activity before any retry.",
    ],
    unresolvedAttempt,
    operations: records,
  };
}

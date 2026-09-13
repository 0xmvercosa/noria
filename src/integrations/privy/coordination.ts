import { z } from "zod";
import { OwnerSchema } from "./reserve";

/** A durable cross-route gate. It records uncertainty, never a trusted success. */
const PendingSchema = z
  .object({
    id: z.string().uuid(),
    owner: OwnerSchema,
    route: z.enum(["reserve", "aqua"]),
    startedAt: z.string().datetime(),
  })
  .strict();
export type WalletPending = z.infer<typeof PendingSchema>;
export const walletPendingKey = (owner: string) =>
  `noria.wallet.pending.v1:${owner.toLowerCase()}`;
export const walletOperationEvent = "noria-wallet-operation";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export function readWalletPending(storage: Storage, owner: string) {
  const raw = storage.getItem(walletPendingKey(owner));
  if (!raw) return null;
  if (raw.length > 2048)
    throw new Error("The pending wallet operation is invalid.");
  const result = PendingSchema.parse(JSON.parse(raw));
  if (result.owner.toLowerCase() !== owner.toLowerCase())
    throw new Error("The pending operation belongs to another wallet.");
  return result;
}

export function assertOtherRouteClear(
  pending: WalletPending | null,
  route: WalletPending["route"],
) {
  if (pending && pending.route !== route)
    throw new Error(
      `Resolve the earlier operation on /${pending.route} before starting another wallet transaction.`,
    );
}

export function saveWalletPending(storage: Storage, input: WalletPending) {
  const pending = PendingSchema.parse(input);
  const existing = readWalletPending(storage, pending.owner);
  if (
    existing &&
    (existing.id !== pending.id || existing.route !== pending.route)
  )
    throw new Error(
      `Resolve the earlier operation on /${existing.route} before signing again.`,
    );
  storage.setItem(walletPendingKey(pending.owner), JSON.stringify(pending));
}

/** Only the exact operation's verified/reverted receipt or definite cancellation may release it. */
export function clearWalletPending(
  storage: Storage,
  owner: string,
  id: string,
) {
  const pending = readWalletPending(storage, owner);
  if (pending && pending.id === id) storage.removeItem(walletPendingKey(owner));
}

/** Share the original reserve lock with Aqua, including older open tabs. */
export async function withWalletLock<T>(
  owner: string,
  locks: Pick<LockManager, "request"> | undefined,
  run: () => Promise<T>,
) {
  if (!locks)
    throw new Error(
      "This browser cannot coordinate wallet operations between tabs. Use a browser with Web Locks support.",
    );
  return locks.request(
    `noria-reserve:${owner.toLowerCase()}`,
    { ifAvailable: true },
    async (held) => {
      if (!held)
        throw new Error("This wallet has an operation open in another tab.");
      return run();
    },
  );
}

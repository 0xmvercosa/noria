import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EuroAmountSchema,
  euroOnrampOptions,
  restoreFiatPurchases,
} from "../../src/integrations/privy/fiat";
import { RESERVE } from "../../src/integrations/privy/reserve";
import {
  readWalletPending,
  saveWalletPending,
  clearWalletPending,
  assertOtherRouteClear,
  walletPendingKey,
} from "../../src/integrations/privy/coordination";

const owner = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const id = "11111111-1111-4111-8111-111111111111";
test("EUR funding pins the recipient, Arbitrum and native USDC without treating a request as settlement", () => {
  const options = euroOnrampOptions(owner, "50.25");
  assert.deepEqual(options.source, { assets: ["eur"], defaultAsset: "eur" });
  assert.deepEqual(options.destination, {
    address: owner,
    chain: "eip155:42161",
    asset: RESERVE.usdc,
  });
  assert.equal(options.defaultAmount, "50.25");
  assert.equal(options.environment, "production");
  for (const value of [
    "0",
    "0.99",
    "10000.01",
    "1e2",
    "-5",
    "1.001",
    "Infinity",
    " 20",
    "01",
  ])
    assert.equal(EuroAmountSchema.safeParse(value).success, false, value);
  const purchase = {
    id,
    owner,
    requestedEuroAmount: "50.25",
    startedAt: new Date().toISOString(),
    status: "provider-confirmed",
  };
  assert.equal(
    restoreFiatPurchases(JSON.stringify([purchase]), owner)[0].status,
    "provider-confirmed",
  );
  assert.throws(() =>
    restoreFiatPurchases(
      JSON.stringify([{ ...purchase, status: "settled" }]),
      owner,
    ),
  );
  assert.throws(() => restoreFiatPurchases(JSON.stringify([purchase]), other));
});
test("pending operations block the other route and cannot be overwritten or cleared by an unrelated receipt", () => {
  const items = new Map<string, string>();
  const storage = {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
  const pending = {
    id,
    owner: owner as `0x${string}`,
    route: "aqua" as const,
    startedAt: new Date().toISOString(),
  };
  saveWalletPending(storage, pending);
  assert.throws(() =>
    assertOtherRouteClear(readWalletPending(storage, owner), "reserve"),
  );
  assert.doesNotThrow(() =>
    assertOtherRouteClear(readWalletPending(storage, owner), "aqua"),
  );
  assert.throws(() =>
    saveWalletPending(storage, {
      ...pending,
      id: "22222222-2222-4222-8222-222222222222",
    }),
  );
  clearWalletPending(storage, owner, "unrelated");
  assert.equal(readWalletPending(storage, owner)?.id, id);
  clearWalletPending(storage, owner, id);
  assert.equal(readWalletPending(storage, owner), null);
  items.set(
    walletPendingKey(owner),
    JSON.stringify({ ...pending, owner: other }),
  );
  assert.throws(() => readWalletPending(storage, owner));
});

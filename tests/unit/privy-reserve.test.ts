import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  RESERVE,
  ActionSchema,
  OwnerSchema,
  assertReserveAction,
  parseUsdc,
  poolAbi,
  reserveTransaction,
  tokenAbi,
  type ReserveAction,
  type ReserveSnapshot,
} from "../../src/integrations/privy/reserve";
import {
  createReserveService,
  type ReserveClient,
} from "../../src/integrations/privy/service";
import { createReserveHandlers } from "../../src/integrations/privy/http";

const owner = getAddress("0x00000000000000000000000000000000000a11ce");
const stranger = getAddress("0x0000000000000000000000000000000000000b0b");
const hash = `0x${"a".repeat(64)}` as Hash;
const blockHash = `0x${"b".repeat(64)}` as Hash;
const otherHash = `0x${"c".repeat(64)}` as Hash;
const amount = 12_345_678n;
const active = 1n << 56n;
const action = (kind: ReserveAction["kind"] = "supply"): ReserveAction => ({
  owner,
  kind,
  amountUnits: kind === "revoke" ? "0" : amount.toString(),
});
const state = (): ReserveSnapshot => ({
  owner,
  chainId: 42161,
  blockNumber: "500",
  blockHash,
  blockTimestamp: Math.floor(Date.now() / 1000),
  usdcUnits: "100000000",
  aUsdcUnits: "50000000",
  nativeWei: "10000000000000000",
  allowanceUnits: amount.toString(),
  debtBase: "0",
  supplyAvailable: true,
  withdrawAvailable: true,
});

type ReceiptLog = {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: number;
  removed: boolean;
};
function log(
  address: Address,
  topics: readonly unknown[],
  data: Hex,
): ReceiptLog {
  return {
    address,
    topics: topics as [Hex, ...Hex[]],
    data,
    logIndex: 0,
    blockNumber: 500n,
    blockHash,
    transactionHash: hash,
    transactionIndex: 0,
    removed: false,
  };
}
function approval(
  value = amount,
  account = owner,
  spender: Address = RESERVE.pool,
) {
  return log(
    RESERVE.usdc,
    encodeEventTopics({
      abi: tokenAbi,
      eventName: "Approval",
      args: { owner: account, spender },
    }),
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );
}
function transfer(from: Address, to: Address, value = amount) {
  return log(
    RESERVE.usdc,
    encodeEventTopics({
      abi: tokenAbi,
      eventName: "Transfer",
      args: { from, to },
    }),
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );
}
function supply(
  account = owner,
  beneficiary = owner,
  value = amount,
  reserve: Address = RESERVE.usdc,
) {
  return log(
    RESERVE.pool,
    encodeEventTopics({
      abi: poolAbi,
      eventName: "Supply",
      args: { reserve, onBehalfOf: beneficiary, referralCode: 0 },
    }),
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [account, value],
    ),
  );
}
function withdraw(
  account = owner,
  to = owner,
  value = amount,
  reserve: Address = RESERVE.usdc,
) {
  return log(
    RESERVE.pool,
    encodeEventTopics({
      abi: poolAbi,
      eventName: "Withdraw",
      args: { reserve, user: account, to },
    }),
    encodeAbiParameters([{ type: "uint256" }], [value]),
  );
}
function correctLogs(input: ReserveAction): ReceiptLog[] {
  if (input.kind === "approve" || input.kind === "revoke")
    return [approval(BigInt(input.amountUnits))];
  return input.kind === "supply"
    ? [supply(), transfer(owner, RESERVE.aUsdc)]
    : [withdraw(), transfer(RESERVE.aUsdc, owner)];
}

/** Only the public-client methods used by the service exist; there is no broadcaster. */
function harness(input = action()) {
  const expected = reserveTransaction(input);
  const calls: { method: string; args?: unknown }[] = [];
  const data = {
    chainId: 42161,
    canonicalHash: blockHash,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    usdc: 100_000_000n,
    aUsdc: 50_000_000n,
    native: 10n ** 16n,
    allowance: amount,
    debt: 0n,
    config: active,
    underlying: RESERVE.usdc as Address,
    aTokenPool: RESERVE.pool as Address,
    gas: 100_000n,
    gasPrice: 10_000_000n,
    receipt: {
      status: "success" as "success" | "reverted",
      transactionHash: hash,
      blockHash,
      blockNumber: 500n,
      gasUsed: 80_000n,
      effectiveGasPrice: 10_000_000n,
      logs: correctLogs(input),
    },
    transaction: {
      from: owner as Address,
      to: expected.to as Address | null,
      input: expected.data,
      value: 0n,
      chainId: 42161,
      blockHash: blockHash as Hash | null,
      nonce: 7,
    },
    fail: new Map<string, Error>(),
  };
  function record(method: string, args?: unknown) {
    calls.push({ method, args });
    const error = data.fail.get(method);
    if (error) throw error;
  }
  const methods = {
    async getChainId() {
      record("getChainId");
      return data.chainId;
    },
    async getBlock(args: { blockNumber?: bigint; blockTag?: string }) {
      record("getBlock", args);
      return {
        number: args.blockNumber ?? 500n,
        hash: data.canonicalHash,
        timestamp: data.timestamp,
      };
    },
    async getBalance(args: unknown) {
      record("getBalance", args);
      return data.native;
    },
    async readContract(args: {
      address: Address;
      functionName: string;
      args?: readonly unknown[];
      blockNumber?: bigint;
    }) {
      record("readContract", args);
      const key = `${args.address.toLowerCase()}:${args.functionName}`;
      switch (key) {
        case `${RESERVE.usdc}:balanceOf`:
          return data.usdc;
        case `${RESERVE.aUsdc}:balanceOf`:
          return data.aUsdc;
        case `${RESERVE.usdc}:allowance`:
          return data.allowance;
        case `${RESERVE.pool}:getUserAccountData`:
          return [0n, data.debt, 0n, 0n, 0n, 0n];
        case `${RESERVE.pool}:getConfiguration`:
          return { data: data.config };
        case `${RESERVE.aUsdc}:UNDERLYING_ASSET_ADDRESS`:
          return data.underlying;
        case `${RESERVE.aUsdc}:POOL`:
          return data.aTokenPool;
        default:
          throw new Error(`Unexpected contract read: ${key}`);
      }
    },
    async estimateGas(args: unknown) {
      record("estimateGas", args);
      return data.gas;
    },
    async getGasPrice() {
      record("getGasPrice");
      return data.gasPrice;
    },
    async getTransactionReceipt(args: unknown) {
      record("getTransactionReceipt", args);
      return data.receipt;
    },
    async getTransaction(args: unknown) {
      record("getTransaction", args);
      return data.transaction;
    },
  };
  // viem's generic RPC return types contain fields not consumed by this service.
  // Keep fake inputs/used fields typed, and fail if a new or mutating method is accessed.
  const client = new Proxy(methods, {
    get(target, property) {
      if (!(property in target))
        throw new Error(`Forbidden client method: ${String(property)}`);
      return Reflect.get(target, property);
    },
  }) as unknown as ReserveClient;
  return { data, calls, service: createReserveService(client) };
}

test("reserve calldata has fixed Arbitrum destinations, owner beneficiary, exact amounts and zero ETH value", () => {
  assert.deepEqual(RESERVE, {
    chainId: 42161,
    usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
    aUsdc: "0x724dc807b04555b71ed48a6896b6f41593b8c637",
    pool: "0x794a61358d6845594f94dc1db02a252b5b4814ad",
  });
  for (const kind of ["approve", "supply", "withdraw", "revoke"] as const) {
    const tx = reserveTransaction(action(kind));
    assert.equal(tx.chainId, 42161);
    assert.equal(tx.value, 0n);
    const isApproval = kind === "approve" || kind === "revoke";
    assert.equal(tx.to, isApproval ? RESERVE.usdc : RESERVE.pool);
    const decoded = decodeFunctionData({
      abi: [...tokenAbi, ...poolAbi],
      data: tx.data,
    });
    assert.equal(decoded.functionName, isApproval ? "approve" : kind);
    assert.deepEqual(
      decoded.args,
      isApproval
        ? [getAddress(RESERVE.pool), kind === "revoke" ? 0n : amount]
        : kind === "supply"
          ? [getAddress(RESERVE.usdc), amount, owner, 0]
          : [getAddress(RESERVE.usdc), amount, owner],
    );
  }
});

test("USDC text conversion is exact to six decimals and rejects rounding, exponent notation and the cap", () => {
  for (const [text, units] of [
    ["0.000001", "1"],
    ["12.345678", "12345678"],
    ["999.999999", "999999999"],
    ["1000.000000", "1000000000"],
    ["0012.34", "12340000"],
  ])
    assert.equal(parseUsdc(text), units);
  for (const text of [
    "",
    "0",
    "0.000000",
    "-1",
    "+1",
    " 1",
    "1 ",
    ".1",
    "1.",
    "1e2",
    "1,000",
    "0.0000001",
    "12.3456789",
    "1000.000001",
    "1001",
    "10000",
  ])
    assert.equal(parseUsdc(text), null, text);
});

test("action schema rejects zero, overflow, unsafe owners and executable injection", () => {
  assert.equal(
    ActionSchema.parse({ ...action(), amountUnits: "1000000000" }).amountUnits,
    "1000000000",
  );
  assert.equal(ActionSchema.parse(action("revoke")).amountUnits, "0");
  for (const amountUnits of [
    "0",
    "1000000001",
    "9999999999999",
    "-1",
    "1.5",
    "1e6",
  ])
    assert.equal(
      ActionSchema.safeParse({ ...action(), amountUnits }).success,
      false,
      amountUnits,
    );
  assert.equal(
    ActionSchema.safeParse({ ...action("revoke"), amountUnits: "1" }).success,
    false,
  );
  for (const extra of [
    { to: stranger },
    { data: "0x1234" },
    { chainId: 1 },
    { value: "1" },
  ])
    assert.equal(
      ActionSchema.safeParse({ ...action(), ...extra }).success,
      false,
    );
  for (const value of [
    "0x0000000000000000000000000000000000000000",
    "0x1234",
    "not-an-address",
  ])
    assert.equal(OwnerSchema.safeParse(value).success, false);
});

test("supply requires exact allowance, enough USDC, zero debt and the same wallet", () => {
  assert.doesNotThrow(() => assertReserveAction(action(), state()));
  for (const allowanceUnits of [
    "0",
    (amount - 1n).toString(),
    (amount + 1n).toString(),
  ])
    assert.throws(
      () => assertReserveAction(action(), { ...state(), allowanceUnits }),
      /Approve exactly/,
    );
  assert.throws(
    () =>
      assertReserveAction(action(), {
        ...state(),
        usdcUnits: (amount - 1n).toString(),
      }),
    /Add enough/,
  );
  assert.throws(
    () => assertReserveAction(action(), { ...state(), supplyAvailable: false }),
    /supply is currently unavailable/,
  );
  assert.throws(
    () => assertReserveAction(action(), { ...state(), owner: stranger }),
    /wallet changed/,
  );
  for (const kind of ["approve", "supply", "withdraw"] as const)
    assert.throws(
      () => assertReserveAction(action(kind), { ...state(), debtBase: "1" }),
      /without debt/,
    );
});

test("withdrawal is bounded by supplied balance; revocation remains available when investing is blocked", () => {
  assert.doesNotThrow(() =>
    assertReserveAction(action("withdraw"), {
      ...state(),
      allowanceUnits: "0",
      usdcUnits: "0",
      supplyAvailable: false,
    }),
  );
  assert.throws(
    () =>
      assertReserveAction(action("withdraw"), {
        ...state(),
        aUsdcUnits: (amount - 1n).toString(),
      }),
    /supplied USDC balance/,
  );
  assert.throws(
    () =>
      assertReserveAction(action("withdraw"), {
        ...state(),
        withdrawAvailable: false,
      }),
    /withdrawals are currently unavailable/,
  );
  assert.doesNotThrow(() =>
    assertReserveAction(action("revoke"), {
      ...state(),
      debtBase: "100",
      usdcUnits: "0",
      aUsdcUnits: "0",
      allowanceUnits: "999",
      supplyAvailable: false,
      withdrawAvailable: false,
    }),
  );
});

test("snapshot pins balances, allowance, identity and configuration reads to the requested block", async () => {
  const { service, calls } = harness();
  const snapshot = await service.snapshot(owner, 498n);
  assert.equal(snapshot.blockNumber, "498");
  assert.equal(snapshot.chainId, 42161);
  assert.equal(snapshot.blockHash, blockHash);
  assert.equal(snapshot.allowanceUnits, amount.toString());
  assert.deepEqual(calls.find((c) => c.method === "getBlock")?.args, {
    blockNumber: 498n,
  });
  const reads = calls.filter(
    (c) => c.method === "readContract" || c.method === "getBalance",
  );
  assert.equal(reads.length, 8);
  assert.ok(
    reads.every(
      (c) => (c.args as { blockNumber: bigint }).blockNumber === 498n,
    ),
  );
});

test("reserve flags distinguish frozen supply from paused or inactive withdrawals", async () => {
  for (const [config, supplyAvailable, withdrawAvailable] of [
    [active, true, true],
    [active | (1n << 57n), false, true],
    [active | (1n << 60n), false, false],
    [0n, false, false],
  ] as const) {
    const { data, service } = harness();
    data.config = config;
    const snapshot = await service.snapshot(owner);
    assert.equal(snapshot.supplyAvailable, supplyAvailable);
    assert.equal(snapshot.withdrawAvailable, withdrawAvailable);
    if (!supplyAvailable)
      await assert.rejects(
        service.prepare(action()),
        /supply is currently unavailable/,
      );
    if (!withdrawAvailable)
      await assert.rejects(
        service.prepare(action("withdraw")),
        /withdrawals are currently unavailable/,
      );
  }
});

test("snapshot refuses a wrong chain or aToken identity", async () => {
  for (const field of ["chainId", "underlying", "aTokenPool"] as const) {
    const { data, service, calls } = harness();
    if (field === "chainId") data.chainId = 1;
    else data[field] = stranger;
    await assert.rejects(service.snapshot(owner), /Arbitrum One|identity/);
    if (field === "chainId")
      assert.deepEqual(
        calls.map((c) => c.method),
        ["getChainId"],
      );
  }
});

test("prepare simulates only reconstructed calldata and reserves a 20% gas margin", async (t) => {
  const now = 1_800_000_000_000;
  t.mock.timers.enable({ apis: ["Date"], now });
  const { service, calls } = harness();
  const prepared = await service.prepare(action());
  assert.equal(prepared.expiresAt, now + 60_000);
  assert.equal(prepared.estimatedGasWei, "1200000000000");
  const tx = reserveTransaction(action());
  assert.deepEqual(calls.find((c) => c.method === "estimateGas")?.args, {
    account: owner,
    to: tx.to,
    data: tx.data,
    value: tx.value,
  });
});

test("prepare refuses stale/future state, gas shortage and failed official simulation", async () => {
  for (const offset of [-100n, 100n]) {
    const { data, service, calls } = harness();
    data.timestamp += offset;
    await assert.rejects(service.prepare(action()), /state is stale/);
    assert.equal(
      calls.some((c) => c.method === "estimateGas"),
      false,
    );
  }
  const poor = harness();
  poor.data.native = 1_199_999_999_999n;
  await assert.rejects(poor.service.prepare(action()), /Add ETH/);
  const failing = harness();
  failing.data.fail.set("estimateGas", new Error("official cap exceeded"));
  await assert.rejects(
    failing.service.prepare(action()),
    /official cap exceeded/,
  );
});

test("verification requires successful exact approval, supply+transfer or withdrawal+transfer events", async () => {
  for (const kind of ["approve", "revoke", "supply", "withdraw"] as const) {
    const { service, calls } = harness(action(kind));
    const result = await service.verify(action(kind), hash);
    assert.equal(result.status, "verified", kind);
    assert.equal(result.hash, hash);
    assert.equal(result.networkFeeWei, "800000000000");
    assert.equal(result.after.blockHash, blockHash);
    assert.match(result.finality, /not Ethereum finality/);
    assert.deepEqual(calls.find((c) => c.method === "getBlock")?.args, {
      blockNumber: 500n,
    });
  }
});

test("protocol events without the matching native-USDC transfer never verify supply or withdrawal", async () => {
  for (const kind of ["supply", "withdraw"] as const) {
    const from = kind === "supply" ? owner : RESERVE.aUsdc;
    const to = kind === "supply" ? RESERVE.aUsdc : owner;
    for (const badTransfer of [
      null,
      transfer(stranger, to),
      transfer(from, stranger),
      transfer(from, to, amount + 1n),
      { ...transfer(from, to), address: RESERVE.aUsdc },
    ]) {
      const { data, service } = harness(action(kind));
      data.receipt.logs = [
        kind === "supply" ? supply() : withdraw(),
        ...(badTransfer ? [badTransfer] : []),
      ];
      assert.equal(
        (await service.verify(action(kind), hash)).status,
        "effect-unverified",
      );
    }
  }
});

test("transfers and lookalike protocol events cannot falsely verify a financial effect", async () => {
  for (const kind of ["supply", "withdraw"] as const) {
    const events =
      kind === "supply"
        ? [
            null,
            supply(stranger),
            supply(owner, stranger),
            supply(owner, owner, amount + 1n),
            supply(owner, owner, amount, stranger),
            { ...supply(), address: stranger },
          ]
        : [
            null,
            withdraw(stranger),
            withdraw(owner, stranger),
            withdraw(owner, owner, amount + 1n),
            withdraw(owner, owner, amount, stranger),
            { ...withdraw(), address: stranger },
          ];
    for (const event of events) {
      const { data, service } = harness(action(kind));
      data.receipt.logs = [
        ...(event ? [event] : []),
        kind === "supply"
          ? transfer(owner, RESERVE.aUsdc)
          : transfer(RESERVE.aUsdc, owner),
      ];
      assert.equal(
        (await service.verify(action(kind), hash)).status,
        "effect-unverified",
      );
    }
  }
});

test("approval verification rejects wrong owner, spender, amount, token, missing event and nonzero revocation", async () => {
  for (const event of [
    null,
    approval(amount, stranger),
    approval(amount, owner, stranger),
    approval(amount + 1n),
    { ...approval(), address: RESERVE.aUsdc },
  ]) {
    const { data, service } = harness(action("approve"));
    data.receipt.logs = event ? [event] : [];
    assert.equal(
      (await service.verify(action("approve"), hash)).status,
      "effect-unverified",
    );
  }
  const { data, service } = harness(action("revoke"));
  data.receipt.logs = [approval(1n)];
  assert.equal(
    (await service.verify(action("revoke"), hash)).status,
    "effect-unverified",
  );
});

test("wrong sender, destination, calldata, value or chain cannot be rescued by valid receipt events", async () => {
  const mutations: ((h: ReturnType<typeof harness>) => void)[] = [
    (h) => {
      h.data.transaction.from = stranger;
    },
    (h) => {
      h.data.transaction.to = stranger;
    },
    (h) => {
      h.data.transaction.to = null;
    },
    (h) => {
      h.data.transaction.input = reserveTransaction({
        ...action(),
        amountUnits: (amount + 1n).toString(),
      }).data;
    },
    (h) => {
      h.data.transaction.value = 1n;
    },
    (h) => {
      h.data.transaction.chainId = 1;
    },
    (h) => {
      h.data.chainId = 1;
    },
  ];
  for (const mutate of mutations) {
    const h = harness();
    mutate(h);
    await assert.rejects(
      h.service.verify(action(), hash),
      /exact operation|Arbitrum One/,
    );
  }
});

test("receipt identity, canonical block and reverted status prevent false success", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => {
      h.data.receipt.transactionHash = otherHash;
    },
    (h: ReturnType<typeof harness>) => {
      h.data.transaction.blockHash = otherHash;
    },
    (h: ReturnType<typeof harness>) => {
      h.data.transaction.blockHash = null;
    },
    (h: ReturnType<typeof harness>) => {
      h.data.canonicalHash = otherHash;
    },
  ]) {
    const h = harness();
    mutate(h);
    await assert.rejects(
      h.service.verify(action(), hash),
      /reported block|reorganized/,
    );
  }
  const reverted = harness();
  reverted.data.receipt.status = "reverted";
  assert.equal(
    (await reverted.service.verify(action(), hash)).status,
    "reverted",
  );
  const empty = harness();
  empty.data.receipt.logs = [];
  assert.equal(
    (await empty.service.verify(action(), hash)).status,
    "effect-unverified",
  );
});

const url = `http://localhost/api/privy/v1/reserve?owner=${owner}`;
const request = (body: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("HTTP exposes read/simulate/verify operations only and returns uncached confirmed evidence", async () => {
  const { service, calls } = harness();
  const handlers = createReserveHandlers(service);
  for (const response of [
    await handlers.GET(new Request(url)),
    await handlers.POST(request({ operation: "prepare", action: action() })),
    await handlers.POST(
      request({ operation: "verify", action: action(), hash }),
    ),
  ]) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.ok(
    calls.every((c) =>
      [
        "getChainId",
        "getBlock",
        "getBalance",
        "readContract",
        "estimateGas",
        "getGasPrice",
        "getTransactionReceipt",
        "getTransaction",
      ].includes(c.method),
    ),
  );
  assert.equal(
    (
      await handlers.POST(
        request({ operation: "sendTransaction", action: action() }),
      )
    ).status,
    400,
  );
});

test("HTTP rejects extra fields, unsafe destinations, invalid identities and malformed bodies before RPC", async () => {
  const { service, calls } = harness();
  const handlers = createReserveHandlers(service);
  for (const body of [
    {},
    null,
    { operation: "prepare", action: action(), privateKey: "not-a-key" },
    { operation: "prepare", action: { ...action(), to: stranger } },
    { operation: "prepare", action: { ...action(), chainId: 1 } },
    { operation: "verify", action: action(), hash: "0x1234" },
    { operation: "verify", action: action(), hash, transaction: {} },
    {
      operation: "prepare",
      action: {
        ...action(),
        owner: "0x0000000000000000000000000000000000000000",
      },
    },
    {
      operation: "prepare",
      action: { ...action(), amountUnits: "1000000001" },
    },
    { operation: "prepare", action: { ...action(), amountUnits: "1.5" } },
    { operation: "prepare", action: { ...action(), amountUnits: "1e6" } },
  ])
    assert.equal((await handlers.POST(request(body))).status, 400);
  assert.equal(
    (await handlers.POST(new Request(url, { method: "POST", body: "{" })))
      .status,
    400,
  );
  assert.equal(
    (await handlers.GET(new Request("http://localhost/api/privy/v1/reserve")))
      .status,
    400,
  );
  assert.equal(
    (
      await handlers.GET(
        new Request("http://localhost/api/privy/v1/reserve?owner=bad"),
      )
    ).status,
    400,
  );
  assert.equal(calls.length, 0);
});

test("HTTP enforces actual streamed body size even when content-length is absent or misleading", async () => {
  const { service, calls } = harness();
  const handlers = createReserveHandlers(service);
  for (const headers of [
    {},
    { "content-length": "1" },
    { "content-length": "99999" },
  ]) {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(2049)));
        controller.close();
      },
    });
    const raw = new Request(url, {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit);
    assert.equal((await handlers.POST(raw)).status, 413);
  }
  assert.equal(calls.length, 0);
});

test("HTTP distinguishes missing receipts from reverts and redacts provider errors", async () => {
  for (const [method, name] of [
    ["getTransactionReceipt", "TransactionReceiptNotFoundError"],
    ["getTransaction", "TransactionNotFoundError"],
  ]) {
    const h = harness();
    h.data.fail.set(
      method,
      Object.assign(new Error("provider secret"), { name }),
    );
    const response = await createReserveHandlers(h.service).POST(
      request({ operation: "verify", action: action(), hash }),
    );
    assert.equal(response.status, 202);
    assert.equal((await response.json()).status, "pending");
  }
  const reverted = harness();
  reverted.data.receipt.status = "reverted";
  const response = await createReserveHandlers(reverted.service).POST(
    request({ operation: "verify", action: action(), hash }),
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "reverted");
  const unavailable = harness();
  unavailable.data.fail.set(
    "getChainId",
    new Error("https://provider.invalid/private-secret"),
  );
  const handlers = createReserveHandlers(unavailable.service);
  for (const response of [
    await handlers.GET(new Request(url)),
    await handlers.POST(request({ operation: "prepare", action: action() })),
    await handlers.POST(
      request({ operation: "verify", action: action(), hash }),
    ),
  ]) {
    assert.ok([422, 503].includes(response.status));
    assert.doesNotMatch(
      await response.text(),
      /provider\.invalid|private-secret/,
    );
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  keccak256,
  zeroAddress,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import factoryArtifact from "../../public/aqua/position-factory-artifact.json";
import adapterArtifact from "../../public/aqua/inventory-adapter-artifact.json";
import quoterArtifact from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import routerArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import {
  createLaunchService,
  type LaunchClient,
  type LaunchRuntime,
} from "../../src/integrations/aqua/launch-service";
import {
  LAUNCH,
  LaunchPreparedSchema,
  LaunchRequestSchema,
  assertPreparedLaunch,
  launchAccountAbi,
  launchFactoryAbi,
  launchManifestHash,
  launchOrder,
  launchPoolAbi,
  launchTokenAbi,
  launchTransaction,
  type LaunchIntent,
  type LaunchPrepared,
  type LaunchRequest,
} from "../../src/integrations/aqua/launch-contract";
import { createLaunchHandlers } from "../../src/integrations/aqua/launch-http";
import { createPositionService } from "../../src/integrations/aqua/position-service";
import type { AquaResponse } from "../../src/integrations/aqua/contract";

const recorded: AquaResponse = JSON.parse(
  readFileSync("examples/aqua/response.recorded.json", "utf8"),
);
const now = Date.parse(recorded.evaluatedAt),
  indexed = BigInt(recorded.recommendation!.report.source.blockNumber),
  blockNumber = indexed + 10n;
const owner = getAddress("0x00000000000000000000000000000000000a11ce"),
  other = getAddress("0x0000000000000000000000000000000000000b0b"),
  account = getAddress("0x1000000000000000000000000000000000000001"),
  factory = getAddress("0x2000000000000000000000000000000000000002"),
  adapter = getAddress("0x3000000000000000000000000000000000000003");
const hash = `0x${"f".repeat(64)}` as Hex,
  id = `0x${"e".repeat(64)}` as Hex;
const bh = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}` as Hex;
const intent: LaunchIntent = {
  fundingAsset: "USDC",
  collateralAmountUnits: "2500000000",
  safetyHFWad: "1400000000000000000",
  comfortableHFWad: "2000000000000000000",
  financingMode: "aave_collateral_then_borrow_usdc",
};
const abi = [
  ...launchFactoryAbi,
  ...launchAccountAbi,
  ...launchTokenAbi,
  ...launchPoolAbi,
] as const;
function event(address: Address, name: string, args: Record<string, unknown>) {
  const item = abi.find((x) => x.type === "event" && x.name === name);
  if (!item || item.type !== "event") throw new Error(name);
  return {
    address,
    topics: encodeEventTopics({
      abi: abi as Abi,
      eventName: name,
      args,
    }) as Hex[],
    data: encodeAbiParameters(
      item.inputs.filter((x) => !("indexed" in x && x.indexed)),
      item.inputs
        .filter((x) => !("indexed" in x && x.indexed))
        .map((x) => args[x.name]) as never,
    ),
    blockNumber: blockNumber + 1n,
    blockHash: bh(blockNumber + 1n),
    transactionHash: hash,
    transactionIndex: 0,
    logIndex: 0,
    removed: false,
  };
}
function harness() {
  const calls: string[] = [];
  const data = {
    configured: true,
    latest: account as Address,
    registered: true,
    accountOwner: owner,
    phase: 0,
    principal: 0n,
    debt: 0n,
    receiptUnits: 0n,
    lpWeth: 0n,
    lpUsdc: 0n,
    positionWeth: 0n,
    positionUsdc: 0n,
    walletUsdc: 10_000_000_000n,
    walletWeth: 10n ** 18n,
    native: 10n ** 18n,
    allowance: BigInt(intent.collateralAmountUnits),
    collateral: LAUNCH.usdc as Address,
    manifest: launchManifestHash(owner, intent),
    safety: BigInt(intent.safetyHFWad),
    comfortable: BigInt(intent.comfortableHFWad),
    health: 2n * 10n ** 18n,
    cycle: 0n,
    nonce: 0n,
    strategy: `0x${"0".repeat(64)}` as Hex,
    virtualCount: 2,
    quote: BigInt(recorded.recommendation!.targetInventory.wethAmountRaw),
    defenseQuote: 20_000_000n,
    capacity: 1_000_000_000n,
    gas: 100_000n,
    gasPrice: 10n,
    poolCanonical: true,
    codeOverrides: new Map<string, Hex>(),
    protocolUsdc: LAUNCH.usdc as Address,
    existing: false,
    failCall: false,
    failRead: "",
  };
  let transaction: Record<string, unknown> = {},
    receipt: Record<string, unknown> = {};
  const code = (address: string): Hex =>
    data.codeOverrides.get(address.toLowerCase()) ??
    (address.toLowerCase() === factory.toLowerCase()
      ? (factoryArtifact.runtimeBytecode as Hex)
      : address.toLowerCase() === adapter.toLowerCase()
        ? "0x600a"
        : address.toLowerCase() === LAUNCH.uniswapRouter.toLowerCase()
          ? "0x600b"
          : address.toLowerCase() === LAUNCH.quoter.toLowerCase()
            ? "0x600c"
            : "0x600d");
  const client = {
    getChainId: async () => 42161,
    getBlockNumber: async () => blockNumber,
    getBlock: async (args: { blockNumber?: bigint }) => ({
      number: args.blockNumber ?? blockNumber,
      hash: bh(args.blockNumber ?? blockNumber),
      timestamp: BigInt(now / 1000),
    }),
    getCode: async ({ address }: { address: string }) => code(address),
    getBalance: async () => data.native,
    readContract: async ({
      address,
      functionName,
      args,
    }: {
      address: string;
      functionName: string;
      args?: readonly unknown[];
    }) => {
      calls.push(functionName);
      if (functionName === data.failRead) throw new Error("Read unavailable");
      if (functionName === "protocols")
        return {
          weth: LAUNCH.weth,
          usdc: data.protocolUsdc,
          aWeth: LAUNCH.aWeth,
          aUsdc: LAUNCH.aUsdc,
          debtUSDC: LAUNCH.variableDebtUSDC,
          aave: LAUNCH.aavePool,
          aqua: LAUNCH.aqua,
          swapVM: LAUNCH.swapVm,
          adapter,
        };
      if (functionName === "latestPosition") return data.latest;
      if (functionName === "getPosition")
        return data.existing ? account : zeroAddress;
      if (functionName === "isPosition") return data.registered;
      if (functionName === "UNDERLYING_ASSET_ADDRESS")
        return address.toLowerCase() === LAUNCH.aWeth
          ? LAUNCH.weth
          : LAUNCH.usdc;
      if (functionName === "POOL") return LAUNCH.aavePool;
      if (address.toLowerCase() === adapter.toLowerCase())
        return (
          {
            weth: LAUNCH.weth,
            usdc: LAUNCH.usdc,
            router: LAUNCH.uniswapRouter,
            fee: 500,
          } as Record<string, unknown>
        )[functionName];
      if (functionName === "balanceOf") {
        if (address.toLowerCase() === LAUNCH.variableDebtUSDC) return data.debt;
        if (
          address.toLowerCase() === LAUNCH.aUsdc ||
          address.toLowerCase() === LAUNCH.aWeth
        )
          return args![0] === owner ? 0n : data.receiptUnits;
        if (address.toLowerCase() === LAUNCH.weth)
          return args![0] === owner ? data.walletWeth : data.positionWeth;
        return args![0] === owner ? data.walletUsdc : data.positionUsdc;
      }
      if (functionName === "allowance") return data.allowance;
      if (functionName === "rawBalances")
        return [
          args![3] === LAUNCH.weth ? data.lpWeth : data.lpUsdc,
          data.virtualCount,
        ];
      const fields: Record<string, unknown> = {
        owner: data.accountOwner,
        keeper: data.accountOwner,
        weth: LAUNCH.weth,
        usdc: LAUNCH.usdc,
        collateral: data.collateral,
        receiptToken:
          data.collateral === LAUNCH.weth ? LAUNCH.aWeth : LAUNCH.aUsdc,
        debtToken: LAUNCH.variableDebtUSDC,
        aave: LAUNCH.aavePool,
        aqua: LAUNCH.aqua,
        swapVM: LAUNCH.swapVm,
        adapter,
        safetyHF: data.safety,
        comfortableHF: data.comfortable,
        manifestHash: data.manifest,
        phase: data.phase,
        healthFactor: data.health,
        principal: data.principal,
        lpWeth: data.lpWeth,
        lpUsdc: data.lpUsdc,
        cycleId: data.cycle,
        nonce: data.nonce,
        strategyHash: data.strategy,
      };
      if (!(functionName in fields))
        throw new Error(`Unexpected read ${functionName}`);
      return fields[functionName];
    },
    call: async (args: { to?: Address; data: Hex }) => {
      calls.push("call");
      if (!args.to) {
        if (args.data.startsWith(adapterArtifact.creationBytecode))
          return { data: "0x600a" };
        if (args.data.startsWith(routerArtifact.bytecode))
          return { data: "0x600b" };
        if (args.data.startsWith(quoterArtifact.bytecode))
          return { data: "0x600c" };
        throw new Error("Unexpected creation call");
      }
      if (data.failCall) throw new Error("private provider detail");
      return { data: "0x" };
    },
    simulateContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      return {
        result:
          functionName === "swapInventory" ? data.quote : data.defenseQuote,
      };
    },
    estimateGas: async () => data.gas,
    getGasPrice: async () => data.gasPrice,
    getTransaction: async () => transaction,
    getTransactionReceipt: async () => receipt,
  } as unknown as LaunchClient;
  const finance: LaunchRuntime["finance"] = async (i, b) => ({
    intent: i,
    asset: i.fundingAsset === "ETH" ? LAUNCH.weth : LAUNCH.usdc,
    blockNumber: b,
    blockHash: bh(b),
    timestamp: BigInt(now / 1000),
    oracle: LAUNCH.weth,
    terms: {
      collateralUnits: BigInt(i.collateralAmountUnits),
      collateralDecimals: i.fundingAsset === "ETH" ? 18 : 6,
      collateralPriceBase: 100_000_000n,
      usdcPriceBase: 100_000_000n,
      ltvBps: 7500n,
      liquidationThresholdBps: 8000n,
      comfortableHFWad: BigInt(i.comfortableHFWad),
    },
    collateralBase: 250_000_000_000n,
    loanUSDCUnits: data.capacity,
    headroomBps: 50,
    constraint: "comfortable_hf",
  });
  const verifyPool: LaunchRuntime["verifyPool"] = async (pool, b) => ({
    pool,
    chainId: 42161,
    token0: LAUNCH.weth,
    token1: LAUNCH.usdc,
    feeTierPips: recorded.recommendation!.referencePool.feeTier,
    liquidity: "99999999999999",
    spotUSDCPerWethE6: String(
      Math.round(recorded.recommendation!.range.spot * 1e6),
    ),
    blockNumber: String(b),
    blockHash:
      b === indexed ? recorded.recommendation!.report.source.blockHash : bh(b),
    timestamp: new Date(now).toISOString(),
    mode: "rpc",
    canonicalFactoryPool: data.poolCanonical,
  });
  const recommend: LaunchRuntime["recommend"] = async (raw) => {
    const input = raw as AquaResponse["request"],
      result = structuredClone(recorded),
      rec = result.recommendation!;
    result.requestId = input.requestId;
    result.request = input;
    rec.funding.usdcAmountRaw = input.funding.amountRaw;
    for (const key of ["wethAmountRaw", "usdcAmountRaw"] as const)
      rec.targetInventory[key] = String(
        (BigInt(rec.targetInventory[key]) * BigInt(input.funding.amountRaw)) /
          1_000_000_000n,
      );
    rec.report.position.amount0Raw = rec.targetInventory.wethAmountRaw;
    rec.report.position.amount1Raw = rec.targetInventory.usdcAmountRaw;
    return result;
  };
  const service = createLaunchService({
    client,
    factoryAddress: () => (data.configured ? factory : undefined),
    now: () => now,
    finance,
    verifyPool,
    recommend,
    officialRuntimeHashes: {
      [LAUNCH.aqua]: keccak256("0x600d"),
      [LAUNCH.swapVm]: keccak256("0x600d"),
    },
  });
  const plan = () =>
    createPositionService({
      finance: (i) => finance(i, blockNumber),
      verify: verifyPool,
      head: async () => blockNumber,
      now: () => now,
      recommend,
    })({
      schemaVersion: "noria.aqua.position.v1",
      requestId: recorded.requestId,
      intent,
      reviewAfterHours: 6,
    });
  function mined(
    prepared: LaunchPrepared,
    logs: ReturnType<typeof event>[] = [],
  ) {
    const tx = launchTransaction(prepared);
    transaction = {
      hash,
      from: owner,
      to: tx.to,
      input: tx.data,
      value: tx.value,
      chainId: 42161,
      blockNumber: blockNumber + 1n,
      blockHash: bh(blockNumber + 1n),
      nonce: 1,
    };
    receipt = {
      transactionHash: hash,
      from: owner,
      to: tx.to,
      blockNumber: blockNumber + 1n,
      blockHash: bh(blockNumber + 1n),
      status: "success",
      gasUsed: 100_000n,
      effectiveGasPrice: 10n,
      logs,
    };
    return { transaction, receipt };
  }
  return { service, data, calls, plan, mined };
}
const request = (
  kind: LaunchRequest["kind"],
  amountUnits?: string,
): LaunchRequest =>
  LaunchRequestSchema.parse(
    kind === "create"
      ? { kind, owner, id, intent }
      : {
          kind,
          owner,
          account,
          ...(amountUnits === undefined ? {} : { amountUnits }),
        },
  );

test("missing factory returns explicit deployment-required without contacting RPC", async () => {
  const h = harness();
  h.data.configured = false;
  assert.equal((await h.service.snapshot(owner)).status, "deployment-required");
  await assert.rejects(
    h.service.prepare(request("create")),
    /deployment is required/,
  );
  assert.deepEqual(h.calls, []);
});
test("factory code, immutable route and account ownership must be independently verified", async () => {
  for (const mutate of [
    (h: ReturnType<typeof harness>) => {
      h.data.codeOverrides.set(factory.toLowerCase(), "0x6000");
    },
    (h: ReturnType<typeof harness>) => {
      h.data.protocolUsdc = other;
    },
    (h: ReturnType<typeof harness>) => {
      h.data.codeOverrides.set(adapter.toLowerCase(), "0xdead");
    },
    (h: ReturnType<typeof harness>) => {
      h.data.registered = false;
    },
    (h: ReturnType<typeof harness>) => {
      h.data.accountOwner = other;
    },
  ]) {
    const h = harness();
    mutate(h);
    await assert.rejects(h.service.snapshot(owner, account));
  }
});
test("strict requests reject arbitrary targets/calldata, malformed addresses and zero amounts", () => {
  for (const extra of [
    { to: other },
    { data: "0xdead" },
    { chainId: 1 },
    { value: "1" },
  ])
    assert.equal(
      LaunchRequestSchema.safeParse({ ...request("exit"), ...extra }).success,
      false,
    );
  for (const amountUnits of ["0", "-1", "1e18", "0.1", "01"])
    assert.equal(
      LaunchRequestSchema.safeParse({
        kind: "wrap",
        owner,
        account,
        amountUnits,
      }).success,
      false,
    );
  assert.equal(
    LaunchRequestSchema.safeParse({
      ...request("create"),
      id: `0x${"0".repeat(64)}`,
    }).success,
    false,
  );
  assert.equal(
    LaunchRequestSchema.safeParse({ ...request("exit"), owner: "bad" }).success,
    false,
  );
});
test("policy commitment binds owner and original collateral intent, independently of research refresh", () => {
  assert.notEqual(
    launchManifestHash(owner, intent),
    launchManifestHash(other, intent),
  );
  assert.notEqual(
    launchManifestHash(owner, intent),
    launchManifestHash(owner, {
      ...intent,
      collateralAmountUnits: "2500000001",
    }),
  );
  assert.equal(
    launchManifestHash(owner, intent),
    launchManifestHash(owner, { ...intent }),
  );
});
test("creation and exact collateral approvals reconstruct only supported contract calls", async () => {
  const h = harness();
  const p = await h.service.prepare(request("create"));
  assert.equal(
    decodeFunctionData({
      abi: launchFactoryAbi,
      data: launchTransaction(p).data,
    }).functionName,
    "createPosition",
  );
  const approval = await h.service.prepare(
    request("approve-collateral", intent.collateralAmountUnits),
  );
  assert.deepEqual(
    decodeFunctionData({
      abi: launchTokenAbi,
      data: launchTransaction(approval).data,
    }).args,
    [account, BigInt(intent.collateralAmountUnits)],
  );
  h.data.existing = true;
  await assert.rejects(h.service.prepare(request("create")), /already exists/);
});
test("ETH wrap includes both exact native value and buffered network fees", async () => {
  const h = harness();
  h.data.collateral = LAUNCH.weth;
  const r = request("wrap", "1000000");
  h.data.native = 2_199_999n;
  await assert.rejects(h.service.prepare(r), /enough ETH/);
  h.data.native = 2_200_000n;
  const p = await h.service.prepare(r);
  assert.equal(launchTransaction(p).value, 1_000_000n);
  assert.equal(p.estimatedGasWei, "1200000");
});
test("opening requires current safe capacity, exact allowance, owned policy and fresh consistent Graph data", async () => {
  const h = harness(),
    plan = await h.plan();
  const p = await h.service.prepare(request("open"), plan);
  assert.equal(launchTransaction(p).to, account);
  h.data.capacity = 999_999_999n;
  await assert.rejects(
    h.service.prepare(request("open"), plan),
    /exceeds current safe/,
  );
  h.data.capacity = 1_000_000_000n;
  h.data.allowance = 1n;
  await assert.rejects(
    h.service.prepare(request("open"), plan),
    /Approve exactly/,
  );
  h.data.allowance = BigInt(intent.collateralAmountUnits);
  h.data.poolCanonical = false;
  await assert.rejects(
    h.service.prepare(request("open"), plan),
    /Canonical verification/,
  );
  h.data.poolCanonical = true;
  const bad = structuredClone(plan);
  bad.execution!.targetWethUnits = "1";
  await assert.rejects(h.service.prepare(request("open"), bad));
  await assert.rejects(
    h.service.prepare(request("open"), {
      ...plan,
      validUntil: new Date(now - 1).toISOString(),
    }),
  );
  h.data.manifest = launchManifestHash(other, intent);
  await assert.rejects(
    h.service.prepare(request("open"), plan),
    /original collateral intent/,
  );
});
test("review binds request, plan, quote and expiry before any wallet signature", async () => {
  const h = harness(),
    plan = await h.plan(),
    r = request("open"),
    p = await h.service.prepare(r, plan);
  assert.deepEqual(assertPreparedLaunch(p, r, plan, now), p);
  assert.throws(
    () => assertPreparedLaunch({ ...p, expiresAt: now }, r, plan, now),
    /expired/,
  );
  assert.throws(
    () => assertPreparedLaunch(p, { ...r, owner: other }, plan, now),
    /does not match/,
  );
  assert.throws(
    () =>
      assertPreparedLaunch(
        { ...p, plan: { ...p.plan!, loanUSDCUnits: "1" } },
        r,
        plan,
        now,
      ),
    /does not match/,
  );
  assert.equal(
    LaunchPreparedSchema.safeParse({ ...p, data: "0xdead" }).success,
    false,
  );
});
test("conversion uses actual simulated output, 0.5% slippage and the 1% inventory target", async () => {
  const h = harness(),
    plan = await h.plan();
  Object.assign(h.data, {
    phase: 1,
    principal: 1_000_000_000n,
    debt: 1_000_000_000n,
    lpUsdc: 1_000_000_000n,
  });
  const p = await h.service.prepare(request("convert"), plan);
  assert.ok(h.calls.includes("swapInventory"));
  assert.equal(p.quote!.amountUnits, plan.execution!.convertUsdcUnits);
  assert.ok(
    BigInt(p.quote!.minOutUnits) * 10000n >=
      BigInt(p.quote!.quotedOutUnits) * 9950n,
  );
  assert.throws(
    () => launchTransaction({ ...p, quote: { ...p.quote!, minOutUnits: "1" } }),
    /slippage/,
  );
  h.data.quote *= 2n;
  await assert.rejects(
    h.service.prepare(request("convert"), plan),
    /more than 1%/,
  );
});
test("fresh research for a funded account uses existing principal instead of reborrowing or stranding the launch", async () => {
  const h = harness(),
    oldPlan = await h.plan();
  Object.assign(h.data, {
    phase: 1,
    principal: 900_000_000n,
    debt: 900_000_000n,
    lpUsdc: 900_000_000n,
  });
  await assert.rejects(
    h.service.prepare(request("convert"), oldPlan),
    /existing principal/,
  );
  const fresh = await h.service.plan(owner, account, intent);
  assert.equal(fresh.status, "ready-for-local-rehearsal");
  assert.equal(fresh.financing.loanUSDCUnits, "900000000");
  assert.equal(fresh.graph!.request.funding.amountRaw, "900000000");
  h.data.quote = BigInt(fresh.execution!.targetWethUnits);
  assert.equal(
    (await h.service.prepare(request("convert"), fresh)).plan!.loanUSDCUnits,
    "900000000",
  );
});
test("receipt verification matches exact transaction and canonical block rather than trusting success", async () => {
  for (const mutate of [
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.transaction.to = other;
    },
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.transaction.from = other;
    },
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.transaction.input = "0xdead";
    },
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.transaction.value = 1n;
    },
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.transaction.chainId = 1;
    },
    (x: ReturnType<ReturnType<typeof harness>["mined"]>) => {
      x.receipt.blockHash = hash;
    },
  ]) {
    const h = harness(),
      p = await h.service.prepare(
        request("approve-collateral", intent.collateralAmountUnits),
      );
    mutate(h.mined(p));
    await assert.rejects(h.service.verify(p, hash));
  }
});
test("approval events with wrong spender do not count as verified effects; reverts remain explicit", async () => {
  const h = harness(),
    p = await h.service.prepare(
      request("approve-collateral", intent.collateralAmountUnits),
    );
  h.mined(p, [
    event(LAUNCH.usdc, "Approval", {
      owner,
      spender: other,
      value: BigInt(intent.collateralAmountUnits),
    }),
  ]);
  assert.equal((await h.service.verify(p, hash)).status, "effect-unverified");
  const valid = h.mined(p, [
    event(LAUNCH.usdc, "Approval", {
      owner,
      spender: account,
      value: BigInt(intent.collateralAmountUnits),
    }),
  ]);
  assert.equal((await h.service.verify(p, hash)).status, "verified");
  valid.receipt.status = "reverted";
  assert.equal((await h.service.verify(p, hash)).status, "reverted");
});
test("CycleShipped alone never labels a non-Active position Active", async () => {
  const h = harness(),
    plan = await h.plan();
  Object.assign(h.data, {
    phase: 1,
    principal: 1_000_000_000n,
    debt: 1_000_000_000n,
    lpWeth: BigInt(plan.execution!.targetWethUnits),
    lpUsdc: BigInt(plan.execution!.targetUsdcUnits),
  });
  const p = await h.service.prepare(request("ship"), plan),
    order = launchOrder(p);
  h.mined(p, [
    event(account, "CycleShipped", {
      cycleId: 1n,
      strategyHash: order.strategyHash,
      wethAmount: h.data.lpWeth,
      usdcAmount: h.data.lpUsdc,
    }),
  ]);
  assert.equal((await h.service.verify(p, hash)).status, "effect-unverified");
  Object.assign(h.data, { phase: 2, cycle: 1n, strategy: order.strategyHash });
  assert.equal((await h.service.verify(p, hash)).status, "verified");
  h.data.virtualCount = 0;
  await assert.rejects(h.service.verify(p, hash), /without matching Aqua/);
});
test("owner recovery remains verifiable when health is unavailable; stage and simulation gates remain", async () => {
  const h = harness();
  h.data.failRead = "healthFactor";
  h.data.phase = 1;
  h.data.debt = 20_000_000n;
  h.data.failCall = true;
  await assert.rejects(h.service.prepare(request("defend")));
  h.data.failCall = false;
  const defense = await h.service.prepare(request("defend"));
  assert.equal(defense.before.position!.healthFactor, null);
  h.mined(defense, [
    event(account, "Defended", {
      cycleId: 0n,
      repaid: 0n,
      residualDebt: h.data.debt,
      residualWeth: 1_000_000n,
    }),
  ]);
  Object.assign(h.data, { phase: 5, positionWeth: 1_000_000n });
  assert.equal((await h.service.verify(defense, hash)).status, "verified");
  const sale = await h.service.prepare(request("realize-defense"));
  assert.ok(h.calls.includes("quoteExactInputSingle"));
  h.mined(sale, [
    event(account, "InventoryConverted", {
      tokenIn: LAUNCH.weth,
      amountIn: 1_000_000n,
      amountOut: h.data.defenseQuote,
    }),
    event(account, "Defended", {
      cycleId: 0n,
      repaid: 10_000_000n,
      residualDebt: 10_000_000n,
      residualWeth: 0n,
    }),
  ]);
  Object.assign(h.data, {
    positionWeth: 0n,
    debt: 10_000_000n,
    allowance: 10_000_000n,
  });
  assert.equal((await h.service.verify(sale, hash)).status, "verified");
  await assert.rejects(
    h.service.prepare(request("exit")),
    /Repay all remaining/,
  );
  const repay = await h.service.prepare(request("repay", "10000000"));
  h.mined(repay, [
    event(LAUNCH.usdc, "Transfer", {
      from: owner,
      to: account,
      value: 10_000_000n,
    }),
    event(LAUNCH.aavePool, "Repay", {
      reserve: LAUNCH.usdc,
      user: account,
      repayer: account,
      amount: 10_000_000n,
      useATokens: false,
    }),
  ]);
  h.data.debt = 0n;
  assert.equal((await h.service.verify(repay, hash)).status, "verified");
  const exit = await h.service.prepare(request("exit"));
  h.mined(exit, [
    event(account, "Closed", {
      collateralReturned: 0n,
      usdcReturned: 0n,
      wethReturned: 0n,
    }),
  ]);
  h.data.phase = 6;
  assert.equal((await h.service.verify(exit, hash)).status, "verified");
  assert.ok(
    (await h.service.prepare(request("unwrap", "1"))).request.kind === "unwrap",
  );
});
test("unavailable health blocks new exposure without masking mandatory read failures", async () => {
  const h = harness();
  h.data.failRead = "healthFactor";
  for (const kind of ["open", "convert", "ship"] as const) {
    await assert.rejects(
      h.service.prepare(request(kind), await h.plan()),
      /Health factor is unavailable/,
    );
  }
  for (const field of [
    "owner",
    "phase",
    "balanceOf",
    "isPosition",
    "rawBalances",
  ]) {
    h.data.failRead = field;
    h.data.phase = 2;
    await assert.rejects(h.service.snapshot(owner), /Read unavailable/);
  }
});
test("HTTP bounds input, exposes pending deployment and redacts raw provider failures", async () => {
  const h = harness(),
    handlers = createLaunchHandlers(h.service),
    url = `http://localhost/api/aqua/v1/launch?owner=${owner}`;
  h.data.configured = false;
  assert.equal(
    (await (await handlers.GET(new Request(url))).json()).status,
    "deployment-required",
  );
  const post = (body: unknown) =>
    handlers.POST(
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post({ operation: "prepare", request: request("create") })).status,
    409,
  );
  assert.equal(
    (await post({ operation: "broadcast", request: request("exit") })).status,
    400,
  );
  assert.equal(
    (
      await post({
        operation: "prepare",
        request: request("create"),
        junk: "x".repeat(524288),
      })
    ).status,
    413,
  );
  h.data.configured = true;
  h.data.failCall = true;
  const response = await post({
    operation: "prepare",
    request: request("create"),
  });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private provider detail/);
});

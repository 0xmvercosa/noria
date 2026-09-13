import {
  createPublicClient,
  encodeDeployData,
  encodeFunctionData,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import { arbitrum } from "viem/chains";
import { quoteFinancing } from "@noria/aqua/financing";
import { verifySourcePool } from "@noria/aqua/verifier";
import { parseRehearsalPlan } from "@noria/aqua/rehearsal-plan";
import type { CanonicalEvidence } from "@noria/aqua/boundary";
import quoterArtifact from "@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json";
import routerArtifact from "@uniswap/v3-periphery/artifacts/contracts/SwapRouter.sol/SwapRouter.json";
import factoryArtifact from "../../../public/aqua/position-factory-artifact.json";
import adapterArtifact from "../../../public/aqua/inventory-adapter-artifact.json";
import { createPositionService } from "./position-service";
import { recommendForAqua } from "./service";
import {
  LAUNCH,
  LaunchAddressSchema,
  LaunchError,
  LaunchHashSchema,
  LaunchIntentSchema,
  LaunchPreparedSchema,
  LaunchReadySnapshotSchema,
  LaunchRequestSchema,
  assertLaunchState,
  assertPreparedLaunch,
  launchAccountAbi,
  launchFactoryAbi,
  launchManifestHash,
  launchOrder,
  launchPoolAbi,
  launchTokenAbi,
  launchTransaction,
  summarizeLaunchPlan,
  withinLaunchTarget,
  type LaunchIntent,
  type LaunchPosition,
  type LaunchPrepared,
  type LaunchReadySnapshot,
  type LaunchRequest,
  type LaunchSnapshot,
} from "./launch-contract";

const rpcUrl = () =>
  process.env.ARBITRUM_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
export function createLaunchClient() {
  return createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl(), { timeout: 15_000, retryCount: 1 }),
  });
}
export type LaunchClient = ReturnType<typeof createLaunchClient>;
type Financing = Awaited<ReturnType<typeof quoteFinancing>>;
export type LaunchRuntime = {
  client: LaunchClient;
  factoryAddress: () => string | undefined;
  now: () => number;
  finance: (intent: LaunchIntent, block: bigint) => Promise<Financing>;
  verifyPool: (pool: Address, block: bigint) => Promise<CanonicalEvidence>;
  recommend: typeof recommendForAqua;
  officialRuntimeHashes: Readonly<Record<string, Hash>>;
};
const same = (a: string | null | undefined, b: string) =>
  a?.toLowerCase() === b.toLowerCase();
const abs = (a: bigint, b: bigint) => (a > b ? a - b : b - a);
const ceiling = (value: bigint, denominator: bigint) =>
  (value + denominator - 1n) / denominator;
const notReady = () =>
  new LaunchError(
    "deployment-required",
    "A verified Aqua PositionFactory deployment is required. Configure NORIA_AQUA_FACTORY_ADDRESS before signing launch operations.",
  );
const fail = (
  condition: boolean,
  message: string,
  code = "verification-failed",
) => {
  if (!condition) throw new LaunchError(code, message);
};
const factoryExpected = {
  weth: LAUNCH.weth,
  usdc: LAUNCH.usdc,
  aWeth: LAUNCH.aWeth,
  aUsdc: LAUNCH.aUsdc,
  debtUSDC: LAUNCH.variableDebtUSDC,
  aave: LAUNCH.aavePool,
  aqua: LAUNCH.aqua,
  swapVM: LAUNCH.swapVm,
};
const officialRuntimeHashes: Record<string, Hash> = {
  [LAUNCH.aqua]:
    "0x720bc02d220db318164dc3bade86eec1f3655bdc00fc1174de7d816a95c341f8",
  [LAUNCH.swapVm]:
    "0x7cb8785de84b35bced79fbecbbc6336f473623568cba28b7af3ed001b20d580e",
};
const aquaAbi = parseAbi([
  "function rawBalances(address maker,address app,bytes32 hash,address token) view returns(uint248,uint8)",
]);
const pairAbi = parseAbi([
  "function weth() view returns(address)",
  "function usdc() view returns(address)",
  "function router() view returns(address)",
  "function fee() view returns(uint24)",
]);
const quoterAbi = parseAbi([
  "function quoteExactInputSingle(address tokenIn,address tokenOut,uint24 fee,uint256 amountIn,uint160 sqrtPriceLimitX96) returns(uint256 amountOut)",
]);

/** No signer or broadcaster exists in this module. All state changes remain wallet requests. */
export function createLaunchService(overrides: Partial<LaunchRuntime> = {}) {
  const runtime: LaunchRuntime = {
    client: createLaunchClient(),
    factoryAddress: () => process.env.NORIA_AQUA_FACTORY_ADDRESS?.trim(),
    now: Date.now,
    finance: (intent, block) => quoteFinancing(intent, rpcUrl(), block),
    verifyPool: (pool, block) => verifySourcePool(rpcUrl(), pool, block),
    recommend: recommendForAqua,
    officialRuntimeHashes,
    ...overrides,
  };
  const client = runtime.client;
  async function expectedRuntime(
    abi: Abi,
    bytecode: Hex,
    args: readonly unknown[],
    blockNumber: bigint,
  ) {
    // eth_call of creation code returns the exact constructor-patched runtime without deploying.
    const result = await client.call({
      data: encodeDeployData({ abi, bytecode, args }),
      blockNumber,
    });
    fail(
      !!result.data && result.data != "0x",
      "The reviewed constructor runtime could not be derived.",
    );
    return result.data!;
  }
  async function matchRuntime(
    address: Address,
    abi: Abi,
    bytecode: Hex,
    args: readonly unknown[],
    blockNumber: bigint,
  ) {
    const [actual, expected] = await Promise.all([
      client.getCode({ address, blockNumber }),
      expectedRuntime(abi, bytecode, args, blockNumber),
    ]);
    fail(
      !!actual && actual !== "0x" && keccak256(actual!) === keccak256(expected),
      "A configured protocol runtime does not match the reviewed implementation.",
    );
    return keccak256(actual!);
  }
  async function deployment(blockNumber: bigint) {
    const configured = runtime.factoryAddress();
    if (!configured) throw notReady();
    const factory = LaunchAddressSchema.parse(configured);
    const code = await client.getCode({ address: factory, blockNumber });
    fail(
      !!code &&
        code !== "0x" &&
        keccak256(code!) === factoryArtifact.runtimeCodeHash,
      "The configured factory runtime is not the reviewed PositionFactory.",
    );
    const protocols = await client.readContract({
      address: factory,
      abi: launchFactoryAbi,
      functionName: "protocols",
      blockNumber,
    });
    for (const [key, value] of Object.entries(factoryExpected))
      fail(
        same(protocols[key as keyof typeof factoryExpected], value),
        `The factory ${key} address does not match canonical Arbitrum configuration.`,
      );
    const adapter = LaunchAddressSchema.parse(protocols.adapter);
    const [adapterRuntimeHash] = await Promise.all([
      matchRuntime(
        adapter,
        adapterArtifact.abi as Abi,
        adapterArtifact.creationBytecode as Hex,
        [LAUNCH.uniswapRouter, LAUNCH.weth, LAUNCH.usdc, LAUNCH.adapterFee],
        blockNumber,
      ),
      matchRuntime(
        LAUNCH.uniswapRouter,
        routerArtifact.abi as Abi,
        routerArtifact.bytecode as Hex,
        [LAUNCH.uniswapFactory, LAUNCH.weth],
        blockNumber,
      ),
      ...Object.values(factoryExpected).map(async (address) => {
        const code = await client.getCode({
          address: address as Address,
          blockNumber,
        });
        fail(
          !!code && code !== "0x",
          "A canonical protocol has no deployed code.",
        );
        const expected = runtime.officialRuntimeHashes[address];
        if (expected)
          fail(
            keccak256(code!) === expected,
            "Official Aqua or SwapVM runtime differs from the reviewed SDK deployment.",
          );
      }),
      ...[
        [LAUNCH.aWeth, LAUNCH.weth],
        [LAUNCH.aUsdc, LAUNCH.usdc],
        [LAUNCH.variableDebtUSDC, LAUNCH.usdc],
      ].map(async ([address, asset]) => {
        const [underlying, pool] = await Promise.all([
          client.readContract({
            address: address as Address,
            abi: launchTokenAbi,
            functionName: "UNDERLYING_ASSET_ADDRESS",
            blockNumber,
          }),
          client.readContract({
            address: address as Address,
            abi: launchTokenAbi,
            functionName: "POOL",
            blockNumber,
          }),
        ]);
        fail(
          same(underlying, asset!) && same(pool, LAUNCH.aavePool),
          "Aave receipt/debt token identity changed.",
        );
      }),
    ]);
    const [weth, usdc, router, fee] = await Promise.all([
      client.readContract({
        address: adapter,
        abi: pairAbi,
        functionName: "weth",
        blockNumber,
      }),
      client.readContract({
        address: adapter,
        abi: pairAbi,
        functionName: "usdc",
        blockNumber,
      }),
      client.readContract({
        address: adapter,
        abi: pairAbi,
        functionName: "router",
        blockNumber,
      }),
      client.readContract({
        address: adapter,
        abi: pairAbi,
        functionName: "fee",
        blockNumber,
      }),
    ]);
    fail(
      same(weth, LAUNCH.weth) &&
        same(usdc, LAUNCH.usdc) &&
        same(router, LAUNCH.uniswapRouter) &&
        fee === LAUNCH.adapterFee,
      "The adapter's immutable route differs from the reviewed WETH/USDC route.",
    );
    return {
      factory,
      factoryRuntimeHash: factoryArtifact.runtimeCodeHash,
      adapter,
      adapterRuntimeHash,
    };
  }
  async function snapshot(
    ownerInput: string,
    accountInput?: string,
    at?: bigint,
  ): Promise<LaunchSnapshot> {
    const owner = LaunchAddressSchema.parse(ownerInput);
    if (!runtime.factoryAddress())
      return {
        schemaVersion: "noria.aqua.launch.snapshot.v1",
        status: "deployment-required",
        chainId: 42161,
        owner,
        message: notReady().message,
      };
    fail(
      (await client.getChainId()) === 42161,
      "The launch RPC is not Arbitrum One.",
    );
    const block = await client.getBlock(
      at === undefined ? { blockTag: "latest" } : { blockNumber: at },
    );
    const blockNumber = block.number;
    const d = await deployment(blockNumber);
    const balance = (token: Address, address: Address) =>
      client.readContract({
        address: token,
        abi: launchTokenAbi,
        functionName: "balanceOf",
        args: [address],
        blockNumber,
      });
    const [native, weth, usdc, aUsdc, account] = await Promise.all([
      client.getBalance({ address: owner, blockNumber }),
      balance(LAUNCH.weth, owner),
      balance(LAUNCH.usdc, owner),
      balance(LAUNCH.aUsdc, owner),
      accountInput
        ? Promise.resolve(LaunchAddressSchema.parse(accountInput))
        : client.readContract({
            address: d.factory,
            abi: launchFactoryAbi,
            functionName: "latestPosition",
            args: [owner],
            blockNumber,
          }),
    ]);
    let position: LaunchPosition | null = null;
    if (!same(account, zeroAddress)) {
      fail(
        await client.readContract({
          address: d.factory,
          abi: launchFactoryAbi,
          functionName: "isPosition",
          args: [account],
          blockNumber,
        }),
        "This account was not created by the verified factory.",
        "invalid-owner",
      );
      const names = [
        "owner",
        "keeper",
        "weth",
        "usdc",
        "collateral",
        "debtToken",
        "receiptToken",
        "aave",
        "aqua",
        "swapVM",
        "adapter",
        "safetyHF",
        "comfortableHF",
        "manifestHash",
        "phase",
        "healthFactor",
        "principal",
        "lpWeth",
        "lpUsdc",
        "cycleId",
        "nonce",
        "strategyHash",
      ] as const;
      const values = await Promise.all(
        names.map((functionName) =>
          client.readContract({
            address: account,
            abi: launchAccountAbi,
            functionName,
            blockNumber,
          }),
        ),
      );
      const fields = Object.fromEntries(
        names.map((key, i) => [key, values[i]]),
      );
      const addr = (key: string) => LaunchAddressSchema.parse(fields[key]);
      const uint = (key: string) => String(fields[key]);
      fail(
        same(addr("owner"), owner) && same(addr("keeper"), owner),
        "The registered position is owned or controlled by a different wallet.",
        "invalid-owner",
      );
      for (const [key, value] of Object.entries({
        weth: LAUNCH.weth,
        usdc: LAUNCH.usdc,
        debtToken: LAUNCH.variableDebtUSDC,
        aave: LAUNCH.aavePool,
        aqua: LAUNCH.aqua,
        swapVM: LAUNCH.swapVm,
        adapter: d.adapter,
      }))
        fail(
          same(addr(key), value),
          "The position's immutable protocol configuration does not match the factory.",
        );
      const collateral = addr("collateral"),
        receiptToken = addr("receiptToken");
      fail(
        same(collateral, LAUNCH.weth) || same(collateral, LAUNCH.usdc),
        "The position uses unsupported collateral.",
      );
      fail(
        same(
          receiptToken,
          same(collateral, LAUNCH.weth) ? LAUNCH.aWeth : LAUNCH.aUsdc,
        ),
        "The position uses the wrong collateral receipt token.",
      );
      const [debt, receipt, pw, pu, collateralAllowance, repaymentAllowance] =
        await Promise.all([
          balance(LAUNCH.variableDebtUSDC, account),
          balance(receiptToken, account),
          balance(LAUNCH.weth, account),
          balance(LAUNCH.usdc, account),
          client.readContract({
            address: collateral,
            abi: launchTokenAbi,
            functionName: "allowance",
            args: [owner, account],
            blockNumber,
          }),
          client.readContract({
            address: LAUNCH.usdc,
            abi: launchTokenAbi,
            functionName: "allowance",
            args: [owner, account],
            blockNumber,
          }),
        ]);
      let virtualWethUnits: string | null = null,
        virtualUsdcUnits: string | null = null;
      const phase = Number(fields.phase),
        strategyHash = LaunchHashSchema.parse(fields.strategyHash);
      if (phase === 2) {
        const [w, u] = await Promise.all(
          [LAUNCH.weth, LAUNCH.usdc].map((token) =>
            client.readContract({
              address: LAUNCH.aqua,
              abi: aquaAbi,
              functionName: "rawBalances",
              args: [account, LAUNCH.swapVm, strategyHash, token],
              blockNumber,
            }),
          ),
        );
        fail(
          w![1] === 2 && u![1] === 2,
          "The account claims Active without matching Aqua virtual inventory.",
        );
        virtualWethUnits = String(w![0]);
        virtualUsdcUnits = String(u![0]);
      }
      position = {
        address: account,
        owner,
        keeper: owner,
        collateral,
        receiptToken,
        phase,
        healthFactor: uint("healthFactor"),
        safetyHF: uint("safetyHF"),
        comfortableHF: uint("comfortableHF"),
        manifestHash: LaunchHashSchema.parse(fields.manifestHash),
        principal: uint("principal"),
        debtUSDCUnits: String(debt),
        receiptUnits: String(receipt),
        wethUnits: String(pw),
        usdcUnits: String(pu),
        lpWethUnits: uint("lpWeth"),
        lpUsdcUnits: uint("lpUsdc"),
        cycleId: uint("cycleId"),
        nonce: uint("nonce"),
        strategyHash,
        collateralAllowanceUnits: String(collateralAllowance),
        repaymentAllowanceUnits: String(repaymentAllowance),
        virtualWethUnits,
        virtualUsdcUnits,
      };
    }
    return LaunchReadySnapshotSchema.parse({
      schemaVersion: "noria.aqua.launch.snapshot.v1",
      status: "ready",
      chainId: 42161,
      owner,
      blockNumber: String(blockNumber),
      blockHash: block.hash,
      blockTimestamp: Number(block.timestamp),
      deployment: d,
      wallet: {
        nativeWei: String(native),
        wethUnits: String(weth),
        usdcUnits: String(usdc),
        aUsdcUnits: String(aUsdc),
      },
      position,
    });
  }
  async function readySnapshot(owner: string, account?: string, at?: bigint) {
    const s = await snapshot(owner, account, at);
    if (s.status !== "ready") throw notReady();
    return s;
  }
  async function validatePlan(
    raw: unknown,
    before: LaunchReadySnapshot,
    kind: LaunchRequest["kind"],
  ) {
    const parsed = parseRehearsalPlan(raw, runtime.now()),
      summary = summarizeLaunchPlan(raw, runtime.now());
    const block = BigInt(before.blockNumber),
      indexed = BigInt(summary.graphIndexedBlock);
    fail(
      indexed <= block,
      "The Graph indexed block is ahead of the canonical chain.",
      "invalid-plan",
    );
    const [source, current, financing] = await Promise.all([
      runtime.verifyPool(summary.sourcePool, indexed),
      runtime.verifyPool(summary.sourcePool, block),
      runtime.finance(summary.intent, block),
    ]);
    for (const evidence of [source, current])
      fail(
        evidence.mode === "rpc" &&
          evidence.chainId === 42161 &&
          same(evidence.pool, summary.sourcePool) &&
          same(evidence.token0, LAUNCH.weth) &&
          same(evidence.token1, LAUNCH.usdc) &&
          evidence.canonicalFactoryPool &&
          evidence.feeTierPips === summary.sourceFeeTierPips &&
          BigInt(evidence.liquidity) > 0n,
        "Canonical verification rejected this Graph reference pool.",
        "invalid-plan",
      );
    fail(
      source.blockNumber === String(indexed) &&
        same(source.blockHash, summary.graphIndexedBlockHash) &&
        current.blockNumber === String(block) &&
        same(current.blockHash, before.blockHash),
      "The Graph source or current pool block is not canonical.",
      "invalid-plan",
    );
    const currentPrice = BigInt(current.spotUSDCPerWethE6),
      sourcePrice = BigInt(source.spotUSDCPerWethE6);
    fail(
      sourcePrice > 0n &&
        currentPrice > BigInt(summary.lowerPriceE6) &&
        currentPrice < BigInt(summary.upperPriceE6) &&
        abs(currentPrice, sourcePrice) * 100n <= sourcePrice,
      "The reference price moved outside the range or by more than 1%. Request fresh research.",
      "invalid-plan",
    );
    const graphPrice = BigInt(
      Math.round(parsed.graph.recommendation.range.spot * 1e6),
    );
    fail(
      abs(graphPrice, sourcePrice) * 100n <= sourcePrice,
      "The Graph reference price diverges from its canonical source block.",
      "invalid-plan",
    );
    fail(
      financing.blockNumber === block &&
        same(financing.blockHash, before.blockHash),
      "Financing is not pinned to this review block.",
      "invalid-plan",
    );
    if (kind === "open")
      fail(
        BigInt(summary.loanUSDCUnits) <= financing.loanUSDCUnits,
        "The planned loan exceeds current safe Aave capacity. Request fresh research before opening.",
        "invalid-plan",
      );
    else
      fail(
        before.position?.principal === summary.loanUSDCUnits,
        "The refreshed plan must use this position's existing principal as its Graph inventory budget.",
        "invalid-plan",
      );
    return summary;
  }
  async function quoteDefense(before: LaunchReadySnapshot) {
    const blockNumber = BigInt(before.blockNumber);
    // Official deployment: https://docs.uniswap.org/contracts/v3/reference/deployments/arbitrum-deployments
    await matchRuntime(
      LAUNCH.quoter,
      quoterArtifact.abi as Abi,
      quoterArtifact.bytecode as Hex,
      [LAUNCH.uniswapFactory, LAUNCH.weth],
      blockNumber,
    );
    const result = await client.simulateContract({
      address: LAUNCH.quoter,
      abi: quoterAbi,
      functionName: "quoteExactInputSingle",
      args: [
        LAUNCH.weth,
        LAUNCH.usdc,
        LAUNCH.adapterFee,
        BigInt(before.position!.wethUnits),
        0n,
      ],
      blockNumber,
    });
    return result.result;
  }
  async function prepare(
    rawRequest: unknown,
    rawPlan?: unknown,
  ): Promise<LaunchPrepared> {
    const request = LaunchRequestSchema.parse(rawRequest);
    const before = await readySnapshot(
      request.owner,
      request.kind === "create" ? undefined : request.account,
    );
    fail(
      Math.abs(runtime.now() / 1000 - before.blockTimestamp) <= 90,
      "Canonical Arbitrum state is stale. Refresh before signing.",
      "stale-review",
    );
    const needsPlan = ["open", "convert", "ship"].includes(request.kind);
    if (needsPlan && rawPlan === undefined)
      throw new LaunchError(
        "plan-required",
        "A full current position plan is required for this step.",
      );
    if (!needsPlan && rawPlan !== undefined)
      throw new LaunchError(
        "invalid-plan",
        "This step does not accept a position plan.",
      );
    const plan = needsPlan
      ? await validatePlan(rawPlan, before, request.kind)
      : null;
    assertLaunchState(request, before, plan);
    if (request.kind === "create")
      fail(
        same(
          await client.readContract({
            address: before.deployment.factory,
            abi: launchFactoryAbi,
            functionName: "getPosition",
            args: [request.owner, request.id],
            blockNumber: BigInt(before.blockNumber),
          }),
          zeroAddress,
        ),
        "This owner-selected position ID already exists. Refresh its account or choose a new ID.",
        "invalid-state",
      );
    let quote: LaunchPrepared["quote"] = null;
    if (request.kind === "convert" || request.kind === "realize-defense") {
      const deadline = BigInt(before.blockTimestamp + 120);
      const amount =
        request.kind === "convert"
          ? BigInt(plan!.convertUsdcUnits)
          : BigInt(before.position!.wethUnits);
      const output =
        request.kind === "convert"
          ? (
              await client.simulateContract({
                address: request.account,
                abi: launchAccountAbi,
                functionName: "swapInventory",
                args: [false, amount, 1n, deadline],
                account: request.owner,
                blockNumber: BigInt(before.blockNumber),
              })
            ).result
          : await quoteDefense(before);
      fail(
        output > 0n,
        "The onchain simulation returned no inventory output.",
        "invalid-quote",
      );
      let minimum = ceiling(output * 9950n, 10000n);
      if (request.kind === "convert") {
        const target = BigInt(plan!.targetWethUnits);
        fail(
          withinLaunchTarget(output, target),
          "The actual conversion quote differs from the Graph inventory target by more than 1%. Request fresh research.",
          "invalid-quote",
        );
        const targetMinimum = ceiling(target * 99n, 100n);
        if (targetMinimum > minimum) minimum = targetMinimum;
      }
      quote = {
        amountUnits: String(amount),
        quotedOutUnits: String(output),
        minOutUnits: String(minimum),
        deadline: String(deadline),
      };
    }
    const prepared: LaunchPrepared = {
      schemaVersion: "noria.aqua.launch.prepared.v1",
      request,
      before,
      plan,
      quote,
      expiresAt: Math.min(
        runtime.now() + 60_000,
        plan ? Date.parse(plan.validUntil) : Infinity,
        quote ? Number(quote.deadline) * 1000 : Infinity,
      ),
      estimatedGasWei: "1",
    };
    const tx = launchTransaction(prepared);
    // Execute the exact reconstructed call as eth_call before asking for a gas estimate.
    await client.call({
      account: request.owner,
      to: tx.to,
      data: tx.data,
      value: tx.value,
      blockNumber: BigInt(before.blockNumber),
    });
    const [gas, gasPrice] = await Promise.all([
      client.estimateGas({
        account: request.owner,
        to: tx.to,
        data: tx.data,
        value: tx.value,
      }),
      client.getGasPrice(),
    ]);
    prepared.estimatedGasWei = String(ceiling(gas * gasPrice * 120n, 100n));
    return assertPreparedLaunch(prepared, request, rawPlan, runtime.now());
  }
  async function plan(
    ownerInput: string,
    accountInput: string,
    rawIntent: unknown,
    reviewAfterHours: 6 | 24 = 6,
  ) {
    const owner = LaunchAddressSchema.parse(ownerInput),
      account = LaunchAddressSchema.parse(accountInput),
      intent = LaunchIntentSchema.parse(rawIntent);
    const before = await readySnapshot(owner, account),
      position = before.position!;
    fail(
      position.manifestHash === launchManifestHash(owner, intent),
      "Use the position's original collateral amount, asset and health policy when refreshing its research.",
      "invalid-plan",
    );
    fail(
      [0, 1, 4].includes(position.phase),
      "Research can be refreshed before opening or while inventory is stopped and ready.",
      "invalid-state",
    );
    const finance = await runtime.finance(intent, BigInt(before.blockNumber));
    if (position.phase !== 0) {
      fail(
        BigInt(position.principal) > 0n,
        "This position has no remaining principal to launch.",
        "invalid-state",
      );
      finance.loanUSDCUnits = BigInt(position.principal);
    }
    return createPositionService({
      finance: async () => finance,
      recommend: runtime.recommend,
      verify: runtime.verifyPool,
      head: () => client.getBlockNumber(),
      now: runtime.now,
    })({
      schemaVersion: "noria.aqua.position.v1",
      requestId: `launch-${runtime.now()}`,
      intent,
      reviewAfterHours,
    });
  }

  async function verify(rawPrepared: unknown, hashInput: string) {
    const prepared = LaunchPreparedSchema.parse(rawPrepared),
      hash = LaunchHashSchema.parse(hashInput),
      request = prepared.request;
    const tx = launchTransaction(prepared);
    fail(
      (await client.getChainId()) === 42161,
      "The launch RPC is not Arbitrum One.",
    );
    const [receipt, transaction] = await Promise.all([
      client.getTransactionReceipt({ hash }),
      client.getTransaction({ hash }),
    ]);
    fail(
      same(transaction.hash, hash) &&
        same(receipt.transactionHash, hash) &&
        same(transaction.from, request.owner) &&
        same(receipt.from, request.owner) &&
        same(transaction.to, tx.to) &&
        same(receipt.to, tx.to) &&
        transaction.input.toLowerCase() === tx.data.toLowerCase() &&
        transaction.value === tx.value &&
        transaction.chainId === 42161,
      "The receipt does not match this exact owner, chain and requested operation.",
    );
    fail(
      transaction.blockNumber === receipt.blockNumber &&
        transaction.blockHash === receipt.blockHash &&
        receipt.blockNumber > BigInt(prepared.before.blockNumber),
      "The transaction predates this review or is not in its reported receipt block.",
    );
    const actualDeployment = await deployment(receipt.blockNumber);
    fail(
      same(actualDeployment.factory, prepared.before.deployment.factory) &&
        same(actualDeployment.adapter, prepared.before.deployment.adapter),
      "The recorded deployment does not match the configured verified factory.",
    );
    for (const log of receipt.logs)
      fail(
        !log.removed &&
          same(log.transactionHash, hash) &&
          log.blockHash === receipt.blockHash &&
          log.blockNumber === receipt.blockNumber,
        "The receipt contains noncanonical or unrelated logs.",
      );
    const allAbi = [
      ...launchFactoryAbi,
      ...launchAccountAbi,
      ...launchTokenAbi,
      ...launchPoolAbi,
    ] as const;
    const logs = parseEventLogs({ abi: allAbi, logs: receipt.logs });
    const has = (
      address: string,
      eventName: string,
      expected: Record<string, string | bigint | number | boolean>,
    ) =>
      logs.some(
        (log) =>
          same(log.address, address) &&
          log.eventName === eventName &&
          Object.entries(expected).every(([key, value]) => {
            const actual = (log.args as unknown as Record<string, unknown>)[
              key
            ];
            return typeof value === "string" && value.startsWith("0x")
              ? typeof actual === "string" && same(actual, value)
              : actual === value;
          }),
      );
    const found = (address: string, eventName: string) =>
      logs.find(
        (log) => same(log.address, address) && log.eventName === eventName,
      )?.args as unknown as Record<string, unknown> | undefined;
    let account = request.kind === "create" ? undefined : request.account;
    if (request.kind === "create" && receipt.status === "success")
      account = await client.readContract({
        address: actualDeployment.factory,
        abi: launchFactoryAbi,
        functionName: "getPosition",
        args: [request.owner, request.id],
        blockNumber: receipt.blockNumber,
      });
    const after = await readySnapshot(
      request.owner,
      account,
      receipt.blockNumber,
    );
    fail(
      after.blockHash === receipt.blockHash &&
        after.blockNumber === String(receipt.blockNumber),
      "The receipt block is no longer canonical.",
    );
    let verified = false;
    if (receipt.status === "success") {
      const p = after.position,
        before = prepared.before.position;
      const transfer = (
        token: string,
        from: string,
        to: string,
        amount: bigint,
      ) => has(token, "Transfer", { from, to, value: amount });
      switch (request.kind) {
        case "create":
          verified =
            !!p &&
            has(actualDeployment.factory, "PositionCreated", {
              owner: request.owner,
              account: p.address,
              id: request.id,
              collateral:
                request.intent.fundingAsset === "ETH"
                  ? LAUNCH.weth
                  : LAUNCH.usdc,
              manifestHash: launchManifestHash(request.owner, request.intent),
              safetyHF: BigInt(request.intent.safetyHFWad),
              comfortableHF: BigInt(request.intent.comfortableHFWad),
            }) &&
            p.manifestHash ===
              launchManifestHash(request.owner, request.intent) &&
            p.phase === 0;
          break;
        case "wrap":
          verified =
            has(LAUNCH.weth, "Deposit", {
              dst: request.owner,
              wad: BigInt(request.amountUnits),
            }) ||
            transfer(
              LAUNCH.weth,
              zeroAddress,
              request.owner,
              BigInt(request.amountUnits),
            );
          break;
        case "unwrap":
          verified =
            has(LAUNCH.weth, "Withdrawal", {
              src: request.owner,
              wad: BigInt(request.amountUnits),
            }) ||
            transfer(
              LAUNCH.weth,
              request.owner,
              zeroAddress,
              BigInt(request.amountUnits),
            );
          break;
        case "approve-collateral":
        case "revoke-collateral":
        case "approve-repayment":
        case "revoke-repayment":
          verified = has(
            request.kind.includes("collateral")
              ? before!.collateral
              : LAUNCH.usdc,
            "Approval",
            {
              owner: request.owner,
              spender: request.account,
              value:
                "amountUnits" in request ? BigInt(request.amountUnits) : 0n,
            },
          );
          break;
        case "open": {
          const intent = prepared.plan!.intent,
            amount = BigInt(intent.collateralAmountUnits),
            loan = BigInt(prepared.plan!.loanUSDCUnits),
            opened = found(request.account, "Opened");
          verified =
            !!opened &&
            has(request.account, "Opened", {
              collateral: before!.collateral,
              supplied: amount,
              borrowed: loan,
            }) &&
            BigInt(String(opened.healthFactor)) >=
              BigInt(intent.comfortableHFWad) &&
            has(LAUNCH.aavePool, "Supply", {
              reserve: before!.collateral,
              user: request.account,
              onBehalfOf: request.account,
              amount,
            }) &&
            has(LAUNCH.aavePool, "Borrow", {
              reserve: LAUNCH.usdc,
              user: request.account,
              onBehalfOf: request.account,
              amount: loan,
              interestRateMode: 2,
            }) &&
            transfer(
              before!.collateral,
              request.owner,
              request.account,
              amount,
            ) &&
            transfer(LAUNCH.usdc, LAUNCH.aUsdc, request.account, loan) &&
            p?.phase === 1 &&
            p.principal === String(loan);
          break;
        }
        case "convert":
        case "realize-defense": {
          const event = found(request.account, "InventoryConverted"),
            quote = prepared.quote!;
          verified =
            !!event &&
            has(request.account, "InventoryConverted", {
              tokenIn: request.kind === "convert" ? LAUNCH.usdc : LAUNCH.weth,
              amountIn: BigInt(quote.amountUnits),
            }) &&
            BigInt(String(event.amountOut)) >= BigInt(quote.minOutUnits);
          if (request.kind === "realize-defense")
            verified =
              verified &&
              has(request.account, "Defended", {
                cycleId: BigInt(before!.cycleId),
                residualWeth: 0n,
              }) &&
              p?.phase === 5 &&
              p.wethUnits === "0";
          break;
        }
        case "ship": {
          const order = launchOrder(prepared);
          verified =
            has(request.account, "CycleShipped", {
              cycleId: BigInt(before!.cycleId) + 1n,
              strategyHash: order.strategyHash,
              wethAmount: BigInt(before!.lpWethUnits),
              usdcAmount: BigInt(before!.lpUsdcUnits),
            }) &&
            p?.phase === 2 &&
            same(p.strategyHash, order.strategyHash) &&
            BigInt(p.cycleId) === BigInt(before!.cycleId) + 1n &&
            p.virtualWethUnits !== null &&
            p.virtualUsdcUnits !== null;
          break;
        }
        case "defend":
          verified =
            has(request.account, "Defended", {
              cycleId: BigInt(before!.cycleId),
            }) &&
            p?.phase === 5 &&
            (before!.phase !== 2 ||
              has(request.account, "CycleDocked", {
                cycleId: BigInt(before!.cycleId),
              }));
          break;
        case "repay": {
          const repayment = found(LAUNCH.aavePool, "Repay");
          verified =
            transfer(
              LAUNCH.usdc,
              request.owner,
              request.account,
              BigInt(request.amountUnits),
            ) &&
            has(LAUNCH.aavePool, "Repay", {
              reserve: LAUNCH.usdc,
              user: request.account,
              repayer: request.account,
              useATokens: false,
            }) &&
            !!repayment &&
            BigInt(String(repayment.amount)) > 0n &&
            BigInt(String(repayment.amount)) <= BigInt(request.amountUnits) &&
            p?.phase === 5;
          break;
        }
        case "exit": {
          const closed = found(request.account, "Closed");
          verified =
            !!closed &&
            p?.phase === 6 &&
            p.debtUSDCUnits === "0" &&
            p.receiptUnits === "0";
          if (closed) {
            const collateral = BigInt(String(closed.collateralReturned)),
              usdc = BigInt(String(closed.usdcReturned)),
              weth = BigInt(String(closed.wethReturned));
            if (collateral > 0n)
              verified =
                verified &&
                has(LAUNCH.aavePool, "Withdraw", {
                  reserve: before!.collateral,
                  user: request.account,
                  to: request.owner,
                  amount: collateral,
                });
            if (usdc > 0n)
              verified =
                verified &&
                transfer(LAUNCH.usdc, request.account, request.owner, usdc);
            if (weth > 0n)
              verified =
                verified &&
                transfer(LAUNCH.weth, request.account, request.owner, weth);
          }
          break;
        }
      }
    }
    return {
      schemaVersion: "noria.aqua.launch.operation.v1" as const,
      request,
      hash,
      chainId: 42161 as const,
      status:
        receipt.status === "reverted"
          ? ("reverted" as const)
          : verified
            ? ("verified" as const)
            : ("effect-unverified" as const),
      checkedAt: new Date(runtime.now()).toISOString(),
      after,
      networkFeeWei: String(receipt.gasUsed * receipt.effectiveGasPrice),
      blockNumber: String(receipt.blockNumber),
      blockHash: receipt.blockHash,
      transaction: {
        from: transaction.from,
        to: transaction.to,
        data: transaction.input,
        value: String(transaction.value),
        nonce: transaction.nonce,
      },
      events: logs.map((log) => ({
        address: log.address,
        eventName: log.eventName,
        args: Object.fromEntries(
          Object.entries(log.args).map(([key, value]) => [
            key,
            typeof value === "bigint" ? String(value) : value,
          ]),
        ),
      })),
      receipt: {
        blockNumber: String(receipt.blockNumber),
        blockHash: receipt.blockHash,
        status: receipt.status,
        gasUsed: String(receipt.gasUsed),
        effectiveGasPrice: String(receipt.effectiveGasPrice),
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
          logIndex: log.logIndex,
        })),
      },
      finality:
        "Sequencer inclusion checked against canonical RPC; not Ethereum finality or proof of profitable demand.",
    };
  }
  return { snapshot, prepare, verify, plan };
}
export type LaunchVerification = Awaited<
  ReturnType<ReturnType<typeof createLaunchService>["verify"]>
>;

/** Process-owned fork validation only. Never accepts a destination RPC or a private key. */
import { spawn, execFile } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  toHex,
  type Abi,
  type Address,
  type Hex,
} from "viem";
import { arbitrum } from "viem/chains";
import { quoteFinancing } from "@noria/aqua/financing";
import { verifySourcePool } from "@noria/aqua/verifier";
import { planPosition } from "../src/integrations/aqua/position-service";
import { createLaunchService } from "../src/integrations/aqua/launch-service";
import {
  LAUNCH,
  LaunchAddressSchema,
  assertPreparedLaunch,
  launchRepaymentLimit,
  launchTransaction,
  type LaunchIntent,
  type LaunchRequest,
} from "../src/integrations/aqua/launch-contract";
import {
  createReserveService,
  type ReserveClient,
} from "../src/integrations/privy/service";
import {
  reserveTransaction,
  type ReserveAction,
} from "../src/integrations/privy/reserve";
import { DemoTerminal } from "../integrations/aqua/scripts/terminal";

const demo = new DemoTerminal("Aqua launch validation");

async function validateCase(fundingAsset: "USDC" | "ETH") {
  const upstream =
    process.env.ARBITRUM_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
  const upstreamClient = createPublicClient({
    chain: arbitrum,
    transport: http(upstream, { timeout: 20_000 }),
  });
  const plannedCases = [];
  {
    const intent: LaunchIntent = {
      fundingAsset,
      collateralAmountUnits:
        fundingAsset === "ETH" ? "1000000000000000000" : "2500000000",
      safetyHFWad: "1400000000000000000",
      comfortableHFWad: "2000000000000000000",
      financingMode: "aave_collateral_then_borrow_usdc",
    };
    demo.stage(`${fundingAsset}: capture current Graph research`);
    const plan = await planPosition({
      schemaVersion: "noria.aqua.position.v1",
      requestId: `launch-validation-${fundingAsset}-${Date.now()}`,
      intent,
      reviewAfterHours: 6,
    });
    if (plan.status !== "ready-for-local-rehearsal")
      throw new Error(plan.reasons.join(" "));
    plannedCases.push({ fundingAsset, intent, plan });
  }
  demo.stage(`${fundingAsset}: start and verify the owned fork`);
  const forkBlock = await upstreamClient.getBlockNumber();
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    socket.close((error) => (error ? reject(error) : resolve())),
  );
  const anvil = spawn(
    process.env.ANVIL_BIN || "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--fork-url",
      upstream,
      "--fork-block-number",
      String(forkBlock),
      "--chain-id",
      "42161",
      "--silent",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  let spawnFailure: Error | undefined;
  anvil.once("error", (error) => {
    spawnFailure = error;
  });
  const url = `http://127.0.0.1:${port}`;
  const transport = http(url, {
    timeout: 60_000,
    retryCount: 0,
    batch: { batchSize: 100, wait: 5 },
  });
  const client = createPublicClient({ chain: arbitrum, transport });
  const actors = [
    LaunchAddressSchema.parse(
      process.env.NORIA_OWNER?.trim() ||
        "0x00000000000000000000000000000000000a11ce",
    ),
    getAddress("0x0000000000000000000000000000000000000b0b"),
  ];
  if (actors[0] === actors[1])
    actors[1] = getAddress("0x00000000000000000000000000000000000a11ce");
  const operations: unknown[] = [],
    fixtures: unknown[] = [];
  const report: Record<string, unknown> = {
    schemaVersion: "noria.aqua.launch.validation.v1",
    mode: "process-owned-local-arbitrum-fork",
    startedAt: new Date().toISOString(),
    forkBlock: String(forkBlock),
    fundingAsset,
    owner: actors[0],
    ownerSource: process.env.NORIA_OWNER?.trim()
      ? "NORIA_OWNER public address"
      : "default fixture address",
    ownerControl:
      "Local impersonation only, with explicit fixture funding. No keys, Privy signatures or public-wallet funding evidence.",
    boundaries: [
      "Official protocol execution on process-owned local Arbitrum forks with explicit fixture capital.",
      "NORIA_OWNER selects a public address for local impersonation only; no upstream writes or private keys are accepted.",
      "This is not a public deployment, actual wallet funding, Privy signing evidence, aggregator admission, taker-demand evidence or a profitability claim.",
      "Each full plan retains genuine Graph research and must remain unexpired. Current financing and executable quotes may refuse a stale plan.",
    ],
    fixtures,
    operations,
  };
  let stage = "startup",
    factory: Address | undefined;
  const assert = (value: unknown, message: string) => {
    if (!value) throw new Error(message);
  };
  async function raw(method: string, params: unknown[] = []) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const result = (await response.json()) as {
      result: unknown;
      error?: { message: string };
    };
    if (result.error)
      throw new Error(
        `Local ${method} failed: ${result.error.message.replaceAll(upstream, "[upstream RPC]")}`,
      );
    return result.result;
  }
  const wallet = (address: Address) =>
    createWalletClient({ account: address, chain: arbitrum, transport });
  async function alignClock(extra = 0) {
    const block = await client.getBlock({ blockTag: "latest" });
    await raw("evm_setNextBlockTimestamp", [
      Math.max(Math.floor(Date.now() / 1000), Number(block.timestamp) + 1) +
        extra,
    ]);
    await raw("evm_mine");
  }
  async function send(address: Address, to: Address, data: Hex, value = 0n) {
    const hash = await wallet(address).sendTransaction({ to, data, value });
    const receipt = await client.waitForTransactionReceipt({ hash });
    demo.receipt("Owned-fork transaction", receipt);
    assert(
      receipt.status === "success",
      `Fixture transaction reverted at ${stage}`,
    );
    return hash;
  }
  async function fixtureCall(
    address: Address,
    to: Address,
    abi: Abi,
    name: string,
    args: readonly unknown[],
  ) {
    const hash = await send(
      address,
      to,
      encodeFunctionData({ abi, functionName: name, args }),
    );
    fixtures.push({ kind: stage, from: address, to, method: name, args, hash });
  }
  async function deploy(name: string, args: readonly unknown[]) {
    demo.activity(`Deploy ${name} on the owned fork`);
    const artifact = JSON.parse(
      readFileSync(
        `integrations/aqua/contracts/out/${name}.sol/${name}.json`,
        "utf8",
      ),
    );
    const hash = await wallet(actors[0]!).deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    demo.receipt(`Deploy ${name}`, receipt);
    assert(
      receipt.status === "success" && receipt.contractAddress,
      "Local deployment failed",
    );
    fixtures.push({
      kind: `local-${name}-deployment`,
      address: receipt.contractAddress,
      hash,
    });
    return receipt.contractAddress!;
  }
  const launch = createLaunchService({
    client,
    factoryAddress: () => factory,
    finance: (intent, block) => quoteFinancing(intent, url, block),
    verifyPool: (pool, block) => verifySourcePool(url, pool, block),
  });
  async function execute(
    request: LaunchRequest,
    plan?: unknown,
    advanceBeforeSend = 0,
  ) {
    stage = `${request.owner}:${request.kind}`;
    demo.stage(`${fundingAsset}: ${request.kind.replaceAll("-", " ")}`);
    demo.activity("Prepare and check the exact transaction");
    await alignClock();
    const prepared = await launch.prepare(request, plan);
    assertPreparedLaunch(prepared, request, plan);
    if (advanceBeforeSend) {
      const block = await client.getBlock({ blockTag: "latest" });
      await raw("evm_setNextBlockTimestamp", [
        Number(block.timestamp) + advanceBeforeSend,
      ]);
    }
    const tx = launchTransaction(prepared),
      hash = await send(request.owner, tx.to, tx.data, tx.value);
    demo.activity("Verify receipt, balances and protocol effects");
    const verified = await launch.verify(prepared, hash);
    operations.push({ kind: request.kind, prepared, verification: verified });
    assert(
      verified.status === "verified",
      `${request.kind} receipt effect was ${verified.status}`,
    );
    demo.check(`${request.kind}: onchain effect verified`, true);
    return verified.after;
  }
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (spawnFailure) throw spawnFailure;
      if (anvil.exitCode !== null)
        throw new Error("Owned Anvil process exited during startup");
      try {
        const version = await raw("web3_clientVersion");
        if (String(version).toLowerCase().includes("anvil")) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    assert(ready, "Owned Anvil did not become ready");
    const info = (await raw("anvil_nodeInfo")) as { forkConfig?: unknown };
    assert(info.forkConfig, "Refusing mutations without an active owned fork");
    assert((await client.getChainId()) === 42161, "Wrong fork chain");
    demo.info(`Fork source block: ${forkBlock}`);
    demo.stage(`${fundingAsset}: prepare explicit local fixture funds`);
    for (const actor of actors) {
      await raw("anvil_setBalance", [actor, toHex(100n * 10n ** 18n)]);
      await raw("anvil_impersonateAccount", [actor]);
      fixtures.push({
        kind: "local-native-balance-and-impersonation",
        address: actor,
        amountWei: String(100n * 10n ** 18n),
      });
    }
    stage = "local official USDC minter fixture";
    const master = await client.readContract({
      address: LAUNCH.usdc,
      abi: parseAbi(["function masterMinter() view returns(address)"]),
      functionName: "masterMinter",
    });
    await raw("anvil_setBalance", [master, toHex(10n ** 18n)]);
    await raw("anvil_impersonateAccount", [master]);
    for (const actor of actors) {
      await fixtureCall(
        master,
        LAUNCH.usdc,
        parseAbi(["function configureMinter(address,uint256) returns(bool)"]),
        "configureMinter",
        [actor, 100_000n * 10n ** 6n],
      );
      await fixtureCall(
        actor,
        LAUNCH.usdc,
        parseAbi(["function mint(address,uint256) returns(bool)"]),
        "mint",
        [actor, 100_000n * 10n ** 6n],
      );
    }
    stage = "compile reviewed deployment artifacts";
    demo.stage(
      `${fundingAsset}: compile and deploy reviewed contracts locally`,
    );
    await new Promise<void>((resolve, reject) => {
      execFile(
        "forge",
        ["build", "--skip", "test"],
        {
          cwd: "integrations/aqua/contracts",
          timeout: 90_000,
        },
        (error) => (error ? reject(error) : resolve()),
      );
    });
    const adapter = await deploy("UniswapInventoryAdapter", [
      LAUNCH.uniswapRouter,
      LAUNCH.weth,
      LAUNCH.usdc,
      500,
    ]);
    factory = await deploy("PositionFactory", [
      {
        weth: LAUNCH.weth,
        usdc: LAUNCH.usdc,
        aWeth: LAUNCH.aWeth,
        aUsdc: LAUNCH.aUsdc,
        debtUSDC: LAUNCH.variableDebtUSDC,
        aave: LAUNCH.aavePool,
        aqua: LAUNCH.aqua,
        swapVM: LAUNCH.swapVm,
        adapter,
      },
    ]);
    report.deployment = {
      factory,
      adapter,
      adapterConstructorArgs: [
        LAUNCH.uniswapRouter,
        LAUNCH.weth,
        LAUNCH.usdc,
        500,
      ],
      factoryConstructorArgs: [
        {
          weth: LAUNCH.weth,
          usdc: LAUNCH.usdc,
          aWeth: LAUNCH.aWeth,
          aUsdc: LAUNCH.aUsdc,
          debtUSDC: LAUNCH.variableDebtUSDC,
          aave: LAUNCH.aavePool,
          aqua: LAUNCH.aqua,
          swapVM: LAUNCH.swapVm,
          adapter,
        },
      ],
    };
    for (const planned of plannedCases) {
      const { fundingAsset, intent } = planned;
      const owner = actors[0]!;
      const id = toHex(randomBytes(32));
      let state = await execute({ kind: "create", owner, id, intent });
      const account = state.position!.address;
      if (fundingAsset === "ETH")
        state = await execute({
          kind: "wrap",
          owner,
          account,
          amountUnits: intent.collateralAmountUnits,
        });
      state = await execute({
        kind: "approve-collateral",
        owner,
        account,
        amountUnits: intent.collateralAmountUnits,
      });
      stage = `${fundingAsset}:captured real Graph research`;
      await alignClock();
      const plan = planned.plan;
      assert(
        Date.parse(plan.validUntil) > Date.now(),
        "Captured Graph plan expired; restart with current research",
      );
      report[`${fundingAsset.toLowerCase()}GraphEvidence`] = {
        requestId: plan.requestId,
        request: plan.graph!.request,
        execution: plan.execution,
        validUntil: plan.validUntil,
      };
      state = await execute({ kind: "open", owner, account }, plan);
      assert(
        BigInt(state.position!.debtUSDCUnits) > 0n,
        "Opening must create actual Aave debt",
      );
      assert(
        Date.parse(plan.validUntil) > Date.now(),
        "Captured Graph plan expired after opening; restart the isolated validation",
      );
      state = await execute({ kind: "convert", owner, account }, plan);
      state = await execute({ kind: "ship", owner, account }, plan);
      assert(
        state.position!.phase === 2 &&
          state.position!.virtualWethUnits !== null &&
          state.position!.virtualUsdcUnits !== null,
        "Ship must have actual Aqua virtual inventory",
      );
      state = await execute({ kind: "defend", owner, account });
      if (BigInt(state.position!.wethUnits) > 0n)
        state = await execute({ kind: "realize-defense", owner, account });
      if (BigInt(state.position!.debtUSDCUnits) > 0n) {
        const amountUnits = launchRepaymentLimit(state.position!.debtUSDCUnits);
        state = await execute({
          kind: "approve-repayment",
          owner,
          account,
          amountUnits,
        });
        state = await execute(
          { kind: "repay", owner, account, amountUnits },
          undefined,
          30,
        );
        assert(
          state.position!.debtUSDCUnits === "0",
          "Explicit headroom must clear debt after 30 seconds of additional interest",
        );
      }
      state = await execute({ kind: "exit", owner, account });
      assert(
        state.position!.phase === 6 &&
          state.position!.receiptUnits === "0" &&
          state.position!.debtUSDCUnits === "0",
        "Exit must return collateral and leave no debt",
      );
      if (BigInt(state.wallet.wethUnits) > 0n)
        state = await execute({
          kind: "unwrap",
          owner,
          account,
          amountUnits: state.wallet.wethUnits,
        });
      state = await execute({ kind: "revoke-collateral", owner, account });
      if (fundingAsset === "ETH")
        state = await execute({ kind: "revoke-repayment", owner, account });
    }
    const reserve = createReserveService(client as ReserveClient);
    for (const kind of ["transfer-usdc", "transfer-eth"] as const) {
      stage = kind;
      demo.stage(`${fundingAsset}: ${kind.replaceAll("-", " ")}`);
      await alignClock();
      const action: ReserveAction = {
        owner: actors[0]!,
        recipient: actors[1]!,
        kind,
        amountUnits: kind === "transfer-usdc" ? "1000000" : "100000000000000",
      };
      const prepared = await reserve.prepare(action),
        tx = reserveTransaction(action),
        hash = await send(action.owner, tx.to, tx.data, tx.value),
        verification = await reserve.verify(action, hash);
      operations.push({ kind, prepared, verification });
      assert(verification.status === "verified", `${kind} did not verify`);
      demo.check(`${kind}: recipient balance effect verified`, true);
    }
    report.status = "passed";
    report.finishedAt = new Date().toISOString();
    demo.info(
      `${operations.length} owner operations verified for ${fundingAsset} on the isolated fork.`,
    );
  } catch (error) {
    report.status = "failed";
    report.failedStage = stage;
    report.error = (error instanceof Error ? error.message : String(error))
      .replaceAll(upstream, "[upstream RPC]")
      .slice(0, 1200);
    demo.fail(error);
    demo.info(`Failed stage: ${stage}`);
    process.exitCode = 1;
  } finally {
    if (report.status === "passed")
      demo.stage(`${fundingAsset}: save evidence and stop the fork`);
    await mkdir(".runtime", { recursive: true });
    await writeFile(
      `.runtime/aqua-launch-validation-${fundingAsset.toLowerCase()}.json`,
      JSON.stringify(
        report,
        (_, value) => (typeof value === "bigint" ? String(value) : value),
        2,
      ) + "\n",
    );
    demo.report(
      `.runtime/aqua-launch-validation-${fundingAsset.toLowerCase()}.json`,
    );
    anvil.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => anvil.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    if (anvil.exitCode === null) anvil.kill("SIGKILL");
  }
  return report;
}
async function main() {
  const selection = process.argv.slice(2);
  if (
    selection.length > 1 ||
    (selection[0] && !["--asset=USDC", "--asset=ETH"].includes(selection[0]))
  )
    throw new Error(
      "Usage: validate-aqua-launch.ts [--asset=USDC|--asset=ETH]",
    );
  const assets: ("USDC" | "ETH")[] = selection[0]
    ? [selection[0].slice(8) as "USDC" | "ETH"]
    : ["USDC", "ETH"];
  const cases = [];
  for (const asset of assets) {
    cases.push(await validateCase(asset));
    if (cases.at(-1)?.status !== "passed") break;
  }
  await mkdir(".runtime", { recursive: true });
  await writeFile(
    ".runtime/aqua-launch-validation.json",
    JSON.stringify(
      {
        schemaVersion: "noria.aqua.launch.validation-suite.v1",
        status:
          cases.length === assets.length &&
          cases.every((result) => result.status === "passed")
            ? "passed"
            : "failed",
        requestedAssets: assets,
        mode: "process-owned-local-arbitrum-forks",
        cases,
      },
      (_, value) => (typeof value === "bigint" ? String(value) : value),
      2,
    ) + "\n",
  );
  demo.report(".runtime/aqua-launch-validation.json");
  if (
    cases.length === assets.length &&
    cases.every((result) => result.status === "passed")
  )
    demo.complete(
      `${cases.length} collateral case(s) passed. Evidence covers local protocol execution only.`,
    );
}
void main().catch((error) => {
  demo.fail(error);
  process.exitCode = 1;
});

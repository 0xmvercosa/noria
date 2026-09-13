/** Dedicated local Arbitrum fork. Every mutation is sent only to its owned loopback Anvil. */
import { spawn, execFile, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  keccak256,
  toHex,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
  type Abi,
} from "viem";
import { arbitrum } from "viem/chains";
import { TakerTraits } from "@1inch/swap-vm-sdk";
import { DEPLOYMENTS as D, buildOfficialOrder } from "../src/official.js";
import { quoteFinancing } from "../src/financing.js";
import { parseRehearsalPlan } from "../src/rehearsal-plan.js";
import { priceFromSqrt, verifySourcePool } from "../src/verifier.js";
import { PositionIntentSchema } from "../src/boundary.js";
import { writeReports } from "../src/rehearsal-report.js";
import { DemoTerminal, terminalError } from "./terminal.js";

const demo = new DemoTerminal("Aqua position rehearsal");

let stopOwnedFork: (() => void) | undefined;
process.once("uncaughtException", (error) => {
  demo.fail(error);
  stopOwnedFork?.();
  process.exitCode = 1;
});

demo.stage("Read the position plan and fork source block");

const encode = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const downloadedPlan = process.env.NORIA_PLAN_FILE
  ? parseRehearsalPlan(
      JSON.parse(await readFile(process.env.NORIA_PLAN_FILE, "utf8")),
    )
  : null;
function requireFreshPlan(stage: string) {
  if (downloadedPlan && Date.parse(downloadedPlan.validUntil) <= Date.now())
    throw new Error(`position_plan_expired_before_${stage}`);
}
const rpc =
  process.env.ARBITRUM_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
const forkBlock = process.env.NORIA_FORK_BLOCK
  ? BigInt(process.env.NORIA_FORK_BLOCK)
  : await createPublicClient({ transport: http(rpc) }).getBlockNumber();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const dir = resolve("runs", runId);
await mkdir(dir, { recursive: true });
const owner = (process.env.NORIA_OWNER ??
  "0x00000000000000000000000000000000000a11ce") as Address;
const taker = (process.env.NORIA_TAKER ??
  "0x0000000000000000000000000000000000000b0b") as Address;
const keeper = "0x000000000000000000000000000000000000c0de" as Address;
if (
  ![owner, taker, keeper].every((a) => isAddress(a)) ||
  new Set([owner, taker, keeper].map((a) => a.toLowerCase())).size !== 3
)
  throw new Error("distinct_valid_fixture_wallets_required");
const intent =
  downloadedPlan?.intent ??
  PositionIntentSchema.parse({
    fundingAsset: process.env.NORIA_FUNDING_ASSET ?? "ETH",
    collateralAmountUnits:
      process.env.NORIA_COLLATERAL_UNITS ??
      (process.env.NORIA_FUNDING_ASSET === "USDC"
        ? "20000000000"
        : "10000000000000000000"),
    safetyHFWad: process.env.NORIA_SAFETY_HF_WAD ?? "1400000000000000000",
    comfortableHFWad:
      process.env.NORIA_COMFORTABLE_HF_WAD ?? "2000000000000000000",
    financingMode: "aave_collateral_then_borrow_usdc",
  });
const fillRounds = Number(process.env.NORIA_FILL_ROUNDS ?? "2");
if (!Number.isInteger(fillRounds) || fillRounds < 1 || fillRounds > 10)
  throw new Error("fill_rounds_out_of_bounds");
demo.info(
  `Collateral: ${intent.fundingAsset} · fill rounds: ${fillRounds} · source block: ${forkBlock}`,
);
demo.stage("Start the owned fork and verify official deployments");
const server = createServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
const anvil = spawn(
  process.env.ANVIL_BIN ?? "anvil",
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--fork-url",
    rpc,
    "--fork-block-number",
    String(forkBlock),
    "--chain-id",
    "42161",
    "--silent",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
stopOwnedFork = () => {
  anvil.kill("SIGTERM");
};
let startupFailed = false;
anvil.once("error", () => {
  startupFailed = true;
});
// Never serialize Anvil startup output: it may contain upstream endpoint credentials.
anvil.stderr.on("data", (chunk: Buffer) => {
  const message = chunk.toString().replaceAll(rpc, "[upstream RPC]");
  if (/error|failed/i.test(message))
    demo.info(`Anvil: ${terminalError(new Error(message))}`);
});
const url = `http://127.0.0.1:${port}`;
const transport = http(url, {
  timeout: 30_000,
  retryCount: 0,
  batch: { batchSize: 100, wait: 5 },
});
const client = createPublicClient({ chain: arbitrum, transport });
async function raw(method: string, params: unknown[] = []): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const result = (await response.json()) as {
    result?: unknown;
    error?: { message: string };
  };
  if (result.error)
    throw new Error(`local_rpc_${method}: ${result.error.message}`);
  return result.result;
}
const SwapVMABI = parseAbi([
  "function quote((address maker,uint256 traits,bytes data),address,address,uint256,bytes) returns(uint256,uint256,bytes32)",
  "function swap((address maker,uint256 traits,bytes data),address,address,uint256,bytes) returns(uint256,uint256,bytes32)",
]);
const erc = parseAbi([
  "function balanceOf(address) view returns(uint256)",
  "function approve(address,uint256) returns(bool)",
  "function allowance(address,address) view returns(uint256)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
const debtABI = parseAbi([
  "function scaledBalanceOf(address) view returns(uint256)",
  "function balanceOf(address) view returns(uint256)",
]);
const aaveABI = parseAbi([
  "function getUserAccountData(address) view returns(uint256,uint256,uint256,uint256,uint256,uint256)",
  "event Repay(address indexed reserve,address indexed user,address indexed repayer,uint256 amount,bool useATokens)",
]);
const aquaABI = parseAbi([
  "function rawBalances(address,address,bytes32,address) view returns(uint248,uint8)",
  "function push(address,address,bytes32,address,uint256)",
]);
const aUsdc = "0x724dc807b04555b71ed48a6896b6f41593b8c637" as Address;
let account: Address | undefined;
let accountABI: Abi = [];
let strategyHash: Hex | undefined;
const operations: any[] = [];
const assertions: any[] = [];
const quotes: any[] = [];
const actors = [owner, taker, keeper];
let manifest: any = {
  schemaVersion: "noria.aqua.run.v1",
  runId,
  mode: "local-arbitrum-fork",
  forkBlock,
  owner,
  taker,
  keeper,
  intent,
  relatedPartyTakers: true,
  routingStatus: "not_validated",
  fixtures: [],
};
const read = async (
  address: Address,
  abi: Abi,
  functionName: string,
  args: readonly unknown[] = [],
): Promise<any> => client.readContract({ address, abi, functionName, args });
async function snapshot() {
  const block = await client.getBlock();
  const wallets = await Promise.all(
    [...actors, ...(account ? [account] : [])].map(async (address) => {
      const [native, weth, usdc, aWeth, aUSDC, debt, scaledDebt, hf] =
        await Promise.all([
          client.getBalance({ address }),
          read(D.weth, erc, "balanceOf", [address]),
          read(D.usdc, erc, "balanceOf", [address]),
          read(D.aWeth, erc, "balanceOf", [address]),
          read(aUsdc, erc, "balanceOf", [address]),
          read(D.variableDebtUSDC, debtABI, "balanceOf", [address]),
          read(D.variableDebtUSDC, debtABI, "scaledBalanceOf", [address]),
          read(D.aavePool, aaveABI, "getUserAccountData", [address]),
        ]);
      return {
        address,
        native,
        weth,
        usdc,
        aWeth,
        aUSDC,
        debt,
        scaledDebt,
        aaveAccount: hf,
      };
    }),
  );
  let position: any = null;
  if (account) {
    const names = [
      "phase",
      "cycleId",
      "nonce",
      "principal",
      "lpWeth",
      "lpUsdc",
      "reserves",
      "lossCarry",
      "debtCheckpoint",
      "scaledDebtCheckpoint",
      "dockSnapshotHash",
    ];
    const values = await Promise.all(
      names.map((n) => read(account!, accountABI, n)),
    );
    position = Object.fromEntries(names.map((n, i) => [n, values[i]]));
    position.aquaAllowances = await Promise.all(
      [D.weth, D.usdc].map((t) => read(t, erc, "allowance", [account, D.aqua])),
    );
    if (strategyHash)
      position.virtualBalances = await Promise.all(
        [D.weth, D.usdc].map((t) =>
          read(D.aqua, aquaABI, "rawBalances", [
            account,
            D.swapVm,
            strategyHash,
            t,
          ]),
        ),
      );
  }
  return {
    blockNumber: block.number,
    blockHash: block.hash,
    timestamp: block.timestamp,
    wallets,
    position,
  };
}
async function logOp(op: any) {
  operations.push(op);
  await appendFile(
    resolve(dir, "operations.jsonl"),
    JSON.stringify(op, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) +
      "\n",
  );
}
async function fixture(name: string, method: string, params: unknown[]) {
  await raw(method, params);
  const op = {
    sequence: operations.length + 1,
    kind: "fixture",
    name,
    method,
    params,
    synthetic: true,
  };
  manifest.fixtures.push(op);
  await logOp(op);
}
async function tx(
  name: string,
  actor: Address,
  address: Address,
  abi: Abi,
  fn: string,
  args: readonly unknown[] = [],
  value = 0n,
  expectedRevert = false,
) {
  demo.activity(name);
  const before = await snapshot();
  const wallet = createWalletClient({
    account: actor,
    chain: arbitrum,
    transport,
  });
  const hash = await wallet.writeContract({
    address,
    abi,
    functionName: fn,
    args,
    value,
    gas: 6_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const after = await snapshot();
  const transaction = await client.getTransaction({ hash });
  const trace = await raw("debug_traceTransaction", [
    hash,
    { tracer: "callTracer" },
  ]);
  await writeFile(
    resolve(dir, `${operations.length + 1}-${hash}.json`),
    encode({ transaction, receipt, trace }),
  );
  await logOp({
    sequence: operations.length + 1,
    kind: "transaction",
    name,
    actor,
    address,
    functionName: fn,
    args,
    value,
    hash,
    status: receipt.status,
    expectedRevert,
    gasUsed: receipt.gasUsed,
    effectiveGasPrice: receipt.effectiveGasPrice,
    gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice,
    events: parseEventLogs({
      abi: [...accountABI, ...erc, ...aaveABI],
      logs: receipt.logs,
      strict: false,
    }),
    before,
    after,
  });
  demo.receipt(name, receipt, expectedRevert);
  if ((receipt.status === "reverted") !== expectedRevert)
    throw new Error(`unexpected_transaction_status:${name}:${hash}`);
  return receipt;
}
async function deploy(
  name: string,
  artifactName: string,
  args: readonly unknown[],
): Promise<Address> {
  demo.activity(name);
  const artifact = JSON.parse(
    await readFile(
      resolve("contracts/out", `${artifactName}.sol`, `${artifactName}.json`),
      "utf8",
    ),
  );
  const before = await snapshot();
  const wallet = createWalletClient({
    account: owner,
    chain: arbitrum,
    transport,
  });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [...args],
    gas: 12_000_000n,
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  demo.receipt(name, receipt);
  if (receipt.status !== "success" || !receipt.contractAddress)
    throw new Error("deployment_failed");
  await writeFile(
    resolve(dir, `deployment-${artifactName}.json`),
    encode({
      receipt,
      transaction: await client.getTransaction({ hash }),
      trace: await raw("debug_traceTransaction", [
        hash,
        { tracer: "callTracer" },
      ]),
    }),
  );
  await logOp({
    sequence: operations.length + 1,
    kind: "deployment",
    name,
    hash,
    status: receipt.status,
    address: receipt.contractAddress,
    gasCostWei: receipt.gasUsed * receipt.effectiveGasPrice,
    before,
    after: await snapshot(),
  });
  if (artifactName === "PositionAccount") accountABI = artifact.abi;
  return receipt.contractAddress;
}
function check(name: string, condition: boolean, detail: unknown = {}) {
  assertions.push({ name, passed: condition, detail });
  demo.check(name, condition);
  if (!condition) throw new Error(`assertion_failed:${name}`);
}
async function swapInventory(wethIn: boolean, amount: bigint) {
  const slot = await read(
    D.sourcePool500,
    parseAbi([
      "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
    ]),
    "slot0",
  );
  const spot = priceFromSqrt(slot[0], D.weth);
  const minOut =
    ((wethIn ? (amount * spot) / 10n ** 18n : (amount * 10n ** 18n) / spot) *
      98n) /
    100n;
  const block = await client.getBlock();
  await tx(
    "Real inventory conversion (Uniswap; not an Aqua fill)",
    owner,
    account!,
    accountABI,
    "swapInventory",
    [wethIn, amount, minOut, block.timestamp + 300n],
  );
}
let failure: string | undefined;
process.once("SIGTERM", () => {
  anvil.kill("SIGTERM");
});
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (startupFailed || anvil.exitCode !== null)
      throw new Error("anvil_startup_failed");
    try {
      const version = await raw("web3_clientVersion");
      if (String(version).toLowerCase().includes("anvil")) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error("anvil_startup_timeout");
  const info = await raw("anvil_nodeInfo");
  check(
    "Owned loopback Anvil has the expected fork",
    Number(info.forkConfig?.forkBlockNumber) === Number(forkBlock),
    info.forkConfig
      ? { forkBlockNumber: info.forkConfig.forkBlockNumber }
      : { missing: true },
  );
  check("Arbitrum chain ID", (await client.getChainId()) === 42161);
  const block = await client.getBlock({ blockNumber: forkBlock });
  manifest.forkBlockHash = block.hash;
  manifest.forkTimestamp = block.timestamp;
  manifest.protocols = await Promise.all(
    Object.entries(D)
      .filter(([k, v]) => k !== "chainId" && isAddress(String(v)))
      .map(async ([name, address]) => {
        const code = await client.getCode({ address: address as Address });
        if (!code || code === "0x") throw new Error(`missing_code:${name}`);
        return {
          name,
          address,
          codeHash: keccak256(code),
          byteLength: (code.length - 2) / 2,
        };
      }),
  );
  check(
    "Official Aqua code matches the reviewed deployment",
    manifest.protocols.find((p: any) => p.name === "aqua").codeHash ===
      "0x720bc02d220db318164dc3bade86eec1f3655bdc00fc1174de7d816a95c341f8",
  );
  check(
    "Official SwapVM code matches SDK 0.4.4 binding",
    manifest.protocols.find((p: any) => p.name === "swapVm").codeHash ===
      "0x7cb8785de84b35bced79fbecbbc6336f473623568cba28b7af3ed001b20d580e",
  );
  manifest.fillRounds = fillRounds;
  manifest.sourceGitCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  manifest.sourceWorkingTreeDirty =
    execFileSync(
      "git",
      [
        "status",
        "--porcelain",
        "--",
        "integrations/aqua",
        ".github/workflows/aqua.yml",
        "src/integrations/aqua",
        "src/app/api/aqua",
        "package.json",
        "package-lock.json",
      ],
      { cwd: resolve("../.."), encoding: "utf8" },
    ).trim().length > 0;
  manifest.sdkVersions = { aqua: "0.3.4", swapVM: "0.4.4", viem: "2.38.6" };
  manifest.swapABI =
    "swap((address,uint256,bytes),address,address,uint256,bytes)";
  demo.stage("Prepare fixture capital and local actor permissions");
  // Explicit fixture capital grows with collateral; it is never counted as LP revenue.
  const ownerWethFixture =
    20n * 10n ** 18n +
    (intent.fundingAsset === "ETH" ? BigInt(intent.collateralAmountUnits) : 0n);
  const ownerUsdcFixture =
    100_000n * 10n ** 6n +
    (intent.fundingAsset === "USDC"
      ? BigInt(intent.collateralAmountUnits)
      : 0n);
  for (const actor of actors) {
    await fixture("Local native gas fixture", "anvil_setBalance", [
      actor,
      toHex(100n * 10n ** 18n + (actor === owner ? ownerWethFixture : 0n)),
    ]);
    await fixture("Local wallet impersonation", "anvil_impersonateAccount", [
      actor,
    ]);
  }
  // Official USDC minter roles are impersonated only inside this process-owned local fork.
  const master = (await read(
    D.usdc,
    parseAbi(["function masterMinter() view returns(address)"]),
    "masterMinter",
  )) as Address;
  await fixture("Local minter gas", "anvil_setBalance", [
    master,
    toHex(10n ** 18n),
  ]);
  await fixture(
    "Local official minter impersonation",
    "anvil_impersonateAccount",
    [master],
  );
  await tx(
    "Fixture: authorize USDC minting (local only)",
    master,
    D.usdc,
    parseAbi(["function configureMinter(address,uint256) returns(bool)"]),
    "configureMinter",
    [owner, ownerUsdcFixture + 100_000n * 10n ** 6n],
  );
  await tx(
    "Fixture: mint owner USDC (external capital)",
    owner,
    D.usdc,
    parseAbi(["function mint(address,uint256) returns(bool)"]),
    "mint",
    [owner, ownerUsdcFixture],
  );
  await tx(
    "Fixture: mint related taker USDC (external capital)",
    owner,
    D.usdc,
    parseAbi(["function mint(address,uint256) returns(bool)"]),
    "mint",
    [taker, 100_000n * 10n ** 6n],
  );
  await tx(
    "Wrap owner fixture ETH into official WETH",
    owner,
    D.weth,
    parseAbi(["function deposit() payable"]),
    "deposit",
    [],
    ownerWethFixture,
  );
  await tx(
    "Wrap taker fixture ETH into official WETH",
    taker,
    D.weth,
    parseAbi(["function deposit() payable"]),
    "deposit",
    [],
    20n * 10n ** 18n,
  );
  demo.stage("Compile reviewed contracts and deploy the local adapter");
  await new Promise<void>((resolveBuild, reject) => {
    execFile(
      "forge",
      ["build", "--skip", "test"],
      {
        cwd: resolve("contracts"),
        timeout: 90_000,
        killSignal: "SIGKILL",
      },
      (error) => (error ? reject(error) : resolveBuild()),
    );
  });
  const adapter = await deploy(
    "Deploy fixed inventory adapter",
    "UniswapInventoryAdapter",
    [D.uniswapRouter, D.weth, D.usdc, 500],
  );
  demo.stage("Check financing and retained Graph source evidence");
  const financing = await quoteFinancing(intent, url);
  if (downloadedPlan) {
    if (Date.parse(downloadedPlan.validUntil) <= Date.now())
      throw new Error("position_plan_expired_during_setup");
    if (
      downloadedPlan.financing.collateralAsset.toLowerCase() !==
        financing.asset.toLowerCase() ||
      BigInt(downloadedPlan.financing.loanUSDCUnits) > financing.loanUSDCUnits
    )
      throw new Error("financing_changed_replan_required");
    financing.loanUSDCUnits = BigInt(downloadedPlan.financing.loanUSDCUnits);
    const e = downloadedPlan.execution;
    const source = await verifySourcePool(
      rpc,
      e.sourcePool as Address,
      BigInt(e.graphIndexedBlock),
    );
    if (
      source.blockHash.toLowerCase() !==
        e.graphIndexedBlockHash.toLowerCase() ||
      !source.canonicalFactoryPool ||
      source.liquidity !== e.canonicalSourceLiquidity
    )
      throw new Error("graph_source_block_mismatch");
    const evidence = await verifySourcePool(
      url,
      e.sourcePool as Address,
      await client.getBlockNumber(),
    );
    if (
      !evidence.canonicalFactoryPool ||
      evidence.token0.toLowerCase() !== D.weth ||
      evidence.token1.toLowerCase() !== D.usdc ||
      evidence.feeTierPips !== e.sourceFeeTierPips ||
      BigInt(evidence.liquidity) === 0n ||
      BigInt(evidence.spotUSDCPerWethE6) <= BigInt(e.lowerPriceE6) ||
      BigInt(evidence.spotUSDCPerWethE6) >= BigInt(e.upperPriceE6)
    )
      throw new Error("graph_reference_no_longer_executable");
    const currentPrice = BigInt(evidence.spotUSDCPerWethE6),
      oldPrice = BigInt(source.spotUSDCPerWethE6);
    if (
      oldPrice <= 0n ||
      (currentPrice > oldPrice
        ? currentPrice - oldPrice
        : oldPrice - currentPrice) *
        10000n >
        oldPrice * 100n
    )
      throw new Error("graph_price_moved_replan_required");
    manifest.downloadedPlan = downloadedPlan;
    manifest.graphCanonicalEvidence = evidence;
    manifest.graphCanonicalSourceEvidence = source;
    requireFreshPlan("completed_source_verification");
  }
  manifest.financing = financing;
  const manifestHash = keccak256(toHex(encode(manifest)));
  demo.stage("Deploy the owner account and open the financed position");
  account = await deploy("Deploy owner position account", "PositionAccount", [
    {
      owner,
      keeper,
      weth: D.weth,
      usdc: D.usdc,
      collateral: financing.asset,
      debtToken: D.variableDebtUSDC,
      receiptToken: intent.fundingAsset === "ETH" ? D.aWeth : aUsdc,
      aave: D.aavePool,
      aqua: D.aqua,
      swapVM: D.swapVm,
      adapter,
      safetyHF: BigInt(intent.safetyHFWad),
      comfortableHF: BigInt(intent.comfortableHFWad),
      manifestHash,
    },
  ]);
  manifest.account = account;
  manifest.ownContracts = await Promise.all(
    [account, adapter].map(async (address) => ({
      address,
      codeHash: keccak256((await client.getCode({ address }))!),
    })),
  );
  manifest.adapter = adapter;
  manifest.accountManifestHash = manifestHash;
  await tx(
    "Approve initial collateral",
    owner,
    financing.asset,
    erc,
    "approve",
    [account, BigInt(intent.collateralAmountUnits)],
  );
  manifest.economicStart = await snapshot();
  requireFreshPlan("opening");
  await tx(
    "Supply collateral and borrow USDC on official Aave",
    owner,
    account,
    accountABI,
    "openPosition",
    [BigInt(intent.collateralAmountUnits), financing.loanUSDCUnits],
  );
  demo.stage("Prepare WETH / USDC inventory and the Aqua strategy");
  await swapInventory(
    false,
    downloadedPlan
      ? BigInt(downloadedPlan.execution.convertUsdcUnits)
      : financing.loanUSDCUnits / 2n,
  );
  if (downloadedPlan) {
    const preparedWeth = await read(account, accountABI, "lpWeth");
    const target = BigInt(downloadedPlan.execution.targetWethUnits);
    check(
      "Prepared inventory matches the automatic asymmetric target within 1%",
      preparedWeth * 100n >= target * 99n &&
        preparedWeth * 100n <= target * 101n,
    );
  }
  const slot = await read(
    D.sourcePool500,
    parseAbi([
      "function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)",
    ]),
    "slot0",
  );
  const spot = priceFromSqrt(slot[0], D.weth);
  manifest.valuationPriceUSDCPerWethE6 = spot;
  const valuationBlock = await client.getBlock();
  manifest.valuationBlock = {
    number: valuationBlock.number,
    hash: valuationBlock.hash,
    timestamp: valuationBlock.timestamp,
  };
  const order = buildOfficialOrder({
    maker: account,
    lowerPriceE6: downloadedPlan
      ? BigInt(downloadedPlan.execution.lowerPriceE6)
      : (spot * 85n) / 100n,
    upperPriceE6: downloadedPlan
      ? BigInt(downloadedPlan.execution.upperPriceE6)
      : (spot * 115n) / 100n,
    lpFeeBps: downloadedPlan?.execution.lpFeeBps ?? 30,
    salt: 1n,
  });
  manifest.rangeOrigin = downloadedPlan
    ? "unsigned downloaded Graph position plan; internal consistency and canonical source reverified, provider authorship not authenticated"
    : "explicit fork fixture; Graph selection is validated by the separate integration test";
  manifest.order = {
    ...order.order.build(),
    bytes: order.bytes,
    strategyHash: order.strategyHash,
    lowerPriceE6: downloadedPlan
      ? BigInt(downloadedPlan.execution.lowerPriceE6)
      : (spot * 85n) / 100n,
    upperPriceE6: downloadedPlan
      ? BigInt(downloadedPlan.execution.upperPriceE6)
      : (spot * 115n) / 100n,
  };
  requireFreshPlan("shipment");
  demo.stage("Ship Aqua liquidity and verify taker access enforcement");
  await tx(
    "Ship concentrated liquidity on official Aqua",
    owner,
    account,
    accountABI,
    "shipCycle",
    [order.bytes],
  );
  strategyHash = order.strategyHash;
  await tx(
    "Taker approves official SwapVM for USDC",
    taker,
    D.usdc,
    erc,
    "approve",
    [D.swapVm, 10_000n * 10n ** 6n],
  );
  await tx(
    "Taker approves official SwapVM for WETH",
    taker,
    D.weth,
    erc,
    "approve",
    [D.swapVm, 10n * 10n ** 18n],
  );
  const data = TakerTraits.default().encode().toString() as Hex;
  await tx(
    "Reject taker without the official access credential",
    taker,
    D.swapVm,
    SwapVMABI,
    "swap",
    [order.order.build(), D.usdc, D.weth, 100n * 10n ** 6n, data],
    0n,
    true,
  );
  const kycOwner = (await read(
    D.kycNft,
    parseAbi(["function owner() view returns(address)"]),
    "owner",
  )) as Address;
  await fixture("Local credential admin gas", "anvil_setBalance", [
    kycOwner,
    toHex(10n ** 18n),
  ]);
  await fixture(
    "Local credential admin impersonation",
    "anvil_impersonateAccount",
    [kycOwner],
  );
  await tx(
    "Fixture: issue official credential on local fork only",
    kycOwner,
    D.kycNft,
    parseAbi(["function mint(address,uint256)"]),
    "mint",
    [taker, 100_000n],
  );
  const activeWeth = await read(account, accountABI, "lpWeth");
  const activeUsdc = await read(account, accountABI, "lpUsdc");
  const roundUSDC = [
    1000n * 10n ** 6n,
    financing.loanUSDCUnits / 10n,
    (activeWeth * spot) / 10n ** 18n / 4n,
    activeUsdc / 4n,
  ].reduce((a, b) => (a < b ? a : b));
  if (roundUSDC === 0n) throw new Error("inventory_too_small_for_rehearsal");
  demo.stage("Execute related-taker fills through official SwapVM");
  for (const [tokenIn, tokenOut, amount] of Array.from(
    { length: fillRounds },
    () =>
      [
        [D.usdc, D.weth, roundUSDC],
        [D.weth, D.usdc, (roundUSDC * 10n ** 18n) / spot],
      ] as const,
  ).flat()) {
    demo.activity(
      `Quote ${tokenIn === D.usdc ? "USDC to WETH" : "WETH to USDC"} on official SwapVM`,
    );
    const quote = await client.simulateContract({
      account: taker,
      address: D.swapVm,
      abi: SwapVMABI,
      functionName: "quote",
      args: [order.order.build(), tokenIn, tokenOut, amount, data],
    });
    const result = quote.result as readonly [bigint, bigint, Hex];
    quotes.push({ tokenIn, tokenOut, amount, result });
    check("Official quote produces nonzero output", result[1] > 0n);
    const deadline = (await client.getBlock()).timestamp + 300n;
    const bounded = TakerTraits.new({
      threshold: (result[1] * 995n) / 1000n,
      deadline,
    })
      .encode()
      .toString() as Hex;
    await tx(
      `Official SwapVM fill ${tokenIn === D.usdc ? "USDC to WETH" : "WETH to USDC"} (related taker)`,
      taker,
      D.swapVm,
      SwapVMABI,
      "swap",
      [order.order.build(), tokenIn, tokenOut, amount, bounded],
    );
  }
  demo.stage(
    "Accrue fork interest, close the cycle and verify settlement guards",
  );
  await fixture(
    "Advance local time to accrue real Aave interest",
    "evm_increaseTime",
    [86400],
  );
  await fixture("Mine accrued-interest block", "evm_mine", []);
  await tx(
    "Dock cycle before settlement",
    keeper,
    account,
    accountABI,
    "requestClose",
  );
  const cycle = await read(account, accountABI, "cycleId");
  let nonce = await read(account, accountABI, "nonce"),
    dockHash = await read(account, accountABI, "dockSnapshotHash");
  const lpWeth = await read(account, accountABI, "lpWeth"),
    lpUsdc = await read(account, accountABI, "lpUsdc");
  let evidenceRoot = keccak256(
    toHex(
      encode(
        operations.map((o) => ({
          sequence: o.sequence,
          hash: o.hash ?? null,
          kind: o.kind,
        })),
      ),
    ),
  );
  await tx(
    "Reject keeper profit authorization",
    keeper,
    account,
    accountABI,
    "confirmInventory",
    [cycle, nonce, dockHash, lpWeth, lpUsdc, evidenceRoot],
    0n,
    true,
  );
  await tx(
    "Approve related-taker external debt support",
    taker,
    D.usdc,
    erc,
    "approve",
    [D.aavePool, 1_000_000n],
  );
  await tx(
    "External debt repayment is capital support, not LP revenue",
    taker,
    D.aavePool,
    parseAbi([
      "function repay(address,uint256,uint256,address) returns(uint256)",
    ]),
    "repay",
    [D.usdc, 1_000_000n, 2n, account],
  );
  await tx(
    "Reject unclassified external scaled-debt movement",
    owner,
    account,
    accountABI,
    "confirmInventory",
    [cycle, nonce, dockHash, lpWeth, lpUsdc, evidenceRoot],
    0n,
    true,
  );
  await tx(
    "Reconcile outside debt burn while preserving accrued interest",
    owner,
    account,
    accountABI,
    "reconcileDebt",
    [1_000_000n, keccak256(toHex(encode(operations)))],
  );
  nonce = await read(account, accountABI, "nonce");
  dockHash = await read(account, accountABI, "dockSnapshotHash");
  evidenceRoot = keccak256(toHex(encode(operations)));
  await tx(
    "Owner confirms inventory provenance, including related takers",
    owner,
    account,
    accountABI,
    "confirmInventory",
    [cycle, nonce, dockHash, lpWeth, lpUsdc, evidenceRoot],
  );
  await tx(
    "Reject checkpoint replay",
    owner,
    account,
    accountABI,
    "confirmInventory",
    [cycle, nonce, dockHash, lpWeth, lpUsdc, evidenceRoot],
    0n,
    true,
  );
  await swapInventory(true, lpWeth);
  await tx(
    "Repay interest and split eligible closed-cycle surplus",
    owner,
    account,
    accountABI,
    "allocateCycle",
    [0n],
  );
  const nextPrincipal = await read(account, accountABI, "principal");
  if (nextPrincipal > 0n) {
    demo.stage("Prepare a subsequent cycle without new borrowing");
    await swapInventory(
      false,
      downloadedPlan
        ? (nextPrincipal * BigInt(downloadedPlan.execution.convertUsdcUnits)) /
            financing.loanUSDCUnits
        : nextPrincipal / 2n,
    );
    const nextOrder = buildOfficialOrder({
      maker: account,
      lowerPriceE6: downloadedPlan
        ? BigInt(downloadedPlan.execution.lowerPriceE6)
        : (spot * 85n) / 100n,
      upperPriceE6: downloadedPlan
        ? BigInt(downloadedPlan.execution.upperPriceE6)
        : (spot * 115n) / 100n,
      lpFeeBps: downloadedPlan?.execution.lpFeeBps ?? 30,
      salt: 2n,
    });
    requireFreshPlan("subsequent_shipment");
    await tx(
      "Ship subsequent cycle without reborrowing",
      owner,
      account,
      accountABI,
      "shipCycle",
      [nextOrder.bytes],
    );
    strategyHash = nextOrder.strategyHash;
  }
  demo.stage("Stop trading, repay residual debt and return collateral");
  await tx(
    "Owner-triggered terminal defense, independent of profit attestations",
    owner,
    account,
    accountABI,
    "defend",
  );
  const remainingWeth = await read(D.weth, erc, "balanceOf", [account]);
  if (remainingWeth > 0n)
    await tx(
      "Realize defensive WETH and repay debt",
      owner,
      account,
      accountABI,
      "realizeDefense",
      [
        (((remainingWeth * spot) / 10n ** 18n) * 98n) / 100n,
        (await client.getBlock()).timestamp + 300n,
      ],
    );
  const debt = await read(D.variableDebtUSDC, debtABI, "balanceOf", [account]);
  if (debt > 0n) {
    await tx(
      "Approve explicit external loss coverage",
      owner,
      D.usdc,
      erc,
      "approve",
      [account, debt + 1_000_000n],
    );
    await tx(
      "Repay residual debt with classified owner funds",
      owner,
      account,
      accountABI,
      "repayExternal",
      [debt + 1_000_000n],
    );
  }
  await tx(
    "Return collateral and residual assets after debt is zero",
    owner,
    account,
    accountABI,
    "exit",
  );
  demo.stage("Verify terminal balances and revoked Aqua allowances");
  const final = await snapshot();
  manifest.economicEnd = final;
  check(
    "Terminal debt is zero",
    (await read(D.variableDebtUSDC, debtABI, "balanceOf", [account])) === 0n,
  );
  check(
    "Aqua allowances revoked at exit",
    (await read(D.weth, erc, "allowance", [account, D.aqua])) === 0n &&
      (await read(D.usdc, erc, "allowance", [account, D.aqua])) === 0n,
  );
  check(
    "No inventory stranded after exit",
    (await read(D.weth, erc, "balanceOf", [account])) === 0n &&
      (await read(D.usdc, erc, "balanceOf", [account])) === 0n,
  );
} catch (error) {
  failure =
    error instanceof Error ? error.message.split("\n")[0] : "unknown_failure";
  demo.fail(error);
  process.exitCode = 1;
} finally {
  manifest.failure = failure ?? null;
  manifest.assertions = assertions;
  manifest.quotes = quotes;
  manifest.operationCount = operations.length;
  try {
    if (!failure) demo.stage("Write evidence reports and stop the owned fork");
    await writeReports(dir, manifest, operations);
    demo.report(`runs/${runId}/report.html`);
    demo.report(`runs/${runId}/manifest.json`);
  } finally {
    anvil.kill("SIGTERM");
    await Promise.race([
      new Promise((r) => anvil.once("exit", r)),
      delay(3000),
    ]);
    if (anvil.exitCode === null) anvil.kill("SIGKILL");
  }
}
if (!failure)
  demo.complete(
    `${operations.filter((op) => op.kind === "transaction").length} transactions checked; ${assertions.length} assertions passed. Related-party fills do not establish demand or profit.`,
  );

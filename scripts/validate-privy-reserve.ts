/** Protocol validation only: Anvil impersonation is never evidence of a Privy wallet action. */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
  toHex,
  type Address,
  type Hash,
} from "viem";
import { arbitrum } from "viem/chains";
import { createReserveService } from "../src/integrations/privy/service";
import { RESERVE, reserveTransaction } from "../src/integrations/privy/reserve";
import { DemoTerminal } from "../integrations/aqua/scripts/terminal";

const demo = new DemoTerminal("Privy reserve protocol validation");

async function main() {
  demo.stage("Read Arbitrum state and start the owned fork");
  const output = join(
    ".runtime",
    "privy-protocol",
    new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(output, { recursive: true });
  const upstream = createPublicClient({
    chain: arbitrum,
    transport: http(
      process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      { timeout: 15000 },
    ),
  });
  assert.equal(await upstream.getChainId(), 42161);
  const forkBlock = await upstream.getBlock();
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  const processHandle = spawn(
    process.env.ANVIL_BIN || "anvil",
    [
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--chain-id",
      "42161",
      "--fork-url",
      process.env.ARBITRUM_RPC_URL || "https://arb1.arbitrum.io/rpc",
      "--fork-block-number",
      forkBlock.number.toString(),
      "--silent",
    ],
    { stdio: "ignore" },
  );
  let spawnFailure: Error | undefined;
  processHandle.on("error", (error) => {
    spawnFailure = error;
  });
  const rpcUrl = `http://127.0.0.1:${port}`;
  const client = createPublicClient({
    chain: arbitrum,
    transport: http(rpcUrl, { timeout: 15000, retryCount: 0 }),
  });
  const wallet = createWalletClient({
    chain: arbitrum,
    transport: http(rpcUrl),
  });
  const service = createReserveService(client);
  const fixtures: unknown[] = [];
  const operations: unknown[] = [];
  const owner: Address = "0x00000000000000000000000000000000000a11ce";
  const report = {
    schemaVersion: "noria.privy.protocol-check.v1",
    mode: "isolated-local-fork",
    privyWalletActionValidated: false,
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    sourceDirty:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
    forkBlock: forkBlock.number.toString(),
    forkBlockHash: forkBlock.hash,
    startedAt: new Date().toISOString(),
    owner,
    fixtures,
    operations,
    completed: false,
    limitation:
      "All mutations target this process-owned Anvil. Synthetic funding and impersonation validate Aave integration, not Privy authentication, signatures, funding or live hackathon eligibility.",
  };
  const raw = async (method: string, params: unknown[]) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (body.error) throw new Error(`Local fixture RPC ${method} failed.`);
    return body.result;
  };
  async function fixture(method: string, params: unknown[]) {
    const result = await raw(method, params);
    fixtures.push({ method, params, result });
    return result;
  }
  async function fixtureTx(account: Address, data: `0x${string}`) {
    const hash = await wallet.sendTransaction({
      account,
      to: RESERVE.usdc,
      data,
    });
    const receipt = await client.waitForTransactionReceipt({
      hash,
      timeout: 30000,
    });
    demo.receipt("Local USDC funding fixture", receipt);
    assert.equal(receipt.status, "success");
    fixtures.push({
      account,
      to: RESERVE.usdc,
      data,
      hash,
      blockNumber: receipt.blockNumber.toString(),
    });
  }
  const deadline = setTimeout(() => processHandle.kill("SIGTERM"), 150_000);
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (spawnFailure) throw spawnFailure;
      if (processHandle.exitCode !== null)
        throw new Error("Anvil exited before startup.");
      try {
        const info = await raw("anvil_nodeInfo", []);
        assert.equal(info.environment.chainId, 42161);
        assert.equal(BigInt(info.forkConfig.forkBlockNumber), forkBlock.number);
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(ready, "Owned Anvil must be verified before any mutation.");
    demo.info(`Fork source block: ${forkBlock.number}`);
    demo.stage("Prepare explicit local fixture funds");
    for (const account of [owner]) {
      await fixture("anvil_impersonateAccount", [account]);
      await fixture("anvil_setBalance", [account, toHex(10n ** 18n)]);
    }
    const master = await client.readContract({
      address: RESERVE.usdc,
      abi: parseAbi(["function masterMinter() view returns(address)"]),
      functionName: "masterMinter",
    });
    await fixture("anvil_impersonateAccount", [master]);
    await fixture("anvil_setBalance", [master, toHex(10n ** 18n)]);
    await fixtureTx(
      master,
      encodeFunctionData({
        abi: parseAbi([
          "function configureMinter(address,uint256) returns(bool)",
        ]),
        functionName: "configureMinter",
        args: [owner, 10_000_000n],
      }),
    );
    await fixtureTx(
      owner,
      encodeFunctionData({
        abi: parseAbi(["function mint(address,uint256) returns(bool)"]),
        functionName: "mint",
        args: [owner, 10_000_000n],
      }),
    );
    for (const kind of [
      "approve",
      "supply",
      "withdraw",
      "approve",
      "revoke",
    ] as const) {
      demo.stage(`Reserve operation: ${kind}`);
      demo.activity("Prepare the exact operation and submit to the owned fork");
      const available = await service.snapshot(owner);
      const action = {
        owner,
        kind,
        amountUnits:
          kind === "revoke"
            ? "0"
            : kind === "withdraw"
              ? available.aUsdcUnits
              : kind === "approve" && operations.length > 0
                ? "1000000"
                : "10000000",
      };
      const prepared = await service.prepare(action);
      const hash: Hash = await wallet.sendTransaction({
        account: owner,
        ...reserveTransaction(action),
      });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 30000,
      });
      demo.receipt(kind, receipt);
      demo.activity("Verify token and protocol events");
      const verification = await service.verify(action, hash);
      operations.push({ prepared, verification });
      assert.equal(
        verification.status,
        "verified",
        `${kind} must verify token and protocol events`,
      );
      demo.check(`${kind}: onchain effect verified`, true);
    }
    demo.stage("Verify final balances, allowance and debt");
    const final = await service.snapshot(owner);
    // Aave scaled aToken arithmetic can round by one raw USDC unit at mint/burn.
    assert.ok(
      BigInt(final.usdcUnits) >= 9_999_998n &&
        BigInt(final.usdcUnits) <= 10_000_001n,
    );
    assert.ok(BigInt(final.aUsdcUnits) <= 2n);
    assert.equal(final.allowanceUnits, "0");
    assert.equal(final.debtBase, "0");
    report.completed = true;
    demo.check(
      "USDC returned, aUSDC within rounding tolerance, allowance and debt zero",
      true,
    );
  } catch (error) {
    demo.fail(error);
    throw error;
  } finally {
    if (report.completed)
      demo.stage("Save protocol evidence and request fork shutdown");
    clearTimeout(deadline);
    await writeFile(
      join(output, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    demo.report(`${output}/report.json`);
    processHandle.kill("SIGTERM");
    const escalation = setTimeout(() => processHandle.kill("SIGKILL"), 2000);
    escalation.unref();
  }
  demo.complete(
    `${operations.length} protocol operations passed. Privy authentication and wallet signing were not exercised.`,
  );
}
void main().catch((error) => {
  demo.fail(error);
  demo.info(
    "Protocol-only reserve validation failed. Any partial evidence is under .runtime/privy-protocol; no upstream transaction was sent.",
  );
  process.exitCode = 1;
});

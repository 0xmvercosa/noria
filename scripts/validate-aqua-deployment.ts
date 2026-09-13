/** Deploys only on a newly spawned loopback fork. No private key or public broadcaster. */
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import {
  getAddress,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { arbitrum } from "viem/chains";
import { checkAquaArtifacts } from "./lib/aqua-artifacts";
import { createDeploymentService } from "./lib/aqua-deployment";
import { DemoTerminal } from "../integrations/aqua/scripts/terminal";

const demo = new DemoTerminal("NORIA / DEPLOYMENT REHEARSAL");
async function main() {
  const owner = getAddress(
    process.env.NORIA_DEPLOYER || "0xc365B6795443380eb76516dA0Cedd5a00B349d66",
  );
  demo.stage("Rebuild and verify the deployable artifacts");
  const artifacts = checkAquaArtifacts();
  const upstream =
    process.env.ARBITRUM_RPC_URL?.trim() || "https://arb1.arbitrum.io/rpc";
  const reader = createPublicClient({
    chain: arbitrum,
    transport: http(upstream, { timeout: 20_000, retryCount: 1 }),
  });
  const block = await reader.getBlock();
  demo.stage("Start a new process-owned Arbitrum fork");
  const listener = createServer();
  await new Promise<void>((resolve) =>
    listener.listen(0, "127.0.0.1", resolve),
  );
  const port = (listener.address() as { port: number }).port;
  await new Promise<void>((resolve) => listener.close(() => resolve()));
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
      String(block.number),
      "--chain-id",
      "42161",
      "--silent",
    ],
    { stdio: "ignore" },
  );
  const url = `http://127.0.0.1:${port}`;
  const service = createDeploymentService(artifacts, owner, url);
  const client = service.client;
  const request = (method: string, params: unknown[] = []) =>
    client.request({ method, params } as never) as Promise<unknown>;
  const operations: unknown[] = [];
  const report = {
    schemaVersion: "noria.aqua.deployment-rehearsal.v1",
    mode: "process-owned-local-fork",
    owner,
    sourceBlock: String(block.number),
    sourceBlockHash: block.hash,
    operations,
    publicDeployment: false,
  };
  try {
    anvil.on("error", () =>
      demo.info("Anvil could not start. Check ANVIL_BIN and PATH."),
    );
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        await request("anvil_nodeInfo");
        ready = true;
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    if (!ready) throw new Error("Owned fork did not start.");
    const info = (await request("anvil_nodeInfo")) as {
      forkConfig?: { forkUrl?: string; forkBlockNumber?: number };
    };
    if (
      anvil.exitCode !== null ||
      info.forkConfig?.forkUrl !== upstream ||
      BigInt(info.forkConfig?.forkBlockNumber ?? 0) !== block.number
    )
      throw new Error("Fork metadata does not match the spawned process.");
    await request("anvil_impersonateAccount", [owner]);
    await request("anvil_setBalance", [owner, "0x4563918244f40000"]);
    operations.push({
      kind: "fixture",
      action: "impersonate and fund deployer with 5 ETH on owned fork only",
      owner,
    });
    const wallet = createWalletClient({
      account: owner,
      chain: arbitrum,
      transport: http(url),
    });
    let adapter: Address | null = null;
    for (const stage of ["adapter", "factory"] as const) {
      demo.stage(
        `Simulate, deploy and verify ${stage} using the Rabby assistant service`,
      );
      const review = await service.prepare(stage, adapter);
      const hash = await wallet.sendTransaction({
        data: review.data,
        value: 0n,
        nonce: review.nonce,
        gas: BigInt(review.gas),
      });
      await client.waitForTransactionReceipt({ hash, timeout: 30_000 });
      const result = await service.verify(review, hash);
      if (result.receipt.status !== "success")
        throw new Error("Fork deployment reverted.");
      demo.receipt(stage, result.receipt);
      operations.push({ review, hash, ...result });
      if (stage === "adapter") adapter = review.expectedAddress;
    }
    demo.check(
      "Both exact deployments accepted by the public launch identity checks",
      true,
    );
    demo.complete(
      "Deployment rehearsal passed. No public deployment or Rabby signature occurred.",
    );
  } finally {
    await mkdir(".runtime", { recursive: true });
    await writeFile(
      ".runtime/aqua-deployment-rehearsal.json",
      JSON.stringify(
        report,
        (_, v) => (typeof v === "bigint" ? String(v) : v),
        2,
      ) + "\n",
    );
    anvil.kill("SIGTERM");
    demo.info("Report: .runtime/aqua-deployment-rehearsal.json");
  }
}
main().catch((error) => {
  demo.fail(error);
  process.exitCode = 1;
});

/** Local Rabby deployment assistant. The server has no key, signer or broadcast method. */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  getAddress,
  isAddress,
  isHash,
  keccak256,
  stringToHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { checkAquaArtifacts } from "./lib/aqua-artifacts";
import {
  createDeploymentService,
  adapterArgs,
  protocols,
  type DeploymentReview,
} from "./lib/aqua-deployment";
import { readEthUsd } from "../src/providers/eth-usd";

const origin = "http://127.0.0.1:3210";
let ownedServer: ReturnType<typeof createServer> | undefined;
const output = ".runtime/aqua-deployment";
const ownerInput =
  process.env.NORIA_DEPLOYER || "0xc365B6795443380eb76516dA0Cedd5a00B349d66";
const json = (v: unknown) =>
  JSON.stringify(
    v,
    (_, value) => (typeof value === "bigint" ? String(value) : value),
    2,
  );
type State = {
  version: 1;
  owner: Address;
  buildHash: Hex;
  adapter: Address | null;
  factory: Address | null;
  pending: {
    reviewId: string;
    review: DeploymentReview;
    signingStarted: boolean;
    hash: Hex | null;
  } | null;
  operations: unknown[];
};

async function main() {
  if (process.env.VERCEL) throw new Error("This command is local only.");
  if (!isAddress(ownerInput))
    throw new Error("NORIA_DEPLOYER must be a public wallet address.");
  const owner = getAddress(ownerInput);
  console.log(
    "\n  NORIA / CONTRACT DEPLOYMENT\n  Local preparation · Rabby signatures · Arbitrum One\n",
  );
  console.log("  RUN   Rebuilding and checking reviewed contract artifacts…");
  const artifacts = checkAquaArtifacts();
  const buildHash = keccak256(
    stringToHex(
      json({
        factory: artifacts.factory.bytecode.object,
        adapter: artifacts.adapter.bytecode.object,
        adapterArgs,
        protocols: protocols(zeroAddress),
      }),
    ),
  );
  const service = createDeploymentService(artifacts, owner);
  console.log(
    "  PASS  Solidity artifacts match the frontend runtime identities.",
  );
  // Claim the fixed port before touching the journal. A second process must not
  // read and rewrite a live process's pending marker before failing EADDRINUSE.
  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.end("Initializing local deployment state.");
  });
  ownedServer = server;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(3210, "127.0.0.1", resolve);
  });
  let state: State = {
    version: 1,
    owner,
    buildHash,
    adapter: null,
    factory: null,
    pending: null,
    operations: [],
  };
  await mkdir(output, { recursive: true });
  try {
    state = JSON.parse(await readFile(`${output}/deployment.json`, "utf8"));
    if (
      state.version !== 1 ||
      state.owner !== owner ||
      state.buildHash !== buildHash
    )
      throw new Error(
        "Saved deployment belongs to a different wallet or build. Preserve its report and use a separate checkout.",
      );
  } catch (e) {
    if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT"))
      throw e;
  }
  async function save() {
    await writeFile(`${output}/deployment.tmp`, json(state) + "\n", {
      mode: 0o600,
    });
    await rename(`${output}/deployment.tmp`, `${output}/deployment.json`);
  }
  await save();
  const token = randomBytes(24).toString("hex");
  let busy = false;
  const publicFiles: Record<string, [string, string]> = {
    "/": ["scripts/deploy/index.html", "text/html; charset=utf-8"],
    "/app.js": ["scripts/deploy/app.js", "text/javascript; charset=utf-8"],
    "/style.css": ["scripts/deploy/style.css", "text/css; charset=utf-8"],
  };
  server.removeAllListeners("request");
  server.on("request", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const reply = (value: unknown, status = 200) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      res.end(json(value));
    };
    if (
      req.headers.host !== "127.0.0.1:3210" ||
      (req.headers.origin && req.headers.origin !== origin)
    ) {
      reply({ error: "Local origin required." }, 403);
      return;
    }
    const pathname = new URL(req.url || "/", origin).pathname;
    if (req.method === "GET" && publicFiles[pathname]) {
      const [path, type] = publicFiles[pathname];
      res.setHeader("Content-Type", type);
      res.end(await readFile(path));
      return;
    }
    if (req.method === "GET" && pathname === "/api/state") {
      let balanceWei: string | null = null;
      try {
        balanceWei = String(
          await service.client.getBalance({ address: owner }),
        );
      } catch {
        /* Display unavailable. */
      }
      const price = await readEthUsd().catch(() => null);
      reply({
        state,
        token,
        balanceWei,
        price,
        reportPath: `${output}/deployment.json`,
      });
      return;
    }
    if (req.method === "GET" && pathname === "/report.json") {
      reply(state);
      return;
    }
    if (
      req.method !== "POST" ||
      req.headers.origin !== origin ||
      req.headers["x-noria-session"] !== token ||
      !req.headers["content-type"]?.startsWith("application/json")
    ) {
      reply({ error: "Use the local deployment page." }, 403);
      return;
    }
    if (busy) {
      reply({ error: "Another local operation is in progress." }, 409);
      return;
    }
    busy = true;
    try {
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 2048) throw new Error("Request too large.");
      }
      const input = JSON.parse(body || "{}");
      if (
        pathname !== "/api/prepare" &&
        (!state.pending || input.reviewId !== state.pending.reviewId)
      ) {
        throw new Error(
          "This review changed in another tab. Reload and inspect the current operation before continuing.",
        );
      }
      if (pathname === "/api/prepare") {
        if (state.pending)
          throw new Error(
            "Resolve the saved operation before preparing another deployment.",
          );
        if (state.factory)
          throw new Error("Both contracts are already deployed.");
        const stage = state.adapter ? "factory" : "adapter";
        console.log(
          `  RUN   Checking official contracts and estimating ${stage} creation…`,
        );
        const review = await service.prepare(stage, state.adapter);
        state.pending = {
          reviewId: randomBytes(16).toString("hex"),
          review,
          signingStarted: false,
          hash: null,
        };
        await save();
        const a = artifacts[stage];
        await writeFile(
          `${output}/${stage}-constructor-args.txt`,
          stage === "adapter"
            ? review.constructorArgs.join(" ") + "\n"
            : `(${Object.values(review.constructorArgs[0] as object).join(",")})\n`,
        );
        await writeFile(
          `${output}/${stage}-unsigned.json`,
          json(review) + "\n",
        );
        try {
          const standard = execFileSync(
            process.env.FORGE_BIN || "forge",
            [
              "verify-contract",
              review.expectedAddress,
              `src/${stage === "adapter" ? "UniswapInventoryAdapter" : "PositionFactory"}.sol:${stage === "adapter" ? "UniswapInventoryAdapter" : "PositionFactory"}`,
              "--root",
              "integrations/aqua/contracts",
              "--show-standard-json-input",
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
          );
          await writeFile(`${output}/${stage}-standard-input.json`, standard);
        } catch {
          /* Source verification instructions also support generating this manually. */
        }
        console.log(
          `  PASS  ${stage} prepared. No transaction signed or sent.`,
        );
        reply({ review, abi: a.abi });
      } else if (pathname === "/api/begin") {
        const p = state.pending;
        if (!p || p.signingStarted || Date.now() >= p.review.expiresAt)
          throw new Error(
            "Review expired or already submitted. Inspect saved state before continuing.",
          );
        if (
          (await service.client.getTransactionCount({
            address: owner,
            blockTag: "pending",
          })) !== p.review.nonce
        )
          throw new Error(
            "Wallet nonce changed. Cancel this unsigned review and prepare again.",
          );
        p.signingStarted = true;
        await save();
        reply({ review: p.review, reviewId: p.reviewId });
      } else if (pathname === "/api/submitted") {
        if (!state.pending?.signingStarted || !isHash(input.hash))
          throw new Error(
            "No matching signing request or invalid transaction hash.",
          );
        if (state.pending.hash && state.pending.hash !== input.hash)
          throw new Error(
            "A different hash is already saved. Use receipt recovery to inspect a replacement.",
          );
        state.pending.hash = input.hash;
        await save();
        console.log(
          `  WAIT  ${state.pending.review.stage} receipt: ${input.hash}`,
        );
        reply({ saved: true });
      } else if (pathname === "/api/verify") {
        const p = state.pending;
        if (!p || !isHash(input.hash))
          throw new Error("A saved review and transaction hash are required.");
        const result = await service.verify(p.review, input.hash);
        if (result.receipt.status === "success")
          state[p.review.stage] = p.review.expectedAddress;
        state.operations.push({
          review: p.review,
          hash: input.hash,
          ...result,
        });
        state.pending = null;
        await save();
        console.log(
          `  ${result.receipt.status === "success" ? "PASS" : "FAIL"}  ${p.review.stage} receipt ${result.receipt.status} at block ${result.receipt.blockNumber}.\n        Report: ${output}/deployment.json`,
        );
        reply({
          verified: result.receipt.status === "success",
          address: result.receipt.contractAddress,
        });
      } else if (pathname === "/api/cancel") {
        if (!state.pending) throw new Error("No saved operation.");
        if (state.pending.signingStarted && input.acknowledged !== true)
          throw new Error(
            "Inspect Rabby and Arbiscan before acknowledging no pending deployment.",
          );
        state.operations.push({
          review: state.pending.review,
          hash: state.pending.hash,
          status: state.pending.signingStarted
            ? "owner-acknowledged-not-pending"
            : "unsigned-review-cancelled",
          recordedAt: new Date().toISOString(),
        });
        state.pending = null;
        await save();
        reply({ cancelled: true });
      } else reply({ error: "Unknown action." }, 404);
    } catch (e) {
      // Provider errors can contain credential-bearing RPC URLs, paths and calldata.
      const raw = e instanceof Error ? e.message : "Operation failed.";
      const safe =
        raw.includes("http") ||
        raw.includes("Request Arguments") ||
        raw.length > 350
          ? "RPC operation could not be verified. Check connectivity, Arbitrum ETH balance and the saved hash. An error does not prove a transaction was cancelled."
          : raw;
      console.error(`  FAIL  ${safe}`);
      reply({ error: safe }, 400);
    } finally {
      busy = false;
    }
  });
  server.on("error", (e) => {
    console.error(
      "Could not start local deployment page. Port 3210 may already be in use.",
    );
    process.exitCode = 1;
  });
  console.log(
    `\n  READY ${origin}\n        Deployer: ${owner}\n        Open this address in the browser with Rabby installed.\n        Keep this terminal open. Ctrl+C stops the local server.\n`,
  );
}
main().catch((e) => {
  ownedServer?.close();
  console.error(
    e instanceof Error && !("stderr" in e)
      ? e.message
      : "Build failed. Run npm run aqua:artifacts to inspect the local build.",
  );
  process.exitCode = 1;
});

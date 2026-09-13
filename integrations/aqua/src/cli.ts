import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CandidateBundleSchema,
  DiscoveryRequestSchema,
  type CanonicalEvidence,
} from "./boundary.js";
import { planAquaPosition } from "./planner.js";
import { verifySourcePool } from "./verifier.js";
import type { Address } from "viem";

async function main() {
  const [command, path] = process.argv.slice(2);
  if (command !== "plan" || !path)
    throw new Error(
      "Usage: pnpm exec tsx src/cli.ts plan <candidate-bundle.json>",
    );
  const bundle = CandidateBundleSchema.parse(
    JSON.parse(await readFile(path, "utf8")),
  );
  const request = DiscoveryRequestSchema.parse(
    JSON.parse(
      await readFile(join(dirname(path), "discovery-request.json"), "utf8"),
    ),
  );
  const synthetic =
    bundle.candidates.length > 0 &&
    bundle.candidates.every((c) => c.source.mode === "synthetic-example");
  let evidence: CanonicalEvidence[];
  let now = new Date();
  if (synthetic) {
    evidence = JSON.parse(
      await readFile(
        join(dirname(path), "canonical-evidence.synthetic.json"),
        "utf8",
      ),
    ) as CanonicalEvidence[];
    if (evidence.some((e) => e.mode !== "synthetic-example"))
      throw new Error("example_evidence_must_be_synthetic");
    now = new Date(request.createdAt);
  } else {
    const rpc = process.env.ARBITRUM_RPC_URL ?? "https://arb1.arbitrum.io/rpc";
    evidence = await Promise.all(
      bundle.candidates.map((c) =>
        verifySourcePool(
          rpc,
          c.sourcePool.address as Address,
          BigInt(c.source.indexedBlock.number),
        ),
      ),
    );
  }
  const decision = planAquaPosition(request, bundle, evidence, now);
  process.stdout.write(
    JSON.stringify(
      { evaluationClock: now.toISOString(), synthetic, decision },
      null,
      2,
    ) + "\n",
  );
}
main().catch((error: unknown) => {
  // Avoid serializing request objects, RPC URLs, headers or environment values.
  process.stderr.write(
    error instanceof Error
      ? error.message.split("\n")[0] + "\n"
      : "command_failed\n",
  );
  process.exitCode = 1;
});

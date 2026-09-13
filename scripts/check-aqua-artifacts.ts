import { checkAquaArtifacts } from "./lib/aqua-artifacts";
try {
  const args = process.argv.slice(2);
  if (args.some((v) => v !== "--write"))
    throw new Error("Usage: npm run aqua:artifacts [-- --write]");
  const { factory } = checkAquaArtifacts(args.includes("--write"));
  console.log(
    `PASS  Reviewed Aqua artifacts match Solidity 0.8.30 / Cancun / optimizer 200. Factory runtime: ${(factory.deployedBytecode.object.length - 2) / 2} / 24576 bytes.`,
  );
} catch (error) {
  console.error(
    error instanceof Error && !("stderr" in error)
      ? error.message
      : "Aqua artifact build failed. Run forge build --root integrations/aqua/contracts locally to inspect it.",
  );
  process.exitCode = 1;
}

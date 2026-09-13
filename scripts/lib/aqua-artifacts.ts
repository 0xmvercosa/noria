import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { keccak256, stringToHex, type Abi, type Hex } from "viem";

const root = "integrations/aqua/contracts";
export type ForgeArtifact = {
  abi: Abi;
  bytecode: { object: Hex };
  deployedBytecode: { object: Hex };
  metadata: {
    compiler: { version: string };
    settings: {
      optimizer: { enabled: boolean; runs: number };
      evmVersion: string;
    };
  };
};
export function readAquaArtifact(name: string): ForgeArtifact {
  return JSON.parse(
    readFileSync(`${root}/out/${name}.sol/${name}.json`, "utf8"),
  );
}

/** Rebuild before comparing: an old out/ folder must never authorize a deployment. */
export function checkAquaArtifacts(write = false) {
  execFileSync(process.env.FORGE_BIN || "forge", ["build", "--root", root], {
    stdio: "pipe",
  });
  const factory = readAquaArtifact("PositionFactory");
  const adapter = readAquaArtifact("UniswapInventoryAdapter");
  for (const a of [factory, adapter]) {
    if (
      a.metadata.compiler.version !== "0.8.30+commit.73712a01" ||
      !a.metadata.settings.optimizer.enabled ||
      a.metadata.settings.optimizer.runs !== 200 ||
      a.metadata.settings.evmVersion !== "cancun"
    )
      throw new Error(
        "Unexpected Solidity compiler settings. Restore the reviewed foundry.toml.",
      );
  }
  const source = `${root}/src/PositionFactory.sol`;
  const expected = [
    [
      "public/aqua/position-factory-artifact.json",
      {
        schemaVersion: "noria.aqua.position-factory.v1",
        contractName: "PositionFactory",
        source,
        sourceHash: keccak256(stringToHex(readFileSync(source, "utf8"))),
        compiler: {
          version: factory.metadata.compiler.version,
          optimizer: factory.metadata.settings.optimizer,
          evmVersion: factory.metadata.settings.evmVersion,
        },
        abi: factory.abi,
        runtimeBytecode: factory.deployedBytecode.object,
        runtimeCodeHash: keccak256(factory.deployedBytecode.object),
        runtimeSizeBytes: (factory.deployedBytecode.object.length - 2) / 2,
      },
    ],
    [
      "public/aqua/inventory-adapter-artifact.json",
      {
        schemaVersion: "noria.aqua.inventory-adapter.v1",
        source: `${root}/src/UniswapInventoryAdapter.sol`,
        compilerVersion: adapter.metadata.compiler.version,
        abi: adapter.abi,
        creationBytecode: adapter.bytecode.object,
        creationCodeHash: keccak256(adapter.bytecode.object),
      },
    ],
  ] as const;
  if ((factory.deployedBytecode.object.length - 2) / 2 > 24576)
    throw new Error("Factory runtime exceeds the EIP-170 size limit.");
  for (const [file, value] of expected) {
    if (write) writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
    else if (
      JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) !==
      JSON.stringify(value)
    ) {
      throw new Error(
        `Stale public artifact: ${file}. Regenerate with npm run aqua:artifacts -- --write, review the diff, then rebuild the application.`,
      );
    }
  }
  return { factory, adapter };
}

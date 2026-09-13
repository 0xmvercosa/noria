/** Re-render stored receipts/journal without running a node or changing transaction evidence. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { writeReports } from "../src/rehearsal-report.js";
const dir = process.argv[2];
if (!dir) throw new Error("Usage: pnpm report <run-directory>");
const manifest = JSON.parse(
  await readFile(resolve(dir, "manifest.json"), "utf8"),
);
if (manifest.schemaVersion !== "noria.aqua.run.v1")
  throw new Error("unsupported_run_schema");
const operations = (await readFile(resolve(dir, "operations.jsonl"), "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
await writeReports(dir, manifest, operations);
console.log("Regenerated report from existing operation evidence.");

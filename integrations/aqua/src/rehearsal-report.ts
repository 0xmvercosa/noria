import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DEPLOYMENTS } from "./official.js";

// Journal data includes protocol-specific decoded event shapes and raw RPC receipts.
// Integers may be bigint in a live run or decimal strings in a persisted journal.
type JournalRecord = Record<string, any>;
export const reportJSON = (value: unknown) =>
  JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reconcile tracked assets at one common price; internal transfers cancel across actors. */
export function summarizeEconomics(
  manifest: JournalRecord,
  operations: JournalRecord[],
) {
  if (!manifest.economicStart || !manifest.economicEnd) return null;
  const price = BigInt(manifest.valuationPriceUSDCPerWethE6);
  const initial = manifest.economicStart.wallets as JournalRecord[];
  const final = manifest.economicEnd.wallets as JournalRecord[];
  if (
    new Set(initial.map((w) => w.address.toLowerCase())).size !==
      initial.length ||
    new Set(final.map((w) => w.address.toLowerCase())).size !== final.length ||
    initial.length !== final.length
  )
    throw new Error("duplicate_or_missing_actor_in_journal");
  const equity = (w: JournalRecord) =>
    ((BigInt(w.native) + BigInt(w.weth) + BigInt(w.aWeth)) * price) /
      10n ** 18n +
    BigInt(w.usdc) +
    BigInt(w.aUSDC) -
    BigInt(w.debt);
  let unrelatedAaveAccrual = 0n;
  const actors = initial.map((w) => {
    const end = final.find((x) => same(x.address, w.address));
    if (!end) throw new Error("missing_final_actor");
    // Custom public wallet addresses can already own aWETH/aUSDC/USDC debt on the fork.
    // The runner never modifies those positions, so their accrual is excluded from strategy P&L.
    if (!same(w.address, manifest.account))
      unrelatedAaveAccrual +=
        ((BigInt(end.aWeth) - BigInt(w.aWeth)) * price) / 10n ** 18n +
        BigInt(end.aUSDC) -
        BigInt(w.aUSDC) -
        BigInt(end.debt) +
        BigInt(w.debt);
    return {
      address: w.address,
      initialEquityUSDCUnits: equity(w),
      finalEquityUSDCUnits: equity(end),
      changeUSDCUnits: equity(end) - equity(w),
    };
  });
  const events = operations.flatMap((o) => o.events ?? []);
  const repayments = events
    .filter(
      (e) =>
        e.eventName === "Repay" &&
        same(e.address, DEPLOYMENTS.aavePool) &&
        same(e.args.user, manifest.account),
    )
    .reduce((n: bigint, e: any) => n + BigInt(e.args.amount), 0n);
  const accountStart = initial.find((w) => same(w.address, manifest.account))!;
  const accountEnd = final.find((w) => same(w.address, manifest.account))!;
  const interest =
    BigInt(accountEnd.debt) -
    BigInt(accountStart.debt) +
    repayments -
    BigInt(manifest.financing.loanUSDCUnits);
  const closed = events.find(
    (e) => e.eventName === "Closed" && same(e.address, manifest.account),
  );
  const yieldUnits = closed
    ? BigInt(closed.args.collateralReturned) -
      BigInt(manifest.intent.collateralAmountUnits)
    : null;
  const reference =
    manifest.valuationBlock ??
    operations.find((o) => o.functionName === "swapInventory")?.after;
  const group = actors.reduce((n: bigint, w: any) => n + w.changeUSDCUnits, 0n);
  return {
    valuation:
      "One reference price captured after the initial inventory conversion, applied to both endpoints; gas is already in native equity.",
    referenceBlock: reference
      ? {
          number: reference.number ?? reference.blockNumber,
          hash: reference.hash ?? reference.blockHash,
          timestamp: reference.timestamp,
        }
      : null,
    actors,
    relatedPartyGroupNetUSDCUnits: group,
    unrelatedExistingAaveAccrualUSDCUnits: unrelatedAaveAccrual,
    strategyGroupNetUSDCUnits: group - unrelatedAaveAccrual,
    totalAaveRepaidUSDCUnits: repayments,
    totalBorrowInterestUSDCUnits: interest,
    collateralYieldUnits: yieldUnits,
    collateralYieldAsset: manifest.intent.fundingAsset,
    collateralYieldSource: "Closed.collateralReturned at actual withdrawal",
    organicDemandProven: false,
    gasCaveat:
      "Local EVM gas accounting is not an Arbitrum L1 data-fee forecast.",
  };
}

export async function writeReports(
  dir: string,
  manifest: JournalRecord,
  operations: JournalRecord[],
) {
  manifest.economics = summarizeEconomics(manifest, operations);
  await writeFile(resolve(dir, "manifest.json"), reportJSON(manifest));
  const esc = (s: string) =>
    s.replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c]!,
    );
  const rows = operations
    .map(
      (o) =>
        `| ${o.sequence} | ${o.kind} | ${o.name} | ${o.status ?? "local fixture"} | ${o.hash ?? "n/a"} |`,
    )
    .join("\n");
  const md = `# Noria Aqua local-fork rehearsal\n\nStatus: ${manifest.failure ? "FAILED: " + manifest.failure : "PASSED"}. Fork block: ${manifest.forkBlock}. Funding: ${manifest.intent.fundingAsset}.\n\nOfficial Aqua, SwapVM and Aave bytecode are preserved. Fixture funding, credential issuance and time travel occur only on an isolated local fork. Related taker fees are not organic demand or group profit. Local transaction hashes have no public explorer links.\n\n## Operations\n\n| # | Kind | Operation | Status | Local transaction hash |\n|---|---|---|---|---|\n${rows}\n\n## Economic reconciliation\n\n${manifest.economics ? "```json\n" + reportJSON(manifest.economics) + "\n```" : "Not available: rehearsal did not reach settlement."}\n\n## Evidence\n\nSee manifest.json for code hashes, financing and assertions; operations.jsonl for before/after balances and costs; transaction JSON files for receipts, calldata, logs and call traces.\n`;
  await writeFile(resolve(dir, "report.md"), md);
  await writeFile(
    resolve(dir, "report.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>Noria Aqua rehearsal</title><style>body{font:15px system-ui;margin:40px;max-width:1400px}pre{white-space:pre-wrap;overflow-wrap:anywhere}details{border-top:1px solid #ddd;padding:12px}</style><h1>Noria Aqua local-fork rehearsal</h1><pre>${esc(md)}</pre>${operations.map((o) => `<details><summary>${esc(`${o.sequence}. ${o.name}`)}</summary><pre>${esc(reportJSON(o))}</pre></details>`).join("")}</html>`,
  );
}

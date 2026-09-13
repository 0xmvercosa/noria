import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, open, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isAddress } from "viem";
import { parseRehearsalPlan } from "@noria/aqua/rehearsal-plan";
import { readBoundedBody, BodyTooLargeError } from "./request-body";

const root = () => resolve(process.cwd(), ".runtime", "aqua-rehearsals");
const validId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
export function localRehearsalEnabled(request: Request) {
  const url = new URL(request.url);
  return (
    process.env.NORIA_ENABLE_LOCAL_FORK === "1" &&
    !process.env.VERCEL &&
    process.platform !== "win32" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}
export type LocalRun = {
  runId: string;
  status: "running" | "completed" | "failed";
  message?: string;
  reportUrl?: string;
};
async function save(run: LocalRun) {
  await writeFile(join(root(), run.runId, "status.json"), JSON.stringify(run));
}
export async function readLocalRun(runId: string): Promise<LocalRun> {
  if (!validId(runId)) throw new Error("invalid_run_id");
  return JSON.parse(await readFile(join(root(), runId, "status.json"), "utf8"));
}
/** All paths and child arguments are generated locally. The request supplies no command or RPC. */
export async function startLocalRun(
  rawPlan: unknown,
  owner: string,
): Promise<LocalRun> {
  if (process.platform === "win32")
    throw new Error("local_runner_requires_posix");
  const plan = parseRehearsalPlan(rawPlan);
  if (
    !isAddress(owner) ||
    [
      "0x0000000000000000000000000000000000000000",
      "0x000000000000000000000000000000000000c0de",
    ].includes(owner.toLowerCase())
  )
    throw new Error("invalid_owner");
  const runId = randomUUID(),
    dir = join(root(), runId);
  await mkdir(root(), { recursive: true });
  const lockPath = join(root(), "active.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch {
    throw new Error("rehearsal_already_running");
  }
  await lock.writeFile(runId);
  await lock.close();
  try {
    await mkdir(dir);
    const planPath = join(dir, "plan.json");
    await writeFile(planPath, JSON.stringify(plan));
    const state: LocalRun = {
      runId,
      status: "running",
      message: "Starting an isolated local Arbitrum rehearsal.",
    };
    await save(state);
    const moduleDir = resolve(process.cwd(), "integrations/aqua");
    const taker =
      owner.toLowerCase() === "0x0000000000000000000000000000000000000b0b"
        ? "0x00000000000000000000000000000000000a11ce"
        : "0x0000000000000000000000000000000000000b0b";
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/rehearse.ts"],
      {
        cwd: moduleDir,
        // A private POSIX process group lets the deadline stop Node, Forge and Anvil together.
        detached: true,
        env: {
          ...process.env,
          NORIA_PLAN_FILE: planPath,
          NORIA_OWNER: owner,
          NORIA_TAKER: taker,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-200000);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    let timedOut = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stopGroup = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup("SIGTERM");
      forceTimer = setTimeout(() => stopGroup("SIGKILL"), 10_000);
      forceTimer.unref();
    }, 240_000);
    timer.unref();
    let finished = false;
    const finish = async (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      try {
        await writeFile(join(dir, "process.log"), output);
        const match = /Report: runs\/([0-9TZ.\-]+)\/report\.html/.exec(output);
        let reportUrl: string | undefined;
        if (match) {
          const reportDir = join(moduleDir, "runs", match[1]!);
          await writeFile(
            join(dir, "report-location.json"),
            JSON.stringify({ directory: reportDir }),
          );
          reportUrl = `/api/aqua/v1/local-rehearsal/report?runId=${runId}`;
        }
        if (code === 0 && reportUrl && !timedOut)
          await save({
            runId,
            status: "completed",
            message:
              "Rehearsal completed. Review all operations and consolidated results.",
            reportUrl,
          });
        else
          await save({
            runId,
            status: "failed",
            message:
              "The local rehearsal stopped. Inspect its local process log and any partial report; no public-chain transaction was sent.",
            ...(reportUrl ? { reportUrl } : {}),
          });
      } finally {
        if ((await readFile(lockPath, "utf8").catch(() => "")) === runId)
          await unlink(lockPath).catch(() => {});
      }
    };
    const complete = (code: number | null) => {
      void finish(code).catch(() =>
        console.error("Local rehearsal status could not be persisted."),
      );
    };
    child.once("error", () => complete(1));
    child.once("close", complete);
    return state;
  } catch (error) {
    await unlink(lockPath).catch(() => {});
    throw error;
  }
}
export async function readLocalReport(runId: string) {
  const run = await readLocalRun(runId);
  if (run.status === "running" || !run.reportUrl)
    throw new Error("report_not_ready");
  const location = JSON.parse(
    await readFile(join(root(), runId, "report-location.json"), "utf8"),
  );
  const allowed = resolve(process.cwd(), "integrations/aqua/runs") + "/";
  const directory = resolve(location.directory);
  if (!directory.startsWith(allowed))
    throw new Error("invalid_report_location");
  return readFile(join(directory, "report.html"), "utf8");
}
export function createLocalRehearsalHandlers(start = startLocalRun) {
  const json = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return {
    GET: async (request: Request) => {
      if (!localRehearsalEnabled(request)) return json({ enabled: false });
      const id = new URL(request.url).searchParams.get("runId");
      if (!id) return json({ enabled: true });
      try {
        return json(await readLocalRun(id));
      } catch {
        return json({ message: "Run not found." }, 404);
      }
    },
    POST: async (request: Request) => {
      if (!localRehearsalEnabled(request))
        return json(
          { message: "Local rehearsal is disabled on this host." },
          403,
        );
      if (
        request.headers.get("origin") &&
        request.headers.get("origin") !== new URL(request.url).origin
      )
        return json(
          { message: "Cross-origin rehearsal requests are not allowed." },
          403,
        );
      if (
        request.headers
          .get("content-type")
          ?.split(";")[0]
          .trim()
          .toLowerCase() !== "application/json"
      )
        return json({ message: "Use application/json." }, 415);
      try {
        const text = await readBoundedBody(request, 1_500_000);
        const body = JSON.parse(text);
        if (
          !body ||
          typeof body.owner !== "string" ||
          !Object.hasOwn(body, "plan") ||
          Object.keys(body).some((k) => !["owner", "plan"].includes(k))
        )
          return json(
            { message: "Provide only an owner address and a position plan." },
            400,
          );
        return json(await start(body.plan, body.owner), 202);
      } catch (error) {
        if (error instanceof BodyTooLargeError)
          return json({ message: "Plan is too large." }, 413);
        return json(
          {
            message:
              error instanceof Error &&
              error.message === "rehearsal_already_running"
                ? "A local rehearsal is already running."
                : "Invalid or expired plan, invalid wallet, or unavailable local runner.",
          },
          409,
        );
      }
    },
  };
}

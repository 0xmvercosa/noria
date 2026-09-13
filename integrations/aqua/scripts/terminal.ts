import { performance } from "node:perf_hooks";
import { clearLine, cursorTo } from "node:readline";

type ReceiptSummary = {
  transactionHash: string;
  status: "success" | "reverted";
  blockNumber: bigint;
  gasUsed: bigint;
  effectiveGasPrice: bigint;
};

export function elapsed(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.floor((milliseconds % 60_000) / 1000)}s`;
}

/** Errors can include RPC credentials or local paths; retain only a safe first line. */
export function terminalError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown failure";
  return message
    .split("\n")[0]!
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[RPC endpoint]")
    .replace(/0x[0-9a-f]{64}/gi, "[redacted value]")
    .replace(/(?:\/[\w.~-]+){2,}/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 400);
}

/** Presentation only: never inspects wallets, changes evidence, or submits transactions. */
export class DemoTerminal {
  private readonly startedAt = performance.now();
  private readonly stream = process.stderr;
  private readonly interactive = Boolean(
    process.stderr.isTTY && !process.env.CI && process.env.TERM !== "dumb",
  );
  private timer: ReturnType<typeof setInterval> | undefined;
  private current:
    | { label: string; startedAt: number; index: number }
    | undefined;
  private activityLabel = "";
  private stageCount = 0;
  private frame = 0;
  private failed = false;

  constructor(private readonly title: string) {
    this.line(title);
    this.line(
      "Mode: process-owned local Arbitrum fork; fixture funds and local impersonation.",
    );
  }

  stage(label: string) {
    this.finishStage("PASS");
    this.current = {
      label,
      startedAt: performance.now(),
      index: ++this.stageCount,
    };
    this.activityLabel = label;
    this.line(`[RUN] ${this.stageCount}. ${label}`);
    if (this.interactive) {
      this.timer = setInterval(() => this.render(), 120);
      this.timer.unref();
      this.render();
    }
  }

  activity(label: string) {
    this.activityLabel = label;
    if (this.interactive) this.render();
    else this.line(`  … ${label}`);
  }

  info(message: string) {
    this.print(`  ${message}`);
  }

  check(label: string, passed: boolean) {
    this.print(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  }

  receipt(label: string, receipt: ReceiptSummary, expectedRevert = false) {
    const passed = (receipt.status === "reverted") === expectedRevert;
    const result =
      receipt.status === "reverted" && expectedRevert
        ? "expected revert confirmed"
        : `receipt ${receipt.status}`;
    this.print(`  [${passed ? "PASS" : "FAIL"}] ${label} · ${result}`);
    this.print(`    tx ${receipt.transactionHash}`);
    this.print(
      `    block ${receipt.blockNumber} · gas ${receipt.gasUsed} · network fee ${receipt.gasUsed * receipt.effectiveGasPrice} wei`,
    );
  }

  report(path: string) {
    this.info(`Report: ${path}`);
  }

  complete(message: string) {
    this.finishStage("PASS");
    this.line(
      `[PASS] ${this.title} · ${elapsed(performance.now() - this.startedAt)}`,
    );
    this.line(`  ${message}`);
  }

  fail(error: unknown) {
    if (this.failed) return;
    this.failed = true;
    this.finishStage("FAIL");
    this.line(
      `[FAIL] ${this.title} · ${elapsed(performance.now() - this.startedAt)}`,
    );
    this.line(`  ${terminalError(error)}`);
  }

  private finishStage(result: "PASS" | "FAIL") {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.clear();
    if (this.current) {
      this.line(
        `[${result}] ${this.current.index}. ${this.current.label} · ${elapsed(performance.now() - this.current.startedAt)}`,
      );
      this.current = undefined;
    }
  }

  private render() {
    if (!this.current) return;
    this.clear();
    const spinner = ["|", "/", "-", "\\"][this.frame++ % 4];
    const text = `  ${spinner} ${this.activityLabel} · ${elapsed(performance.now() - this.current.startedAt)}`;
    this.stream.write(
      text.slice(0, Math.max(20, (this.stream.columns || 100) - 1)),
    );
  }

  private print(message: string) {
    this.clear();
    this.line(message);
    if (this.interactive) this.render();
  }

  private clear() {
    if (!this.interactive) return;
    clearLine(this.stream, 0);
    cursorTo(this.stream, 0);
  }

  private line(message: string) {
    this.stream.write(`${message.replace(/[\r\n\u001b]/g, " ")}\n`);
  }
}

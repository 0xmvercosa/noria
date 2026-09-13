"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, toHex } from "viem";
import { useNoriaWallet } from "./NoriaWalletProvider";
import { AmountInput, IdentifierInput } from "./FinancialInput";
import { EthAmount, EthUsdEquivalent, EthUsdNote } from "./EthUsd";
import { OperationProgress } from "./OperationProgress";
import {
  LAUNCH,
  LaunchAddressSchema,
  LaunchHashSchema,
  launchManifestHash,
  launchTransaction,
  assertPreparedLaunch,
  type LaunchIntent,
  type LaunchRequest,
  type LaunchPrepared,
  type LaunchSnapshot,
} from "../integrations/aqua/launch-contract";
import {
  launchHistoryKey,
  launchAttemptKey,
  readLaunch,
  prepareLaunch,
  refreshLaunchPlan,
  verifyLaunch,
  restoreLaunchRecords,
  serializeLaunchRecords,
  restoreLaunchAttempt,
  launchRecordFromAttempt,
  submitLaunchAttempt,
  assertReserveSettledForLaunch,
  assertLaunchHistoryCurrent,
  launchReport,
  type LaunchRecord,
  type LaunchAttempt,
  type LaunchVerification,
} from "../integrations/aqua/launch-client";
import {
  describeLaunchJourney,
  describeRepayment,
  newWalletWeth,
} from "./aqua-launch-presentation";
import {
  readWalletPending,
  saveWalletPending,
  clearWalletPending,
  withWalletLock,
  walletPendingKey,
  walletOperationEvent,
  type WalletPending,
} from "../integrations/privy/coordination";
import { parseTransferAmount } from "../integrations/privy/reserve";
import type { PositionPlanResponse } from "../integrations/aqua/position-contract";
import s from "./AquaWorkbench.module.css";
import r from "./ReserveWorkbench.module.css";

const units = (v: string, decimals = 6) => formatUnits(BigInt(v), decimals);
const equal = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const labels: Record<LaunchRequest["kind"], string> = {
  create: "Create position account",
  wrap: "Wrap ETH for collateral",
  unwrap: "Unwrap WETH to ETH",
  "approve-collateral": "Approve exact collateral",
  "revoke-collateral": "Remove collateral allowance",
  open: "Supply collateral and borrow USDC",
  convert: "Prepare WETH / USDC inventory",
  ship: "Launch Aqua strategy",
  defend: "Stop strategy and repay available USDC",
  "realize-defense": "Sell remaining WETH and repay",
  "approve-repayment": "Approve exact debt payment",
  "revoke-repayment": "Remove repayment allowance",
  repay: "Repay from wallet",
  exit: "Return collateral to wallet",
};

export function AquaLaunchWorkbench({
  plan,
  onPlan,
}: {
  plan: PositionPlanResponse | null;
  onPlan: (plan: PositionPlanResponse) => void;
}) {
  const wallet = useNoriaWallet();
  const [snapshot, setSnapshot] = useState<LaunchSnapshot | null>(null);
  const [accountInput, setAccountInput] = useState("");
  const selectedAccount = useRef<string | undefined>(undefined);
  const [records, setRecords] = useState<LaunchRecord[]>([]);
  const recordsRef = useRef(records);
  recordsRef.current = records;
  const [attempt, setAttempt] = useState<LaunchAttempt | null>(null);
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const [pending, setPending] = useState<WalletPending | null>(null);
  const [prepared, setPrepared] = useState<LaunchPrepared | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("Checking saved position activity…");
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const unwrapEdited = useRef(false);
  const suggestedExit = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const activeOwner = useRef(wallet.address);
  activeOwner.current = wallet.address;
  const current = (owner: string) =>
    activeOwner.current?.toLowerCase() === owner.toLowerCase();
  const live = snapshot?.status === "ready" ? snapshot : null;
  const position = live?.position;
  const validPlan =
    plan?.status === "ready-for-local-rehearsal" &&
    now < Date.parse(plan.validUntil);
  const unsettled = records.some(
    (v) => !v.verification || v.verification.status === "effect-unverified",
  );
  const canAct =
    wallet.ready &&
    !!wallet.address &&
    !!live &&
    historyReady &&
    !busy &&
    !attempt &&
    !pending &&
    !unsettled &&
    records.length < 100;
  const originalIntent: LaunchIntent | undefined = position
    ? ([...records]
        .reverse()
        .map((v) => v.prepared.request)
        .find(
          (v): v is Extract<LaunchRequest, { kind: "create" }> =>
            v.kind === "create" &&
            launchManifestHash(v.owner, v.intent) === position.manifestHash,
        )?.intent ??
      (plan &&
      wallet.address &&
      launchManifestHash(wallet.address, plan.intent) === position.manifestHash
        ? plan.intent
        : undefined))
    : plan?.intent;
  const journey =
    position && live
      ? describeLaunchJourney(position, live.wallet, originalIntent)
      : null;
  const matchingPlan =
    !!validPlan &&
    !!plan &&
    !!wallet.address &&
    (!position ||
      (launchManifestHash(wallet.address, plan.intent) ===
        position.manifestHash &&
        (position.phase === 0 ||
          plan.financing.loanUSDCUnits === position.principal)));
  const nextNeedsPlan =
    !!journey?.next && ["open", "convert", "ship"].includes(journey.next);
  const needsResearch = nextNeedsPlan && !matchingPlan;
  const belowComfortable =
    journey?.next === "ship" &&
    !!position &&
    position.healthFactor !== null &&
    BigInt(position.healthFactor) < BigInt(position.comfortableHF);
  const repayment =
    position && live
      ? describeRepayment(position.debtUSDCUnits, live.wallet.usdcUnits)
      : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setPrepared(null);
  }, [plan]);
  useEffect(() => {
    setRepaymentAmount("");
    setUnwrapAmount("");
    unwrapEdited.current = false;
    suggestedExit.current = null;
  }, [wallet.address, position?.address]);
  useEffect(() => {
    setSnapshot(null);
    setRecords([]);
    recordsRef.current = [];
    setAttempt(null);
    attemptRef.current = null;
    setPending(null);
    setPrepared(null);
    setHistoryReady(false);
    setError(null);
    setNotice(null);
    setAccountInput("");
    selectedAccount.current = undefined;
    setRecoveryHash("");
    setAcknowledged(false);
    if (!wallet.address) return;
    const owner = wallet.address;
    const controller = new AbortController();
    const restore = () => {
      try {
        const entries = restoreLaunchRecords(
          localStorage.getItem(launchHistoryKey(owner)),
          owner,
        );
        recordsRef.current = entries;
        setRecords(entries);
        const unresolved = restoreLaunchAttempt(
          localStorage.getItem(launchAttemptKey(owner)),
          owner,
        );
        attemptRef.current = unresolved;
        setAttempt(unresolved);
        setPending(readWalletPending(localStorage, owner));
        setHistoryReady(true);
        setPrepared(null);
        setAcknowledged(false);
      } catch {
        setHistoryReady(false);
        setError(
          "Saved position activity could not be read. Preserve your hashes and inspect Privy and Arbiscan before continuing.",
        );
      }
    };
    restore();
    const update = () => {
      if (document.visibilityState !== "visible") return;
      void readLaunch(owner, selectedAccount.current, controller.signal)
        .then((value) => {
          if (!controller.signal.aborted && current(owner)) setSnapshot(value);
        })
        .catch((failure) => {
          if (!controller.signal.aborted && current(owner))
            setError(failure.message);
        });
    };
    update();
    const storage = (e: StorageEvent) => {
      if (
        [launchHistoryKey(owner), launchAttemptKey(owner)].includes(e.key ?? "")
      )
        restore();
      if (e.key === walletPendingKey(owner)) shared();
    };
    const shared = () => {
      try {
        setPending(readWalletPending(localStorage, owner));
      } catch {
        setHistoryReady(false);
      }
    };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("storage", storage);
    window.addEventListener(walletOperationEvent, shared);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("storage", storage);
      window.removeEventListener(walletOperationEvent, shared);
      window.removeEventListener("focus", update);
    };
  }, [wallet.address]);

  async function task(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProgress("Checking saved position activity…");
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The position operation was not completed.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refresh(account = selectedAccount.current) {
    setProgress("Reading current balances and position state…");
    const owner = wallet.address;
    if (!owner) return;
    const next = await readLaunch(owner, account);
    if (current(owner)) setSnapshot(next);
  }
  function release(owner: string, id: string) {
    clearWalletPending(localStorage, owner, id);
    window.dispatchEvent(new Event(walletOperationEvent));
  }
  function saveRecords(owner: string, entries: LaunchRecord[]) {
    let saved = true;
    try {
      localStorage.setItem(
        launchHistoryKey(owner),
        serializeLaunchRecords(entries),
      );
    } catch {
      saved = false;
    }
    if (current(owner)) {
      recordsRef.current = entries;
      setRecords(entries);
    }
    return saved;
  }
  function clearAttempt(owner: string) {
    localStorage.removeItem(launchAttemptKey(owner));
    if (current(owner)) {
      attemptRef.current = null;
      setAttempt(null);
      setRecoveryHash("");
      setAcknowledged(false);
    }
  }
  function checkHistory(owner: string, recovering = false) {
    return assertLaunchHistoryCurrent(
      owner,
      activeOwner.current,
      recordsRef.current,
      localStorage.getItem(launchHistoryKey(owner)),
      attemptRef.current,
      localStorage.getItem(launchAttemptKey(owner)),
      recovering,
    );
  }
  async function check(entry: LaunchRecord) {
    setProgress("Verifying the transaction receipt and onchain effect…");
    const result = await verifyLaunch(entry);
    const owner = entry.prepared.request.owner;
    if (!current(owner)) return;
    if (!result) {
      setNotice(
        "Transaction pending. Its hash is saved; check again without resubmitting.",
      );
      return;
    }
    const entries = recordsRef.current.map((v) =>
      v.hash === entry.hash ? { ...v, verification: result } : v,
    );
    recordsRef.current = entries;
    setRecords(entries);
    if (result.status !== "effect-unverified") release(owner, entry.id);
    if (
      entry.prepared.request.kind === "create" &&
      result.status === "verified" &&
      result.after.position
    ) {
      selectedAccount.current = result.after.position.address;
      setAccountInput(result.after.position.address);
    }
    suggestUnwrap(entry, result);
    setNotice(
      result.status === "verified"
        ? "The exact onchain operation was verified. Review the next step when ready."
        : result.status === "reverted"
          ? "The transaction reverted. Network fees were spent; refresh before retrying."
          : "A receipt exists, but the expected effect is unverified. Inspect it before continuing.",
    );
    await refresh();
  }
  function suggestUnwrap(entry: LaunchRecord, result: LaunchVerification) {
    const request = entry.prepared.request;
    if (
      request.kind !== "exit" ||
      result.status !== "verified" ||
      !current(request.owner) ||
      !position ||
      !equal(position.address, request.account) ||
      unwrapEdited.current ||
      suggestedExit.current === entry.hash
    )
      return;
    const received = newWalletWeth(
      entry.prepared.before.wallet.wethUnits,
      result.after.wallet.wethUnits,
    );
    if (BigInt(received) > 0n) {
      setUnwrapAmount(units(received, 18));
      suggestedExit.current = entry.hash;
    }
  }
  async function review(request: LaunchRequest) {
    if (!canAct) return;
    setProgress(`Simulating: ${labels[request.kind]}…`);
    const value = await prepareLaunch(request, plan);
    if (current(request.owner)) {
      setPrepared(value);
      setNow(Date.now());
    }
  }
  async function confirm() {
    if (!canAct || !prepared || !wallet.address) return;
    setProgress("Refreshing the simulation before wallet confirmation…");
    const owner = wallet.address;
    const reviewed = assertPreparedLaunch(prepared, prepared.request, plan);
    await withWalletLock(owner, navigator.locks, async () => {
      checkHistory(owner);
      if (readWalletPending(localStorage, owner))
        throw new Error(
          "Resolve the earlier wallet operation before continuing.",
        );
      await assertReserveSettledForLaunch(owner, localStorage);
      const fresh = await prepareLaunch(reviewed.request, plan);
      checkHistory(owner);
      if (
        fresh.quote &&
        reviewed.quote &&
        BigInt(fresh.quote.minOutUnits) < BigInt(reviewed.quote.minOutUnits)
      ) {
        setPrepared(fresh);
        setNow(Date.now());
        setNotice(
          "The executable quote changed. Review the updated minimum received before confirming.",
        );
        return;
      }
      const next: LaunchAttempt = {
        id: crypto.randomUUID(),
        prepared: fresh,
        startedAt: new Date().toISOString(),
      };
      const priorRecords = [...recordsRef.current];
      setPrepared(null);
      const entry = await submitLaunchAttempt({
        attempt: next,
        save: (value) => {
          localStorage.setItem(launchAttemptKey(owner), JSON.stringify(value));
          if (current(owner)) {
            attemptRef.current = value;
            setAttempt(value);
          }
          saveWalletPending(localStorage, {
            id: value.id,
            owner: LaunchAddressSchema.parse(owner),
            route: "aqua",
            startedAt: value.startedAt,
          });
          window.dispatchEvent(new Event(walletOperationEvent));
        },
        send: () => {
          setProgress("Awaiting your confirmation in Privy…");
          return wallet.sendLaunchAction(fresh, plan);
        },
        record: (submitted) => {
          if (current(owner)) setRecoveryHash(submitted.hash);
          const entries = new Map(priorRecords.map((v) => [v.hash, v]));
          for (const known of recordsRef.current) {
            if (equal(known.prepared.request.owner, owner))
              entries.set(known.hash, known);
          }
          entries.set(submitted.hash, submitted);
          return saveRecords(owner, [...entries.values()]);
        },
        clear: (reason) => {
          clearAttempt(owner);
          if (reason === "rejected") release(owner, next.id);
        },
      });
      if (current(owner)) await check(entry);
    });
  }
  function download() {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            launchReport(recordsRef.current, attemptRef.current, snapshot),
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "noria-aqua-wallet-operations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function recover(noSubmission = false) {
    if (!wallet.address || !attempt || (noSubmission && !acknowledged)) return;
    const owner = wallet.address,
      id = attempt.id;
    await withWalletLock(owner, navigator.locks, async () => {
      const unresolved = checkHistory(owner, true);
      if (!unresolved || unresolved.id !== id)
        throw new Error("The unresolved request changed. Inspect it again.");
      if (noSubmission) {
        clearAttempt(owner);
        release(owner, id);
        setNotice(
          "You marked this request as not submitted. This is your acknowledgment, not an onchain verification.",
        );
        return;
      }
      const entry = launchRecordFromAttempt(
        unresolved,
        LaunchHashSchema.parse(recoveryHash.trim()),
      );
      const verification = await verifyLaunch(entry);
      if (!verification)
        throw new Error(
          "No receipt yet. Keep this request and check again; do not repeat it.",
        );
      if (!current(owner))
        throw new Error("Return to the original wallet to finish recovery.");
      const entries = new Map(recordsRef.current.map((v) => [v.hash, v]));
      entries.set(entry.hash, { ...entry, verification });
      if (entries.size > 100 || !saveRecords(owner, [...entries.values()]))
        throw new Error(
          "The recovered hash could not be saved. Keep the hash and unresolved request.",
        );
      clearAttempt(owner);
      if (verification.status !== "effect-unverified") release(owner, id);
      suggestUnwrap(entry, verification);
      setNotice(
        "The original request was matched to this receipt. Inspect its status below.",
      );
      await refresh();
    });
  }
  async function clearChecked() {
    if (!wallet.address) return;
    const owner = wallet.address;
    await withWalletLock(owner, navigator.locks, async () => {
      // The record limit must allow clearing a full terminal history.
      if (
        recordsRef.current.some(
          (v) =>
            !v.verification || v.verification.status === "effect-unverified",
        ) ||
        readWalletPending(localStorage, owner) ||
        restoreLaunchAttempt(
          localStorage.getItem(launchAttemptKey(owner)),
          owner,
        )
      )
        throw new Error(
          "Resolve every pending operation before clearing history.",
        );
      const saved = restoreLaunchRecords(
        localStorage.getItem(launchHistoryKey(owner)),
        owner,
      );
      if (
        serializeLaunchRecords(saved) !==
          serializeLaunchRecords(recordsRef.current) ||
        !current(owner)
      )
        throw new Error(
          "History changed. Refresh and check it before clearing.",
        );
      download();
      localStorage.removeItem(launchHistoryKey(owner));
      recordsRef.current = [];
      setRecords([]);
      setPrepared(null);
      setNotice(
        "Report download started. Checked browser history was cleared; keep the exported account details.",
      );
    });
  }
  async function refreshResearch() {
    if (!position || !wallet.address || !originalIntent)
      throw new Error(
        "Enter the original collateral and health policy above to refresh this account's research.",
      );
    if (!journey?.canRefreshResearch)
      throw new Error(
        "Research is available only before opening or while launch inventory remains ready.",
      );
    const result = await refreshLaunchPlan(
      wallet.address,
      position.address,
      originalIntent,
    );
    if (current(wallet.address)) {
      setPrepared(null);
      onPlan(result);
    }
  }
  const owner = wallet.address
    ? LaunchAddressSchema.parse(wallet.address)
    : undefined;
  const forAccount = (
    kind: Exclude<LaunchRequest["kind"], "create">,
    amountUnits?: string,
  ) => {
    if (!owner || !position) return;
    void task(() =>
      review({
        owner,
        account: position.address,
        kind,
        ...(amountUnits ? { amountUnits } : {}),
      } as LaunchRequest),
    );
  };
  const button = (
    kind: Exclude<LaunchRequest["kind"], "create">,
    enabled = true,
    amountUnits?: string,
    secondary = false,
    label = labels[kind],
  ) => (
    <button
      key={kind}
      className={secondary || prepared ? s.secondary : undefined}
      disabled={
        !canAct ||
        !enabled ||
        !!prepared ||
        !live ||
        BigInt(live.wallet.nativeWei) === 0n
      }
      onClick={() => forAccount(kind, amountUnits)}
    >
      {label}
    </button>
  );
  const request = prepared?.request;
  const tx = prepared ? launchTransaction(prepared) : null;
  const repaymentUnits = parseTransferAmount(repaymentAmount, "USDC");
  const unwrapUnits = parseTransferAmount(unwrapAmount, "ETH");
  const repaymentFits =
    !!repaymentUnits &&
    !!repayment &&
    BigInt(repaymentUnits) <= BigInt(repayment.availableUnits);
  const partialRepayment =
    !!repaymentUnits &&
    !!position &&
    BigInt(repaymentUnits) < BigInt(position.debtUSDCUnits);
  const gatingReason = !historyReady
    ? "Checking saved wallet activity before enabling position operations."
    : attempt
      ? "Resolve the earlier position request below before continuing."
      : pending
        ? "An earlier wallet operation needs attention. Check its receipt or recovery details before continuing."
        : unsettled
          ? "Check saved position receipts below before another operation."
          : records.length >= 100
            ? "Download and clear checked position history below before continuing."
            : live && BigInt(live.wallet.nativeWei) === 0n
              ? "Add ETH on Arbitrum to pay network fees before any position operation."
              : !wallet.ready
                ? "Waiting for your wallet to become ready."
                : null;
  const collateralBalance =
    position && live
      ? equal(position.collateral, LAUNCH.weth)
        ? live.wallet.wethUnits
        : live.wallet.usdcUnits
      : "0";
  const missingCollateral =
    position?.phase === 0 &&
    originalIntent &&
    BigInt(collateralBalance) < BigInt(originalIntent.collateralAmountUnits);
  const createPositionButton = (secondary = false) => (
    <button
      className={secondary || prepared ? s.secondary : undefined}
      disabled={
        !canAct ||
        !validPlan ||
        !!prepared ||
        !live ||
        BigInt(live.wallet.nativeWei) === 0n
      }
      onClick={() => {
        if (owner && plan)
          void task(() =>
            review({
              owner,
              kind: "create",
              id: toHex(crypto.getRandomValues(new Uint8Array(32))),
              intent: plan.intent,
            }),
          );
      }}
    >
      {secondary
        ? "Create another position account"
        : "Create position account"}
    </button>
  );
  const repaymentPanel = (secondary = false) =>
    position &&
    live &&
    repayment && (
      <div className={r.review}>
        <strong>Repay with wallet USDC</strong>
        <dl className={s.metrics}>
          <div>
            <dt>Current debt</dt>
            <dd>{units(position.debtUSDCUnits)} USDC</dd>
          </div>
          <div>
            <dt>Wallet available</dt>
            <dd>{units(live.wallet.usdcUnits)} USDC</dd>
          </div>
          <div>
            <dt>Full repayment with interest headroom</dt>
            <dd>{units(repayment.limitUnits)} USDC</dd>
          </div>
          <div>
            <dt>Extra wallet USDC needed for that amount</dt>
            <dd>{units(repayment.shortfallUnits)} USDC</dd>
          </div>
        </dl>
        <p>
          The full suggested amount includes 0.1% interest headroom plus
          0.000001 USDC. Unused cash stays in the position and returns on exit.
          Interest continues until the debt is cleared, and collateral cannot
          leave while debt remains.
        </p>
        {!repayment.fullyFunded && (
          <p className={s.inputError}>
            {BigInt(live.wallet.usdcUnits) < BigInt(position.debtUSDCUnits)
              ? "Your wallet cannot cover the current debt. An available partial payment reduces debt but leaves a balance. "
              : "Your wallet covers the displayed debt, but not the full interest headroom. Interest before confirmation may leave a small balance. "}
            You can{" "}
            <a href="/reserve#fund-heading">add USDC on the wallet page</a>
            {BigInt(live.wallet.aUsdcUnits) > 0n &&
              ", or withdraw USDC from your separate Aave reserve"}
            .
            {BigInt(position.wethUnits) > 0n &&
              " Selling the position's WETH is also available above."}
          </p>
        )}
        <label htmlFor="aqua-repayment">USDC to repay</label>
        <AmountInput
          id="aqua-repayment"
          decimals={6}
          value={repaymentAmount}
          disabled={busy || !!prepared}
          aria-invalid={Boolean(repaymentAmount) && !repaymentFits}
          onValueChange={(value) => {
            setRepaymentAmount(value);
            setPrepared(null);
          }}
        />
        {repaymentAmount && !repaymentFits && (
          <p className={s.inputError}>
            Enter a positive USDC amount with at most 6 decimals, up to{" "}
            {units(repayment.availableUnits)} USDC available for this payment.
          </p>
        )}
        {repaymentFits && (
          <p className={s.note}>
            {partialRepayment
              ? "This is a partial payment. Debt and interest will remain after it; repay the remainder before returning collateral."
              : BigInt(repaymentUnits!) < BigInt(repayment.limitUnits)
                ? "This covers the displayed debt without the full interest headroom. Interest before confirmation may leave a small balance."
                : "This includes the suggested interest headroom. Check the verified debt balance after repayment before returning collateral."}
          </p>
        )}
        <button
          className={s.secondary}
          disabled={
            busy || !!prepared || BigInt(repayment.availableUnits) === 0n
          }
          onClick={() => {
            setRepaymentAmount(units(repayment.availableUnits));
            setPrepared(null);
          }}
        >
          {repayment.fullyFunded
            ? "Use full debt plus interest headroom"
            : BigInt(repayment.availableUnits) < BigInt(position.debtUSDCUnits)
              ? "Use available wallet USDC · partial payment"
              : "Use available wallet USDC · reduced headroom"}
        </button>
        {repaymentUnits && position.repaymentAllowanceUnits === repaymentUnits
          ? button(
              "repay",
              repaymentFits,
              repaymentUnits,
              secondary,
              partialRepayment
                ? "Review partial repayment"
                : "Review wallet repayment",
            )
          : button(
              "approve-repayment",
              repaymentFits,
              repaymentUnits ?? undefined,
              secondary,
              partialRepayment
                ? "Approve exact partial payment"
                : "Approve exact repayment amount",
            )}
      </div>
    );

  return (
    <section
      className={`${s.panel} ${r.history}`}
      aria-labelledby="launch-heading"
    >
      <span className={s.eyebrow}>03 · Launch with your wallet</span>
      <h2 id="launch-heading" className={s.launchHeading} tabIndex={-1}>
        Your Aqua position
      </h2>
      <p className={s.note}>
        Create an account, supply collateral, borrow USDC, prepare inventory and
        launch. Each step uses a separate Privy confirmation on Arbitrum. Funds
        already supplied in your wallet&apos;s Aave reserve must first be
        withdrawn on <a href="/reserve">the wallet page</a>.
      </p>
      <EthUsdNote />
      {!wallet.address && (
        <button
          className={s.secondary}
          disabled={!wallet.configured || !wallet.ready}
          onClick={wallet.connect}
        >
          {wallet.configured ? "Connect Privy to launch" : "Wallet unavailable"}
        </button>
      )}
      {wallet.address && !snapshot && !error && (
        <p className={s.note}>Checking deployment and position balances…</p>
      )}
      {snapshot?.status === "deployment-required" && (
        <div className={r.review} role="status">
          <strong>Public launch is not available yet</strong>
          <p>
            The plan remains available above. A real position can be launched
            after the reviewed contracts are deployed and configured.
          </p>
          <details className={s.details}>
            <summary>Deployment details for reviewers</summary>
            <p>{snapshot.message}</p>
          </details>
        </div>
      )}
      {pending?.route === "reserve" && (
        <p className={s.inputError}>
          An operation on <a href="/reserve">your wallet page</a> needs
          attention. Resolve it before another signature.
        </p>
      )}
      {wallet.address && (
        <button
          className={s.secondary}
          disabled={busy}
          onClick={() => void task(() => refresh())}
        >
          Refresh position and balances
        </button>
      )}
      {live && (
        <>
          <dl className={s.metrics}>
            <div>
              <dt>Wallet USDC</dt>
              <dd>{units(live.wallet.usdcUnits)}</dd>
            </div>
            <div>
              <dt>Wallet ETH · fees</dt>
              <dd>
                <EthAmount wei={live.wallet.nativeWei} />
              </dd>
            </div>
            <div>
              <dt>Wallet WETH</dt>
              <dd>
                <EthAmount wei={live.wallet.wethUnits} symbol="WETH" />
              </dd>
            </div>
            <div>
              <dt>Separate Aave reserve</dt>
              <dd>{units(live.wallet.aUsdcUnits)} aUSDC</dd>
            </div>
          </dl>
          <p className={s.note}>
            Arbitrum block {live.blockNumber} ·{" "}
            {new Date(live.blockTimestamp * 1000).toLocaleString()}.{" "}
            <a href="/reserve#fund-heading">Fund in euros or transfer funds</a>.
          </p>
          {gatingReason && (
            <p className={s.inputError} role="status">
              {gatingReason}
            </p>
          )}
          {!position && (
            <>
              <p className={s.note}>
                {validPlan
                  ? "Your next step is to create your position account. This transaction deploys the account; collateral stays in your wallet until the later supply-and-borrow step."
                  : "Find a passing pool and range above to continue. A fresh plan is required before creating your position account."}
              </p>
              {!prepared && createPositionButton()}
            </>
          )}
          {position && journey && (
            <>
              <div className={r.review}>
                <strong>{journey.title}</strong>
                <p>{journey.description}</p>
                <ol
                  className={s.exclusions}
                  aria-label={
                    journey.closing
                      ? "Position closing progress"
                      : "Position launch progress"
                  }
                >
                  {journey.steps.map((step) => (
                    <li
                      key={step.label}
                      aria-current={
                        step.status === "current" ? "step" : undefined
                      }
                    >
                      {step.status === "complete"
                        ? "Done"
                        : step.status === "current"
                          ? "Next"
                          : "Later"}{" "}
                      · {step.label}
                    </li>
                  ))}
                </ol>
              </div>
              <p className={s.address}>
                <a
                  href={`https://arbiscan.io/address/${position.address}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {position.address}
                </a>
              </p>
              <dl className={s.metrics}>
                <div>
                  <dt>Aave collateral</dt>
                  <dd>
                    {equal(position.collateral, LAUNCH.weth) ? (
                      <EthAmount wei={position.receiptUnits} symbol="aWETH" />
                    ) : (
                      <>{units(position.receiptUnits)} aUSDC</>
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Your safety / comfortable health factors</dt>
                  <dd>
                    {units(position.safetyHF, 18)} /{" "}
                    {units(position.comfortableHF, 18)}
                  </dd>
                </div>
                <div>
                  <dt>USDC debt</dt>
                  <dd>{units(position.debtUSDCUnits)}</dd>
                </div>
                <div>
                  <dt>Health factor</dt>
                  <dd>
                    {BigInt(position.debtUSDCUnits) === 0n
                      ? "No debt"
                      : position.healthFactor === null
                        ? "Unavailable — refresh or review recovery"
                        : Number(units(position.healthFactor, 18)).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt>Position WETH</dt>
                  <dd>
                    <EthAmount wei={position.wethUnits} symbol="WETH" />
                  </dd>
                </div>
                <div>
                  <dt>Position USDC</dt>
                  <dd>{units(position.usdcUnits)}</dd>
                </div>
              </dl>
              {position.healthFactor === null && (
                <p className={s.inputError} role="status">
                  Aave health could not be read. New exposure is blocked. Stop,
                  repayment and debt-free exit remain available for review if
                  their transaction simulation succeeds.
                </p>
              )}
              {position.phase !== 6 && (
                <p className={s.note}>
                  Borrowing interest accrues even without trades. Collateral can
                  be liquidated if Aave&apos;s health factor falls below 1. Your
                  safety threshold is a signal to act; Noria does not
                  automatically stop or repay this position. Each operation
                  requires your confirmation.
                </p>
              )}
              {journey.canRefreshResearch && !needsResearch && (
                <button
                  className={s.secondary}
                  disabled={busy || !!prepared || !originalIntent}
                  onClick={() => void task(refreshResearch)}
                >
                  Refresh research for this position
                </button>
              )}
              {journey.canRefreshResearch && !originalIntent && (
                <p className={s.note}>
                  Enter this account&apos;s original collateral and health
                  policy above to refresh its research. Closing controls remain
                  available without a plan.
                </p>
              )}
              {position.phase === 0 && originalIntent && (
                <>
                  <p className={s.note}>
                    Opening collateral:{" "}
                    {originalIntent.fundingAsset === "ETH" ? (
                      <EthAmount wei={originalIntent.collateralAmountUnits} />
                    ) : (
                      <>{units(originalIntent.collateralAmountUnits)} USDC</>
                    )}
                    .{" "}
                    {originalIntent.fundingAsset === "USDC"
                      ? "USDC is supplied as collateral before USDC is borrowed for liquidity."
                      : "ETH is wrapped, then WETH is supplied as collateral."}
                  </p>
                  {missingCollateral && journey.next !== "wrap" && (
                    <p className={s.inputError}>
                      Add{" "}
                      {originalIntent.fundingAsset === "ETH" ? (
                        <EthAmount
                          wei={String(
                            BigInt(originalIntent.collateralAmountUnits) -
                              BigInt(collateralBalance),
                          )}
                        />
                      ) : (
                        <>
                          {units(
                            String(
                              BigInt(originalIntent.collateralAmountUnits) -
                                BigInt(collateralBalance),
                            ),
                          )}{" "}
                          USDC
                        </>
                      )}{" "}
                      to your wallet before supplying collateral.{" "}
                      <a href="/reserve#fund-heading">Fund your wallet</a>.
                    </p>
                  )}
                  {journey.next === "wrap" && (
                    <p className={s.note}>
                      Wrap only the missing{" "}
                      <EthAmount wei={journey.amountUnits!} />. Keep additional
                      ETH in your wallet for Arbitrum network fees.
                      {BigInt(journey.amountUnits!) >=
                        BigInt(live.wallet.nativeWei) && (
                        <>
                          {" "}
                          <a href="/reserve#fund-heading">
                            Add ETH to cover this amount and fees
                          </a>
                          .
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
              {position.phase === 2 && (
                <div className={r.review}>
                  <strong>Strategy active in Aqua</strong>
                  <p className={s.address}>
                    Strategy hash: {position.strategyHash}
                  </p>
                  <p>
                    Actual fills require eligible takers. Shipment alone does
                    not establish aggregator routing or earnings.
                  </p>
                  <p>
                    This wallet interface offers a manual stop-and-repay exit.
                    Check the health factor and debt while the position is open.
                  </p>
                </div>
              )}
              {belowComfortable && (
                <p className={s.inputError}>
                  Launching needs a health factor of at least{" "}
                  {units(position.comfortableHF, 18)}. Refresh balances to check
                  again, or stop and close this position below.
                </p>
              )}
              {!prepared && needsResearch && (
                <div>
                  <p className={s.note}>
                    Refresh research for this position&apos;s original
                    collateral, health policy and existing loan before
                    continuing.
                  </p>
                  <button
                    disabled={
                      busy || !originalIntent || !journey.canRefreshResearch
                    }
                    onClick={() => void task(refreshResearch)}
                  >
                    Refresh research to continue
                  </button>
                </div>
              )}
              {!prepared &&
                !needsResearch &&
                journey.next &&
                journey.next !== "repayment" &&
                journey.next !== "unwrap" &&
                button(
                  journey.next,
                  !belowComfortable &&
                    !(missingCollateral && journey.next !== "wrap") &&
                    !(
                      journey.next === "wrap" &&
                      BigInt(journey.amountUnits!) >=
                        BigInt(live.wallet.nativeWei)
                    ),
                  journey.amountUnits,
                  false,
                  position.phase === 5 && journey.next === "defend"
                    ? "Repay available position USDC"
                    : labels[journey.next],
                )}
              {!prepared &&
                journey.canStop &&
                journey.next !== "defend" &&
                journey.next !== "exit" &&
                button(
                  "defend",
                  true,
                  undefined,
                  true,
                  "Stop and close instead",
                )}
              {position.phase === 5 &&
                BigInt(position.debtUSDCUnits) > 0n &&
                (journey.next === "repayment" ? (
                  repaymentPanel()
                ) : (
                  <details className={s.details}>
                    <summary>Use wallet USDC instead</summary>
                    {repaymentPanel(true)}
                  </details>
                ))}
              {(BigInt(position.collateralAllowanceUnits) > 0n ||
                (!equal(position.collateral, LAUNCH.usdc) &&
                  BigInt(position.repaymentAllowanceUnits) > 0n)) && (
                <details className={s.details}>
                  <summary>Manage wallet allowances</summary>
                  <p className={s.note}>
                    Remove unused approvals with a separate wallet confirmation.
                    Removing an approval does not stop the strategy or repay
                    debt.
                  </p>
                  {BigInt(position.collateralAllowanceUnits) > 0n &&
                    button("revoke-collateral", true, undefined, true)}
                  {!equal(position.collateral, LAUNCH.usdc) &&
                    BigInt(position.repaymentAllowanceUnits) > 0n &&
                    button("revoke-repayment", true, undefined, true)}
                </details>
              )}
              {position.phase === 6 && (
                <>
                  <p className={s.note}>
                    Position closed.{" "}
                    <a href="/reserve">
                      Open the wallet page to transfer returned USDC or ETH.
                    </a>
                  </p>
                  {BigInt(live.wallet.wethUnits) > 0n && (
                    <div className={r.review}>
                      <p>
                        Keep WETH wrapped, or unwrap an amount to ETH before
                        transferring it from the wallet page.
                      </p>
                      {suggestedExit.current && (
                        <p className={s.note}>
                          The suggested amount uses the wallet WETH increase
                          from your verified exit. Review and edit it before
                          confirming.
                        </p>
                      )}
                      <label htmlFor="aqua-unwrap">Wallet WETH to unwrap</label>
                      <AmountInput
                        id="aqua-unwrap"
                        decimals={18}
                        value={unwrapAmount}
                        disabled={busy || !!prepared}
                        aria-invalid={
                          Boolean(unwrapAmount) &&
                          (!unwrapUnits ||
                            BigInt(unwrapUnits) > BigInt(live.wallet.wethUnits))
                        }
                        onValueChange={(value) => {
                          unwrapEdited.current = true;
                          setUnwrapAmount(value);
                          setPrepared(null);
                        }}
                      />
                      {unwrapUnits && (
                        <p className={s.note}>
                          <EthUsdEquivalent amount={units(unwrapUnits, 18)} />
                        </p>
                      )}
                      <button
                        className={s.secondary}
                        disabled={busy || !!prepared}
                        onClick={() => {
                          unwrapEdited.current = true;
                          setUnwrapAmount(units(live.wallet.wethUnits, 18));
                          setPrepared(null);
                        }}
                      >
                        Use available wallet WETH
                      </button>
                      {unwrapAmount &&
                        (!unwrapUnits ||
                          BigInt(unwrapUnits) >
                            BigInt(live.wallet.wethUnits)) && (
                          <p className={s.inputError}>
                            Enter an amount up to{" "}
                            <EthAmount
                              wei={live.wallet.wethUnits}
                              symbol="WETH"
                            />{" "}
                            with at most 18 decimals.
                          </p>
                        )}
                      {button(
                        "unwrap",
                        !!unwrapUnits &&
                          BigInt(unwrapUnits) <= BigInt(live.wallet.wethUnits),
                        unwrapUnits ?? undefined,
                      )}
                    </div>
                  )}
                  <details className={s.details}>
                    <summary>Start another position</summary>
                    <p className={s.note}>
                      Find a fresh pool and range above, then create a separate
                      account for the next position.
                    </p>
                    {createPositionButton(true)}
                  </details>
                </>
              )}
            </>
          )}
          <details className={s.details}>
            <summary>Load another account and inspect deployment</summary>
            <label htmlFor="aqua-account">Position account address</label>
            <IdentifierInput
              id="aqua-account"
              kind="address"
              valid={LaunchAddressSchema.safeParse(accountInput).success}
              value={accountInput}
              disabled={busy}
              onValueChange={setAccountInput}
            />
            <button
              className={s.secondary}
              disabled={
                busy ||
                !LaunchAddressSchema.safeParse(accountInput.trim()).success
              }
              onClick={() =>
                void task(async () => {
                  const account = LaunchAddressSchema.parse(
                    accountInput.trim(),
                  );
                  await refresh(account);
                  selectedAccount.current = account;
                  setPrepared(null);
                })
              }
            >
              Load owned position
            </button>
            <p className={s.address}>Factory: {live.deployment.factory}</p>
            <p className={s.address}>
              Factory runtime: {live.deployment.factoryRuntimeHash}
            </p>
            <p className={s.address}>
              Inventory adapter: {live.deployment.adapter}
            </p>
          </details>
        </>
      )}
      {prepared && request && tx && (
        <div className={r.review} aria-live="polite">
          <strong>Review · {labels[request.kind]}</strong>
          {"amountUnits" in request && (
            <p>
              Amount:{" "}
              {["wrap", "unwrap"].includes(request.kind) ||
              (request.kind === "approve-collateral" &&
                equal(prepared.before.position!.collateral, LAUNCH.weth)) ? (
                <EthAmount
                  wei={request.amountUnits}
                  symbol={request.kind === "wrap" ? "ETH" : "WETH"}
                />
              ) : (
                <>{units(request.amountUnits)} USDC</>
              )}
            </p>
          )}
          {request.kind === "create" && (
            <p>
              Owner-controlled account for{" "}
              {request.intent.fundingAsset === "ETH" ? (
                <EthAmount wei={request.intent.collateralAmountUnits} />
              ) : (
                <>{units(request.intent.collateralAmountUnits)} USDC</>
              )}{" "}
              collateral. Safety HF {units(request.intent.safetyHFWad, 18)};
              comfortable HF {units(request.intent.comfortableHFWad, 18)}.
            </p>
          )}
          {request.kind === "open" && prepared.plan && (
            <p>
              Supply{" "}
              {prepared.plan.intent.fundingAsset === "ETH" ? (
                <EthAmount
                  wei={prepared.plan.intent.collateralAmountUnits}
                  symbol="WETH"
                />
              ) : (
                <>{units(prepared.plan.intent.collateralAmountUnits)} USDC</>
              )}{" "}
              collateral; borrow {units(prepared.plan.loanUSDCUnits)} USDC into
              the position.
            </p>
          )}
          {["approve-repayment", "repay"].includes(request.kind) &&
            "amountUnits" in request && (
              <p>
                {BigInt(request.amountUnits) <
                BigInt(prepared.before.position!.debtUSDCUnits)
                  ? "This is a partial payment. Remaining debt must still be cleared before returning collateral."
                  : "Check the verified debt balance after repayment. Interest may accrue before confirmation, and unused USDC returns with your collateral on exit."}
                {request.kind === "approve-repayment" &&
                  " This approval allows the exact amount; the later repayment confirmation moves USDC."}
              </p>
            )}
          {prepared.quote && (
            <p>
              Convert{" "}
              {request.kind === "convert" ? (
                <>{units(prepared.quote.amountUnits)} USDC</>
              ) : (
                <EthAmount wei={prepared.quote.amountUnits} symbol="WETH" />
              )}
              . Minimum received:{" "}
              {request.kind === "convert" ? (
                <EthAmount wei={prepared.quote.minOutUnits} symbol="WETH" />
              ) : (
                <>{units(prepared.quote.minOutUnits)} USDC</>
              )}
              , including a 0.5% slippage limit.
            </p>
          )}
          {request.kind === "ship" && prepared.plan && (
            <p>
              Allocate the position&apos;s{" "}
              <EthAmount
                wei={prepared.before.position!.lpWethUnits}
                symbol="WETH"
              />{" "}
              and {units(prepared.before.position!.lpUsdcUnits)} USDC to the
              reviewed Aqua range {units(prepared.plan.lowerPriceE6)}–
              {units(prepared.plan.upperPriceE6)} USDC/WETH. LP fee{" "}
              {prepared.plan.lpFeeBps / 100}%.
            </p>
          )}
          {request.kind === "defend" && (
            <p>
              Stop any active strategy and apply available position USDC to
              debt. If debt remains, sell WETH or repay the shortfall before
              withdrawing collateral. This ends this position&apos;s strategy;
              launching again requires a new position account.
            </p>
          )}
          {request.kind === "exit" && (
            <p>
              Return{" "}
              {equal(prepared.before.position!.collateral, LAUNCH.weth) ? (
                <EthAmount
                  wei={prepared.before.position!.receiptUnits}
                  symbol="WETH"
                />
              ) : (
                <>{units(prepared.before.position!.receiptUnits)} USDC</>
              )}{" "}
              of supplied collateral, plus remaining position inventory, to your
              wallet. Current Aave accrual and rounding are applied onchain.
            </p>
          )}
          <p className={s.address}>
            From: {request.owner}
            <br />
            To: {tx.to}
          </p>
          <p className={s.note}>
            Arbitrum One · estimated network fee with buffer:{" "}
            <EthAmount wei={prepared.estimatedGasWei} />. Privy displays the
            current fee. Review expires{" "}
            {new Date(prepared.expiresAt).toLocaleTimeString()}.
          </p>
          <button
            disabled={!canAct || now >= prepared.expiresAt}
            onClick={() => void task(confirm)}
          >
            Confirm position operation in Privy
          </button>
          <button
            className={s.secondary}
            disabled={busy}
            onClick={() => setPrepared(null)}
          >
            Cancel review
          </button>
        </div>
      )}
      {(busy || error || notice) && (
        <div className={r.review}>
          {busy && <OperationProgress label={progress} />}
          {error && (
            <p className={s.inputError} role="alert">
              {error}
            </p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
      )}
      <h3>Position operation history</h3>
      <p className={s.note}>
        Exact requests, transaction hashes, fees and verified effects for this
        browser. Reloaded entries must be checked again before another
        operation.
      </p>
      {attempt && (
        <div className={r.review} role="alert">
          <strong>Resolve the earlier position request</strong>
          <p>
            {labels[attempt.prepared.request.kind]} ·{" "}
            {new Date(attempt.startedAt).toLocaleString()}. A closed window does
            not prove cancellation.
          </p>
          <a
            href={`https://arbiscan.io/address/${attempt.prepared.request.owner}`}
            target="_blank"
            rel="noreferrer"
          >
            Inspect wallet activity
          </a>
          <label htmlFor="aqua-recovery">Transaction hash</label>
          <IdentifierInput
            id="aqua-recovery"
            kind="hash"
            valid={LaunchHashSchema.safeParse(recoveryHash).success}
            value={recoveryHash}
            disabled={busy}
            onValueChange={setRecoveryHash}
          />
          <button
            disabled={
              busy || !LaunchHashSchema.safeParse(recoveryHash.trim()).success
            }
            onClick={() => void task(() => recover())}
          >
            Verify and recover position transaction
          </button>
          <label className={s.note}>
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={busy}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />{" "}
            I inspected Privy and Arbiscan; no matching transaction is pending
            or completed. Repeating an already submitted operation can move
            funds twice.
          </label>
          <button
            className={s.secondary}
            disabled={busy || !acknowledged}
            onClick={() => void task(() => recover(true))}
          >
            Mark position request as not submitted
          </button>
        </div>
      )}
      {records.length === 0 && (
        <p className={s.note}>
          No position transactions recorded in this browser.
        </p>
      )}
      <ul className={r.operations}>
        {[...records].reverse().map((entry) => (
          <li key={entry.id}>
            <div>
              <strong>{labels[entry.prepared.request.kind]}</strong>
              <p>
                {new Date(entry.submittedAt).toLocaleString()} ·{" "}
                {entry.verification?.status ?? "Receipt check required"}
              </p>
              {entry.verification && (
                <p>
                  Network fee:{" "}
                  <EthAmount wei={entry.verification.networkFeeWei} />
                </p>
              )}
              <a
                href={`https://arbiscan.io/tx/${entry.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                {entry.hash}
              </a>
            </div>
            <button
              className={s.secondary}
              disabled={busy}
              onClick={() => void task(() => check(entry))}
            >
              Check position receipt
            </button>
          </li>
        ))}
      </ul>
      {(records.length > 0 || attempt || snapshot) && (
        <button className={s.secondary} onClick={download}>
          Download position operation report
        </button>
      )}
      {records.length > 0 && (
        <button
          className={s.secondary}
          disabled={busy || unsettled || !!attempt || !!pending}
          onClick={() => void task(clearChecked)}
        >
          Download and clear checked position history
        </button>
      )}
    </section>
  );
}

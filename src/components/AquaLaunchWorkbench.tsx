"use client";

import { useEffect, useRef, useState } from "react";
import { formatUnits, toHex } from "viem";
import { useNoriaWallet } from "./NoriaWalletProvider";
import { AmountInput, IdentifierInput } from "./FinancialInput";
import {
  LAUNCH,
  LaunchAddressSchema,
  LaunchHashSchema,
  launchManifestHash,
  launchRepaymentLimit,
  launchPhases,
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
} from "../integrations/aqua/launch-client";
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
  unwrap: "Unwrap returned WETH",
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
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [repaymentAmount, setRepaymentAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
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

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setPrepared(null);
  }, [plan]);
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
    setNotice(
      result.status === "verified"
        ? "The exact onchain operation was verified. Review the next step when ready."
        : result.status === "reverted"
          ? "The transaction reverted. Network fees were spent; refresh before retrying."
          : "A receipt exists, but the expected effect is unverified. Inspect it before continuing.",
    );
    await refresh();
  }
  async function review(request: LaunchRequest) {
    if (!canAct) return;
    const value = await prepareLaunch(request, plan);
    if (current(request.owner)) {
      setPrepared(value);
      setNow(Date.now());
    }
  }
  async function confirm() {
    if (!canAct || !prepared || !wallet.address) return;
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
        send: () => wallet.sendLaunchAction(fresh, plan),
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
  ) => (
    <button
      key={kind}
      disabled={!canAct || !enabled}
      onClick={() => forAccount(kind, amountUnits)}
    >
      {labels[kind]}
    </button>
  );
  const request = prepared?.request;
  const tx = prepared ? launchTransaction(prepared) : null;
  const repaymentUnits = parseTransferAmount(repaymentAmount, "USDC");
  const unwrapUnits = parseTransferAmount(unwrapAmount, "ETH");

  return (
    <section
      className={`${s.panel} ${r.history}`}
      aria-labelledby="launch-heading"
    >
      <span className={s.eyebrow}>03 · Launch with your wallet</span>
      <h2 id="launch-heading">Your Aqua position</h2>
      <p className={s.note}>
        Create an account, supply collateral, borrow USDC, prepare inventory and
        launch. Each step uses a separate Privy confirmation on Arbitrum. Funds
        already supplied in your wallet&apos;s Aave reserve must first be
        withdrawn on <a href="/reserve">the wallet page</a>.
      </p>
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
          <strong>Public deployment required</strong>
          <p>{snapshot.message}</p>
          <p>
            The plan remains available above. A real position can be launched
            after the reviewed contracts are deployed and configured.
          </p>
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
              <dd>{units(live.wallet.nativeWei, 18)}</dd>
            </div>
            <div>
              <dt>Wallet WETH</dt>
              <dd>{units(live.wallet.wethUnits, 18)}</dd>
            </div>
            <div>
              <dt>Separate Aave reserve</dt>
              <dd>{units(live.wallet.aUsdcUnits)} aUSDC</dd>
            </div>
          </dl>
          <p className={s.note}>
            Arbitrum block {live.blockNumber} ·{" "}
            {new Date(live.blockTimestamp * 1000).toLocaleString()}.{" "}
            <a href="/reserve">Fund in euros or transfer funds</a>.
          </p>
          {(!position || position.phase === 6) && (
            <>
              <p className={s.note}>
                A passing, fresh plan is required to create the next position.
                Creation deploys your account; collateral is moved only at the
                later supply step.
              </p>
              <button
                disabled={!canAct || !validPlan}
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
                Create position account
              </button>
            </>
          )}
          {position && (
            <>
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
                  <dt>Position state</dt>
                  <dd>{launchPhases[position.phase]}</dd>
                </div>
                <div>
                  <dt>Aave collateral</dt>
                  <dd>
                    {units(
                      position.receiptUnits,
                      equal(position.collateral, LAUNCH.weth) ? 18 : 6,
                    )}{" "}
                    {equal(position.collateral, LAUNCH.weth)
                      ? "aWETH"
                      : "aUSDC"}
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
                      : Number(units(position.healthFactor, 18)).toFixed(4)}
                  </dd>
                </div>
                <div>
                  <dt>Position WETH</dt>
                  <dd>{units(position.wethUnits, 18)}</dd>
                </div>
                <div>
                  <dt>Position USDC</dt>
                  <dd>{units(position.usdcUnits)}</dd>
                </div>
              </dl>
              {position.phase !== 6 && (
                <button
                  className={s.secondary}
                  disabled={busy || !originalIntent}
                  onClick={() => void task(refreshResearch)}
                >
                  Refresh research for this position
                </button>
              )}
              {position.phase !== 6 && !originalIntent && (
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
                    {units(
                      originalIntent.collateralAmountUnits,
                      originalIntent.fundingAsset === "ETH" ? 18 : 6,
                    )}{" "}
                    {originalIntent.fundingAsset}.{" "}
                    {originalIntent.fundingAsset === "USDC"
                      ? "USDC is supplied as collateral before USDC is borrowed for liquidity."
                      : "ETH is wrapped, then WETH is supplied as collateral."}
                  </p>
                  {originalIntent.fundingAsset === "ETH" &&
                    BigInt(live.wallet.wethUnits) <
                      BigInt(originalIntent.collateralAmountUnits) &&
                    button(
                      "wrap",
                      true,
                      String(
                        BigInt(originalIntent.collateralAmountUnits) -
                          BigInt(live.wallet.wethUnits),
                      ),
                    )}
                  {position.collateralAllowanceUnits !==
                  originalIntent.collateralAmountUnits
                    ? button(
                        "approve-collateral",
                        true,
                        originalIntent.collateralAmountUnits,
                      )
                    : button("open", !!validPlan)}
                </>
              )}
              {[1, 4].includes(position.phase) && (
                <>
                  {BigInt(position.lpWethUnits) === 0n
                    ? button("convert", !!validPlan)
                    : button("ship", !!validPlan)}
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
                    Cycle accounting uses owner provenance checkpoints. This
                    wallet interface offers the stop-and-repay exit; it does not
                    run an unattended reinvestment service.
                  </p>
                </div>
              )}
              {position.phase !== 0 && position.phase !== 6 && button("defend")}
              {position.phase === 5 && (
                <>
                  {BigInt(position.wethUnits) > 0n && button("realize-defense")}
                  {BigInt(position.debtUSDCUnits) > 0n && (
                    <div className={r.review}>
                      <strong>Repay remaining debt</strong>
                      <p>
                        Use wallet USDC for a shortfall. The suggested amount
                        includes 0.1% interest headroom; unused cash remains in
                        the position and returns on exit. Collateral cannot
                        leave while debt remains.
                      </p>
                      <label htmlFor="aqua-repayment">USDC to repay</label>
                      <AmountInput
                        id="aqua-repayment"
                        decimals={6}
                        value={repaymentAmount}
                        disabled={busy}
                        aria-invalid={
                          Boolean(repaymentAmount) && !repaymentUnits
                        }
                        onValueChange={(value) => {
                          setRepaymentAmount(value);
                          setPrepared(null);
                        }}
                      />
                      <button
                        className={s.secondary}
                        disabled={busy}
                        onClick={() => {
                          setRepaymentAmount(
                            units(
                              BigInt(
                                launchRepaymentLimit(position.debtUSDCUnits),
                              ) < BigInt(live.wallet.usdcUnits)
                                ? launchRepaymentLimit(position.debtUSDCUnits)
                                : live.wallet.usdcUnits,
                            ),
                          );
                          setPrepared(null);
                        }}
                      >
                        Use debt amount plus interest headroom
                      </button>
                      {repaymentUnits &&
                      position.repaymentAllowanceUnits === repaymentUnits
                        ? button("repay", true, repaymentUnits)
                        : button(
                            "approve-repayment",
                            !!repaymentUnits,
                            repaymentUnits ?? undefined,
                          )}
                    </div>
                  )}
                </>
              )}
              {[4, 5].includes(position.phase) &&
                BigInt(position.debtUSDCUnits) === 0n &&
                button("exit")}
              {BigInt(position.collateralAllowanceUnits) > 0n &&
                button("revoke-collateral")}
              {!equal(position.collateral, LAUNCH.usdc) &&
                BigInt(position.repaymentAllowanceUnits) > 0n &&
                button("revoke-repayment")}
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
                      <label htmlFor="aqua-unwrap">
                        Returned WETH to unwrap
                      </label>
                      <AmountInput
                        id="aqua-unwrap"
                        decimals={18}
                        value={unwrapAmount}
                        disabled={busy}
                        aria-invalid={Boolean(unwrapAmount) && !unwrapUnits}
                        onValueChange={(value) => {
                          setUnwrapAmount(value);
                          setPrepared(null);
                        }}
                      />
                      {button(
                        "unwrap",
                        !!unwrapUnits,
                        unwrapUnits ?? undefined,
                      )}
                    </div>
                  )}
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
              {units(
                request.amountUnits,
                ["wrap", "unwrap"].includes(request.kind) ||
                  (request.kind === "approve-collateral" &&
                    equal(prepared.before.position!.collateral, LAUNCH.weth))
                  ? 18
                  : 6,
              )}{" "}
              {["wrap", "unwrap"].includes(request.kind) ||
              (request.kind === "approve-collateral" &&
                equal(prepared.before.position!.collateral, LAUNCH.weth))
                ? "ETH / WETH"
                : "USDC"}
            </p>
          )}
          {request.kind === "create" && (
            <p>
              Owner-controlled account for{" "}
              {units(
                request.intent.collateralAmountUnits,
                request.intent.fundingAsset === "ETH" ? 18 : 6,
              )}{" "}
              {request.intent.fundingAsset} collateral. Safety HF{" "}
              {units(request.intent.safetyHFWad, 18)}; comfortable HF{" "}
              {units(request.intent.comfortableHFWad, 18)}.
            </p>
          )}
          {request.kind === "open" && prepared.plan && (
            <p>
              Supply{" "}
              {units(
                prepared.plan.intent.collateralAmountUnits,
                prepared.plan.intent.fundingAsset === "ETH" ? 18 : 6,
              )}{" "}
              {prepared.plan.intent.fundingAsset === "ETH" ? "WETH" : "USDC"}{" "}
              collateral; borrow {units(prepared.plan.loanUSDCUnits)} USDC into
              the position.
            </p>
          )}
          {prepared.quote && (
            <p>
              Convert{" "}
              {units(
                prepared.quote.amountUnits,
                request.kind === "convert" ? 6 : 18,
              )}{" "}
              {request.kind === "convert" ? "USDC" : "WETH"}. Minimum received:{" "}
              {units(
                prepared.quote.minOutUnits,
                request.kind === "convert" ? 18 : 6,
              )}{" "}
              {request.kind === "convert" ? "WETH" : "USDC"}, including a 0.5%
              slippage limit.
            </p>
          )}
          {request.kind === "ship" && prepared.plan && (
            <p>
              Allocate the position&apos;s{" "}
              {units(prepared.before.position!.lpWethUnits, 18)} WETH and{" "}
              {units(prepared.before.position!.lpUsdcUnits)} USDC to the
              reviewed Aqua range {units(prepared.plan.lowerPriceE6)}–
              {units(prepared.plan.upperPriceE6)} USDC/WETH. LP fee{" "}
              {prepared.plan.lpFeeBps / 100}%.
            </p>
          )}
          {request.kind === "defend" && (
            <p>
              Stop any active strategy and apply available position USDC to
              debt. If debt remains, sell WETH or repay the shortfall before
              withdrawing collateral.
            </p>
          )}
          {request.kind === "exit" && (
            <p>
              Return{" "}
              {units(
                prepared.before.position!.receiptUnits,
                equal(prepared.before.position!.collateral, LAUNCH.weth)
                  ? 18
                  : 6,
              )}{" "}
              units of supplied collateral, plus remaining position inventory,
              to your wallet. Current Aave accrual and rounding are applied
              onchain.
            </p>
          )}
          <p className={s.address}>
            From: {request.owner}
            <br />
            To: {tx.to}
          </p>
          <p className={s.note}>
            Arbitrum One · estimated network fee with buffer:{" "}
            {units(prepared.estimatedGasWei, 18)} ETH. Privy displays the
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
          {busy && <p role="status">Waiting for wallet or chain response…</p>}
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
                  Network fee: {units(entry.verification.networkFeeWei, 18)} ETH
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

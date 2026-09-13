"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download, RefreshCw } from "lucide-react";
import { formatUnits } from "viem";
import { NoriaLogo } from "./NoriaLogo";
import { NoriaWallet } from "./NoriaWallet";
import { useNoriaWallet } from "./NoriaWalletProvider";
import {
  RESERVE,
  parseUsdc,
  type PreparedReserveAction,
  type ReserveSnapshot,
} from "../integrations/privy/reserve";
import {
  assertPrepared,
  prepareReserve,
  readReserve,
  reserveReport,
  restoreAttempt,
  restoreRecords,
  serializedRecords,
  submitReserveAttempt,
  verifyReserve,
  verifyReserveAttempt,
  withCheckedReserveHistory,
  type ReserveRecord,
  type ReserveAttempt,
} from "../integrations/privy/client";
import base from "./NoriaApp.module.css";
import s from "./AquaWorkbench.module.css";
import r from "./ReserveWorkbench.module.css";

const units = (v: string, decimals = 6) => formatUnits(BigInt(v), decimals);
const key = (owner: string) =>
  `noria.privy.operations.v1:${owner.toLowerCase()}`;
const attemptKey = (owner: string) =>
  `noria.privy.attempt.v1:${owner.toLowerCase()}`;

export function ReserveWorkbench() {
  const wallet = useNoriaWallet();
  const [snapshot, setSnapshot] = useState<ReserveSnapshot | null>(null);
  const [amount, setAmount] = useState("10");
  const [direction, setDirection] = useState<"supply" | "withdraw">("supply");
  const [prepared, setPrepared] = useState<PreparedReserveAction | null>(null);
  const [records, setRecords] = useState<ReserveRecord[]>([]);
  const [attempt, setAttempt] = useState<ReserveAttempt | null>(null);
  const [recoveryHash, setRecoveryHash] = useState("");
  const [acknowledgedNoSubmission, setAcknowledgedNoSubmission] =
    useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const lock = useRef(false);
  const activeOwner = useRef(wallet.address);
  activeOwner.current = wallet.address;
  const recordRef = useRef(records);
  recordRef.current = records;
  const attemptRef = useRef(attempt);
  attemptRef.current = attempt;
  const current = (owner: string) =>
    activeOwner.current?.toLowerCase() === owner.toLowerCase();
  const unsettled = records.some(
    (entry) =>
      !entry.verification || entry.verification.status === "effect-unverified",
  );
  const amountUnits = parseUsdc(amount);
  const canAct =
    wallet.ready &&
    !!wallet.address &&
    historyReady &&
    !busy &&
    !unsettled &&
    !attempt &&
    records.length < 100;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSnapshot(null);
    setPrepared(null);
    setRecords([]);
    setAttempt(null);
    attemptRef.current = null;
    setRecoveryHash("");
    setAcknowledgedNoSubmission(false);
    setHistoryReady(false);
    setError(null);
    setNotice(null);
    setStorageWarning(null);
    if (!wallet.address) return;
    const owner = wallet.address;
    const controller = new AbortController();
    try {
      setRecords(restoreRecords(localStorage.getItem(key(owner)), owner));
      const restoredAttempt = restoreAttempt(
        localStorage.getItem(attemptKey(owner)),
        owner,
      );
      attemptRef.current = restoredAttempt;
      setAttempt(restoredAttempt);
      setHistoryReady(true);
    } catch {
      setError(
        "Saved operation history could not be read. Preserve your transaction hashes and inspect Arbiscan before using another browser session.",
      );
    }
    void readReserve(owner, controller.signal)
      .then((state) => {
        if (!controller.signal.aborted) setSnapshot(state);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    // Another tab invalidates this review. Submitted hashes are always reverified.
    const onStorage = (event: StorageEvent) => {
      if (event.key === attemptKey(owner)) {
        setPrepared(null);
        setAcknowledgedNoSubmission(false);
        setRecoveryHash("");
        try {
          const next = restoreAttempt(event.newValue, owner);
          attemptRef.current = next;
          setAttempt(next);
        } catch {
          setHistoryReady(false);
          setError(
            "The unresolved wallet operation could not be read. Inspect Privy and Arbiscan before continuing.",
          );
        }
        return;
      }
      if (event.key !== key(owner)) return;
      setPrepared(null);
      try {
        setRecords(restoreRecords(event.newValue, owner));
      } catch {
        setHistoryReady(false);
        setError(
          "Operation history changed in another tab. Inspect pending transactions before continuing.",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      controller.abort();
      window.removeEventListener("storage", onStorage);
    };
  }, [wallet.address]);

  function persist(owner: string, next: ReserveRecord[]) {
    // Never drop a broadcast hash if RPC verification, logout or another operation fails.
    let saved = true;
    try {
      localStorage.setItem(key(owner), serializedRecords(next));
    } catch {
      saved = false;
      if (current(owner))
        setStorageWarning(
          "Local storage is unavailable. Download this report and keep your transaction hash before leaving.",
        );
    }
    if (current(owner)) {
      recordRef.current = next;
      setRecords(next);
    }
    return saved;
  }
  function saveAttempt(owner: string, next: ReserveAttempt) {
    try {
      localStorage.setItem(attemptKey(owner), JSON.stringify(next));
    } catch {
      throw new Error(
        "The wallet operation could not be saved before signing. No wallet request was sent; enable browser storage before continuing.",
      );
    }
    if (current(owner)) {
      attemptRef.current = next;
      setAttempt(next);
      setAcknowledgedNoSubmission(false);
    }
  }
  function clearAttempt(owner: string) {
    try {
      localStorage.removeItem(attemptKey(owner));
    } catch {
      throw new Error(
        "The wallet outcome could not be saved. The unresolved operation remains blocked; inspect its receipt before continuing.",
      );
    }
    if (current(owner)) {
      attemptRef.current = null;
      setAttempt(null);
      setRecoveryHash("");
      setAcknowledgedNoSubmission(false);
    }
  }
  function historyState(owner: string) {
    return {
      activeOwner: activeOwner.current,
      records: recordRef.current,
      saved: localStorage.getItem(key(owner)),
      attempt: attemptRef.current,
      savedAttempt: localStorage.getItem(attemptKey(owner)),
    };
  }
  async function refresh() {
    if (!wallet.address) return;
    const owner = wallet.address;
    const state = await readReserve(owner);
    if (current(owner)) setSnapshot(state);
  }
  async function task(fn: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The operation was not completed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function fund(asset: "USDC" | "ETH") {
    const owner = wallet.address;
    if (!owner) return;
    await wallet.fund(asset);
    if (!current(owner)) return;
    setNotice(
      "Funding window closed. The balances below come from Arbitrum; refresh if your transfer is still arriving.",
    );
    await refresh();
  }
  async function review(revoke = false) {
    if (!canAct || !wallet.address || (!amountUnits && !revoke)) return;
    const owner = wallet.address;
    const fresh = await readReserve(owner);
    if (!current(owner)) return;
    setSnapshot(fresh);
    const kind = revoke
      ? "revoke"
      : direction === "supply" &&
          BigInt(fresh.allowanceUnits) !== BigInt(amountUnits!)
        ? "approve"
        : direction;
    const result = await prepareReserve({
      owner: fresh.owner,
      kind,
      amountUnits: revoke ? "0" : amountUnits!,
    });
    if (current(owner)) {
      setPrepared(result);
      setNow(Date.now());
    }
  }
  async function check(entry: ReserveRecord) {
    const result = await verifyReserve(entry);
    const owner = entry.prepared.action.owner;
    if (!current(owner)) return;
    if (!result) {
      setNotice(
        "This transaction is pending. Check its receipt again; no replacement transaction has been sent.",
      );
      return;
    }
    // Verification is session-only. Rewriting storage here could overwrite a
    // hash just submitted by another tab, and would not persist this evidence.
    const next = recordRef.current.map((v) =>
      v.hash === entry.hash ? { ...v, verification: result } : v,
    );
    recordRef.current = next;
    setRecords(next);
    if (result.status === "reverted")
      setNotice(
        "The transaction reverted. Network fees were still spent. Refresh before trying again.",
      );
    else if (result.status === "effect-unverified")
      setNotice(
        "The receipt exists, but the expected effect is unverified. Inspect the transaction before continuing.",
      );
    else
      setNotice(
        entry.prepared.action.kind === "approve"
          ? "Exact approval confirmed. Review the deposit to move USDC into Aave."
          : entry.prepared.action.kind === "supply"
            ? "Deposit confirmed. Your Privy wallet owns the Aave reserve."
            : entry.prepared.action.kind === "withdraw"
              ? "Withdrawal confirmed. USDC was returned to your Privy wallet."
              : "Allowance removal confirmed.",
      );
    await refresh();
  }
  async function confirm() {
    if (!canAct || !prepared || !wallet.address) return;
    const owner = wallet.address;
    const reviewed = assertPrepared(prepared, prepared.action);
    // Re-run official simulation immediately before the SDK prompt. Never substitute
    // another amount/recipient from a stale review or an API-provided calldata field.
    const fresh = await prepareReserve(reviewed.action);
    if (!current(owner)) throw new Error("The wallet changed. Review again.");
    await withCheckedReserveHistory({
      owner,
      locks: navigator.locks,
      operation: "submit",
      read: () => historyState(owner),
      run: async (saved) => {
        const intent: ReserveAttempt = {
          id: crypto.randomUUID(),
          prepared: fresh,
          startedAt: new Date().toISOString(),
        };
        setPrepared(null);
        const entry = await submitReserveAttempt({
          attempt: intent,
          save: (value) => saveAttempt(owner, value),
          send: () => wallet.sendReserveAction(fresh),
          record: (submitted) => {
            const history = new Map(saved.map((v) => [v.hash, v]));
            for (const known of recordRef.current) {
              if (
                known.prepared.action.owner.toLowerCase() ===
                owner.toLowerCase()
              )
                history.set(known.hash, known);
            }
            history.set(submitted.hash, submitted);
            if (current(owner)) setRecoveryHash(submitted.hash);
            return persist(owner, [...history.values()]);
          },
          clear: () => clearAttempt(owner),
        });
        if (current(owner)) {
          setNotice(
            "Transaction sent. Its hash is saved; checking the onchain effect…",
          );
          await check(entry);
        }
      },
    });
  }
  function download(entries = records) {
    const url = URL.createObjectURL(
      new Blob(
        [JSON.stringify(reserveReport(entries, attemptRef.current), null, 2)],
        {
          type: "application/json",
        },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "noria-privy-operations.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function clearCheckedHistory() {
    if (!wallet.address) return;
    const owner = wallet.address;
    await withCheckedReserveHistory({
      owner,
      locks: navigator.locks,
      operation: "clear",
      read: () => historyState(owner),
      run: async (checked) => {
        download(checked);
        try {
          localStorage.removeItem(key(owner));
        } catch {
          throw new Error(
            "The report download started, but browser history could not be cleared. Keep the downloaded report.",
          );
        }
        recordRef.current = [];
        setRecords([]);
        setPrepared(null);
        setStorageWarning(null);
        setNotice(
          "Report download started and checked browser history cleared. Onchain transactions and wallet balances remain available.",
        );
      },
    });
  }
  async function recoverAttempt(noSubmission = false) {
    if (!wallet.address || (noSubmission && !acknowledgedNoSubmission)) return;
    const owner = wallet.address;
    const acknowledgedAttemptId = attempt?.id;
    await withCheckedReserveHistory({
      owner,
      locks: navigator.locks,
      operation: "recover",
      read: () => historyState(owner),
      run: async (history, unresolved) => {
        if (!unresolved || unresolved.id !== acknowledgedAttemptId)
          throw new Error(
            "The unresolved operation changed. Inspect it again before recovery.",
          );
        if (noSubmission) {
          clearAttempt(owner);
          setPrepared(null);
          setNotice(
            "You marked the earlier request as not submitted after inspecting wallet activity. No onchain outcome was verified. Review a new operation only if no matching transaction exists.",
          );
          return;
        }
        const entry = await verifyReserveAttempt(
          unresolved,
          recoveryHash.trim(),
        );
        if (!entry)
          throw new Error(
            "This hash has no receipt yet. Keep the unresolved operation and check again; do not repeat it.",
          );
        if (!current(owner))
          throw new Error(
            "The wallet changed. Return to the original wallet to finish recovery.",
          );
        const recovered = new Map(history.map((v) => [v.hash, v]));
        recovered.set(entry.hash, entry);
        if (recovered.size > 100)
          throw new Error(
            "Operation history is full. Keep this transaction hash and its unresolved operation for inspection.",
          );
        if (!persist(owner, [...recovered.values()]))
          throw new Error(
            "The receipt was checked but its history could not be saved. Keep the hash; the unresolved operation remains blocked.",
          );
        clearAttempt(owner);
        setPrepared(null);
        setNotice(
          "The exact operation was matched to its receipt and moved to operation history. Review its status before continuing.",
        );
        await refresh();
      },
    });
  }
  const expires = prepared && now >= prepared.expiresAt;
  return (
    <div className={base.app}>
      <header className={`${base.header} ${s.header}`}>
        <a href="/" className={base.brand} aria-label="Noria home">
          <NoriaLogo className={base.brandLogo} />
        </a>
        <nav className={base.navigation} aria-label="Reserve navigation">
          <a href="/">Discover pools</a>
          <a href="/aqua">Aqua positions</a>
        </nav>
        <div className={s.headerActions}>
          <span className={`${base.chainBadge} ${s.networkBadge}`}>
            Arbitrum One
          </span>
          <NoriaWallet />
        </div>
      </header>
      <main className={s.main}>
        <section className={s.hero}>
          <span className={s.eyebrow}>
            Noria × Privy · a reserve before a position
          </span>
          <h1>
            Your USDC.
            <br />
            <span>Ready for your next move.</span>
          </h1>
          <p>
            Open a wallet with Privy, add USDC and earn Aave&apos;s variable
            supply interest while you evaluate liquidity opportunities. Withdraw
            to the same wallet when you need it.
          </p>
          <p className={s.note}>
            This flow uses real USDC and ETH on Arbitrum One. Aave carries
            protocol and stablecoin risk; withdrawals depend on available
            liquidity. No borrowing is requested here.
          </p>
        </section>
        <ol className={s.steps} aria-label="Reserve steps">
          <li>
            <span>01</span>
            <div>
              <strong>Open and fund</strong>
              <small>Your Privy wallet · USDC + ETH for fees</small>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Build your reserve</strong>
              <small>Approve the exact amount, then deposit</small>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Keep control</strong>
              <small>Withdraw and inspect every operation</small>
            </div>
          </li>
        </ol>
        <div className={s.workspace}>
          <section className={s.panel} aria-labelledby="fund-heading">
            <span className={s.eyebrow}>01 · Your wallet</span>
            <h2 id="fund-heading">Add funds</h2>
            {!wallet.configured ? (
              <p>
                Privy is not configured for this deployment. Wallet creation and
                financial actions are unavailable.
              </p>
            ) : !wallet.address ? (
              <>
                <p>
                  Sign in with email or a wallet. Privy creates your Noria
                  wallet, so no browser extension is required.
                </p>
                <button disabled={!wallet.ready} onClick={wallet.connect}>
                  {wallet.ready
                    ? "Create or open my Privy wallet"
                    : "Preparing wallet…"}
                </button>
              </>
            ) : (
              <>
                <p className={s.address}>{wallet.address}</p>
                <dl className={s.metrics}>
                  <div>
                    <dt>USDC in wallet</dt>
                    <dd>{snapshot ? units(snapshot.usdcUnits) : "Loading…"}</dd>
                  </div>
                  <div>
                    <dt>ETH for network fees</dt>
                    <dd>
                      {snapshot ? units(snapshot.nativeWei, 18) : "Loading…"}
                    </dd>
                  </div>
                </dl>
                <button
                  disabled={busy}
                  onClick={() => void task(() => fund("USDC"))}
                >
                  Add USDC with Privy
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => void task(() => fund("ETH"))}
                >
                  Add ETH for fees
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => void task(refresh)}
                >
                  <RefreshCw size={14} /> Refresh balances
                </button>
                <p className={s.note}>
                  Use native USDC on Arbitrum, not bridged USDC.e. Funding
                  methods shown depend on your Privy configuration and location.
                </p>
              </>
            )}
          </section>
          <section className={s.panel} aria-labelledby="reserve-heading">
            <span className={s.eyebrow}>02 · Aave savings</span>
            <h2 id="reserve-heading">Your USDC reserve</h2>
            <div className={s.loan}>
              <span>
                Supplied balance · includes any previous supply and accrued
                interest
              </span>
              <strong>
                {snapshot ? units(snapshot.aUsdcUnits) : "—"}{" "}
                <small>USDC</small>
              </strong>
            </div>
            <p className={s.note}>
              The reserve belongs to your Privy wallet. Supply interest varies;
              an increased balance alone is not proof of profit. This flow
              requires an Aave account without debt.
            </p>
            <div className={s.fieldRow}>
              <div>
                <label htmlFor="reserve-action">Operation</label>
                <select
                  id="reserve-action"
                  disabled={busy}
                  value={direction}
                  onChange={(e) => {
                    setDirection(e.target.value as "supply" | "withdraw");
                    setPrepared(null);
                  }}
                >
                  <option value="supply">Deposit USDC</option>
                  <option value="withdraw">Withdraw USDC</option>
                </select>
              </div>
              <div>
                <label htmlFor="reserve-amount">Amount (USDC)</label>
                <input
                  id="reserve-amount"
                  inputMode="decimal"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setPrepared(null);
                  }}
                  aria-describedby="reserve-amount-help"
                />
              </div>
            </div>
            {direction === "withdraw" &&
              snapshot &&
              parseUsdc(units(snapshot.aUsdcUnits)) && (
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => {
                    setAmount(units(snapshot.aUsdcUnits));
                    setPrepared(null);
                  }}
                >
                  Use supplied balance
                </button>
              )}
            <p className={s.note} id="reserve-amount-help">
              Up to 1,000 USDC per operation, with at most six decimal places.
            </p>
            {!prepared ? (
              <button
                disabled={!canAct || !amountUnits}
                onClick={() => void task(() => review())}
              >
                Review {direction === "supply" ? "deposit" : "withdrawal"}
              </button>
            ) : (
              <div className={r.review} aria-live="polite">
                <strong>
                  {prepared.action.kind === "approve"
                    ? "Step 1 · Exact approval"
                    : prepared.action.kind === "supply"
                      ? "Step 2 · Deposit into Aave"
                      : prepared.action.kind === "withdraw"
                        ? "Withdraw to your Privy wallet"
                        : "Remove Aave allowance"}
                </strong>
                <p>
                  {prepared.action.kind === "approve"
                    ? `Allow the Aave Pool to use exactly ${units(prepared.action.amountUnits)} USDC. Approval does not deposit funds.`
                    : prepared.action.kind === "revoke"
                      ? "Set the Aave Pool USDC allowance to zero."
                      : `${units(prepared.action.amountUnits)} USDC · Arbitrum One · your wallet is the beneficiary.`}
                </p>
                <p className={s.note}>
                  Estimated network fee, with 20% buffer:{" "}
                  {units(prepared.estimatedGasWei, 18)} ETH. Privy shows the
                  current fee before signing.
                </p>
                {expires && (
                  <p className={s.inputError}>
                    Review expired. Refresh before signing.
                  </p>
                )}
                <button
                  disabled={!canAct || !!expires}
                  onClick={() => void task(confirm)}
                >
                  Confirm in Privy
                </button>
                <button
                  className={s.secondary}
                  disabled={busy}
                  onClick={() => setPrepared(null)}
                >
                  Back to amount
                </button>
              </div>
            )}
            {snapshot && BigInt(snapshot.allowanceUnits) > 0n && (
              <>
                <p className={s.note}>
                  Current Aave allowance: {units(snapshot.allowanceUnits)} USDC.
                  If you stop after approval, you can remove it.
                </p>
                <button
                  className={s.secondary}
                  disabled={!canAct}
                  onClick={() => void task(() => review(true))}
                >
                  Review allowance removal
                </button>
              </>
            )}
            {unsettled && (
              <p className={s.note}>
                Check the outstanding transaction receipts below before starting
                another operation.
              </p>
            )}
            {busy && (
              <p className={s.status} role="status">
                Waiting for wallet or chain response…
              </p>
            )}
            {error && (
              <p className={s.inputError} role="alert">
                {error}
              </p>
            )}
            {storageWarning && (
              <p className={s.inputError} role="alert">
                {storageWarning}
              </p>
            )}
            {notice && (
              <p className={s.note} role="status">
                {notice}
              </p>
            )}
          </section>
        </div>
        <section
          className={`${s.panel} ${r.history}`}
          aria-labelledby="history-heading"
        >
          <span className={s.eyebrow}>03 · Trace your money</span>
          <h2 id="history-heading">Operation history</h2>
          {attempt && (
            <div className={r.review} role="alert">
              <strong>Resolve the earlier wallet request</strong>
              <p>
                {attempt.prepared.action.kind} ·{" "}
                {units(attempt.prepared.action.amountUnits)} USDC · requested{" "}
                {new Date(attempt.startedAt).toLocaleString()}. Its outcome is
                unresolved. A closed window or failed response does not prove
                cancellation. Do not repeat the operation.
              </p>
              <a
                href={`https://arbiscan.io/address/${attempt.prepared.action.owner}`}
                target="_blank"
                rel="noreferrer"
              >
                Inspect this wallet on Arbiscan <ArrowUpRight size={12} />
              </a>
              <p className={s.note}>
                Inspect Privy and Arbiscan. If you find the transaction, paste
                its hash below. Noria must match its receipt to this exact
                wallet, amount and operation.
              </p>
              <label htmlFor="reserve-recovery-hash">Transaction hash</label>
              <input
                id="reserve-recovery-hash"
                value={recoveryHash}
                onChange={(event) => setRecoveryHash(event.target.value)}
                disabled={busy}
                placeholder="0x…"
              />
              <button
                disabled={
                  busy ||
                  !historyReady ||
                  !/^0x[0-9a-fA-F]{64}$/.test(recoveryHash.trim())
                }
                onClick={() => void task(() => recoverAttempt())}
              >
                Verify and recover transaction
              </button>
              <button className={s.secondary} onClick={() => download()}>
                Download unresolved operation
              </button>
              <label className={s.note}>
                <input
                  type="checkbox"
                  checked={acknowledgedNoSubmission}
                  disabled={busy}
                  onChange={(event) =>
                    setAcknowledgedNoSubmission(event.target.checked)
                  }
                />
                I checked Privy and Arbiscan for this wallet, and no matching
                transaction is pending or completed.
              </label>
              <p className={s.note}>
                Clearing this warning enables a new review. If the earlier
                transaction was submitted, repeating it can move funds twice.
                This acknowledgment does not verify an onchain outcome.
              </p>
              <button
                className={s.secondary}
                disabled={busy || !historyReady || !acknowledgedNoSubmission}
                onClick={() => void task(() => recoverAttempt(true))}
              >
                Mark request as not submitted
              </button>
            </div>
          )}
          {!records.length ? (
            <p className={s.note}>
              No transactions recorded in this browser for this wallet.
              Confirmed operations include exact amounts, receipts, balances and
              network fees.
            </p>
          ) : (
            <>
              <ul className={r.operations}>
                {records.map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>
                        {entry.prepared.action.kind} ·{" "}
                        {units(entry.prepared.action.amountUnits)} USDC
                      </strong>
                      <p>
                        {entry.verification?.status === "verified"
                          ? "Onchain effect verified"
                          : entry.verification?.status === "reverted"
                            ? "Reverted · network fees spent"
                            : entry.verification?.status === "effect-unverified"
                              ? "Effect unverified"
                              : "Submitted · receipt check required"}
                      </p>
                      <a
                        href={`https://arbiscan.io/tx/${entry.hash}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {entry.hash} <ArrowUpRight size={12} />
                      </a>
                    </div>
                    <button
                      className={s.secondary}
                      disabled={busy}
                      onClick={() => void task(() => check(entry))}
                    >
                      Check receipt
                    </button>
                  </li>
                ))}
              </ul>
              <button className={s.secondary} onClick={() => download()}>
                <Download size={14} /> Download operation report
              </button>
              <button
                className={s.secondary}
                disabled={
                  busy ||
                  !historyReady ||
                  unsettled ||
                  !!attempt ||
                  !wallet.ready
                }
                onClick={() => void task(clearCheckedHistory)}
              >
                Download and clear checked history
              </button>
              <p className={s.note}>
                Clearing downloads your report and removes this browser&apos;s
                saved history, making room for more operations. Every receipt
                must first be checked as verified or reverted; pending or
                unverified operations cannot be cleared.
              </p>
            </>
          )}
          {snapshot && (
            <p className={s.note}>
              Balances observed at Arbitrum block {snapshot.blockNumber}.
              Receipt checks establish sequencer inclusion, not Ethereum
              finality.
            </p>
          )}
          <details className={s.details}>
            <summary>Supported contracts and custody</summary>
            <p className={s.note}>
              Native USDC: <code>{RESERVE.usdc}</code>
              <br />
              Aave Pool: <code>{RESERVE.pool}</code>
              <br />
              aUSDC: <code>{RESERVE.aUsdc}</code>
            </p>
            <p className={s.note}>
              Every transaction is confirmed through Privy. Noria never receives
              your private key. Deposits supply USDC to Aave, and your wallet
              holds aUSDC. Reports are saved in this browser and can be
              downloaded.
            </p>
          </details>
        </section>
        <section className={`${s.panel} ${r.history}`}>
          <span className={s.eyebrow}>Continue with Noria</span>
          <h2>Evaluate a liquidity position</h2>
          <p>
            Use The Graph to inspect a pool and range, then rehearse an
            Aave-financed Aqua position. The rehearsal runs on a local fork with
            fixture funds.
          </p>
          <p className={s.note}>
            Your live reserve is not moved or borrowed against by the rehearsal.
            A public Aqua PositionAccount would need its own funding; supply in
            this wallet is not automatically its collateral.
          </p>
          <a
            className={s.reportLink}
            href={
              amountUnits
                ? `/aqua?collateralUSDC=${encodeURIComponent(amount)}`
                : "/aqua"
            }
          >
            Plan an Aqua position <ArrowUpRight size={14} />
          </a>
        </section>
      </main>
    </div>
  );
}

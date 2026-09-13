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
  parseTransferAmount,
  isTransferAction,
  reserveActionDetails,
  OwnerSchema,
  type ReserveAction,
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
import {
  EuroAmountSchema,
  fiatKey,
  restoreFiatPurchases,
  type FiatPurchase,
} from "../integrations/privy/fiat";
import {
  readWalletPending,
  saveWalletPending,
  clearWalletPending,
  walletPendingKey,
  walletOperationEvent,
  type WalletPending,
} from "../integrations/privy/coordination";
import base from "./NoriaApp.module.css";
import s from "./AquaWorkbench.module.css";
import r from "./ReserveWorkbench.module.css";

const units = (v: string, decimals = 6) => formatUnits(BigInt(v), decimals);
const key = (owner: string) =>
  `noria.privy.operations.v1:${owner.toLowerCase()}`;
const attemptKey = (owner: string) =>
  `noria.privy.attempt.v1:${owner.toLowerCase()}`;
const actionAmount = (action: ReserveAction) => {
  const details = reserveActionDetails(action);
  return `${units(action.amountUnits, details.decimals)} ${details.asset}`;
};

export function ReserveWorkbench() {
  const wallet = useNoriaWallet();
  const [snapshot, setSnapshot] = useState<ReserveSnapshot | null>(null);
  const [amount, setAmount] = useState("10");
  const [direction, setDirection] = useState<"supply" | "withdraw">("supply");
  const [transferAsset, setTransferAsset] = useState<"USDC" | "ETH">("USDC");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferRecipient, setTransferRecipient] = useState("");
  const [euroAmount, setEuroAmount] = useState("50");
  const [fiatPurchases, setFiatPurchases] = useState<FiatPurchase[]>([]);
  const [sharedPending, setSharedPending] = useState<WalletPending | null>(
    null,
  );
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
    !sharedPending &&
    records.length < 100;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSnapshot(null);
    setFiatPurchases([]);
    setSharedPending(null);
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
      setFiatPurchases(
        restoreFiatPurchases(localStorage.getItem(fiatKey(owner)), owner),
      );
      setSharedPending(readWalletPending(localStorage, owner));
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
      if (event.key === walletPendingKey(owner)) {
        updateShared();
        return;
      }
      if (event.key === fiatKey(owner)) {
        try {
          setFiatPurchases(restoreFiatPurchases(event.newValue, owner));
        } catch {
          setStorageWarning(
            "Funding request history could not be read. Keep provider receipts and exported reports.",
          );
        }
        return;
      }
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
    const updateShared = () => {
      try {
        setSharedPending(readWalletPending(localStorage, owner));
        setPrepared(null);
      } catch {
        setHistoryReady(false);
        setError(
          "The pending wallet operation could not be read. Inspect wallet activity before continuing.",
        );
      }
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(walletOperationEvent, updateShared);
    return () => {
      controller.abort();
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(walletOperationEvent, updateShared);
    };
  }, [wallet.address]);

  useEffect(() => {
    if (!wallet.address) return;
    const owner = wallet.address;
    const controller = new AbortController();
    const update = () => {
      if (document.visibilityState !== "visible") return;
      void readReserve(owner, controller.signal)
        .then((state) => {
          if (!controller.signal.aborted && current(owner)) setSnapshot(state);
        })
        .catch(() => {}); // Keep the last timestamped observation; manual refresh exposes errors.
    };
    const timer = window.setInterval(update, 30_000);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
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
      saveWalletPending(localStorage, {
        id: next.id,
        owner: OwnerSchema.parse(owner),
        route: "reserve",
        startedAt: next.startedAt,
      });
      window.dispatchEvent(new Event(walletOperationEvent));
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
      sharedPending: readWalletPending(localStorage, owner),
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
  function saveFiatPurchase(purchase: FiatPurchase) {
    const existing = restoreFiatPurchases(
      localStorage.getItem(fiatKey(purchase.owner)),
      purchase.owner,
    );
    const next = [...existing.filter((v) => v.id !== purchase.id), purchase];
    if (next.length > 200)
      throw new Error(
        "Export and clear saved history before opening another funding request.",
      );
    localStorage.setItem(fiatKey(purchase.owner), JSON.stringify(next));
    if (current(purchase.owner)) setFiatPurchases(next);
  }
  async function fundWithEuros() {
    if (!wallet.address) return;
    const owner = wallet.address;
    const purchase: FiatPurchase = {
      id: crypto.randomUUID(),
      owner: OwnerSchema.parse(owner),
      requestedEuroAmount: EuroAmountSchema.parse(euroAmount),
      startedAt: new Date().toISOString(),
      status: "opened",
    };
    saveFiatPurchase(purchase);
    let result: { status: "submitted" | "confirmed" };
    try {
      result = await wallet.fundWithEuro(purchase.requestedEuroAmount);
    } catch (failure) {
      try {
        saveFiatPurchase({ ...purchase, status: "window-closed" });
      } catch {
        setStorageWarning(
          "The funding window closed, but its status could not be saved. Keep the provider receipt and inspect wallet balances.",
        );
      }
      throw failure;
    }
    try {
      saveFiatPurchase({
        ...purchase,
        status:
          result.status === "confirmed"
            ? "provider-confirmed"
            : "provider-submitted",
      });
    } catch {
      setStorageWarning(
        "The provider returned a status, but it could not be saved. Keep the provider receipt; do not infer a failed purchase from a storage error.",
      );
    }
    if (current(owner)) {
      setNotice(
        "The provider checkout does not prove delivery. Current balances are read from Arbitrum; keep the provider's receipt and refresh while funds arrive.",
      );
      await refresh();
    }
  }
  async function reviewTransfer() {
    if (!canAct || !wallet.address) return;
    const owner = wallet.address;
    const recipient = OwnerSchema.safeParse(transferRecipient.trim());
    const amount = parseTransferAmount(transferAmount, transferAsset);
    if (!recipient.success || !amount)
      throw new Error(
        "Enter a valid recipient address and a positive amount with the asset's exact decimal precision.",
      );
    const result = await prepareReserve({
      owner: OwnerSchema.parse(owner),
      recipient: recipient.data,
      kind: transferAsset === "ETH" ? "transfer-eth" : "transfer-usdc",
      amountUnits: amount,
    });
    if (current(owner)) {
      setPrepared(result);
      setNow(Date.now());
    }
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
    if (result.status === "verified" || result.status === "reverted") {
      clearWalletPending(localStorage, owner, entry.id);
      window.dispatchEvent(new Event(walletOperationEvent));
    }
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
            : isTransferAction(entry.prepared.action)
              ? `Transfer confirmed: ${actionAmount(entry.prepared.action)} to ${entry.prepared.action.recipient}.`
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
          send: async () => {
            try {
              return await wallet.sendReserveAction(fresh);
            } catch (failure) {
              if (
                typeof failure === "object" &&
                failure !== null &&
                "code" in failure &&
                failure.code === 4001
              ) {
                clearWalletPending(localStorage, owner, intent.id);
                window.dispatchEvent(new Event(walletOperationEvent));
              }
              throw failure;
            }
          },
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
        [
          JSON.stringify(
            {
              ...reserveReport(entries, attemptRef.current),
              balanceSnapshot: snapshot,
              fiatPurchaseRequests: fiatPurchases,
            },
            null,
            2,
          ),
        ],
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
          localStorage.removeItem(fiatKey(owner));
        } catch {
          throw new Error(
            "The report download started, but browser history could not be cleared. Keep the downloaded report.",
          );
        }
        recordRef.current = [];
        setRecords([]);
        setFiatPurchases([]);
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
          clearWalletPending(localStorage, owner, unresolved.id);
          window.dispatchEvent(new Event(walletOperationEvent));
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
        if (
          entry.verification.status === "verified" ||
          entry.verification.status === "reverted"
        ) {
          clearWalletPending(localStorage, owner, unresolved.id);
          window.dispatchEvent(new Event(walletOperationEvent));
        }
        setPrepared(null);
        setNotice(
          "The exact operation was matched to its receipt and moved to operation history. Review its status before continuing.",
        );
        await refresh();
      },
    });
  }
  const expires = prepared && now >= prepared.expiresAt;
  function transactionReview() {
    if (!prepared) return null;
    const action = prepared.action;
    return (
      <div className={r.review} aria-live="polite">
        <strong>
          {isTransferAction(action)
            ? "Review wallet transfer"
            : action.kind === "approve"
              ? "Step 1 · Exact approval"
              : action.kind === "supply"
                ? "Step 2 · Deposit into Aave"
                : action.kind === "withdraw"
                  ? "Withdraw to your Privy wallet"
                  : "Remove Aave allowance"}
        </strong>
        <p>
          {isTransferAction(action)
            ? `Send ${actionAmount(action)} on Arbitrum One to the recipient below.`
            : action.kind === "approve"
              ? `Allow the Aave Pool to use exactly ${actionAmount(action)}. Approval does not deposit funds.`
              : action.kind === "revoke"
                ? "Set the Aave Pool USDC allowance to zero."
                : `${actionAmount(action)} · Arbitrum One · your wallet is the beneficiary.`}
        </p>
        {isTransferAction(action) && (
          <>
            <span className={s.note}>Recipient</span>
            <p className={s.address}>{action.recipient}</p>
          </>
        )}
        <p className={s.note}>
          Estimated network fee, with 20% buffer:{" "}
          {units(prepared.estimatedGasWei, 18)} ETH. Privy shows the current fee
          before signing.
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
    );
  }
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
        {(busy || error || storageWarning || notice) && (
          <aside className={r.feedback} aria-label="Wallet operation status">
            {busy && <p role="status">Waiting for wallet or chain response…</p>}
            {error && (
              <p role="alert" className={s.inputError}>
                {error}
              </p>
            )}
            {storageWarning && (
              <p role="alert" className={s.inputError}>
                {storageWarning}
              </p>
            )}
            {notice && <p role="status">{notice}</p>}
            {!busy && (
              <button
                className={s.secondary}
                onClick={() => {
                  setError(null);
                  setNotice(null);
                  setStorageWarning(null);
                }}
              >
                Dismiss message
              </button>
            )}
          </aside>
        )}
        <section className={s.hero}>
          <span className={s.eyebrow}>Noria × Privy · fund, grow and move</span>
          <h1>
            Your USDC.
            <br />
            <span>Ready for your next move.</span>
          </h1>
          <p>
            Fund your wallet in euros, deposit USDC into Aave, or send funds to
            another wallet. See your current balances and a receipt for each
            operation before continuing to an Aqua position.
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
        {sharedPending?.route === "aqua" && (
          <p className={s.inputError} role="alert">
            An Aqua wallet operation needs attention.{" "}
            <a href="/aqua">Open the position and check its receipt</a> before
            sending another transaction.
          </p>
        )}
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
                <label htmlFor="fund-eur">Pay in euros (EUR)</label>
                <input
                  id="fund-eur"
                  inputMode="decimal"
                  value={euroAmount}
                  disabled={busy}
                  onChange={(event) => setEuroAmount(event.target.value)}
                />
                <button
                  disabled={
                    busy ||
                    !historyReady ||
                    !EuroAmountSchema.safeParse(euroAmount).success
                  }
                  onClick={() => void task(fundWithEuros)}
                >
                  Buy USDC with euros
                </button>
                <p className={s.note}>
                  Receive native USDC on Arbitrum in this wallet. Review the
                  final exchange rate, provider fees and payment methods in
                  Privy&apos;s checkout. EUR is selected; availability and
                  identity checks depend on the provider and your location.
                </p>
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
            {!prepared || isTransferAction(prepared.action) ? (
              <button
                disabled={!canAct || !amountUnits}
                onClick={() => void task(() => review())}
              >
                Review {direction === "supply" ? "deposit" : "withdrawal"}
              </button>
            ) : (
              transactionReview()
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
          </section>
        </div>
        <section
          className={`${s.panel} ${r.history}`}
          aria-labelledby="transfer-heading"
        >
          <span className={s.eyebrow}>03 · Send to another wallet</span>
          <h2 id="transfer-heading">Transfer funds</h2>
          <p>
            Send available wallet funds on Arbitrum One. To send USDC held in
            your Aave reserve, withdraw it to this wallet first.
          </p>
          <div className={s.fieldRow}>
            <div>
              <label htmlFor="transfer-asset">Asset to send</label>
              <select
                id="transfer-asset"
                value={transferAsset}
                disabled={busy}
                onChange={(event) => {
                  setTransferAsset(event.target.value as "USDC" | "ETH");
                  setPrepared(null);
                }}
              >
                <option value="USDC">USDC · Arbitrum</option>
                <option value="ETH">ETH · Arbitrum</option>
              </select>
            </div>
            <div>
              <label htmlFor="transfer-amount">
                Amount to send ({transferAsset})
              </label>
              <input
                id="transfer-amount"
                value={transferAmount}
                inputMode="decimal"
                disabled={busy}
                onChange={(event) => {
                  setTransferAmount(event.target.value);
                  setPrepared(null);
                }}
              />
            </div>
          </div>
          <label htmlFor="transfer-recipient">Recipient address</label>
          <input
            id="transfer-recipient"
            value={transferRecipient}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(event) => {
              setTransferRecipient(event.target.value);
              setPrepared(null);
            }}
          />
          <p className={s.note}>
            The recipient must support this asset on Arbitrum. ETH is needed for
            network fees; the review checks the amount and fee together before
            confirmation.
          </p>
          {snapshot &&
            transferAsset === "USDC" &&
            BigInt(snapshot.usdcUnits) > 0n && (
              <button
                className={s.secondary}
                disabled={busy}
                onClick={() => {
                  setTransferAmount(units(snapshot.usdcUnits));
                  setPrepared(null);
                }}
              >
                Use wallet USDC balance
              </button>
            )}
          {prepared && isTransferAction(prepared.action) ? (
            transactionReview()
          ) : (
            <button
              disabled={
                !canAct ||
                !parseTransferAmount(transferAmount, transferAsset) ||
                !OwnerSchema.safeParse(transferRecipient.trim()).success
              }
              onClick={() => void task(reviewTransfer)}
            >
              Review transfer
            </button>
          )}
        </section>
        <section
          className={`${s.panel} ${r.history}`}
          aria-labelledby="history-heading"
        >
          <span className={s.eyebrow}>04 · Trace your money</span>
          <h2 id="history-heading">Operation history</h2>
          <p className={s.note}>
            Your Noria activity in this browser: deposits, withdrawals,
            approvals and transfers. Current balances come from Arbitrum and can
            include funds received elsewhere.
          </p>
          {attempt && (
            <div className={r.review} role="alert">
              <strong>Resolve the earlier wallet request</strong>
              <p>
                {attempt.prepared.action.kind} ·{" "}
                {actionAmount(attempt.prepared.action)} · requested{" "}
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
                {[...records].reverse().map((entry) => (
                  <li key={entry.id}>
                    <div>
                      <strong>
                        {entry.prepared.action.kind} ·{" "}
                        {actionAmount(entry.prepared.action)}
                      </strong>
                      <p>
                        {new Date(entry.submittedAt).toLocaleString()} ·
                        Arbitrum One
                      </p>
                      {isTransferAction(entry.prepared.action) && (
                        <p className={s.address}>
                          To {entry.prepared.action.recipient}
                        </p>
                      )}
                      {entry.verification && (
                        <p>
                          Network fee:{" "}
                          {units(entry.verification.networkFeeWei, 18)} ETH
                        </p>
                      )}
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
          {fiatPurchases.length > 0 && (
            <div className={r.fundingHistory}>
              <h3>Euro funding requests</h3>
              <p className={s.note}>
                Requested amounts and provider status only. These entries are
                not proof of a charge or an onchain USDC receipt. Keep the
                provider&apos;s final receipt; wallet balances update
                independently.
              </p>
              <ul className={r.operations}>
                {[...fiatPurchases].reverse().map((purchase) => (
                  <li key={purchase.id}>
                    <div>
                      <strong>
                        Requested €{purchase.requestedEuroAmount} → USDC
                      </strong>
                      <p>
                        {new Date(purchase.startedAt).toLocaleString()} ·{" "}
                        {purchase.status.replaceAll("-", " ")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {!records.length && (
                <>
                  <button className={s.secondary} onClick={() => download()}>
                    <Download size={14} /> Download operation report
                  </button>
                  <button
                    className={s.secondary}
                    disabled={
                      busy || !historyReady || !!attempt || !wallet.ready
                    }
                    onClick={() => void task(clearCheckedHistory)}
                  >
                    Download and clear checked history
                  </button>
                </>
              )}
            </div>
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
            Use The Graph to inspect a pool and range, then review the
            Aave-financed Aqua launch. You can also rehearse on a local fork
            with fixture funds.
          </p>
          <p className={s.note}>
            This link only passes your chosen amount to the planner. An Aqua
            position needs its own collateral: withdraw reserve USDC to this
            wallet before the separate, confirmed position funding step.
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

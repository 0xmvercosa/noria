"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatUnits } from "viem";
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Download,
  FlaskConical,
  RefreshCw,
} from "lucide-react";
import { NoriaHeader } from "./NoriaHeader";
import { useNoriaWallet } from "./NoriaWalletProvider";
import { AquaLaunchWorkbench } from "./AquaLaunchWorkbench";
import { AmountInput } from "./FinancialInput";
import { EthAmount, EthUsdEquivalent, EthUsdNote } from "./EthUsd";
import { UsdReferenceSchema, usdReferenceFromReport } from "../domain/eth-usd";
import { AQUA_SCOPE } from "../integrations/aqua/contract";
import {
  PositionRequestSchema,
  type PositionRequest,
  type PositionPlanResponse,
} from "../integrations/aqua/position-contract";
import { parseUsdc } from "../integrations/privy/reserve";
import {
  plannerDraftKey,
  restorePlannerDraft,
} from "../integrations/aqua/planner-draft";
import { usd, number } from "./format";
import base from "./NoriaApp.module.css";
import s from "./AquaWorkbench.module.css";

type LocalRun = {
  runId: string;
  status: "running" | "completed" | "failed";
  owner: string;
  message?: string;
  reportUrl?: string;
};
type Availability = "checking" | "enabled" | "disabled" | "unavailable";

function decimalUnits(value: string, decimals: number): string | null {
  if (!new RegExp(`^\\d{1,60}(\\.\\d{0,${decimals}})?$`).test(value))
    return null;
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0"))
  ).toString();
}

function rawAmount(value: string, decimals: number): string {
  if (!/^\d+$/.test(value)) return "Unavailable";
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded
    .slice(0, -decimals)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function failureMessage(body: any, fallback: string): string {
  if (typeof body?.message === "string") return body.message;
  if (typeof body?.issues?.[0]?.message === "string")
    return body.issues[0].message;
  return fallback;
}

function reportLink(value: string | undefined): string | undefined {
  if (!value || typeof window === "undefined") return undefined;
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      ["http:", "https:"].includes(url.protocol)
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

export function AquaWorkbench() {
  const [fundingAsset, setFundingAsset] = useState<"ETH" | "USDC">("USDC");
  const [amount, setAmount] = useState("20000");
  const [safetyHF, setSafetyHF] = useState("1.4");
  const [comfortableHF, setComfortableHF] = useState("2");
  const [hours, setHours] = useState<6 | 24>(6);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [response, setResponse] = useState<PositionPlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [availability, setAvailability] = useState<Availability>("checking");
  const [startingRun, setStartingRun] = useState(false);
  const [run, setRun] = useState<LocalRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [pollError, setPollError] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const pending = useRef<AbortController | null>(null);
  const runRequest = useRef<AbortController | null>(null);
  const initialDraftRead = useRef(false);
  const wallet = useNoriaWallet();

  useEffect(() => {
    if (!initialDraftRead.current) {
      initialDraftRead.current = true;
      try {
        const saved = restorePlannerDraft(
          sessionStorage.getItem(plannerDraftKey),
        );
        if (saved) {
          setFundingAsset(saved.fundingAsset);
          setAmount(saved.amount);
          setSafetyHF(saved.safetyHF);
          setComfortableHF(saved.comfortableHF);
          setHours(saved.hours);
          setRestoredDraft(true);
        }
      } catch {
        /* Planning remains available without browser storage. */
      }
      const fromReserve = new URLSearchParams(window.location.search).get(
        "collateralUSDC",
      );
      if (fromReserve && parseUsdc(fromReserve)) {
        setFundingAsset("USDC");
        setAmount(fromReserve);
      }
      // Consume the handoff once. Otherwise OAuth/reload would reapply an old
      // query amount after the user edits the saved collateral or asset.
      if (fromReserve !== null) {
        const url = new URL(window.location.href);
        url.searchParams.delete("collateralUSDC");
        window.history.replaceState(
          window.history.state,
          "",
          url.pathname + url.search + url.hash,
        );
      }
      setDraftLoaded(true);
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const controller = new AbortController();
    void fetch("/api/aqua/v1/local-rehearsal", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (result) => {
        if (!result.ok) throw new Error("Local runner unavailable");
        const body = await result.json();
        if (!controller.signal.aborted)
          setAvailability(body.enabled === true ? "enabled" : "disabled");
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailability("unavailable");
      });
    return () => {
      window.clearInterval(timer);
      controller.abort();
      pending.current?.abort();
      runRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!draftLoaded) return;
    try {
      sessionStorage.setItem(
        plannerDraftKey,
        JSON.stringify({
          fundingAsset,
          amount,
          safetyHF,
          comfortableHF,
          hours,
        }),
      );
    } catch {
      /* Do not prevent analysis when storage is unavailable. */
    }
  }, [draftLoaded, fundingAsset, amount, safetyHF, comfortableHF, hours]);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const runId = run.runId;
    setPollError(false);
    async function poll() {
      try {
        const result = await fetch(
          `/api/aqua/v1/local-rehearsal?runId=${encodeURIComponent(runId)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const body = await result.json();
        if (
          !result.ok ||
          body.runId !== runId ||
          !["running", "completed", "failed"].includes(body.status)
        )
          throw new Error("Run status unavailable");
        if (controller.signal.aborted) return;
        failures = 0;
        setPollError(false);
        setRun((previous) =>
          previous?.runId === runId
            ? {
                ...previous,
                status: body.status,
                message:
                  typeof body.message === "string" ? body.message : undefined,
                reportUrl:
                  typeof body.reportUrl === "string"
                    ? body.reportUrl
                    : undefined,
              }
            : previous,
        );
        if (body.status === "running")
          timer = setTimeout(() => void poll(), 3000);
      } catch {
        if (controller.signal.aborted) return;
        failures++;
        setPollError(true);
        if (failures < 3) timer = setTimeout(() => void poll(), 5000);
      }
    }
    timer = setTimeout(() => void poll(), 1500);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [run?.runId, run?.status, pollAttempt]);

  function clearPlan() {
    pending.current?.abort();
    setLoading(false);
    setResponse(null);
    setError(null);
  }

  const collateralAmountUnits = decimalUnits(
    amount,
    fundingAsset === "ETH" ? 18 : 6,
  );
  const safetyHFWad = decimalUnits(safetyHF, 18);
  const comfortableHFWad = decimalUnits(comfortableHF, 18);
  const validHealthFactors =
    !!safetyHFWad &&
    !!comfortableHFWad &&
    BigInt(safetyHFWad) > 10n ** 18n &&
    BigInt(comfortableHFWad) > BigInt(safetyHFWad) &&
    BigInt(comfortableHFWad) <= 10n ** 19n;
  let draft: PositionRequest | null = null;
  if (collateralAmountUnits && safetyHFWad && comfortableHFWad) {
    const parsed = PositionRequestSchema.safeParse({
      schemaVersion: "noria.aqua.position.v1",
      requestId: "position-preview",
      intent: {
        fundingAsset,
        collateralAmountUnits,
        safetyHFWad,
        comfortableHFWad,
        financingMode: "aave_collateral_then_borrow_usdc",
      },
      reviewAfterHours: hours,
    });
    if (parsed.success) draft = parsed.data;
  }
  const inputError =
    !collateralAmountUnits || BigInt(collateralAmountUnits) === 0n
      ? `Enter a positive collateral amount with up to ${fundingAsset === "ETH" ? 18 : 6} decimal places.`
      : !draft
        ? "Use 1 < safety HF < comfortable HF ≤ 10, and a valid collateral amount."
        : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    clearPlan();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const request = {
        ...draft,
        requestId: `position-${crypto.randomUUID()}`,
      };
      const result = await fetch("/api/aqua/v1/position", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const body = await result.json();
      if (!result.ok)
        throw new Error(
          failureMessage(body, "The position analysis could not be completed."),
        );
      if (
        body.schemaVersion !== "noria.aqua.position.v1" ||
        body.requestId !== request.requestId ||
        !["ready-for-local-rehearsal", "refused"].includes(body.status) ||
        !body.financing ||
        typeof body.financing.loanUSDCUnits !== "string" ||
        !/^\d+$/.test(body.financing.loanUSDCUnits) ||
        !Array.isArray(body.reasons) ||
        !Number.isFinite(Date.parse(body.validUntil)) ||
        (body.status === "ready-for-local-rehearsal" &&
          (!body.execution || !body.graph?.recommendation))
      ) {
        throw new Error("The server returned an unsupported position plan.");
      }
      if (!controller.signal.aborted) {
        setResponse(body);
        setNow(Date.now());
      }
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Analysis unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  const rec = response?.graph?.recommendation;
  const execution = response?.execution;
  const financingUsd =
    response?.intent.fundingAsset === "ETH" &&
    /^\d+$/.test(response.financing.collateralPriceBase)
      ? UsdReferenceSchema.safeParse({
          usd: formatUnits(BigInt(response.financing.collateralPriceBase), 8),
          timestamp: Date.parse(response.financing.timestamp) / 1000,
          provider: "Aave V3 oracle · Arbitrum",
        })
      : null;
  const collateralUsdReference = financingUsd?.success
    ? financingUsd.data
    : null;
  const expired = response ? now >= Date.parse(response.validUntil) : false;
  const ready =
    response?.status === "ready-for-local-rehearsal" &&
    !!execution &&
    !!rec &&
    !expired;
  const canRun =
    availability === "enabled" &&
    wallet.ready &&
    !!wallet.address &&
    ready &&
    !startingRun &&
    run?.status !== "running";

  function downloadPlan() {
    if (!response) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(response, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `noria-aqua-plan-${response.requestId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function startRehearsal() {
    // Check the actual clock, including the interval between display updates.
    if (
      !canRun ||
      !response ||
      !wallet.address ||
      Date.now() >= Date.parse(response.validUntil)
    )
      return;
    const owner = wallet.address;
    const controller = new AbortController();
    runRequest.current = controller;
    setStartingRun(true);
    setRunError(null);
    try {
      const result = await fetch("/api/aqua/v1/local-rehearsal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: response, owner }),
        signal: controller.signal,
      });
      const body = await result.json();
      if (result.status !== 202)
        throw new Error(
          failureMessage(body, "The local rehearsal could not start."),
        );
      if (
        body.status !== "running" ||
        typeof body.runId !== "string" ||
        !/^[A-Za-z0-9_.-]{1,120}$/.test(body.runId)
      )
        throw new Error("The local runner returned an unsupported response.");
      if (!controller.signal.aborted)
        setRun({ runId: body.runId, status: "running", owner });
    } catch (failure) {
      if (!controller.signal.aborted)
        setRunError(
          failure instanceof Error
            ? failure.message
            : "Local rehearsal unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setStartingRun(false);
    }
  }

  const sourceAddress = rec?.referencePool.address;
  const sourceUrl =
    sourceAddress && /^0x[0-9a-fA-F]{40}$/.test(sourceAddress)
      ? `https://arbiscan.io/address/${sourceAddress}`
      : undefined;
  const completeReportUrl = reportLink(run?.reportUrl);

  return (
    <div className={base.app}>
      <NoriaHeader current="aqua" context="Positions · Arbitrum One" />
      <main className={s.main}>
        <section className={s.hero}>
          <span className={s.eyebrow}>
            Noria × Aqua · collateral to liquidity
          </span>
          <h1>
            Your capital.
            <br />
            <span>A plan with evidence.</span>
          </h1>
          <p>
            Use ETH or USDC as Aave collateral, borrow USDC and offer WETH/USDC
            liquidity through Aqua. The Graph helps select a reference pool,
            price range and token mix before you commit funds.
          </p>
          <p className={s.note}>
            Review the plan, then launch with your Privy wallet when the public
            deployment is available. Historical activity does not establish
            future Aqua demand or profitable returns.
          </p>
        </section>
        <ol className={s.steps} aria-label="Position planning steps">
          <li>
            <span>01</span>
            <div>
              <strong>Your collateral</strong>
              <small>Fund your wallet and set borrowing limits</small>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <strong>Review your plan</strong>
              <small>Collateral, loan, pool and range</small>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <strong>Launch and manage</strong>
              <small>Confirm each step · repay before withdrawing</small>
            </div>
          </li>
        </ol>
        <div className={s.workspace}>
          <form
            className={s.panel}
            onSubmit={submit}
            aria-describedby="position-input-note"
          >
            <span className={s.eyebrow}>01 · Your policy</span>
            <h2>Set your collateral</h2>
            {restoredDraft && (
              <p className={s.note} role="status">
                Your saved inputs were restored. Run the analysis again for
                current evidence.
              </p>
            )}
            <label htmlFor="collateral-asset">Collateral asset</label>
            <select
              id="collateral-asset"
              value={fundingAsset}
              onChange={(event) => {
                clearPlan();
                setFundingAsset(event.target.value as "ETH" | "USDC");
              }}
            >
              <option value="USDC">USDC · native Arbitrum USDC</option>
              <option value="ETH">ETH · wrapped to WETH</option>
            </select>
            <label htmlFor="collateral-amount">
              Collateral amount ({fundingAsset})
            </label>
            <AmountInput
              id="collateral-amount"
              decimals={fundingAsset === "USDC" ? 6 : 18}
              value={amount}
              aria-invalid={
                !collateralAmountUnits || BigInt(collateralAmountUnits) === 0n
              }
              onValueChange={(value) => {
                clearPlan();
                setAmount(value);
              }}
            />
            {fundingAsset === "ETH" && collateralAmountUnits && (
              <p className={s.note}>
                <EthUsdEquivalent
                  amount={formatUnits(BigInt(collateralAmountUnits), 18)}
                />
              </p>
            )}
            <p className={s.note} id="position-input-note">
              At launch, your position supplies this collateral to Aave. The
              USDC loan buys the liquidity inventory. Keep collateral in your
              wallet until then; a separate Aave savings deposit is optional.
              You also need ETH for network fees.{" "}
              <a href="/reserve#fund-heading">Add funds</a>.
            </p>
            <EthUsdNote />
            <div className={s.fieldRow}>
              <div>
                <label htmlFor="safety-hf">Safety health factor</label>
                <AmountInput
                  id="safety-hf"
                  decimals={18}
                  value={safetyHF}
                  onValueChange={(value) => {
                    clearPlan();
                    setSafetyHF(value);
                  }}
                  aria-invalid={!validHealthFactors}
                  aria-describedby="safety-note"
                />
                <p className={s.note} id="safety-note">
                  Your threshold for reducing debt. Protection is manual: you
                  must review and confirm the action. Aave can liquidate below
                  1.
                </p>
              </div>
              <div>
                <label htmlFor="comfortable-hf">
                  Comfortable health factor
                </label>
                <AmountInput
                  id="comfortable-hf"
                  decimals={18}
                  value={comfortableHF}
                  onValueChange={(value) => {
                    clearPlan();
                    setComfortableHF(value);
                  }}
                  aria-invalid={!validHealthFactors}
                  aria-describedby="comfortable-note"
                />
                <p className={s.note} id="comfortable-note">
                  Required to launch liquidity. A higher value reduces the
                  borrowing budget. Interest continues until the debt is repaid.
                </p>
              </div>
            </div>
            <label htmlFor="review-hours">Review the position after</label>
            <select
              id="review-hours"
              value={hours}
              onChange={(event) => {
                clearPlan();
                setHours(Number(event.target.value) as 6 | 24);
              }}
            >
              <option value="6">6 hours</option>
              <option value="24">24 hours</option>
            </select>
            <p className={s.note}>
              A planning horizon; it does not schedule a trade or alter the
              seven-day lookback.
            </p>
            {inputError && (
              <p className={s.inputError} role="alert">
                {inputError}
              </p>
            )}
            <button type="submit" disabled={!draft || loading}>
              {loading ? (
                <>
                  <RefreshCw
                    size={15}
                    className={s.spinner}
                    aria-hidden="true"
                  />{" "}
                  Checking borrowing and evidence…
                </>
              ) : (
                <>
                  Find my pool and range{" "}
                  <ArrowUpRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
            {loading && (
              <button type="button" className={s.secondary} onClick={clearPlan}>
                Cancel analysis
              </button>
            )}
            <p className={s.note}>
              Analysis uses public data and moves no funds. A wallet is needed
              for launch or local rehearsal.
            </p>
          </form>
          <section className={s.panel} aria-live="polite" aria-busy={loading}>
            <span className={s.eyebrow}>02 · Inspect your plan</span>
            {!response && !error && (
              <div className={s.empty}>
                <div className={s.emptyMark} aria-hidden="true">
                  <ArrowDown size={25} />
                </div>
                <h2>
                  {loading
                    ? "Following the evidence"
                    : "The pool comes from the search"}
                </h2>
                <p>
                  {loading
                    ? "Reading Aave borrowing limits, then evaluating source pools and range capacity. Provider checks can take a few minutes."
                    : "Start with collateral and your limits. The result will show how much USDC can fund the position and which source passes the market checks."}
                </p>
                <p className={s.note}>
                  Aave sizing → exact WETH/USDC scope → source verification →
                  range and inventory.
                </p>
              </div>
            )}
            {error && (
              <div role="alert">
                <h2>Analysis unavailable</h2>
                <p>{error}</p>
                <p className={s.note}>
                  Refresh the analysis when sources are available. No saved
                  result replaces a live response.
                </p>
              </div>
            )}
            {response && (
              <>
                <p
                  className={`${s.status} ${expired || response.status === "refused" ? s.warning : ""}`}
                >
                  {expired ? (
                    "Evidence expired · refresh required"
                  ) : response.status === "refused" ? (
                    "This plan cannot proceed"
                  ) : (
                    <>
                      <Check size={14} aria-hidden="true" /> Plan ready for
                      review
                    </>
                  )}
                </p>
                <div className={s.loan}>
                  <span>USDC loan for inventory</span>
                  <strong>
                    {rawAmount(response.financing.loanUSDCUnits, 6)}{" "}
                    <small>USDC</small>
                  </strong>
                  <p className={s.note}>
                    Against{" "}
                    {response.intent.fundingAsset === "ETH" ? (
                      <EthAmount
                        wei={response.intent.collateralAmountUnits}
                        reference={collateralUsdReference}
                      />
                    ) : (
                      <>
                        {rawAmount(response.intent.collateralAmountUnits, 6)}{" "}
                        USDC
                      </>
                    )}{" "}
                    collateral · {response.financing.headroomBps} bps of
                    borrowing headroom.
                  </p>
                </div>
                <p className={s.note}>
                  You supply{" "}
                  {response.intent.fundingAsset === "ETH" ? (
                    <EthAmount
                      wei={response.intent.collateralAmountUnits}
                      reference={collateralUsdReference}
                    />
                  ) : (
                    <>
                      {rawAmount(response.intent.collateralAmountUnits, 6)} USDC
                    </>
                  )}
                  , then owe {rawAmount(response.financing.loanUSDCUnits, 6)}{" "}
                  USDC plus variable interest. The loan funds WETH/USDC
                  inventory in your position account; the reference pool below
                  is used for research, not a Uniswap LP deposit. Fees require
                  actual Aqua swaps. Market losses, borrowing costs and network
                  fees can exceed earnings.
                </p>
                {ready && (
                  <a className={s.reportLink} href="#launch-heading">
                    Continue to launch review <ArrowUpRight size={14} />
                  </a>
                )}
                <dl className={s.policy}>
                  <div>
                    <dt>Safety HF</dt>
                    <dd>{rawAmount(response.intent.safetyHFWad, 18)}</dd>
                  </div>
                  <div>
                    <dt>Comfortable HF</dt>
                    <dd>{rawAmount(response.intent.comfortableHFWad, 18)}</dd>
                  </div>
                  <div>
                    <dt>Aave source block</dt>
                    <dd>{response.financing.blockNumber}</dd>
                  </div>
                </dl>
                {response.status === "refused" &&
                  response.reasons.length > 0 && (
                    <div className={s.refusal} role="status">
                      <h3>Why this plan was refused</h3>
                      <ul>
                        {response.reasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                {rec && (
                  <>
                    <div className={s.sourceHeading}>
                      <h2>WETH / USDC</h2>
                      <span className={s.fee}>
                        {number(rec.referencePool.feeTier / 10000, 2)}%
                        reference fee
                      </span>
                    </div>
                    <div
                      className={s.range}
                      aria-label={`Reference range from ${rec.range.lower} to ${rec.range.upper} USDC per WETH`}
                    >
                      <span>{number(rec.range.lower, 2)}</span>
                      <i aria-hidden="true" />
                      <span>{number(rec.range.upper, 2)}</span>
                    </div>
                    <p className={s.note}>
                      USDC per WETH · spot {number(rec.range.spot, 2)} · range{" "}
                      {rec.range.location}
                    </p>
                    <dl className={s.metrics}>
                      <div>
                        <dt>Target WETH</dt>
                        <dd>
                          <EthAmount
                            wei={
                              execution?.targetWethUnits ??
                              rec.targetInventory.wethAmountRaw
                            }
                            symbol="WETH"
                            reference={usdReferenceFromReport(
                              rec.report,
                              AQUA_SCOPE.weth.address,
                            )}
                          />
                        </dd>
                      </div>
                      <div>
                        <dt>Target USDC</dt>
                        <dd>
                          {rawAmount(
                            execution?.targetUsdcUnits ??
                              rec.targetInventory.usdcAmountRaw,
                            6,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Inventory value</dt>
                        <dd>{usd(rec.targetInventory.valuationUsd)}</dd>
                      </div>
                      <div>
                        <dt>Maximum reference share</dt>
                        <dd>
                          {number(rec.report.position.maxSharePercent, 3)}%
                        </dd>
                      </div>
                    </dl>
                    {execution && (
                      <p className={s.coverage}>
                        <strong>
                          {number(execution.coverageBps / 100, 2)}% historical
                          coverage
                        </strong>
                        <span>
                          {execution.inRangeObservations} of{" "}
                          {execution.observationCount} hourly prices inside this
                          range.
                        </span>
                      </p>
                    )}
                    <p className={s.note}>
                      Inventory follows the selected range. Preparation and exit
                      swaps still need executable quotes; historical coverage
                      does not predict fills.
                    </p>
                    {sourceUrl && (
                      <a
                        className={s.poolLink}
                        href={sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Inspect the source pool{" "}
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </a>
                    )}
                    <p className={`${s.note} ${s.address}`}>{sourceAddress}</p>
                  </>
                )}
                {response.graph && !rec && (
                  <p>{response.graph.selection.discovery.selectedReason}</p>
                )}
                <p className={s.note}>
                  <time dateTime={response.validUntil}>
                    Evidence expires{" "}
                    {new Date(response.validUntil).toISOString()}
                  </time>
                  . Refresh before using this plan.
                </p>
                <button
                  type="button"
                  className={s.secondary}
                  onClick={downloadPlan}
                >
                  <Download size={15} aria-hidden="true" /> Download complete
                  plan JSON
                </button>
                <details className={s.details}>
                  <summary>
                    Source evidence, exclusions and complete plan
                  </summary>
                  {response.status !== "refused" &&
                    response.reasons.length > 0 && (
                      <ul className={s.exclusions}>
                        {response.reasons.map((reason, index) => (
                          <li key={index}>{reason}</li>
                        ))}
                      </ul>
                    )}
                  {rec && (
                    <dl className={s.provenance}>
                      <div>
                        <dt>Provider</dt>
                        <dd>{rec.report.source.provider}</dd>
                      </div>
                      <div>
                        <dt>Graph source block</dt>
                        <dd>{rec.report.source.blockNumber}</dd>
                      </div>
                      <div>
                        <dt>Block hash</dt>
                        <dd>
                          <code>{rec.report.source.blockHash}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Query digest · SHA-256</dt>
                        <dd>
                          <code>{rec.report.source.queryHash}</code>
                        </dd>
                      </div>
                      <div>
                        <dt>Response digest · SHA-256</dt>
                        <dd>
                          <code>{rec.report.source.responseHash}</code>
                        </dd>
                      </div>
                    </dl>
                  )}
                  {response.graph &&
                    response.graph.selection.discovery.rejected.length > 0 && (
                      <ul className={s.exclusions}>
                        {response.graph.selection.discovery.rejected.map(
                          (item, index) => (
                            <li key={index}>
                              <code>{item.address}</code>
                              <span>{item.reason}</span>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  <pre>{JSON.stringify(response, null, 2)}</pre>
                </details>
              </>
            )}
          </section>
        </div>
        <AquaLaunchWorkbench
          plan={response}
          onPlan={(updated) => {
            setResponse(updated);
            setFundingAsset(updated.intent.fundingAsset);
            setAmount(
              formatUnits(
                BigInt(updated.intent.collateralAmountUnits),
                updated.intent.fundingAsset === "ETH" ? 18 : 6,
              ),
            );
            setSafetyHF(formatUnits(BigInt(updated.intent.safetyHFWad), 18));
            setComfortableHF(
              formatUnits(BigInt(updated.intent.comfortableHFWad), 18),
            );
          }}
        />
        <section
          className={`${s.panel} ${s.simulation}`}
          aria-labelledby="rehearsal-heading"
        >
          <div>
            <span className={s.eyebrow}>04 · Inspect local execution</span>
            <h2 id="rehearsal-heading">
              <FlaskConical size={21} aria-hidden="true" /> Rehearse this plan
              locally
            </h2>
            <p>
              Run the lifecycle on an isolated Arbitrum fork using your
              connected public address. Transactions run inside the fork; your
              wallet is not asked to sign.
            </p>
            <p className={s.note}>
              The report separates collateral, borrowing interest, gas and
              related-taker results. Local fills demonstrate execution, not
              organic demand or guaranteed yield.
            </p>
          </div>
          <div className={s.rehearsalControls}>
            {availability === "checking" && (
              <p className={s.note}>Checking local runner availability…</p>
            )}
            {availability !== "checking" && availability !== "enabled" && (
              <p className={s.note}>
                The local runner is unavailable in this deployment. Download the
                plan and use the local workflow below.
              </p>
            )}
            {availability === "enabled" && !ready && (
              <p className={s.note}>
                {expired
                  ? "Refresh the expired plan before starting a rehearsal."
                  : "Create a passing plan with fresh evidence to enable rehearsal."}
              </p>
            )}
            {!wallet.configured && (
              <p className={s.note}>
                Wallet connection is not configured for this deployment. Plan
                analysis and download remain available.
              </p>
            )}
            {wallet.configured && !wallet.address && (
              <button
                className={s.secondary}
                type="button"
                disabled={!wallet.ready}
                onClick={wallet.connect}
              >
                {wallet.ready
                  ? "Open Privy wallet for local rehearsal"
                  : "Loading wallet…"}
              </button>
            )}
            <button
              type="button"
              disabled={!canRun}
              onClick={() => void startRehearsal()}
            >
              {startingRun
                ? "Starting local rehearsal…"
                : run?.status === "running"
                  ? "Local rehearsal running…"
                  : "Run local rehearsal"}
            </button>
            {runError && (
              <p className={s.inputError} role="alert">
                {runError}
              </p>
            )}
          </div>
          {run && (
            <div className={s.runStatus} aria-live="polite">
              <strong>
                {run.status === "completed"
                  ? "Local rehearsal completed"
                  : run.status === "failed"
                    ? "Local rehearsal stopped"
                    : "Local rehearsal in progress"}
              </strong>
              <p>
                {run.message ??
                  (run.status === "running"
                    ? "The isolated fork is running. You can inspect the standalone report when it finishes."
                    : run.status === "failed"
                      ? "Inspect the report for the stopping reason."
                      : "Open the report to inspect transactions, financial reconciliation and limitations.")}
              </p>
              <p className={s.note}>
                Run <code>{run.runId}</code> · owner <code>{run.owner}</code>
              </p>
              {pollError && (
                <>
                  <p className={s.note}>
                    Run status is temporarily unavailable. The local process may
                    still be running.
                  </p>
                  <button
                    type="button"
                    className={s.secondary}
                    onClick={() => setPollAttempt((attempt) => attempt + 1)}
                  >
                    Retry status check
                  </button>
                </>
              )}
              {completeReportUrl && (
                <a
                  className={s.reportLink}
                  href={completeReportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open standalone report{" "}
                  <ArrowUpRight size={15} aria-hidden="true" />
                </a>
              )}
            </div>
          )}
          <details className={`${s.details} ${s.localInstructions}`}>
            <summary>Local workflow and downloadable evidence</summary>
            <p>
              Download the complete plan above. The local runner requires the
              repository, Node.js, Foundry and an Arbitrum RPC. A downloaded
              plan keeps its original expiry.
            </p>
            <pre>
              {
                'cd integrations/aqua\npnpm install --frozen-lockfile\nNORIA_PLAN_FILE="/path/to/download.json" pnpm fork:rehearse'
              }
            </pre>
            <p className={s.note}>
              Replace the path with your downloaded plan. The runner uses its
              collateral, health limits, selected range and inventory, then
              rechecks the evidence before executing locally.
            </p>
            <a
              className={s.poolLink}
              href="https://github.com/0xmvercosa/noria/blob/main/docs/1inch/rehearsal.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the local rehearsal guide{" "}
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </details>
        </section>
      </main>
    </div>
  );
}

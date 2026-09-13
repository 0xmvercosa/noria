"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { NoriaLogo } from "./NoriaLogo";
import {
  AQUA_REQUEST_EXAMPLE,
  AquaRequestSchema,
  type AquaRequest,
  type AquaResponse,
} from "../integrations/aqua/contract";
import { usd, number } from "./format";
import base from "./NoriaApp.module.css";
import s from "./AquaWorkbench.module.css";

export function AquaWorkbench() {
  const [amount, setAmount] = useState("1000");
  const [objective, setObjective] =
    useState<AquaRequest["objective"]>("earn-fees");
  const [hours, setHours] = useState<6 | 24>(6);
  const [discount, setDiscount] = useState("100");
  const [response, setResponse] = useState<AquaResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      pending.current?.abort();
    };
  }, []);
  function clear() {
    pending.current?.abort();
    setLoading(false);
    setResponse(null);
    setError(null);
  }
  let draft: AquaRequest | null = null;
  if (/^\d{1,6}(\.\d{1,6})?$/.test(amount)) {
    const [whole, fraction = ""] = amount.split(".");
    const amountRaw = (
      BigInt(whole) * 1_000_000n +
      BigInt(fraction.padEnd(6, "0"))
    ).toString();
    const parsed = AquaRequestSchema.safeParse({
      ...AQUA_REQUEST_EXAMPLE,
      funding: { ...AQUA_REQUEST_EXAMPLE.funding, amountRaw },
      objective,
      reviewAfterHours: hours,
      ...(objective === "buy-eth" ? { discountBps: Number(discount) } : {}),
    });
    if (parsed.success) draft = parsed.data;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    clear();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    try {
      const request = { ...draft, requestId: `preview-${crypto.randomUUID()}` };
      const result = await fetch("/api/aqua/v1/recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const body = await result.json();
      if (!result.ok)
        throw new Error(
          body.message ??
            body.issues?.[0]?.message ??
            "The analysis could not be completed.",
        );
      if (
        body.schemaVersion !== "noria.aqua.v1" ||
        !["recommended", "no-recommendation"].includes(body.status)
      )
        throw new Error("The server returned an unsupported response.");
      if (!controller.signal.aborted) setResponse(body);
    } catch (failure) {
      if (!controller.signal.aborted)
        setError(
          failure instanceof Error ? failure.message : "Analysis unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  const rec = response?.recommendation;
  const expired = rec ? now >= Date.parse(rec.validUntil) : false;
  return (
    <div className={base.app}>
      <header className={base.header}>
        <a href="/" className={base.brand} aria-label="Noria home">
          <NoriaLogo className={base.brandLogo} />
        </a>
        <nav className={base.navigation} aria-label="Aqua navigation">
          <a href="/">Full discovery</a>
          <a href="/aqua/openapi.json">API specification</a>
        </nav>
        <span className={base.chainBadge}>Arbitrum · WETH / USDC</span>
      </header>
      <main className={s.main}>
        <section className={s.hero}>
          <span className={s.eyebrow}>Noria × Aqua · reference strategy</span>
          <h1>
            A range for your
            <br />
            <span>next move.</span>
          </h1>
          <p>
            Start with USDC. Noria searches The Graph for an Arbitrum WETH/USDC
            reference pool, checks the range and returns the inventory your Aqua
            system will need to prepare.
          </p>
          <p className={s.note}>
            This preview uses native USDC. Aqua execution and Aave debt
            management are developed separately.
          </p>
        </section>
        <div className={s.workspace}>
          <form className={s.panel} onSubmit={submit}>
            <span className={s.eyebrow}>01 · Your intent</span>
            <h2>Fund the strategy</h2>
            <label>
              Available USDC
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  clear();
                  setAmount(e.target.value);
                }}
              />
            </label>
            <p className={s.note}>
              1–100,000 USDC. Budget for target inventory; operating costs are
              accounted for separately.
            </p>
            <label>
              Objective
              <select
                value={objective}
                onChange={(e) => {
                  clear();
                  setObjective(e.target.value as AquaRequest["objective"]);
                }}
              >
                <option value="earn-fees">Earn fees</option>
                <option value="buy-eth">Buy ETH below spot</option>
              </select>
            </label>
            <label>
              Review after
              <select
                value={hours}
                onChange={(e) => {
                  clear();
                  setHours(Number(e.target.value) as 6 | 24);
                }}
              >
                <option value="6">6 hours</option>
                <option value="24">24 hours</option>
              </select>
            </label>
            {objective === "buy-eth" && (
              <label>
                Discount target (bps)
                <input
                  inputMode="numeric"
                  value={discount}
                  onChange={(e) => {
                    clear();
                    setDiscount(e.target.value);
                  }}
                />
              </label>
            )}
            <button type="submit" disabled={!draft || loading}>
              {loading
                ? "Checking pools and ranges…"
                : "Find a reference strategy"}
            </button>
            {loading && (
              <button type="button" className={s.secondary} onClick={clear}>
                Cancel
              </button>
            )}
            <p className={s.note}>
              The review interval is a management prompt. It does not predict
              fees or trigger execution.
            </p>
          </form>
          <section className={s.panel} aria-live="polite">
            <span className={s.eyebrow}>02 · Inspect the handoff</span>
            {!response && !error && (
              <>
                <h2>
                  {loading
                    ? "Following the evidence"
                    : "Your pool comes from the search"}
                </h2>
                <p>
                  Exact token contracts → recurring flow → canonical pool state
                  → range capacity → target inventory.
                </p>
                <p className={s.note}>
                  No pool is preselected. The highest-ranked passing reference
                  is returned; profitability remains unestablished.
                </p>
              </>
            )}
            {error && (
              <div role="alert">
                <h2>Analysis unavailable</h2>
                <p>{error}</p>
                <p className={s.note}>
                  Retry when sources are available. No saved result replaces a
                  live response.
                </p>
              </div>
            )}
            {response && !rec && (
              <>
                <h2>No reference strategy recommended</h2>
                <p>{response.selection.discovery.selectedReason}</p>
              </>
            )}
            {rec && (
              <>
                <h2>
                  WETH / USDC{" "}
                  <span className={s.fee}>
                    {number(rec.referencePool.feeTier / 10000, 2)}%
                  </span>
                </h2>
                <p className={s.status}>
                  {expired
                    ? "Evidence expired · refresh the analysis"
                    : `Range ${rec.range.location} · ${rec.report.checks.construction}`}
                </p>
                <div className={s.range}>
                  <span>{number(rec.range.lower, 2)}</span>
                  <i />
                  <span>{number(rec.range.upper, 2)}</span>
                </div>
                <p className={s.note}>
                  USDC per WETH · spot {number(rec.range.spot, 2)}
                </p>
                <dl className={s.metrics}>
                  <div>
                    <dt>Target WETH</dt>
                    <dd>{rec.report.position.amount0}</dd>
                  </div>
                  <div>
                    <dt>Target USDC</dt>
                    <dd>{rec.report.position.amount1}</dd>
                  </div>
                  <div>
                    <dt>Inventory value</dt>
                    <dd>{usd(rec.targetInventory.valuationUsd)}</dd>
                  </div>
                  <div>
                    <dt>Maximum reference share</dt>
                    <dd>{number(rec.report.position.maxSharePercent, 3)}%</dd>
                  </div>
                </dl>
                <p className={s.note}>
                  {rec.funding.inventoryPreparationRequired
                    ? "A USDC → WETH preparation swap must be quoted by the Aqua system."
                    : "This range initially requires USDC only."}{" "}
                  {rec.range.location === "waiting"
                    ? "No swap fees accrue before price enters the range."
                    : "Current activity does not guarantee future fills."}
                </p>
                <a
                  className={s.poolLink}
                  href={rec.report.pool.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Inspect reference pool ↗
                </a>
                <p className={s.note}>
                  {rec.report.source.provider} · block{" "}
                  {rec.report.source.blockNumber.toLocaleString("en-US")} ·
                  expires {new Date(rec.validUntil).toISOString()}
                </p>
                <p className={s.note}>
                  Aqua strategy mapping, executable quotes and borrowing checks
                  remain with the calling system. The Uniswap reference gas
                  estimate is not an Aqua cost estimate.
                </p>
              </>
            )}
            {response && (
              <details className={s.details}>
                <summary>Selection, exclusions and complete response</summary>
                <pre>{JSON.stringify(response, null, 2)}</pre>
              </details>
            )}
          </section>
        </div>
        <details className={`${s.panel} ${s.contract}`}>
          <summary>For the Aqua integrator · request contract</summary>
          <p>
            POST this intent to <code>/api/aqua/v1/recommendation</code>. Token
            quantities are integer strings in raw units. No wallet credentials
            are required.
          </p>
          <pre>{JSON.stringify(draft ?? AQUA_REQUEST_EXAMPLE, null, 2)}</pre>
          <a href="https://github.com/0xmvercosa/noria/blob/main/docs/aqua-integration.md">
            Read the integration guide ↗
          </a>
        </details>
      </main>
    </div>
  );
}

"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { formatUnits } from "viem";
import {
  EthUsdResponseSchema,
  ethUsdFreshness,
  ethUsdSuffix,
  type UsdReference,
} from "../domain/eth-usd";
import {
  PRICE_MARK_FRESH_AGE_SECONDS,
  PRICE_MARK_MAX_AGE_SECONDS,
} from "../domain/price-mark";
import s from "./EthUsd.module.css";

const Context = createContext<{
  reference: UsdReference | null;
  loading: boolean;
  now: number;
}>({
  reference: null,
  loading: true,
  now: 0,
});

/** Read-only valuation state is independent of Privy authentication and signing. */
export function EthUsdProvider({ children }: { children: ReactNode }) {
  const [reference, setReference] = useState<UsdReference | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    let busy = false;
    let controller: AbortController | null = null;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 25_000);
      try {
        const response = await fetch("/api/market/eth-usd", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("ETH reference unavailable");
        const data = EthUsdResponseSchema.parse(await response.json());
        if (alive)
          setReference(data.status === "available" ? data.reference : null);
      } catch {
        /* Retain a previous quote only until its original expiry. */
      } finally {
        window.clearTimeout(timeout);
        busy = false;
        if (alive) {
          setLoading(false);
          setNow(Math.floor(Date.now() / 1000));
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
      if (document.visibilityState === "visible") void refresh();
    }, 60_000);
    const visible = () => {
      setNow(Math.floor(Date.now() / 1000));
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      alive = false;
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    if (!reference) return;
    const timers = [
      PRICE_MARK_FRESH_AGE_SECONDS,
      PRICE_MARK_MAX_AGE_SECONDS,
    ].map((limit) =>
      window.setTimeout(
        () => setNow(Math.floor(Date.now() / 1000)),
        Math.max(0, (reference.timestamp + limit + 1) * 1000 - Date.now()),
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [reference]);
  return (
    <Context.Provider value={{ reference, loading, now }}>
      {children}
    </Context.Provider>
  );
}

export function useEthUsd() {
  const context = useContext(Context);
  const freshness = ethUsdFreshness(
    context.reference,
    Math.floor(Date.now() / 1000),
  );
  const reference = freshness === "unavailable" ? null : context.reference;
  return {
    ...context,
    reference,
    freshness,
    suffix: (amount: string) =>
      ethUsdSuffix(
        amount,
        ethUsdFreshness(context.reference, Math.floor(Date.now() / 1000)) ===
          "unavailable"
          ? null
          : context.reference,
        context.loading,
      ),
  };
}

export function EthUsdEquivalent({
  amount,
  reference: recorded,
}: {
  amount: string;
  reference?: UsdReference | null;
}) {
  const current = useEthUsd();
  const reference = recorded === undefined ? current.reference : recorded;
  const title = reference
    ? `Approximate USD at ${recorded === undefined ? "the latest available reference" : "the recorded source price"}: ${reference.provider}, ${new Date(reference.timestamp * 1000).toISOString()}.`
    : "An ETH/USD reference is unavailable; the token amount is unchanged.";
  return (
    <span
      className={s.equivalent}
      title={title}
      data-usd-basis={recorded === undefined ? "current" : "recorded"}
    >
      {ethUsdSuffix(
        amount,
        reference,
        recorded === undefined && current.loading,
      )}
    </span>
  );
}

export function EthAmount({
  wei,
  symbol = "ETH",
  reference,
}: {
  wei: string;
  symbol?: "ETH" | "WETH" | "aWETH";
  reference?: UsdReference | null;
}) {
  const amount = formatUnits(BigInt(wei), 18);
  return (
    <>
      {amount} {symbol}{" "}
      <EthUsdEquivalent amount={amount} reference={reference} />
    </>
  );
}

export function EthUsdNote() {
  const { reference, loading, freshness } = useEthUsd();
  return (
    <p className={s.note}>
      {reference ? (
        <>
          ETH/WETH dollar estimates: {reference.provider},{" "}
          {new Date(reference.timestamp * 1000)
            .toISOString()
            .replace("T", " ")
            .replace(".000Z", " UTC")}
          .{freshness === "aged" && " This reference is over five minutes old."}{" "}
          Past transaction amounts use this reference, not a transaction-time
          USD price. Plans retain their recorded source prices.
        </>
      ) : loading ? (
        "Loading ETH/USD reference…"
      ) : (
        "ETH/USD reference unavailable. Token amounts and wallet actions remain available."
      )}
    </p>
  );
}

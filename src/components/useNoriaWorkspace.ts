"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AnalyzeInput,
  DiscoverInput,
  DiscoveryResult,
  HistoricalCase,
  Intent,
  LiveReport,
  NetworkId,
  PoolCandidate,
} from "../domain/types";
import { priceReferenceState } from "./format";

export const NETWORK_CHOICES: { id: NetworkId; label: string }[] = [
  { id: "ethereum", label: "Ethereum" },
  { id: "base", label: "Base" },
  { id: "arbitrum", label: "Arbitrum" },
  { id: "unichain", label: "Unichain" },
];
type NetworkAvailability = {
  id: NetworkId;
  label: string;
  available: boolean;
  reason?: string;
};
type PoolSearchResult = DiscoveryResult["discovery"];

export function useNoriaWorkspace() {
  const [network, setNetwork] = useState<NetworkId>("ethereum");
  const [networks, setNetworks] = useState<NetworkAvailability[]>([]);
  const [networkLoading, setNetworkLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkAttempt, setNetworkAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedPool, setSelectedPool] = useState<PoolCandidate | null>(null);
  const [discovery, setDiscovery] = useState<
    DiscoveryResult["discovery"] | null
  >(null);
  const [searchResult, setSearchResult] = useState<PoolSearchResult | null>(
    null,
  );
  const [searchDetailsOpen, setSearchDetailsOpen] = useState(true);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [analysisContext, setAnalysisContext] = useState<
    (DiscoverInput & { query: string; manual: boolean }) | null
  >(null);
  const [capital, setCapital] = useState<AnalyzeInput["capitalUsd"]>(5000);
  const [intent, setIntent] = useState<Intent>("earn-fees");
  const [horizon, setHorizon] = useState<AnalyzeInput["horizonHours"]>(24);
  const [discount, setDiscount] = useState("250");
  const [report, setReport] = useState<LiveReport | null>(null);
  const [reportDiscovery, setReportDiscovery] = useState<
    DiscoveryResult["discovery"] | null
  >(null);
  const [reportIsPrevious, setReportIsPrevious] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveErrorCode, setLiveErrorCode] = useState<string | null>(null);
  const [historical, setHistorical] = useState<HistoricalCase | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const liveRequest = useRef<AbortController | null>(null);
  const poolRequest = useRef<AbortController | null>(null);
  const queryInput = useRef<HTMLInputElement | null>(null);
  const planPanel = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearInterval(timer);
      liveRequest.current?.abort();
      poolRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setNetworkLoading(true);
    setNetworkError(null);
    async function loadNetworks() {
      try {
        const response = await fetch("/api/noria?view=networks", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || body.error)
          throw new Error(
            body.error || "Network availability could not be loaded.",
          );
        if (!Array.isArray(body.networks))
          throw new Error("The server did not return network availability.");
        setNetworks(body.networks);
      } catch (error) {
        if (!controller.signal.aborted)
          setNetworkError(
            error instanceof Error
              ? error.message
              : "Network availability could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setNetworkLoading(false);
      }
    }
    void loadNetworks();
    return () => controller.abort();
  }, [networkAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    setHistoryError(null);
    async function loadHistorical() {
      try {
        const response = await fetch("/api/noria", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || body.error)
          throw new Error(
            body.error || "The historical evidence could not be loaded.",
          );
        if (body.classification !== "historical-simulation")
          throw new Error(
            "The server did not return a historical evidence bundle.",
          );
        setHistorical(body as HistoricalCase);
      } catch (error) {
        if (!controller.signal.aborted)
          setHistoryError(
            error instanceof Error
              ? error.message
              : "The historical evidence could not be loaded.",
          );
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistorical();
    return () => controller.abort();
  }, [historyAttempt]);

  useEffect(() => {
    if (!analyzing && report && analysisContext?.manual && !reportIsPrevious) {
      planPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      planPanel.current?.focus({ preventScroll: true });
    }
  }, [analyzing, report, analysisContext, reportIsPrevious]);

  const discountNumber = Number(discount);
  const discountValid =
    Number.isFinite(discountNumber) &&
    Number.isInteger(discountNumber) &&
    discountNumber >= 25 &&
    discountNumber <= 1000;
  const selectedNetwork = networks.find((item) => item.id === network);
  const networkLabel =
    selectedNetwork?.label ??
    NETWORK_CHOICES.find((item) => item.id === network)!.label;
  const inputsValid =
    selectedNetwork?.available === true &&
    (intent === "earn-fees" || discountValid);
  const searchAvailable =
    selectedNetwork?.available === true && !networkLoading && !networkError;
  const currentReport = reportIsPrevious ? null : report;
  const liveErrorHeading =
    liveErrorCode === "incomplete-history"
      ? "This pool needs more history"
      : "Live analysis could not be verified";
  const expired = report
    ? !Number.isFinite(Date.parse(report.validUntil)) ||
      now >= Date.parse(report.validUntil) ||
      report.checks.data === "expired"
    : false;
  const dataVerified = Boolean(
    currentReport &&
      currentReport.checks.data === "verified" &&
      currentReport.source.rpcMatched &&
      !expired,
  );
  const priceState = report ? priceReferenceState(report, now) : null;
  const priceCaveat = Boolean(priceState && priceState.freshness !== "fresh");
  const secondsLeft = report
    ? Math.max(0, Math.ceil((Date.parse(report.validUntil) - now) / 1000))
    : 0;
  const inputsChanged = Boolean(
    analysisContext &&
      (report || discovery) &&
      (analysisContext.capitalUsd !== capital ||
        analysisContext.intent !== intent ||
        analysisContext.horizonHours !== horizon ||
        analysisContext.network !== network ||
        (intent === "buy-token0" &&
          analysisContext.discountBps !== discountNumber) ||
        (!analysisContext.manual && analysisContext.query !== query.trim())),
  );

  function changeNetwork(nextNetwork: NetworkId) {
    liveRequest.current?.abort();
    poolRequest.current?.abort();
    setNetwork(nextNetwork);
    setReport(null);
    setReportDiscovery(null);
    setReportIsPrevious(false);
    setDiscovery(null);
    setSearchResult(null);
    setSearchDetailsOpen(true);
    setSelectedPool(null);
    setAnalysisContext(null);
    setAnalyzing(false);
    setSearching(false);
    setLiveError(null);
    setLiveErrorCode(null);
    setSearchError(null);
  }

  // A preference edit cancels the old search so late responses cannot restore stale candidates.
  function changeQuery(value: string) {
    poolRequest.current?.abort();
    setSearching(false);
    setSearchResult(null);
    setSearchError(null);
    setQuery(value);
  }

  function reviewSearchInputs() {
    queryInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    queryInput.current?.focus({ preventScroll: true });
  }

  async function searchPools() {
    if (
      !selectedNetwork?.available ||
      networkLoading ||
      networkError ||
      searching ||
      analyzing
    )
      return;
    const controller = new AbortController();
    poolRequest.current?.abort();
    poolRequest.current = controller;
    setSearching(true);
    setSearchError(null);
    setSearchResult(null);
    setSearchDetailsOpen(true);
    try {
      const params = new URLSearchParams({
        view: "pools",
        network,
        q: query.trim(),
      });
      const response = await fetch(`/api/noria?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || body.error)
        throw new Error(body.error || "Pool search is currently unavailable.");
      if (
        !Array.isArray(body.pools) ||
        !Array.isArray(body.limitations) ||
        !Array.isArray(body.rejected) ||
        !Number.isSafeInteger(body.considered) ||
        body.considered < 0 ||
        typeof body.selectedReason !== "string"
      )
        throw new Error("The server did not return pool search evidence.");
      if (body.network !== network)
        throw new Error("The pool search did not match the selected network.");
      if (!controller.signal.aborted) setSearchResult(body as PoolSearchResult);
    } catch (error) {
      if (!controller.signal.aborted)
        setSearchError(
          error instanceof Error
            ? error.message
            : "Pool search is currently unavailable.",
        );
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  }

  async function analyze(pool?: PoolCandidate, candidates?: PoolSearchResult) {
    if (!inputsValid || networkLoading || networkError || analyzing) return;
    if (pool && pool.network !== network) return;
    const controller = new AbortController();
    liveRequest.current?.abort();
    poolRequest.current?.abort();
    liveRequest.current = controller;
    setAnalyzing(true);
    setSearching(false);
    setLiveError(null);
    setLiveErrorCode(null);
    setSearchError(null);
    // Keep the previous report paired with its original discovery evidence until a replacement succeeds.
    // A refusal or failed request must never refresh the displayed report or its source timestamps.
    setReportIsPrevious(Boolean(report));
    setDiscovery(null);
    setSelectedPool(pool ?? null);
    setAnalysisContext(null);
    if (pool && candidates) {
      setSearchResult(candidates);
      setSearchDetailsOpen(true);
    } else if (!pool) setSearchResult(null);
    const common = {
      network,
      capitalUsd: capital,
      intent,
      horizonHours: horizon,
      ...(intent === "buy-token0" ? { discountBps: discountNumber } : {}),
    };
    const input: AnalyzeInput | DiscoverInput = pool
      ? { ...common, poolAddress: pool.address }
      : { ...common, ...(query.trim() ? { query: query.trim() } : {}) };
    try {
      const response = await fetch(
        pool ? "/api/noria" : "/api/noria?view=discover",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          cache: "no-store",
          signal: controller.signal,
        },
      );
      const body = await response.json();
      if (!response.ok || body.error) {
        if (!controller.signal.aborted)
          setLiveErrorCode(typeof body.code === "string" ? body.code : null);
        throw new Error(
          body.error || "The live analysis could not be completed.",
        );
      }
      const nextReport: LiveReport | null = pool ? body : body.report;
      if (
        !pool &&
        (!body.discovery ||
          !Array.isArray(body.discovery.pools) ||
          !Array.isArray(body.discovery.limitations) ||
          !Array.isArray(body.discovery.rejected))
      )
        throw new Error("The server did not return discovery evidence.");
      if (!pool && body.discovery.network !== network)
        throw new Error("The discovery did not match the selected network.");
      if (
        nextReport !== null &&
        nextReport?.classification !== "live-construction-analysis"
      )
        throw new Error("The server did not return a live position analysis.");
      if (
        nextReport &&
        (nextReport.pool.network !== network ||
          (pool &&
            nextReport.pool.address.toLowerCase() !==
              pool.address.toLowerCase()))
      )
        throw new Error(
          "The response did not match the selected network and pool.",
        );
      // Network changes and replacement requests invalidate all result commits from this request.
      if (controller.signal.aborted) return;
      if (nextReport) {
        setReport(nextReport);
        setReportDiscovery(pool ? null : body.discovery);
        setReportIsPrevious(false);
        if (pool) setSearchDetailsOpen(false);
      }
      if (!pool) {
        const result = body as DiscoveryResult;
        setDiscovery(result.discovery);
        setSelectedPool(
          result.discovery.pools.find(
            (candidate) =>
              candidate.address.toLowerCase() ===
              nextReport?.pool.address.toLowerCase(),
          ) ?? null,
        );
      }
      setAnalysisContext({
        ...common,
        query: query.trim(),
        manual: Boolean(pool),
      });
      setNow(Date.now());
    } catch (error) {
      if (!controller.signal.aborted) {
        setLiveError(
          error instanceof Error
            ? error.message
            : "The live analysis could not be completed.",
        );
        if (pool) setSearchDetailsOpen(true);
      }
    } finally {
      if (!controller.signal.aborted) setAnalyzing(false);
    }
  }

  return {
    network,
    networks,
    networkLoading,
    networkError,
    networkLabel,
    selectedNetwork,
    retryNetworks: () => setNetworkAttempt((value) => value + 1),
    query,
    selectedPool,
    discovery,
    searchResult,
    searchDetailsOpen,
    setSearchDetailsOpen,
    searching,
    searchError,
    analysisContext,
    capital,
    setCapital,
    intent,
    setIntent,
    horizon,
    setHorizon,
    discount,
    setDiscount,
    report,
    reportDiscovery,
    reportIsPrevious,
    analyzing,
    liveError,
    liveErrorCode,
    historical,
    historyLoading,
    historyError,
    retryHistory: () => setHistoryAttempt((value) => value + 1),
    queryInput,
    planPanel,
    discountNumber,
    discountValid,
    inputsValid,
    searchAvailable,
    currentReport,
    liveErrorHeading,
    expired,
    dataVerified,
    priceState,
    priceCaveat,
    secondsLeft,
    inputsChanged,
    changeNetwork,
    changeQuery,
    reviewSearchInputs,
    searchPools,
    analyze,
  };
}

export type NoriaWorkspace = ReturnType<typeof useNoriaWorkspace>;

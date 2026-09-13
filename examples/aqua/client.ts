import type {
  AquaRequest,
  AquaResponse,
} from "../../src/integrations/aqua/contract";

/** Call from the Aqua backend. This example requests information, never transactions. */
export async function requestNoriaReference(
  origin: string,
  intent: AquaRequest,
  signal: AbortSignal = AbortSignal.timeout(180_000),
): Promise<AquaResponse> {
  const response = await fetch(new URL("/api/aqua/v1/recommendation", origin), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
    signal,
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      `${result.code ?? response.status}: ${result.message ?? "Check input or provider availability"}; Retry-After=${response.headers.get("retry-after") ?? "none"}`,
    );
  if (
    result.schemaVersion !== "noria.aqua.v1" ||
    result.requestId !== intent.requestId ||
    result.scope?.chainId !== 42161 ||
    !["recommended", "no-recommendation"].includes(result.status)
  )
    throw new Error("Unexpected Noria response identity or version.");
  if (result.status === "recommended") {
    const expires = Date.parse(result.recommendation?.validUntil);
    if (!Number.isFinite(expires) || Date.now() >= expires)
      throw new Error(
        "Reference expired; request fresh evidence before planning.",
      );
  }
  return result as AquaResponse;
}

// Example caller:
// const result = await requestNoriaReference(process.env.NORIA_ORIGIN!, request);
// if (result.status === "no-recommendation") showExclusions(result.selection);
// else showReferenceForReview(result.recommendation);
// Next: implement Aqua-specific quoting/strategy validation and separate Aave
// health checks. Do not pass referencePool or range ticks to a transaction API.

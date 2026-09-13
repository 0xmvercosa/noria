import {
  CandidateBundleSchema,
  DiscoveryRequestSchema,
  type DiscoveryRequest,
} from "./boundary.js";

/** Optional boundary to the separately implemented The Graph service. No wallet actions. */
export async function requestCandidates(
  endpoint: string,
  request: DiscoveryRequest,
  signal?: AbortSignal,
) {
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("invalid_discovery_endpoint");
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(DiscoveryRequestSchema.parse(request)),
    signal: signal ?? AbortSignal.timeout(15_000),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`discovery_http_${response.status}`);
  if (!response.body) throw new Error("discovery_empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("discovery_response_too_large");
    }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  const parsed = CandidateBundleSchema.parse(JSON.parse(body));
  if (parsed.requestId !== request.requestId)
    throw new Error("request_id_mismatch");
  return parsed;
}

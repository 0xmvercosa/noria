import { CandidateBundleSchema, DiscoveryRequestSchema, type DiscoveryRequest } from './boundary.js';

/** Optional boundary to the separately implemented The Graph service. No wallet actions. */
export async function requestCandidates(endpoint: string, request: DiscoveryRequest, signal?: AbortSignal) {
  const url = new URL(endpoint);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('invalid_discovery_endpoint');
  const response = await fetch(url, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(DiscoveryRequestSchema.parse(request)),
    signal: signal ?? AbortSignal.timeout(15_000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error(`discovery_http_${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > 2_000_000) throw new Error('discovery_response_too_large');
  const parsed = CandidateBundleSchema.parse(JSON.parse(body));
  if (parsed.requestId !== request.requestId) throw new Error('request_id_mismatch');
  return parsed;
}


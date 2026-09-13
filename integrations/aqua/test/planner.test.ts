import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAquaPosition } from "../src/planner.js";
import {
  createDiscoveryRequest,
  type CanonicalEvidence,
} from "../src/boundary.js";

const load = (path: string) =>
  JSON.parse(
    readFileSync(new URL("../examples/" + path, import.meta.url), "utf8"),
  );
const initialRequest = load("discovery-request.json");
const initialBundle = load("discovery-response.json");
const initialEvidence = load(
  "canonical-evidence.synthetic.json",
) as CanonicalEvidence[];
const now = new Date(initialRequest.createdAt);
const fresh = () => ({
  request: structuredClone(initialRequest),
  bundle: structuredClone(initialBundle),
  evidence: structuredClone(initialEvidence),
});
test("Aqua initiates a constrained information request; examples remain simulation-only", () => {
  const request = createDiscoveryRequest("8000000000", "request-1", now);
  assert.equal(request.chainId, 42161);
  const plan = planAquaPosition(
    initialRequest,
    initialBundle,
    initialEvidence,
    now,
  );
  assert.equal(plan.status, "simulation_only");
  assert.equal(plan.selectedCandidateId, "example-range-balanced");
  assert.equal(plan.assessments[0]?.historicalScorePpm, "950");
  assert.equal(plan.routingStatus, "not_validated");
});
test("strict boundary rejects other chains and unknown executable data", () => {
  const { request, bundle, evidence } = fresh();
  request.chainId = 1;
  assert.throws(() => planAquaPosition(request, bundle, evidence, now));
  request.chainId = 42161;
  bundle.candidates[0].calldata = "0xdeadbeef";
  assert.throws(() => planAquaPosition(request, bundle, evidence, now));
});
test("no canonical evidence, stale data and counterfeit factory pool refuse candidacy", () => {
  const { request, bundle, evidence } = fresh();
  assert.equal(planAquaPosition(request, bundle, [], now).status, "refused");
  evidence[0]!.canonicalFactoryPool = false;
  assert.equal(
    planAquaPosition(request, bundle, evidence, now).status,
    "refused",
  );
  evidence[0]!.canonicalFactoryPool = true;
  bundle.candidates[0].source.indexedBlock.timestamp =
    "2026-01-01T00:00:00.000Z";
  assert.equal(
    planAquaPosition(request, bundle, evidence, now).status,
    "refused",
  );
});
test("low capacity, price divergence and an out-of-range proposal are explicit refusals", () => {
  const { request, bundle, evidence } = fresh();
  bundle.candidates[0].sourcePool.tvlUSDCUnits = "10000";
  bundle.candidates[0].range.lowerUSDCPerWethE6 = "4000000000";
  bundle.candidates[0].sourcePool.spotUSDCPerWethE6 = "2000000000";
  const plan = planAquaPosition(request, bundle, evidence, now);
  assert.equal(plan.status, "refused");
  assert.ok(
    plan.assessments[0]?.reasons.includes(
      "capital_exceeds_source_capacity_proxy",
    ),
  );
  assert.ok(
    plan.assessments[0]?.reasons.includes("source_price_diverged_over_1pct"),
  );
  assert.ok(
    plan.assessments[0]?.reasons.includes("range_does_not_contain_spot"),
  );
});
test("historical range coverage participates in selection and is not a forecast", () => {
  const { request, bundle, evidence } = fresh();
  const second = structuredClone(bundle.candidates[0]);
  second.candidateId = "lower-coverage";
  second.range.inRangeObservations = 85;
  bundle.candidates.unshift(second);
  assert.equal(
    planAquaPosition(request, bundle, evidence, now).selectedCandidateId,
    "example-range-balanced",
  );
});
test("replayed/expired requests and duplicate candidates do not produce a plan", () => {
  const { request, bundle, evidence } = fresh();
  bundle.requestId = "wrong";
  assert.throws(
    () => planAquaPosition(request, bundle, evidence, now),
    /request_id/,
  );
  bundle.requestId = request.requestId;
  bundle.candidates.push(structuredClone(bundle.candidates[0]));
  assert.throws(
    () => planAquaPosition(request, bundle, evidence, now),
    /duplicate/,
  );
  assert.throws(
    () =>
      planAquaPosition(
        request,
        initialBundle,
        evidence,
        new Date("2026-09-14T00:00:00Z"),
      ),
    /expired/,
  );
});

test("block hashes, observation count and fresh range evidence are mandatory", () => {
  const { request, bundle, evidence } = fresh();
  bundle.candidates[0].range.totalObservations = 1;
  bundle.candidates[0].range.inRangeObservations = 1;
  bundle.candidates[0].range.windowEnd = "2026-09-12T12:00:00.000Z";
  evidence[0]!.blockHash = "0x" + "f".repeat(64);
  const decision = planAquaPosition(request, bundle, evidence, now);
  assert.equal(decision.status, "refused");
  for (const reason of [
    "indexed_block_not_bound_to_rpc",
    "insufficient_observation_count",
    "stale_observation_window",
  ])
    assert.ok(decision.assessments[0]!.reasons.includes(reason));
});

import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmResearchReview } from "../.test-dist/domain/algorithmResearchReview.js";

function reviewInput(overrides = {}) {
  return {
    midstateReady: true,
    hasMeasuredLocalPower: false,
    networkTelemetryReady: false,
    externalEfficiencyReady: false,
    searchSpaceReady: false,
    externalWorkAssignable: false,
    directProtocolSelected: false,
    researchReviewedAt: "2026-07-02",
    ...overrides,
  };
}

function idea(review, id) {
  const item = review.ideas.find((candidate) => candidate.id === id);
  assert.ok(item, `missing idea ${id}`);
  return item;
}

function freshness(review, id) {
  const item = review.safetyEnvelope.sourceFreshness.find((candidate) => candidate.sourceId === id);
  assert.ok(item, `missing freshness ${id}`);
  return item;
}

test("algorithm research review keeps consensus-safe optimizations separate from rejected shortcuts", () => {
  const review = deriveAlgorithmResearchReview(reviewInput());

  assert.equal(idea(review, "consensus_sha256").status, "production");
  assert.equal(idea(review, "midstate_reuse").status, "production");
  assert.equal(idea(review, "midstate_reuse").deploymentLane, "runtime");
  assert.equal(idea(review, "predictive_nonce_pruning").status, "rejected");
  assert.equal(idea(review, "proof_of_work_compression").status, "rejected");
  assert.deepEqual(review.rejectedIdeaIds, ["predictive_nonce_pruning", "proof_of_work_compression"]);
  assert.deepEqual(review.decisionOnlyIdeaIds, ["quantum_sha256_mining", "market_roi_prediction"]);
  assert.equal(idea(review, "thermodynamic_asic_prediction").status, "experiment");
  assert.equal(idea(review, "thermodynamic_asic_prediction").routeable, false);
  assert.equal(idea(review, "thermodynamic_asic_prediction").deploymentLane, "offline");
  assert.match(idea(review, "thermodynamic_asic_prediction").nextStep, /never prune nonce ranges/i);
  assert.equal(idea(review, "quantum_sha256_mining").status, "decision-only");
  assert.equal(idea(review, "quantum_sha256_mining").routeable, false);
  assert.equal(idea(review, "quantum_sha256_mining").deploymentLane, "decision");
  assert.match(idea(review, "quantum_sha256_mining").summary, /not a deployable low-power miner/i);
});

test("algorithm research review promotes high-hash ideas only after search-space and work evidence", () => {
  const waiting = deriveAlgorithmResearchReview(reviewInput({ networkTelemetryReady: true }));
  const ready = deriveAlgorithmResearchReview(reviewInput({
    hasMeasuredLocalPower: true,
    networkTelemetryReady: true,
    externalEfficiencyReady: true,
    searchSpaceReady: true,
    externalWorkAssignable: true,
  }));

  assert.equal(idea(waiting, "version_rolling_asicboost").status, "experiment");
  assert.equal(idea(waiting, "version_rolling_asicboost").routeable, false);
  assert.equal(idea(waiting, "version_rolling_asicboost").deploymentLane, "offline");
  assert.equal(idea(ready, "version_rolling_asicboost").status, "dry-run");
  assert.equal(idea(ready, "version_rolling_asicboost").routeable, true);
  assert.equal(idea(ready, "version_rolling_asicboost").deploymentLane, "dry_run");
  assert.equal(idea(ready, "stratum_v2_extended_jobs").status, "dry-run");
  assert.equal(idea(ready, "stratum_v2_extended_jobs").routeable, true);
  assert.equal(idea(ready, "stratum_v2_extended_jobs").deploymentLane, "dry_run");
  assert.equal(ready.primaryExperimentIdea?.id, "stratum_v2_extended_jobs");
  assert.ok(ready.productionIdeaIds.includes("telemetry_power_tuning"));
  assert.equal(ready.productionIdeaIds.includes("version_rolling_asicboost"), false);
  assert.ok(ready.dryRunIdeaIds.includes("version_rolling_asicboost"));
});
test("algorithm research review separates runtime tuning from telemetry-only hardware ideas", () => {
  const local = deriveAlgorithmResearchReview(reviewInput({ hasMeasuredLocalPower: true }));
  const networkOnly = deriveAlgorithmResearchReview(reviewInput({ networkTelemetryReady: true }));

  assert.equal(idea(local, "telemetry_power_tuning").deploymentLane, "runtime");
  assert.ok(local.runtimeIdeaIds.includes("telemetry_power_tuning"));
  assert.equal(idea(networkOnly, "telemetry_power_tuning").deploymentLane, "telemetry");
  assert.equal(idea(networkOnly, "external_asic_autotune").deploymentLane, "telemetry");
  assert.ok(networkOnly.telemetryIdeaIds.includes("external_asic_autotune"));
  assert.ok(networkOnly.offlineIdeaIds.includes("thermodynamic_asic_prediction"));
});
test("algorithm research review binds ideas to source-backed deployment lanes", () => {
  const review = deriveAlgorithmResearchReview(reviewInput({
    hasMeasuredLocalPower: true,
    networkTelemetryReady: true,
    externalEfficiencyReady: true,
    searchSpaceReady: true,
    externalWorkAssignable: true,
  }));
  const source = (id) => {
    const item = review.sources.find((candidate) => candidate.id === id);
    assert.ok(item, `missing source ${id}`);
    return item;
  };

  assert.ok(idea(review, "version_rolling_asicboost").sourceIds.includes("bip320_version_bits"));
  assert.ok(idea(review, "version_rolling_asicboost").sourceIds.includes("bip323_version_bits"));
  assert.ok(idea(review, "version_rolling_asicboost").sourceIds.includes("stratum_v2_mining_protocol"));
  assert.equal(source("bip320_version_bits").deploymentLane, "dry_run");
  assert.equal(source("bip320_version_bits").evidenceLevel, "protocol");
  assert.match(source("bip320_version_bits").validationGate, /unique search-space/i);
  assert.equal(source("bip320_version_bits").productionAllowed, false);
  assert.equal(source("bip323_version_bits").deploymentLane, "dry_run");
  assert.equal(source("bip323_version_bits").evidenceLevel, "protocol");
  assert.match(source("bip323_version_bits").validationGate, /24-bit version rolling|overlapping work/i);
  assert.equal(source("bip323_version_bits").productionAllowed, false);
  assert.equal(source("stratum_v2_mining_protocol").deploymentLane, "dry_run");
  assert.equal(source("thermodynamic_sha256_asic_2026").deploymentLane, "offline");
  assert.equal(source("thermodynamic_sha256_asic_2026").evidenceLevel, "hypothesis");
  assert.match(source("thermodynamic_sha256_asic_2026").validationGate, /offline replication/i);
  assert.equal(source("thermodynamic_sha256_asic_2026").productionAllowed, false);
  assert.equal(source("neural_asic_tpf_2026").deploymentLane, "offline");
  assert.equal(source("neural_asic_tpf_2026").productionAllowed, false);
  assert.ok(idea(review, "thermodynamic_asic_prediction").sourceIds.includes("neural_asic_tpf_2026"));
  assert.equal(idea(review, "thermodynamic_asic_prediction").deploymentLane, "offline");
  assert.equal(source("hashprice_demand_response_2026").deploymentLane, "decision");
  assert.ok(idea(review, "market_roi_prediction").sourceIds.includes("hashprice_demand_response_2026"));
  assert.ok(review.sourceIds.includes("sha256_uniform_search"));
  assert.ok(review.safetyEnvelope.runtimeAllowedSourceIds.includes("bitcoin_consensus_pow"));
  assert.ok(review.safetyEnvelope.runtimeAllowedSourceIds.includes("sha256_uniform_search"));
  assert.ok(review.safetyEnvelope.dryRunOnlySourceIds.includes("bip320_version_bits"));
  assert.ok(review.safetyEnvelope.dryRunOnlySourceIds.includes("bip323_version_bits"));
  assert.ok(review.safetyEnvelope.offlineOnlySourceIds.includes("neural_asic_tpf_2026"));
  assert.ok(review.safetyEnvelope.decisionOnlySourceIds.includes("hashprice_demand_response_2026"));
  assert.ok(review.safetyEnvelope.speculativeSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.equal(review.safetyEnvelope.reviewedAt, "2026-07-02");
  assert.equal(review.safetyEnvelope.frontierReviewRequired, true);
  assert.equal(freshness(review, "thermodynamic_sha256_asic_2026").status, "refresh_required");
  assert.equal(freshness(review, "thermodynamic_sha256_asic_2026").ageDays, 178);
  assert.equal(freshness(review, "thermodynamic_sha256_asic_2026").nextReviewAt, "2026-04-05");
  assert.equal(freshness(review, "neural_asic_tpf_2026").status, "refresh_required");
  assert.equal(freshness(review, "hashprice_demand_response_2026").status, "fresh");
  assert.ok(review.safetyEnvelope.staleFrontierSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.equal(freshness(review, "quantum_sha256_resource_estimates").status, "fresh");
  assert.equal(freshness(review, "quantum_sha256_resource_estimates").ageDays, 20);
  assert.equal(freshness(review, "quantum_sha256_resource_estimates").nextReviewAt, "2026-09-10");
  assert.equal(review.safetyEnvelope.undatedDecisionSourceIds.includes("quantum_sha256_resource_estimates"), false);
  assert.ok(review.safetyEnvelope.promotionBlockingSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(review.safetyEnvelope.promotionBlockingSourceIds.includes("neural_asic_tpf_2026"));
  assert.equal(review.safetyEnvelope.promotionBlockingSourceIds.includes("quantum_sha256_resource_estimates"), false);
  assert.equal(review.safetyEnvelope.promotionBlockingSourceIds.includes("hashprice_demand_response_2026"), false);
  assert.match(review.safetyEnvelope.summary, /promotion-blocking 2/i);
  assert.match(review.safetyEnvelope.summary, /frontier review required/i);
  assert.match(review.summary, /Research safety envelope/i);
});

test("algorithm research review keeps newer frontier sources fresh while stale sources stay blocked", () => {
  const review = deriveAlgorithmResearchReview(reviewInput({ researchReviewedAt: "2026-07-20" }));
  const thermo = freshness(review, "thermodynamic_sha256_asic_2026");

  assert.equal(thermo.status, "refresh_required");
  assert.equal(thermo.ageDays, 196);
  assert.ok(review.safetyEnvelope.staleFrontierSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.equal(review.safetyEnvelope.frontierReviewRequired, true);
  assert.equal(freshness(review, "hashprice_demand_response_2026").status, "current");
  assert.match(review.safetyEnvelope.summary, /frontier review required/i);
});
test("algorithm research review blocks future-dated frontier sources", () => {
  const review = deriveAlgorithmResearchReview(reviewInput({ researchReviewedAt: "2026-01-01" }));
  const thermo = freshness(review, "thermodynamic_sha256_asic_2026");
  const hashprice = freshness(review, "hashprice_demand_response_2026");

  assert.equal(thermo.status, "future_dated");
  assert.equal(thermo.ageDays, null);
  assert.equal(hashprice.status, "future_dated");
  assert.equal(review.safetyEnvelope.frontierReviewRequired, true);
  assert.ok(review.safetyEnvelope.staleFrontierSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(review.safetyEnvelope.promotionBlockingSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.equal(review.safetyEnvelope.promotionBlockingSourceIds.includes("hashprice_demand_response_2026"), false);
  assert.match(thermo.reason, /after the review snapshot|current review/i);
});

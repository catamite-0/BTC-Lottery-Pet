import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmResearchReview } from "../.test-dist/domain/algorithmResearchReview.js";
import {
  algorithmSourceReferences,
  allAlgorithmSourceReferences,
} from "../.test-dist/domain/algorithmSourceRegistry.js";

function reviewInput(overrides = {}) {
  return {
    midstateReady: true,
    hasMeasuredLocalPower: true,
    networkTelemetryReady: true,
    externalEfficiencyReady: true,
    searchSpaceReady: true,
    externalWorkAssignable: true,
    directProtocolSelected: false,
    ...overrides,
  };
}

test("algorithm source registry resolves deployment boundaries for every source id", () => {
  const references = allAlgorithmSourceReferences();
  const ids = references.map((reference) => reference.id);
  const reference = (id) => {
    const item = references.find((candidate) => candidate.id === id);
    assert.ok(item, `missing source reference ${id}`);
    return item;
  };

  assert.equal(new Set(ids).size, references.length);
  assert.match(reference("bitcoin_consensus_pow").referenceUrl ?? "", /developer\.bitcoin\.org/);
  assert.equal(reference("bitcoin_consensus_pow").productionAllowed, true);
  assert.equal(reference("bitcoin_consensus_pow").publishedAt, null);
  assert.equal(reference("bip320_version_bits").deploymentLane, "dry_run");
  assert.equal(reference("bip320_version_bits").publishedAt, "2018-03-01");
  assert.match(reference("bip320_version_bits").referenceUrl ?? "", /bips\.dev\/320/);
  assert.equal(reference("bip323_version_bits").deploymentLane, "dry_run");
  assert.equal(reference("bip323_version_bits").publishedAt, "2026-04-22");
  assert.match(reference("bip323_version_bits").referenceUrl ?? "", /bips\.dev\/323/);
  assert.match(reference("bip323_version_bits").algorithmImplication, /future external-hash search-space anchor/i);
  assert.equal(reference("thermodynamic_sha256_asic_2026").deploymentLane, "offline");
  assert.equal(reference("thermodynamic_sha256_asic_2026").publishedAt, "2026-01-05");
  assert.match(reference("thermodynamic_sha256_asic_2026").sourcePolicy, /offline telemetry experiments/i);
  assert.match(reference("thermodynamic_sha256_asic_2026").algorithmImplication, /offline/i);
  assert.equal(reference("quantum_sha256_resource_estimates").deploymentLane, "decision");
  assert.equal(reference("quantum_sha256_resource_estimates").publishedAt, "2026-06-12");
  assert.match(reference("quantum_sha256_resource_estimates").referenceUrl ?? "", /2606\.14484/);
  assert.match(reference("quantum_sha256_resource_estimates").algorithmImplication, /decision-only risk context/i);
  assert.match(reference("sha256_uniform_search").algorithmImplication, /Reject prediction/i);
});

test("algorithm source registry preserves active review source order without duplicates", () => {
  const review = deriveAlgorithmResearchReview(reviewInput());
  const references = algorithmSourceReferences([...review.sourceIds, review.sourceIds[0]]);

  assert.deepEqual(references.map((reference) => reference.id), review.sourceIds);
  assert.equal(references.length, review.sourceIds.length);
  assert.ok(references.every((reference) => reference.consensusBoundary.length > 0));
  assert.ok(references.every((reference) => reference.algorithmImplication.length > 0));
  assert.ok(references.every((reference) => reference.sourcePolicy.length > 0));
});

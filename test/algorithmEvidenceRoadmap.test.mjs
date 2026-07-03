import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmEvidenceRoadmap } from "../.test-dist/domain/algorithmEvidenceRoadmap.js";

function gate(id, status = "waiting", summary = `${id} ${status}`) {
  return {
    id,
    status,
    summary,
    nextStep: `${id} next`,
  };
}

function researchReview(overrides = {}) {
  return {
    productionIdeaIds: ["consensus_sha256", "midstate_reuse"],
    experimentIdeaIds: ["version_rolling_asicboost", "stratum_v2_extended_jobs"],
    rejectedIdeaIds: ["predictive_nonce_pruning", "proof_of_work_compression"],
    runtimeIdeaIds: ["consensus_sha256", "midstate_reuse"],
    dryRunIdeaIds: [],
    telemetryIdeaIds: [],
    offlineIdeaIds: ["version_rolling_asicboost", "stratum_v2_extended_jobs", "thermodynamic_asic_prediction"],
    primaryExperimentIdea: {
      id: "version_rolling_asicboost",
      routeable: false,
      nextStep: "prove search space",
    },
    nextStep: "prove search space",
    ...overrides,
  };
}

function roadmapInput(overrides = {}) {
  return {
    researchReview: researchReview(),
    primaryExperiment: {
      id: "capture_local_baseline",
      status: "ready",
      nextStep: "capture local sample",
    },
    readinessScore: 11,
    readyForUnattendedLocal: false,
    readyForExternalDryRun: false,
    readyForExternalMining: false,
    readinessGates: [
      gate("consensus_midstate", "passed"),
      gate("measured_power"),
      gate("share_quality"),
      gate("stability_window"),
      gate("thermal_safety"),
      gate("external_efficiency_history"),
      gate("search_space_lease"),
      gate("external_work_validation"),
      gate("direct_protocol"),
    ],
    densityPlan: {
      readinessScore: 20,
      readyForLongRun: false,
      primaryMissingGate: gate("measured_power"),
      nextStep: "capture measured watts",
    },
    ...overrides,
  };
}

function phase(roadmap, id) {
  const item = roadmap.phases.find((candidate) => candidate.id === id);
  assert.ok(item, `missing phase ${id}`);
  return item;
}

test("algorithm evidence roadmap points empty evidence toward local baseline capture", () => {
  const roadmap = deriveAlgorithmEvidenceRoadmap(roadmapInput());

  assert.equal(roadmap.primaryPhase.id, "local_power_baseline");
  assert.equal(roadmap.primaryPhase.status, "ready");
  assert.equal(roadmap.localLongRunReady, false);
  assert.equal(roadmap.externalDryRunReady, false);
  assert.equal(roadmap.externalMiningAllowed, false);
  assert.equal(phase(roadmap, "research_frontier_filter").status, "done");
  assert.match(phase(roadmap, "research_frontier_filter").evidence, /runtime ideas.*dry-run ideas.*offline ideas/i);
  assert.match(roadmap.summary, /external mining remains release-gated/i);
});

test("algorithm evidence roadmap blocks stale frontier promotion without blocking local evidence", () => {
  const roadmap = deriveAlgorithmEvidenceRoadmap(roadmapInput({
    researchPromotionGate: {
      status: "review_required",
      frontierPromotionAllowed: false,
      blockedSourceIds: ["thermodynamic_sha256_asic_2026", "neural_asic_tpf_2026"],
      summary: "Frontier promotion needs research freshness review.",
      nextStep: "Refresh frontier research sources.",
    },
  }));
  const frontier = phase(roadmap, "research_frontier_filter");

  assert.equal(frontier.status, "blocked");
  assert.ok(roadmap.blockedPhaseIds.includes("research_frontier_filter"));
  assert.match(frontier.evidence, /thermodynamic_sha256_asic_2026/);
  assert.match(frontier.nextStep, /Refresh frontier/i);
  assert.equal(phase(roadmap, "local_power_baseline").status, "ready");
});

test("algorithm evidence roadmap keeps useful density waiting while max-hash headroom is unclassified", () => {
  const roadmap = deriveAlgorithmEvidenceRoadmap(roadmapInput({
    readyForUnattendedLocal: true,
    readinessGates: [
      gate("consensus_midstate", "passed"),
      gate("measured_power", "passed"),
      gate("share_quality", "passed"),
      gate("stability_window", "passed"),
      gate("thermal_safety", "passed"),
      gate("external_efficiency_history"),
      gate("search_space_lease"),
      gate("external_work_validation"),
      gate("direct_protocol"),
    ],
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      hashrateHeadroom: {
        status: "waiting",
        summary: "max-hash headroom waiting",
        nextStep: "measure max-hash headroom",
      },
      nextStep: "density ready",
    },
  }));

  assert.equal(phase(roadmap, "useful_hash_density").status, "waiting");
  assert.equal(roadmap.primaryPhase.id, "useful_hash_density");
  assert.match(phase(roadmap, "useful_hash_density").evidence, /headroom waiting/i);
  assert.match(roadmap.nextStep, /measure max-hash headroom/i);
});

test("algorithm evidence roadmap treats marginal hold as a completed density boundary", () => {
  const roadmap = deriveAlgorithmEvidenceRoadmap(roadmapInput({
    readyForUnattendedLocal: true,
    readinessGates: [
      gate("consensus_midstate", "passed"),
      gate("measured_power", "passed"),
      gate("share_quality", "passed"),
      gate("stability_window", "passed"),
      gate("thermal_safety", "passed"),
      gate("external_efficiency_history"),
      gate("search_space_lease"),
      gate("external_work_validation"),
      gate("direct_protocol"),
    ],
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      hashrateHeadroom: {
        status: "available",
        summary: "max-hash headroom available",
        nextStep: "classify max-hash headroom",
      },
      marginalDecision: {
        status: "hold",
        summary: "Hold the upgrade because useful density collapses.",
        nextStep: "Stay on the selected density lane.",
      },
      nextStep: "density ready",
    },
  }));

  assert.equal(phase(roadmap, "useful_hash_density").status, "done");
  assert.match(phase(roadmap, "useful_hash_density").evidence, /Hold the upgrade/i);
  assert.match(phase(roadmap, "useful_hash_density").nextStep, /selected density lane/i);
  assert.notEqual(roadmap.primaryPhase.id, "useful_hash_density");
});
test("algorithm evidence roadmap promotes dry-run external work validation without enabling mining", () => {
  const roadmap = deriveAlgorithmEvidenceRoadmap(roadmapInput({
    primaryExperiment: {
      id: "validate_external_work_lease",
      status: "ready",
      nextStep: "validate mock leases",
    },
    readinessScore: 89,
    readyForUnattendedLocal: true,
    readyForExternalDryRun: true,
    readyForExternalMining: false,
    readinessGates: [
      gate("consensus_midstate", "passed"),
      gate("measured_power", "passed"),
      gate("share_quality", "passed"),
      gate("stability_window", "passed"),
      gate("thermal_safety", "passed"),
      gate("external_efficiency_history", "passed"),
      gate("search_space_lease", "passed"),
      gate("external_work_validation"),
      gate("direct_protocol"),
    ],
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      nextStep: "keep sampling",
    },
    researchReview: researchReview({
      productionIdeaIds: ["consensus_sha256", "midstate_reuse", "telemetry_power_tuning"],
      dryRunIdeaIds: ["version_rolling_asicboost", "stratum_v2_extended_jobs"],
      primaryExperimentIdea: {
        id: "stratum_v2_extended_jobs",
        routeable: true,
        nextStep: "validate extended jobs",
      },
      nextStep: "validate extended jobs",
    }),
  }));

  assert.equal(phase(roadmap, "search_space_work_leases").status, "done");
  assert.equal(phase(roadmap, "external_work_validation").status, "ready");
  assert.equal(roadmap.primaryPhase.id, "external_work_validation");
  assert.equal(roadmap.externalDryRunReady, true);
  assert.equal(roadmap.externalMiningAllowed, false);
  assert.ok(roadmap.completionScore > 70);
});

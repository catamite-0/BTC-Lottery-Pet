import test from "node:test";
import assert from "node:assert/strict";

import { deriveMiningAlgorithmPlan } from "../.test-dist/domain/algorithmPlanner.js";
import { OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS } from "../.test-dist/domain/optimizationThresholds.js";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
} from "../.test-dist/domain/efficiencyTuning.js";
import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import { deriveExternalHashWorkAdapterPlan } from "../.test-dist/engines/externalHashWorkAdapter.js";
import { assessHashHardwareOperatingEvidence } from "../.test-dist/domain/hashHardwareOperatingEvidence.js";

function externalHistory(overrides = {}) {
  const efficiencySampleCount = overrides.efficiencySampleCount ?? 6;
  const usableEfficiencySampleCount = overrides.usableEfficiencySampleCount ?? efficiencySampleCount;
  const evidenceGap = overrides.evidenceGap ?? Math.max(0, 3 - usableEfficiencySampleCount);
  const evidenceStatus = overrides.evidenceStatus ?? (
    usableEfficiencySampleCount >= 6 ? "stable" : usableEfficiencySampleCount >= 3 ? "ready" : usableEfficiencySampleCount > 0 ? "probing" : "waiting"
  );

  return {
    sampleCount: overrides.sampleCount ?? 6,
    onlineSampleCount: overrides.onlineSampleCount ?? 6,
    efficiencySampleCount,
    usableEfficiencySampleCount,
    evidenceStatus,
    evidenceReady: overrides.evidenceReady ?? usableEfficiencySampleCount >= 3,
    evidenceSampleTarget: overrides.evidenceSampleTarget ?? 3,
    evidenceGap,
    latestSample: null,
    bestEfficiencySample: null,
    averageHashrate: 1_200_000_000_000,
    averageWatts: 18,
    averageJoulesPerTerahash: 15,
    bestJoulesPerTerahash: 14,
    trend: "stable",
    trendPercent: 1,
    summary: `${overrides.onlineSampleCount ?? 6}/${overrides.sampleCount ?? 6} online samples; stable by 1.0%; ${evidenceStatus}.`,
    ...overrides,
  };
}

function localAnalysis(observationOverrides = {}) {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });

  return analyzeTuningObservations(sweep, [{
    stepId: sweep.steps[0].id,
    hashrate: 100_000_000,
    watts: 45,
    powerEvidenceStatus: "measured",
    sampleSeconds: 240,
    acceptedShares: 6,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    tempC: 62,
    ...observationOverrides,
  }]);
}

function emptyAnalysis() {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });
  return analyzeTuningObservations(sweep, []);
}
function envelopeAnalysis(sampleSeconds = OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS) {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });

  return analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 80_000_000, watts: 8, powerEvidenceStatus: "measured", sampleSeconds, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 220_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
    { stepId: sweep.steps[2].id, hashrate: 500_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 65 },
  ]);
}


function externalOperatingEvidence(overrides = {}) {
  return assessHashHardwareOperatingEvidence([{
    generatedAt: "2026-07-02T00:15:00.000Z",
    durationSeconds: 900,
    hashrate: 2_400_000_000_000,
    wallWatts: 32,
    joulesPerTerahash: 13,
    powerEvidenceSource: "wall_meter",
    tempC: 58,
    vrTempC: 62,
    fanRpm: 4200,
    noiseDba: 42,
    acceptedShares: 4,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    miningPaused: false,
    ...overrides,
  }]);
}
function planInput({
  config = { external_hash_interface: "none" },
  telemetry = null,
  analysis = localAnalysis(),
  history = externalHistory(),
  externalOperatingEvidence = null,
  snapshotOverride = null,
  midstateReuseReady = true,
  midstatePerformance = "faster",
  researchReviewedAt = "2026-07-02",
  externalAlgorithmMode = null,
} = {}) {
  const baseSnapshot = deriveExternalHashSnapshot(config, telemetry);
  const snapshot = snapshotOverride ? snapshotOverride(baseSnapshot) : baseSnapshot;
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const workAdapterPlan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  return {
    tuningAnalysis: analysis,
    externalHistory: history,
    externalSnapshot: snapshot,
    externalCapabilityMatrix: matrix,
    externalWorkAdapterPlan: workAdapterPlan,
    externalOperatingEvidence,
    externalAlgorithmMode,
    midstateReuseReady,
    midstatePerformance,
    researchReviewedAt,
  };
}

function bitaxeTelemetry(overrides = {}) {
  return {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Future",
    hostname: "bitaxe.local",
    hash_rate_hs: 1_200_000_000_000,
    power_watts: 18,
    joules_per_terahash: 15,
    temp_c: 58,
    vr_temp_c: 61,
    fan_rpm: 4200,
    generated_at: "2026-07-01T12:00:00.000Z",
    ...overrides,
  };
}

function futureEngineSnapshot(baseSnapshot) {
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"];
  return {
    ...baseSnapshot,
    integrationStage: "hash-engine",
    capabilities,
    parallelWorkers: 4,
    canReadTelemetry: true,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: true,
    adapter: {
      ...baseSnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
}

function researchLane(plan, id) {
  const lane = plan.researchPolicy.lanes.find((candidate) => candidate.id === id);
  assert.ok(lane, `missing research lane ${id}`);
  return lane;
}

function experiment(plan, id) {
  const item = plan.experimentQueue.experiments.find((candidate) => candidate.id === id);
  assert.ok(item, `missing experiment ${id}`);
  return item;
}

function readinessGate(plan, id) {
  const gate = plan.readinessCertificate.gates.find((candidate) => candidate.id === id);
  assert.ok(gate, `missing readiness gate ${id}`);
  return gate;
}

function roadmapPhase(plan, id) {
  const phase = plan.evidenceRoadmap.phases.find((candidate) => candidate.id === id);
  assert.ok(phase, `missing roadmap phase ${id}`);
  return phase;
}

test("algorithm planner starts with baseline collection when no route evidence exists", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: emptyAnalysis(),
    history: externalHistory({
      sampleCount: 0,
      onlineSampleCount: 0,
      efficiencySampleCount: 0,
      averageHashrate: 0,
      averageWatts: null,
      averageJoulesPerTerahash: null,
      bestJoulesPerTerahash: null,
    }),
  }));

  assert.equal(plan.strategy, "collect_baseline");
  assert.equal(plan.recommendedRoute, "waiting");
  assert.equal(plan.canAssignExternalWork, false);
  assert.match(plan.consensusBoundary, /double SHA-256/);
  assert.equal(plan.algorithmStack.consensusHashing, "double_sha256");
  assert.equal(plan.algorithmStack.localKernel.mode, "midstate_reuse");
  assert.equal(plan.algorithmStack.defaultOperatingLane.status, "waiting");
  assert.equal(plan.algorithmStack.highHashPath, "waiting");
  assert.equal(plan.algorithmStack.externalWorkPolicy, "disabled");
  assert.equal(plan.algorithmStack.frontierPolicy, "review_required");
  assert.deepEqual(plan.algorithmStack.rejectedShortcutIdeaIds, ["predictive_nonce_pruning", "proof_of_work_compression"]);
  assert.match(plan.algorithmStack.summary, /consensus double SHA-256/i);
  assert.equal(plan.actions.find((action) => action.id === "consensus_midstate")?.status, "done");
  assert.equal(plan.actions.find((action) => action.id === "local_sample")?.status, "ready");
  assert.equal(plan.researchPolicy.primaryLaneId, "local_power_tuning");
  assert.equal(researchLane(plan, "consensus_sha256").status, "active");
  assert.equal(researchLane(plan, "midstate_reuse").status, "done");
  assert.equal(researchLane(plan, "offline_timing_research").status, "reserved");
  assert.equal(researchLane(plan, "predictive_pruning").status, "rejected");
  assert.equal(researchLane(plan, "hash_search_compression").status, "rejected");
  assert.deepEqual(plan.researchPolicy.rejectedLaneIds, ["predictive_pruning", "hash_search_compression"]);
  assert.ok(plan.researchReview.productionIdeaIds.includes("midstate_reuse"));
  assert.deepEqual(plan.researchReview.rejectedIdeaIds, ["predictive_nonce_pruning", "proof_of_work_compression"]);
  assert.ok(plan.researchReview.decisionOnlyIdeaIds.includes("quantum_sha256_mining"));
  assert.equal(plan.researchReview.primaryExperimentIdea?.id, "version_rolling_asicboost");
  assert.ok(plan.researchReview.runtimeIdeaIds.includes("midstate_reuse"));
  assert.ok(plan.researchReview.offlineIdeaIds.includes("version_rolling_asicboost"));
  assert.ok(plan.researchPolicy.runtimeIdeaIds.includes("midstate_reuse"));
  assert.ok(plan.researchPolicy.offlineIdeaIds.includes("version_rolling_asicboost"));
  assert.match(plan.researchPolicy.deploymentSummary, /runtime \d+, dry-run 0, telemetry 0, offline \d+/);
  assert.match(plan.researchPolicy.hashratePriority, /Do not chase external high-hash routing yet/i);
  assert.equal(plan.researchPromotionGate.status, "review_required");
  assert.equal(plan.researchPromotionGate.frontierPromotionAllowed, false);
  assert.equal(plan.researchPromotionGate.runtimeProfilePromotionAllowed, true);
  assert.ok(plan.researchPromotionGate.blockedSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(plan.researchPromotionGate.protectedRuntimeSourceIds.includes("bitcoin_consensus_pow"));
  assert.match(plan.researchPromotionGate.summary, /measured local runtime profiles remain governed/i);
  assert.equal(plan.experimentQueue.primaryExperiment.id, "capture_local_baseline");
  assert.equal(plan.evidenceRoadmap.primaryPhase.id, "local_power_baseline");
  assert.equal(plan.evidenceRoadmap.primaryPhase.status, "ready");
  assert.ok(plan.evidenceRoadmap.blockedPhaseIds.includes("research_frontier_filter"));
  assert.equal(roadmapPhase(plan, "research_frontier_filter").status, "blocked");
  assert.match(roadmapPhase(plan, "research_frontier_filter").evidence, /thermodynamic_sha256_asic_2026|quantum_sha256_resource_estimates/);
  assert.match(roadmapPhase(plan, "research_frontier_filter").nextStep, /Refresh frontier/i);
  assert.equal(plan.evidenceRoadmap.externalMiningAllowed, false);
  assert.equal(plan.samplingPlan.primaryTask.id, "local_measured_power");
  assert.equal(plan.samplingPlan.primaryTask.requiredSeconds, 900);
  assert.equal(plan.samplingPlan.primaryTask.requiresMeasuredPower, true);
  assert.equal(experiment(plan, "capture_local_baseline").status, "ready");
  assert.equal(experiment(plan, "measure_local_power").status, "waiting");
  assert.equal(experiment(plan, "record_offline_timing_probe").status, "reserved");
  assert.equal(experiment(plan, "record_offline_timing_probe").route, "offline");
  assert.match(experiment(plan, "record_offline_timing_probe").nextStep, /external ASIC telemetry/i);
  assert.match(plan.experimentQueue.summary, /primary capture local baseline/i);
  assert.equal(plan.readinessCertificate.readyForUnattendedLocal, false);
  assert.equal(readinessGate(plan, "consensus_midstate").status, "passed");
  assert.equal(readinessGate(plan, "measured_power").status, "waiting");
  assert.match(plan.readinessCertificate.summary, /measured power/i);
});

test("algorithm planner waits for fixed-window midstate evidence when benchmark is unknown", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    midstateReuseReady: null,
  }));

  assert.equal(plan.actions.find((action) => action.id === "consensus_midstate")?.status, "ready");
  assert.equal(experiment(plan, "verify_consensus_midstate").status, "ready");
  assert.equal(researchLane(plan, "midstate_reuse").status, "ready");
  assert.equal(readinessGate(plan, "consensus_midstate").status, "waiting");
  assert.equal(plan.readinessCertificate.readyForUnattendedLocal, false);
  assert.equal(plan.readinessCertificate.primaryMissingGate?.id, "consensus_midstate");
  assert.match(plan.riskFlags.join(" "), /fixed-window benchmark/i);
});


test("algorithm planner falls back to full-header default when midstate benchmark regresses", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    midstateReuseReady: true,
    midstatePerformance: "regression",
  }));

  assert.equal(plan.algorithmStack.localKernel.mode, "midstate_regression");
  assert.equal(plan.algorithmStack.localKernel.status, "done");
  assert.match(plan.algorithmStack.localKernel.summary, /full-header/i);
  assert.equal(plan.researchPolicy.primaryLaneId, "consensus_sha256");
  assert.equal(researchLane(plan, "midstate_reuse").status, "blocked");
  assert.equal(plan.researchReview.productionIdeaIds.includes("midstate_reuse"), false);
  assert.equal(plan.researchReview.runtimeIdeaIds.includes("midstate_reuse"), false);
  assert.equal(readinessGate(plan, "consensus_midstate").status, "passed");
  assert.match(plan.riskFlags.join(" "), /performance regression/i);
});
test("algorithm planner keeps network adapters in telemetry sampling while work is blocked", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "bitaxe.local",
    },
    telemetry: bitaxeTelemetry(),
  }));

  assert.equal(plan.strategy, "external_telemetry_sampling");
  assert.equal(plan.canAssignExternalWork, false);
  assert.ok(["external_search_space", "external_work_adapter"].includes(plan.routeDecision?.primaryRecommendation.reason ?? ""));
  assert.match(plan.externalSummary, /telemetry/i);
  assert.equal(plan.actions.find((action) => action.id === "external_capabilities")?.status, "blocked");
  assert.match(plan.riskFlags.join(" "), /telemetry-only|blocked/i);
  assert.equal(plan.researchPolicy.primaryLaneId, "network_telemetry");
  assert.equal(researchLane(plan, "network_telemetry").status, "ready");
  assert.equal(researchLane(plan, "external_work_dry_run").status, "blocked");
  assert.ok(plan.researchPolicy.telemetryIdeaIds.includes("external_asic_autotune"));
  assert.match(plan.researchPolicy.powerPriority, /reference/i);
  assert.match(plan.researchPolicy.deploymentSummary, /telemetry \d+/);
  assert.equal(experiment(plan, "sample_network_asic").status, "done");
  assert.equal(experiment(plan, "review_search_space").status, "blocked");
  assert.equal(experiment(plan, "validate_external_work_lease").status, "blocked");
  assert.match(experiment(plan, "review_search_space").nextStep, /Search space|Work lease/i);
  assert.equal(readinessGate(plan, "external_efficiency_history").status, "passed");
  assert.equal(readinessGate(plan, "search_space_lease").status, "blocked");
  assert.equal(plan.readinessCertificate.readyForExternalDryRun, false);
  assert.equal(plan.hardwareCandidate.status, "telemetry-only");
  assert.equal(plan.hardwareCandidate.canRouteWork, false);
  assert.equal(plan.hardwareCandidate.miningStartAllowed, false);
  assert.match(plan.hardwareCandidate.nextStep, /version rolling/i);
});

test("algorithm planner keeps hot external telemetry in sampling", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "bitaxe.local",
    },
    telemetry: bitaxeTelemetry({ temp_c: 84, vr_temp_c: 96, fan_rpm: 4500 }),
    history: externalHistory({
      sampleCount: 3,
      onlineSampleCount: 3,
      efficiencySampleCount: 3,
      usableEfficiencySampleCount: 0,
      evidenceStatus: "waiting",
      evidenceReady: false,
      evidenceGap: 3,
      averageHashrate: 0,
      averageWatts: null,
      averageJoulesPerTerahash: null,
      bestJoulesPerTerahash: null,
      summary: "3/3 online samples; waiting for usable thermal evidence.",
    }),
  }));

  assert.equal(plan.strategy, "external_telemetry_sampling");
  assert.equal(plan.operatingEnvelope.externalReference.status, "waiting");
  assert.equal(experiment(plan, "sample_network_asic").status, "ready");
  assert.equal(readinessGate(plan, "external_efficiency_history").status, "waiting");
  assert.match(readinessGate(plan, "external_efficiency_history").nextStep, /cool\/warm/i);
});


test("algorithm planner keeps direct adapters reserved until hardware protocol validation", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    config: {
      external_hash_interface: "direct",
      external_hash_direct_port: "COM7",
    },
  }));

  assert.equal(plan.strategy, "direct_protocol_reserved");
  assert.equal(plan.canAssignExternalWork, false);
  assert.match(plan.externalSummary, /COM7/);
  assert.equal(plan.actions.find((action) => action.id === "direct_protocol")?.status, "reserved");
  assert.match(plan.riskFlags.join(" "), /Direct external hash is reserved/);
  assert.equal(plan.hardwareCandidate.status, "reserved");
  assert.equal(plan.hardwareCandidate.canRouteWork, false);
  assert.match(plan.hardwareCandidate.nextStep, /Direct endpoint protocol/i);
  assert.equal(plan.densityPlan.strategy, "direct_reserved");
  assert.equal(plan.densityPlan.miningStartAllowed, false);
  assert.equal(plan.researchPolicy.primaryLaneId, "direct_transport");
  assert.equal(researchLane(plan, "direct_transport").status, "reserved");
  assert.equal(researchLane(plan, "search_space_partitioning").status, "blocked");
  assert.equal(experiment(plan, "choose_direct_protocol").status, "reserved");
  assert.equal(experiment(plan, "validate_external_work_lease").status, "reserved");
});

test("algorithm planner seals external hash out of local-only algorithm planning", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: bitaxeTelemetry({
      base_url: "http://future-rack.local",
      hostname: "future-rack.local",
      hash_rate_hs: 2_400_000_000_000,
      power_watts: 32,
      joules_per_terahash: 13,
      parallel_workers: 4,
    }),
    snapshotOverride: futureEngineSnapshot,
    externalAlgorithmMode: "local_only",
  }));

  assert.equal(plan.recommendedRoute, "local");
  assert.equal(plan.canAssignExternalWork, false);
  assert.equal(plan.dryRunOnly, false);
  assert.equal(plan.algorithmStack.externalWorkPolicy, "disabled");
  assert.notEqual(plan.algorithmStack.highHashPath, "external_dry_run");
  assert.notEqual(plan.algorithmStack.highHashPath, "external_telemetry_only");
  assert.equal(plan.algorithmStack.defaultOperatingLane.source, "local");
  assert.equal(plan.operatingEnvelope.externalReference.source, "waiting");
  assert.equal(plan.operatingEnvelope.externalReference.hashrate, null);
  assert.equal(plan.densityPlan.selectedLane.source, "local");
  assert.notEqual(plan.densityPlan.strategy, "external_dry_run");
  assert.notEqual(plan.researchPolicy.primaryLaneId, "external_work_dry_run");
  assert.equal(plan.actions.some((action) => action.id === "external_dry_run_validation"), false);
  assert.equal(experiment(plan, "validate_external_work_lease").status, "waiting");
  assert.equal(readinessGate(plan, "external_efficiency_history").requiredForReady, false);
  assert.match(plan.externalSummary, /sealed off/i);
});
test("algorithm planner promotes future engine-capable adapters only to dry-run validation", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: bitaxeTelemetry({
      base_url: "http://future-rack.local",
      hostname: "future-rack.local",
      hash_rate_hs: 2_400_000_000_000,
      power_watts: 32,
      joules_per_terahash: 13,
      parallel_workers: 4,
    }),
    snapshotOverride: futureEngineSnapshot,
  }));

  assert.equal(plan.strategy, "external_work_dry_run");
  assert.equal(plan.canAssignExternalWork, true);
  assert.equal(plan.dryRunOnly, true);
  assert.equal(plan.algorithmStack.highHashPath, "external_dry_run");
  assert.equal(plan.algorithmStack.externalWorkPolicy, "dry_run_only");
  assert.equal(plan.algorithmStack.defaultOperatingLane.id, "external_reference");
  assert.equal(plan.algorithmStack.defaultOperatingLane.status, "dry-run");
  assert.equal(plan.algorithmStack.frontierPolicy, "review_required");
  assert.match(plan.algorithmStack.nextStep, /stale|accepted|share|lifecycle|thermal|Refresh/i);
  assert.equal(plan.routeDecision?.target, "external");
  assert.equal(plan.actions.find((action) => action.id === "external_dry_run_validation")?.status, "ready");
  assert.match(plan.summary, /dry-run work leases/i);
  assert.equal(plan.researchPolicy.primaryLaneId, "external_work_dry_run");
  assert.equal(researchLane(plan, "external_work_dry_run").status, "ready");
  assert.equal(researchLane(plan, "search_space_partitioning").status, "ready");
  assert.ok(plan.researchPolicy.allowedLaneIds.includes("external_work_dry_run"));
  assert.equal(plan.experimentQueue.primaryExperiment.id, "validate_external_work_lease");
  assert.equal(experiment(plan, "validate_external_work_lease").status, "ready");
  assert.equal(experiment(plan, "review_search_space").status, "done");
  assert.equal(experiment(plan, "apply_operating_point").status, "reserved");
  assert.equal(readinessGate(plan, "external_efficiency_history").status, "passed");
  assert.equal(readinessGate(plan, "search_space_lease").status, "passed");
  assert.equal(readinessGate(plan, "external_work_validation").status, "waiting");
  assert.equal(plan.readinessCertificate.readyForExternalDryRun, true);
  assert.equal(plan.readinessCertificate.readyForExternalMining, false);
  assert.equal(plan.hardwareCandidate.status, "qualified");
  assert.equal(plan.hardwareCandidate.canRouteWork, true);
  assert.equal(plan.hardwareCandidate.miningStartAllowed, false);
  assert.match(plan.hardwareCandidate.summary, /13\.3 J\/TH/);
  assert.equal(plan.densityPlan.strategy, "external_dry_run");
  assert.equal(plan.densityPlan.externalDryRunOnly, true);
  assert.equal(plan.densityPlan.miningStartAllowed, false);
  assert.equal(plan.researchReview.productionIdeaIds.includes("version_rolling_asicboost"), false);
  assert.ok(plan.researchReview.dryRunIdeaIds.includes("version_rolling_asicboost"));
  assert.equal(plan.researchReview.primaryExperimentIdea?.id, "stratum_v2_extended_jobs");
  assert.equal(plan.researchReview.ideas.find((idea) => idea.id === "stratum_v2_extended_jobs")?.routeable, true);
  assert.equal(plan.researchReview.ideas.find((idea) => idea.id === "stratum_v2_extended_jobs")?.deploymentLane, "dry_run");
  assert.ok(plan.researchReview.dryRunIdeaIds.includes("stratum_v2_extended_jobs"));
  assert.ok(plan.researchPolicy.dryRunIdeaIds.includes("stratum_v2_extended_jobs"));
  assert.match(plan.researchPolicy.deploymentSummary, /dry-run \d+/);
  assert.match(plan.researchPolicy.hashratePriority, /dry-run validation|release-gated/i);
  assert.equal(plan.researchPromotionGate.status, "review_required");
  assert.equal(plan.researchPromotionGate.runtimeProfilePromotionAllowed, true);
  assert.equal(plan.evidenceRoadmap.primaryPhase.id, "external_work_validation");
  assert.equal(plan.evidenceRoadmap.primaryPhase.status, "ready");
  assert.ok(plan.evidenceRoadmap.blockedPhaseIds.includes("research_frontier_filter"));
  assert.equal(roadmapPhase(plan, "research_frontier_filter").status, "blocked");
  assert.equal(plan.evidenceRoadmap.externalDryRunReady, true);
  assert.equal(plan.evidenceRoadmap.externalMiningAllowed, false);
  assert.equal(plan.samplingPlan.primaryTask.id, "external_work_dry_run");
  assert.equal(plan.samplingPlan.primaryTask.status, "ready");
  assert.equal(plan.samplingPlan.primaryTask.requiredShareEvents, 3);
});
test("algorithm planner keeps external dry-run waiting until local power evidence is measured", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: localAnalysis({
      powerEvidenceStatus: "estimated",
      powerEvidenceWeight: 0.8,
      powerEvidenceSummary: "Power evidence: estimated watts.",
    }),
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: bitaxeTelemetry({
      base_url: "http://future-rack.local",
      hostname: "future-rack.local",
      hash_rate_hs: 2_400_000_000_000,
      power_watts: 32,
      joules_per_terahash: 13,
      parallel_workers: 4,
    }),
    snapshotOverride: futureEngineSnapshot,
  }));

  assert.equal(plan.routeDecision?.status, "waiting");
  assert.equal(plan.routeDecision?.primaryRecommendation.reason, "need_local_samples");
  assert.equal(plan.routeDecision?.primaryAction.kind, "capture_local_sample");
  assert.equal(plan.recommendedRoute, "waiting");
  assert.equal(plan.strategy, "route_monitoring");
  assert.equal(plan.dryRunOnly, false);
  assert.equal(plan.algorithmStack.highHashPath, "waiting");
  assert.notEqual(plan.operatingEnvelope.recommendedPoint.role, "external_reference");
  assert.equal(plan.actions.find((action) => action.id === "route_action")?.status, "ready");
  assert.match(plan.actions.find((action) => action.id === "route_action")?.nextStep ?? "", /local tuning profile/i);
});
test("algorithm planner maps balanced local route to the power-density knee", () => {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 250_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
    { stepId: sweep.steps[2].id, hashrate: 1_000_000_000, watts: 100, powerEvidenceStatus: "measured", sampleSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 62 },
  ]);
  const plan = deriveMiningAlgorithmPlan(planInput({ analysis }));

  assert.notEqual(analysis.powerDensityKnee?.step.id, analysis.paretoRecommendation?.step.id);
  assert.equal(plan.operatingEnvelope.balanced.hashrate, analysis.powerDensityKnee?.qualityAdjustedHashrate);
  assert.match(plan.densityPlan.powerBudgetSummary, /frontier knee keeps/i);
  assert.equal(experiment(plan, "probe_power_density_knee").status, "done");
  assert.match(experiment(plan, "probe_power_density_knee").nextStep, /Keep|frontier knee/i);
});

test("algorithm planner keeps probing power-density knee until a marginal boundary is observed", () => {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
  ]);
  const plan = deriveMiningAlgorithmPlan(planInput({ analysis }));
  const probe = experiment(plan, "probe_power_density_knee");

  assert.equal(probe.status, "ready");
  assert.match(probe.nextStep, /next higher local tuning profile/i);
});

test("algorithm planner exposes a local operating envelope for power and hashrate", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    history: externalHistory({
      sampleCount: 0,
      onlineSampleCount: 0,
      efficiencySampleCount: 0,
      averageHashrate: 0,
      averageWatts: null,
      averageJoulesPerTerahash: null,
      bestJoulesPerTerahash: null,
    }),
  }));
  const envelope = plan.operatingEnvelope;

  assert.equal(envelope.points.length, 5);
  assert.equal(envelope.lowestPower.source, "local");
  assert.equal(envelope.lowestPower.status, "ready");
  assert.equal(envelope.lowestPower.watts, 8);
  assert.equal(envelope.maxHashrate.source, "local");
  assert.equal(envelope.maxHashrate.status, "ready");
  assert.equal(envelope.maxHashrate.hashrate, 410_000_000);
  assert.equal(envelope.externalReference.status, "waiting");
  assert.equal(envelope.recommendedPoint.source, "local");
  assert.equal(envelope.recommendedPoint.role, "lowest_power");
  assert.match(envelope.recommendationReason, /Hash Route Decision|lowest_power/i);
  assert.match(envelope.summary, /4\/4 local points ready/);
  assert.equal(plan.readinessCertificate.readyForUnattendedLocal, true);
  assert.equal(readinessGate(plan, "measured_power").status, "passed");
  assert.equal(readinessGate(plan, "share_quality").status, "passed");
  assert.equal(readinessGate(plan, "stability_window").status, "passed");
  assert.equal(readinessGate(plan, "thermal_safety").status, "passed");
});

test("algorithm planner keeps short local samples out of unattended readiness", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(240),
    history: externalHistory({
      sampleCount: 0,
      onlineSampleCount: 0,
      efficiencySampleCount: 0,
      averageHashrate: 0,
      averageWatts: null,
      averageJoulesPerTerahash: null,
      bestJoulesPerTerahash: null,
    }),
  }));
  const envelope = plan.operatingEnvelope;

  assert.equal(envelope.lowestPower.source, "local");
  assert.equal(envelope.lowestPower.status, "waiting");
  assert.match(envelope.lowestPower.nextStep, /15 minute runtime/i);
  assert.match(envelope.summary, /0\/4 local points ready/);
  assert.equal(plan.readinessCertificate.readyForUnattendedLocal, false);
  assert.equal(readinessGate(plan, "measured_power").status, "passed");
  assert.equal(readinessGate(plan, "share_quality").status, "passed");
  assert.equal(readinessGate(plan, "stability_window").status, "waiting");
  assert.match(readinessGate(plan, "stability_window").nextStep, /15 minute/i);
  assert.match(plan.riskFlags.join(" "), /15 minute runtime/i);
});
test("algorithm planner marks assignable external reference as dry-run in the operating envelope", () => {
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: bitaxeTelemetry({
      base_url: "http://future-rack.local",
      hostname: "future-rack.local",
      hash_rate_hs: 2_400_000_000_000,
      power_watts: 32,
      joules_per_terahash: 13,
      parallel_workers: 4,
    }),
    snapshotOverride: futureEngineSnapshot,
  }));

  assert.equal(plan.operatingEnvelope.externalReference.source, "external");
  assert.equal(plan.operatingEnvelope.externalReference.status, "dry-run");
  assert.equal(plan.operatingEnvelope.externalReference.hashrate, 1_200_000_000_000);
  assert.equal(plan.recommendedRoute, "local");
  assert.equal(plan.dryRunOnly, false);
  assert.equal(plan.algorithmStack.highHashPath, "local_runtime");
  assert.equal(plan.operatingEnvelope.recommendedPoint.source, "local");
  assert.equal(plan.operatingEnvelope.recommendedPoint.role, "lowest_power");
  assert.match(plan.operatingEnvelope.recommendationReason, /Hash Route Decision|lowest_power/i);
  assert.match(plan.operatingEnvelope.externalReference.nextStep, /mock leases|job lifecycle|pool share-submission/i);
});

test("algorithm planner does not promote raw external history as effective route throughput", () => {
  const rawHashrate = 50_000_000_000_000;
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    config: { external_hash_interface: "none" },
    history: externalHistory({
      averageHashrate: rawHashrate,
      averageWatts: 600,
      averageJoulesPerTerahash: 12,
      bestJoulesPerTerahash: 12,
    }),
  }));

  assert.equal(plan.canAssignExternalWork, false);
  assert.equal(plan.operatingEnvelope.externalReference.hashrate, null);
  assert.equal(plan.routeDecision?.primaryRecommendation.externalRawHashrate, rawHashrate);
  assert.equal(plan.routeDecision?.primaryRecommendation.externalHashrateBasis, "raw_average");
});

test("algorithm planner operating envelope discounts external reference by work-lease utilization", () => {
  const rawHashrate = 50_000_000_000_000_000_000;
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: bitaxeTelemetry({
      base_url: "http://future-rack.local",
      hostname: "future-rack.local",
      hash_rate_hs: rawHashrate,
      power_watts: 600_000,
      joules_per_terahash: 12,
      parallel_workers: 1,
    }),
    history: externalHistory({
      averageHashrate: rawHashrate,
      averageWatts: 600_000,
      averageJoulesPerTerahash: 12,
      bestJoulesPerTerahash: 12,
    }),
    snapshotOverride: futureEngineSnapshot,
  }));
  const externalDensityLane = plan.densityPlan.lanes.find((lane) => lane.id === "external_reference");

  assert.equal(plan.hardwareCandidate.hashWasteRisk, "high");
  assert.ok(plan.operatingEnvelope.externalReference.hashrate !== null);
  assert.ok(plan.operatingEnvelope.externalReference.hashrate < rawHashrate);
  assert.equal(plan.operatingEnvelope.externalReference.hashrate, externalDensityLane?.hashrate);
  assert.equal(plan.routeDecision?.primaryRecommendation.externalRawHashrate, rawHashrate);
  assert.ok(plan.routeDecision?.primaryRecommendation.externalHashrate !== null);
  assert.ok(Number(plan.routeDecision?.primaryRecommendation.externalHashrate) < rawHashrate);
});

test("algorithm planner uses external operating proof for planning metrics", () => {
  const proof = externalOperatingEvidence();
  const plan = deriveMiningAlgorithmPlan(planInput({
    analysis: envelopeAnalysis(),
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "bitaxe.local",
    },
    telemetry: bitaxeTelemetry({
      hash_rate_hs: 400_000_000_000,
      power_watts: 80,
      joules_per_terahash: 200,
    }),
    history: externalHistory({
      sampleCount: 1,
      onlineSampleCount: 1,
      efficiencySampleCount: 1,
      usableEfficiencySampleCount: 1,
      evidenceStatus: "probing",
      evidenceReady: false,
      evidenceGap: 2,
      averageHashrate: 400_000_000_000,
      averageWatts: 80,
      averageJoulesPerTerahash: 200,
      bestJoulesPerTerahash: 200,
      summary: "1/1 short telemetry sample; probing.",
    }),
    externalOperatingEvidence: proof,
  }));

  assert.equal(proof.releaseReady, true);
  assert.equal(plan.operatingEnvelope.externalReference.watts, 32);
  assert.equal(plan.operatingEnvelope.externalReference.joulesPerTerahash, proof.effectiveJoulesPerTerahash);
  assert.equal(plan.hardwareCandidate.hashrate, 2_400_000_000_000);
  assert.equal(plan.hardwareCandidate.joulesPerTerahash, proof.effectiveJoulesPerTerahash);
  assert.equal(readinessGate(plan, "external_efficiency_history").status, "passed");
  assert.match(plan.externalSummary, /operating proof/i);
  assert.match(plan.researchPolicy.lanes.find((lane) => lane.id === "network_telemetry")?.nextStep ?? "", /Operating proof/i);
});
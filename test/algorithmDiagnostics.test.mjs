import test from "node:test";
import assert from "node:assert/strict";

import {
  createMiningAlgorithmDiagnosticSnapshot,
  createMiningAlgorithmRuntimeSnapshot,
  formatMiningAlgorithmDiagnosticSnapshot,
} from "../.test-dist/domain/algorithmDiagnostics.js";
import { createTuningSweepPlan } from "../.test-dist/domain/efficiencyTuning.js";
import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import { deriveExternalHashWorkLeaseAssignment } from "../.test-dist/engines/externalHashWorkAdapter.js";

function baseInput(overrides = {}) {
  return {
    config: { external_hash_interface: "none" },
    telemetry: null,
    tuningObservations: [],
    externalHashHistory: [],
    goal: "balanced",
    generatedAt: "2026-07-02T00:00:00.000Z",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    ...overrides,
  };
}

function kernelBenchmarkOk(overrides = {}) {
  return {
    status: "ok",
    nonce_count: 2048,
    full_header_hashrate: 34_066,
    midstate_hashrate: 69_190,
    speedup_ratio: 2.03,
    checksum_hex: "0123456789abcdef",
    ...overrides,
  };
}

function telemetry(overrides = {}) {
  return {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Future",
    hostname: "bitaxe.local",
    hash_rate_hs: 1_200_000_000_000,
    power_watts: 18,
    joules_per_terahash: 15,
    temp_c: 58,
    vr_temp_c: 62,
    fan_rpm: 4200,
    mining_paused: false,
    generated_at: "2026-07-02T00:00:00.000Z",
    summary: "External telemetry: 1.2 TH/s at 18 W",
    ...overrides,
  };
}

function engineTelemetry(overrides = {}) {
  return telemetry({
    base_url: "http://future-rack.local",
    hostname: "future-rack.local",
    device_name: "Future Rack",
    hash_rate_hs: 2_400_000_000_000,
    power_watts: 32,
    joules_per_terahash: 13,
    parallel_workers: 4,
    engine_eligible: true,
    capabilities: ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"],
    summary: "Future rack declares dry-run hash-engine capabilities.",
    ...overrides,
  });
}

function externalHistory(count = 6, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    generatedAt: String(count - index),
    endpoint: "http://future-rack.local",
    status: "ok",
    hashrate: 2_400_000_000_000,
    watts: 32 + index,
    joulesPerTerahash: 13 + index * 0.1,
    tempC: 58 + index,
    vrTempC: 62 + index,
    fanRpm: 4200,
    acceptedShares: 3 + index,
    rejectedShares: 0,
    miningPaused: false,
    ...overrides,
  }));
}

function diagnosticTuningObservations(values) {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });
  return values.map((value, index) => ({
    stepId: sweep.steps[Math.min(index, sweep.steps.length - 1)].id,
    hashrate: value.hashrate,
    watts: value.watts,
    powerEvidenceStatus: "measured",
    sampleSeconds: 900,
    acceptedShares: 6,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    tempC: value.tempC ?? 58,
    ...value,
  }));
}

function externalOperatingSample(overrides = {}) {
  return {
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
    acceptedShares: 6,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    miningPaused: false,
    ...overrides,
  };
}

test("mining algorithm diagnostics preserve policy gates without leaking network endpoints", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "bitaxe.local",
      external_hash_polling_enabled: true,
      external_hash_poll_interval_seconds: 90,
    },
    telemetry: telemetry(),
    externalHashHistory: externalHistory(3, { endpoint: "http://bitaxe.local" }),
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);

  assert.match(snapshot.consensusBoundary, /double SHA-256/i);
  assert.equal(snapshot.algorithmStack.consensusHashing, "double_sha256");
  assert.equal(snapshot.algorithmStack.externalWorkPolicy, "disabled");
  assert.equal(snapshot.algorithmStack.frontierPolicy, "review_required");
  assert.equal(snapshot.routeCertificate.externalMiningAllowed, false);
  assert.equal(snapshot.routeCertificate.frontierClaimAllowed, false);
  assert.ok(snapshot.routeCertificate.forbiddenShortcutIdeaIds.includes("proof_of_work_compression"));
  assert.equal(snapshot.objectiveAudit.externalMiningAllowed, false);
  assert.equal(snapshot.objectiveAudit.latestResearchClaimAllowed, false);
  assert.ok(snapshot.objectiveAudit.requiredEvidenceIds.includes("frontier_research_refresh"));
  assert.match(snapshot.objectiveAudit.summary, /current local route|waiting/i);
  assert.ok(snapshot.algorithmStack.rejectedShortcutIdeaIds.includes("predictive_nonce_pruning"));
  assert.equal(snapshot.dryRunOnly, false);
  assert.equal(snapshot.canAssignExternalWork, false);
  assert.equal(snapshot.hardwareReleaseGate.status, "blocked");
  assert.equal(snapshot.hardwareReleaseGate.miningStartAllowed, false);
  assert.equal(snapshot.hardwareOperatingEvidence.status, "provisional");
  assert.equal(snapshot.hardwareOperatingEvidence.sampleCount, 3);
  assert.equal(snapshot.hardwareCandidate.workLeaseUniquePartitionRatio, 1);
  assert.equal(snapshot.hardwareCandidate.workLeaseRouteUtilizationRatio, snapshot.hardwareCandidate.workLeaseUtilizationRatio);
  assert.equal(snapshot.readiness.readyForExternalMining, false);
  assert.equal(snapshot.hardwareReleaseDossier.miningStartAllowed, false);
  assert.ok(snapshot.hardwareReleaseDossier.forbiddenOperations.includes("external_start_mining"));
  assert.equal(snapshot.hardwareMeasurementProtocol.primaryStep.id, "select_interface");
  assert.ok(snapshot.researchReview.rejectedIdeaIds.includes("predictive_nonce_pruning"));
  assert.equal(formatted.includes("workLeaseRouteUtilizationRatio"), true);
  assert.ok(snapshot.researchReview.rejectedIdeaIds.includes("proof_of_work_compression"));
  assert.equal(snapshot.researchFreshness.status, "review_due");
  assert.equal(snapshot.researchFreshness.frontierReviewDays, 90);
  assert.ok(snapshot.researchFreshness.frontierSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(snapshot.researchFreshness.frontierSourceIds.includes("hashprice_demand_response_2026"));
  assert.ok(snapshot.researchFreshness.reviewDueSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(snapshot.researchFreshness.reviewDueSourceIds.includes("neural_asic_tpf_2026"));
  assert.equal(snapshot.researchFreshness.reviewDueSourceIds.includes("hashprice_demand_response_2026"), false);
  assert.equal(snapshot.researchFreshness.reviewDueSourceIds.includes("quantum_sha256_resource_estimates"), false);
  assert.equal(snapshot.researchFreshness.undatedFrontierSourceIds.includes("quantum_sha256_resource_estimates"), false);
  assert.equal(snapshot.researchFreshness.latestPublishedAt, "2026-06-12");
  assert.match(snapshot.researchFreshness.nextStep, /Refresh/i);
  assert.equal(snapshot.researchPromotionGate.status, "review_required");
  assert.equal(snapshot.researchPromotionGate.frontierPromotionAllowed, false);
  assert.equal(snapshot.researchPromotionGate.runtimeProfilePromotionAllowed, true);
  assert.ok(snapshot.researchPromotionGate.blockedSourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(snapshot.researchPromotionGate.blockedSourceIds.includes("neural_asic_tpf_2026"));
  assert.equal(snapshot.researchPromotionGate.blockedSourceIds.includes("quantum_sha256_resource_estimates"), false);
  assert.equal(snapshot.researchPromotionGate.blockedSourceIds.includes("hashprice_demand_response_2026"), false);
  assert.ok(snapshot.researchPromotionGate.protectedRuntimeSourceIds.includes("bitcoin_consensus_pow"));
  assert.ok(snapshot.researchReview.sourceIds.includes("bip323_version_bits"));
  assert.match(snapshot.researchPromotionGate.summary, /measured local runtime profiles remain governed/i);
  assert.ok(snapshot.evidenceRoadmap.blockedPhaseIds.includes("research_frontier_filter"));
  assert.equal(snapshot.evidenceRoadmap.researchFrontierStatus, "blocked");
  assert.match(snapshot.evidenceRoadmap.researchFrontierNextStep ?? "", /Refresh/i);
  assert.ok(snapshot.offlineResearchGuard.isolatedIdeaIds.includes("thermodynamic_asic_prediction"));
  assert.equal(snapshot.offlineResearchGuard.productionInfluenceAllowed, false);
  assert.equal(snapshot.offlineResearchGuard.dryRunInfluenceAllowed, false);
  assert.equal(snapshot.offlineResearchGuard.routeInfluenceAllowed, false);
  assert.equal(snapshot.offlineResearchGuard.timingProbeExperimentId, "record_offline_timing_probe");
  assert.equal(snapshot.offlineResearchGuard.timingProbeStatus, "reserved");
  assert.match(snapshot.offlineResearchGuard.summary, /nonce pruning/i);
  assert.equal(snapshot.researchReview.sourceReferences.length, snapshot.researchReview.sourceCount);
  assert.ok(
    snapshot.researchReview.sourceReferences.some(
      (reference) =>
        reference.id === "bitcoin_consensus_pow" && /developer\.bitcoin\.org/.test(reference.referenceUrl ?? ""),
    ),
  );
  assert.ok(snapshot.researchReview.sourceReferences.every((reference) => reference.consensusBoundary.length > 0));
  assert.ok(snapshot.researchReview.sourceReferences.every((reference) => reference.sourcePolicy.length > 0));
  assert.match(
    snapshot.researchReview.sourceReferences.find((reference) => reference.id === "bip323_version_bits")?.algorithmImplication ?? "",
    /external-hash search-space/i,
  );
  assert.equal(
    snapshot.researchReview.sourceReferences.find((reference) => reference.id === "thermodynamic_sha256_asic_2026")?.publishedAt,
    "2026-01-05",
  );
  assert.match(
    snapshot.researchReview.sourceReferences.find((reference) => reference.id === "neural_asic_tpf_2026")?.sourcePolicy ?? "",
    /never use them to prune nonce ranges/i,
  );
  assert.ok(snapshot.operatingPolicy.guardrails.some((guardrail) => /nonce prediction/i.test(guardrail)));
  assert.equal(formatted.includes("\"algorithmStack\""), true);
  assert.equal(formatted.includes("\"routeCertificate\""), true);
  assert.equal(formatted.includes("\"researchFreshness\""), true);
  assert.equal(formatted.includes("\"researchPromotionGate\""), true);
  assert.equal(formatted.includes("\"offlineResearchGuard\""), true);
  assert.equal(formatted.includes("bitaxe.local"), false);
  assert.equal(formatted.includes("http://"), false);
});

test("mining algorithm diagnostics expose marginal density claim gates", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    tuningObservations: diagnosticTuningObservations([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 260_000_000, watts: 60, tempC: 63 },
    ]),
    algorithmKernelBenchmark: kernelBenchmarkOk(),
  }));

  assert.equal(snapshot.density.marginalDecisionStatus, "hold");
  assert.equal(snapshot.claimCertificate.highestHash.status, "blocked");
  assert.equal(snapshot.claimCertificate.highestHash.claimAllowed, false);
  assert.equal(snapshot.claimCertificate.highestHash.marginalDecisionStatus, "hold");
  assert.match(snapshot.density.marginalDecisionSummary, /hold/i);
  assert.equal(snapshot.objectiveCertificate.status, "partial");
  assert.equal(snapshot.objectiveCertificate.lowPowerReady, true);
  assert.equal(snapshot.objectiveCertificate.highHashReady, false);
  assert.equal(snapshot.objectiveCertificate.highHashPath, "marginal_hold");
});

test("mining algorithm diagnostics certifies low-power density with manual max-hash burst", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    tuningObservations: diagnosticTuningObservations([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 410_000_000, watts: 30, tempC: 61 },
    ]),
    algorithmKernelBenchmark: kernelBenchmarkOk(),
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.objectiveCertificate.status, "ready");
  assert.equal(snapshot.objectiveCertificate.runtimeMode, "density_with_manual_burst");
  assert.equal(snapshot.objectiveCertificate.lowPowerReady, true);
  assert.equal(snapshot.objectiveCertificate.highHashReady, true);
  assert.equal(snapshot.objectiveCertificate.maxHashBurstAvailable, true);
  assert.equal(snapshot.objectiveCertificate.externalMiningAllowed, false);
  assert.equal(snapshot.objectiveCertificate.highHashPath, "manual_burst");
  assert.equal(snapshot.objectiveAudit.stage, "local_density_manual_burst");
  assert.equal(snapshot.objectiveAudit.runtimeStable, true);
  assert.equal(snapshot.objectiveAudit.lowPowerClaimAllowed, true);
  assert.equal(snapshot.objectiveAudit.highHashClaimAllowed, true);
  assert.equal(snapshot.objectiveAudit.fullObjectiveClaimAllowed, true);
  assert.equal(snapshot.objectiveAudit.currentAlgorithm, "double_sha256_midstate");
  assert.match(snapshot.objectiveAudit.summary, /manual burst/i);
  assert.equal(snapshot.objectiveActionPlan.action, "keep_manual_burst_available");
  assert.equal(snapshot.profileApplyGates.best_hashrate.canApply, true);
  assert.equal(snapshot.profileApplyGates.best_hashrate.manualApprovalRequired, true);
  assert.equal(snapshot.researchPromotionGate.frontierPromotionAllowed, false);
  assert.equal(snapshot.researchPromotionGate.runtimeProfilePromotionAllowed, true);
  assert.equal(snapshot.evidenceRoadmap.researchFrontierStatus, "blocked");
  assert.equal(snapshot.objectiveCertificate.marginalDensityRetentionThreshold, 0.55);
  assert.match(snapshot.objectiveCertificate.summary, /manual burst/i);
  assert.equal(formatted.includes("\"objectiveCertificate\""), true);
  assert.equal(formatted.includes("\"objectiveActionPlan\""), true);
  assert.equal(formatted.includes("\"profileApplyGates\""), true);
});

test("mining algorithm diagnostics blocks high-hash promotion when midstate benchmark regresses", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    tuningObservations: diagnosticTuningObservations([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 410_000_000, watts: 30, tempC: 61 },
    ]),
    algorithmKernelBenchmark: kernelBenchmarkOk({
      full_header_hashrate: 20_000,
      midstate_hashrate: 10_000,
      speedup_ratio: 0.5,
    }),
  }));

  assert.equal(snapshot.kernelBenchmark.status, "passed");
  assert.equal(snapshot.kernelBenchmark.performance, "regression");
  assert.equal(snapshot.algorithmStack.localKernel.mode, "midstate_regression");
  assert.equal(snapshot.algorithmStack.localKernel.status, "done");
  assert.equal(snapshot.routeCertificate.defaultAlgorithm, "double_sha256_full_header");
  assert.equal(snapshot.routeCertificate.localKernelMode, "midstate_regression");
  assert.equal(snapshot.objectiveAudit.currentAlgorithm, "double_sha256_full_header");
  assert.equal(snapshot.objectiveAudit.highHashClaimAllowed, false);
  assert.equal(snapshot.researchReview.productionIdeaIds.includes("midstate_reuse"), false);
  assert.match(snapshot.riskFlags.join(" "), /performance regression/i);
  assert.equal(snapshot.operatingPolicy.kernelPromotionAllowed, false);
  assert.equal(snapshot.operatingPolicy.burstAllowed, false);
  assert.equal(snapshot.objectiveCertificate.status, "partial");
  assert.equal(snapshot.objectiveCertificate.lowPowerReady, true);
  assert.equal(snapshot.objectiveCertificate.highHashReady, false);
  assert.equal(snapshot.objectiveCertificate.highHashPath, "kernel_regression");
  assert.equal(snapshot.profileApplyGates.best_hashrate.canApply, false);
  assert.match(snapshot.objectiveCertificate.summary, /midstate benchmark regresses/i);
});

test("mining algorithm diagnostics keep direct endpoints reserved and redacted", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    config: {
      external_hash_interface: "direct",
      external_hash_direct_port: "COM7",
      external_hash_direct_endpoint: "COM7",
    },
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.hardwareCandidate.status, "reserved");
  assert.equal(snapshot.hardwareReleaseGate.status, "blocked");
  assert.equal(snapshot.hardwareOperatingEvidence.status, "missing");
  assert.equal(snapshot.readiness.readyForExternalMining, false);
  assert.ok(snapshot.hardwareReleaseDossier.missingEvidenceIds.includes("protocol_contract"));
  assert.equal(snapshot.hardwareMeasurementProtocol.primaryStep.id, "select_interface");
  assert.ok(snapshot.researchReview.sourceIds.includes("thermodynamic_sha256_asic_2026"));
  assert.ok(snapshot.operatingPolicy.sourceIds.includes("sha256_uniform_search"));
  assert.equal(formatted.includes("COM7"), false);
});

test("mining algorithm diagnostics threads dry-run validation without opening external mining", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: engineTelemetry(),
    externalHashHistory: externalHistory(),
    tuningObservations: diagnosticTuningObservations([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 500_000_000, watts: 30, tempC: 62 },
    ]),
    algorithmKernelBenchmark: kernelBenchmarkOk(),
  }));
  const workValidation = snapshot.hardwareReleaseGate.checks.find((check) => check.id === "external_work_validation");

  assert.equal(snapshot.canAssignExternalWork, false);
  assert.equal(snapshot.dryRunOnly, false);
  assert.notEqual(snapshot.algorithmStack.highHashPath, "external_dry_run");
  assert.equal(snapshot.algorithmStack.externalWorkPolicy, "disabled");
  assert.notEqual(snapshot.algorithmStack.defaultOperatingLane.source, "external");
  assert.notEqual(workValidation?.status, "passed");
  assert.equal(snapshot.hardwareOperatingEvidence.status, "provisional");
  assert.equal(snapshot.hardwareReleaseGate.status, "blocked");
  assert.equal(snapshot.hardwareReleaseGate.miningStartAllowed, false);
  assert.equal(snapshot.hardwareMeasurementProtocol.primaryStep.id, "prove_operating_evidence");
  assert.equal(snapshot.readiness.readyForExternalMining, false);
});

test("mining algorithm diagnostics accepts external adapter share proof but keeps release gated", () => {
  const config = {
    external_hash_interface: "network",
    external_hash_network_host: "future-rack.local",
  };
  const report = engineTelemetry();
  const externalSnapshot = deriveExternalHashSnapshot(config, report);
  const matrix = deriveExternalHashCapabilityMatrix(externalSnapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(externalSnapshot, {
    jobId: "dry-run-validation",
    generation: 1,
    workerIndex: 0,
    issuedAtMs: 0,
  }, matrix);
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    config,
    telemetry: report,
    externalHashHistory: externalHistory(),
    externalOperatingEvidenceSamples: [externalOperatingSample()],
    externalShareProofs: [{
      source: "external_adapter",
      result: "accepted",
      leaseId: assignment.leaseId,
      jobId: assignment.jobId,
      generation: assignment.generation,
      submittedAtMs: 1_000,
      acceptedAtMs: 1_100,
      shareDifficulty: 4_096,
    }],
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);
  const workValidation = snapshot.hardwareReleaseGate.checks.find((check) => check.id === "external_work_validation");

  assert.equal(workValidation?.status, "passed");
  assert.equal(snapshot.hardwareOperatingEvidence.status, "passed");
  assert.equal(snapshot.hardwareOperatingEvidence.effectiveHashrate, 2_400_000_000_000);
  assert.equal(Math.round(Number(snapshot.hardwareOperatingEvidence.effectiveJoulesPerTerahash)), 13);
  assert.equal(formatted.includes("\"hardwareOperatingEvidence\""), true);
  assert.equal(formatted.includes("\"effectiveJoulesPerTerahash\""), true);
  assert.equal(snapshot.hardwareReleaseGate.status, "release_candidate");
  assert.equal(snapshot.hardwareReleaseGate.miningStartAllowed, false);
  assert.deepEqual(snapshot.hardwareReleaseDossier.missingEvidenceIds, ["release_review", "engine_release_flag"]);
  assert.equal(snapshot.hardwareMeasurementProtocol.primaryStep.id, "review_release");
  assert.equal(snapshot.readiness.readyForExternalMining, false);
});
test("mining algorithm diagnostics blocks midstate readiness when kernel benchmark fails", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    algorithmKernelBenchmark: {
      status: "error",
      note: "midstate hash mismatch at nonce 7",
    },
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.kernelBenchmark.status, "blocked");
  assert.equal(snapshot.kernelBenchmark.midstateReady, false);
  assert.equal(snapshot.objectiveCertificate.highHashPath, "kernel_blocked");
  assert.equal(snapshot.objectiveAudit.stage, "runtime_recovery");
  assert.ok(snapshot.objectiveAudit.requiredEvidenceIds.includes("consensus_midstate"));
  assert.equal(snapshot.readiness.primaryMissingGateId, "consensus_midstate");
  assert.equal(formatted.includes("\"kernelBenchmark\""), true);
  assert.equal(snapshot.riskFlags.some((flag) => /midstate/i.test(flag)), true);
});

test("mining algorithm diagnostics waits for midstate benchmark before readiness", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    tuningObservations: diagnosticTuningObservations([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
    ]),
  }));

  assert.equal(snapshot.kernelBenchmark.status, "waiting");
  assert.equal(snapshot.readiness.primaryMissingGateId, "consensus_midstate");
  assert.equal(snapshot.objectiveCertificate.status, "waiting");
  assert.equal(snapshot.objectiveCertificate.highHashPath, "kernel_evidence_wait");
  assert.equal(snapshot.operatingPolicy.kernelOptimization.mode, "midstate_evidence_wait");
  assert.equal(snapshot.operatingPolicy.kernelPromotionAllowed, false);
  assert.equal(snapshot.operatingPolicy.autoApplyAllowed, false);
});

test("mining algorithm diagnostics accepts kernel benchmark evidence", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    algorithmKernelBenchmark: kernelBenchmarkOk(),
  }));

  assert.equal(snapshot.kernelBenchmark.status, "passed");
  assert.equal(snapshot.kernelBenchmark.performance, "faster");
  assert.equal(snapshot.kernelBenchmark.midstateReady, true);
  assert.equal(snapshot.operatingPolicy.kernelOptimization.mode, "midstate_density");
  assert.equal(snapshot.operatingPolicy.kernelOptimization.midstatePreferred, true);
  assert.equal(snapshot.readiness.primaryMissingGateId, "measured_power");
});
test("mining algorithm diagnostics includes live batch optimization evidence", () => {
  const snapshot = createMiningAlgorithmDiagnosticSnapshot(baseInput({
    goal: "max_hashrate",
    observedHashrate: 280_000_000,
    observedSampleSeconds: 900,
    observedComputeMode: "gpu",
    observedCpuThreads: 0,
    observedGpuIntensityPercent: 25,
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: 25,
    acceptedShares: 6,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 80,
    gpuThrottleMs: 0,
  }));
  const formatted = formatMiningAlgorithmDiagnosticSnapshot(snapshot);

  assert.equal(snapshot.batchOptimization.pressure, "underfilled");
  assert.equal(snapshot.batchOptimization.action, "increase_intensity");
  assert.equal(snapshot.batchOptimization.status, "ready");
  assert.equal(snapshot.batchOptimization.dispatchLatencyMs, 80);
  assert.equal(snapshot.batchOptimization.runtimeGuard, "clear");
  assert.equal(snapshot.batchOptimization.runtimePromotionAllowed, true);
  assert.equal(snapshot.batchOptimization.runtimeRecoveryAction, "allow_promotion");
  assert.equal(snapshot.batchOptimization.runtimeQualityLossHashrate, 0);
  assert.equal(snapshot.batchOptimization.runtimeThrottleHashrateAtRisk, 0);
  assert.equal(snapshot.batchOptimization.effectiveHashrate, 280_000_000);
  assert.equal(snapshot.batchOptimization.wastedHashrate, 0);
  assert.equal(snapshot.batchOptimization.gpuThrottleHashrateAtRisk, 0);
  assert.equal(snapshot.batchOptimization.effectiveRatio, 1);
  assert.equal(snapshot.batchOptimization.canApply, true);
  assert.equal(snapshot.profileApplyGates.batch_optimize.canApply, false);
  assert.match(snapshot.profileApplyGates.batch_optimize.summary, /objective action gate/i);
  assert.ok(Number(snapshot.batchOptimization.targetGpuIntensityPercent) > 25);
  assert.equal(formatted.includes('"batchOptimization"'), true);
  assert.equal(formatted.includes('"gpuDispatchMs"'), false);
});

test("mining algorithm runtime snapshot uses backend kernel benchmark for default route", () => {
  const snapshot = createMiningAlgorithmRuntimeSnapshot(baseInput({
    algorithmKernelBenchmark: kernelBenchmarkOk(),
  }));

  assert.equal(snapshot.routeCertificate.defaultAlgorithm, "double_sha256_midstate");
  assert.equal(snapshot.routeCertificate.localKernelMode, "midstate_reuse");
  assert.equal(snapshot.objectiveAudit.currentAlgorithm, "double_sha256_midstate");
});

test("mining algorithm runtime snapshot omits export-only hardware release diagnostics", () => {
  const snapshot = createMiningAlgorithmRuntimeSnapshot(baseInput({
    observedHashrate: 180_000_000,
    observedSampleSeconds: 600,
    observedComputeMode: "gpu",
    observedCpuThreads: 0,
    observedGpuIntensityPercent: 25,
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: 25,
    acceptedShares: 4,
  }));

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.routeCertificate.externalMiningAllowed, false);
  assert.equal(snapshot.runtimeRecommendation.externalMiningAllowed, false);
  assert.ok(snapshot.objectiveExperiment.capturePolicy);
  assert.ok(snapshot.objectiveAudit.currentAlgorithm);
  assert.ok(snapshot.claimCertificate.lowestPower);
  assert.equal(Object.hasOwn(snapshot, "hardwareReleaseGate"), false);
  assert.equal(Object.hasOwn(snapshot, "hardwareReleaseDossier"), false);
  assert.equal(Object.hasOwn(snapshot, "hardwareMeasurementProtocol"), false);
  assert.equal(Object.hasOwn(snapshot, "hardwareOperatingEvidence"), false);
});

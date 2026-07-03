import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmPowerHashEnvelope } from "../.test-dist/domain/algorithmPowerHashEnvelope.js";

function certificate(overrides = {}) {
  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    status: "ready",
    runtimeMode: "density_with_manual_burst",
    objectiveProgressScore: 100,
    lowPowerProgressScore: 100,
    highHashProgressScore: 100,
    primaryEvidenceGap: "none",
    consensusSafe: true,
    lowPowerReady: true,
    highHashReady: true,
    unattendedLocalAllowed: true,
    autoApplyAllowed: true,
    externalMiningAllowed: false,
    defaultProfileRole: "balanced",
    defaultProfileStatus: "ready",
    selectedLaneId: "gpu-eco",
    selectedLaneStatus: "ready",
    sustainableHashrate: 200_000_000,
    sustainableWatts: 10,
    sustainableJoulesPerTerahash: 50_000,
    powerBudgetWatts: 20,
    maxHashBurstAvailable: true,
    highHashPath: "manual_burst",
    burstHashrate: 500_000_000,
    burstWatts: 30,
    marginalDensityRetentionRatio: 0.75,
    marginalDensityRetentionThreshold: 0.55,
    primaryBlockerId: null,
    primaryBlockerSummary: null,
    sourceIds: ["bitcoin_consensus_pow", "measured_power_telemetry"],
    guardrails: [],
    summary: "Objective ready.",
    nextStep: "Run density, burst manually.",
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "balanced_density",
    action: "run_local_density",
    autoApplyAllowed: true,
    unattendedLocalAllowed: true,
    externalMiningAllowed: false,
    externalDryRunOnly: false,
    defaultPointRole: "balanced",
    defaultPointStatus: "ready",
    defaultPointHashrate: 200_000_000,
    defaultPointWatts: 10,
    defaultPointJoulesPerTerahash: 50_000,
    burstPointRole: "max_hashrate",
    burstAllowed: true,
    burstDecisionStatus: "advance",
    burstDensityRetentionRatio: 0.75,
    burstHashrate: 500_000_000,
    burstWatts: 30,
    runtimeGuard: "clear",
    runtimeEfficiencyStatus: "healthy",
    runtimeEffectiveHashrate: 200_000_000,
    runtimeEffectiveRatio: 1,
    runtimeShareWasteRatio: 0,
    runtimeGpuThrottleRatio: 0,
    kernelOptimization: {
      mode: "midstate_density",
      benchmarkStatus: "passed",
      benchmarkPerformance: "faster",
      midstatePreferred: true,
      speedupRatio: 1.2,
      summary: "midstate ok",
      nextStep: "keep benchmark",
    },
    kernelPromotionAllowed: true,
    sourceIds: ["bitcoin_consensus_pow", "measured_power_telemetry"],
    guardrails: [],
    summary: "Operating policy defaults to density with manual burst.",
    nextStep: "Run density lane.",
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "manual_burst",
    priority: "manual",
    selectedIntent: "best_hashrate",
    canApplyProfile: true,
    manualApprovalRequired: true,
    autoApplyAllowed: false,
    protectsLowPowerLane: true,
    opensHighHashBurst: true,
    externalMiningAllowed: false,
    targetStepId: "gpu-max",
    targetStepSummary: "GPU max",
    targetComputeMode: null,
    targetCpuThreads: null,
    targetGpuIntensityPercent: null,
    defaultPointRole: "balanced",
    defaultPointHashrate: 200_000_000,
    defaultPointWatts: 10,
    burstAllowed: true,
    burstHashrate: 500_000_000,
    burstWatts: 30,
    guardrails: [],
    summary: "Manual burst ready.",
    nextStep: "Burst manually.",
    ...overrides,
  };
}

test("power hash envelope waits for a measured low-power density lane", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ lowPowerReady: false, highHashReady: false, status: "waiting", sustainableHashrate: null, sustainableWatts: null, maxHashBurstAvailable: false }),
    operatingPolicy: policy({ burstAllowed: false, burstHashrate: null, burstWatts: null }),
    runtimeRecommendation: runtime({ opensHighHashBurst: false }),
  });

  assert.equal(envelope.mode, "evidence_wait");
  assert.equal(envelope.status, "waiting");
  assert.equal(envelope.projectedAverageHashrate, null);
  assert.match(envelope.nextStep, /density|run/i);
});

test("power hash envelope stays density-only when high hash burst is not open", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ highHashReady: false, maxHashBurstAvailable: false, highHashPath: "marginal_hold", burstHashrate: null, burstWatts: null }),
    operatingPolicy: policy({ burstAllowed: false, burstHashrate: null, burstWatts: null, burstDecisionStatus: "hold" }),
    runtimeRecommendation: runtime({ mode: "hold_high_hash", opensHighHashBurst: false, canApplyProfile: false }),
  });

  assert.equal(envelope.mode, "density_only");
  assert.equal(envelope.defaultDutyPercent, 100);
  assert.equal(envelope.burstDutyPercent, 0);
  assert.equal(envelope.projectedAverageHashrate, 200_000_000);
  assert.equal(envelope.canUseBurst, false);
});

test("power hash envelope calculates average-watt burst duty", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ powerBudgetWatts: 20 }),
    operatingPolicy: policy(),
    runtimeRecommendation: runtime(),
  });

  assert.equal(envelope.mode, "budgeted_burst");
  assert.equal(envelope.status, "manual");
  assert.equal(envelope.defaultDutyPercent, 50);
  assert.equal(envelope.burstDutyPercent, 50);
  assert.equal(envelope.projectedAverageHashrate, 350_000_000);
  assert.equal(envelope.projectedAverageWatts, 20);
  assert.equal(envelope.incrementalHashrate, 150_000_000);
  assert.equal(envelope.incrementalWatts, 10);
  assert.equal(envelope.canUseBurst, true);
  assert.equal(envelope.manualApprovalRequired, true);
  assert.ok(Number(envelope.powerSavedVsAlwaysBurstPercent) > 30);
});

test("power hash envelope keeps verified burst manual when no budget exists", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ powerBudgetWatts: null }),
    operatingPolicy: policy(),
    runtimeRecommendation: runtime(),
  });

  assert.equal(envelope.mode, "manual_burst_window");
  assert.equal(envelope.burstDutyPercent, 0);
  assert.equal(envelope.canUseBurst, true);
  assert.equal(envelope.manualApprovalRequired, true);
  assert.match(envelope.summary, /no average power budget/i);
});

test("power hash envelope allows full manual burst only when budget covers measured burst watts", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ powerBudgetWatts: 35 }),
    operatingPolicy: policy(),
    runtimeRecommendation: runtime(),
  });

  assert.equal(envelope.mode, "manual_burst_window");
  assert.equal(envelope.burstDutyPercent, 100);
  assert.equal(envelope.projectedAverageHashrate, 500_000_000);
  assert.equal(envelope.projectedAverageWatts, 30);
  assert.equal(envelope.canUseBurst, true);
});

test("power hash envelope promotes a higher-hash profile when it does not raise watts", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ sustainableHashrate: 200_000_000, sustainableWatts: 18, burstHashrate: 520_000_000, burstWatts: 18, powerBudgetWatts: 18 }),
    operatingPolicy: policy(),
    runtimeRecommendation: runtime({ mode: "run_density_default", selectedIntent: "best_hashrate", canApplyProfile: true, manualApprovalRequired: false, autoApplyAllowed: true, opensHighHashBurst: false }),
  });

  assert.equal(envelope.mode, "dominant_high_hash_density");
  assert.equal(envelope.status, "ready");
  assert.equal(envelope.defaultHashrate, 520_000_000);
  assert.equal(envelope.defaultWatts, 18);
  assert.equal(envelope.burstHashrate, null);
  assert.equal(envelope.burstDutyPercent, 0);
  assert.equal(envelope.projectedAverageHashrate, 520_000_000);
  assert.equal(envelope.incrementalHashrate, 320_000_000);
  assert.equal(envelope.incrementalWatts, 0);
  assert.equal(envelope.canUseBurst, false);
  assert.equal(envelope.manualApprovalRequired, false);
});
test("power hash envelope blocks promotion when runtime guard blocks", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ status: "blocked" }),
    operatingPolicy: policy({ mode: "runtime_guard", runtimeGuard: "block", summary: "guard blocks", nextStep: "Reduce waste." }),
    runtimeRecommendation: runtime({ mode: "runtime_guard", opensHighHashBurst: false }),
  });

  assert.equal(envelope.mode, "runtime_guard");
  assert.equal(envelope.status, "blocked");
  assert.equal(envelope.canUseBurst, false);
  assert.match(envelope.nextStep, /reduce waste/i);
});

test("power hash envelope keeps external high-hash in dry-run", () => {
  const envelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate: certificate({ status: "dry_run", runtimeMode: "external_dry_run", externalMiningAllowed: false }),
    operatingPolicy: policy({ mode: "external_dry_run", externalDryRunOnly: true, burstAllowed: false }),
    runtimeRecommendation: runtime({ mode: "external_dry_run", opensHighHashBurst: false }),
  });

  assert.equal(envelope.mode, "external_dry_run");
  assert.equal(envelope.externalMiningAllowed, false);
  assert.match(envelope.nextStep, /external work routing/i);
});
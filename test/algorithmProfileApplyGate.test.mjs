import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmProfileApplyGate } from "../.test-dist/domain/algorithmProfileApplyGate.js";

function step(overrides = {}) {
  return {
    id: "gpu:25",
    order: 2,
    priority: "balanced",
    computeMode: "gpu",
    performancePreset: "normal",
    cpuThreads: 0,
    gpuIntensityPercent: 25,
    sampleSeconds: 60,
    estimatedHashrate: 220_000_000,
    estimatedWatts: 12,
    joulesPerTerahash: 54_545,
    summary: "GPU 25%",
    reason: "Measured density lane.",
    ...overrides,
  };
}

function certificate(overrides = {}) {
  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    status: "ready",
    runtimeMode: "density_with_manual_burst",
    consensusSafe: true,
    lowPowerReady: true,
    highHashReady: true,
    unattendedLocalAllowed: true,
    autoApplyAllowed: true,
    externalMiningAllowed: false,
    defaultProfileRole: "balanced",
    defaultProfileStatus: "ready",
    selectedLaneId: "local_power_budget",
    selectedLaneStatus: "ready",
    sustainableHashrate: 220_000_000,
    sustainableWatts: 12,
    sustainableJoulesPerTerahash: 54_545,
    powerBudgetWatts: 12,
    maxHashBurstAvailable: true,
    highHashPath: "manual_burst",
    burstHashrate: 410_000_000,
    burstWatts: 30,
    marginalDensityRetentionRatio: 0.72,
    marginalDensityRetentionThreshold: 0.55,
    primaryBlockerId: null,
    primaryBlockerSummary: null,
    sourceIds: ["measured_power_telemetry"],
    guardrails: [],
    summary: "Objective ready.",
    nextStep: "Keep density default and burst manual.",
    ...overrides,
  };
}

function actionPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "keep_manual_burst_available",
    priority: "high",
    localProfileApplyAllowed: false,
    applyTargetStepId: null,
    miningStartAllowed: false,
    externalMiningAllowed: false,
    reason: "Manual burst only.",
    evidenceToRecord: [],
    stopConditions: [],
    summary: "Keep manual burst.",
    nextStep: "Return to density on degradation.",
    ...overrides,
  };
}

function gate(overrides = {}) {
  return deriveAlgorithmProfileApplyGate({
    certificate: certificate(),
    actionPlan: actionPlan(),
    intent: "best_hashrate",
    baseCanApply: true,
    baseSummary: "Base ready.",
    baseNextStep: "Apply target.",
    currentStep: step({ id: "gpu:25", gpuIntensityPercent: 25, estimatedWatts: 12 }),
    targetStep: step({ id: "gpu:100", priority: "throughput", gpuIntensityPercent: 100, estimatedWatts: 30, summary: "GPU 100%" }),
    ...overrides,
  });
}

test("profile apply gate allows max hash only as verified manual burst", () => {
  const result = gate();

  assert.equal(result.canApply, true);
  assert.equal(result.manualApprovalRequired, true);
  assert.equal(result.raisesLoad, true);
  assert.equal(result.targetStepId, "gpu:100");
  assert.equal(result.targetStepSummary, "GPU 100%");
  assert.equal(result.targetComputeMode, "gpu");
  assert.equal(result.targetCpuThreads, 0);
  assert.equal(result.targetGpuIntensityPercent, 100);
  assert.match(result.summary, /manual burst/i);
});

test("profile apply gate allows best hash as verified density default when watts do not rise", () => {
  const result = gate({
    currentStep: step({ id: "gpu:25", gpuIntensityPercent: 25, estimatedWatts: 18 }),
    targetStep: step({ id: "gpu:100", priority: "throughput", gpuIntensityPercent: 100, estimatedWatts: 18, summary: "GPU 100% same watts" }),
  });

  assert.equal(result.canApply, true);
  assert.equal(result.manualApprovalRequired, false);
  assert.equal(result.raisesLoad, true);
  assert.equal(result.targetStepId, "gpu:100");
  assert.match(result.summary, /density default/i);
});
test("profile apply gate blocks max hash when marginal density says hold", () => {
  const result = gate({
    certificate: certificate({
      status: "partial",
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "marginal_hold",
      burstHashrate: null,
      burstWatts: null,
    }),
    actionPlan: actionPlan({
      action: "hold_max_hash",
      reason: "Extra watts do not pay.",
      nextStep: "Stay on density lane.",
    }),
  });

  assert.equal(result.canApply, false);
  assert.equal(result.manualApprovalRequired, true);
  assert.match(result.nextStep, /density/i);
});

test("profile apply gate allows lower-load recovery while runtime guard is blocked", () => {
  const result = gate({
    intent: "batch_optimize",
    certificate: certificate({
      status: "blocked",
      runtimeMode: "runtime_guard",
      primaryBlockerId: "runtime_guard",
    }),
    actionPlan: actionPlan({ action: "recover_runtime_guard" }),
    currentStep: step({ id: "gpu:100", gpuIntensityPercent: 100, estimatedWatts: 30 }),
    targetStep: step({ id: "gpu:25", gpuIntensityPercent: 25, estimatedWatts: 12 }),
  });

  assert.equal(result.canApply, true);
  assert.equal(result.raisesLoad, false);
  assert.match(result.summary, /runtime guard/i);
});

test("profile apply gate blocks batch load raises outside objective action", () => {
  const result = gate({
    intent: "batch_optimize",
    actionPlan: actionPlan({
      action: "keep_manual_burst_available",
      localProfileApplyAllowed: false,
    }),
  });

  assert.equal(result.canApply, false);
  assert.equal(result.raisesLoad, true);
  assert.match(result.summary, /cannot raise load/i);
});

test("profile apply gate blocks objective tune when action target is missing", () => {
  const result = gate({
    intent: "objective_tune",
    actionPlan: actionPlan({
      action: "capture_local_evidence",
      localProfileApplyAllowed: true,
      applyTargetStepId: null,
    }),
  });

  assert.equal(result.canApply, false);
  assert.match(result.summary, /objective action gate/i);
});
test("profile apply gate requires objective tune target to match action target", () => {
  const allowed = gate({
    intent: "objective_tune",
    actionPlan: actionPlan({
      action: "capture_local_evidence",
      localProfileApplyAllowed: true,
      applyTargetStepId: "gpu:100",
    }),
  });
  const blocked = gate({
    intent: "objective_tune",
    actionPlan: actionPlan({
      action: "capture_local_evidence",
      localProfileApplyAllowed: true,
      applyTargetStepId: "gpu:50",
    }),
  });

  assert.equal(allowed.canApply, true);
  assert.equal(blocked.canApply, false);
});

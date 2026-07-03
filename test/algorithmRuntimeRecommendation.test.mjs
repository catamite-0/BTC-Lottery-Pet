import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmRuntimeRecommendation } from "../.test-dist/domain/algorithmRuntimeRecommendation.js";

function gate(intent, overrides = {}) {
  return {
    intent,
    canApply: false,
    manualApprovalRequired: false,
    raisesLoad: false,
    summary: `${intent} gate`,
    nextStep: `${intent} next`,
    ...overrides,
  };
}

function gates(overrides = {}) {
  return {
    objective_tune: gate("objective_tune"),
    batch_optimize: gate("batch_optimize"),
    lowest_power: gate("lowest_power", { canApply: true }),
    best_efficiency: gate("best_efficiency", { canApply: true }),
    best_hashrate: gate("best_hashrate", { manualApprovalRequired: true }),
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
    defaultPointHashrate: 180_000_000,
    defaultPointWatts: 11,
    defaultPointJoulesPerTerahash: 61_111,
    burstPointRole: "max_hashrate",
    burstAllowed: false,
    burstDecisionStatus: "none",
    burstDensityRetentionRatio: null,
    burstHashrate: null,
    burstWatts: null,
    runtimeGuard: "clear",
    runtimeEfficiencyStatus: "not_observed",
    runtimePromotionAllowed: true,
    runtimeRecoveryAction: "collect_evidence",
    runtimeQualityLossHashrate: null,
    runtimeThrottleHashrateAtRisk: null,
    runtimeEffectiveHashrate: null,
    runtimeEffectiveRatio: null,
    runtimeShareWasteRatio: null,
    runtimeGpuThrottleRatio: null,
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
    summary: "Operating policy defaults to density.",
    nextStep: "Run local density.",
    ...overrides,
  };
}

function feedback(overrides = {}) {
  return {
    schemaVersion: 1,
    status: "captured_ready",
    recommendation: "adopt_density",
    targetStepId: "gpu-eco",
    capturedStepId: "gpu-eco",
    capturedStepSummary: "GPU eco lane",
    capturedHashrate: 180_000_000,
    capturedWatts: 11,
    capturedQualityScore: 95,
    capturedLongRunRisk: "excellent",
    capturedStabilityWindowStatus: "stable",
    capturedShareEvidenceStatus: "proven",
    nextProfileStepId: null,
    nextProfileSummary: null,
    nextProfileComputeMode: null,
    nextProfileCpuThreads: null,
    nextProfileGpuIntensityPercent: null,
    missingEvidence: [],
    canPromote: true,
    summary: "Captured density lane.",
    nextStep: "Use density lane.",
    ...overrides,
  };
}

test("runtime recommendation captures the target objective profile before promotion", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ mode: "collect_evidence", action: "capture_evidence", autoApplyAllowed: false }),
    objectiveFeedback: feedback({
      status: "waiting_capture",
      recommendation: "capture_target",
      capturedStepId: null,
      capturedStepSummary: null,
      missingEvidence: ["target profile sample missing"],
      canPromote: false,
      nextStep: "Capture target profile.",
    }),
    profileApplyGates: gates({ objective_tune: gate("objective_tune", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "capture_evidence");
  assert.equal(recommendation.priority, "evidence");
  assert.equal(recommendation.selectedIntent, "objective_tune");
  assert.equal(recommendation.canApplyProfile, true);
  assert.equal(recommendation.externalMiningAllowed, false);
  assert.equal(recommendation.recoveryCooldownSeconds, null);
  assert.equal(recommendation.recoveryObservedSeconds, null);
  assert.equal(recommendation.recoveryCooldownRemainingSeconds, null);
  assert.equal(recommendation.recoveryResumeAllowed, false);
  assert.equal(recommendation.recoveryResumeCondition, null);
});

test("runtime recommendation retests thin evidence instead of widening the power envelope", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ autoApplyAllowed: false }),
    objectiveFeedback: feedback({
      status: "needs_retest",
      recommendation: "retest_target",
      missingEvidence: ["stability window incomplete", "measured watts missing"],
      canPromote: false,
      nextStep: "Retest the same profile.",
    }),
    profileApplyGates: gates({ objective_tune: gate("objective_tune", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "retest_profile");
  assert.equal(recommendation.priority, "evidence");
  assert.equal(recommendation.opensHighHashBurst, false);
  assert.match(recommendation.summary, /stability window incomplete/i);
  assert.ok(recommendation.guardrails.some((guardrail) => /power envelope/i.test(guardrail)));
});

test("runtime recommendation probes one next density profile when feedback opens the next lane", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ autoApplyAllowed: false }),
    objectiveFeedback: feedback({
      status: "captured_ready",
      recommendation: "probe_next_profile",
      nextProfileStepId: "gpu-balanced",
      nextProfileSummary: "GPU balanced lane",
      nextProfileComputeMode: "gpu",
      nextProfileCpuThreads: 0,
      nextProfileGpuIntensityPercent: 50,
      canPromote: false,
      nextStep: "Probe next profile.",
    }),
    profileApplyGates: gates({ objective_tune: gate("objective_tune", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "probe_next_profile");
  assert.equal(recommendation.targetStepId, "gpu-balanced");
  assert.equal(recommendation.targetGpuIntensityPercent, 50);
  assert.equal(recommendation.canApplyProfile, true);
});

test("runtime recommendation exposes max hash only as a manual burst", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({
      mode: "hashrate_burst",
      action: "probe_hashrate_headroom",
      autoApplyAllowed: false,
      burstAllowed: true,
      burstDecisionStatus: "advance",
      burstDensityRetentionRatio: 0.7,
      burstHashrate: 500_000_000,
      burstWatts: 30,
    }),
    objectiveFeedback: feedback({
      status: "advance_profile",
      recommendation: "manual_burst_ready",
      targetStepId: "gpu-max",
      capturedStepId: "gpu-max",
      capturedStepSummary: "GPU max lane",
      canPromote: true,
    }),
    profileApplyGates: gates({ best_hashrate: gate("best_hashrate", { canApply: true, manualApprovalRequired: true, raisesLoad: true }) }),
  });

  assert.equal(recommendation.mode, "manual_burst");
  assert.equal(recommendation.priority, "manual");
  assert.equal(recommendation.selectedIntent, "best_hashrate");
  assert.equal(recommendation.manualApprovalRequired, true);
  assert.equal(recommendation.autoApplyAllowed, false);
  assert.equal(recommendation.opensHighHashBurst, true);
});

test("runtime recommendation promotes no-extra-watt high hash as density default", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({
      mode: "hashrate_burst",
      action: "probe_hashrate_headroom",
      autoApplyAllowed: true,
      burstAllowed: true,
      burstDecisionStatus: "advance",
      burstDensityRetentionRatio: 1.2,
      defaultPointHashrate: 180_000_000,
      defaultPointWatts: 18,
      burstHashrate: 520_000_000,
      burstWatts: 18,
    }),
    objectiveFeedback: feedback({
      status: "advance_profile",
      recommendation: "manual_burst_ready",
      targetStepId: "gpu-max",
      capturedStepId: "gpu-max",
      capturedStepSummary: "GPU max lane",
      canPromote: true,
    }),
    profileApplyGates: gates({ best_hashrate: gate("best_hashrate", { canApply: true, manualApprovalRequired: false, raisesLoad: false }) }),
  });

  assert.equal(recommendation.mode, "run_density_default");
  assert.equal(recommendation.priority, "run");
  assert.equal(recommendation.selectedIntent, "best_hashrate");
  assert.equal(recommendation.canApplyProfile, true);
  assert.equal(recommendation.manualApprovalRequired, false);
  assert.equal(recommendation.autoApplyAllowed, true);
  assert.equal(recommendation.opensHighHashBurst, false);
  assert.match(recommendation.summary, /dominates/i);
});
test("runtime recommendation blocks kernel verification from density auto-run", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ action: "run_local_density", autoApplyAllowed: true, kernelPromotionAllowed: false }),
    objectiveFeedback: feedback({
      status: "verify_kernel_benchmark",
      recommendation: "verify_kernel_benchmark",
      targetStepId: null,
      canPromote: false,
      missingEvidence: ["fixed-window kernel benchmark"],
      summary: "Objective feedback: fixed-window midstate benchmark is required before runtime kernel promotion.",
      nextStep: "Run fixed-window kernel benchmark.",
    }),
    profileApplyGates: gates({ best_efficiency: gate("best_efficiency", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "monitor");
  assert.equal(recommendation.priority, "evidence");
  assert.equal(recommendation.canApplyProfile, false);
  assert.equal(recommendation.autoApplyAllowed, false);
  assert.equal(recommendation.selectedIntent, null);
  assert.match(recommendation.summary, /midstate benchmark/i);
  assert.ok(recommendation.guardrails.some((guardrail) => /full-header baseline/i.test(guardrail)));
});

test("runtime recommendation blocks kernel proof repair from profile promotion", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ action: "run_local_density", autoApplyAllowed: true, kernelPromotionAllowed: false }),
    objectiveFeedback: feedback({
      status: "repair_kernel_proof",
      recommendation: "repair_kernel_proof",
      targetStepId: null,
      canPromote: false,
      missingEvidence: ["midstate equivalence and performance proof"],
      summary: "Objective feedback: repair or rerun midstate proof before high-hash promotion.",
      nextStep: "Repair the midstate equivalence proof.",
    }),
    profileApplyGates: gates({ best_efficiency: gate("best_efficiency", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "monitor");
  assert.equal(recommendation.priority, "blocked");
  assert.equal(recommendation.canApplyProfile, false);
  assert.equal(recommendation.autoApplyAllowed, false);
  assert.match(recommendation.summary, /full-header mining active/i);
  assert.ok(recommendation.guardrails.some((guardrail) => /missing kernel proof/i.test(guardrail)));
});
test("runtime recommendation blocks local promotion while external route remains dry-run", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({
      mode: "external_dry_run",
      action: "validate_external_work",
      autoApplyAllowed: false,
      externalDryRunOnly: true,
    }),
    objectiveFeedback: feedback({
      status: "external_dry_run",
      recommendation: "external_dry_run",
      targetStepId: null,
      canPromote: false,
    }),
    profileApplyGates: gates({ objective_tune: gate("objective_tune", { canApply: true }) }),
  });

  assert.equal(recommendation.mode, "external_dry_run");
  assert.equal(recommendation.canApplyProfile, false);
  assert.equal(recommendation.externalMiningAllowed, false);
  assert.match(recommendation.guardrails.join(" "), /real work routing/i);
});

test("runtime recommendation lets runtime guard override otherwise ready gates", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({
      mode: "runtime_guard",
      action: "reduce_runtime_waste",
      autoApplyAllowed: false,
      runtimeGuard: "block",
      runtimePromotionAllowed: false,
      runtimeRecoveryAction: "lower_load",
      runtimeQualityLossHashrate: 120_000_000,
      runtimeThrottleHashrateAtRisk: 20_000_000,
      summary: "Runtime guard blocks profile promotion.",
      nextStep: "Reduce share waste.",
    }),
    objectiveFeedback: feedback({ recommendation: "manual_burst_ready", canPromote: true }),
    profileApplyGates: gates({
      best_hashrate: gate("best_hashrate", { canApply: true, manualApprovalRequired: true, raisesLoad: true }),
      lowest_power: gate("lowest_power", { canApply: true, raisesLoad: false, nextStep: "Apply lowest power recovery." }),
    }),
    runtimeSampleSeconds: 180,
  });

  assert.equal(recommendation.mode, "runtime_guard");
  assert.equal(recommendation.priority, "blocked");
  assert.equal(recommendation.selectedIntent, "lowest_power");
  assert.equal(recommendation.canApplyProfile, true);
  assert.equal(recommendation.protectsLowPowerLane, true);
  assert.equal(recommendation.recoveryCooldownSeconds, 300);
  assert.equal(recommendation.recoveryObservedSeconds, 180);
  assert.equal(recommendation.recoveryCooldownRemainingSeconds, 120);
  assert.equal(recommendation.recoveryResumeAllowed, false);
  assert.equal(recommendation.recoveryQualityLossHashrate, 120_000_000);
  assert.equal(recommendation.recoveryThrottleHashrateAtRisk, 20_000_000);
  assert.match(recommendation.recoveryResumeCondition ?? "", /share waste below 5%/i);
  assert.match(recommendation.nextStep, /lowest power recovery/i);
  assert.ok(recommendation.guardrails.some((guardrail) => /do not raise/i.test(guardrail)));
  assert.ok(recommendation.guardrails.some((guardrail) => /cooldown/i.test(guardrail)));
});
test("runtime recommendation fills adopted density target from selected apply gate", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ autoApplyAllowed: true }),
    objectiveFeedback: feedback({ recommendation: "adopt_density" }),
    profileApplyGates: gates({
      best_efficiency: gate("best_efficiency", {
        canApply: true,
        targetStepId: "gpu:25",
        targetStepSummary: "GPU 25% density lane",
        targetComputeMode: "gpu",
        targetCpuThreads: 0,
        targetGpuIntensityPercent: 25,
      }),
    }),
  });

  assert.equal(recommendation.mode, "run_density_default");
  assert.equal(recommendation.autoApplyAllowed, true);
  assert.equal(recommendation.selectedIntent, "best_efficiency");
  assert.equal(recommendation.targetStepId, "gpu-eco");
  assert.equal(recommendation.targetStepSummary, "GPU eco lane");
  assert.equal(recommendation.targetComputeMode, "gpu");
  assert.equal(recommendation.targetCpuThreads, 0);
  assert.equal(recommendation.targetGpuIntensityPercent, 25);
});
test("runtime recommendation does not auto-apply density when the selected profile gate is closed", () => {
  const recommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: policy({ autoApplyAllowed: true, nextStep: "Run local density." }),
    objectiveFeedback: feedback({ recommendation: "adopt_density" }),
    profileApplyGates: gates({
      best_efficiency: gate("best_efficiency", { canApply: false, nextStep: "Capture best efficiency evidence first." }),
      lowest_power: gate("lowest_power", { canApply: false, nextStep: "Capture lowest power evidence first." }),
    }),
  });

  assert.equal(recommendation.mode, "run_density_default");
  assert.equal(recommendation.selectedIntent, "lowest_power");
  assert.equal(recommendation.canApplyProfile, false);
  assert.equal(recommendation.autoApplyAllowed, false);
  assert.equal(recommendation.manualApprovalRequired, false);
  assert.match(recommendation.nextStep, /lowest power evidence/i);
});

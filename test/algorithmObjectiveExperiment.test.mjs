import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmObjectiveExperimentPlan } from "../.test-dist/domain/algorithmObjectiveExperiment.js";

function certificate(overrides = {}) {
  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    status: "waiting",
    runtimeMode: "collect_evidence",
    objectiveProgressScore: 41,
    lowPowerProgressScore: 35,
    highHashProgressScore: 50,
    primaryEvidenceGap: "low_power_evidence",
    consensusSafe: true,
    lowPowerReady: false,
    highHashReady: false,
    unattendedLocalAllowed: false,
    autoApplyAllowed: false,
    externalMiningAllowed: false,
    defaultProfileRole: "balanced",
    defaultProfileStatus: "waiting",
    selectedLaneId: "local_power_budget",
    selectedLaneStatus: "waiting",
    sustainableHashrate: null,
    sustainableWatts: null,
    sustainableJoulesPerTerahash: null,
    powerBudgetWatts: null,
    maxHashBurstAvailable: false,
    highHashPath: "needs_measurement",
    burstHashrate: null,
    burstWatts: null,
    marginalDensityRetentionRatio: null,
    marginalDensityRetentionThreshold: 0.55,
    primaryBlockerId: "measured_power",
    primaryBlockerSummary: "Measured watts are missing.",
    sourceIds: ["bitcoin_consensus_pow", "measured_power_telemetry"],
    guardrails: ["Keep consensus rules intact."],
    summary: "Waiting for evidence.",
    nextStep: "Capture measured watts.",
    ...overrides,
  };
}

function primaryTask(overrides = {}) {
  return {
    id: "local_measured_power",
    route: "local",
    status: "ready",
    requiredSeconds: 900,
    remainingSeconds: 900,
    requiredSamples: 1,
    remainingSamples: 1,
    requiredShareEvents: null,
    remainingShareEvents: null,
    requiresMeasuredPower: true,
    requiresCoolOrWarmThermals: false,
    objective: "Replace estimated watts.",
    successCriteria: "Measured watts from wall power or device telemetry.",
    nextStep: "Apply baseline and capture watts.",
    targetProfile: null,
    ...overrides,
  };
}

function samplingPlan(task = primaryTask()) {
  return {
    tasks: [task],
    primaryTask: task,
    readyTaskIds: [task.id],
    blockedTaskIds: [],
    totalEstimatedSeconds: task.remainingSeconds ?? 0,
    localRequiredSeconds: 900,
    externalRequiredSamples: 3,
    externalStableSampleTarget: 6,
    summary: "Sampling plan ready.",
    nextStep: task.nextStep,
  };
}

function directive(overrides = {}) {
  return {
    kind: "local_profile",
    route: "local",
    status: "ready",
    primaryTaskId: "local_measured_power",
    step: {
      id: "cpu:2",
      order: 0,
      computeMode: "cpu",
      cpuThreads: 2,
      gpuIntensityPercent: 0,
      estimatedHashrate: 100_000_000,
      estimatedWatts: 12,
      sampleSeconds: 900,
      priority: "baseline",
      summary: "CPU 2 threads",
      reason: "baseline low-power CPU profile",
    },
    applyTarget: {
      stepId: "cpu:2",
      computeMode: "cpu",
      cpuThreads: 2,
      gpuIntensityPercent: 0,
    },
    canApplyLocalProfile: true,
    requireMeasuredPower: true,
    requireCoolOrWarmThermals: false,
    requiredSeconds: 900,
    requiredSamples: 1,
    requiredShareEvents: null,
    summary: "Run CPU baseline.",
    nextStep: "Apply baseline and capture watts.",
    ...overrides,
  };
}

function actionPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "capture_local_evidence",
    priority: "high",
    localProfileApplyAllowed: true,
    applyTargetStepId: "cpu:2",
    miningStartAllowed: false,
    externalMiningAllowed: false,
    reason: "Measured watts are missing.",
    evidenceToRecord: ["low-power lane readiness"],
    stopConditions: ["runtime guard blocks profile promotion"],
    summary: "Capture local evidence.",
    nextStep: "Apply baseline and capture watts.",
    ...overrides,
  };
}

test("objective experiment turns a low-power gap into a local measured-power recipe", () => {
  const plan = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate(),
    samplingPlan: samplingPlan(),
    tuningDirective: directive(),
    actionPlan: actionPlan(),
  });

  assert.equal(plan.stage, "collect_low_power_evidence");
  assert.equal(plan.route, "local");
  assert.equal(plan.primaryTaskId, "local_measured_power");
  assert.equal(plan.targetProfileStepId, "cpu:2");
  assert.equal(plan.targetComputeMode, "cpu");
  assert.equal(plan.targetCpuThreads, 2);
  assert.equal(plan.requiredSeconds, 900);
  assert.equal(plan.canApplyLocalProfile, true);
  assert.equal(plan.miningStartAllowed, false);
  assert.ok(plan.evidenceChecklist.includes("15 minutes stable runtime window"));
  assert.ok(plan.evidenceChecklist.includes("measured wall or device watts"));
  assert.ok(plan.successCriteria.some((item) => /low-power evidence gap/i.test(item)));
  assert.ok(plan.stopConditions.some((item) => /thermal/i.test(item)));
});

test("objective experiment keeps max-hash hold as a no-apply density fallback", () => {
  const task = primaryTask({
    id: "local_power_density_probe",
    requiredShareEvents: 6,
    remainingShareEvents: 6,
    requiresCoolOrWarmThermals: true,
    objective: "Classify max-hash headroom.",
    successCriteria: "Classify marginal hash density.",
    targetProfile: "max_hashrate",
  });
  const plan = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({
      status: "partial",
      runtimeMode: "density_default",
      primaryEvidenceGap: "max_hash_marginal_hold",
      lowPowerReady: true,
      highHashReady: false,
      highHashPath: "marginal_hold",
    }),
    samplingPlan: samplingPlan(task),
    tuningDirective: directive({
      primaryTaskId: "local_power_density_probe",
      requiredShareEvents: 6,
      requireCoolOrWarmThermals: true,
      canApplyLocalProfile: false,
    }),
    actionPlan: actionPlan({
      action: "hold_max_hash",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["marginal density decision"],
      nextStep: "Stay on the selected density lane.",
    }),
  });

  assert.equal(plan.stage, "hold_high_hash");
  assert.equal(plan.canApplyLocalProfile, false);
  assert.equal(plan.objectiveGap, "max_hash_marginal_hold");
  assert.ok(plan.evidenceChecklist.includes("6 accepted/rejected/stale/drop share events"));
  assert.ok(plan.successCriteria.some((item) => /no automatic mining profile change/i.test(item)));
  assert.match(plan.nextStep, /density lane/i);
});

test("objective experiment keeps missing kernel benchmark as monitor-only proof work", () => {
  const task = primaryTask({
    id: "research_review",
    route: "research",
    requiredSeconds: null,
    remainingSeconds: null,
    requiredSamples: null,
    remainingSamples: null,
    requiredShareEvents: null,
    remainingShareEvents: null,
    requiresMeasuredPower: false,
    objective: "Validate midstate kernel benchmark.",
    successCriteria: "Run fixed-window midstate benchmark.",
    nextStep: "Run kernel benchmark.",
    targetProfile: null,
  });
  const plan = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({
      primaryEvidenceGap: "kernel_evidence_wait",
      highHashPath: "kernel_evidence_wait",
      nextStep: "Run fixed-window kernel benchmark.",
    }),
    samplingPlan: samplingPlan(task),
    tuningDirective: directive({
      kind: "research_review",
      route: "research",
      primaryTaskId: "research_review",
      step: null,
      applyTarget: null,
      canApplyLocalProfile: false,
      requireMeasuredPower: false,
      requiredSeconds: null,
      requiredSamples: null,
      requiredShareEvents: null,
      nextStep: "Run kernel benchmark.",
    }),
    actionPlan: actionPlan({
      action: "verify_kernel_benchmark",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["fixed-window kernel benchmark"],
      nextStep: "Run fixed-window kernel benchmark.",
    }),
  });

  assert.equal(plan.stage, "verify_kernel_benchmark");
  assert.equal(plan.capturePolicy.mode, "monitor_only");
  assert.equal(plan.canApplyLocalProfile, false);
  assert.equal(plan.capturePolicy.applyBeforeCapture, false);
  assert.ok(plan.successCriteria.some((item) => /fixed-window midstate benchmark/i.test(item)));
  assert.ok(plan.stopConditions.some((item) => /not fixed-window/i.test(item)));
});

test("objective experiment repairs blocked kernel proof without applying a profile", () => {
  const task = primaryTask({
    id: "research_review",
    route: "research",
    requiredSeconds: null,
    remainingSeconds: null,
    requiredSamples: null,
    remainingSamples: null,
    requiredShareEvents: null,
    remainingShareEvents: null,
    requiresMeasuredPower: false,
    objective: "Repair midstate kernel proof.",
    successCriteria: "Repair proof or keep full-header fallback.",
    nextStep: "Repair kernel proof.",
    targetProfile: null,
  });
  const plan = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({
      primaryEvidenceGap: "kernel_blocked",
      highHashPath: "kernel_blocked",
      highHashReady: false,
      nextStep: "Repair the midstate equivalence proof.",
    }),
    samplingPlan: samplingPlan(task),
    tuningDirective: directive({
      kind: "research_review",
      route: "research",
      primaryTaskId: "research_review",
      step: null,
      applyTarget: null,
      canApplyLocalProfile: false,
      requireMeasuredPower: false,
      requiredSeconds: null,
      requiredSamples: null,
      requiredShareEvents: null,
      nextStep: "Repair kernel proof.",
    }),
    actionPlan: actionPlan({
      action: "repair_kernel_proof",
      priority: "critical",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["midstate equivalence and performance proof"],
      nextStep: "Repair the midstate equivalence proof.",
    }),
  });

  assert.equal(plan.stage, "repair_kernel_proof");
  assert.equal(plan.capturePolicy.mode, "monitor_only");
  assert.equal(plan.canApplyLocalProfile, false);
  assert.ok(plan.successCriteria.some((item) => /full-header baseline/i.test(item)));
  assert.ok(plan.stopConditions.some((item) => /equivalence proof fails|checksum mismatch/i.test(item)));
});
test("objective experiment isolates external work validation from real mining start", () => {
  const task = primaryTask({
    id: "external_work_dry_run",
    route: "external",
    requiredSeconds: null,
    remainingSeconds: null,
    requiredShareEvents: 6,
    remainingShareEvents: 6,
    objective: "Validate external work lifecycle.",
    successCriteria: "Dry-run leases are unique and stale results are rejected.",
  });
  const plan = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({
      status: "dry_run",
      runtimeMode: "external_dry_run",
      primaryEvidenceGap: "external_dry_run",
      highHashPath: "external_dry_run",
    }),
    samplingPlan: samplingPlan(task),
    tuningDirective: directive({
      kind: "external_dry_run",
      route: "external",
      primaryTaskId: "external_work_dry_run",
      step: null,
      applyTarget: null,
      canApplyLocalProfile: false,
      requiredSeconds: null,
      requiredShareEvents: 6,
    }),
    actionPlan: actionPlan({
      action: "validate_external_dry_run",
      priority: "critical",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["external dry-run share accounting"],
      nextStep: "Validate mock leases and share accounting.",
    }),
  });

  assert.equal(plan.stage, "validate_external_dry_run");
  assert.equal(plan.route, "external");
  assert.equal(plan.externalMiningAllowed, false);
  assert.equal(plan.miningStartAllowed, false);
  assert.equal(plan.targetProfileStepId, null);
  assert.ok(plan.successCriteria.some((item) => /Dry-run leases/i.test(item)));
});
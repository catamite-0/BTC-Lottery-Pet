import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmObjectiveFeedback } from "../.test-dist/domain/algorithmObjectiveFeedback.js";
import { deriveAlgorithmObjectiveExperimentPlan } from "../.test-dist/domain/algorithmObjectiveExperiment.js";
import { analyzeTuningObservations, createTuningSweepPlan } from "../.test-dist/domain/efficiencyTuning.js";

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

function samplingTask(step, overrides = {}) {
  return {
    id: "local_measured_power",
    route: "local",
    status: "ready",
    requiredSeconds: 120,
    remainingSeconds: 120,
    requiredSamples: 1,
    remainingSamples: 1,
    requiredShareEvents: 6,
    remainingShareEvents: 6,
    requiresMeasuredPower: true,
    requiresCoolOrWarmThermals: true,
    objective: "Capture objective profile.",
    successCriteria: "Measured watts, share evidence, and safe thermals.",
    nextStep: "Capture objective profile.",
    targetProfile: null,
    ...overrides,
  };
}

function samplingPlan(task) {
  return {
    tasks: [task],
    primaryTask: task,
    readyTaskIds: [task.id],
    blockedTaskIds: [],
    totalEstimatedSeconds: task.remainingSeconds ?? 0,
    localRequiredSeconds: task.requiredSeconds ?? 120,
    externalRequiredSamples: 3,
    externalStableSampleTarget: 6,
    summary: "Sampling plan ready.",
    nextStep: task.nextStep,
  };
}

function directive(step, overrides = {}) {
  return {
    kind: "local_profile",
    route: "local",
    status: "ready",
    primaryTaskId: "local_measured_power",
    step,
    applyTarget: {
      stepId: step.id,
      computeMode: step.computeMode,
      cpuThreads: step.cpuThreads,
      gpuIntensityPercent: step.gpuIntensityPercent,
    },
    canApplyLocalProfile: true,
    requireMeasuredPower: true,
    requireCoolOrWarmThermals: true,
    requiredSeconds: 120,
    requiredSamples: 1,
    requiredShareEvents: 6,
    summary: "Run objective profile.",
    nextStep: "Apply target and capture evidence.",
    ...overrides,
  };
}

function actionPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    action: "capture_local_evidence",
    priority: "high",
    localProfileApplyAllowed: true,
    applyTargetStepId: "target",
    miningStartAllowed: false,
    externalMiningAllowed: false,
    reason: "Capture missing evidence.",
    evidenceToRecord: ["low-power lane readiness"],
    stopConditions: ["runtime guard blocks profile promotion"],
    summary: "Capture local evidence.",
    nextStep: "Apply target and capture evidence.",
    ...overrides,
  };
}

function experimentFor(step, overrides = {}) {
  return deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate(overrides.certificate ?? {}),
    samplingPlan: samplingPlan(samplingTask(step, overrides.task ?? {})),
    tuningDirective: directive(step, overrides.directive ?? {}),
    actionPlan: actionPlan(overrides.action ?? {}),
  });
}

test("objective feedback waits for the target profile capture", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 3, sampleSeconds: 120 });
  const experiment = experimentFor(sweep.steps[0]);
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analyzeTuningObservations(sweep, []) });

  assert.equal(feedback.status, "waiting_capture");
  assert.equal(feedback.recommendation, "capture_target");
  assert.equal(feedback.targetStepId, sweep.steps[0].id);
  assert.ok(feedback.missingEvidence.includes("target profile sample missing"));
});

test("objective feedback retests incomplete or thin evidence before moving profile", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 3, sampleSeconds: 120 });
  const experiment = experimentFor(sweep.steps[0]);
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "estimated", sampleSeconds: 30, acceptedShares: 0, rejectedShares: 0 },
  ]);
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analysis });

  assert.equal(feedback.status, "needs_retest");
  assert.equal(feedback.recommendation, "retest_target");
  assert.ok(feedback.missingEvidence.includes("measured watts missing"));
  assert.ok(feedback.missingEvidence.includes("share evidence missing"));
});

test("objective feedback recommends the next unmeasured profile after a good local sample", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 3, sampleSeconds: 120 });
  const experiment = experimentFor(sweep.steps[0]);
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 120_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 300, acceptedShares: 6, rejectedShares: 0, tempC: 55 },
  ]);
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analysis });

  assert.equal(feedback.status, "captured_ready");
  assert.equal(feedback.recommendation, "probe_next_profile");
  assert.equal(feedback.nextProfileStepId, sweep.steps[1].id);
  assert.equal(feedback.canPromote, false);
});

test("objective feedback marks high-hash headroom as manual burst only after complete evidence", () => {
  const sweep = createTuningSweepPlan({ goal: "max_hashrate", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 3, sampleSeconds: 120 });
  const target = sweep.steps[sweep.steps.length - 1];
  const experiment = experimentFor(target, {
    task: { id: "local_power_density_probe", targetProfile: "max_hashrate" },
    action: { action: "measure_burst_headroom", applyTargetStepId: target.id },
    certificate: { status: "partial", runtimeMode: "density_default", lowPowerReady: true, primaryEvidenceGap: "high_hash_measurement" },
  });
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: target.id, hashrate: 420_000_000, watts: 28, powerEvidenceStatus: "measured", sampleSeconds: 300, acceptedShares: 8, rejectedShares: 0, tempC: 58 },
  ]);
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analysis });

  assert.equal(feedback.status, "advance_profile");
  assert.equal(feedback.recommendation, "manual_burst_ready");
  assert.equal(feedback.canPromote, true);
  assert.match(feedback.nextStep, /manual burst/i);
});

test("objective feedback promotes no-extra-watt high hash as density feedback", () => {
  const sweep = createTuningSweepPlan({ goal: "max_hashrate", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 3, sampleSeconds: 120 });
  const baseline = sweep.steps[0];
  const target = sweep.steps[sweep.steps.length - 1];
  const experiment = experimentFor(target, {
    task: { id: "local_power_density_probe", targetProfile: "max_hashrate" },
    action: { action: "measure_burst_headroom", applyTargetStepId: target.id },
    certificate: { status: "partial", runtimeMode: "density_default", lowPowerReady: true, primaryEvidenceGap: "high_hash_measurement" },
  });
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: baseline.id, hashrate: 180_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds: 300, acceptedShares: 8, rejectedShares: 0, tempC: 55 },
    { stepId: target.id, hashrate: 520_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds: 300, acceptedShares: 8, rejectedShares: 0, tempC: 58 },
  ]);
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analysis });

  assert.equal(feedback.status, "advance_profile");
  assert.equal(feedback.recommendation, "adopt_density");
  assert.equal(feedback.canPromote, true);
  assert.match(feedback.summary, /current watt envelope/i);
  assert.match(feedback.nextStep, /default/i);
});

test("objective feedback surfaces kernel benchmark proof work without local sample noise", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 2, sampleSeconds: 120 });
  const task = samplingTask(sweep.steps[0], {
    id: "research_review",
    route: "research",
    requiredSeconds: null,
    remainingSeconds: null,
    requiredSamples: null,
    remainingSamples: null,
    requiredShareEvents: null,
    remainingShareEvents: null,
    requiresMeasuredPower: false,
    requiresCoolOrWarmThermals: false,
    successCriteria: "Run fixed-window midstate benchmark.",
    nextStep: "Run fixed-window kernel benchmark.",
  });
  const experiment = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({ primaryEvidenceGap: "kernel_evidence_wait", highHashPath: "kernel_evidence_wait", nextStep: "Run fixed-window kernel benchmark." }),
    samplingPlan: samplingPlan(task),
    tuningDirective: {
      kind: "research_review",
      route: "research",
      status: "ready",
      primaryTaskId: "research_review",
      step: null,
      applyTarget: null,
      canApplyLocalProfile: false,
      requireMeasuredPower: false,
      requireCoolOrWarmThermals: false,
      requiredSeconds: null,
      requiredSamples: null,
      requiredShareEvents: null,
      summary: "Review kernel benchmark evidence.",
      nextStep: "Run fixed-window kernel benchmark.",
    },
    actionPlan: actionPlan({
      action: "verify_kernel_benchmark",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["fixed-window kernel benchmark"],
      nextStep: "Run fixed-window kernel benchmark.",
    }),
  });
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analyzeTuningObservations(sweep, []) });

  assert.equal(feedback.status, "verify_kernel_benchmark");
  assert.equal(feedback.recommendation, "verify_kernel_benchmark");
  assert.equal(feedback.targetStepId, null);
  assert.ok(feedback.missingEvidence.includes("fixed-window kernel benchmark"));
  assert.ok(!feedback.missingEvidence.includes("target profile sample missing"));
  assert.match(feedback.summary, /midstate benchmark/i);
});

test("objective feedback surfaces kernel proof repair without local promotion", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 2, sampleSeconds: 120 });
  const task = samplingTask(sweep.steps[0], {
    id: "research_review",
    route: "research",
    requiredSeconds: null,
    remainingSeconds: null,
    requiredSamples: null,
    remainingSamples: null,
    requiredShareEvents: null,
    remainingShareEvents: null,
    requiresMeasuredPower: false,
    requiresCoolOrWarmThermals: false,
    successCriteria: "Repair proof or keep full-header fallback.",
    nextStep: "Repair kernel proof.",
  });
  const experiment = deriveAlgorithmObjectiveExperimentPlan({
    certificate: certificate({ primaryEvidenceGap: "kernel_blocked", highHashPath: "kernel_blocked", nextStep: "Repair the midstate equivalence proof." }),
    samplingPlan: samplingPlan(task),
    tuningDirective: {
      kind: "research_review",
      route: "research",
      status: "ready",
      primaryTaskId: "research_review",
      step: null,
      applyTarget: null,
      canApplyLocalProfile: false,
      requireMeasuredPower: false,
      requireCoolOrWarmThermals: false,
      requiredSeconds: null,
      requiredSamples: null,
      requiredShareEvents: null,
      summary: "Repair kernel proof.",
      nextStep: "Repair kernel proof.",
    },
    actionPlan: actionPlan({
      action: "repair_kernel_proof",
      priority: "critical",
      localProfileApplyAllowed: false,
      applyTargetStepId: null,
      evidenceToRecord: ["midstate equivalence and performance proof"],
      nextStep: "Repair the midstate equivalence proof.",
    }),
  });
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analyzeTuningObservations(sweep, []) });

  assert.equal(feedback.status, "repair_kernel_proof");
  assert.equal(feedback.recommendation, "repair_kernel_proof");
  assert.equal(feedback.canPromote, false);
  assert.ok(feedback.missingEvidence.includes("midstate equivalence and performance proof"));
  assert.ok(!feedback.missingEvidence.includes("target profile sample missing"));
  assert.match(feedback.nextStep, /midstate equivalence proof/i);
});
test("objective feedback keeps external validation out of local promotion", () => {
  const sweep = createTuningSweepPlan({ goal: "balanced", availableCpuThreads: 8, recommendedCpuThreads: 2, hardwareGpuAvailable: true, maxSteps: 2, sampleSeconds: 120 });
  const experiment = experimentFor(sweep.steps[0], {
    task: { id: "external_work_dry_run", route: "external", requiredSeconds: null, requiredShareEvents: 6 },
    directive: { kind: "external_dry_run", route: "external", step: null, applyTarget: null, canApplyLocalProfile: false, requiredSeconds: null, requiredShareEvents: 6 },
    action: { action: "validate_external_dry_run", localProfileApplyAllowed: false, applyTargetStepId: null },
    certificate: { status: "dry_run", runtimeMode: "external_dry_run", primaryEvidenceGap: "external_dry_run" },
  });
  const feedback = deriveAlgorithmObjectiveFeedback({ experiment, tuningSweepPlan: sweep, tuningAnalysis: analyzeTuningObservations(sweep, []) });

  assert.equal(feedback.status, "external_dry_run");
  assert.equal(feedback.recommendation, "external_dry_run");
  assert.equal(feedback.canPromote, false);
});
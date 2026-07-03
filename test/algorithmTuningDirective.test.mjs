import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmTuningDirective } from "../.test-dist/domain/algorithmTuningDirective.js";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
} from "../.test-dist/domain/efficiencyTuning.js";
import { deriveHashRuntimeEfficiencySnapshot } from "../.test-dist/domain/hashRuntimeEfficiency.js";

function sweepPlan() {
  return createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    observedHashrate: 5_000_000,
    observedComputeMode: "cpu",
    observedCpuThreads: 2,
    observedGpuIntensityPercent: 0,
    currentComputeMode: "cpu",
    currentCpuThreads: 2,
    currentGpuIntensityPercent: 0,
    maxSteps: 3,
    sampleSeconds: 60,
  });
}

function maxHashrateStep(sweep) {
  return sweep.steps
    .slice()
    .sort((left, right) => right.estimatedHashrate - left.estimatedHashrate || right.order - left.order)[0];
}

function samplingPlan(primaryTask) {
  return {
    tasks: [primaryTask],
    primaryTask,
    readyTaskIds: primaryTask.status === "ready" ? [primaryTask.id] : [],
    blockedTaskIds: primaryTask.status === "blocked" || primaryTask.status === "reserved" ? [primaryTask.id] : [],
    totalEstimatedSeconds: primaryTask.remainingSeconds ?? 0,
    localRequiredSeconds: 900,
    externalRequiredSamples: 3,
    externalStableSampleTarget: 6,
    summary: "sampling plan",
    nextStep: primaryTask.nextStep,
  };
}

function task(overrides = {}) {
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
    objective: "capture power",
    successCriteria: "measured watts",
    nextStep: "Capture measured watts for the active local profile.",
    ...overrides,
  };
}

test("algorithm tuning directive maps measured-power sampling to a local profile", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, []);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task()),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.kind, "local_profile");
  assert.equal(directive.route, "local");
  assert.equal(directive.status, "ready");
  assert.equal(directive.requiredSeconds, 900);
  assert.equal(directive.requireMeasuredPower, true);
  assert.equal(directive.canApplyLocalProfile, true);
  assert.equal(directive.step?.priority, "baseline");
  assert.equal(directive.applyTarget?.computeMode, "cpu");
  assert.match(directive.summary, /measured watts/);
  assert.match(directive.nextStep, /Target profile/);
});

test("algorithm tuning directive targets the next profile above the power-density knee", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
  ]);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      objective: "probe density",
      successCriteria: "marginal watts pay for hash",
      nextStep: "Measure the next higher local tuning profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.kind, "local_profile");
  assert.equal(directive.primaryTaskId, "local_power_density_probe");
  assert.equal(directive.step?.id, sweep.steps[2].id);
  assert.equal(directive.applyTarget?.stepId, sweep.steps[2].id);
  assert.equal(directive.canApplyLocalProfile, true);
  assert.equal(directive.requireMeasuredPower, true);
  assert.equal(directive.requireCoolOrWarmThermals, true);
  assert.equal(directive.requiredShareEvents, 3);
  assert.match(directive.summary, /Probe/);
  assert.match(directive.nextStep, /Target profile/);
});
test("algorithm tuning directive does not skip power-density target from estimated live evidence", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
    { stepId: sweep.steps[2].id, hashrate: 290_000_000, watts: 30, powerEvidenceStatus: "estimated", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 61 },
  ]);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      objective: "probe density",
      successCriteria: "marginal watts pay for hash",
      nextStep: "Measure the next higher local tuning profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.step?.id, sweep.steps[2].id);
  assert.equal(directive.applyTarget?.stepId, sweep.steps[2].id);
  assert.equal(directive.canApplyLocalProfile, true);
});

test("algorithm tuning directive does not skip power-density target from short measured evidence", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
    { stepId: sweep.steps[2].id, hashrate: 290_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds: 120, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 61 },
  ]);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      objective: "probe density",
      successCriteria: "marginal watts pay for hash",
      nextStep: "Measure the next higher local tuning profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.step?.id, sweep.steps[2].id);
  assert.equal(directive.applyTarget?.stepId, sweep.steps[2].id);
  assert.equal(directive.canApplyLocalProfile, true);
});
test("algorithm tuning directive disables power-density apply when no higher local step exists", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 54 },
    { stepId: sweep.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
    { stepId: sweep.steps[2].id, hashrate: 290_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 61 },
  ]);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      objective: "probe density",
      successCriteria: "marginal watts pay for hash",
      nextStep: "Measure the next higher local tuning profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.step, null);
  assert.equal(directive.applyTarget, null);
  assert.equal(directive.canApplyLocalProfile, false);
  assert.match(directive.summary, /higher local tuning step/i);
  assert.match(directive.nextStep, /Expand the local tuning sweep|external telemetry/i);
});
test("algorithm tuning directive targets max-hash profile for headroom probes", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, []);
  const target = maxHashrateStep(sweep);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      targetProfile: "max_hashrate",
      objective: "classify headroom",
      successCriteria: "measured max-hash headroom",
      nextStep: "Measure the max-hash headroom profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.primaryTaskId, "local_power_density_probe");
  assert.equal(directive.step?.id, target.id);
  assert.equal(directive.applyTarget?.stepId, target.id);
  assert.equal(directive.canApplyLocalProfile, true);
  assert.match(directive.nextStep, /max-hash headroom/i);
});

test("algorithm tuning directive disables max-hash headroom apply after evidence is complete", () => {
  const sweep = sweepPlan();
  const target = maxHashrateStep(sweep);
  const analysis = analyzeTuningObservations(sweep, [
    { stepId: target.id, hashrate: target.estimatedHashrate, watts: target.estimatedWatts, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 61 },
  ]);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      targetProfile: "max_hashrate",
      objective: "classify headroom",
      successCriteria: "measured max-hash headroom",
      nextStep: "Measure the max-hash headroom profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.step, null);
  assert.equal(directive.applyTarget, null);
  assert.equal(directive.canApplyLocalProfile, false);
  assert.match(directive.summary, /Max-hash headroom/i);
  assert.match(directive.nextStep, /already classified/i);
});
test("algorithm tuning directive keeps network telemetry separate from local profile changes", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, []);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "external_telemetry_history",
      route: "network",
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: 3,
      remainingSamples: 3,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: "sample network telemetry",
      successCriteria: "external telemetry samples",
      nextStep: "Run TEST EXTERNAL until telemetry history is usable.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.kind, "network_telemetry");
  assert.equal(directive.step, null);
  assert.equal(directive.applyTarget, null);
  assert.equal(directive.canApplyLocalProfile, false);
  assert.equal(directive.requiredSamples, 3);
  assert.match(directive.summary, /telemetry only/);
});

test("algorithm tuning directive keeps direct interfaces reserved until an endpoint protocol exists", () => {
  const sweep = sweepPlan();
  const analysis = analyzeTuningObservations(sweep, []);
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "direct_read_only_probe",
      route: "direct",
      status: "reserved",
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: 1,
      remainingSamples: 1,
      requiresMeasuredPower: false,
      requiresCoolOrWarmThermals: false,
      objective: "identify direct endpoint",
      successCriteria: "read-only direct endpoint probe",
      nextStep: "Choose and test the real serial, USB, HID, or device-path protocol.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
  });

  assert.equal(directive.kind, "direct_reserved");
  assert.equal(directive.status, "reserved");
  assert.equal(directive.step, null);
  assert.equal(directive.canApplyLocalProfile, false);
  assert.match(directive.summary, /reserved/);
  assert.match(directive.nextStep, /serial, USB, HID/);
});
test("algorithm tuning directive blocks higher-load apply while live runtime evidence is watch", () => {
  const sweep = sweepPlan();
  const currentStep = sweep.steps[0];
  const analysis = analyzeTuningObservations(sweep, []);
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 9,
    rejectedShares: 1,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const directive = deriveAlgorithmTuningDirective({
    samplingPlan: samplingPlan(task({
      id: "local_power_density_probe",
      route: "local",
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      requiredShareEvents: 3,
      targetProfile: "max_hashrate",
      objective: "classify headroom",
      successCriteria: "measured max-hash headroom",
      nextStep: "Measure the max-hash headroom profile with watts, thermals, and share counters.",
    })),
    tuningSweepPlan: sweep,
    tuningAnalysis: analysis,
    runtimeEfficiency,
    currentStep,
  });

  assert.equal(directive.step?.id, maxHashrateStep(sweep).id);
  assert.equal(directive.canApplyLocalProfile, false);
  assert.equal(directive.applyTarget?.stepId, maxHashrateStep(sweep).id);
});

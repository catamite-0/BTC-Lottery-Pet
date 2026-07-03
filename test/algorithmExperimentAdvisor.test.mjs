import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmExperimentAdvisor } from "../.test-dist/domain/algorithmExperimentAdvisor.js";

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
    objective: "capture measured power",
    successCriteria: "measured watts",
    nextStep: "Capture measured watts for the active local profile.",
    targetProfile: null,
    ...overrides,
  };
}

function marginalDecision(overrides = {}) {
  return {
    status: "measure",
    fromLaneId: "local_power_budget",
    targetLaneId: "local_max_hashrate",
    extraHashrate: null,
    extraWatts: null,
    baselineHashesPerWatt: null,
    marginalHashesPerWatt: null,
    densityRetentionRatio: null,
    summary: "Measure max-hash marginal density.",
    nextStep: "Measure max-hash headroom with watts and thermals.",
    ...overrides,
  };
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

function plan(primaryTask, overrides = {}) {
  return {
    strategy: "collect_baseline",
    recommendedRoute: "waiting",
    confidence: "waiting",
    canAssignExternalWork: false,
    samplingPlan: samplingPlan(primaryTask),
    readinessCertificate: {
      readinessScore: 0,
    },
    densityPlan: {
      readinessScore: 0,
      externalDryRunOnly: false,
      hashrateHeadroom: { status: "waiting" },
      marginalDecision: marginalDecision(),
    },
    riskFlags: [],
    ...overrides,
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
      summary: "CPU 2 threads",
      reason: "baseline",
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
    summary: "Run CPU 2 threads with measured watts.",
    nextStep: "Capture measured watts. Target profile: baseline.",
    ...overrides,
  };
}

test("algorithm experiment advisor prioritizes measured power before low-power claims", () => {
  const primaryTask = task();
  const advisor = deriveAlgorithmExperimentAdvisor(plan(primaryTask), directive());

  assert.equal(advisor.priority, "critical");
  assert.equal(advisor.focus, "power_baseline");
  assert.equal(advisor.action, "run_local_profile");
  assert.equal(advisor.powerImpact, "proves_low_power");
  assert.equal(advisor.hashrateImpact, "none");
  assert.equal(advisor.applyTargetStepId, "cpu:2");
  assert.equal(advisor.canApplyLocalProfile, true);
  assert.equal(advisor.miningStartAllowed, false);
  assert.ok(advisor.evidenceToRecord.includes("measured watts"));
  assert.ok(advisor.stopConditions.includes("active profile no longer matches the target profile"));
});

test("algorithm experiment advisor classifies max-hash headroom as burst evidence", () => {
  const primaryTask = task({
    id: "local_power_density_probe",
    targetProfile: "max_hashrate",
    requiresCoolOrWarmThermals: true,
    requiredShareEvents: 3,
    nextStep: "Measure the max-hash headroom profile.",
  });
  const advisor = deriveAlgorithmExperimentAdvisor(
    plan(primaryTask, { readinessCertificate: { readinessScore: 55 } }),
    directive({
      primaryTaskId: "local_power_density_probe",
      requiredShareEvents: 3,
      requireCoolOrWarmThermals: true,
      nextStep: "Measure max-hash headroom. Target profile: max.",
    }),
  );

  assert.equal(advisor.priority, "high");
  assert.equal(advisor.focus, "hashrate_headroom");
  assert.equal(advisor.hashrateImpact, "classifies_burst");
  assert.equal(advisor.marginalDecisionStatus, "measure");
  assert.ok(advisor.evidenceToRecord.includes("3 useful share events"));
  assert.ok(advisor.evidenceToRecord.includes("marginal hashes per watt"));
  assert.ok(advisor.stopConditions.includes("profile becomes hot, critical, or paused"));
  assert.ok(advisor.stopConditions.includes("marginal density retention falls below the upgrade threshold"));
});

test("algorithm experiment advisor blocks max-hash apply when marginal density is hold", () => {
  const primaryTask = task({
    id: "local_power_density_probe",
    targetProfile: "max_hashrate",
    requiresCoolOrWarmThermals: true,
    requiredShareEvents: 3,
    nextStep: "Measure the max-hash headroom profile.",
  });
  const advisor = deriveAlgorithmExperimentAdvisor(
    plan(primaryTask, {
      densityPlan: {
        readinessScore: 100,
        externalDryRunOnly: false,
        hashrateHeadroom: { status: "available" },
        marginalDecision: marginalDecision({
          status: "hold",
          densityRetentionRatio: 0.2,
          summary: "Hold the upgrade because useful density collapses.",
          nextStep: "Stay on the selected density lane.",
        }),
      },
    }),
    directive({
      primaryTaskId: "local_power_density_probe",
      requiredShareEvents: 3,
      requireCoolOrWarmThermals: true,
      nextStep: "Measure max-hash headroom. Target profile: max.",
    }),
  );

  assert.equal(advisor.priority, "blocked");
  assert.equal(advisor.focus, "hashrate_headroom");
  assert.equal(advisor.marginalDecisionStatus, "hold");
  assert.equal(advisor.marginalDensityRetentionRatio, 0.2);
  assert.equal(advisor.canApplyLocalProfile, false);
  assert.match(advisor.summary, /marginal hold/i);
  assert.match(advisor.nextStep, /Do not apply/i);
});

test("algorithm experiment advisor keeps network telemetry read-only", () => {
  const primaryTask = task({
    id: "external_telemetry_history",
    route: "network",
    requiredSeconds: null,
    requiredSamples: 3,
    requiresMeasuredPower: true,
    requiresCoolOrWarmThermals: true,
    nextStep: "Run TEST EXTERNAL until history is usable.",
  });
  const advisor = deriveAlgorithmExperimentAdvisor(
    plan(primaryTask, { recommendedRoute: "external" }),
    directive({
      kind: "network_telemetry",
      route: "network",
      primaryTaskId: "external_telemetry_history",
      applyTarget: null,
      canApplyLocalProfile: false,
      requiredSeconds: null,
      requiredSamples: 3,
      requiredShareEvents: null,
      nextStep: "Run TEST EXTERNAL.",
    }),
  );

  assert.equal(advisor.priority, "high");
  assert.equal(advisor.action, "sample_network_telemetry");
  assert.equal(advisor.focus, "external_telemetry");
  assert.equal(advisor.applyTargetStepId, null);
  assert.equal(advisor.miningStartAllowed, false);
  assert.ok(advisor.evidenceToRecord.includes("external watts or J/TH"));
  assert.match(advisor.nextStep, /do not hand pool jobs/i);
});

test("algorithm experiment advisor treats external work as dry-run only", () => {
  const primaryTask = task({
    id: "external_work_dry_run",
    route: "external",
    requiredSeconds: null,
    requiredShareEvents: 3,
    nextStep: "Validate mock leases.",
  });
  const advisor = deriveAlgorithmExperimentAdvisor(
    plan(primaryTask, {
      strategy: "external_work_dry_run",
      canAssignExternalWork: true,
    }),
    directive({
      kind: "external_dry_run",
      route: "external",
      primaryTaskId: "external_work_dry_run",
      applyTarget: null,
      canApplyLocalProfile: false,
      requiredSeconds: null,
      requiredShareEvents: 3,
      nextStep: "Validate external leases.",
    }),
  );

  assert.equal(advisor.priority, "critical");
  assert.equal(advisor.focus, "external_work_validation");
  assert.equal(advisor.action, "run_external_dry_run");
  assert.equal(advisor.powerImpact, "guards_power");
  assert.equal(advisor.hashrateImpact, "guards_external_hash");
  assert.ok(advisor.evidenceToRecord.includes("unique work lease"));
  assert.ok(advisor.stopConditions.includes("any path would submit real external shares"));
  assert.equal(advisor.miningStartAllowed, false);
});

test("algorithm experiment advisor blocks direct probes until hardware protocol exists", () => {
  const primaryTask = task({
    id: "direct_read_only_probe",
    route: "direct",
    status: "reserved",
    requiredSeconds: null,
    requiredSamples: 1,
    requiresMeasuredPower: false,
    nextStep: "Wait until Direct hardware exists.",
  });
  const advisor = deriveAlgorithmExperimentAdvisor(
    plan(primaryTask, {
      riskFlags: ["Direct external hash is reserved until hardware protocol validation."],
    }),
    directive({
      kind: "direct_reserved",
      route: "direct",
      status: "reserved",
      primaryTaskId: "direct_read_only_probe",
      applyTarget: null,
      canApplyLocalProfile: false,
      requiredSeconds: null,
      requiredSamples: 1,
      nextStep: "Wait until Direct hardware exists.",
    }),
  );

  assert.equal(advisor.priority, "blocked");
  assert.equal(advisor.focus, "direct_protocol");
  assert.equal(advisor.action, "hold_direct");
  assert.equal(advisor.canApplyLocalProfile, false);
  assert.ok(advisor.blockedBy.some((item) => /Direct hardware/i.test(item)));
  assert.match(advisor.nextStep, /read-only/i);
});

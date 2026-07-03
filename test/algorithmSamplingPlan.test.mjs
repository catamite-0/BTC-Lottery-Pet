import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmSamplingPlan } from "../.test-dist/domain/algorithmSamplingPlan.js";

function gate(id, status = "waiting") {
  return {
    id,
    status,
    scope: id === "consensus_midstate" ? "consensus" : "local",
    requiredForReady: true,
    summary: `${id} ${status}`,
    evidence: `${id} evidence`,
    nextStep: `${id} next`,
  };
}

function roadmap(primaryPhaseId = "local_power_baseline", primaryStatus = "ready") {
  return {
    phases: [
      {
        id: primaryPhaseId,
        status: primaryStatus,
        impact: "power",
        objective: "objective",
        evidence: "evidence",
        unlocks: "unlocks",
        nextStep: `${primaryPhaseId} next`,
      },
      {
        id: "research_frontier_filter",
        status: "done",
        impact: "safety",
        objective: "research",
        evidence: "research evidence",
        unlocks: "research unlocks",
        nextStep: "review research",
      },
    ],
    primaryPhase: {
      id: primaryPhaseId,
      status: primaryStatus,
      impact: "power",
      objective: "objective",
      evidence: "evidence",
      unlocks: "unlocks",
      nextStep: `${primaryPhaseId} next`,
    },
    readyPhaseIds: primaryStatus === "ready" ? [primaryPhaseId] : [],
    blockedPhaseIds: [],
    completionScore: 40,
    localLongRunReady: false,
    externalDryRunReady: false,
    externalMiningAllowed: false,
    summary: "roadmap",
    nextStep: `${primaryPhaseId} next`,
  };
}

function samplingInput(overrides = {}) {
  return {
    evidenceRoadmap: roadmap(),
    readinessCertificate: {
      gates: [
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
      requiredPassed: 1,
      requiredTotal: 9,
      readinessScore: 11,
      readyForUnattendedLocal: false,
      readyForExternalDryRun: false,
      readyForExternalMining: false,
      primaryMissingGate: null,
      summary: "readiness",
    },
    experimentQueue: {
      experiments: [],
      primaryExperiment: {
        id: "capture_local_baseline",
        status: "ready",
        priority: "high",
        route: "local",
        metric: "power",
        summary: "capture baseline",
        successCriteria: "baseline",
        nextStep: "capture local baseline",
      },
      readyCount: 1,
      blockedCount: 0,
      doneCount: 0,
      summary: "experiments",
    },
    densityPlan: {
      readinessScore: 20,
      readyForLongRun: false,
      primaryMissingGate: {
        id: "measured_power",
        status: "waiting",
        requiredForLongRun: true,
        summary: "measured power missing",
        nextStep: "capture measured power",
      },
      nextStep: "capture density evidence",
    },
    externalHistory: {
      usableEfficiencySampleCount: 0,
      evidenceStatus: "waiting",
      summary: "No external telemetry history yet.",
    },
    ...overrides,
  };
}

function task(plan, id) {
  const item = plan.tasks.find((candidate) => candidate.id === id);
  assert.ok(item, `missing task ${id}`);
  return item;
}

test("algorithm sampling plan translates empty local evidence into measured-power sampling requirements", () => {
  const plan = deriveAlgorithmSamplingPlan(samplingInput());

  assert.equal(plan.primaryTask.id, "local_measured_power");
  assert.equal(plan.primaryTask.status, "ready");
  assert.equal(plan.localRequiredSeconds, 900);
  assert.equal(task(plan, "local_baseline").requiredShareEvents, 3);
  assert.equal(task(plan, "local_baseline").requiresMeasuredPower, true);
  assert.equal(task(plan, "local_baseline").requiresCoolOrWarmThermals, true);
  assert.equal(task(plan, "external_telemetry_history").requiredSamples, 3);
  assert.equal(task(plan, "external_stability_history").requiredSamples, 6);
});

test("algorithm sampling plan turns power-density probing into the next local sample", () => {
  const probeExperiment = {
    id: "probe_power_density_knee",
    status: "ready",
    priority: "medium",
    route: "local",
    metric: "efficiency",
    summary: "probe density",
    successCriteria: "marginal watts pay for hash",
    nextStep: "Measure the next higher local tuning profile with watts, thermals, and share counters.",
  };
  const gates = [
    gate("consensus_midstate", "passed"),
    gate("measured_power", "passed"),
    gate("share_quality", "passed"),
    gate("stability_window", "passed"),
    gate("thermal_safety", "passed"),
    gate("external_efficiency_history"),
    gate("search_space_lease"),
    gate("external_work_validation"),
    gate("direct_protocol"),
  ];
  const plan = deriveAlgorithmSamplingPlan(samplingInput({
    readinessCertificate: {
      ...samplingInput().readinessCertificate,
      gates,
      readyForUnattendedLocal: true,
    },
    experimentQueue: {
      experiments: [probeExperiment],
      primaryExperiment: probeExperiment,
      readyCount: 1,
      blockedCount: 0,
      doneCount: 6,
      summary: "primary probe power density knee",
    },
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      nextStep: "density ready",
    },
  }));

  assert.equal(plan.primaryTask.id, "local_power_density_probe");
  assert.equal(plan.primaryTask.status, "ready");
  assert.equal(plan.primaryTask.requiredSeconds, 900);
  assert.equal(plan.primaryTask.requiresMeasuredPower, true);
  assert.equal(plan.primaryTask.requiresCoolOrWarmThermals, true);
  assert.equal(plan.primaryTask.requiredShareEvents, 3);
  assert.match(plan.primaryTask.nextStep, /next higher local tuning profile/i);
  assert.equal(plan.primaryTask.targetProfile, "next_power_density");
});
test("algorithm sampling plan probes local headroom when useful density is waiting on max-hash classification", () => {
  const gates = [
    gate("consensus_midstate", "passed"),
    gate("measured_power", "passed"),
    gate("share_quality", "passed"),
    gate("stability_window", "passed"),
    gate("thermal_safety", "passed"),
    gate("external_efficiency_history"),
    gate("search_space_lease"),
    gate("external_work_validation"),
    gate("direct_protocol"),
  ];
  const plan = deriveAlgorithmSamplingPlan(samplingInput({
    evidenceRoadmap: roadmap("useful_hash_density", "waiting"),
    readinessCertificate: {
      ...samplingInput().readinessCertificate,
      gates,
      readyForUnattendedLocal: true,
    },
    experimentQueue: {
      experiments: [{
        id: "probe_power_density_knee",
        status: "done",
        priority: "medium",
        route: "local",
        metric: "efficiency",
        summary: "probe done",
        successCriteria: "done",
        nextStep: "already done",
      }],
      primaryExperiment: {
        id: "measure_local_power",
        status: "done",
        priority: "high",
        route: "local",
        metric: "power",
        summary: "power done",
        successCriteria: "done",
        nextStep: "done",
      },
      readyCount: 0,
      blockedCount: 0,
      doneCount: 7,
      summary: "experiments done",
    },
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      hashrateHeadroom: {
        status: "waiting",
        summary: "max-hash headroom waiting",
        nextStep: "Measure max-hash headroom with watts and thermals.",
      },
      nextStep: "density ready",
    },
  }));

  assert.equal(plan.primaryTask.id, "local_power_density_probe");
  assert.equal(plan.primaryTask.status, "ready");
  assert.equal(plan.primaryTask.requiredSeconds, 900);
  assert.equal(plan.primaryTask.requiresMeasuredPower, true);
  assert.equal(plan.primaryTask.requiresCoolOrWarmThermals, true);
  assert.equal(plan.primaryTask.requiredShareEvents, 3);
  assert.match(plan.primaryTask.objective, /headroom/i);
  assert.match(plan.primaryTask.nextStep, /max-hash headroom/i);
  assert.equal(plan.primaryTask.targetProfile, "max_hashrate");
});

test("algorithm sampling plan does not probe max-hash when marginal density is already hold", () => {
  const gates = [
    gate("consensus_midstate", "passed"),
    gate("measured_power", "passed"),
    gate("share_quality", "passed"),
    gate("stability_window", "passed"),
    gate("thermal_safety", "passed"),
    gate("external_efficiency_history"),
    gate("search_space_lease"),
    gate("external_work_validation"),
    gate("direct_protocol"),
  ];
  const plan = deriveAlgorithmSamplingPlan(samplingInput({
    evidenceRoadmap: roadmap("network_telemetry_history", "waiting"),
    readinessCertificate: {
      ...samplingInput().readinessCertificate,
      gates,
      readyForUnattendedLocal: true,
    },
    experimentQueue: {
      experiments: [],
      primaryExperiment: {
        id: "measure_local_power",
        status: "done",
        priority: "high",
        route: "local",
        metric: "power",
        summary: "power done",
        successCriteria: "done",
        nextStep: "done",
      },
      readyCount: 0,
      blockedCount: 0,
      doneCount: 7,
      summary: "experiments done",
    },
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      hashrateHeadroom: {
        status: "available",
        summary: "max-hash headroom available",
        nextStep: "Measure max-hash headroom with watts and thermals.",
      },
      marginalDecision: {
        status: "hold",
        summary: "Hold the upgrade because useful density collapses.",
        nextStep: "Stay on the selected density lane.",
      },
      nextStep: "density ready",
    },
  }));

  assert.notEqual(plan.primaryTask.id, "local_power_density_probe");
  assert.equal(task(plan, "local_power_density_probe").status, "waiting");
  assert.equal(task(plan, "local_power_density_probe").targetProfile, "next_power_density");
  assert.match(plan.summary, /external telemetry history/i);
});
test("algorithm sampling plan turns external dry-run readiness into mock work validation only", () => {
  const gates = [
    gate("consensus_midstate", "passed"),
    gate("measured_power", "passed"),
    gate("share_quality", "passed"),
    gate("stability_window", "passed"),
    gate("thermal_safety", "passed"),
    gate("external_efficiency_history", "passed"),
    gate("search_space_lease", "passed"),
    gate("external_work_validation"),
    gate("direct_protocol"),
  ];
  const plan = deriveAlgorithmSamplingPlan(samplingInput({
    evidenceRoadmap: {
      ...roadmap("external_work_validation", "ready"),
      externalDryRunReady: true,
    },
    readinessCertificate: {
      ...samplingInput().readinessCertificate,
      gates,
      readinessScore: 89,
      readyForUnattendedLocal: true,
      readyForExternalDryRun: true,
    },
    densityPlan: {
      readinessScore: 100,
      readyForLongRun: true,
      primaryMissingGate: null,
      nextStep: "keep sampling",
    },
    externalHistory: {
      usableEfficiencySampleCount: 3,
      evidenceStatus: "ready",
      summary: "external evidence ready",
    },
  }));

  assert.equal(plan.primaryTask.id, "external_work_dry_run");
  assert.equal(plan.primaryTask.status, "ready");
  assert.equal(task(plan, "external_work_dry_run").requiredShareEvents, 3);
  assert.equal(task(plan, "external_work_dry_run").remainingShareEvents, 3);
  assert.equal(task(plan, "external_telemetry_history").remainingSamples, 0);
  assert.equal(task(plan, "external_stability_history").remainingSamples, 3);
  assert.match(plan.summary, /external work dry run/);
});
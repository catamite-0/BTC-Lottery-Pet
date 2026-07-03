import test from "node:test";
import assert from "node:assert/strict";

import { deriveHashDensityPlan } from "../.test-dist/domain/hashDensityPlanner.js";
import { assessHashHardwareCandidate } from "../.test-dist/domain/hashHardwareAdvisor.js";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
} from "../.test-dist/domain/efficiencyTuning.js";
import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import { deriveExternalHashWorkAdapterPlan } from "../.test-dist/engines/externalHashWorkAdapter.js";

function externalHistory(overrides = {}) {
  return {
    sampleCount: 0,
    onlineSampleCount: 0,
    efficiencySampleCount: 0,
    usableEfficiencySampleCount: 0,
    evidenceStatus: "waiting",
    evidenceReady: false,
    evidenceSampleTarget: 3,
    evidenceGap: 3,
    latestSample: null,
    bestEfficiencySample: null,
    averageHashrate: 0,
    averageWatts: null,
    averageJoulesPerTerahash: null,
    bestJoulesPerTerahash: null,
    trend: "waiting",
    trendPercent: null,
    summary: "No external telemetry history yet.",
    ...overrides,
  };
}

function localAnalysis(samples = [
  { hashrate: 80_000_000, watts: 8, tempC: 54 },
  { hashrate: 220_000_000, watts: 12, tempC: 58 },
  { hashrate: 500_000_000, watts: 30, tempC: 65 },
]) {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: Math.max(3, samples.length),
    sampleSeconds: 120,
  });

  return analyzeTuningObservations(sweep, samples.map((sample, index) => ({
    stepId: sweep.steps[index].id,
    hashrate: sample.hashrate,
    watts: sample.watts,
    powerEvidenceStatus: sample.powerEvidenceStatus ?? "measured",
    sampleSeconds: sample.sampleSeconds ?? 900,
    acceptedShares: sample.acceptedShares ?? 6,
    rejectedShares: sample.rejectedShares ?? 0,
    staleSharesDropped: sample.staleSharesDropped ?? 0,
    queuedSharesDropped: sample.queuedSharesDropped ?? 0,
    tempC: sample.tempC ?? 58,
  })));
}

function estimatedPowerAnalysis() {
  const sweep = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 120,
  });

  return analyzeTuningObservations(sweep, [
    { stepId: sweep.steps[1].id, hashrate: 220_000_000, watts: 12, powerEvidenceStatus: "estimated", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0, tempC: 58 },
  ]);
}

function densityInput({ config = { external_hash_interface: "none" }, telemetry = null, history = externalHistory(), hardwareOverride = null } = {}) {
  const snapshot = deriveExternalHashSnapshot(config, telemetry);
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const workAdapterPlan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  const hardwareCandidate = hardwareOverride ?? assessHashHardwareCandidate({
    id: snapshot.endpoint || snapshot.interfaceKind,
    label: snapshot.label,
    interfaceKind: snapshot.interfaceKind === "network" || snapshot.interfaceKind === "direct" ? snapshot.interfaceKind : "unknown",
    hashrate: snapshot.hashrate || history.averageHashrate,
    watts: snapshot.watts ?? history.averageWatts,
    joulesPerTerahash: snapshot.joulesPerTerahash ?? history.averageJoulesPerTerahash ?? history.bestJoulesPerTerahash,
    supportsTelemetry: matrix.canReadTelemetry,
    supportsPowerTelemetry: matrix.canCompareEfficiency,
    supportsJobControl: matrix.canControlMining,
    supportsShareSubmission: matrix.canSubmitShares,
    supportsVersionRolling: matrix.canRollVersion,
    supportsWorkPartitioning: matrix.canPartitionWork,
    parallelWorkers: snapshot.parallelWorkers,
  }, "balanced");

  return {
    tuningAnalysis: localAnalysis(),
    externalHistory: history,
    externalSnapshot: snapshot,
    externalWorkAdapterPlan: workAdapterPlan,
    hardwareCandidate,
  };
}

test("hash density planner selects the highest quality local hash under the derived power budget", () => {
  const plan = deriveHashDensityPlan(densityInput());

  assert.equal(plan.strategy, "local_power_budget");
  assert.equal(plan.powerBudgetWatts, 12);
  assert.equal(plan.powerBudgetSource, "frontier_knee");
  assert.match(plan.powerBudgetSummary, /frontier knee/i);
  assert.equal(plan.selectedLane.id, "local_power_budget");
  assert.equal(plan.selectedLane.watts, 12);
  assert.ok(plan.selectedLane.hashrate >= 200_000_000);
  assert.equal(plan.miningStartAllowed, false);
  assert.equal(plan.readyForLongRun, true);
  assert.equal(plan.readinessScore, 100);
  assert.equal(plan.primaryMissingGate, null);
});

test("hash density planner reports max-hash headroom without selecting it for low-power running", () => {
  const plan = deriveHashDensityPlan(densityInput());

  assert.equal(plan.selectedLane.id, "local_power_budget");
  assert.equal(plan.hashrateHeadroom.status, "available");
  assert.equal(plan.hashrateHeadroom.laneId, "local_max_hashrate");
  assert.ok(plan.hashrateHeadroom.extraHashrate > 0);
  assert.equal(plan.hashrateHeadroom.extraWatts, 18);
  assert.ok(plan.hashrateHeadroom.hashGainRatio > 0);
  assert.ok(plan.hashrateHeadroom.wattIncreaseRatio > 0);
  assert.match(plan.hashrateHeadroom.summary, /headroom can add/i);
  assert.match(plan.hashrateHeadroom.nextStep, /extra watts are intentional/i);
  assert.equal(plan.marginalDecision.status, "advance");
  assert.equal(plan.marginalDecision.targetLaneId, "local_max_hashrate");
  assert.ok(plan.marginalDecision.marginalHashesPerWatt > 0);
  assert.ok(plan.marginalDecision.densityRetentionRatio >= 0.55);
  assert.match(plan.marginalDecision.nextStep, /intentional high-output profile/i);
});

test("hash density planner holds max-hash upgrades when marginal density collapses", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput(),
    powerBudgetWatts: 12,
    tuningAnalysis: localAnalysis([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 260_000_000, watts: 60, tempC: 63 },
    ]),
  });

  assert.equal(plan.selectedLane.id, "local_power_budget");
  assert.equal(plan.marginalDecision.status, "hold");
  assert.equal(plan.marginalDecision.extraWatts, 48);
  assert.ok(plan.marginalDecision.densityRetentionRatio < 0.55);
  assert.match(plan.marginalDecision.summary, /Hold the upgrade/i);
});

test("hash density planner measures before max-hash upgrades without stable evidence", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput(),
    powerBudgetWatts: 12,
    tuningAnalysis: localAnalysis([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 500_000_000, watts: 30, tempC: 65, sampleSeconds: 120 },
    ]),
  });

  assert.equal(plan.selectedLane.id, "local_power_budget");
  assert.equal(plan.marginalDecision.status, "measure");
  assert.equal(plan.marginalDecision.targetLaneId, "local_max_hashrate");
  assert.match(plan.marginalDecision.nextStep, /stable runtime window/i);
});
test("hash density planner expands the frontier knee when marginal density remains strong", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput(),
    tuningAnalysis: localAnalysis([
      { hashrate: 80_000_000, watts: 8, tempC: 54 },
      { hashrate: 220_000_000, watts: 12, tempC: 58 },
      { hashrate: 254_000_000, watts: 14, tempC: 59 },
    ]),
  });

  assert.equal(plan.strategy, "local_power_budget");
  assert.equal(plan.powerBudgetSource, "frontier_knee");
  assert.equal(plan.powerBudgetWatts, 14);
  assert.equal(plan.selectedLane.watts, 14);
  assert.ok(plan.selectedLane.hashrate >= 250_000_000);
});
test("hash density planner blocks long-run local density when power is only estimated", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput(),
    tuningAnalysis: estimatedPowerAnalysis(),
  });

  assert.equal(plan.selectedLane.status, "waiting");
  assert.match(plan.selectedLane.nextStep, /measured watts/i);
  assert.equal(plan.readyForLongRun, false);
  assert.equal(plan.primaryMissingGate?.id, "measured_power");
  assert.ok(plan.readinessScore < 100);
});

test("hash density planner keeps assignable external dry-run behind measured local power", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput({
      config: {
        external_hash_interface: "network",
        external_hash_network_host: "future-rack.local",
      },
      telemetry: {
        status: "ok",
        base_url: "http://future-rack.local",
        device_name: "Future Rack Adapter",
        hostname: "future-rack.local",
        hash_rate_hs: 2_400_000_000_000,
        power_watts: 32,
        joules_per_terahash: 13,
        temp_c: 58,
        parallel_workers: 4,
        integration_stage: "hash-engine",
        engine_eligible: true,
        capabilities: ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"],
        summary: "Future adapter declares dry-run hash-engine capabilities.",
      },
    }),
    tuningAnalysis: estimatedPowerAnalysis(),
  });
  const externalReference = plan.lanes.find((lane) => lane.id === "external_reference");

  assert.equal(externalReference?.status, "dry-run");
  assert.equal(plan.externalDryRunOnly, false);
  assert.equal(plan.strategy, "local_power_budget");
  assert.equal(plan.selectedLane.source, "local");
  assert.equal(plan.selectedLane.status, "waiting");
  assert.equal(plan.primaryMissingGate?.id, "measured_power");
  assert.match(plan.riskFlags.join(" "), /local power-density baseline/i);
});

test("hash density planner prices external dry-run efficiency by lease-adjusted hashrate", () => {
  const input = densityInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "future-rack.local",
    },
    telemetry: {
      status: "ok",
      base_url: "http://future-rack.local",
      device_name: "Future Rack Adapter",
      hostname: "future-rack.local",
      hash_rate_hs: 2_400_000_000_000,
      power_watts: 32,
      joules_per_terahash: 13,
      temp_c: 58,
      parallel_workers: 4,
      integration_stage: "hash-engine",
      engine_eligible: true,
      capabilities: ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"],
      summary: "Future adapter declares dry-run hash-engine capabilities.",
    },
    history: externalHistory({
      sampleCount: 4,
      onlineSampleCount: 4,
      efficiencySampleCount: 4,
      usableEfficiencySampleCount: 4,
      evidenceStatus: "ready",
      evidenceReady: true,
      evidenceGap: 0,
      averageHashrate: 2_400_000_000_000,
      averageWatts: 32,
      averageJoulesPerTerahash: 13,
      bestJoulesPerTerahash: 13,
      trend: "stable",
      trendPercent: 1,
      summary: "4/4 online samples; stable by 1.0%; ready.",
    }),
  });
  const plan = deriveHashDensityPlan({
    ...input,
    externalWorkAdapterPlan: {
      ...input.externalWorkAdapterPlan,
      status: "assignable",
      canAssignWork: true,
      searchSpaceReady: true,
      workLeaseReady: true,
      workLeaseUtilizationRatio: 0.1,
    },
  });
  const externalReference = plan.lanes.find((lane) => lane.id === "external_reference");

  assert.equal(externalReference?.status, "dry-run");
  assert.equal(externalReference?.hashrate, 240_000_000_000);
  assert.equal(Math.round(externalReference?.joulesPerTerahash ?? 0), 133);
  assert.equal(Math.round(externalReference?.hashesPerWatt ?? 0), 7_500_000_000);
  assert.notEqual(externalReference?.joulesPerTerahash, 13);
});
test("hash density planner keeps short local density lanes waiting", () => {
  const plan = deriveHashDensityPlan({
    ...densityInput(),
    tuningAnalysis: localAnalysis([
      { hashrate: 80_000_000, watts: 8, tempC: 54, sampleSeconds: 120 },
      { hashrate: 220_000_000, watts: 12, tempC: 58, sampleSeconds: 120 },
    ]),
  });

  assert.equal(plan.selectedLane.status, "waiting");
  assert.equal(plan.readyForLongRun, false);
  assert.equal(plan.primaryMissingGate?.id, "stability_window");
  assert.match(plan.selectedLane.nextStep, /stable window/i);
});

test("hash density planner treats efficient network ASIC data as a reference until work routing is proven", () => {
  const plan = deriveHashDensityPlan(densityInput({
    config: {
      external_hash_interface: "network",
      external_hash_network_host: "bitaxe.local",
    },
    telemetry: {
      status: "ok",
      base_url: "http://bitaxe.local",
      device_name: "Bitaxe",
      hostname: "bitaxe.local",
      hash_rate_hs: 1_200_000_000_000,
      power_watts: 18,
      joules_per_terahash: 15,
      summary: "ASIC telemetry: 1.2 TH/s at 18 W",
    },
    history: externalHistory({
      sampleCount: 4,
      onlineSampleCount: 4,
      efficiencySampleCount: 4,
      usableEfficiencySampleCount: 4,
      evidenceStatus: "ready",
      evidenceReady: true,
      evidenceGap: 0,
      averageHashrate: 1_200_000_000_000,
      averageWatts: 18,
      averageJoulesPerTerahash: 15,
      bestJoulesPerTerahash: 14,
      trend: "stable",
      trendPercent: 1,
      summary: "4/4 online samples; stable by 1.0%; ready.",
    }),
  }));

  assert.equal(plan.strategy, "external_telemetry_reference");
  assert.equal(plan.externalIsEfficiencyReference, true);
  assert.equal(plan.externalDryRunOnly, false);
  assert.equal(plan.selectedLane.id, "external_reference");
  assert.equal(plan.selectedLane.status, "blocked");
  assert.equal(plan.miningStartAllowed, false);
  assert.equal(plan.readyForLongRun, false);
  assert.equal(plan.primaryMissingGate?.id, "external_work_assignment");
  assert.match(plan.riskFlags.join(" "), /reference-only|Job control/i);
});

test("hash density planner keeps direct hardware reserved", () => {
  const plan = deriveHashDensityPlan(densityInput({
    config: {
      external_hash_interface: "direct",
      external_hash_direct_port: "COM7",
    },
  }));

  assert.equal(plan.strategy, "direct_reserved");
  assert.equal(plan.selectedLane.id, "external_hardware");
  assert.equal(plan.selectedLane.status, "reserved");
  assert.equal(plan.externalDryRunOnly, false);
  assert.equal(plan.miningStartAllowed, false);
  assert.equal(plan.readyForLongRun, false);
  assert.equal(plan.primaryMissingGate?.id, "direct_protocol");
  assert.match(plan.nextStep, /Direct endpoint protocol/i);
});
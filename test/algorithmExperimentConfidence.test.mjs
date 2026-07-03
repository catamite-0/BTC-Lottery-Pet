import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmExperimentConfidence } from "../.test-dist/domain/algorithmExperimentConfidence.js";
import { analyzeTuningObservations, createTuningSweepPlan } from "../.test-dist/domain/efficiencyTuning.js";
import { summarizeExternalHashHistory } from "../.test-dist/domain/externalHashHistory.js";

function advisor(overrides = {}) {
  return {
    schemaVersion: 1,
    priority: "high",
    focus: "power_density_knee",
    action: "run_local_profile",
    primaryTaskId: "local_power_density_probe",
    route: "local",
    applyTargetStepId: null,
    canApplyLocalProfile: true,
    miningStartAllowed: false,
    powerImpact: "improves_efficiency",
    hashrateImpact: "expands_useful_hash",
    requiredSeconds: 240,
    requiredSamples: 1,
    requiredShareEvents: 3,
    evidenceToRecord: ["hashrate", "measured watts", "pool share counters", "sample duration", "temperature"],
    stopConditions: ["configured sample target is reached", "profile becomes hot, critical, or paused"],
    blockedBy: [],
    summary: "Experiment high: power density knee.",
    nextStep: "Run the target profile and capture evidence.",
    ...overrides,
  };
}

function tuningPlan(goal = "balanced") {
  return createTuningSweepPlan({
    goal,
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 240,
  });
}

function stableAnalysis() {
  const plan = tuningPlan("balanced");
  return analyzeTuningObservations(plan, [
    {
      stepId: plan.steps[0].id,
      hashrate: 120_000_000,
      watts: 14,
      powerEvidenceStatus: "measured",
      sampleSeconds: 240,
      acceptedShares: 5,
      rejectedShares: 0,
      tempC: 52,
    },
  ]);
}

function externalSample(index, joulesPerTerahash) {
  return {
    generatedAt: `2026-07-02T00:0${index}:00.000Z`,
    endpoint: "http://bitaxe.local",
    status: "ok",
    hashrate: 1_200_000_000_000,
    watts: 18,
    joulesPerTerahash,
    tempC: 56,
    vrTempC: 60,
    fanRpm: 4200,
    acceptedShares: null,
    rejectedShares: null,
    miningPaused: false,
  };
}

test("algorithm experiment confidence requires a second local replication before claims", () => {
  const analysis = stableAnalysis();
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({ applyTargetStepId: analysis.results[0].step.id }),
    tuningAnalysis: analysis,
  });

  assert.equal(snapshot.scope, "local");
  assert.equal(snapshot.status, "replication_needed");
  assert.equal(snapshot.claimReady, false);
  assert.equal(snapshot.miningStartAllowed, false);
  assert.equal(snapshot.observedEvidencePoints, 5);
  assert.equal(snapshot.requiredEvidencePoints, 5);
  assert.equal(snapshot.observedReplications, 1);
  assert.equal(snapshot.requiredReplications, 2);
  assert.ok(snapshot.missingEvidence.includes("1 more independent same-profile sample"));
  assert.match(snapshot.summary, /1 complete sample/i);
});

test("algorithm experiment confidence accepts two complete local replications for a claim gate", () => {
  const analysis = stableAnalysis();
  const stepId = analysis.results[0].step.id;
  const completeSample = {
    stepId,
    hashrate: 120_000_000,
    watts: 14,
    powerEvidenceStatus: "measured",
    sampleSeconds: 240,
    acceptedShares: 5,
    rejectedShares: 0,
    tempC: 52,
  };
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({ applyTargetStepId: stepId }),
    tuningAnalysis: analysis,
    tuningHistory: [
      { ...completeSample, capturedAt: "2026-07-02T00:01:00.000Z" },
      { ...completeSample, capturedAt: "2026-07-02T00:02:00.000Z" },
    ],
  });

  assert.equal(snapshot.scope, "local");
  assert.equal(snapshot.status, "confident");
  assert.equal(snapshot.claimReady, true);
  assert.equal(snapshot.miningStartAllowed, false);
  assert.equal(snapshot.observedReplications, 2);
  assert.equal(snapshot.requiredReplications, 2);
  assert.equal(snapshot.candidateDominatesBaseline, true);
  assert.deepEqual(snapshot.missingEvidence, []);
  assert.match(snapshot.summary, /2 complete independent samples/i);
});

test("algorithm experiment confidence blocks max-hash claims when marginal density is hold", () => {
  const analysis = stableAnalysis();
  const stepId = analysis.results[0].step.id;
  const completeSample = {
    stepId,
    hashrate: 120_000_000,
    watts: 14,
    powerEvidenceStatus: "measured",
    sampleSeconds: 240,
    acceptedShares: 5,
    rejectedShares: 0,
    tempC: 52,
  };
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({
      priority: "blocked",
      focus: "hashrate_headroom",
      hashrateImpact: "classifies_burst",
      applyTargetStepId: stepId,
      marginalDecisionStatus: "hold",
      marginalDensityRetentionRatio: 0.22,
      nextStep: "Stay on the selected density lane. Do not apply the high-output profile.",
    }),
    tuningAnalysis: analysis,
    tuningHistory: [
      { ...completeSample, capturedAt: "2026-07-02T00:01:00.000Z" },
      { ...completeSample, capturedAt: "2026-07-02T00:02:00.000Z" },
    ],
  });

  assert.equal(snapshot.scope, "local");
  assert.equal(snapshot.status, "blocked");
  assert.equal(snapshot.claimReady, false);
  assert.equal(snapshot.confidenceScore, 0);
  assert.equal(snapshot.candidateStepId, stepId);
  assert.ok(snapshot.missingEvidence.some((item) => /extra watts/i.test(item)));
  assert.match(snapshot.summary, /blocked/i);
});
test("algorithm experiment confidence marks partial local samples as provisional", () => {
  const plan = tuningPlan("balanced");
  const analysis = analyzeTuningObservations(plan, [
    {
      stepId: plan.steps[0].id,
      hashrate: 120_000_000,
      watts: 14,
      powerEvidenceStatus: "measured",
      sampleSeconds: 240,
      acceptedShares: 1,
      rejectedShares: 0,
    },
  ]);
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({ applyTargetStepId: plan.steps[0].id }),
    tuningAnalysis: analysis,
  });

  assert.equal(snapshot.scope, "local");
  assert.equal(snapshot.status, "provisional");
  assert.equal(snapshot.claimReady, false);
  assert.ok(snapshot.observedEvidencePoints > 1);
  assert.ok(snapshot.observedEvidencePoints < snapshot.requiredEvidencePoints);
  assert.ok(snapshot.missingEvidence.includes("3 useful share events"));
});

test("algorithm experiment confidence waits for enough external telemetry samples", () => {
  const summary = summarizeExternalHashHistory([
    externalSample(2, 17),
    externalSample(1, 18),
  ]);
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({
      route: "network",
      action: "sample_network_telemetry",
      focus: "external_telemetry",
      canApplyLocalProfile: false,
      requiredSamples: 3,
    }),
    externalHistory: summary,
  });

  assert.equal(snapshot.scope, "external");
  assert.equal(snapshot.status, "replication_needed");
  assert.equal(snapshot.claimReady, false);
  assert.equal(snapshot.observedReplications, 2);
  assert.ok(snapshot.missingEvidence.some((item) => /usable external efficiency/i.test(item)));
});

test("algorithm experiment confidence accepts stable non-degrading external history", () => {
  const summary = summarizeExternalHashHistory([
    externalSample(6, 15),
    externalSample(5, 15.1),
    externalSample(4, 15.2),
    externalSample(3, 15.2),
    externalSample(2, 15.3),
    externalSample(1, 15.1),
  ]);
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({
      route: "network",
      action: "sample_network_telemetry",
      focus: "external_telemetry",
      canApplyLocalProfile: false,
      requiredSamples: 6,
    }),
    externalHistory: summary,
  });

  assert.equal(summary.evidenceStatus, "stable");
  assert.equal(snapshot.scope, "external");
  assert.equal(snapshot.status, "confident");
  assert.equal(snapshot.claimReady, true);
  assert.equal(snapshot.miningStartAllowed, false);
  assert.equal(snapshot.observedReplications, 6);
  assert.ok(snapshot.confidenceScore >= 95);
  assert.match(snapshot.nextStep, /dry-run gated/i);
});

test("algorithm experiment confidence keeps direct interfaces blocked", () => {
  const snapshot = deriveAlgorithmExperimentConfidence({
    advisor: advisor({
      route: "direct",
      priority: "blocked",
      focus: "direct_protocol",
      action: "hold_direct",
      canApplyLocalProfile: false,
      evidenceToRecord: ["physical endpoint kind", "read-only endpoint identity", "protocol framing notes"],
      nextStep: "Wait until Direct hardware exists.",
    }),
  });

  assert.equal(snapshot.scope, "direct");
  assert.equal(snapshot.status, "blocked");
  assert.equal(snapshot.claimReady, false);
  assert.equal(snapshot.miningStartAllowed, false);
  assert.ok(snapshot.missingEvidence.includes("physical endpoint kind"));
  assert.match(snapshot.summary, /reserved/i);
});

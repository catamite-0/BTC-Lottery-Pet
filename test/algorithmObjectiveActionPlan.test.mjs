import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmObjectiveActionPlan } from "../.test-dist/domain/algorithmObjectiveActionPlan.js";

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
    sourceIds: ["bitcoin_consensus_pow", "measured_power_telemetry"],
    guardrails: ["Default to density."],
    summary: "Objective ready.",
    nextStep: "Use density lane and keep burst manual.",
    ...overrides,
  };
}

function advisor(overrides = {}) {
  return {
    schemaVersion: 1,
    priority: "high",
    focus: "hashrate_headroom",
    action: "run_local_profile",
    primaryTaskId: "local_power_density_probe",
    route: "local",
    applyTargetStepId: "gpu:25",
    canApplyLocalProfile: true,
    miningStartAllowed: false,
    powerImpact: "none",
    hashrateImpact: "classifies_burst",
    marginalDecisionStatus: "advance",
    marginalDensityRetentionRatio: 0.72,
    requiredSeconds: 900,
    requiredSamples: null,
    requiredShareEvents: 6,
    evidenceToRecord: ["hashrate", "measured watts", "pool share counters"],
    stopConditions: ["profile becomes hot"],
    blockedBy: [],
    summary: "Advisor high: measure burst.",
    nextStep: "Measure max-hash headroom.",
    ...overrides,
  };
}

function directive(overrides = {}) {
  return {
    kind: "local_profile",
    route: "local",
    status: "ready",
    primaryTaskId: "local_power_density_probe",
    step: null,
    applyTarget: {
      stepId: "gpu:25",
      computeMode: "gpu",
      cpuThreads: 0,
      gpuIntensityPercent: 25,
    },
    canApplyLocalProfile: true,
    requireMeasuredPower: true,
    requireCoolOrWarmThermals: true,
    requiredSeconds: 900,
    requiredSamples: null,
    requiredShareEvents: 6,
    summary: "Run profile.",
    nextStep: "Apply target manually and capture evidence.",
    ...overrides,
  };
}

test("algorithm objective action keeps verified max-hash as manual burst", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(certificate(), advisor(), directive());

  assert.equal(plan.action, "keep_manual_burst_available");
  assert.equal(plan.priority, "high");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.equal(plan.externalMiningAllowed, false);
  assert.match(plan.summary, /manual burst/i);
  assert.match(plan.nextStep, /burst manual/i);
  assert.ok(plan.stopConditions.includes("objective certificate status regresses"));
});

test("algorithm objective action promotes no-extra-watt max hash as density lane", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      burstHashrate: 520_000_000,
      burstWatts: 12,
      marginalDensityRetentionRatio: 1,
      nextStep: "Use verified high-hash density lane.",
    }),
    advisor(),
    directive(),
  );

  assert.equal(plan.action, "run_density_lane");
  assert.equal(plan.localProfileApplyAllowed, true);
  assert.equal(plan.applyTargetStepId, "gpu:25");
  assert.match(plan.reason, /current watt envelope/i);
  assert.match(plan.summary, /verified high-hash density lane/i);
  assert.match(plan.nextStep, /stable share and watt evidence/i);
});

test("algorithm objective action keeps higher-watt max hash as manual burst", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      burstHashrate: 520_000_000,
      burstWatts: 13.2,
      marginalDensityRetentionRatio: 1,
      nextStep: "Keep the higher-watt profile manual.",
    }),
    advisor(),
    directive(),
  );

  assert.equal(plan.action, "keep_manual_burst_available");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.match(plan.reason, /manual burst only/i);
});

test("algorithm objective action captures local evidence while objective is waiting", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "waiting",
      runtimeMode: "collect_evidence",
      lowPowerReady: false,
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "needs_measurement",
      burstHashrate: null,
      burstWatts: null,
      primaryBlockerId: "measured_power",
      primaryBlockerSummary: "Selected local lane needs measured watt evidence.",
      nextStep: "Capture measured watts.",
    }),
    advisor({ focus: "power_baseline", applyTargetStepId: "cpu:2", nextStep: "Capture measured watts." }),
    directive({
      primaryTaskId: "local_measured_power",
      applyTarget: { stepId: "cpu:2", computeMode: "cpu", cpuThreads: 2, gpuIntensityPercent: 0 },
      nextStep: "Apply baseline and measure watts.",
    }),
  );

  assert.equal(plan.action, "capture_local_evidence");
  assert.equal(plan.localProfileApplyAllowed, true);
  assert.equal(plan.applyTargetStepId, "cpu:2");
  assert.ok(plan.evidenceToRecord.includes("low-power lane readiness"));
  assert.ok(plan.evidenceToRecord.includes("max-hash burst readiness"));
});

test("algorithm objective action verifies kernel benchmark before local profile apply", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "waiting",
      runtimeMode: "collect_evidence",
      lowPowerReady: false,
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "kernel_evidence_wait",
      primaryEvidenceGap: "kernel_evidence_wait",
      primaryBlockerId: "consensus_midstate",
      primaryBlockerSummary: "Fixed-window midstate benchmark is missing.",
      burstHashrate: null,
      burstWatts: null,
      nextStep: "Run the fixed-window kernel benchmark.",
    }),
    advisor({ canApplyLocalProfile: true, nextStep: "Do not tune yet." }),
    directive({ canApplyLocalProfile: true }),
  );

  assert.equal(plan.action, "verify_kernel_benchmark");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.ok(plan.evidenceToRecord.includes("fixed-window kernel benchmark"));
  assert.match(plan.summary, /verify.*midstate benchmark/i);
  assert.match(plan.nextStep, /fixed-window kernel benchmark/i);
});

test("algorithm objective action repairs blocked kernel proof without profile apply", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "partial",
      runtimeMode: "density_default",
      lowPowerReady: true,
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "kernel_blocked",
      primaryEvidenceGap: "kernel_blocked",
      burstHashrate: null,
      burstWatts: null,
      nextStep: "Repair the midstate equivalence proof.",
    }),
    advisor(),
    directive(),
  );

  assert.equal(plan.action, "repair_kernel_proof");
  assert.equal(plan.priority, "critical");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.ok(plan.evidenceToRecord.includes("midstate equivalence and performance proof"));
  assert.match(plan.reason, /full-header|regressed/i);
});
test("algorithm objective action holds max-hash when marginal watts do not pay", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "partial",
      runtimeMode: "density_default",
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "marginal_hold",
      burstHashrate: null,
      burstWatts: null,
      nextStep: "Stay on the selected density lane.",
    }),
    advisor({ priority: "blocked", canApplyLocalProfile: false, nextStep: "Do not apply high output." }),
    directive({ canApplyLocalProfile: false }),
  );

  assert.equal(plan.action, "hold_max_hash");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.match(plan.reason, /extra watts/i);
  assert.equal(plan.nextStep, "Stay on the selected density lane.");
});

test("algorithm objective action prioritizes runtime guard recovery", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "blocked",
      runtimeMode: "runtime_guard",
      highHashReady: false,
      maxHashBurstAvailable: false,
      primaryBlockerId: "runtime_guard",
      primaryBlockerSummary: "Live runtime evidence shows waste.",
      nextStep: "Reduce share waste before promotion.",
    }),
    advisor({ priority: "high", canApplyLocalProfile: true }),
    directive({ canApplyLocalProfile: true }),
  );

  assert.equal(plan.action, "recover_runtime_guard");
  assert.equal(plan.priority, "critical");
  assert.equal(plan.localProfileApplyAllowed, false);
  assert.equal(plan.applyTargetStepId, null);
  assert.match(plan.reason, /waste/i);
  assert.equal(plan.nextStep, "Reduce share waste before promotion.");
});

test("algorithm objective action keeps external high hash in dry-run validation", () => {
  const plan = deriveAlgorithmObjectiveActionPlan(
    certificate({
      status: "dry_run",
      runtimeMode: "external_dry_run",
      lowPowerReady: false,
      highHashReady: false,
      maxHashBurstAvailable: false,
      highHashPath: "external_dry_run",
      nextStep: "Complete external work validation.",
    }),
    advisor({
      priority: "high",
      focus: "external_work_validation",
      route: "external",
      canApplyLocalProfile: false,
      nextStep: "Validate mock leases and share accounting.",
    }),
    directive({ route: "external", kind: "external_dry_run", canApplyLocalProfile: false }),
  );

  assert.equal(plan.action, "validate_external_dry_run");
  assert.equal(plan.priority, "critical");
  assert.equal(plan.miningStartAllowed, false);
  assert.equal(plan.externalMiningAllowed, false);
  assert.match(plan.nextStep, /mock leases/i);
});

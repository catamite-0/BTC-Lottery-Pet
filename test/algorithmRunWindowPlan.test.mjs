import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmRunWindowPlan } from "../.test-dist/domain/algorithmRunWindowPlan.js";

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "budgeted_burst",
    status: "manual",
    averagePowerBudgetWatts: 20,
    defaultHashrate: 200_000_000,
    defaultWatts: 10,
    defaultJoulesPerTerahash: 50_000,
    burstHashrate: 500_000_000,
    burstWatts: 30,
    burstJoulesPerTerahash: 60_000,
    defaultDutyPercent: 50,
    burstDutyPercent: 50,
    projectedAverageHashrate: 350_000_000,
    projectedAverageWatts: 20,
    projectedJoulesPerTerahash: 57_142.86,
    incrementalHashrate: 150_000_000,
    incrementalWatts: 10,
    marginalHashratePerWatt: 15_000_000,
    hashrateGainVsDefaultPercent: 75,
    powerSavedVsAlwaysBurstPercent: 33.3,
    canUseBurst: true,
    manualApprovalRequired: true,
    protectsLowPowerLane: true,
    externalMiningAllowed: false,
    guardrails: [],
    summary: "Budgeted burst.",
    nextStep: "Run budgeted burst.",
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "manual_burst",
    priority: "manual",
    selectedIntent: "best_hashrate",
    canApplyProfile: true,
    manualApprovalRequired: true,
    autoApplyAllowed: false,
    protectsLowPowerLane: true,
    opensHighHashBurst: true,
    externalMiningAllowed: false,
    targetStepId: "gpu-max",
    targetStepSummary: "GPU max",
    targetComputeMode: null,
    targetCpuThreads: null,
    targetGpuIntensityPercent: null,
    defaultPointRole: "balanced",
    defaultPointHashrate: 200_000_000,
    defaultPointWatts: 10,
    burstAllowed: true,
    burstHashrate: 500_000_000,
    burstWatts: 30,
    guardrails: [],
    summary: "Manual burst ready.",
    nextStep: "Burst manually.",
    ...overrides,
  };
}

function experiment(overrides = {}) {
  return {
    schemaVersion: 1,
    stage: "run_density_lane",
    route: "local",
    primaryTaskId: "local_stability_window",
    objectiveGap: "none",
    targetProfileStepId: "gpu-eco",
    targetProfileSummary: "GPU eco",
    targetComputeMode: "gpu",
    targetCpuThreads: 0,
    targetGpuIntensityPercent: 35,
    requiredSeconds: 300,
    remainingSeconds: 0,
    requiredSamples: 1,
    remainingSamples: 0,
    requiredShareEvents: 6,
    remainingShareEvents: 0,
    requiresMeasuredPower: true,
    requiresCoolOrWarmThermals: true,
    canApplyLocalProfile: true,
    capturePolicy: {
      enabled: true,
      mode: "local_sample",
      requiredStepId: "gpu-eco",
      minCaptureSeconds: 300,
      refreshSeconds: 300,
      requireMeasuredPower: true,
      requireCoolOrWarmThermals: true,
      requiredShareEvents: 6,
      applyBeforeCapture: false,
      summary: "Capture active density lane.",
    },
    miningStartAllowed: false,
    externalMiningAllowed: false,
    successCriteria: ["stable sample"],
    evidenceChecklist: ["measured watts"],
    stopConditions: ["share waste rises", "thermal state hot"],
    summary: "Run density lane.",
    nextStep: "Keep density running.",
    ...overrides,
  };
}

test("run window converts budgeted burst duty into a manual cycle", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ burstDutyPercent: 50 }),
    runtimeRecommendation: runtime({ autoApplyAllowed: true }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "budgeted_burst_cycle");
  assert.equal(plan.status, "manual");
  assert.equal(plan.cycleSeconds, 900);
  assert.equal(plan.burstSeconds, 450);
  assert.equal(plan.densitySeconds, 450);
  assert.equal(plan.cooldownSeconds, 113);
  assert.equal(plan.canRunBurst, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.canAutoApplyDensity, false);
});

test("run window sustains density when high hash is held", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "density_only", status: "ready", burstDutyPercent: 0, canUseBurst: false, projectedAverageHashrate: 200_000_000, projectedAverageWatts: 10 }),
    runtimeRecommendation: runtime({ mode: "hold_high_hash", opensHighHashBurst: false, canApplyProfile: true, autoApplyAllowed: true }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "density_sustain");
  assert.equal(plan.densitySeconds, 900);
  assert.equal(plan.burstSeconds, 0);
  assert.equal(plan.canRunDensity, true);
  assert.equal(plan.canRunBurst, false);
  assert.equal(plan.canAutoApplyDensity, true);
});

test("run window treats a dominant high-hash profile as density sustain", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "dominant_high_hash_density", status: "ready", burstDutyPercent: 0, canUseBurst: false, projectedAverageHashrate: 520_000_000, projectedAverageWatts: 18 }),
    runtimeRecommendation: runtime({ mode: "run_density_default", opensHighHashBurst: false, canApplyProfile: true, autoApplyAllowed: true, manualApprovalRequired: false }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "density_sustain");
  assert.equal(plan.status, "ready");
  assert.equal(plan.burstSeconds, 0);
  assert.equal(plan.projectedAverageHashrate, 520_000_000);
  assert.equal(plan.projectedAverageWatts, 18);
  assert.equal(plan.canRunBurst, false);
  assert.equal(plan.canAutoApplyDensity, true);
});
test("run window captures evidence before changing envelope", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "evidence_wait", status: "waiting", canUseBurst: false, burstDutyPercent: null }),
    runtimeRecommendation: runtime({ mode: "capture_evidence", priority: "evidence", opensHighHashBurst: false, canApplyProfile: true, autoApplyAllowed: false }),
    objectiveExperiment: experiment({ stage: "collect_low_power_evidence", requiredSeconds: 420, capturePolicy: { ...experiment().capturePolicy, minCaptureSeconds: 420, refreshSeconds: 420 } }),
  });

  assert.equal(plan.mode, "capture_window");
  assert.equal(plan.status, "ready");
  assert.equal(plan.cycleSeconds, 420);
  assert.equal(plan.densitySeconds, 420);
  assert.equal(plan.burstSeconds, 0);
  assert.equal(plan.captureSeconds, 420);
});

test("run window keeps verified burst manual when no bounded duty exists", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "manual_burst_window", burstDutyPercent: 0, canUseBurst: true }),
    runtimeRecommendation: runtime({ autoApplyAllowed: true }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "manual_burst_window");
  assert.equal(plan.cycleSeconds, null);
  assert.equal(plan.burstSeconds, null);
  assert.equal(plan.canRunBurst, true);
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.canAutoApplyDensity, false);
  assert.match(plan.nextStep, /power budget/i);
});

test("run window suppresses auto apply in bounded manual burst windows", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "manual_burst_window", burstDutyPercent: 100, canUseBurst: true }),
    runtimeRecommendation: runtime({ autoApplyAllowed: true }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "manual_burst_window");
  assert.equal(plan.manualApprovalRequired, true);
  assert.equal(plan.canRunBurst, true);
  assert.equal(plan.canAutoApplyDensity, false);
});
test("run window blocks all higher load while runtime guard blocks", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "runtime_guard", status: "blocked", canUseBurst: false, nextStep: "Reduce waste." }),
    runtimeRecommendation: runtime({ mode: "runtime_guard", opensHighHashBurst: false, canApplyProfile: false }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "blocked");
  assert.equal(plan.status, "blocked");
  assert.equal(plan.canRunDensity, false);
  assert.equal(plan.canRunBurst, false);
  assert.match(plan.nextStep, /reduce waste/i);
});

test("run window stays monitor-only while kernel benchmark is unverified", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "density_only", status: "ready", canUseBurst: false, burstDutyPercent: 0, projectedAverageHashrate: 200_000_000, projectedAverageWatts: 10 }),
    runtimeRecommendation: runtime({
      mode: "monitor",
      priority: "evidence",
      selectedIntent: null,
      canApplyProfile: false,
      autoApplyAllowed: false,
      opensHighHashBurst: false,
      guardrails: ["Keep the full-header baseline active until kernel evidence passes."],
      nextStep: "Run fixed-window kernel benchmark.",
    }),
    objectiveExperiment: experiment({
      stage: "verify_kernel_benchmark",
      route: "research",
      capturePolicy: { ...experiment().capturePolicy, enabled: false, mode: "monitor_only", requiredStepId: null, minCaptureSeconds: null, refreshSeconds: null },
      nextStep: "Run fixed-window kernel benchmark.",
    }),
  });

  assert.equal(plan.mode, "monitor");
  assert.equal(plan.status, "waiting");
  assert.equal(plan.canRunDensity, false);
  assert.equal(plan.canRunBurst, false);
  assert.equal(plan.canAutoApplyDensity, false);
  assert.match(plan.summary, /monitor-only/i);
  assert.match(plan.nextStep, /fixed-window kernel benchmark/i);
  assert.ok(plan.guardrails.some((guardrail) => /full-header baseline/i.test(guardrail)));
});

test("run window blocks scheduling while kernel proof repair is required", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "density_only", status: "ready", canUseBurst: false, burstDutyPercent: 0, projectedAverageHashrate: 200_000_000, projectedAverageWatts: 10 }),
    runtimeRecommendation: runtime({
      mode: "monitor",
      priority: "blocked",
      selectedIntent: null,
      canApplyProfile: false,
      autoApplyAllowed: false,
      opensHighHashBurst: false,
      guardrails: ["Do not promote midstate or high-hash profiles from missing kernel proof."],
      nextStep: "Repair the midstate equivalence proof.",
    }),
    objectiveExperiment: experiment({
      stage: "repair_kernel_proof",
      route: "research",
      capturePolicy: { ...experiment().capturePolicy, enabled: false, mode: "monitor_only", requiredStepId: null, minCaptureSeconds: null, refreshSeconds: null },
      nextStep: "Repair the midstate equivalence proof.",
    }),
  });

  assert.equal(plan.mode, "monitor");
  assert.equal(plan.status, "blocked");
  assert.equal(plan.canRunDensity, false);
  assert.equal(plan.canRunBurst, false);
  assert.match(plan.nextStep, /midstate equivalence proof/i);
  assert.ok(plan.guardrails.some((guardrail) => /missing kernel proof/i.test(guardrail)));
});
test("run window never schedules real external dry-run mining", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "external_dry_run", status: "waiting", canUseBurst: false }),
    runtimeRecommendation: runtime({ mode: "external_dry_run", opensHighHashBurst: false, canApplyProfile: false }),
    objectiveExperiment: experiment({ route: "external", capturePolicy: { ...experiment().capturePolicy, mode: "external_dry_run", requiredStepId: null } }),
  });

  assert.equal(plan.mode, "external_dry_run");
  assert.equal(plan.externalMiningAllowed, false);
  assert.equal(plan.canRunBurst, false);
  assert.equal(plan.canRunDensity, false);
});
test("run window keeps density closed when runtime profile gate is closed", () => {
  const plan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope: envelope({ mode: "density_only", status: "ready", canUseBurst: false, burstDutyPercent: 0 }),
    runtimeRecommendation: runtime({
      mode: "run_density_default",
      priority: "run",
      opensHighHashBurst: false,
      canApplyProfile: false,
      autoApplyAllowed: false,
      manualApprovalRequired: false,
      nextStep: "Capture lowest power evidence first.",
    }),
    objectiveExperiment: experiment(),
  });

  assert.equal(plan.mode, "density_sustain");
  assert.equal(plan.status, "waiting");
  assert.match(plan.summary, /runtime profile gate/i);
  assert.equal(plan.canRunDensity, false);
  assert.equal(plan.canAutoApplyDensity, false);
  assert.match(plan.nextStep, /capture lowest power evidence/i);
});

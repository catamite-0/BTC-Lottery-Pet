import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmRunEvidenceReview } from "../.test-dist/domain/algorithmRunEvidenceReview.js";

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
    guardrails: ["Keep density as fallback."],
    summary: "Budgeted burst.",
    nextStep: "Run budgeted burst.",
    ...overrides,
  };
}

function runWindow(overrides = {}) {
  return {
    schemaVersion: 1,
    mode: "budgeted_burst_cycle",
    status: "manual",
    cycleSeconds: 900,
    densitySeconds: 450,
    burstSeconds: 450,
    cooldownSeconds: 113,
    captureSeconds: 300,
    refreshSeconds: 300,
    burstDutyPercent: 50,
    projectedAverageHashrate: 350_000_000,
    projectedAverageWatts: 20,
    canRunDensity: true,
    canRunBurst: true,
    canAutoApplyDensity: false,
    manualApprovalRequired: true,
    externalMiningAllowed: false,
    requiredStepId: "gpu-eco",
    stopConditions: ["share waste rises"],
    guardrails: ["Abort on thermal degradation."],
    summary: "Run window ready.",
    nextStep: "Run density by default.",
    ...overrides,
  };
}

function result(overrides = {}) {
  return {
    step: {
      id: "gpu-eco",
      order: 1,
      priority: "efficiency",
      computeMode: "gpu",
      performancePreset: "low_power",
      cpuThreads: 0,
      gpuIntensityPercent: 35,
      sampleSeconds: 300,
      estimatedHashrate: 350_000_000,
      estimatedWatts: 20,
      joulesPerTerahash: 57_142.86,
      summary: "GPU eco",
      reason: "baseline",
    },
    hashrate: 352_000_000,
    effectiveHashrate: 350_000_000,
    watts: 20,
    joulesPerTerahash: 56_818.18,
    effectiveJoulesPerTerahash: 57_142.86,
    acceptedShares: 8,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 1_000,
    gpuThrottleMs: 0,
    gpuDutyCycle: 1,
    gpuThrottleRatio: 0,
    runtimeDutyStatus: "full_duty",
    runtimeDutyWeight: 1,
    runtimeDutySummary: "Full duty.",
    rejectedShareRatio: 0,
    staleShareRatio: 0,
    shareWasteRatio: 0,
    shareEvidenceStatus: "proven",
    shareEvidenceWeight: 1,
    shareEvidenceSummary: "Share evidence proven.",
    powerEvidenceStatus: "measured",
    powerEvidenceWeight: 1,
    powerEvidenceSummary: "Power measured.",
    sampleSeconds: 300,
    stability: "stable",
    thermalStatus: "cool",
    thermalWeight: 1,
    thermalSummary: "Cool.",
    maxObservedTempC: 55,
    stabilityWindowStatus: "stable",
    stabilityWindowWeight: 1,
    stabilityWindowSummary: "Stable.",
    stabilityWindowProgress: 1,
    qualityScore: 1,
    qualityAdjustedHashrate: 350_000_000,
    qualityAdjustedJoulesPerTerahash: 57_142.86,
    longRunScore: 92,
    longRunRisk: "good",
    longRunSummary: "Good.",
    ...overrides,
  };
}

function analysis(results = []) {
  return {
    results,
    lowestPower: results[0] ?? null,
    bestEfficiency: results[0] ?? null,
    bestHashrate: results[0] ?? null,
    paretoFrontier: results,
    marginalFrontier: [],
    powerDensityKnee: results[0] ?? null,
    powerDensityKneeSummary: "ready",
    paretoRecommendation: results[0] ?? null,
    paretoRecommendationSummary: "ready",
    paretoSummary: "ready",
    summary: "ready",
  };
}

function review(overrides = {}) {
  return deriveAlgorithmRunEvidenceReview({
    runWindowPlan: overrides.runWindowPlan ?? runWindow(),
    powerHashEnvelope: overrides.powerHashEnvelope ?? envelope(),
    tuningAnalysis: overrides.tuningAnalysis ?? analysis(),
  });
}

test("run evidence waits when no local result exists", () => {
  const snapshot = review();

  assert.equal(snapshot.status, "waiting_sample");
  assert.equal(snapshot.action, "capture_window");
  assert.deepEqual(snapshot.missingEvidence, ["local tuning result"]);
});

test("run evidence marks an incomplete capture window", () => {
  const snapshot = review({
    tuningAnalysis: analysis([result({
      sampleSeconds: 120,
      stabilityWindowStatus: "probing",
      stabilityWindowProgress: 0.4,
    })]),
  });

  assert.equal(snapshot.status, "window_incomplete");
  assert.equal(snapshot.action, "extend_window");
  assert.ok(snapshot.missingEvidence.includes("full run window"));
  assert.ok(snapshot.captureProgress < 1);
});

test("run evidence accepts measured stable evidence within plan", () => {
  const snapshot = review({
    tuningAnalysis: analysis([result({
      effectiveHashrate: 348_000_000,
      watts: 20.5,
    })]),
  });

  assert.equal(snapshot.status, "within_plan");
  assert.equal(snapshot.action, "keep_plan");
  assert.equal(snapshot.hashrateDeltaPercent, -0.6);
  assert.equal(snapshot.wattsDeltaPercent, 2.5);
});

test("run evidence flags underperforming hashrate or power", () => {
  const snapshot = review({
    tuningAnalysis: analysis([result({
      effectiveHashrate: 250_000_000,
      watts: 24,
      longRunRisk: "watch",
      longRunScore: 72,
    })]),
  });

  assert.equal(snapshot.status, "underperforming");
  assert.equal(snapshot.action, "hold_burst");
  assert.ok(snapshot.summary.includes("effective hashrate"));
  assert.ok(snapshot.summary.includes("power"));
});

test("run evidence blocks unsafe samples before judging completeness", () => {
  const snapshot = review({
    tuningAnalysis: analysis([result({
      sampleSeconds: 120,
      thermalStatus: "hot",
      shareWasteRatio: 0.13,
      longRunRisk: "avoid",
      longRunScore: 30,
    })]),
  });

  assert.equal(snapshot.status, "unsafe");
  assert.equal(snapshot.action, "lower_load");
  assert.deepEqual(snapshot.missingEvidence, []);
});

test("run evidence treats monitor windows as proof gates instead of missing samples", () => {
  const snapshot = review({
    runWindowPlan: runWindow({
      mode: "monitor",
      status: "waiting",
      canRunBurst: false,
      canRunDensity: false,
      canAutoApplyDensity: false,
      requiredStepId: null,
      captureSeconds: null,
      cycleSeconds: null,
      nextStep: "Run fixed-window kernel benchmark.",
      guardrails: ["Keep the full-header baseline active until kernel evidence passes."],
    }),
    powerHashEnvelope: envelope({ mode: "density_only", status: "ready", canUseBurst: false }),
  });

  assert.equal(snapshot.status, "monitor");
  assert.equal(snapshot.action, "monitor");
  assert.equal(snapshot.targetStepId, null);
  assert.equal(snapshot.requiredSampleSeconds, null);
  assert.equal(snapshot.captureProgress, 0);
  assert.deepEqual(snapshot.missingEvidence, []);
  assert.match(snapshot.summary, /monitor-only/i);
  assert.match(snapshot.nextStep, /fixed-window kernel benchmark/i);
  assert.ok(snapshot.guardrails.some((guardrail) => /full-header baseline/i.test(guardrail)));
});
test("run evidence keeps external dry-run and runtime block as pass-through states", () => {
  const external = review({
    runWindowPlan: runWindow({ mode: "external_dry_run", status: "waiting", canRunBurst: false, canRunDensity: false }),
    powerHashEnvelope: envelope({ mode: "external_dry_run", status: "waiting", canUseBurst: false }),
  });
  assert.equal(external.status, "external_dry_run");
  assert.equal(external.action, "validate_external");

  const blocked = review({
    runWindowPlan: runWindow({ mode: "blocked", status: "blocked", canRunBurst: false, canRunDensity: false }),
    powerHashEnvelope: envelope({ mode: "runtime_guard", status: "blocked", canUseBurst: false }),
  });
  assert.equal(blocked.status, "runtime_blocked");
  assert.equal(blocked.action, "recover_runtime");
});

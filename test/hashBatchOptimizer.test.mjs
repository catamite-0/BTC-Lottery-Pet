import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveHashBatchOptimization,
  MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS,
  MIN_HASH_BATCH_RUNTIME_SHARE_EVENTS,
  MIN_HASH_BATCH_SPARSE_RUNTIME_SECONDS,
} from "../.test-dist/domain/hashBatchOptimizer.js";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
} from "../.test-dist/domain/efficiencyTuning.js";
import {
  deriveHashRuntimeEfficiencySnapshot,
  MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS,
  MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS,
} from "../.test-dist/domain/hashRuntimeEfficiency.js";

function gpuSweep({ goal = "balanced", intensity = 25, maxSteps = 5 } = {}) {
  return createTuningSweepPlan({
    goal,
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: intensity,
    maxSteps,
    sampleSeconds: 120,
  });
}

function gpuStep(plan, intensity) {
  const step = plan.steps.find((candidate) => (
    candidate.computeMode === "gpu" && candidate.gpuIntensityPercent === intensity
  ));
  assert.ok(step, `missing GPU ${intensity}% step in ${plan.steps.map((candidate) => candidate.summary).join(", ")}`);
  return step;
}

function cleanRuntime(overrides = {}) {
  return deriveHashRuntimeEfficiencySnapshot({
    hashrate: 220_000_000,
    acceptedShares: 20,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 220,
    gpuThrottleMs: 0,
    ...overrides,
  });
}

function analysisFor(plan, step, overrides = {}) {
  return analyzeTuningObservations(plan, [{
    stepId: step.id,
    hashrate: 220_000_000,
    watts: 24,
    powerEvidenceStatus: "measured",
    sampleSeconds: 900,
    acceptedShares: 6,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 90,
    gpuThrottleMs: 0,
    tempC: 56,
    ...overrides,
  }]);
}

test("batch optimizer waits for a measured active GPU sample", () => {
  const plan = gpuSweep({ intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analyzeTuningObservations(plan, []),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "balanced",
  });

  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.action, "collect_evidence");
  assert.equal(snapshot.currentStep?.id, step.id);
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.nextStep, /Capture a tuning sample/i);
});

test("batch optimizer raises intensity when dispatches are underfilled", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime(),
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "increase_intensity");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.canApply, true);
  assert.ok(Number(snapshot.targetGpuIntensityPercent) > step.gpuIntensityPercent);
  assert.match(snapshot.nextStep, /re-measure watts/i);
});

test("batch optimizer blocks higher intensity on thin live share evidence", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime({ acceptedShares: 1 }),
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.canApply, false);
  assert.equal(snapshot.currentResult?.acceptedShares, 6);
  assert.equal(snapshot.runtimeEfficiencyStatus, "efficient");
  assert.match(snapshot.summary, /live runtime evidence/i);
});
test("batch optimizer blocks sparse runtime promotion until at least one share lands", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime({ acceptedShares: 0, sampleSeconds: MIN_HASH_BATCH_SPARSE_RUNTIME_SECONDS }),
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.summary, /live runtime evidence/i);
});
test("batch optimizer accepts sparse live shares after a long clean runtime", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime({ acceptedShares: 1, sampleSeconds: MIN_HASH_BATCH_SPARSE_RUNTIME_SECONDS }),
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "increase_intensity");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.canApply, true);
  assert.equal(snapshot.runtimeEfficiencyStatus, "efficient");
  assert.ok(Number(snapshot.targetGpuIntensityPercent) > step.gpuIntensityPercent);
});
test("batch optimizer blocks higher intensity without live runtime evidence", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.summary, /live runtime evidence/i);
  assert.match(snapshot.nextStep, /share quality/i);
});
test("batch optimizer keeps underfilled GPU work low when lowest power is the objective", () => {
  const plan = gpuSweep({ goal: "lowest_power", intensity: 10 });
  const step = gpuStep(plan, 10);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 60, gpuThrottleMs: 0, watts: 12 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "lowest_power",
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.summary, /lowest-power/i);
});

test("batch optimizer lowers intensity when dispatch latency and throttle are high", () => {
  const plan = gpuSweep({ intensity: 75 });
  const step = gpuStep(plan, 75);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 900, gpuThrottleMs: 850, tempC: 64 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "balanced",
  });

  assert.equal(snapshot.pressure, "throttled");
  assert.equal(snapshot.action, "decrease_intensity");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.canApply, true);
  assert.ok(Number(snapshot.targetGpuIntensityPercent) < step.gpuIntensityPercent);
  assert.match(snapshot.nextStep, /confirm share waste/i);
});

test("batch optimizer lowers intensity when share waste rises", () => {
  const plan = gpuSweep({ intensity: 50 });
  const step = gpuStep(plan, 50);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, {
      acceptedShares: 6,
      rejectedShares: 1,
      staleSharesDropped: 2,
      queuedSharesDropped: 0,
      gpuDispatchMs: 240,
      gpuThrottleMs: 0,
    }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "balanced",
  });

  assert.equal(snapshot.pressure, "wasteful");
  assert.equal(snapshot.action, "decrease_intensity");
  assert.equal(snapshot.canApply, true);
  assert.ok(snapshot.guardrails.some((guardrail) => /share waste/i.test(guardrail)));
});
test("batch optimizer blocks higher intensity on short share samples", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, {
      sampleSeconds: 240,
      acceptedShares: 6,
      rejectedShares: 0,
      gpuDispatchMs: 70,
      gpuThrottleMs: 0,
    }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime(),
  });

  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.action, "collect_evidence");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.nextStep, /longer measured sample/i);
});

test("batch optimizer blocks efficiency increases without measured power", () => {
  const plan = gpuSweep({ goal: "max_efficiency", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, {
      powerEvidenceStatus: "estimated",
      sampleSeconds: 900,
      acceptedShares: 6,
      rejectedShares: 0,
      gpuDispatchMs: 70,
      gpuThrottleMs: 0,
    }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_efficiency",
    runtimeEfficiency: cleanRuntime(),
  });

  assert.equal(snapshot.pressure, "underfilled");
  assert.equal(snapshot.action, "increase_intensity");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.canApply, false);
  assert.ok(snapshot.guardrails.some((guardrail) => /5 minutes/i.test(guardrail)));
});
test("batch optimizer holds max hash increases on noisy long-run evidence", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, {
      sampleSeconds: 900,
      acceptedShares: 30,
      rejectedShares: 1,
      staleSharesDropped: 0,
      queuedSharesDropped: 0,
      gpuDispatchMs: 240,
      gpuThrottleMs: 0,
    }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime(),
  });

  assert.equal(snapshot.pressure, "balanced");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.summary, /long-run evidence/i);
  assert.match(snapshot.nextStep, /stable/i);
});
test("batch optimizer exposes the minimum apply sample window", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency: cleanRuntime(),
  });

  assert.equal(snapshot.requiredSampleSeconds, MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS);
  assert.equal(snapshot.requiredSampleSeconds, 300);
  assert.equal(MIN_HASH_BATCH_RUNTIME_SHARE_EVENTS, MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS);
  assert.equal(MIN_HASH_BATCH_SPARSE_RUNTIME_SECONDS, MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS);
  assert.equal(MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS, 3);
  assert.equal(MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS, 900);
});
test("batch optimizer holds intensity raises while live runtime evidence is watch", () => {
  const plan = gpuSweep({ goal: "max_hashrate", intensity: 25 });
  const step = gpuStep(plan, 25);
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 220_000_000,
    acceptedShares: 9,
    rejectedShares: 1,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 220,
    gpuThrottleMs: 0,
  });
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 70, gpuThrottleMs: 0 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "max_hashrate",
    runtimeEfficiency,
  });

  assert.equal(snapshot.runtimeGuard, "observe");
  assert.equal(snapshot.runtimeEfficiencyStatus, "watch");
  assert.equal(snapshot.runtimePromotionAllowed, false);
  assert.equal(snapshot.runtimeRecoveryAction, "hold_load");
  assert.equal(snapshot.runtimeQualityLossHashrate, 22_000_000);
  assert.equal(snapshot.action, "hold");
  assert.equal(snapshot.status, "holding");
  assert.equal(snapshot.canApply, false);
  assert.match(snapshot.summary, /runtime evidence/i);
});

test("batch optimizer still allows lowering intensity when live runtime evidence is blocked", () => {
  const plan = gpuSweep({ intensity: 75 });
  const step = gpuStep(plan, 75);
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 220_000_000,
    acceptedShares: 6,
    rejectedShares: 1,
    staleSharesDropped: 2,
    queuedSharesDropped: 1,
    gpuDispatchMs: 400,
    gpuThrottleMs: 0,
  });
  const snapshot = deriveHashBatchOptimization({
    tuningSweepPlan: plan,
    tuningAnalysis: analysisFor(plan, step, { gpuDispatchMs: 900, gpuThrottleMs: 850, tempC: 64 }),
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: step.gpuIntensityPercent,
    objective: "balanced",
    runtimeEfficiency,
  });

  assert.equal(snapshot.runtimeGuard, "block");
  assert.equal(snapshot.runtimeEfficiencyStatus, "wasteful");
  assert.equal(snapshot.runtimePromotionAllowed, false);
  assert.equal(snapshot.runtimeRecoveryAction, "lower_load");
  assert.equal(snapshot.runtimeQualityLossHashrate, 88_000_000);
  assert.equal(snapshot.action, "decrease_intensity");
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.canApply, true);
  assert.ok(Number(snapshot.targetGpuIntensityPercent) < step.gpuIntensityPercent);
});

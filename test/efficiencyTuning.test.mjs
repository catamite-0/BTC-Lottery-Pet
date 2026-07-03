import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeTuningObservations,
  createPowerBudgetCurve,
  createTuningSweepPlan,
  deriveTuningApplyOption,
  diffTuningShareCounters,
  findTuningSweepStepForRuntime,
  selectParetoTuningResult,
  selectPowerBudgetTuningResult,
  selectTuningResult,
  upsertTuningObservation,
} from "../.test-dist/domain/efficiencyTuning.js";
import { deriveHashRuntimeEfficiencySnapshot } from "../.test-dist/domain/hashRuntimeEfficiency.js";

test("tuning sweep starts with the current runtime profile", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: 50,
    maxSteps: 4,
    sampleSeconds: 30,
  });

  assert.equal(plan.steps.length, 4);
  assert.equal(plan.steps[0].priority, "baseline");
  assert.equal(plan.steps[0].computeMode, "gpu");
  assert.equal(plan.steps[0].gpuIntensityPercent, 50);
  assert.equal(plan.totalSeconds, 120);
});

test("tuning sweep keeps max efficiency away from hybrid and full throttle", () => {
  const plan = createTuningSweepPlan({
    goal: "max_efficiency",
    availableCpuThreads: 16,
    recommendedCpuThreads: 4,
    hardwareGpuAvailable: true,
    maxSteps: 6,
  });

  assert.equal(plan.steps.some((step) => step.computeMode === "hybrid"), false);
  assert.equal(plan.steps.some((step) => step.gpuIntensityPercent === 100), false);
});

test("tuning sweep can prioritize the lowest local watt draw", () => {
  const plan = createTuningSweepPlan({
    goal: "lowest_power",
    availableCpuThreads: 16,
    recommendedCpuThreads: 4,
    hardwareGpuAvailable: true,
    maxSteps: 5,
  });

  assert.equal(plan.goal, "lowest_power");
  assert.equal(plan.steps.some((step) => step.computeMode === "hybrid"), false);
  assert.equal(plan.steps.filter((step) => step.priority !== "baseline").every((step) => step.priority === "power"), true);
  assert.equal(plan.steps.filter((step) => step.computeMode === "gpu").every((step) => step.gpuIntensityPercent <= 25), true);
  assert.ok(plan.steps.some((step) => step.cpuThreads === 1));
});


test("tuning runtime step matching keeps CPU profiles independent from GPU intensity", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    currentComputeMode: "cpu",
    currentCpuThreads: 2,
    currentGpuIntensityPercent: 75,
    maxSteps: 4,
  });

  const step = findTuningSweepStepForRuntime(plan, {
    computeMode: "cpu",
    cpuThreads: 2,
    gpuIntensityPercent: 100,
  });

  assert.equal(step?.computeMode, "cpu");
  assert.equal(step?.cpuThreads, 2);
});

test("tuning runtime step matching uses GPU intensity for GPU profiles", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    currentComputeMode: "gpu",
    currentCpuThreads: 0,
    currentGpuIntensityPercent: 50,
    maxSteps: 4,
  });

  const step = findTuningSweepStepForRuntime(plan, {
    computeMode: "gpu",
    cpuThreads: 8,
    gpuIntensityPercent: 50,
  });

  assert.equal(step?.computeMode, "gpu");
  assert.equal(step?.gpuIntensityPercent, 50);
});

test("tuning runtime step matching requires supplied CPU threads for hybrid profiles", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 16,
    recommendedCpuThreads: 4,
    hardwareGpuAvailable: true,
    currentComputeMode: "hybrid",
    currentCpuThreads: 4,
    currentGpuIntensityPercent: 75,
    maxSteps: 6,
  });

  const hybridStep = plan.steps.find((step) => step.computeMode === "hybrid");
  assert.ok(hybridStep);

  const matched = findTuningSweepStepForRuntime(plan, {
    computeMode: "hybrid",
    cpuThreads: hybridStep.cpuThreads,
    gpuIntensityPercent: hybridStep.gpuIntensityPercent,
  });
  const mismatched = findTuningSweepStepForRuntime(plan, {
    computeMode: "hybrid",
    cpuThreads: hybridStep.cpuThreads + 1,
    gpuIntensityPercent: hybridStep.gpuIntensityPercent,
  });

  assert.equal(matched?.id, hybridStep.id);
  assert.equal(mismatched, null);
});
test("tuning analysis compares observed efficiency and hashrate", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });

  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 10_000_000, watts: 20 },
    { stepId: plan.steps[1].id, hashrate: 400_000_000, watts: 70 },
  ]);

  assert.equal(analysis.results.length, 2);
  assert.equal(analysis.bestHashrate?.step.id, plan.steps[1].id);
  assert.equal(analysis.bestHashrate?.effectiveHashrate, 400_000_000);
  assert.ok(analysis.bestEfficiency?.joulesPerTerahash);
});
test("tuning observation upsert replaces stale samples", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });

  const first = upsertTuningObservation([], {
    stepId: plan.steps[0].id,
    hashrate: 10_000_000,
    acceptedShares: 1,
    rejectedShares: 1,
  });
  const second = upsertTuningObservation(first, {
    stepId: plan.steps[0].id,
    hashrate: 20_000_000,
    acceptedShares: 4,
    rejectedShares: 0,
  });
  const analysis = analyzeTuningObservations(plan, second);

  assert.equal(second.length, 1);
  assert.equal(second[0].hashrate, 20_000_000);
  assert.equal(analysis.results[0].rejectedShareRatio, 0);
  assert.equal(analysis.results[0].stability, "stable");
});
test("tuning result selector exposes apply targets", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 10_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 5, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 500_000_000, watts: 80, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 5, rejectedShares: 0 },
  ]);

  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, plan.steps[1].id);
  assert.equal(selectTuningResult(analysis, "lowest_power")?.step.id, plan.steps[0].id);
  assert.ok(selectTuningResult(analysis, "best_efficiency")?.joulesPerTerahash);
});
test("tuning apply option waits for measured power on low-power routes", () => {
  const plan = createTuningSweepPlan({
    goal: "lowest_power",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 2,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 120_000_000, watts: 12, powerEvidenceStatus: "estimated", sampleSeconds: 900, acceptedShares: 5, rejectedShares: 0 },
  ]);
  const option = deriveTuningApplyOption(analysis, "lowest_power");

  assert.equal(option.canApply, false);
  assert.equal(option.status, "waiting");
  assert.match(option.summary, /measured watts/);
});

test("tuning apply option waits for share evidence before applying hash routes", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 2,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 500_000_000, watts: 45, powerEvidenceStatus: "measured", sampleSeconds: 900 },
  ]);
  const option = deriveTuningApplyOption(analysis, "best_hashrate");

  assert.equal(option.canApply, false);
  assert.equal(option.status, "waiting");
  assert.match(option.summary, /share evidence/);
});

test("tuning apply option blocks avoid-risk profiles", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 2,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 500_000_000, watts: 45, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, tempC: 96 },
  ]);
  const option = deriveTuningApplyOption(analysis, "best_hashrate");

  assert.equal(option.canApply, false);
  assert.equal(option.status, "blocked");
  assert.match(option.summary, /blocked/);
});

test("tuning apply option becomes ready with measured stable evidence", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 2,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 220_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, tempC: 55 },
  ]);
  const option = deriveTuningApplyOption(analysis, "best_efficiency");

  assert.equal(option.canApply, true);
  assert.equal(option.status, "ready");
  assert.match(option.summary, /can apply/);
});
test("tuning analysis separates lowest watts from lowest joules per terahash", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 80_000_000, watts: 8, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 400_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
  ]);

  assert.equal(analysis.lowestPower?.step.id, plan.steps[0].id);
  assert.equal(analysis.bestEfficiency?.step.id, plan.steps[1].id);
  assert.equal(selectTuningResult(analysis, "lowest_power")?.step.id, plan.steps[0].id);
  assert.equal(selectTuningResult(analysis, "best_efficiency")?.step.id, plan.steps[1].id);
  assert.match(analysis.summary, /Lowest power/);
});
test("power budget selector chooses highest quality hash under watts", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 8, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 220_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 500_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
  ]);

  assert.equal(selectPowerBudgetTuningResult(analysis, 15)?.step.id, plan.steps[1].id);
  assert.equal(selectPowerBudgetTuningResult(analysis, 9)?.step.id, plan.steps[0].id);
  assert.equal(selectPowerBudgetTuningResult(analysis, 7), null);
});

test("power budget selector avoids unsafe profiles when a stable option fits", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 200_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 8, rejectedShares: 0, tempC: 55 },
    { stepId: plan.steps[1].id, hashrate: 500_000_000, watts: 22, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 8, rejectedShares: 0, tempC: 95 },
  ]);

  assert.equal(analysis.results[1].longRunRisk, "avoid");
  assert.equal(selectPowerBudgetTuningResult(analysis, 25)?.step.id, plan.steps[0].id);
});

test("power budget curve maps each watt cap to the best safe hash profile", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 8, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 220_000_000, watts: 12, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 500_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
  ]);
  const curve = createPowerBudgetCurve(analysis, [8, 15, 30]);

  assert.deepEqual(curve.map((point) => point.maxWatts), [8, 15, 30]);
  assert.deepEqual(curve.map((point) => point.result.step.id), [plan.steps[0].id, plan.steps[1].id, plan.steps[2].id]);
  assert.equal(curve[1].headroomWatts, 3);
  assert.match(curve[1].summary, /Budget 15 W/);
});

test("power budget curve derives sorted watt caps from samples", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 220_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 500_000_000, watts: 30, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 6, rejectedShares: 0 },
  ]);
  const curve = createPowerBudgetCurve(analysis);

  assert.deepEqual(curve.map((point) => point.maxWatts), [10, 20, 30]);
  assert.equal(curve[0].watts, 10);
  assert.equal(curve[2].result.step.id, plan.steps[2].id);
});

test("tuning analysis ranks highest effective hashrate", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 300_000_000, watts: 45, acceptedShares: 1, rejectedShares: 1 },
    { stepId: plan.steps[1].id, hashrate: 260_000_000, watts: 55, acceptedShares: 10, rejectedShares: 0 },
  ]);

  assert.equal(analysis.results[0].effectiveHashrate, 150_000_000);
  assert.equal(analysis.results[0].stability, "unstable");
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, plan.steps[1].id);
});
test("tuning analysis penalizes stale share drops as wasted hash", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 300_000_000, watts: 45, acceptedShares: 10, rejectedShares: 0, staleSharesDropped: 0 },
    { stepId: plan.steps[1].id, hashrate: 300_000_000, watts: 45, acceptedShares: 10, rejectedShares: 0, staleSharesDropped: 10 },
  ]);
  const stable = analysis.results[0];
  const stale = analysis.results[1];

  assert.equal(stale.staleSharesDropped, 10);
  assert.equal(stale.rejectedShareRatio, 0);
  assert.equal(stale.staleShareRatio, 0.5);
  assert.equal(stale.shareWasteRatio, 0.5);
  assert.equal(stale.effectiveHashrate, 150_000_000);
  assert.equal(stale.stability, "unstable");
  assert.equal(stale.longRunRisk, "avoid");
  assert.ok(stale.longRunScore < stable.longRunScore);
  assert.ok(stale.qualityScore < stable.qualityScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, stable.step.id);
});
test("tuning analysis penalizes queued share drops as wasted hash", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 300_000_000, watts: 45, acceptedShares: 10, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
    { stepId: plan.steps[1].id, hashrate: 300_000_000, watts: 45, acceptedShares: 10, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 10 },
  ]);
  const stable = analysis.results[0];
  const queued = analysis.results[1];

  assert.equal(queued.queuedSharesDropped, 10);
  assert.equal(queued.staleSharesDropped, 0);
  assert.equal(queued.shareWasteRatio, 0.5);
  assert.equal(queued.effectiveHashrate, 150_000_000);
  assert.equal(queued.stability, "unstable");
  assert.equal(queued.longRunRisk, "avoid");
  assert.ok(queued.longRunScore < stable.longRunScore);
  assert.ok(queued.qualityScore < stable.qualityScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, stable.step.id);
});

test("tuning analysis treats zero-share samples as unproven for long-run use", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 300_000_000, watts: 45, sampleSeconds: 240 },
    { stepId: plan.steps[1].id, hashrate: 300_000_000, watts: 45, sampleSeconds: 240, acceptedShares: 4, rejectedShares: 0, staleSharesDropped: 0 },
  ]);
  const noShareEvidence = analysis.results[0];
  const proven = analysis.results[1];

  assert.equal(noShareEvidence.shareEvidenceStatus, "none");
  assert.equal(noShareEvidence.shareEvidenceWeight, 0.7);
  assert.equal(noShareEvidence.longRunRisk, "watch");
  assert.match(noShareEvidence.longRunSummary, /none share evidence/);
  assert.equal(proven.shareEvidenceStatus, "proven");
  assert.ok(proven.longRunScore > noShareEvidence.longRunScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, proven.step.id);
});

test("tuning analysis caps estimated-power samples below measured-power confidence", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 300_000_000, watts: 45, powerEvidenceStatus: "estimated", sampleSeconds: 240, acceptedShares: 4, rejectedShares: 0, staleSharesDropped: 0 },
    { stepId: plan.steps[1].id, hashrate: 300_000_000, watts: 45, powerEvidenceStatus: "measured", sampleSeconds: 240, acceptedShares: 4, rejectedShares: 0, staleSharesDropped: 0 },
  ]);
  const estimatedPower = analysis.results[0];
  const measuredPower = analysis.results[1];

  assert.equal(estimatedPower.powerEvidenceStatus, "estimated");
  assert.equal(estimatedPower.powerEvidenceWeight, 0.9);
  assert.equal(estimatedPower.longRunRisk, "good");
  assert.match(estimatedPower.longRunSummary, /power estimated/);
  assert.equal(measuredPower.powerEvidenceStatus, "measured");
  assert.ok(measuredPower.qualityScore > estimatedPower.qualityScore);
  assert.ok(measuredPower.longRunScore > estimatedPower.longRunScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, measuredPower.step.id);
});
test("tuning analysis exposes a Pareto frontier for power and hash tradeoffs", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 10, acceptedShares: 5, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 200_000_000, watts: 30, acceptedShares: 5, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 90_000_000, watts: 40, acceptedShares: 5, rejectedShares: 0 },
  ]);

  assert.deepEqual(
    analysis.paretoFrontier.map((result) => result.step.id),
    [plan.steps[0].id, plan.steps[1].id],
  );
  assert.equal(analysis.paretoFrontier.some((result) => result.step.id === plan.steps[2].id), false);
  assert.ok(analysis.paretoSummary.includes("2 viable profiles"));
  assert.ok(analysis.results.every((result) => result.qualityAdjustedHashrate > 0));
});
test("stability window favors long stable samples over short bursts", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 250_000_000, watts: 30, tempC: 55, sampleSeconds: 240, acceptedShares: 12, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 400_000_000, watts: 45, tempC: 56, sampleSeconds: 30, acceptedShares: 2, rejectedShares: 0 },
  ]);

  assert.equal(analysis.results[0].stabilityWindowStatus, "stable");
  assert.equal(analysis.results[1].stabilityWindowStatus, "probing");
  assert.equal(analysis.results[1].longRunRisk, "watch");
  assert.ok(analysis.results[0].longRunScore > analysis.results[1].longRunScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, plan.steps[0].id);
  assert.equal(analysis.paretoRecommendation?.step.id, plan.steps[0].id);
});
test("thermal guard prevents a hot high-hash sample from dominating", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 250_000_000, watts: 30, tempC: 55, acceptedShares: 10, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 500_000_000, watts: 55, tempC: 92, acceptedShares: 10, rejectedShares: 0 },
  ]);

  assert.equal(analysis.results[0].thermalStatus, "cool");
  assert.equal(analysis.results[1].thermalStatus, "critical");
  assert.equal(analysis.results[1].longRunRisk, "avoid");
  assert.ok(analysis.results[1].longRunScore < analysis.results[0].longRunScore);
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, plan.steps[0].id);
  assert.equal(analysis.paretoRecommendation?.step.id, plan.steps[0].id);
});
test("balanced Pareto recommendation chooses the measured knee profile", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 10, acceptedShares: 5, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 180_000_000, watts: 25, acceptedShares: 5, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 300_000_000, watts: 90, acceptedShares: 5, rejectedShares: 0 },
  ]);

  assert.equal(analysis.paretoFrontier.length, 3);
  assert.equal(analysis.paretoRecommendation?.step.id, plan.steps[1].id);
  assert.equal(selectParetoTuningResult(analysis, "balanced")?.step.id, plan.steps[1].id);
  assert.ok(analysis.paretoRecommendationSummary.includes("balanced pick"));
});
test("power-density frontier knee stops when marginal watts stop paying for hash", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const analysis = analyzeTuningObservations(plan, [
    { stepId: plan.steps[0].id, hashrate: 100_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[1].id, hashrate: 195_000_000, watts: 20, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0 },
    { stepId: plan.steps[2].id, hashrate: 240_000_000, watts: 50, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0 },
  ]);

  assert.equal(analysis.marginalFrontier.length, 3);
  assert.equal(analysis.marginalFrontier[0].acceptedByDensityKnee, true);
  assert.equal(analysis.marginalFrontier[1].acceptedByDensityKnee, true);
  assert.equal(analysis.marginalFrontier[2].acceptedByDensityKnee, false);
  assert.equal(analysis.powerDensityKnee?.step.id, plan.steps[1].id);
  assert.match(analysis.powerDensityKneeSummary, /frontier knee keeps/i);
  assert.match(analysis.marginalFrontier[2].summary, /stops before/i);
});
test("tuning analysis treats low-power gpu duty as intentional", () => {
  const plan = createTuningSweepPlan({
    goal: "lowest_power",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 5,
  });
  const lowPowerStep = plan.steps.find((step) => step.computeMode === "gpu" && step.gpuIntensityPercent <= 25);
  assert.ok(lowPowerStep);

  const analysis = analyzeTuningObservations(plan, [
    {
      stepId: lowPowerStep.id,
      hashrate: 120_000_000,
      watts: 8,
      powerEvidenceStatus: "measured",
      sampleSeconds: 240,
      acceptedShares: 8,
      rejectedShares: 0,
      gpuDispatchMs: 100,
      gpuThrottleMs: 300,
    },
  ]);
  const result = analysis.results[0];

  assert.equal(result.runtimeDutyStatus, "intentional_low_power");
  assert.equal(result.gpuDutyCycle, 0.25);
  assert.ok(result.runtimeDutyWeight > 0.95);
  assert.notEqual(result.longRunRisk, "avoid");
  assert.match(result.longRunSummary, /low-power profile/);
});

test("tuning analysis discounts throttle-limited throughput profiles", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 6,
  });
  const throughputStep = plan.steps.find((step) => step.computeMode !== "cpu" && step.priority === "throughput");
  const stableStep = plan.steps.find((step) => step.id !== throughputStep?.id && step.computeMode !== "cpu");
  assert.ok(throughputStep);
  assert.ok(stableStep);

  const analysis = analyzeTuningObservations(plan, [
    {
      stepId: stableStep.id,
      hashrate: 340_000_000,
      watts: 30,
      powerEvidenceStatus: "measured",
      sampleSeconds: 240,
      acceptedShares: 8,
      rejectedShares: 0,
      gpuDispatchMs: 400,
      gpuThrottleMs: 0,
    },
    {
      stepId: throughputStep.id,
      hashrate: 450_000_000,
      watts: 30,
      powerEvidenceStatus: "measured",
      sampleSeconds: 240,
      acceptedShares: 8,
      rejectedShares: 0,
      gpuDispatchMs: 100,
      gpuThrottleMs: 300,
    },
  ]);
  const throttled = analysis.results.find((result) => result.step.id === throughputStep.id);
  assert.ok(throttled);

  assert.equal(throttled.runtimeDutyStatus, "throttled");
  assert.equal(throttled.gpuThrottleRatio, 0.75);
  assert.ok(throttled.runtimeDutyWeight < 0.8);
  assert.equal(throttled.longRunRisk, "watch");
  assert.equal(selectTuningResult(analysis, "best_hashrate")?.step.id, stableStep.id);
});

test("tuning share counters use deltas", () => {
  assert.deepEqual(
    diffTuningShareCounters(
      { acceptedShares: 12, rejectedShares: 4, staleSharesDropped: 5, queuedSharesDropped: 7 },
      { acceptedShares: 10, rejectedShares: 1, staleSharesDropped: 2, queuedSharesDropped: 3 },
    ),
    { acceptedShares: 2, rejectedShares: 3, staleSharesDropped: 3, queuedSharesDropped: 4 },
  );
  assert.deepEqual(
    diffTuningShareCounters(
      { acceptedShares: 1, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
      { acceptedShares: 10, rejectedShares: 1, staleSharesDropped: 4, queuedSharesDropped: 4 },
    ),
    { acceptedShares: 0, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
  );
});
test("tuning apply option blocks higher-load profiles while live runtime evidence is watch", () => {
  const plan = createTuningSweepPlan({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const currentStep = plan.steps[0];
  const targetStep = plan.steps[2];
  const analysis = analyzeTuningObservations(plan, [
    { stepId: targetStep.id, hashrate: 520_000_000, watts: 44, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, tempC: 55 },
  ]);
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 220_000_000,
    acceptedShares: 9,
    rejectedShares: 1,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const option = deriveTuningApplyOption(analysis, "best_hashrate", { runtimeEfficiency, currentStep });

  assert.equal(option.runtimeGuard, "observe");
  assert.equal(option.runtimeEfficiencyStatus, "watch");
  assert.equal(option.canApply, false);
  assert.equal(option.status, "blocked");
  assert.match(option.summary, /runtime evidence/i);
});

test("tuning apply option allows lower-load recovery while live runtime evidence is blocked", () => {
  const plan = createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
  });
  const lowStep = plan.steps[0];
  const highStep = plan.steps[2];
  const analysis = analyzeTuningObservations(plan, [
    { stepId: lowStep.id, hashrate: 120_000_000, watts: 10, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, tempC: 54 },
    { stepId: highStep.id, hashrate: 520_000_000, watts: 44, powerEvidenceStatus: "measured", sampleSeconds: 900, acceptedShares: 6, rejectedShares: 0, tempC: 55 },
  ]);
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 220_000_000,
    acceptedShares: 6,
    rejectedShares: 1,
    staleSharesDropped: 2,
    queuedSharesDropped: 1,
  });
  const option = deriveTuningApplyOption(analysis, "lowest_power", { runtimeEfficiency, currentStep: highStep });

  assert.equal(option.runtimeGuard, "block");
  assert.equal(option.runtimeEfficiencyStatus, "wasteful");
  assert.equal(option.canApply, true);
  assert.equal(option.status, "ready");
  assert.equal(option.result?.step.id, lowStep.id);
});

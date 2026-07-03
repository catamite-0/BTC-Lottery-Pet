import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateEfficiencySnapshot,
  createEfficiencyCandidates,
  efficiencyGoalLabel,
  formatJoulesPerTerahash,
  recommendEfficiencyProfile,
} from "../.test-dist/domain/efficiencyEngine.js";

test("efficiency engine classifies PC and ASIC power profiles", () => {
  const pc = calculateEfficiencySnapshot({
    mode: "gpu",
    hashrate: 5_000_000,
    watts: 45,
  });
  assert.equal(Math.round(pc.hashesPerJoule), 111_111);
  assert.equal(pc.efficiencyLabel, "pc-class");

  const homeAsic = calculateEfficiencySnapshot({
    mode: "asic",
    hashrate: 4_000_000_000_000,
    watts: 140,
  });
  assert.equal(Math.round(homeAsic.joulesPerTerahash), 35);
  assert.equal(homeAsic.efficiencyLabel, "home-asic");

  const industrialAsic = calculateEfficiencySnapshot({
    mode: "asic",
    hashrate: 1_200_000_000_000,
    watts: 18,
  });
  assert.equal(Math.round(industrialAsic.joulesPerTerahash), 15);
  assert.equal(industrialAsic.efficiencyLabel, "industrial-asic");
});

test("efficiency engine keeps unknown power separate from zero work", () => {
  assert.equal(
    calculateEfficiencySnapshot({ mode: "cpu", hashrate: 0, watts: null }).efficiencyLabel,
    "waiting",
  );
  assert.equal(
    calculateEfficiencySnapshot({ mode: "gpu", hashrate: 5_000_000, watts: null }).efficiencyLabel,
    "unknown-power",
  );
});

test("efficiency scheduler falls back to best CPU efficiency when no hardware GPU exists", () => {
  const candidates = createEfficiencyCandidates({
    goal: "max_efficiency",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: false,
  });
  assert.equal(candidates.every((candidate) => candidate.computeMode === "cpu"), true);

  const recommendation = recommendEfficiencyProfile({
    goal: "max_efficiency",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: false,
  });
  assert.equal(recommendation.computeMode, "cpu");
  assert.equal(recommendation.performancePreset, "normal");
  assert.equal(recommendation.cpuThreads, 2);
  assert.equal(recommendation.gpuIntensityPercent, 0);
});

test("efficiency scheduler prefers GPU sweet spot for hashes per joule", () => {
  const recommendation = recommendEfficiencyProfile({
    goal: "max_efficiency",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    gpuHashrateAt100Percent: 1_000_000_000,
  });

  assert.equal(recommendation.computeMode, "gpu");
  assert.equal(recommendation.cpuThreads, 0);
  assert.equal(recommendation.gpuIntensityPercent, 75);
  assert.equal(recommendation.confidence, "estimated");
});

test("efficiency scheduler can target the lowest watt profile", () => {
  const recommendation = recommendEfficiencyProfile({
    goal: "lowest_power",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    gpuHashrateAt100Percent: 1_000_000_000,
  });

  assert.equal(recommendation.computeMode, "cpu");
  assert.equal(recommendation.cpuThreads, 1);
  assert.equal(recommendation.gpuIntensityPercent, 0);
  assert.equal(efficiencyGoalLabel("lowest_power"), "Lowest Power");
  assert.match(recommendation.reasons.join(" "), /lowest estimated watt draw/i);
});


test("efficiency scheduler uses benchmark data and can choose absolute hashrate", () => {
  const recommendation = recommendEfficiencyProfile({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    benchmarkHashrate: 250_000_000,
    benchmarkGpuIntensityPercent: 25,
  });

  assert.equal(recommendation.computeMode, "hybrid");
  assert.equal(recommendation.gpuIntensityPercent, 100);
  assert.equal(recommendation.cpuThreads, 8);
  assert.equal(recommendation.confidence, "benchmark");
  assert.ok(recommendation.estimatedHashrate > 1_000_000_000);
});

test("efficiency formatting keeps dashboard values compact", () => {
  assert.equal(formatJoulesPerTerahash(null), "Waiting");
  assert.equal(formatJoulesPerTerahash(35.25), "35.3 J/TH");
  assert.equal(formatJoulesPerTerahash(1250), "1.3 kJ/TH");
});
test("efficiency scheduler learns from live GPU hashrate", () => {
  const recommendation = recommendEfficiencyProfile({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    observedHashrate: 500_000_000,
    observedComputeMode: "gpu",
    observedGpuIntensityPercent: 50,
  });

  assert.equal(recommendation.confidence, "observed-hashrate");
  assert.equal(recommendation.computeMode, "gpu");
  assert.ok(recommendation.estimatedHashrate >= 750_000_000);
});

test("efficiency scheduler separates hybrid runtime samples", () => {
  const candidates = createEfficiencyCandidates({
    goal: "max_hashrate",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    observedHashrate: 900_000_000,
    observedComputeMode: "hybrid",
    observedCpuThreads: 2,
    observedGpuIntensityPercent: 50,
  });

  const gpuCandidate = candidates.find((candidate) => candidate.id === "gpu:0:75");
  assert.ok(gpuCandidate);
  assert.ok(gpuCandidate.estimatedHashrate > 1_000_000_000);
});

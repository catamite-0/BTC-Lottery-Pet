import test from "node:test";
import assert from "node:assert/strict";

import {
  hashRouteStrategyLabel,
  planHashRouteManualAction,
  planHashRouteManualActions,
  recommendHashRoute,
  recommendHashRouteForGoal,
  recommendHashRouteStrategies,
  scoreHashRouteRecommendation,
  summarizeHashRouteDecision,
} from "../.test-dist/domain/hashRouteAdvisor.js";

function localResult(overrides = {}) {
  const { step: stepOverrides = {}, ...resultOverrides } = overrides;

  return {
    step: {
      id: "local-balanced",
      order: 1,
      priority: "balanced",
      computeMode: "gpu",
      performancePreset: "custom",
      cpuThreads: 1,
      gpuIntensityPercent: 40,
      sampleSeconds: 60,
      estimatedHashrate: 10_000_000,
      estimatedWatts: 40,
      joulesPerTerahash: 4_000_000,
      summary: "GPU 40%",
      reason: "measured profile",
      ...stepOverrides,
    },
    hashrate: 10_000_000,
    effectiveHashrate: 10_000_000,
    watts: 40,
    joulesPerTerahash: 4_000_000,
    effectiveJoulesPerTerahash: 4_000_000,
    acceptedShares: 2,
    rejectedShares: 0,
    staleSharesDropped: 0,
    rejectedShareRatio: 0,
    staleShareRatio: 0,
    shareWasteRatio: 0,
    shareEvidenceStatus: "proven",
    shareEvidenceWeight: 1,
    shareEvidenceSummary: "Share evidence: 3 share events observed.",
    powerEvidenceStatus: "measured",
    powerEvidenceWeight: 1,
    powerEvidenceSummary: "Power evidence: measured watts are available.",
    sampleSeconds: 60,
    stability: "stable",
    thermalStatus: "cool",
    thermalWeight: 1,
    thermalSummary: "cool",
    maxObservedTempC: 60,
    stabilityWindowStatus: "stable",
    stabilityWindowWeight: 1,
    stabilityWindowSummary: "stable",
    stabilityWindowProgress: 1,
    qualityScore: 1,
    qualityAdjustedHashrate: 10_000_000,
    qualityAdjustedJoulesPerTerahash: 4_000_000,
    longRunScore: 100,
    longRunRisk: "excellent",
    longRunSummary: "Long-run score 100/100 (excellent).",
    ...resultOverrides,
  };
}

function analysis(result = localResult()) {
  return {
    results: result ? [result] : [],
    lowestPower: result,
    bestEfficiency: result,
    bestHashrate: result,
    paretoFrontier: result ? [result] : [],
    paretoRecommendation: result,
    paretoRecommendationSummary: result ? "measured" : "waiting",
    paretoSummary: result ? "frontier" : "waiting",
    summary: result ? "measured" : "waiting",
  };
}

function strategyAnalysis({ lowestPower = null, bestEfficiency, bestHashrate, paretoRecommendation = null }) {
  const results = [lowestPower, bestEfficiency, bestHashrate, paretoRecommendation].filter(Boolean);
  const uniqueResults = results.filter((result, index) => (
    results.findIndex((candidate) => candidate.step.id === result.step.id) === index
  ));

  return {
    results: uniqueResults,
    lowestPower,
    bestEfficiency,
    bestHashrate,
    paretoFrontier: uniqueResults,
    paretoRecommendation: paretoRecommendation ?? bestEfficiency ?? bestHashrate ?? null,
    paretoRecommendationSummary: uniqueResults.length > 0 ? "measured" : "waiting",
    paretoSummary: uniqueResults.length > 0 ? "frontier" : "waiting",
    summary: uniqueResults.length > 0 ? "measured" : "waiting",
  };
}

function externalSummary(overrides = {}) {
  const efficiencySampleCount = overrides.efficiencySampleCount ?? 6;
  const usableEfficiencySampleCount = overrides.usableEfficiencySampleCount ?? efficiencySampleCount;
  const evidenceGap = overrides.evidenceGap ?? Math.max(0, 3 - usableEfficiencySampleCount);
  const evidenceStatus = overrides.evidenceStatus ?? (
    usableEfficiencySampleCount >= 6 ? "stable" : usableEfficiencySampleCount >= 3 ? "ready" : usableEfficiencySampleCount > 0 ? "probing" : "waiting"
  );

  return {
    sampleCount: overrides.sampleCount ?? 6,
    onlineSampleCount: overrides.onlineSampleCount ?? 6,
    efficiencySampleCount,
    usableEfficiencySampleCount,
    evidenceStatus,
    evidenceReady: overrides.evidenceReady ?? usableEfficiencySampleCount >= 3,
    evidenceSampleTarget: overrides.evidenceSampleTarget ?? 3,
    evidenceGap,
    latestSample: null,
    bestEfficiencySample: null,
    averageHashrate: 1_000_000_000_000,
    averageWatts: 15,
    averageJoulesPerTerahash: 15,
    bestJoulesPerTerahash: 14,
    trend: "stable",
    trendPercent: 1,
    summary: `${overrides.onlineSampleCount ?? 6}/${overrides.sampleCount ?? 6} online samples; stable by 1.0%; ${evidenceStatus}.`,
    ...overrides,
  };
}

test("hash route advisor waits when both routes lack samples", () => {
  const recommendation = recommendHashRoute(analysis(null), externalSummary({
    sampleCount: 0,
    onlineSampleCount: 0,
    efficiencySampleCount: 0,
    averageHashrate: 0,
    averageJoulesPerTerahash: null,
    bestJoulesPerTerahash: null,
  }));

  assert.equal(recommendation.goal, "balanced");
  assert.equal(recommendation.target, "waiting");
  assert.equal(recommendation.reason, "need_samples");
});

test("hash route advisor labels strategy goals", () => {
  assert.equal(hashRouteStrategyLabel("lowest_power"), "Lowest Power");
  assert.equal(hashRouteStrategyLabel("max_efficiency"), "Max Efficiency");
  assert.equal(hashRouteStrategyLabel("balanced"), "Balanced");
  assert.equal(hashRouteStrategyLabel("max_hashrate"), "Max Hashrate");
});

test("hash route advisor keeps reference-only external telemetry out of route selection", () => {
  const recommendation = recommendHashRouteForGoal(analysis(localResult({
    qualityAdjustedHashrate: 200_000_000_000,
    qualityAdjustedJoulesPerTerahash: 30,
  })), externalSummary({
    averageHashrate: 5_000_000_000_000,
    averageWatts: 30,
    averageJoulesPerTerahash: 6,
  }), "max_hashrate", {
    externalMode: "reference_only",
    effectiveHashrate: 5_000_000_000_000,
    searchSpaceReady: true,
    workAdapterReady: true,
    workAdapterStatus: "assignable",
  });

  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "external_reference_only");
  assert.match(recommendation.summary, /reference-only/i);
  assert.equal(recommendation.externalHashrate, 5_000_000_000_000);
});

test("hash route advisor seals external telemetry out of local-only routing", () => {
  const recommendation = recommendHashRouteForGoal(analysis(localResult({
    qualityAdjustedHashrate: 200_000_000_000,
    qualityAdjustedJoulesPerTerahash: 30,
  })), externalSummary({
    averageHashrate: 5_000_000_000_000,
    averageWatts: 30,
    averageJoulesPerTerahash: 6,
  }), "max_hashrate", {
    externalMode: "local_only",
    effectiveHashrate: 5_000_000_000_000,
    searchSpaceReady: true,
    workAdapterReady: true,
    workAdapterStatus: "assignable",
  });

  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "external_sealed");
  assert.match(recommendation.summary, /sealed off/i);
});
test("hash route advisor prefers external when efficiency is far better", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    effectiveHashrate: 500_000_000_000,
  });

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "external_efficiency");
  assert.equal(recommendation.externalHashrateBasis, "effective");
  assert.ok(recommendation.efficiencyRatio && recommendation.efficiencyRatio > 100_000);
});

test("hash route advisor samples external until external evidence is usable", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    sampleCount: 1,
    onlineSampleCount: 1,
    efficiencySampleCount: 1,
    usableEfficiencySampleCount: 1,
    evidenceStatus: "probing",
    evidenceReady: false,
    evidenceGap: 2,
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }));
  const action = planHashRouteManualAction(recommendation);

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "need_external_stability");
  assert.equal(recommendation.externalEvidenceReady, false);
  assert.equal(recommendation.externalEvidenceGap, 2);
  assert.match(recommendation.detail, /2 more usable efficiency samples/i);
  assert.equal(action.kind, "test_external_telemetry");
  assert.equal(action.enabledByRecommendation, true);
  assert.match(action.label, /sample external/i);
});


test("hash route advisor keeps unusable external samples from raising confidence", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    sampleCount: 3,
    onlineSampleCount: 3,
    efficiencySampleCount: 3,
    usableEfficiencySampleCount: 0,
    evidenceStatus: "waiting",
    evidenceReady: false,
    evidenceGap: 3,
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
    summary: "3/3 online samples; waiting for usable thermal evidence.",
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "need_external_stability");
  assert.equal(recommendation.externalEvidenceReady, false);
  assert.equal(recommendation.externalEvidenceGap, 3);
  assert.equal(recommendation.confidence, "waiting");
  assert.match(recommendation.detail, /3 more usable efficiency samples/i);
});

test("hash route advisor monitors external winners until search space is ready", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    searchSpaceReady: false,
    searchSpaceSummary: "Search space version rolling needed: 32 bits gives 8.6 ms at current hashrate.",
  });

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_search_space");
  assert.equal(recommendation.externalSearchSpaceReady, false);
  assert.match(recommendation.detail, /version rolling needed/i);
});

test("hash route advisor keeps telemetry-only network adapters out of external routing", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    searchSpaceReady: true,
    workAdapterReady: false,
    workAdapterStatus: "telemetry-only",
    workAdapterSummary: "External adapter is telemetry-only; hash work stays local.",
  });
  const action = planHashRouteManualAction(recommendation);

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
  assert.equal(recommendation.externalWorkAdapterReady, false);
  assert.equal(recommendation.externalWorkAdapterStatus, "telemetry-only");
  assert.match(recommendation.detail, /telemetry-only/i);
  assert.match(recommendation.detail, /cannot receive jobs/i);
  assert.equal(action.kind, "monitor_route");
  assert.equal(action.enabledByRecommendation, false);
  assert.match(action.label, /adapter/i);
});

test("hash route advisor keeps direct adapters reserved until the hardware protocol is chosen", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    searchSpaceReady: true,
    workAdapterStatus: "reserved",
    workAdapterSummary: "Direct interface reserved at COM7.",
  });

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
  assert.equal(recommendation.externalWorkAdapterReady, false);
  assert.equal(recommendation.externalWorkAdapterStatus, "reserved");
  assert.match(recommendation.detail, /Direct external hash is reserved/i);
  assert.match(recommendation.detail, /COM7/);
});

test("hash route advisor blocks engine-capable adapters when work leases are not proven", () => {
  const recommendation = recommendHashRouteForGoal(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 18,
  }), "max_hashrate", {
    searchSpaceReady: true,
    workAdapterStatus: "blocked",
    workAdapterSummary: "Prove workPartitioning so workers do not overlap.",
  });

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
  assert.equal(recommendation.externalWorkAdapterStatus, "blocked");
  assert.match(recommendation.detail, /capabilities are incomplete/i);
  assert.match(recommendation.detail, /workPartitioning/i);
});

test("hash route advisor allows assignable adapters only as dry-run verification", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    searchSpaceReady: true,
    effectiveHashrate: 500_000_000_000,
    workAdapterReady: true,
    workAdapterStatus: "assignable",
    workAdapterSummary: "Mock leases passed for the current network endpoint.",
  });
  const action = planHashRouteManualAction(recommendation);

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "external_efficiency");
  assert.equal(recommendation.externalWorkAdapterReady, true);
  assert.equal(recommendation.externalWorkAdapterStatus, "assignable");
  assert.equal(action.kind, "test_external_telemetry");
  assert.match(action.detail, /mock lease evidence/i);
  assert.match(action.safetyNote, /Dry-run lease verification/i);
});

test("hash route advisor keeps local when local efficiency wins", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 2_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  })), externalSummary({
    averageWatts: 80,
    averageHashrate: 1_000_000_000,
    averageJoulesPerTerahash: 20,
  }));

  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "local_efficiency");
});

test("hash route advisor does not treat estimated local watts as measured efficiency", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 2_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
    powerEvidenceStatus: "estimated",
    powerEvidenceWeight: 0.9,
    powerEvidenceSummary: "Power evidence: estimated watts.",
    longRunRisk: "good",
  })), externalSummary({
    averageWatts: 80,
    averageHashrate: 1_000_000_000,
    averageJoulesPerTerahash: 20,
  }));
  const action = planHashRouteManualAction(recommendation);

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "need_local_samples");
  assert.equal(recommendation.localJoulesPerTerahash, null);
  assert.equal(recommendation.confidence, "low");
  assert.match(recommendation.detail, /comparable efficiency data/i);
  assert.equal(action.kind, "capture_local_sample");
  assert.equal(action.requiresExternalTelemetry, false);
  assert.match(action.detail, /comparable power, share, and hashrate evidence/i);
});

test("hash route advisor prefers external throughput when efficiency is close", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 21,
  }), {
    effectiveHashrate: 500_000_000_000,
  });

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "external_throughput");
  assert.equal(recommendation.externalHashrateBasis, "effective");
});

test("hash route advisor keeps raw external throughput in monitor mode", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 21,
  }));

  assert.equal(recommendation.externalHashrateBasis, "raw_average");
  assert.equal(recommendation.externalRawHashrate, 500_000_000_000);
  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
  assert.match(recommendation.detail, /observation-only/i);
  assert.match(recommendation.detail, /effective work-assigned hashrate|lease-adjusted throughput/i);
});

test("hash route advisor leans external when local share waste is high", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 90_000_000_000,
    qualityAdjustedJoulesPerTerahash: 24,
    staleSharesDropped: 12,
    staleShareRatio: 0.3,
    shareWasteRatio: 0.3,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 25,
    trend: "stable",
  }), {
    effectiveHashrate: 120_000_000_000,
  });

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "local_share_waste");
  assert.equal(recommendation.externalHashrateBasis, "effective");
  assert.equal(recommendation.localShareWasteRatio, 0.3);
  assert.equal(recommendation.confidence, "low");
  assert.match(recommendation.detail, /30%/);
});

test("hash route advisor lowers confidence when external efficiency degrades", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    sampleCount: 6,
    onlineSampleCount: 6,
    efficiencySampleCount: 6,
    usableEfficiencySampleCount: 6,
    evidenceStatus: "stable",
    evidenceReady: true,
    evidenceGap: 0,
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
    trend: "degrading",
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "need_external_stability");
  assert.equal(recommendation.externalEvidenceReady, false);
  assert.equal(recommendation.confidence, "low");
  assert.match(recommendation.detail, /degrading/i);
});

test("hash route advisor monitors high local waste when external trend degrades", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 90_000_000_000,
    qualityAdjustedJoulesPerTerahash: 24,
    staleSharesDropped: 12,
    staleShareRatio: 0.3,
    shareWasteRatio: 0.3,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 25,
    trend: "degrading",
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "local_share_waste");
  assert.match(recommendation.detail, /external efficiency is degrading/i);
});

test("hash route advisor avoids local profiles marked avoid for long-run use", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 90_000_000_000,
    qualityAdjustedJoulesPerTerahash: 24,
    longRunScore: 31,
    longRunRisk: "avoid",
    longRunSummary: "Long-run score 31/100 (avoid).",
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 25,
    trend: "stable",
  }), {
    effectiveHashrate: 120_000_000_000,
  });

  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "local_long_run_risk");
  assert.equal(recommendation.externalHashrateBasis, "effective");
  assert.equal(recommendation.localLongRunScore, 31);
  assert.equal(recommendation.localLongRunRisk, "avoid");
  assert.equal(recommendation.confidence, "low");
  assert.match(recommendation.detail, /31\/100/);
});

test("hash route advisor lowers confidence for watch long-run local profiles", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
    longRunScore: 62,
    longRunRisk: "watch",
    longRunSummary: "Long-run score 62/100 (watch).",
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
    trend: "stable",
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "similar_efficiency");
  assert.equal(recommendation.localLongRunRisk, "watch");
  assert.equal(recommendation.confidence, "low");
});

test("hash route advisor monitors avoid local profiles while external telemetry is missing", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
    longRunScore: 31,
    longRunRisk: "avoid",
    longRunSummary: "Long-run score 31/100 (avoid).",
  })), externalSummary({
    sampleCount: 0,
    onlineSampleCount: 0,
    efficiencySampleCount: 0,
    averageHashrate: 0,
    averageJoulesPerTerahash: null,
    bestJoulesPerTerahash: null,
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "local_long_run_risk");
  assert.equal(recommendation.localLongRunRisk, "avoid");
  assert.match(recommendation.detail, /external telemetry needs hashrate/i);
});

test("hash route advisor monitors when neither route clearly wins", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
  }));

  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "similar_efficiency");
});

test("max efficiency route uses the most efficient local profile before chasing speed", () => {
  const efficientLocal = localResult({
    step: { id: "local-efficient", summary: "GPU 25%" },
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  });
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 12,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    bestEfficiency: efficientLocal,
    bestHashrate: fastLocal,
    paretoRecommendation: fastLocal,
  }), externalSummary({
    averageHashrate: 600_000_000_000,
    averageJoulesPerTerahash: 12,
  }), "max_efficiency");

  assert.equal(recommendation.goal, "max_efficiency");
  assert.equal(recommendation.localProfile?.step.id, "local-efficient");
  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "local_efficiency");
});

test("max hashrate route allows a larger efficiency guard for faster external hash", () => {
  const efficientLocal = localResult({
    step: { id: "local-efficient", summary: "GPU 25%" },
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  });
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 12,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    bestEfficiency: efficientLocal,
    bestHashrate: fastLocal,
    paretoRecommendation: efficientLocal,
  }), externalSummary({
    averageHashrate: 900_000_000_000,
    averageJoulesPerTerahash: 14,
  }), "max_hashrate", {
    effectiveHashrate: 900_000_000_000,
  });

  assert.equal(recommendation.goal, "max_hashrate");
  assert.equal(recommendation.localProfile?.step.id, "local-fast");
  assert.equal(recommendation.externalHashrateBasis, "effective");
  assert.equal(recommendation.target, "external");
  assert.equal(recommendation.reason, "external_throughput");
});
test("max hashrate route waits on raw external telemetry without assigned-work throughput", () => {
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 12,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    bestEfficiency: fastLocal,
    bestHashrate: fastLocal,
    paretoRecommendation: fastLocal,
  }), externalSummary({
    averageHashrate: 900_000_000_000,
    averageJoulesPerTerahash: 14,
  }), "max_hashrate");

  assert.equal(recommendation.goal, "max_hashrate");
  assert.equal(recommendation.externalHashrateBasis, "raw_average");
  assert.equal(recommendation.externalRawHashrate, 900_000_000_000);
  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
  assert.match(recommendation.detail, /effective work-assigned hashrate|lease-adjusted throughput/i);
});

test("max hashrate route treats null work-lease utilization as raw telemetry", () => {
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 12,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    bestEfficiency: fastLocal,
    bestHashrate: fastLocal,
    paretoRecommendation: fastLocal,
  }), externalSummary({
    averageHashrate: 900_000_000_000,
    averageJoulesPerTerahash: 14,
  }), "max_hashrate", {
    workLeaseUtilizationRatio: null,
  });

  assert.equal(recommendation.externalHashrateBasis, "raw_average");
  assert.equal(recommendation.externalWorkLeaseUtilizationRatio, null);
  assert.equal(recommendation.target, "monitor");
  assert.equal(recommendation.reason, "external_work_adapter");
});
test("max hashrate route discounts external throughput by work-lease utilization", () => {
  const efficientLocal = localResult({
    step: { id: "local-efficient", summary: "GPU 25%" },
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  });
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 12,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    bestEfficiency: efficientLocal,
    bestHashrate: fastLocal,
    paretoRecommendation: efficientLocal,
  }), externalSummary({
    averageHashrate: 900_000_000_000,
    averageJoulesPerTerahash: 14,
  }), "max_hashrate", {
    searchSpaceReady: true,
    workAdapterReady: true,
    workAdapterStatus: "assignable",
    workLeaseUtilizationRatio: 0.1,
    hashWasteRisk: "medium",
  });

  assert.equal(recommendation.goal, "max_hashrate");
  assert.equal(recommendation.localProfile?.step.id, "local-fast");
  assert.equal(recommendation.externalRawHashrate, 900_000_000_000);
  assert.equal(recommendation.externalHashrate, 90_000_000_000);
  assert.equal(recommendation.externalWorkLeaseUtilizationRatio, 0.1);
  assert.equal(recommendation.externalHashrateBasis, "lease_adjusted");
  assert.equal(Math.round(recommendation.externalJoulesPerTerahash ?? 0), 167);
  assert.equal(recommendation.externalHashWasteRisk, "medium");
  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "local_throughput");
});

test("lowest power route uses the lowest watt local profile before lowest J/TH", () => {
  const lowPowerLocal = localResult({
    step: { id: "local-eco", summary: "CPU Eco" },
    watts: 8,
    qualityAdjustedHashrate: 80_000_000_000,
    qualityAdjustedJoulesPerTerahash: 100,
  });
  const efficientLocal = localResult({
    step: { id: "local-efficient", summary: "GPU 25%" },
    watts: 20,
    qualityAdjustedHashrate: 200_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  });

  const recommendation = recommendHashRouteForGoal(strategyAnalysis({
    lowestPower: lowPowerLocal,
    bestEfficiency: efficientLocal,
    bestHashrate: efficientLocal,
    paretoRecommendation: efficientLocal,
  }), externalSummary({
    averageWatts: 30,
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 12,
  }), "lowest_power");

  assert.equal(recommendation.goal, "lowest_power");
  assert.equal(recommendation.localProfile?.step.id, "local-eco");
  assert.equal(recommendation.target, "local");
  assert.equal(recommendation.reason, "local_power");
  assert.equal(recommendation.localWatts, 8);
  assert.equal(recommendation.externalWatts, 30);
});

test("lowest power route prefers external watts but respects search-space readiness", () => {
  const local = localResult({
    step: { id: "local-balanced", summary: "GPU 40%" },
    watts: 40,
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 25,
  });
  const external = externalSummary({
    averageWatts: 12,
    averageHashrate: 150_000_000_000,
    averageJoulesPerTerahash: 20,
  });

  const winner = recommendHashRouteForGoal(analysis(local), external, "lowest_power", {
    effectiveHashrate: 150_000_000_000,
  });
  const blocked = recommendHashRouteForGoal(analysis(local), external, "lowest_power", {
    searchSpaceReady: false,
    effectiveHashrate: 150_000_000_000,
    searchSpaceSummary: "Version rolling and extranonce partitioning are not proven.",
  });

  assert.equal(winner.target, "external");
  assert.equal(winner.reason, "external_power");
  assert.equal(winner.externalHashrateBasis, "effective");
  assert.equal(blocked.target, "monitor");
  assert.equal(blocked.reason, "external_search_space");
  assert.match(blocked.detail, /partitioning/i);
});

test("hash route scoring weights power and throughput by strategy", () => {
  const lowPowerLocal = localResult({
    step: { id: "local-eco", summary: "CPU Eco" },
    watts: 8,
    qualityAdjustedHashrate: 80_000_000_000,
    qualityAdjustedJoulesPerTerahash: 100,
  });
  const fastLocal = localResult({
    step: { id: "local-fast", summary: "GPU 75%" },
    watts: 40,
    qualityAdjustedHashrate: 500_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  });

  const lowestPower = recommendHashRouteForGoal(analysis(lowPowerLocal), externalSummary({
    averageWatts: 30,
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 12,
  }), "lowest_power");
  const maxHashrate = recommendHashRouteForGoal(analysis(fastLocal), externalSummary({
    averageWatts: 70,
    averageHashrate: 900_000_000_000,
    averageJoulesPerTerahash: 22,
  }), "max_hashrate");

  const lowPowerScore = scoreHashRouteRecommendation(lowestPower);
  const maxHashrateScore = scoreHashRouteRecommendation(maxHashrate);

  assert.ok(lowPowerScore.powerScore > lowPowerScore.throughputScore);
  assert.ok(maxHashrateScore.throughputScore > maxHashrateScore.powerScore);
  assert.match(lowPowerScore.summary, /power/);
  assert.match(maxHashrateScore.summary, /hash/);
});

test("hash route advisor returns all strategy goals in display order", () => {
  const recommendations = recommendHashRouteStrategies(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
  }));

  assert.deepEqual(recommendations.map((recommendation) => recommendation.goal), [
    "lowest_power",
    "max_efficiency",
    "balanced",
    "max_hashrate",
  ]);
  assert.equal(recommendations.length, 4);
});
test("hash route action planner applies a local profile as a manual draft action", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    step: { id: "local-efficient", summary: "GPU 30%" },
    qualityAdjustedHashrate: 2_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
  })), externalSummary({
    averageWatts: 80,
    averageHashrate: 1_000_000_000,
    averageJoulesPerTerahash: 20,
  }));
  const action = planHashRouteManualAction(recommendation);

  assert.equal(action.kind, "apply_local_profile");
  assert.equal(action.enabledByRecommendation, true);
  assert.equal(action.localProfile?.step.id, "local-efficient");
  assert.match(action.safetyNote, /draft local settings/i);
});

test("hash route action planner verifies external telemetry without enabling job control", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    effectiveHashrate: 500_000_000_000,
  });
  const action = planHashRouteManualAction(recommendation);

  assert.equal(action.target, "external");
  assert.equal(action.kind, "test_external_telemetry");
  assert.equal(action.requiresExternalTelemetry, true);
  assert.match(action.safetyNote, /does not hand Stratum jobs/i);
});
test("hash route action planner keeps reserved external search-space checks disabled", () => {
  const recommendation = recommendHashRoute(analysis(localResult()), externalSummary({
    averageHashrate: 500_000_000_000,
    averageJoulesPerTerahash: 20,
  }), {
    searchSpaceReady: false,
    searchSpaceSummary: "Direct adapter reserved until version rolling is proven.",
  });
  const action = planHashRouteManualAction(recommendation);

  assert.equal(action.kind, "monitor_route");
  assert.equal(action.enabledByRecommendation, false);
  assert.equal(action.requiresExternalTelemetry, false);
  assert.match(action.label, /check search space/i);
  assert.match(action.safetyNote, /direct and network adapters are reserved/i);
});

test("hash route action planner keeps monitor decisions disabled", () => {
  const recommendation = recommendHashRoute(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
  }));
  const action = planHashRouteManualAction(recommendation);

  assert.equal(action.kind, "monitor_route");
  assert.equal(action.enabledByRecommendation, false);
});

test("hash route action planner maps every strategy recommendation", () => {
  const recommendations = recommendHashRouteStrategies(analysis(localResult({
    qualityAdjustedHashrate: 100_000_000_000,
    qualityAdjustedJoulesPerTerahash: 20,
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 21,
  }));
  const actions = planHashRouteManualActions(recommendations);

  assert.deepEqual(actions.map((action) => action.goal), [
    "lowest_power",
    "max_efficiency",
    "balanced",
    "max_hashrate",
  ]);
  assert.equal(actions.length, recommendations.length);
});

test("hash route decision summarizes a local apply route", () => {
  const recommendations = recommendHashRouteStrategies(analysis(localResult({
    qualityAdjustedHashrate: 2_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
    longRunScore: 92,
    longRunRisk: "excellent",
  })), externalSummary({
    averageWatts: 80,
    averageHashrate: 1_000_000_000,
    averageJoulesPerTerahash: 20,
  }));
  const decision = summarizeHashRouteDecision(recommendations);

  assert.equal(decision?.status, "apply_local");
  assert.equal(decision?.primaryAction.kind, "apply_local_profile");
  assert.equal(decision?.target, "local");
  assert.ok(decision && decision.score > 70);
  assert.match(decision?.summary ?? "", /apply measured local/i);
});

test("hash route decision prioritizes external verification for long-run risk", () => {
  const recommendations = recommendHashRouteStrategies(analysis(localResult({
    qualityAdjustedHashrate: 90_000_000_000,
    qualityAdjustedJoulesPerTerahash: 24,
    longRunScore: 31,
    longRunRisk: "avoid",
  })), externalSummary({
    averageHashrate: 120_000_000_000,
    averageJoulesPerTerahash: 25,
    trend: "stable",
  }), {
    effectiveHashrate: 120_000_000_000,
  });
  const decision = summarizeHashRouteDecision(recommendations);

  assert.equal(decision?.status, "verify_external");
  assert.equal(decision?.primaryRecommendation.reason, "local_long_run_risk");
  assert.equal(decision?.primaryAction.kind, "test_external_telemetry");
  assert.match(decision?.safetyNote ?? "", /does not hand Stratum jobs/i);
});

test("hash route decision waits while local power evidence is estimated", () => {
  const recommendations = recommendHashRouteStrategies(analysis(localResult({
    qualityAdjustedHashrate: 2_000_000_000,
    qualityAdjustedJoulesPerTerahash: 10,
    powerEvidenceStatus: "estimated",
    powerEvidenceWeight: 0.9,
    powerEvidenceSummary: "Power evidence: estimated watts.",
    longRunRisk: "good",
  })), externalSummary({
    averageWatts: 80,
    averageHashrate: 1_000_000_000,
    averageJoulesPerTerahash: 20,
  }));
  const decision = summarizeHashRouteDecision(recommendations);

  assert.equal(decision?.status, "waiting");
  assert.equal(decision?.primaryRecommendation.reason, "need_local_samples");
  assert.equal(decision?.primaryAction.kind, "capture_local_sample");
  assert.match(decision?.summary ?? "", /collect route samples/i);
  assert.ok(decision && decision.score <= 35);
});
test("hash route decision waits when route evidence is missing", () => {
  const recommendations = recommendHashRouteStrategies(analysis(null), externalSummary({
    sampleCount: 0,
    onlineSampleCount: 0,
    efficiencySampleCount: 0,
    averageHashrate: 0,
    averageJoulesPerTerahash: null,
    bestJoulesPerTerahash: null,
  }));
  const decision = summarizeHashRouteDecision(recommendations);

  assert.equal(decision?.status, "waiting");
  assert.equal(decision?.primaryAction.kind, "capture_local_sample");
  assert.ok(decision && decision.score <= 35);
});

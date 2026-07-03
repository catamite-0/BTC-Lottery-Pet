import test from "node:test";
import assert from "node:assert/strict";

import { deriveHashOperatingPolicy } from "../.test-dist/domain/hashOperatingPolicy.js";
import { deriveHashRuntimeEfficiencySnapshot } from "../.test-dist/domain/hashRuntimeEfficiency.js";

function point(overrides = {}) {
  return {
    role: "balanced",
    source: "local",
    status: "ready",
    label: "Balanced local",
    hashrate: 200_000_000,
    watts: 12,
    joulesPerTerahash: 60_000,
    qualityScore: 80,
    longRunScore: 90,
    summary: "balanced",
    nextStep: "run",
    ...overrides,
  };
}

function marginalDecision(overrides = {}) {
  return {
    status: "none",
    fromLaneId: null,
    targetLaneId: null,
    extraHashrate: null,
    extraWatts: null,
    baselineHashesPerWatt: null,
    marginalHashesPerWatt: null,
    densityRetentionRatio: null,
    summary: "No higher density target is available.",
    nextStep: "Classify max-hash headroom before raising watts.",
    ...overrides,
  };
}
function kernelBenchmark(overrides = {}) {
  return {
    status: "passed",
    performance: "faster",
    midstateReady: true,
    nonceCount: 2048,
    fullHeaderHashrate: 10_000,
    midstateHashrate: 20_000,
    speedupRatio: 2,
    hashDensityGainPercent: 100,
    compressionWorkSavedPercent: 33.3,
    checksumHex: "0123456789abcdef",
    summary: "benchmark passed",
    nextStep: "keep benchmark",
    ...overrides,
  };
}

function plan(overrides = {}) {
  const recommendedPoint = overrides.recommendedPoint ?? point();
  const maxHashrate = overrides.maxHashrate ?? point({
    role: "max_hashrate",
    label: "Max hash",
    hashrate: 500_000_000,
    watts: 30,
    joulesPerTerahash: 60_000,
  });

  return {
    strategy: "route_monitoring",
    recommendedRoute: "local",
    dryRunOnly: false,
    routeAction: null,
    samplingPlan: {
      summary: "Capture measured evidence.",
      nextStep: "Capture a stable measured local sample.",
    },
    densityPlan: {
      readyForLongRun: true,
      externalDryRunOnly: false,
      selectedLane: {
        id: "local_power_budget",
        status: "ready",
      },
      hashrateHeadroom: {
        status: "none",
      },
      marginalDecision: marginalDecision(),
    },
    readinessCertificate: {
      readyForUnattendedLocal: true,
    },
    operatingEnvelope: {
      recommendedPoint,
      maxHashrate,
    },
    researchReview: {
      sourceIds: [
        "bitcoin_consensus_pow",
        "local_midstate_regression",
        "measured_power_telemetry",
        "sha256_uniform_search",
        "hashprice_demand_response_2026",
      ],
    },
    ...overrides,
  };
}

test("hash operating policy collects evidence before unattended local operation", () => {
  const policy = deriveHashOperatingPolicy(plan({
    densityPlan: {
      readyForLongRun: false,
      externalDryRunOnly: false,
      selectedLane: { id: "local_power_budget", status: "waiting" },
      hashrateHeadroom: { status: "waiting" },
      marginalDecision: marginalDecision({ status: "measure" }),
    },
    readinessCertificate: {
      readyForUnattendedLocal: false,
    },
  }));

  assert.equal(policy.mode, "collect_evidence");
  assert.equal(policy.action, "capture_evidence");
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.externalMiningAllowed, false);
  assert.match(policy.nextStep, /stable measured local sample/i);
});

test("hash operating policy defaults to measured useful density", () => {
  const policy = deriveHashOperatingPolicy(plan(), { kernelBenchmark: kernelBenchmark() });

  assert.equal(policy.mode, "balanced_density");
  assert.equal(policy.action, "run_local_density");
  assert.equal(policy.autoApplyAllowed, true);
  assert.equal(policy.defaultPointRole, "balanced");
  assert.equal(policy.burstAllowed, false);
  assert.ok(policy.sourceIds.includes("measured_power_telemetry"));
});


test("hash operating policy holds auto apply on clean but thin runtime evidence", () => {
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 1,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 120,
  });
  const policy = deriveHashOperatingPolicy(plan(), {
    kernelBenchmark: kernelBenchmark(),
    runtimeEfficiency,
  });

  assert.equal(runtimeEfficiency.status, "efficient");
  assert.equal(runtimeEfficiency.promotionEvidenceReady, false);
  assert.equal(policy.runtimeGuard, "observe");
  assert.equal(policy.runtimePromotionAllowed, false);
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.unattendedLocalAllowed, true);
});
test("hash operating policy blocks auto apply while midstate benchmark is missing", () => {
  const policy = deriveHashOperatingPolicy(plan());

  assert.equal(policy.kernelOptimization.mode, "midstate_evidence_wait");
  assert.equal(policy.kernelPromotionAllowed, false);
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.burstAllowed, false);
  assert.match(policy.kernelOptimization.nextStep, /fixed-window kernel benchmark/i);
});
test("hash operating policy keeps local density active when only dry-run capability is present", () => {
  const policy = deriveHashOperatingPolicy(plan({
    dryRunOnly: true,
    recommendedRoute: "local",
  }), { kernelBenchmark: kernelBenchmark() });

  assert.equal(policy.mode, "balanced_density");
  assert.equal(policy.action, "run_local_density");
  assert.equal(policy.autoApplyAllowed, true);
  assert.equal(policy.externalDryRunOnly, false);
  assert.equal(policy.externalMiningAllowed, false);
});
test("hash operating policy allows max-hash only as measured burst headroom", () => {
  const policy = deriveHashOperatingPolicy(plan({
    recommendedPoint: point({
      role: "max_hashrate",
      hashrate: 500_000_000,
      watts: 30,
    }),
    densityPlan: {
      readyForLongRun: true,
      externalDryRunOnly: false,
      selectedLane: { id: "local_max_hashrate", status: "ready" },
      hashrateHeadroom: {
        status: "available",
      },
      marginalDecision: marginalDecision({
        status: "advance",
        densityRetentionRatio: 0.72,
        summary: "Advance is efficient enough.",
        nextStep: "Keep high output manual.",
      }),
    },
  }), { kernelBenchmark: kernelBenchmark() });

  assert.equal(policy.mode, "hashrate_burst");
  assert.equal(policy.action, "probe_hashrate_headroom");
  assert.equal(policy.burstAllowed, true);
  assert.equal(policy.burstDecisionStatus, "advance");
  assert.equal(policy.burstDensityRetentionRatio, 0.72);
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.burstHashrate, 500_000_000);
  assert.match(policy.summary, /max-hash burst/i);
});

test("hash operating policy blocks max-hash burst when marginal density does not pay", () => {
  const policy = deriveHashOperatingPolicy(plan({
    recommendedPoint: point({
      role: "max_hashrate",
      hashrate: 500_000_000,
      watts: 30,
    }),
    densityPlan: {
      readyForLongRun: true,
      externalDryRunOnly: false,
      selectedLane: { id: "local_power_budget", status: "ready" },
      hashrateHeadroom: {
        status: "available",
      },
      marginalDecision: marginalDecision({
        status: "hold",
        densityRetentionRatio: 0.22,
        summary: "Hold the upgrade because useful density collapses.",
        nextStep: "Stay on the selected density lane.",
      }),
    },
  }));

  assert.equal(policy.mode, "balanced_density");
  assert.equal(policy.action, "run_local_density");
  assert.equal(policy.burstAllowed, false);
  assert.equal(policy.burstDecisionStatus, "hold");
  assert.equal(policy.burstHashrate, null);
  assert.equal(policy.autoApplyAllowed, false);
  assert.match(policy.nextStep, /too many extra watts/i);
});

test("hash operating policy keeps external high-hash routes dry-run only", () => {
  const policy = deriveHashOperatingPolicy(plan({
    strategy: "external_work_dry_run",
    recommendedRoute: "external",
    dryRunOnly: true,
    densityPlan: {
      readyForLongRun: false,
      externalDryRunOnly: true,
      selectedLane: { id: "external_hardware", status: "dry-run" },
      hashrateHeadroom: { status: "none" },
      marginalDecision: marginalDecision(),
    },
    readinessCertificate: {
      readyForUnattendedLocal: false,
    },
    researchReview: {
      sourceIds: [
        "bitcoin_consensus_pow",
        "bip320_version_bits",
        "stratum_v2_mining_protocol",
        "sha256_uniform_search",
      ],
    },
  }));

  assert.equal(policy.mode, "external_dry_run");
  assert.equal(policy.action, "validate_external_work");
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.externalDryRunOnly, true);
  assert.equal(policy.externalMiningAllowed, false);
  assert.ok(policy.sourceIds.includes("stratum_v2_mining_protocol"));
  assert.match(policy.nextStep, /real external mining disabled/i);
});
test("hash operating policy prefers midstate only after positive kernel evidence", () => {
  const policy = deriveHashOperatingPolicy(plan(), {
    kernelBenchmark: {
      status: "passed",
      performance: "faster",
      midstateReady: true,
      nonceCount: 2048,
      fullHeaderHashrate: 10_000,
      midstateHashrate: 20_000,
      speedupRatio: 2,
      hashDensityGainPercent: 100,
      compressionWorkSavedPercent: 33.3,
      checksumHex: "0123456789abcdef",
      summary: "benchmark passed",
      nextStep: "keep benchmark",
    },
  });

  assert.equal(policy.kernelOptimization.mode, "midstate_density");
  assert.equal(policy.kernelOptimization.midstatePreferred, true);
  assert.equal(policy.kernelOptimization.speedupRatio, 2);
  assert.equal(policy.kernelOptimization.hashDensityGainPercent, 100);
  assert.equal(policy.kernelOptimization.compressionWorkSavedPercent, 33.3);
  assert.equal(policy.kernelPromotionAllowed, true);
  assert.match(policy.kernelOptimization.summary, /prefers midstate/i);
  assert.match(policy.kernelOptimization.summary, /33\.3% compression work saved/i);
  assert.ok(policy.guardrails.some((guardrail) => /fixed-window diagnostics/i.test(guardrail)));
});

test("hash operating policy falls back when kernel evidence is blocked", () => {
  const policy = deriveHashOperatingPolicy(plan(), {
    kernelBenchmark: {
      status: "blocked",
      performance: "unknown",
      midstateReady: false,
      nonceCount: 2048,
      fullHeaderHashrate: null,
      midstateHashrate: null,
      speedupRatio: null,
      checksumHex: null,
      summary: "benchmark failed",
      nextStep: "repair benchmark",
    },
  });

  assert.equal(policy.kernelOptimization.mode, "full_header_baseline");
  assert.equal(policy.kernelOptimization.midstatePreferred, false);
  assert.match(policy.kernelOptimization.summary, /full-header baseline/i);
});

test("hash operating policy watches midstate regressions without preferring them", () => {
  const policy = deriveHashOperatingPolicy(plan(), {
    kernelBenchmark: {
      status: "passed",
      performance: "regression",
      midstateReady: true,
      nonceCount: 2048,
      fullHeaderHashrate: 20_000,
      midstateHashrate: 10_000,
      speedupRatio: 0.5,
      checksumHex: "0123456789abcdef",
      summary: "benchmark passed but slow",
      nextStep: "investigate regression",
    },
  });

  assert.equal(policy.kernelOptimization.mode, "midstate_regression_watch");
  assert.equal(policy.kernelOptimization.midstatePreferred, false);
  assert.equal(policy.kernelOptimization.benchmarkPerformance, "regression");
  assert.equal(policy.kernelPromotionAllowed, false);
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.burstAllowed, false);
  assert.equal(policy.unattendedLocalAllowed, true);
});
test("hash operating policy blocks profile promotion when live share waste is high", () => {
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 6,
    rejectedShares: 1,
    staleSharesDropped: 2,
    queuedSharesDropped: 1,
  });
  const policy = deriveHashOperatingPolicy(plan(), { runtimeEfficiency });

  assert.equal(policy.runtimeGuard, "block");
  assert.equal(policy.runtimeEfficiencyStatus, "wasteful");
  assert.equal(policy.mode, "runtime_guard");
  assert.equal(policy.action, "reduce_runtime_waste");
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.unattendedLocalAllowed, false);
  assert.equal(policy.runtimeShareWasteRatio, 0.4);
  assert.equal(policy.runtimePromotionAllowed, false);
  assert.equal(policy.runtimeRecoveryAction, "lower_load");
  assert.equal(policy.runtimeQualityLossHashrate, 400_000);
  assert.equal(policy.runtimeThrottleHashrateAtRisk, null);
  assert.equal(policy.runtimeEffectiveHashrate, 600_000);
  assert.equal(policy.runtimeWastedHashrate, 400_000);
  assert.equal(policy.runtimeGpuThrottleHashrateAtRisk, null);
  assert.match(policy.nextStep, /lower intensity|share quality/i);
});

test("hash operating policy keeps watch runtime evidence manual without blocking the local lane", () => {
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 9,
    rejectedShares: 1,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const policy = deriveHashOperatingPolicy(plan(), { runtimeEfficiency });

  assert.equal(policy.runtimeGuard, "observe");
  assert.equal(policy.runtimeEfficiencyStatus, "watch");
  assert.equal(policy.mode, "balanced_density");
  assert.equal(policy.action, "run_local_density");
  assert.equal(policy.autoApplyAllowed, false);
  assert.equal(policy.unattendedLocalAllowed, true);
  assert.equal(policy.runtimeEffectiveRatio, 0.9);
  assert.equal(policy.runtimePromotionAllowed, false);
  assert.equal(policy.runtimeRecoveryAction, "hold_load");
  assert.equal(policy.runtimeQualityLossHashrate, 100_000);
  assert.equal(policy.runtimeEffectiveHashrate, 900_000);
  assert.equal(policy.runtimeWastedHashrate, 100_000);
});

test("hash operating policy does not expose unproven runtime effective hash", () => {
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 0,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const policy = deriveHashOperatingPolicy(plan(), { runtimeEfficiency });

  assert.equal(policy.runtimeGuard, "observe");
  assert.equal(policy.runtimeEfficiencyStatus, "watch");
  assert.equal(policy.runtimeEffectiveRatio, null);
  assert.equal(policy.runtimeEffectiveHashrate, null);
  assert.equal(policy.runtimeWastedHashrate, null);
  assert.equal(policy.runtimePromotionAllowed, false);
  assert.equal(policy.runtimeQualityLossHashrate, null);
});

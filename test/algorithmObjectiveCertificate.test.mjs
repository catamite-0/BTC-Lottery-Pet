import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmObjectiveCertificate } from "../.test-dist/domain/algorithmObjectiveCertificate.js";

function marginalDecision(overrides = {}) {
  return {
    status: "advance",
    fromLaneId: "local_power_budget",
    targetLaneId: "local_max_hashrate",
    extraHashrate: 190_000_000,
    extraWatts: 18,
    baselineHashesPerWatt: 18_333_333,
    marginalHashesPerWatt: 10_555_555,
    densityRetentionRatio: 0.72,
    summary: "Advance is efficient enough.",
    nextStep: "Keep high output manual.",
    ...overrides,
  };
}

function plan(overrides = {}) {
  return {
    dryRunOnly: false,
    densityPlan: {
      readyForLongRun: true,
      externalDryRunOnly: false,
      externalIsEfficiencyReference: false,
      powerBudgetWatts: 12,
      selectedLane: {
        id: "local_power_budget",
        source: "local",
        status: "ready",
        hashrate: 220_000_000,
        watts: 12,
        joulesPerTerahash: 54_545,
      },
      marginalDecision: marginalDecision(),
      primaryMissingGate: null,
    },
    readinessCertificate: {
      primaryMissingGate: null,
    },
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    unattendedLocalAllowed: true,
    autoApplyAllowed: true,
    externalMiningAllowed: false,
    externalDryRunOnly: false,
    runtimeGuard: "clear",
    kernelPromotionAllowed: true,
    kernelOptimization: {
      mode: "midstate_density",
      nextStep: "Keep benchmark green.",
    },
    burstAllowed: true,
    burstHashrate: 410_000_000,
    burstWatts: 30,
    defaultPointRole: "balanced",
    defaultPointStatus: "ready",
    sourceIds: ["bitcoin_consensus_pow", "measured_power_telemetry", "sha256_uniform_search"],
    nextStep: "Use density lane.",
    ...overrides,
  };
}

test("algorithm objective certificate marks low-power density plus proven burst as ready", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(plan(), policy());

  assert.equal(certificate.status, "ready");
  assert.equal(certificate.runtimeMode, "density_with_manual_burst");
  assert.equal(certificate.objectiveProgressScore, 100);
  assert.equal(certificate.lowPowerProgressScore, 100);
  assert.equal(certificate.highHashProgressScore, 100);
  assert.equal(certificate.primaryEvidenceGap, "none");
  assert.equal(certificate.lowPowerReady, true);
  assert.equal(certificate.highHashReady, true);
  assert.equal(certificate.externalMiningAllowed, false);
  assert.equal(certificate.highHashPath, "manual_burst");
  assert.equal(certificate.sustainableWatts, 12);
  assert.equal(certificate.burstHashrate, 410_000_000);
  assert.equal(certificate.marginalDensityRetentionThreshold, 0.55);
  assert.match(certificate.guardrails.join(" "), /lowest sustainable useful-hash density/i);
});

test("algorithm objective certificate keeps low-power ready when max-hash watts do not pay", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan({
      densityPlan: {
        ...plan().densityPlan,
        marginalDecision: marginalDecision({
          status: "hold",
          densityRetentionRatio: 0.22,
          summary: "Hold the upgrade because useful density collapses.",
          nextStep: "Stay on the selected density lane.",
        }),
      },
    }),
    policy({
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
      autoApplyAllowed: true,
    }),
  );

  assert.equal(certificate.status, "partial");
  assert.equal(certificate.runtimeMode, "density_default");
  assert.equal(certificate.lowPowerReady, true);
  assert.equal(certificate.highHashReady, false);
  assert.equal(certificate.highHashPath, "marginal_hold");
  assert.equal(certificate.primaryEvidenceGap, "max_hash_marginal_hold");
  assert.equal(certificate.highHashProgressScore, 45);
  assert.equal(certificate.objectiveProgressScore, 78);
  assert.equal(certificate.burstHashrate, null);
  assert.match(certificate.summary, /spends too many extra watts/i);
  assert.equal(certificate.nextStep, "Stay on the selected density lane.");
});

test("algorithm objective certificate waits for kernel benchmark before high-hash promotion", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan(),
    policy({
      kernelPromotionAllowed: false,
      kernelOptimization: {
        mode: "midstate_evidence_wait",
        nextStep: "Run the fixed-window kernel benchmark.",
      },
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
      autoApplyAllowed: false,
    }),
  );

  assert.equal(certificate.status, "partial");
  assert.equal(certificate.lowPowerReady, true);
  assert.equal(certificate.highHashReady, false);
  assert.equal(certificate.highHashPath, "kernel_evidence_wait");
  assert.equal(certificate.primaryEvidenceGap, "kernel_evidence_wait");
  assert.equal(certificate.highHashProgressScore, 35);
  assert.match(certificate.summary, /benchmark evidence/i);
  assert.match(certificate.nextStep, /fixed-window kernel benchmark/i);
});
test("algorithm objective certificate blocks high-hash promotion on kernel regression", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan(),
    policy({
      kernelPromotionAllowed: false,
      kernelOptimization: {
        mode: "midstate_regression_watch",
        nextStep: "Investigate the midstate regression before claiming a speed gain.",
      },
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
      autoApplyAllowed: false,
    }),
  );

  assert.equal(certificate.status, "partial");
  assert.equal(certificate.lowPowerReady, true);
  assert.equal(certificate.highHashReady, false);
  assert.equal(certificate.highHashPath, "kernel_regression");
  assert.equal(certificate.primaryEvidenceGap, "kernel_regression");
  assert.equal(certificate.highHashProgressScore, 30);
  assert.match(certificate.summary, /midstate benchmark regresses/i);
  assert.match(certificate.nextStep, /midstate regression/i);
});

test("algorithm objective certificate blocks high-hash promotion when kernel proof is blocked", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan(),
    policy({
      kernelPromotionAllowed: false,
      kernelOptimization: {
        mode: "full_header_baseline",
        nextStep: "Repair the midstate equivalence proof before claiming kernel density gains.",
      },
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
      autoApplyAllowed: false,
    }),
  );

  assert.equal(certificate.status, "partial");
  assert.equal(certificate.highHashPath, "kernel_blocked");
  assert.equal(certificate.primaryEvidenceGap, "kernel_blocked");
  assert.equal(certificate.highHashProgressScore, 30);
  assert.match(certificate.summary, /equivalence is blocked|full-header baseline/i);
  assert.match(certificate.nextStep, /equivalence proof/i);
});
test("algorithm objective certificate blocks promotion when runtime guard blocks", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan(),
    policy({
      runtimeGuard: "block",
      burstAllowed: false,
      nextStep: "Reduce share waste before promotion.",
    }),
  );

  assert.equal(certificate.status, "blocked");
  assert.equal(certificate.runtimeMode, "runtime_guard");
  assert.equal(certificate.primaryBlockerId, "runtime_guard");
  assert.equal(certificate.primaryEvidenceGap, "runtime_guard");
  assert.equal(certificate.objectiveProgressScore, 40);
  assert.equal(certificate.highHashReady, false);
  assert.match(certificate.primaryBlockerSummary ?? "", /waste or throttling/i);
  assert.equal(certificate.nextStep, "Reduce share waste before promotion.");
});

test("algorithm objective certificate keeps external high hash dry-run only", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan({
      dryRunOnly: true,
      densityPlan: {
        ...plan().densityPlan,
        externalDryRunOnly: true,
        selectedLane: {
          id: "external_hardware",
          source: "external",
          status: "dry-run",
          hashrate: 2_400_000_000_000,
          watts: 32,
          joulesPerTerahash: 13,
        },
      },
    }),
    policy({
      unattendedLocalAllowed: false,
      autoApplyAllowed: false,
      externalDryRunOnly: true,
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
      sourceIds: ["bitcoin_consensus_pow", "stratum_v2_mining_protocol", "sha256_uniform_search"],
    }),
  );

  assert.equal(certificate.status, "dry_run");
  assert.equal(certificate.runtimeMode, "external_dry_run");
  assert.equal(certificate.highHashPath, "external_dry_run");
  assert.equal(certificate.primaryEvidenceGap, "external_dry_run");
  assert.equal(certificate.objectiveProgressScore, 10);
  assert.equal(certificate.externalMiningAllowed, false);
  assert.equal(certificate.lowPowerReady, false);
  assert.match(certificate.nextStep, /external start/i);
});

test("algorithm objective certificate waits on measured local evidence", () => {
  const certificate = deriveAlgorithmObjectiveCertificate(
    plan({
      densityPlan: {
        ...plan().densityPlan,
        readyForLongRun: false,
        selectedLane: {
          id: "local_power_budget",
          source: "local",
          status: "waiting",
          hashrate: null,
          watts: null,
          joulesPerTerahash: null,
        },
        primaryMissingGate: {
          id: "measured_power",
          status: "waiting",
          summary: "Selected local lane needs measured watt evidence.",
          nextStep: "Capture measured watts.",
        },
        marginalDecision: marginalDecision({ status: "measure", nextStep: "Measure max hash." }),
      },
      readinessCertificate: {
        primaryMissingGate: {
          id: "measured_power",
          status: "waiting",
          summary: "Measured power is missing.",
          nextStep: "Capture measured watts.",
        },
      },
    }),
    policy({
      unattendedLocalAllowed: false,
      autoApplyAllowed: false,
      burstAllowed: false,
      burstHashrate: null,
      burstWatts: null,
    }),
  );

  assert.equal(certificate.status, "waiting");
  assert.equal(certificate.runtimeMode, "collect_evidence");
  assert.equal(certificate.primaryEvidenceGap, "low_power_evidence");
  assert.equal(certificate.lowPowerProgressScore, 35);
  assert.equal(certificate.lowPowerReady, false);
  assert.equal(certificate.primaryBlockerId, "measured_power");
  assert.equal(certificate.nextStep, "Capture measured watts.");
});

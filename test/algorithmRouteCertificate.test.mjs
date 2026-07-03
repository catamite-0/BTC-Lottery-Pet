import test from "node:test";
import assert from "node:assert/strict";

import { deriveAlgorithmRouteCertificate } from "../.test-dist/domain/algorithmRouteCertificate.js";

function plan(overrides = {}) {
  return {
    algorithmStack: {
      consensusHashing: "double_sha256",
      consensusScope: "fixed_header_pow",
      localKernel: {
        mode: "midstate_reuse",
        status: "done",
        summary: "Midstate is proven.",
        nextStep: "Keep equivalence tests green.",
      },
      defaultOperatingLane: {
        id: "local_power_budget",
        source: "local",
        status: "ready",
        strategy: "local_power_budget",
        summary: "Measured density lane.",
        nextStep: "Keep sampling.",
      },
      powerObjective: "balanced",
      highHashPath: "local_runtime",
      externalWorkPolicy: "disabled",
      frontierPolicy: "review_required",
      rejectedShortcutIdeaIds: ["predictive_nonce_pruning", "proof_of_work_compression"],
      summary: "Algorithm stack.",
      nextStep: "Keep sampling.",
    },
    researchPromotionGate: {
      status: "review_required",
      frontierPromotionAllowed: false,
      runtimeProfilePromotionAllowed: true,
      blockedSourceIds: ["thermodynamic_sha256_asic_2026"],
      protectedRuntimeSourceIds: ["bitcoin_consensus_pow", "local_midstate_regression"],
      summary: "Frontier review required.",
      nextStep: "Refresh frontier research sources before promoting any new low-power or high-hash algorithm claim.",
    },
    evidenceRoadmap: {
      completionScore: 88,
      primaryPhase: {
        id: "research_frontier_filter",
        status: "blocked",
      },
    },
    samplingPlan: {
      nextStep: "Review sources.",
    },
    densityPlan: {
      externalIsEfficiencyReference: false,
    },
    ...overrides,
  };
}

function objective(overrides = {}) {
  return {
    objective: "lowest_power_high_hashrate",
    status: "ready",
    runtimeMode: "density_with_manual_burst",
    objectiveProgressScore: 100,
    lowPowerProgressScore: 100,
    highHashProgressScore: 100,
    primaryEvidenceGap: "none",
    consensusSafe: true,
    lowPowerReady: true,
    highHashReady: true,
    externalMiningAllowed: false,
    highHashPath: "manual_burst",
    guardrails: ["Never trade consensus correctness for prediction, pruning, or proof-of-work compression."],
    nextStep: "Run density lane with manual burst only.",
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    action: "keep_manual_burst_available",
    nextStep: "Run density lane with manual burst only.",
    ...overrides,
  };
}

function envelope(overrides = {}) {
  return {
    mode: "budgeted_burst",
    status: "manual",
    nextStep: "Keep burst inside the measured watt envelope.",
    ...overrides,
  };
}

function certificate(overrides = {}) {
  return deriveAlgorithmRouteCertificate({
    plan: plan(overrides.plan),
    objectiveCertificate: objective(overrides.objectiveCertificate),
    objectiveActionPlan: action(overrides.objectiveActionPlan),
    powerHashEnvelope: envelope(overrides.powerHashEnvelope),
  });
}

test("algorithm route certificate allows runtime-ready local midstate while frontier review is due", () => {
  const result = certificate();

  assert.equal(result.status, "ready");
  assert.equal(result.productionMode, "local_density_manual_burst");
  assert.equal(result.defaultAlgorithm, "double_sha256_midstate");
  assert.equal(result.runtimeProfileClaimAllowed, true);
  assert.equal(result.fullObjectiveClaimAllowed, true);
  assert.equal(result.frontierClaimAllowed, false);
  assert.equal(result.externalMiningAllowed, false);
  assert.ok(result.missingEvidenceIds.includes("frontier_research_refresh"));
  assert.deepEqual(result.forbiddenShortcutIdeaIds, ["predictive_nonce_pruning", "proof_of_work_compression"]);
  assert.match(result.summary, /runtime-ready/i);
  assert.match(result.nextStep, /Refresh frontier/i);
});

test("algorithm route certificate keeps external high hash in dry-run only", () => {
  const result = certificate({
    plan: {
      algorithmStack: {
        ...plan().algorithmStack,
        defaultOperatingLane: {
          ...plan().algorithmStack.defaultOperatingLane,
          id: "external_reference",
          source: "external",
          status: "dry-run",
        },
        highHashPath: "external_dry_run",
        externalWorkPolicy: "dry_run_only",
      },
      evidenceRoadmap: {
        completionScore: 64,
        primaryPhase: {
          id: "external_work_validation",
          status: "ready",
        },
      },
    },
    objectiveCertificate: {
      status: "dry_run",
      runtimeMode: "external_dry_run",
      objectiveProgressScore: 10,
      lowPowerReady: false,
      highHashReady: false,
      primaryEvidenceGap: "external_dry_run",
      highHashPath: "external_dry_run",
    },
    objectiveActionPlan: {
      action: "validate_external_dry_run",
      nextStep: "Validate external work leases and share accounting.",
    },
    powerHashEnvelope: {
      mode: "external_dry_run",
      status: "waiting",
    },
  });

  assert.equal(result.status, "dry_run");
  assert.equal(result.productionMode, "external_dry_run_only");
  assert.equal(result.fullObjectiveClaimAllowed, false);
  assert.equal(result.runtimeProfileClaimAllowed, false);
  assert.equal(result.highHashPath, "external_dry_run");
  assert.ok(result.missingEvidenceIds.includes("external_work_validation"));
  assert.match(result.summary, /dry-run only/i);
});

test("algorithm route certificate keeps local runtime while external dry-run validation is available", () => {
  const result = certificate({
    plan: {
      algorithmStack: {
        ...plan().algorithmStack,
        highHashPath: "local_runtime",
        externalWorkPolicy: "dry_run_only",
      },
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.productionMode, "local_density_manual_burst");
  assert.equal(result.highHashPath, "local_runtime");
  assert.equal(result.externalWorkPolicy, "dry_run_only");
  assert.equal(result.fullObjectiveClaimAllowed, true);
  assert.match(result.summary, /runtime-ready|manual burst/i);
});
test("algorithm route certificate treats dominant high hash as the local density default", () => {
  const result = certificate({
    powerHashEnvelope: {
      mode: "dominant_high_hash_density",
      status: "ready",
    },
  });

  assert.equal(result.status, "ready");
  assert.equal(result.productionMode, "local_density_default");
  assert.equal(result.powerEnvelopeMode, "dominant_high_hash_density");
  assert.equal(result.fullObjectiveClaimAllowed, true);
  assert.match(result.summary, /dominant measured density lane/i);
});
test("algorithm route certificate blocks claims when kernel or runtime recovery is needed", () => {
  const result = certificate({
    plan: {
      algorithmStack: {
        ...plan().algorithmStack,
        localKernel: {
          mode: "midstate_blocked",
          status: "blocked",
          summary: "Midstate regressed.",
          nextStep: "Use full-header fallback.",
        },
      },
      evidenceRoadmap: {
        completionScore: 42,
        primaryPhase: {
          id: "consensus_guardrail",
          status: "blocked",
        },
      },
    },
    objectiveCertificate: {
      status: "partial",
      objectiveProgressScore: 40,
      highHashReady: false,
      primaryEvidenceGap: "kernel_regression",
      highHashPath: "kernel_regression",
    },
    objectiveActionPlan: {
      action: "recover_runtime_guard",
      nextStep: "Investigate the midstate regression.",
    },
    powerHashEnvelope: {
      mode: "runtime_guard",
      status: "blocked",
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.productionMode, "runtime_recovery");
  assert.equal(result.defaultAlgorithm, "double_sha256_full_header");
  assert.equal(result.runtimeProfileClaimAllowed, false);
  assert.ok(result.missingEvidenceIds.includes("midstate_or_full_header_recovery"));
  assert.ok(result.missingEvidenceIds.includes("runtime_power_hash_recovery"));
  assert.match(result.nextStep, /midstate regression/i);
});
test("algorithm route certificate waits for midstate benchmark before claiming runtime algorithm", () => {
  const result = certificate({
    plan: {
      algorithmStack: {
        ...plan().algorithmStack,
        localKernel: {
          mode: "midstate_waiting",
          status: "ready",
          summary: "Midstate benchmark is waiting.",
          nextStep: "Run the fixed-window full-header vs HeaderWork benchmark.",
        },
      },
    },
  });

  assert.equal(result.status, "partial");
  assert.equal(result.defaultAlgorithm, "double_sha256_pending_midstate");
  assert.equal(result.runtimeProfileClaimAllowed, false);
  assert.equal(result.fullObjectiveClaimAllowed, false);
  assert.ok(result.missingEvidenceIds.includes("midstate_benchmark_evidence"));
  assert.match(result.nextStep, /fixed-window full-header/i);
});

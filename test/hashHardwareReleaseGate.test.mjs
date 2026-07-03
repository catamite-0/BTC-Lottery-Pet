import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashEngineCandidateGate,
  deriveExternalHashInterfaceSpec,
  deriveExternalHashProtocolContract,
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import { summarizeExternalHashHistory } from "../.test-dist/domain/externalHashHistory.js";
import { createHashClaimCertificate } from "../.test-dist/domain/hashClaimCertificate.js";
import { assessHashHardwareOperatingEvidence } from "../.test-dist/domain/hashHardwareOperatingEvidence.js";
import { createHashHardwareReleaseEvidenceDossier, deriveHashHardwareReleaseGate } from "../.test-dist/domain/hashHardwareReleaseGate.js";
import { deriveExternalHashEngineValidationChecklist } from "../.test-dist/engines/externalHashEngineValidation.js";

const allValidationPassed = [
  { kind: "job_lifecycle", status: "passed" },
  { kind: "search_space_assignment", status: "passed" },
  { kind: "stale_job_rejection", status: "passed" },
  { kind: "thermal_limits", status: "passed" },
  { kind: "share_submission", status: "passed" },
];

function protocolContractFromSnapshot(snapshot) {
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const gate = deriveExternalHashEngineCandidateGate(snapshot, matrix);
  const spec = deriveExternalHashInterfaceSpec(snapshot, matrix, gate);
  return deriveExternalHashProtocolContract(spec, matrix);
}

function telemetryOnlyContract() {
  return protocolContractFromSnapshot(deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Gamma",
    hostname: "bitaxe.local",
    hash_rate_hs: 1_200_000_000_000,
    power_watts: 18,
    joules_per_terahash: 15,
    summary: "ASIC telemetry: 1.2 TH/s at 18 W",
  }));
}

function directReservedContract() {
  return protocolContractFromSnapshot(deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null));
}

function dryRunContract() {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-rack.local",
  }, {
    status: "ok",
    base_url: "http://future-rack.local",
    device_name: "Future Rack",
    hostname: "future-rack.local",
    hash_rate_hs: 500_000_000_000_000,
    power_watts: 6500,
    joules_per_terahash: 13,
    parallel_workers: 4,
    summary: "Future rack telemetry: 500 TH/s across 4 workers",
  });
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"];
  return protocolContractFromSnapshot({
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: true,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      engineEligible: true,
      capabilities,
    },
  });
}

function stableExternalHistory() {
  return Array.from({ length: 6 }, (_, index) => ({
    generatedAt: String(6 - index),
    endpoint: "http://future-rack.local",
    status: "ok",
    hashrate: 500_000_000_000_000,
    watts: 6500 + index,
    joulesPerTerahash: 13 + index * 0.1,
    tempC: 58 + index,
    vrTempC: 62 + index,
    fanRpm: 4200,
    acceptedShares: 10 + index,
    rejectedShares: 0,
    miningPaused: false,
  }));
}

function passedOperatingEvidence(overrides = {}) {
  return assessHashHardwareOperatingEvidence([{
    generatedAt: "2026-07-02T00:15:00.000Z",
    durationSeconds: 900,
    hashrate: 2_400_000_000_000,
    wallWatts: 32,
    joulesPerTerahash: 13,
    powerEvidenceSource: "wall_meter",
    tempC: 58,
    vrTempC: 62,
    fanRpm: 4200,
    noiseDba: 42,
    acceptedShares: 4,
    rejectedShares: 0,
    miningPaused: false,
    ...overrides,
  }]);
}

test("hardware release gate blocks telemetry-only network adapters", () => {
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: telemetryOnlyContract(),
    externalHistory: summarizeExternalHashHistory([]),
    validationChecklist: deriveExternalHashEngineValidationChecklist(),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: [],
    }),
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.releaseCandidateReady, false);
  assert.equal(gate.miningStartAllowed, false);
  assert.equal(gate.primaryBlockingCheck?.id, "protocol_contract");
  assert.ok(gate.missingCheckIds.includes("external_work_validation"));
  assert.match(gate.checks.find((check) => check.id === "protocol_contract")?.summary ?? "", /telemetry-only/i);
});

test("hardware release gate keeps direct endpoints reserved", () => {
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: directReservedContract(),
    externalHistory: summarizeExternalHashHistory(stableExternalHistory()),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: stableExternalHistory(),
      externalWorkAssignable: true,
      externalMiningStartAllowed: false,
    }),
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.releaseCandidateReady, false);
  assert.equal(gate.primaryBlockingCheck?.id, "protocol_contract");
  assert.match(gate.primaryBlockingCheck?.summary ?? "", /Direct external hash/i);
  assert.equal(gate.miningStartAllowed, false);
});

test("hardware release gate blocks external claims missing effective hashrate proof", () => {
  const history = stableExternalHistory();
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: dryRunContract(),
    externalHistory: summarizeExternalHashHistory(history),
    operatingEvidence: passedOperatingEvidence(),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: history,
      externalEffectiveHashrate: null,
      externalWorkAssignable: true,
      externalMiningStartAllowed: true,
    }),
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.releaseCandidateReady, false);
  assert.equal(gate.primaryBlockingCheck?.id, "claim_evidence");
  assert.ok(gate.missingCheckIds.includes("claim_evidence"));
  assert.match(gate.primaryBlockingCheck?.summary ?? "", /effective hashrate/i);
  assert.equal(gate.miningStartAllowed, false);
});
test("hardware release gate blocks dry-run evidence without operating proof", () => {
  const history = stableExternalHistory();
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: dryRunContract(),
    externalHistory: summarizeExternalHashHistory(history),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: history,
      externalEffectiveHashrate: 2_400_000_000_000,
      externalWorkAssignable: true,
      externalMiningStartAllowed: false,
    }),
  });

  assert.equal(gate.status, "blocked");
  assert.equal(gate.releaseCandidateReady, false);
  assert.equal(gate.primaryBlockingCheck?.id, "hardware_operating_evidence");
  assert.ok(gate.missingCheckIds.includes("hardware_operating_evidence"));
  assert.equal(gate.miningStartAllowed, false);
});
test("hardware release gate promotes complete dry-run evidence only to release candidate", () => {
  const history = stableExternalHistory();
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: dryRunContract(),
    externalHistory: summarizeExternalHashHistory(history),
    operatingEvidence: passedOperatingEvidence(),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: history,
      externalEffectiveHashrate: 2_400_000_000_000,
      externalWorkAssignable: true,
      externalMiningStartAllowed: false,
    }),
  });

  assert.equal(gate.status, "release_candidate");
  assert.equal(gate.releaseCandidateReady, true);
  assert.equal(gate.miningStartAllowed, false);
  assert.equal(gate.readinessScore, 71);
  assert.equal(gate.primaryBlockingCheck?.id, "release_review");
  assert.deepEqual(gate.missingCheckIds, ["release_review", "engine_release_flag"]);
  assert.match(gate.summary, /real mining start remains disabled/i);
});
test("hardware release gate waits for engine flag after release review", () => {
  const history = stableExternalHistory();
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: dryRunContract(),
    externalHistory: summarizeExternalHashHistory(history),
    operatingEvidence: passedOperatingEvidence(),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: history,
      externalEffectiveHashrate: 2_400_000_000_000,
      externalWorkAssignable: true,
      externalMiningStartAllowed: false,
    }),
    releaseReviewApproved: true,
  });

  assert.equal(gate.status, "release_candidate");
  assert.equal(gate.releaseCandidateReady, true);
  assert.equal(gate.readinessScore, 86);
  assert.equal(gate.primaryBlockingCheck?.id, "engine_release_flag");
  assert.deepEqual(gate.missingCheckIds, ["engine_release_flag"]);
  assert.equal(gate.miningStartAllowed, false);
});
test("hardware release evidence dossier records missing gates and forbidden operations", () => {
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: telemetryOnlyContract(),
    externalHistory: summarizeExternalHashHistory([]),
    validationChecklist: deriveExternalHashEngineValidationChecklist(),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: [],
    }),
  });
  const dossier = createHashHardwareReleaseEvidenceDossier(gate);

  assert.equal(dossier.gateStatus, "blocked");
  assert.equal(dossier.miningStartAllowed, false);
  assert.ok(dossier.missingEvidenceIds.includes("protocol_contract"));
  assert.ok(dossier.requiredActions.some((action) => action.includes("protocol_contract")));
  assert.ok(dossier.forbiddenOperations.includes("external_start_mining"));
  assert.equal(dossier.evidenceItems.find((item) => item.id === "protocol_contract")?.missingEvidence?.includes("telemetry-only"), true);
});

test("hardware release evidence dossier keeps release candidates review-only", () => {
  const history = stableExternalHistory();
  const gate = deriveHashHardwareReleaseGate({
    protocolContract: dryRunContract(),
    externalHistory: summarizeExternalHashHistory(history),
    operatingEvidence: passedOperatingEvidence(),
    validationChecklist: deriveExternalHashEngineValidationChecklist(allValidationPassed),
    claimCertificate: createHashClaimCertificate({
      tuningObservations: [],
      externalHashHistory: history,
      externalEffectiveHashrate: 2_400_000_000_000,
      externalWorkAssignable: true,
      externalMiningStartAllowed: false,
    }),
  });
  const dossier = createHashHardwareReleaseEvidenceDossier(gate);

  assert.equal(dossier.gateStatus, "release_candidate");
  assert.equal(dossier.releaseCandidateReady, true);
  assert.equal(dossier.miningStartAllowed, false);
  assert.deepEqual(dossier.missingEvidenceIds, ["release_review", "engine_release_flag"]);
  assert.ok(dossier.forbiddenOperations.includes("automatic_release_approval"));
  assert.match(dossier.summary, /manual review/i);
});

import test from "node:test";
import assert from "node:assert/strict";

import { deriveHashHardwareMeasurementProtocol } from "../.test-dist/domain/hashHardwareMeasurementProtocol.js";

function dossier(overrides = {}) {
  return {
    schemaVersion: 1,
    gateStatus: "blocked",
    readinessScore: 0,
    releaseCandidateReady: false,
    miningStartAllowed: false,
    evidenceItems: [],
    missingEvidenceIds: [
      "protocol_contract",
      "external_stability_history",
      "hardware_operating_evidence",
      "external_work_validation",
      "claim_evidence",
      "release_review",
      "engine_release_flag",
    ],
    requiredActions: [],
    forbiddenOperations: [
      "external_start_mining",
      "app_controlled_external_job_routing",
      "external_pool_share_submission",
      "automatic_release_approval",
      "external_engine_release_flag_without_review",
    ],
    summary: "Release evidence dossier is incomplete.",
    nextStep: "Select Network for telemetry or keep Direct reserved until real hardware is available.",
    ...overrides,
  };
}

test("hardware measurement protocol starts telemetry-only adapters at interface selection", () => {
  const protocol = deriveHashHardwareMeasurementProtocol(dossier());

  assert.equal(protocol.schemaVersion, 1);
  assert.equal(protocol.primaryStep.id, "select_interface");
  assert.deepEqual(protocol.readyStepIds, ["select_interface"]);
  assert.ok(protocol.blockedStepIds.includes("collect_external_telemetry"));
  assert.ok(protocol.forbiddenOperations.includes("external_start_mining"));
  assert.match(protocol.primaryStep.successCriteria, /dry-run-only/i);
});

test("hardware measurement protocol moves to telemetry collection after protocol proof", () => {
  const protocol = deriveHashHardwareMeasurementProtocol(dossier({
    readinessScore: 20,
    missingEvidenceIds: [
      "external_stability_history",
      "hardware_operating_evidence",
      "external_work_validation",
      "claim_evidence",
      "release_review",
      "engine_release_flag",
    ],
  }));

  assert.equal(protocol.steps.find((step) => step.id === "select_interface")?.status, "done");
  assert.equal(protocol.primaryStep.id, "collect_external_telemetry");
  assert.equal(protocol.primaryStep.status, "ready");
  assert.equal(protocol.steps.find((step) => step.id === "prove_operating_evidence")?.status, "blocked");
  assert.equal(protocol.steps.find((step) => step.id === "prove_work_lease")?.status, "blocked");
  assert.match(protocol.primaryStep.successCriteria, /Six usable samples/i);
});

test("hardware measurement protocol proves operating evidence after stable telemetry", () => {
  const protocol = deriveHashHardwareMeasurementProtocol(dossier({
    readinessScore: 40,
    missingEvidenceIds: [
      "hardware_operating_evidence",
      "external_work_validation",
      "claim_evidence",
      "release_review",
      "engine_release_flag",
    ],
  }));

  assert.equal(protocol.steps.find((step) => step.id === "collect_external_telemetry")?.status, "done");
  assert.equal(protocol.primaryStep.id, "prove_operating_evidence");
  assert.equal(protocol.primaryStep.status, "ready");
  assert.match(protocol.primaryStep.successCriteria, /900 second sample/i);
});

test("hardware measurement protocol keeps release candidates in manual review only", () => {
  const protocol = deriveHashHardwareMeasurementProtocol(dossier({
    gateStatus: "release_candidate",
    readinessScore: 80,
    releaseCandidateReady: true,
    missingEvidenceIds: ["release_review", "engine_release_flag"],
    summary: "Release evidence dossier is ready for manual review.",
    nextStep: "Review hardware identity, wall power, thermals, work leases, stale rejection, pool share submission, and rollback behavior.",
  }));

  assert.equal(protocol.primaryStep.id, "review_release");
  assert.equal(protocol.primaryStep.status, "ready");
  assert.deepEqual(protocol.readyStepIds, ["review_release"]);
  assert.equal(protocol.steps.find((step) => step.id === "prove_operating_evidence")?.status, "done");
  assert.equal(protocol.steps.find((step) => step.id === "prove_work_lease")?.status, "done");
  assert.match(protocol.summary, /manual release review|engine-flag wiring/i);
  assert.ok(protocol.forbiddenOperations.includes("automatic_release_approval"));
});

test("hardware measurement protocol waits for engine release flag after review", () => {
  const protocol = deriveHashHardwareMeasurementProtocol(dossier({
    gateStatus: "release_candidate",
    readinessScore: 83,
    releaseCandidateReady: true,
    missingEvidenceIds: ["engine_release_flag"],
    summary: "Release review passed; engine release flag is missing.",
    nextStep: "Wire a reviewed, device-specific engine release flag.",
  }));

  assert.equal(protocol.primaryStep.id, "wire_engine_release_flag");
  assert.equal(protocol.primaryStep.status, "ready");
  assert.ok(protocol.forbiddenOperations.includes("external_start_mining"));
  assert.match(protocol.primaryStep.successCriteria, /off by default/i);
});
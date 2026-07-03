import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import {
  deriveExternalHashEngineValidationChecklist,
} from "../.test-dist/engines/externalHashEngineValidation.js";
import {
  deriveExternalHashWorkAdapterPlan,
  deriveExternalHashWorkLeaseAssignment,
  evaluateExternalHashWorkResult,
} from "../.test-dist/engines/externalHashWorkAdapter.js";
import { deriveExternalHashDryRunValidationInputs } from "../.test-dist/engines/externalHashDryRunValidation.js";

function telemetrySnapshot(overrides = {}) {
  return deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: overrides.host ?? "future-rack.local",
  }, {
    status: "ok",
    base_url: `http://${overrides.host ?? "future-rack.local"}`,
    device_name: overrides.device_name ?? "Future Partitioned Rack",
    hostname: overrides.host ?? "future-rack.local",
    hash_rate_hs: overrides.hash_rate_hs ?? 500_000_000_000_000,
    power_watts: overrides.power_watts ?? 10_000,
    joules_per_terahash: overrides.joules_per_terahash ?? 20,
    parallel_workers: overrides.parallel_workers ?? 4,
    temp_c: overrides.temp_c ?? 62,
    summary: overrides.summary ?? "Future rack telemetry: 500 TH/s across 4 workers",
  });
}

function engineSnapshot(overrides = {}) {
  const snapshot = telemetrySnapshot(overrides.telemetry ?? {});
  const capabilities = overrides.capabilities ?? [
    "telemetry",
    "powerTelemetry",
    "versionRolling",
    "workPartitioning",
    "jobControl",
    "shareSubmission",
  ];

  return {
    ...snapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: capabilities.includes("jobControl"),
    canSubmitShares: capabilities.includes("shareSubmission"),
    canRollVersion: capabilities.includes("versionRolling"),
    adapter: {
      ...snapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
}

test("external work adapter keeps telemetry-only network adapters read-only", () => {
  const snapshot = telemetrySnapshot({ hash_rate_hs: 1_200_000_000_000, power_watts: 18, joules_per_terahash: 15 });
  const plan = deriveExternalHashWorkAdapterPlan(snapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, { jobId: "job-1", generation: 1 });

  assert.equal(plan.status, "telemetry-only");
  assert.equal(plan.canAssignWork, false);
  assert.deepEqual(plan.missingCapabilities, ["jobControl", "shareSubmission"]);
  assert.match(plan.nextStep, /jobControl, shareSubmission/);
  assert.equal(assignment.status, "telemetry-only");
  assert.equal(assignment.canHash, false);
  assert.equal(assignment.leaseId, "");
});

test("external work adapter keeps direct endpoints reserved", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const plan = deriveExternalHashWorkAdapterPlan(snapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, { jobId: "job-1", generation: 1 });

  assert.equal(plan.status, "reserved");
  assert.equal(plan.canAssignWork, false);
  assert.equal(assignment.status, "reserved");
  assert.equal(assignment.endpoint, "COM7");
  assert.match(assignment.nextStep, /serial, USB, or HID/i);
});

test("external work adapter assigns unique mock leases for partitioned workers", () => {
  const snapshot = engineSnapshot();
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const plan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  const first = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-42",
    generation: 7,
    workerIndex: 0,
    issuedAtMs: 1_000,
  }, matrix);
  const second = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-42",
    generation: 7,
    workerIndex: 1,
    issuedAtMs: 1_000,
  }, matrix);

  assert.equal(plan.status, "assignable");
  assert.equal(plan.canAssignWork, true);
  assert.equal(first.status, "ready");
  assert.equal(first.canHash, true);
  assert.equal(first.parallelWorkers, 4);
  assert.equal(first.partitionBits, 32);
  assert.notEqual(first.leaseId, second.leaseId);
  assert.notEqual(first.partitionPrefixHex, second.partitionPrefixHex);
  assert.ok(first.controls.some((control) => control.assignment === "partition-prefix"));
  assert.ok(first.leaseSeconds && first.leaseSeconds > 1);
  assert.deepEqual(
    Object.fromEntries(first.validationInputs.map((input) => [input.kind, input.status])),
    { job_lifecycle: "passed", search_space_assignment: "passed", thermal_limits: "passed" },
  );
});

test("external work adapter validation evidence covers accepted and stale mock results", () => {
  const snapshot = engineSnapshot();
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-42",
    generation: 7,
    workerIndex: 2,
    issuedAtMs: 1_000,
  }, matrix);
  const accepted = evaluateExternalHashWorkResult(assignment, {
    leaseId: assignment.leaseId,
    jobId: "job-42",
    generation: 7,
    submittedAtMs: 2_000,
    shareAccepted: true,
  });
  const stale = evaluateExternalHashWorkResult(assignment, {
    leaseId: assignment.leaseId,
    jobId: "job-41",
    generation: 6,
    submittedAtMs: 2_000,
    shareAccepted: true,
  });
  const checklist = deriveExternalHashEngineValidationChecklist([
    ...assignment.validationInputs,
    ...accepted.validationInputs,
    ...stale.validationInputs,
  ]);

  assert.equal(accepted.status, "share-accepted");
  assert.equal(accepted.submitAllowed, true);
  assert.equal(stale.status, "stale");
  assert.equal(stale.submitAllowed, false);
  assert.equal(checklist.status, "passed");
  assert.deepEqual(checklist.missingChecks, []);
});

test("external work adapter blocks overlapping parallel leases", () => {
  const snapshot = engineSnapshot({
    capabilities: ["telemetry", "powerTelemetry", "jobControl", "shareSubmission"],
    telemetry: {
      hash_rate_hs: 1_200_000_000_000,
      power_watts: 18,
      joules_per_terahash: 15,
      parallel_workers: 4,
      summary: "Future miner telemetry: 1.2 TH/s across 4 workers",
    },
  });
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const plan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-unsafe",
    generation: 3,
    workerIndex: 1,
  }, matrix);

  assert.equal(matrix.workLease.status, "overlap-risk");
  assert.equal(plan.status, "blocked");
  assert.equal(plan.canAssignWork, false);
  assert.equal(plan.workLeaseUniquePartitionRatio, 0.25);
  assert.equal(plan.workLeaseRouteUtilizationRatio, matrix.workLease.routeUtilizationRatio);
  assert.deepEqual(plan.missingPerformanceCapabilities, ["versionRolling", "workPartitioning"]);
  assert.equal(assignment.canHash, false);
  assert.equal(assignment.validationInputs.length, 0);
  assert.match(assignment.nextStep, /versionRolling, workPartitioning/);
});
test("external work adapter blocks engine-capable adapters with high hash waste", () => {
  const snapshot = engineSnapshot({
    telemetry: {
      hash_rate_hs: 50_000_000_000_000_000_000,
      power_watts: 600_000,
      joules_per_terahash: 12,
      parallel_workers: 1,
      summary: "Extreme future rack telemetry: 50 EH/s with declared partitioning too small",
    },
  });
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const plan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-waste",
    generation: 1,
    workerIndex: 0,
  }, matrix);

  assert.equal(matrix.missingPerformanceCapabilities.length, 0);
  assert.equal(matrix.workLeaseWasteRisk, "high");
  assert.equal(plan.status, "blocked");
  assert.equal(plan.canAssignWork, false);
  assert.equal(plan.workLeaseWasteRisk, "high");
  assert.ok(plan.workLeaseUtilizationRatio !== null && plan.workLeaseUtilizationRatio < 1);
  assert.equal(plan.workLeaseUniquePartitionRatio, 1);
  assert.equal(plan.workLeaseRouteUtilizationRatio, plan.workLeaseUtilizationRatio);
  assert.equal(assignment.canHash, false);
  assert.equal(assignment.validationInputs.length, 0);
  assert.match(plan.nextStep, /waste risk high|lease is too short/i);
});

test("external dry-run validation inputs stop before share submission proof", () => {
  const snapshot = engineSnapshot();
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const inputs = deriveExternalHashDryRunValidationInputs(snapshot, matrix, {
    jobId: "job-dry-run",
    generation: 3,
    issuedAtMs: 1_000,
  });
  const checklist = deriveExternalHashEngineValidationChecklist(inputs);

  assert.deepEqual(checklist.passedChecks, ["job_lifecycle", "search_space_assignment", "stale_job_rejection", "thermal_limits"]);
  assert.deepEqual(checklist.missingChecks, ["share_submission"]);
  assert.equal(checklist.integrationReady, false);
  assert.equal(checklist.startAllowed, false);
});

test("external dry-run validation accepts only real external adapter share proof", () => {
  const snapshot = engineSnapshot();
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-proof",
    generation: 4,
    workerIndex: 0,
    issuedAtMs: 1_000,
  }, matrix);
  const inputs = deriveExternalHashDryRunValidationInputs(snapshot, matrix, {
    jobId: "job-proof",
    generation: 4,
    issuedAtMs: 1_000,
    shareProofs: [{
      source: "external_adapter",
      result: "accepted",
      leaseId: assignment.leaseId,
      jobId: assignment.jobId,
      generation: assignment.generation,
      submittedAtMs: 2_000,
      acceptedAtMs: 2_100,
      shareDifficulty: 4_096,
    }],
  });
  const checklist = deriveExternalHashEngineValidationChecklist(inputs);

  assert.equal(checklist.status, "passed");
  assert.deepEqual(checklist.missingChecks, []);
  assert.equal(checklist.integrationReady, true);
  assert.equal(checklist.startAllowed, false);
});

test("external dry-run validation rejects mock share proof as release evidence", () => {
  const snapshot = engineSnapshot();
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: "job-proof",
    generation: 4,
    workerIndex: 0,
    issuedAtMs: 1_000,
  }, matrix);
  const inputs = deriveExternalHashDryRunValidationInputs(snapshot, matrix, {
    jobId: "job-proof",
    generation: 4,
    issuedAtMs: 1_000,
    shareProofs: [{
      source: "mock",
      result: "accepted",
      leaseId: assignment.leaseId,
      jobId: assignment.jobId,
      generation: assignment.generation,
      submittedAtMs: 2_000,
      acceptedAtMs: 2_100,
      shareDifficulty: 4_096,
    }],
  });
  const checklist = deriveExternalHashEngineValidationChecklist(inputs);

  assert.equal(checklist.status, "warning");
  assert.deepEqual(checklist.warningChecks, ["share_submission"]);
  assert.equal(checklist.integrationReady, false);
  assert.equal(checklist.startAllowed, false);
});
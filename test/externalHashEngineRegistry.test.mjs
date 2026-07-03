import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveExternalHashSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";
import {
  resolveExternalHashEngineRegistry,
} from "../.test-dist/engines/externalHashEngineRegistry.js";
import {
  deriveExternalHashEngineValidationChecklist,
} from "../.test-dist/engines/externalHashEngineValidation.js";

function telemetrySnapshot(overrides = {}) {
  return deriveExternalHashSnapshot({
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
    ...overrides,
  });
}

function candidateSnapshot(overrides = {}) {
  const snapshot = telemetrySnapshot(overrides.telemetry ?? {});
  const capabilities = overrides.capabilities ?? ["telemetry", "powerTelemetry", "versionRolling", "jobControl", "shareSubmission"];

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

const allValidationPassed = deriveExternalHashEngineValidationChecklist([
  { kind: "job_lifecycle", status: "passed" },
  { kind: "search_space_assignment", status: "passed" },
  { kind: "stale_job_rejection", status: "passed" },
  { kind: "thermal_limits", status: "passed" },
  { kind: "share_submission", status: "passed" },
]);

test("external hash engine registry rejects telemetry-only adapters", () => {
  const decision = resolveExternalHashEngineRegistry(telemetrySnapshot());

  assert.equal(decision.status, "telemetry-only");
  assert.equal(decision.registerable, false);
  assert.equal(decision.startAllowed, false);
  assert.equal(decision.telemetryOnly, true);
  assert.equal(decision.entry, null);
  assert.deepEqual(decision.missingCapabilities, ["jobControl", "shareSubmission"]);
  assert.equal(decision.validation.status, "untested");
  assert.match(decision.summary, /telemetry-only/i);
});

test("external hash engine registry keeps direct endpoints reserved", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const decision = resolveExternalHashEngineRegistry(snapshot);

  assert.equal(decision.status, "reserved");
  assert.equal(decision.registerable, false);
  assert.equal(decision.startAllowed, false);
  assert.equal(decision.entry, null);
  assert.deepEqual(decision.missingCapabilities, ["telemetry", "jobControl", "shareSubmission"]);
});

test("external hash engine registry exposes only reserved candidates as entries", () => {
  const decision = resolveExternalHashEngineRegistry(candidateSnapshot());

  assert.equal(decision.status, "candidate");
  assert.equal(decision.registerable, true);
  assert.equal(decision.integrationReady, false);
  assert.equal(decision.startAllowed, false);
  assert.equal(decision.entry?.kind, "external-hash");
  assert.equal(decision.entry?.startAllowed, false);
  assert.equal(decision.entry?.validationRequired, true);
  assert.equal(decision.entry?.validationStatus, "untested");
  assert.equal(decision.entry?.efficiencyReady, true);
  assert.equal(decision.entry?.performanceReady, true);
  assert.deepEqual(decision.missingCapabilities, []);
  assert.match(decision.nextStep, /lifecycle/i);
});

test("external hash engine registry keeps start reserved even after validation passes", () => {
  const decision = resolveExternalHashEngineRegistry(
    candidateSnapshot(),
    undefined,
    undefined,
    allValidationPassed,
  );

  assert.equal(decision.status, "candidate");
  assert.equal(decision.registerable, true);
  assert.equal(decision.integrationReady, true);
  assert.equal(decision.startAllowed, false);
  assert.equal(decision.validation.integrationReady, true);
  assert.equal(decision.validation.startAllowed, false);
  assert.equal(decision.entry?.integrationReady, true);
  assert.equal(decision.entry?.validationRequired, false);
  assert.equal(decision.entry?.startAllowed, false);
  assert.match(decision.summary, /release review/i);
  assert.match(decision.nextStep, /reserved/i);
});

test("external hash engine registry preserves efficiency readiness warnings", () => {
  const decision = resolveExternalHashEngineRegistry(candidateSnapshot({
    telemetry: {
      device_name: "Future Miner",
      power_watts: null,
      joules_per_terahash: null,
      summary: "Future miner telemetry: 2 TH/s",
    },
    capabilities: ["telemetry", "versionRolling", "jobControl", "shareSubmission"],
  }));

  assert.equal(decision.status, "candidate");
  assert.equal(decision.registerable, true);
  assert.equal(decision.efficiencyReady, false);
  assert.equal(decision.performanceReady, true);
  assert.equal(decision.entry?.efficiencyReady, false);
  assert.deepEqual(decision.advisoryMissingCapabilities, ["powerTelemetry"]);
  assert.match(decision.summary, /power telemetry/i);
});

test("external hash engine registry preserves version rolling readiness warnings", () => {
  const decision = resolveExternalHashEngineRegistry(candidateSnapshot({
    capabilities: ["telemetry", "powerTelemetry", "jobControl", "shareSubmission"],
  }));

  assert.equal(decision.status, "candidate");
  assert.equal(decision.registerable, true);
  assert.equal(decision.efficiencyReady, true);
  assert.equal(decision.performanceReady, false);
  assert.equal(decision.entry?.performanceReady, false);
  assert.deepEqual(decision.advisoryMissingCapabilities, ["versionRolling"]);
  assert.match(decision.summary, /version rolling/i);
});
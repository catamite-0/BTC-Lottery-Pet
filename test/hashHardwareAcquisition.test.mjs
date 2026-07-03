import test from "node:test";
import assert from "node:assert/strict";

import {
  assessHashHardwareAcquisition,
} from "../.test-dist/domain/hashHardwareAcquisition.js";

test("hardware acquisition treats network devices as telemetry candidates first", () => {
  const assessment = assessHashHardwareAcquisition({
    goal: "max_efficiency",
    candidate: {
      label: "Network telemetry ASIC",
      interfaceKind: "network",
      hashrate: 1_200_000_000_000,
      watts: 18,
      canReadTelemetry: true,
      canReadPowerTelemetry: true,
      canControlJobs: false,
      canSubmitShares: false,
    },
  });

  assert.equal(assessment.decision, "telemetry_candidate");
  assert.equal(assessment.interfaceStage, "network_telemetry");
  assert.equal(assessment.efficiencyClass, "excellent");
  assert.equal(assessment.miningStartAllowed, false);
  assert.equal(assessment.releaseReady, false);
  assert.equal(assessment.joulesPerTerahash, 15);
  assert.ok(assessment.requiredEvidence.includes("network_endpoint_access"));
  assert.ok(assessment.requiredEvidence.includes("share_submission_dry_run"));
  assert.match(assessment.riskFlags.join(" "), /Job control is missing/i);
});

test("hardware acquisition keeps complete network devices as manual release candidates only", () => {
  const assessment = assessHashHardwareAcquisition({
    goal: "max_hashrate",
    referenceJoulesPerTerahash: 20,
    candidate: {
      label: "Future external engine",
      interfaceKind: "network",
      hashrate: 150_000_000_000_000,
      watts: 1_950,
      canReadTelemetry: true,
      canReadPowerTelemetry: true,
      canControlJobs: true,
      canSubmitShares: true,
      supportsVersionRolling: true,
      supportsWorkPartitioning: true,
      purchaseCostUsd: 2500,
    },
  });

  assert.equal(assessment.decision, "release_candidate");
  assert.equal(assessment.interfaceStage, "release_review");
  assert.equal(assessment.efficiencyClass, "excellent");
  assert.equal(assessment.releaseReady, true);
  assert.equal(assessment.miningStartAllowed, false);
  assert.equal(assessment.joulesPerTerahash, 13);
  assert.equal(Math.round(assessment.costPerTerahash), 17);
  assert.ok(assessment.requiredEvidence.includes("manual_release_review"));
  assert.match(assessment.nextStep, /manual release review/i);
});

test("hardware acquisition reserves direct devices until physical protocol is chosen", () => {
  const assessment = assessHashHardwareAcquisition({
    goal: "balanced",
    candidate: {
      label: "Direct prototype",
      interfaceKind: "direct",
      directEndpointKind: "hid",
      hashrate: 5_000_000_000_000,
      watts: 80,
      canReadTelemetry: true,
      canReadPowerTelemetry: true,
      canControlJobs: true,
      canSubmitShares: true,
      supportsVersionRolling: true,
      supportsWorkPartitioning: true,
    },
  });

  assert.equal(assessment.decision, "watch");
  assert.equal(assessment.interfaceStage, "direct_reserved");
  assert.equal(assessment.releaseReady, false);
  assert.equal(assessment.miningStartAllowed, false);
  assert.ok(assessment.requiredEvidence.includes("direct_read_only_probe"));
  assert.match(assessment.riskFlags.join(" "), /Direct interface is reserved/i);
  assert.match(assessment.nextStep, /serial, USB, HID, or vendor path/i);
});

test("hardware acquisition rejects candidates that break configured power or noise limits", () => {
  const assessment = assessHashHardwareAcquisition({
    goal: "lowest_power",
    maxWatts: 1000,
    maxNoiseDba: 55,
    candidate: {
      label: "Too loud and hungry",
      interfaceKind: "network",
      hashrate: 20_000_000_000_000,
      watts: 2200,
      noiseDba: 78,
      canReadTelemetry: true,
      canReadPowerTelemetry: true,
      canControlJobs: true,
      supportsVersionRolling: true,
      supportsWorkPartitioning: true,
    },
  });

  assert.equal(assessment.decision, "reject");
  assert.equal(assessment.miningStartAllowed, false);
  assert.match(assessment.riskFlags.join(" "), /Power draw exceeds/i);
  assert.match(assessment.riskFlags.join(" "), /Noise exceeds/i);
});

test("hardware acquisition watches incomplete devices instead of guessing specs", () => {
  const assessment = assessHashHardwareAcquisition({
    candidate: {
      label: "Unknown device",
      interfaceKind: "unknown",
    },
  });

  assert.equal(assessment.decision, "watch");
  assert.equal(assessment.interfaceStage, "missing");
  assert.equal(assessment.efficiencyClass, "unknown");
  assert.equal(assessment.hashrate, null);
  assert.equal(assessment.watts, null);
  assert.equal(assessment.joulesPerTerahash, null);
  assert.match(assessment.nextStep, /Choose Network telemetry/i);
});

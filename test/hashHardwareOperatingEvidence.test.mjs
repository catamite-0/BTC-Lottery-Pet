import test from "node:test";
import assert from "node:assert/strict";

import {
  assessHashHardwareOperatingEvidence,
  deriveHashHardwareOperatingEvidenceSamplesFromExternalHistory,
} from "../.test-dist/domain/hashHardwareOperatingEvidence.js";

function sample(overrides = {}) {
  return {
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
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    miningPaused: false,
    ...overrides,
  };
}

test("hash hardware operating evidence passes measured quiet stable samples", () => {
  const evidence = assessHashHardwareOperatingEvidence([sample()]);

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.releaseReady, true);
  assert.equal(evidence.usableSampleCount, 1);
  assert.equal(evidence.averageWallWatts, 32);
  assert.equal(evidence.effectiveHashrate, 2_400_000_000_000);
  assert.equal(evidence.bestJoulesPerTerahash, 13);
  assert.equal(Math.round(Number(evidence.effectiveJoulesPerTerahash)), 13);
  assert.equal(evidence.shareWasteRatio, 0);
  assert.deepEqual(evidence.missingEvidence, []);
});

test("hash hardware operating evidence stays provisional for estimated or short samples", () => {
  const evidence = assessHashHardwareOperatingEvidence([
    sample({
      durationSeconds: 120,
      powerEvidenceSource: "estimated",
    }),
  ]);

  assert.equal(evidence.status, "provisional");
  assert.equal(evidence.releaseReady, false);
  assert.ok(evidence.missingEvidence.includes("900 second runtime"));
  assert.ok(evidence.missingEvidence.includes("wall power or trusted power telemetry"));
});

test("hash hardware operating evidence fails noisy or waste-heavy samples", () => {
  const evidence = assessHashHardwareOperatingEvidence([
    sample({
      noiseDba: 72,
      acceptedShares: 4,
      rejectedShares: 2,
    }),
  ]);

  assert.equal(evidence.status, "failed");
  assert.equal(evidence.releaseReady, false);
  assert.ok(evidence.missingEvidence.includes("noise below configured limit"));
  assert.ok(evidence.missingEvidence.includes("low share waste"));
});

test("hash hardware operating evidence counts stale and queued drops as wasted hashes", () => {
  const evidence = assessHashHardwareOperatingEvidence([
    sample({
      acceptedShares: 19,
      rejectedShares: 0,
      staleSharesDropped: 1,
      queuedSharesDropped: 0,
    }),
  ]);

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.shareWasteRatio, 0.05);
  assert.equal(evidence.effectiveHashrate, 2_280_000_000_000);
  assert.ok(Number(evidence.effectiveJoulesPerTerahash) > 13);
});

test("hash hardware operating evidence derives provisional samples from external telemetry history", () => {
  const samples = deriveHashHardwareOperatingEvidenceSamplesFromExternalHistory([{
    generatedAt: "2026-07-02T00:00:00.000Z",
    endpoint: "http://bitaxe.local",
    status: "ok",
    hashrate: 2_000_000_000_000,
    watts: 30,
    joulesPerTerahash: 15,
    tempC: 58,
    vrTempC: 61,
    fanRpm: 4200,
    acceptedShares: 20,
    rejectedShares: 0,
    miningPaused: false,
  }]);
  const snapshot = assessHashHardwareOperatingEvidence(samples);

  assert.equal(samples.length, 1);
  assert.equal(samples[0].powerEvidenceSource, "trusted_device_telemetry");
  assert.equal(snapshot.status, "provisional");
  assert.equal(snapshot.releaseReady, false);
  assert.equal(snapshot.sampleCount, 1);
  assert.equal(snapshot.shareWasteRatio, 0);
  assert.equal(snapshot.primarySample?.durationSeconds, null);
  assert.equal(snapshot.missingEvidence.includes("900 second runtime"), true);
  assert.equal(snapshot.missingEvidence.includes("noise sample"), true);
});
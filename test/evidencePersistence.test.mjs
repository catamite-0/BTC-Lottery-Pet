import assert from "node:assert/strict";
import test from "node:test";
import {
  appendExternalOperatingEvidenceSample,
  appendTuningObservationHistory,
  createMiningEvidenceSnapshot,
  parseExternalHashHistoryStorageJson,
  parseExternalOperatingEvidenceStorageJson,
  parseMiningEvidenceSnapshotJson,
  parseTuningReplicationHistoryStorageJson,
  parseTuningObservationsStorageJson,
  sanitizeExternalHashHistoryForStorage,
  sanitizeExternalOperatingEvidenceForStorage,
  sanitizeTuningObservationHistoryForStorage,
  sanitizeTuningObservationsForStorage,
  serializeExternalHashHistoryForStorage,
  serializeExternalOperatingEvidenceForStorage,
  serializeMiningEvidenceSnapshot,
  serializeTuningReplicationHistoryForStorage,
  serializeTuningObservationsForStorage,
} from "../.test-dist/domain/evidencePersistence.js";

test("evidence persistence sanitizes tuning observations", () => {
  const observations = sanitizeTuningObservationsForStorage([
    { stepId: "eco", hashrate: 1_000, watts: 14.5, powerEvidenceStatus: "measured", acceptedShares: 2.9, sampleSeconds: 31 },
    { stepId: "bad", hashrate: 0, watts: 100 },
    { stepId: "eco", hashrate: 2_000, watts: -5, powerEvidenceStatus: "wrong", tempC: 42 },
  ]);

  assert.equal(observations.length, 1);
  assert.equal(observations[0].stepId, "eco");
  assert.equal(observations[0].hashrate, 2_000);
  assert.equal(observations[0].watts, null);
  assert.equal(observations[0].powerEvidenceStatus, null);
  assert.equal(observations[0].tempC, 42);
});

test("evidence persistence parses and serializes tuning arrays safely", () => {
  const serialized = serializeTuningObservationsForStorage([
    { stepId: "low", hashrate: 100, watts: 10, acceptedShares: 1 },
    { stepId: "", hashrate: 100 },
  ]);
  const parsed = parseTuningObservationsStorageJson(serialized);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].stepId, "low");
  assert.deepEqual(parseTuningObservationsStorageJson("{not json"), []);
});

test("evidence persistence keeps bounded local tuning replication history", () => {
  const history = sanitizeTuningObservationHistoryForStorage([
    { stepId: "eco", capturedAt: "2026-07-02T00:02:00.000Z", hashrate: 1_200, watts: 12, powerEvidenceStatus: "measured", acceptedShares: 5, rejectedShares: 0, sampleSeconds: 240 },
    { stepId: "eco", capturedAt: "2026-07-02T00:01:00.000Z", hashrate: 1_100, watts: 12, powerEvidenceStatus: "measured", acceptedShares: 4, rejectedShares: 0, sampleSeconds: 240 },
    { stepId: "eco", capturedAt: "2026-07-02T00:01:00.000Z", hashrate: 900, watts: 12, powerEvidenceStatus: "measured", acceptedShares: 4, rejectedShares: 0, sampleSeconds: 240 },
    { stepId: "bad", capturedAt: "2026-07-02T00:00:00.000Z", hashrate: 0, watts: 12 },
  ], 10);

  assert.equal(history.length, 2);
  assert.equal(history[0].capturedAt, "2026-07-02T00:02:00.000Z");
  assert.equal(history[1].capturedAt, "2026-07-02T00:01:00.000Z");
  assert.equal(history[1].hashrate, 1_100);

  const appended = appendTuningObservationHistory(
    history,
    { stepId: "eco", hashrate: 1_300, watts: 12, powerEvidenceStatus: "measured", acceptedShares: 6, rejectedShares: 0, sampleSeconds: 240 },
    "2026-07-02T00:03:00.000Z",
    2,
  );
  assert.equal(appended.length, 2);
  assert.equal(appended[0].capturedAt, "2026-07-02T00:03:00.000Z");

  const parsed = parseTuningReplicationHistoryStorageJson(serializeTuningReplicationHistoryForStorage(appended));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].hashrate, 1_300);
});
test("evidence persistence sanitizes external hash history newest first", () => {
  const history = sanitizeExternalHashHistoryForStorage([
    { generatedAt: "3", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_200_000_000_000, watts: 18, joulesPerTerahash: 15, fanRpm: 4200 },
    { generatedAt: "2", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 20, joulesPerTerahash: 18 },
    { generatedAt: "2", endpoint: "http://bitaxe.local", status: "ok", hashrate: 900_000_000_000, watts: 22, joulesPerTerahash: 24 },
    { generatedAt: "", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1 },
  ]);

  assert.equal(history.length, 2);
  assert.equal(history[0].generatedAt, "3");
  assert.equal(history[0].fanRpm, 4200);
  assert.equal(history[1].generatedAt, "2");
  assert.equal(history[1].hashrate, 1_100_000_000_000);
});

test("evidence persistence parses external history arrays safely", () => {
  const serialized = serializeExternalHashHistoryForStorage([
    { generatedAt: "1", endpoint: "http://bitaxe.local", status: "failed", hashrate: 0, watts: null, joulesPerTerahash: null },
  ]);
  const parsed = parseExternalHashHistoryStorageJson(serialized);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].status, "failed");
  assert.deepEqual(parseExternalHashHistoryStorageJson("[]"), []);
  assert.deepEqual(parseExternalHashHistoryStorageJson("{not json"), []);
});

test("evidence persistence creates versioned combined snapshots", () => {
  const snapshot = createMiningEvidenceSnapshot(
    [{ stepId: "balanced", hashrate: 500, watts: 12 }],
    [{ generatedAt: "1", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1, watts: 1, joulesPerTerahash: 1 }],
    "2026-07-01T00:00:00.000Z",
  );
  const roundTrip = parseMiningEvidenceSnapshotJson(serializeMiningEvidenceSnapshot(snapshot));

  assert.equal(roundTrip.version, 1);
  assert.equal(roundTrip.savedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(roundTrip.tuningObservations.length, 1);
  assert.equal(roundTrip.externalHashHistory.length, 1);
});

test("evidence persistence sanitizes external operating evidence", () => {
  const samples = sanitizeExternalOperatingEvidenceForStorage([
    {
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
      acceptedShares: 6,
      rejectedShares: 0,
      staleSharesDropped: 1,
      queuedSharesDropped: 0,
      miningPaused: false,
    },
    { generatedAt: "bad", hashrate: 0, wallWatts: 1 },
    { generatedAt: "bad2", hashrate: 1, powerEvidenceSource: "unknown", noiseDba: 999 },
  ], 2);

  assert.equal(samples.length, 2);
  assert.equal(samples[0].durationSeconds, 900);
  assert.equal(samples[0].powerEvidenceSource, "wall_meter");
  assert.equal(samples[0].noiseDba, 42);
  assert.equal(samples[0].staleSharesDropped, 1);
  assert.equal(samples[1].powerEvidenceSource, null);
  assert.equal(samples[1].noiseDba, null);

  const appended = appendExternalOperatingEvidenceSample(
    samples,
    { hashrate: 3_000_000_000_000, durationSeconds: 901, wallWatts: 35, powerEvidenceSource: "trusted_device_telemetry" },
    "2026-07-02T00:16:00.000Z",
    2,
  );
  assert.equal(appended.length, 2);
  assert.equal(appended[0].generatedAt, "2026-07-02T00:16:00.000Z");
  assert.equal(appended[0].hashrate, 3_000_000_000_000);

  const parsed = parseExternalOperatingEvidenceStorageJson(serializeExternalOperatingEvidenceForStorage(appended));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].durationSeconds, 901);
  assert.deepEqual(parseExternalOperatingEvidenceStorageJson("{not json"), []);
});

test("evidence persistence includes external operating evidence in combined snapshots", () => {
  const snapshot = createMiningEvidenceSnapshot(
    [{ stepId: "balanced", hashrate: 500, watts: 12 }],
    [{ generatedAt: "1", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1, watts: 1, joulesPerTerahash: 1 }],
    "2026-07-01T00:00:00.000Z",
    [{ stepId: "balanced", hashrate: 500, watts: 12 }],
    [{ generatedAt: "2", durationSeconds: 900, hashrate: 2_400_000_000_000, wallWatts: 32, powerEvidenceSource: "wall_meter", noiseDba: 42, acceptedShares: 4, rejectedShares: 0 }],
  );
  const roundTrip = parseMiningEvidenceSnapshotJson(serializeMiningEvidenceSnapshot(snapshot));

  assert.equal(roundTrip.version, 1);
  assert.equal(roundTrip.externalHashHistory.length, 1);
  assert.equal(roundTrip.externalOperatingEvidence.length, 1);
  assert.equal(roundTrip.externalOperatingEvidence[0].durationSeconds, 900);
});
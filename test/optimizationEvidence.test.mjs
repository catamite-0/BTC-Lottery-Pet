import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
  createOptimizationEvidenceSnapshot,
  formatOptimizationEvidenceSnapshot,
} from "../.test-dist/domain/optimizationEvidence.js";

function stableRuntime() {
  return {
    sampleSeconds: OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
    tempC: 55,
    vrTempC: 60,
    fanRpm: 3200,
    miningPaused: false,
  };
}

test("optimization evidence summarizes local measured power and proven share events", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_500_000,
        watts: 18,
        powerEvidenceStatus: "measured",
        acceptedShares: 3,
        rejectedShares: 0,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
      {
        stepId: "hash",
        hashrate: 5_000_000,
        watts: 45,
        powerEvidenceStatus: "estimated",
        acceptedShares: 1,
      },
    ],
    externalHashHistory: [],
  });

  assert.equal(snapshot.localTuning.sampleCount, 2);
  assert.equal(snapshot.localTuning.measuredPowerSampleCount, 1);
  assert.equal(snapshot.localTuning.estimatedPowerSampleCount, 1);
  assert.equal(snapshot.localTuning.provenShareSampleCount, 1);
  assert.equal(snapshot.localTuning.totalShareEvents, 4);
  assert.equal(snapshot.localTuning.bestHashrate, 5_000_000);
  assert.equal(snapshot.localTuning.bestRawHashrate, 5_000_000);
  assert.equal(snapshot.localTuning.bestEffectiveHashrate, 5_000_000);
  assert.equal(snapshot.localTuning.lowestMeasuredWatts, 18);
  assert.equal(snapshot.localTuning.powerEvidenceStatus, "ready");
  assert.equal(snapshot.localTuning.shareEvidenceStatus, "ready");
  assert.equal(snapshot.operatingPlan.qualifiedCandidateCount, 3);
  assert.equal(snapshot.operatingPlan.primaryCandidate?.stepId, "eco");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.status, "qualified");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.stabilityWindowStatus, "stable");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.thermalStatus, "cool");
  assert.equal(snapshot.operatingPlan.candidates.find((candidate) => candidate.goal === "max_hashrate")?.status, "provisional");
  assert.equal(snapshot.readinessHints.localEvidenceReady, true);
});

test("optimization evidence summarizes external efficiency without raw endpoints", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: [
      { generatedAt: "3", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_200_000_000_000, watts: 18, joulesPerTerahash: 15, tempC: 61, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "2", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 20, joulesPerTerahash: 18, tempC: 62, vrTempC: 71, fanRpm: 3200 },
      { generatedAt: "1", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_000_000_000_000, watts: 22, joulesPerTerahash: 22, tempC: 63, vrTempC: 72, fanRpm: 3200 },
    ],
  });
  const formatted = formatOptimizationEvidenceSnapshot(snapshot);

  assert.equal(snapshot.externalHash.sampleCount, 3);
  assert.equal(snapshot.externalHash.onlineSampleCount, 3);
  assert.equal(snapshot.externalHash.efficiencySampleCount, 3);
  assert.equal(snapshot.externalHash.usableEfficiencySampleCount, 3);
  assert.equal(snapshot.externalHash.externalEvidenceReady, true);
  assert.equal(snapshot.externalHash.externalEvidenceGap, 0);
  assert.equal(snapshot.externalHash.endpointRecorded, true);
  assert.equal(snapshot.externalHash.bestJoulesPerTerahash, 15);
  assert.equal(snapshot.externalHash.efficiencyEvidenceStatus, "ready");
  assert.equal(formatted.includes("bitaxe.local"), false);
  assert.match(snapshot.privacyNote, /excludes BTC address/i);
});

test("optimization evidence treats degrading external efficiency as not ready", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_500_000,
        watts: 18,
        powerEvidenceStatus: "measured",
        acceptedShares: 3,
        rejectedShares: 0,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
    ],
    externalHashHistory: [
      { generatedAt: "6", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 30, joulesPerTerahash: 30, tempC: 62, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "5", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 29, joulesPerTerahash: 29, tempC: 62, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "4", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 28, joulesPerTerahash: 28, tempC: 62, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "3", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 18, joulesPerTerahash: 18, tempC: 62, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "2", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 17, joulesPerTerahash: 17, tempC: 62, vrTempC: 70, fanRpm: 3200 },
      { generatedAt: "1", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 16, joulesPerTerahash: 16, tempC: 62, vrTempC: 70, fanRpm: 3200 },
    ],
  });
  const formatted = formatOptimizationEvidenceSnapshot(snapshot);

  assert.equal(snapshot.externalHash.externalEvidenceReady, true);
  assert.equal(snapshot.externalHash.trend, "degrading");
  assert.equal(snapshot.externalHash.efficiencyEvidenceStatus, "thin");
  assert.equal(snapshot.readinessHints.externalEfficiencyReady, false);
  assert.match(snapshot.readinessHints.nextEvidenceGap, /stops degrading/i);
  assert.equal(formatted.includes("bitaxe.local"), false);
});

test("optimization evidence points to the next missing evidence gate", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_500_000,
        watts: 18,
        powerEvidenceStatus: "estimated",
        acceptedShares: 1,
      },
    ],
    externalHashHistory: [],
  });

  assert.equal(snapshot.localTuning.powerEvidenceStatus, "missing");
  assert.equal(snapshot.localTuning.shareEvidenceStatus, "thin");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.status, "provisional");
  assert.match(snapshot.operatingPlan.primaryCandidate?.summary ?? "", /measured watts missing/i);
  assert.match(snapshot.readinessHints.nextEvidenceGap, /measured/i);
});

test("optimization evidence keeps short measured samples provisional", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_500_000,
        watts: 18,
        powerEvidenceStatus: "measured",
        acceptedShares: 3,
        rejectedShares: 0,
        sampleSeconds: 120,
        tempC: 55,
        vrTempC: 60,
        fanRpm: 3200,
        miningPaused: false,
      },
    ],
    externalHashHistory: [],
  });
  const primary = snapshot.operatingPlan.primaryCandidate;

  assert.equal(snapshot.localTuning.powerEvidenceStatus, "ready");
  assert.equal(snapshot.localTuning.shareEvidenceStatus, "ready");
  assert.equal(snapshot.operatingPlan.qualifiedCandidateCount, 0);
  assert.equal(primary?.status, "provisional");
  assert.equal(primary?.stabilityWindowStatus, "probing");
  assert.match(primary?.summary ?? "", /runtime/i);
  assert.match(snapshot.readinessHints.nextEvidenceGap, /15 minute runtime/i);
});

test("optimization evidence keeps hot or paused samples provisional", () => {
  const hotSnapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "hot-gpu",
        hashrate: 9_000_000,
        watts: 55,
        powerEvidenceStatus: "measured",
        acceptedShares: 5,
        rejectedShares: 0,
        sampleSeconds: OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
        tempC: 83,
        vrTempC: 96,
        fanRpm: 4500,
        miningPaused: false,
      },
    ],
    externalHashHistory: [],
  });
  const pausedSnapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "paused-asic",
        hashrate: 9_000_000,
        watts: 55,
        powerEvidenceStatus: "measured",
        acceptedShares: 5,
        rejectedShares: 0,
        sampleSeconds: OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
        tempC: 55,
        vrTempC: 60,
        fanRpm: 3200,
        miningPaused: true,
      },
    ],
    externalHashHistory: [],
  });

  assert.equal(hotSnapshot.operatingPlan.qualifiedCandidateCount, 0);
  assert.equal(hotSnapshot.operatingPlan.primaryCandidate?.thermalStatus, "hot");
  assert.match(hotSnapshot.operatingPlan.primaryCandidate?.summary ?? "", /thermal headroom/i);
  assert.equal(pausedSnapshot.operatingPlan.qualifiedCandidateCount, 0);
  assert.equal(pausedSnapshot.operatingPlan.primaryCandidate?.thermalStatus, "paused");
  assert.match(pausedSnapshot.operatingPlan.primaryCandidate?.summary ?? "", /thermal state unsafe/i);
});

test("optimization evidence can focus the primary candidate on the preferred goal", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    preferredGoal: "max_hashrate",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_000_000,
        watts: 15,
        powerEvidenceStatus: "measured",
        acceptedShares: 4,
        rejectedShares: 0,
        ...stableRuntime(),
      },
      {
        stepId: "turbo",
        hashrate: 9_000_000,
        watts: 55,
        powerEvidenceStatus: "estimated",
        acceptedShares: 5,
        rejectedShares: 0,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
    ],
    externalHashHistory: [],
  });

  assert.equal(snapshot.operatingPlan.preferredGoal, "max_hashrate");
  assert.equal(snapshot.operatingPlan.qualifiedCandidateCount, 1);
  assert.equal(snapshot.operatingPlan.primaryCandidate?.goal, "max_hashrate");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.stepId, "turbo");
  assert.equal(snapshot.operatingPlan.primaryCandidate?.status, "provisional");
  assert.match(snapshot.operatingPlan.summary, /preferred max hashrate/);
  assert.match(snapshot.readinessHints.nextEvidenceGap, /measured watts missing/i);
});
test("optimization evidence can qualify a highest-hash operating point", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    tuningObservations: [
      {
        stepId: "eco",
        hashrate: 2_000_000,
        watts: 15,
        powerEvidenceStatus: "measured",
        acceptedShares: 4,
        rejectedShares: 0,
        ...stableRuntime(),
      },
      {
        stepId: "turbo",
        hashrate: 9_000_000,
        watts: 55,
        powerEvidenceStatus: "measured",
        acceptedShares: 5,
        rejectedShares: 0,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
    ],
    externalHashHistory: [],
  });
  const maxHash = snapshot.operatingPlan.candidates.find((candidate) => candidate.goal === "max_hashrate");

  assert.equal(maxHash?.stepId, "turbo");
  assert.equal(maxHash?.status, "qualified");
  assert.equal(maxHash?.hashrate, 9_000_000);
  assert.equal(maxHash?.rawHashrate, 9_000_000);
  assert.equal(maxHash?.effectiveHashrate, 9_000_000);
  assert.equal(maxHash?.measuredPower, true);
  assert.equal(maxHash?.sampleSeconds, OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS);
  assert.match(snapshot.operatingPlan.summary, /qualified/);
});
test("optimization evidence ranks useful hashrate below noisy raw hashrate", () => {
  const snapshot = createOptimizationEvidenceSnapshot({
    generatedAt: "2026-07-01T00:00:00.000Z",
    preferredGoal: "max_hashrate",
    tuningObservations: [
      {
        stepId: "steady",
        hashrate: 5_000_000,
        watts: 20,
        powerEvidenceStatus: "measured",
        acceptedShares: 5,
        rejectedShares: 0,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
      {
        stepId: "noisy-raw",
        hashrate: 20_000_000,
        watts: 30,
        powerEvidenceStatus: "measured",
        acceptedShares: 1,
        rejectedShares: 9,
        staleSharesDropped: 0,
        queuedSharesDropped: 0,
        ...stableRuntime(),
      },
    ],
    externalHashHistory: [],
  });
  const maxHash = snapshot.operatingPlan.candidates.find((candidate) => candidate.goal === "max_hashrate");

  assert.equal(snapshot.localTuning.bestHashrate, 5_000_000);
  assert.equal(snapshot.localTuning.bestRawHashrate, 20_000_000);
  assert.equal(snapshot.localTuning.bestEffectiveHashrate, 5_000_000);
  assert.equal(maxHash?.stepId, "steady");
  assert.equal(maxHash?.hashrate, 5_000_000);
  assert.equal(maxHash?.rawHashrate, 5_000_000);
  assert.equal(maxHash?.effectiveHashrate, 5_000_000);
  assert.equal(snapshot.operatingPlan.primaryCandidate?.stepId, "steady");
});

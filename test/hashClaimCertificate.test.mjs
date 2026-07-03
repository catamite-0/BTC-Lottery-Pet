import test from "node:test";
import assert from "node:assert/strict";

import {
  createHashClaimCertificate,
  formatHashClaimCertificate,
} from "../.test-dist/domain/hashClaimCertificate.js";
import { OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS } from "../.test-dist/domain/optimizationEvidence.js";

function stableRuntime() {
  return {
    sampleSeconds: OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
    tempC: 55,
    vrTempC: 60,
    fanRpm: 3200,
    miningPaused: false,
  };
}
function provenLocalObservations() {
  return [
    {
      stepId: "eco",
      hashrate: 2_000_000,
      watts: 15,
      powerEvidenceStatus: "measured",
      acceptedShares: 4,
      rejectedShares: 0,
      staleSharesDropped: 0,
      queuedSharesDropped: 0,
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
  ];
}

function replicatedHistory(observations = provenLocalObservations()) {
  return observations.flatMap((observation, index) => [
    { ...observation, capturedAt: `2026-07-02T00:${String(index).padStart(2, "0")}:01.000Z` },
    { ...observation, capturedAt: `2026-07-02T00:${String(index).padStart(2, "0")}:02.000Z` },
  ]);
}
function externalHistorySamples(count, overrides = {}) {
  const joules = overrides.joulesPerTerahash ?? Array.from({ length: count }, () => 15);
  return Array.from({ length: count }, (_, index) => ({
    generatedAt: String(count - index),
    endpoint: "http://future-rack.local",
    status: "ok",
    hashrate: overrides.hashrate ?? 1_200_000_000_000,
    watts: overrides.watts ?? 18,
    joulesPerTerahash: Array.isArray(joules) ? joules[index] : joules,
    tempC: overrides.tempC ?? 58,
    vrTempC: overrides.vrTempC ?? 62,
    fanRpm: overrides.fanRpm ?? 4200,
    acceptedShares: 10 + index,
    rejectedShares: 0,
    miningPaused: false,
  }));
}
function marginalDecision(status, overrides = {}) {
  return {
    status,
    summary: `Marginal density status is ${status}.`,
    nextStep: "Keep the density lane until marginal evidence clears.",
    densityRetentionRatio: null,
    ...overrides,
  };
}
test("hash claim certificate starts with missing low-power and high-hash claims", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: [],
  });

  assert.equal(certificate.lowestPower.status, "missing");
  assert.equal(certificate.lowestPower.claimAllowed, false);
  assert.equal(certificate.lowestPower.scope, "none");
  assert.deepEqual(certificate.lowestPower.missingEvidence, ["matching local tuning sample"]);
  assert.equal(certificate.lowestPower.nextAction, "open_settings");
  assert.equal(certificate.nextAction, "open_settings");
  assert.equal(certificate.highestHash.status, "missing");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.match(certificate.summary, /lowest power missing/);
});

test("hash claim certificate keeps local claims provisional after only one stable sample", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: provenLocalObservations(),
    externalHashHistory: [],
  });

  assert.equal(certificate.lowestPower.status, "provisional");
  assert.equal(certificate.lowestPower.scope, "local");
  assert.equal(certificate.lowestPower.claimAllowed, false);
  assert.equal(certificate.lowestPower.candidateStepId, "eco");
  assert.equal(certificate.lowestPower.observedReplications, 1);
  assert.equal(certificate.lowestPower.requiredReplications, 2);
  assert.equal(certificate.lowestPower.missingEvidence.includes("1 more independent same-profile sample"), true);
  assert.equal(certificate.highestHash.status, "provisional");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.observedReplications, 1);
  assert.equal(certificate.lowestPower.nextAction, "run_stability_window");
  assert.equal(certificate.nextAction, "run_stability_window");
});

test("hash claim certificate proves local claims only after repeated measured same-profile evidence", () => {
  const observations = provenLocalObservations();
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: observations,
    tuningHistory: replicatedHistory(observations),
    externalHashHistory: [],
  });

  assert.equal(certificate.lowestPower.status, "proven");
  assert.equal(certificate.lowestPower.scope, "local");
  assert.equal(certificate.lowestPower.claimAllowed, true);
  assert.equal(certificate.lowestPower.candidateStepId, "eco");
  assert.equal(certificate.lowestPower.observedReplications, 2);
  assert.equal(certificate.highestHash.status, "proven");
  assert.equal(certificate.highestHash.scope, "local");
  assert.equal(certificate.highestHash.claimAllowed, true);
  assert.equal(certificate.highestHash.candidateStepId, "turbo");
  assert.equal(certificate.highestHash.hashrate, 9_000_000);
  assert.equal(certificate.highestHash.rawHashrate, 9_000_000);
  assert.equal(certificate.highestHash.effectiveHashrate, 9_000_000);
  assert.equal(certificate.highestHash.hashrateBasis, "effective");
  assert.equal(certificate.highestHash.observedReplications, 2);
  assert.equal(certificate.lowestPower.nextAction, "monitor");
  assert.equal(certificate.highestHash.nextAction, "monitor");
  assert.equal(certificate.nextAction, "monitor");
  assert.equal(certificate.localQualifiedCandidateCount >= 2, true);
});

test("hash claim certificate keeps highest-hash provisional until marginal density is measured", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: provenLocalObservations(),
    tuningHistory: replicatedHistory(),
    externalHashHistory: [],
    marginalDecision: marginalDecision("measure"),
  });

  assert.equal(certificate.lowestPower.status, "proven");
  assert.equal(certificate.highestHash.status, "provisional");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.marginalDecisionStatus, "measure");
  assert.equal(certificate.highestHash.missingEvidence.includes("marginal hashes per watt measurement"), true);
  assert.equal(certificate.highestHash.nextAction, "measure_power");
  assert.equal(certificate.nextAction, "measure_power");
  assert.equal(certificate.marginalDecisionStatus, "measure");
});

test("hash claim certificate blocks highest-hash when marginal density says hold", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: provenLocalObservations(),
    tuningHistory: replicatedHistory(),
    externalHashHistory: [],
    marginalDecision: marginalDecision("hold", { densityRetentionRatio: 0.32 }),
  });

  assert.equal(certificate.lowestPower.status, "proven");
  assert.equal(certificate.lowestPower.claimAllowed, true);
  assert.equal(certificate.highestHash.status, "blocked");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.marginalDecisionStatus, "hold");
  assert.equal(certificate.highestHash.marginalDensityRetentionRatio, 0.32);
  assert.equal(certificate.highestHash.missingEvidence.includes("marginal hash-density decision is hold"), true);
  assert.equal(certificate.highestHash.nextAction, "open_settings");
  assert.match(certificate.nextStep, /density lane/i);
});

test("hash claim certificate allows highest-hash when marginal density says advance", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: provenLocalObservations(),
    tuningHistory: replicatedHistory(),
    externalHashHistory: [],
    marginalDecision: marginalDecision("advance", { densityRetentionRatio: 0.68 }),
  });

  assert.equal(certificate.highestHash.status, "proven");
  assert.equal(certificate.highestHash.claimAllowed, true);
  assert.equal(certificate.highestHash.marginalDecisionStatus, "advance");
  assert.equal(certificate.highestHash.marginalDensityRetentionRatio, 0.68);
  assert.equal(certificate.highestHash.missingEvidence.length, 0);
  assert.equal(certificate.nextAction, "monitor");
  assert.equal(certificate.marginalDecisionStatus, "advance");
});
test("hash claim certificate keeps external references provisional until stable telemetry target", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: externalHistorySamples(3),
    externalEffectiveHashrate: 1_200_000_000_000,
    externalWorkAssignable: true,
    externalMiningStartAllowed: true,
  });

  assert.equal(certificate.externalEvidenceReady, true);
  assert.equal(certificate.highestHash.scope, "external_reference");
  assert.equal(certificate.highestHash.status, "provisional");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.observedReplications, 3);
  assert.equal(certificate.highestHash.requiredReplications, 6);
  assert.equal(certificate.highestHash.missingEvidence.includes("3 more stable external efficiency samples"), true);
  assert.equal(certificate.highestHash.nextAction, "collect_telemetry");
});

test("hash claim certificate proves external references only after stable telemetry and release gates", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: externalHistorySamples(6),
    externalEffectiveHashrate: 1_200_000_000_000,
    externalWorkAssignable: true,
    externalMiningStartAllowed: true,
  });

  assert.equal(certificate.lowestPower.scope, "external_reference");
  assert.equal(certificate.lowestPower.status, "proven");
  assert.equal(certificate.highestHash.scope, "external_reference");
  assert.equal(certificate.highestHash.status, "proven");
  assert.equal(certificate.highestHash.claimAllowed, true);
  assert.equal(certificate.highestHash.observedReplications, 6);
  assert.equal(certificate.highestHash.requiredReplications, 6);
  assert.equal(certificate.highestHash.hashrate, 1_200_000_000_000);
  assert.equal(certificate.highestHash.rawHashrate, 1_200_000_000_000);
  assert.equal(certificate.highestHash.effectiveHashrate, 1_200_000_000_000);
  assert.equal(certificate.highestHash.hashrateBasis, "effective");
  assert.deepEqual(certificate.highestHash.missingEvidence, []);
  assert.equal(certificate.nextAction, "monitor");
});

test("hash claim certificate blocks external references when efficiency trend degrades", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: externalHistorySamples(6, { joulesPerTerahash: [22, 21, 20, 15, 14, 13] }),
    externalEffectiveHashrate: 1_200_000_000_000,
    externalWorkAssignable: true,
    externalMiningStartAllowed: true,
  });

  assert.equal(certificate.highestHash.scope, "external_reference");
  assert.equal(certificate.highestHash.status, "blocked");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.missingEvidence.includes("non-degrading external efficiency trend"), true);
});
test("hash claim certificate reports missing effective external hashrate proof", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [],
    externalHashHistory: externalHistorySamples(6),
    externalEffectiveHashrate: null,
    externalWorkAssignable: true,
    externalMiningStartAllowed: true,
  });

  assert.equal(certificate.highestHash.scope, "external_reference");
  assert.equal(certificate.highestHash.status, "blocked");
  assert.equal(certificate.highestHash.hashrate, null);
  assert.equal(certificate.highestHash.rawHashrate, 1_200_000_000_000);
  assert.equal(certificate.highestHash.effectiveHashrate, null);
  assert.equal(certificate.highestHash.hashrateBasis, "unknown");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.missingEvidence.includes("external work assignment effective hashrate"), true);
  assert.equal(certificate.highestHash.nextAction, "prove_external_work");
});
test("hash claim certificate discounts raw external hashrate when effective route is lower", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: provenLocalObservations(),
    tuningHistory: replicatedHistory(),
    externalHashHistory: externalHistorySamples(6, { hashrate: 50_000_000_000_000 }),
    externalEffectiveHashrate: 1_000_000,
    externalWorkAssignable: true,
    externalMiningStartAllowed: true,
    marginalDecision: marginalDecision("advance"),
  });

  assert.equal(certificate.highestHash.scope, "local");
  assert.equal(certificate.highestHash.status, "proven");
  assert.equal(certificate.highestHash.hashrate, 9_000_000);
  assert.equal(certificate.highestHash.claimAllowed, true);
});
test("hash claim certificate blocks stronger external references until work routing is proven", () => {
  const certificate = createHashClaimCertificate({
    generatedAt: "2026-07-02T00:00:00.000Z",
    tuningObservations: [
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
    externalHashHistory: [
      { generatedAt: "3", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_200_000_000_000, watts: 18, joulesPerTerahash: 15, tempC: 58, vrTempC: 62, fanRpm: 4200 },
      { generatedAt: "2", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_100_000_000_000, watts: 20, joulesPerTerahash: 18, tempC: 59, vrTempC: 63, fanRpm: 4200 },
      { generatedAt: "1", endpoint: "http://bitaxe.local", status: "ok", hashrate: 1_000_000_000_000, watts: 22, joulesPerTerahash: 22, tempC: 60, vrTempC: 64, fanRpm: 4200 },
    ],
    externalWorkAssignable: false,
    externalMiningStartAllowed: false,
  });
  const formatted = formatHashClaimCertificate(certificate);

  assert.equal(certificate.externalEvidenceReady, true);
  assert.equal(certificate.highestHash.scope, "external_reference");
  assert.equal(certificate.highestHash.status, "blocked");
  assert.equal(certificate.highestHash.claimAllowed, false);
  assert.equal(certificate.highestHash.missingEvidence.includes("external work assignment"), true);
  assert.equal(certificate.highestHash.missingEvidence.includes("external mining release gate"), true);
  assert.equal(certificate.highestHash.nextAction, "prove_external_work");
  assert.equal(certificate.nextAction, "prove_external_work");
  assert.equal(formatted.includes("bitaxe.local"), false);
  assert.equal(formatted.includes("http://"), false);
});
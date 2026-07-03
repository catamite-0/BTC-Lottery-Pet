import test from "node:test";
import assert from "node:assert/strict";

import {
  assessHashHardwareCandidate,
  rankHashHardwareCandidates,
} from "../.test-dist/domain/hashHardwareAdvisor.js";

const engineReady = {
  interfaceKind: "network",
  supportsTelemetry: true,
  supportsPowerTelemetry: true,
  supportsJobControl: true,
  supportsShareSubmission: true,
  supportsVersionRolling: true,
  supportsWorkPartitioning: true,
};

test("hash hardware advisor ranks efficient engine-capable candidates first", () => {
  const ranked = rankHashHardwareCandidates([
    {
      id: "telemetry-home",
      label: "Telemetry Home ASIC",
      interfaceKind: "network",
      hashrate: 1_200_000_000_000,
      watts: 18,
      supportsTelemetry: true,
      supportsPowerTelemetry: true,
    },
    {
      id: "engine-efficient",
      label: "Engine Efficient ASIC",
      hashrate: 2_400_000_000_000,
      watts: 32,
      parallelWorkers: 2,
      ...engineReady,
    },
    {
      id: "pc-gpu",
      label: "PC GPU",
      interfaceKind: "unknown",
      hashrate: 500_000_000,
      watts: 45,
      supportsTelemetry: false,
      supportsPowerTelemetry: false,
    },
  ], "max_efficiency");

  assert.equal(ranked[0].id, "engine-efficient");
  assert.equal(ranked[0].status, "qualified");
  assert.equal(ranked[0].canRouteWork, true);
  assert.equal(ranked[0].miningStartAllowed, false);
  assert.equal(ranked[1].status, "telemetry-only");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("hash hardware advisor keeps direct candidates reserved", () => {
  const assessment = assessHashHardwareCandidate({
    id: "direct-prototype",
    label: "Direct Prototype",
    interfaceKind: "direct",
    hashrate: 5_000_000_000_000,
    watts: 75,
    supportsTelemetry: true,
    supportsPowerTelemetry: true,
    supportsJobControl: true,
    supportsShareSubmission: true,
    supportsVersionRolling: true,
    supportsWorkPartitioning: true,
  }, "balanced");

  assert.equal(assessment.status, "reserved");
  assert.equal(assessment.canRouteWork, false);
  assert.equal(assessment.miningStartAllowed, false);
  assert.ok(assessment.score <= 55);
  assert.match(assessment.nextStep, /Direct endpoint protocol/i);
  assert.match(assessment.riskFlags.join(" "), /Direct protocol is reserved/i);
});

test("hash hardware advisor requires search-space controls for highest-hash candidates", () => {
  const missingControls = assessHashHardwareCandidate({
    id: "fast-no-rolling",
    label: "Fast No Rolling",
    interfaceKind: "network",
    hashrate: 300_000_000_000_000,
    watts: 4_500,
    supportsTelemetry: true,
    supportsPowerTelemetry: true,
    supportsJobControl: true,
    supportsShareSubmission: true,
  }, "max_hashrate");
  const partitioned = assessHashHardwareCandidate({
    id: "fast-partitioned",
    label: "Fast Partitioned",
    interfaceKind: "network",
    hashrate: 300_000_000_000_000,
    watts: 4_500,
    parallelWorkers: 8,
    ...engineReady,
  }, "max_hashrate");

  assert.equal(missingControls.status, "provisional");
  assert.equal(missingControls.searchSpace.requiresVersionRolling, true);
  assert.match(missingControls.nextStep, /version rolling/i);
  assert.equal(partitioned.status, "qualified");
  assert.equal(partitioned.workLease.overlapRisk, "low");
  assert.ok(partitioned.score > missingControls.score);
});
test("hash hardware advisor discounts high hashrate when lease utilization would waste work", () => {
  const ranked = rankHashHardwareCandidates([
    {
      id: "extreme-waste",
      label: "Extreme Waste Rack",
      interfaceKind: "network",
      hashrate: 50_000_000_000_000_000_000,
      watts: 250_000,
      ...engineReady,
    },
    {
      id: "safe-partitioned",
      label: "Safe Partitioned Rack",
      interfaceKind: "network",
      hashrate: 500_000_000_000_000,
      watts: 6_500,
      parallelWorkers: 4,
      ...engineReady,
    },
  ], "max_hashrate");
  const waste = ranked.find((candidate) => candidate.id === "extreme-waste");
  const safe = ranked.find((candidate) => candidate.id === "safe-partitioned");

  assert.equal(ranked[0].id, "safe-partitioned");
  assert.equal(safe?.status, "qualified");
  assert.equal(safe?.hashWasteRisk, "none");
  assert.equal(waste?.status, "provisional");
  assert.equal(waste?.hashWasteRisk, "high");
  assert.equal(waste?.canRouteWork, false);
  assert.ok(waste && waste.effectiveHashrate < waste.hashrate);
  assert.equal(
    Math.round(waste?.joulesPerTerahash ?? 0),
    Math.round(250_000 * 1_000_000_000_000 / Number(waste?.effectiveHashrate ?? 1)),
  );
  assert.ok(waste && waste.score <= 55);
  assert.match(waste?.riskFlags.join(" ") ?? "", /Hash waste risk is high/i);
  assert.match(waste?.nextStep ?? "", /work partitioning|lease/i);
});


test("hash hardware advisor discounts overlap even when nonce lifetime is long", () => {
  const assessment = assessHashHardwareCandidate({
    id: "slow-overlap",
    label: "Slow Overlap Adapter",
    interfaceKind: "network",
    hashrate: 1_000,
    watts: 10,
    supportsTelemetry: true,
    supportsPowerTelemetry: true,
    supportsJobControl: true,
    supportsShareSubmission: true,
    parallelWorkers: 4,
  }, "max_efficiency");

  assert.equal(assessment.workLease.leaseUtilizationRatio, 1);
  assert.equal(assessment.workLease.uniquePartitionRatio, 0.25);
  assert.equal(assessment.workLeaseUtilizationRatio, 0.25);
  assert.equal(assessment.workLeaseUniquePartitionRatio, 0.25);
  assert.equal(assessment.workLeaseRouteUtilizationRatio, 0.25);
  assert.equal(assessment.effectiveHashrate, 250);
  assert.equal(assessment.status, "provisional");
  assert.equal(assessment.hashWasteRisk, "high");
  assert.match(assessment.riskFlags.join(" "), /overlap risk is high/i);
  assert.match(assessment.riskFlags.join(" "), /only 25.0% of parallel work is unique/i);
  assert.match(assessment.reasons.join(" "), /unique partition 25.0%/i);
});

test("hash hardware advisor keeps unknown power from winning lowest-power ranking", () => {
  const ranked = rankHashHardwareCandidates([
    {
      id: "unknown-power-fast",
      label: "Unknown Power Fast",
      interfaceKind: "network",
      hashrate: 20_000_000_000_000,
      supportsTelemetry: true,
      supportsPowerTelemetry: false,
      supportsJobControl: true,
      supportsShareSubmission: true,
      supportsVersionRolling: true,
      supportsWorkPartitioning: true,
    },
    {
      id: "measured-low-power",
      label: "Measured Low Power",
      interfaceKind: "network",
      hashrate: 1_200_000_000_000,
      watts: 18,
      supportsTelemetry: true,
      supportsPowerTelemetry: true,
      supportsJobControl: true,
      supportsShareSubmission: true,
      supportsVersionRolling: true,
      supportsWorkPartitioning: true,
    },
  ], "lowest_power");

  assert.equal(ranked[0].id, "measured-low-power");
  assert.equal(ranked[0].status, "qualified");
  assert.equal(ranked[1].status, "provisional");
  assert.match(ranked[1].riskFlags.join(" "), /Power or J\/TH evidence is missing/i);
});
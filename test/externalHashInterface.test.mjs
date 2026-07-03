import test from "node:test";
import assert from "node:assert/strict";

import {
  clampExternalHashPollInterval,
  compareExternalEfficiency,
  createExternalHashDiagnosticSnapshot,
  deriveExternalHashAdapterContract,
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashDirectProtocolPlan,
  deriveExternalHashEngineCandidateGate,
  deriveExternalHashInterfaceSpec,
  deriveExternalHashPollingPlan,
  deriveExternalHashProtocolContract,
  deriveExternalHashSnapshot,
  deriveExternalHashTransportPlan,
  formatExternalHashDiagnosticSnapshot,
} from "../.test-dist/domain/externalHashInterface.js";

test("external hash adapter contract keeps network telemetry separate from mining engines", () => {
  const contract = deriveExternalHashAdapterContract({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  });

  assert.equal(contract.adapterId, "network-telemetry");
  assert.equal(contract.endpoint, "http://bitaxe.local");
  assert.equal(contract.endpointKind, "http");
  assert.equal(contract.status, "ready");
  assert.equal(contract.integrationStage, "telemetry-only");
  assert.deepEqual(contract.capabilities, ["telemetry"]);
  assert.equal(contract.engineEligible, false);
  assert.match(contract.nextIntegrationStep, /share submission remain local/);

  const transport = deriveExternalHashTransportPlan({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  });
  assert.equal(transport.transportKind, "network-http");
  assert.equal(transport.status, "telemetry-ready");
  assert.equal(transport.canProbeTelemetry, true);
  assert.equal(transport.canControlJobs, false);
  assert.equal(transport.canSubmitShares, false);
  assert.equal(transport.miningStartAllowed, false);
  assert.ok(transport.requiredProof.includes("share_submission"));
});

test("external hash adapter contract records direct endpoints without enabling engines", () => {
  const serialContract = deriveExternalHashAdapterContract({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  });
  const hidContract = deriveExternalHashAdapterContract({
    external_hash_interface: "direct",
    external_hash_direct_port: "hid://miner-1",
  });
  const futureEndpointContract = deriveExternalHashAdapterContract({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
    external_hash_direct_endpoint: " usb://miner-1 ",
  });

  assert.equal(serialContract.adapterId, "direct-reserved");
  assert.equal(serialContract.endpointKind, "serial");
  assert.equal(serialContract.status, "reserved");
  assert.equal(serialContract.engineEligible, false);
  assert.deepEqual(serialContract.capabilities, []);
  assert.equal(hidContract.endpointKind, "hid");
  assert.equal(futureEndpointContract.endpoint, "usb://miner-1");
  assert.equal(futureEndpointContract.endpointKind, "usb");

  const transport = deriveExternalHashTransportPlan({
    external_hash_interface: "direct",
    external_hash_direct_port: "hid://miner-1",
  });
  assert.equal(transport.transportKind, "direct-hid");
  assert.equal(transport.status, "reserved");
  assert.equal(transport.canProbeTelemetry, false);
  assert.equal(transport.canControlJobs, false);
  assert.equal(transport.canSubmitShares, false);
  assert.equal(transport.miningStartAllowed, false);
  assert.ok(transport.requiredProof.includes("endpoint_access"));
});

test("external hash direct protocol plan chooses read-only probe by endpoint shape", () => {
  const serial = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  });
  const usb = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "direct",
    external_hash_direct_endpoint: "usb://miner-1",
  });
  const hid = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "direct",
    external_hash_direct_endpoint: "hid://miner-1",
  });
  const path = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "direct",
    external_hash_direct_endpoint: "\\\\.\\USB0",
  });
  const missing = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "direct",
  });
  const network = deriveExternalHashDirectProtocolPlan({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  });

  assert.equal(serial.status, "reserved");
  assert.equal(serial.endpointKind, "serial");
  assert.equal(serial.preferredProbe, "serial");
  assert.equal(serial.canProbeEndpointAccess, true);
  assert.equal(serial.miningStartAllowed, false);
  assert.ok(serial.requiredProof.includes("endpoint_access"));
  assert.match(serial.nextStep, /read-only serial/i);

  assert.equal(usb.preferredProbe, "usb");
  assert.match(usb.nextStep, /USB descriptor/i);
  assert.equal(hid.preferredProbe, "hid");
  assert.match(hid.nextStep, /HID report/i);
  assert.equal(path.preferredProbe, "path");
  assert.match(path.nextStep, /vendor\/path/i);
  assert.equal(missing.status, "waiting-for-endpoint");
  assert.equal(missing.canProbeEndpointAccess, false);
  assert.equal(network.status, "not-selected");
  assert.deepEqual(network.requiredProof, []);
});
test("external hash polling plan clamps intervals and stays manual by default", () => {
  const manual = deriveExternalHashPollingPlan({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
    external_hash_poll_interval_seconds: 5,
  });

  assert.equal(clampExternalHashPollInterval(5), 30);
  assert.equal(clampExternalHashPollInterval(7_200), 3_600);
  assert.equal(clampExternalHashPollInterval(Number.NaN), 60);
  assert.equal(manual.status, "manual");
  assert.equal(manual.enabled, false);
  assert.equal(manual.canPoll, false);
  assert.equal(manual.intervalSeconds, 30);
});

test("external hash polling plan enables only network hosts", () => {
  const ready = deriveExternalHashPollingPlan({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
    external_hash_polling_enabled: true,
    external_hash_poll_interval_seconds: 120,
  });
  const missingHost = deriveExternalHashPollingPlan({
    external_hash_interface: "network",
    external_hash_polling_enabled: true,
  });
  const direct = deriveExternalHashPollingPlan({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
    external_hash_polling_enabled: true,
  });

  assert.equal(ready.status, "ready");
  assert.equal(ready.canPoll, true);
  assert.equal(ready.intervalSeconds, 120);
  assert.equal(missingHost.status, "missing-endpoint");
  assert.equal(missingHost.canPoll, false);
  assert.equal(direct.status, "reserved");
  assert.equal(direct.enabled, false);
  assert.equal(direct.canPoll, false);
});

test("external hash interface keeps direct mode as a reserved endpoint", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
    external_hash_polling_enabled: true,
  }, null);

  assert.equal(snapshot.interfaceKind, "direct");
  assert.equal(snapshot.status, "reserved");
  assert.equal(snapshot.adapter.endpointKind, "serial");
  assert.equal(snapshot.adapter.engineEligible, false);
  assert.equal(snapshot.polling.status, "reserved");
  assert.equal(snapshot.polling.canPoll, false);
  assert.equal(snapshot.canReadTelemetry, false);
  assert.equal(snapshot.canControlMining, false);
  assert.equal(snapshot.canSubmitShares, false);
  assert.equal(snapshot.integrationStage, "reserved");
  assert.deepEqual(snapshot.capabilities, []);
  assert.equal(snapshot.endpoint, "COM7");
  assert.equal(snapshot.transport.transportKind, "direct-serial");
  assert.equal(snapshot.transport.status, "reserved");
});

test("external hash interface turns network telemetry into an efficiency snapshot", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
    external_hash_polling_enabled: true,
    external_hash_poll_interval_seconds: 90,
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Gamma",
    hostname: "bitaxe.local",
    hash_rate_hs: 525_000_000_000,
    power_watts: 14,
    joules_per_terahash: 26.7,
    summary: "ASIC telemetry: 525 GH/s at 14 W",
  });

  assert.equal(snapshot.interfaceKind, "network");
  assert.equal(snapshot.status, "online");
  assert.equal(snapshot.telemetryOnline, true);
  assert.equal(snapshot.polling.status, "ready");
  assert.equal(snapshot.polling.canPoll, true);
  assert.equal(snapshot.polling.intervalSeconds, 90);
  assert.equal(snapshot.canControlMining, false);
  assert.equal(snapshot.canSubmitShares, false);
  assert.equal(snapshot.adapter.engineEligible, false);
  assert.equal(snapshot.integrationStage, "telemetry-only");
  assert.deepEqual(snapshot.capabilities, ["telemetry", "powerTelemetry"]);
  assert.deepEqual(snapshot.adapter.capabilities, ["telemetry", "powerTelemetry"]);
  assert.equal(snapshot.transport.transportKind, "network-http");
  assert.equal(snapshot.transport.status, "telemetry-ready");
  assert.equal(snapshot.hashrate, 525_000_000_000);
  assert.equal(snapshot.watts, 14);
  assert.equal(snapshot.joulesPerTerahash, 26.7);
});

test("external hash interface exposes network thermal guard", () => {
  const snapshot = deriveExternalHashSnapshot({
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
    temp_c: 83,
    vr_temp_c: 96,
    fan_rpm: 4500,
    mining_paused: false,
  });

  assert.equal(snapshot.thermalStatus, "hot");
  assert.ok(snapshot.thermalWeight < 1);
  assert.ok(snapshot.thermalSummary.includes("hot profile"));
});

test("external efficiency comparison explains when external hash wins", () => {
  const external = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Gamma",
    hostname: "bitaxe.local",
    hash_rate_hs: 525_000_000_000,
    power_watts: 14,
    joules_per_terahash: 26.7,
    summary: "ASIC telemetry: 525 GH/s at 14 W",
  });

  const comparison = compareExternalEfficiency(external, 1_500_000);
  assert.equal(comparison.status, "external-better");
  assert.ok(comparison.ratio > 50_000);
});
test("external hash capability matrix gates telemetry-only network adapters", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, null);
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const statuses = Object.fromEntries(matrix.rows.map((row) => [row.capability, row.status]));

  assert.equal(matrix.canReadTelemetry, true);
  assert.equal(matrix.canCompareEfficiency, false);
  assert.equal(matrix.canControlMining, false);
  assert.equal(matrix.canSubmitShares, false);
  assert.equal(matrix.engineEligible, false);
  assert.equal(statuses.telemetry, "available");
  assert.equal(statuses.powerTelemetry, "waiting");
  assert.equal(statuses.versionRolling, "blocked");
  assert.equal(statuses.workPartitioning, "blocked");
  assert.equal(statuses.jobControl, "blocked");
  assert.equal(statuses.shareSubmission, "blocked");
  assert.deepEqual(matrix.missingEngineCapabilities, ["jobControl", "shareSubmission"]);
  assert.deepEqual(matrix.missingEfficiencyCapabilities, ["powerTelemetry"]);
  assert.deepEqual(matrix.missingPerformanceCapabilities, []);
  assert.equal(matrix.searchSpace.status, "waiting");
});

test("external hash capability matrix allows efficiency comparison when power telemetry exists", () => {
  const snapshot = deriveExternalHashSnapshot({
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
  });
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const powerRow = matrix.rows.find((row) => row.capability === "powerTelemetry");

  assert.equal(matrix.canReadTelemetry, true);
  assert.equal(matrix.canCompareEfficiency, true);
  assert.equal(matrix.engineEligible, false);
  assert.equal(matrix.searchSpace.requiresVersionRolling, true);
  assert.deepEqual(matrix.missingEngineCapabilities, ["jobControl", "shareSubmission"]);
  assert.deepEqual(matrix.missingEfficiencyCapabilities, []);
  assert.deepEqual(matrix.missingPerformanceCapabilities, ["versionRolling"]);
  assert.equal(powerRow?.status, "available");
  assert.match(matrix.summary, /search space needs version rolling/i);
});

test("external hash capability matrix keeps direct endpoints fully reserved", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);

  assert.equal(matrix.engineEligible, false);
  assert.equal(matrix.canReadTelemetry, false);
  assert.equal(matrix.canCompareEfficiency, false);
  assert.deepEqual(matrix.rows.map((row) => row.status), [
    "reserved",
    "reserved",
    "reserved",
    "reserved",
    "reserved",
    "reserved",
  ]);
  assert.deepEqual(matrix.missingEngineCapabilities, ["telemetry", "jobControl", "shareSubmission"]);
  assert.deepEqual(matrix.missingPerformanceCapabilities, []);
  assert.match(matrix.summary, /reserved/i);
});
test("external hash engine candidate gate keeps telemetry-only adapters out", () => {
  const snapshot = deriveExternalHashSnapshot({
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
  });
  const gate = deriveExternalHashEngineCandidateGate(snapshot);

  assert.equal(gate.status, "telemetry-only");
  assert.equal(gate.eligible, false);
  assert.equal(gate.efficiencyReady, true);
  assert.deepEqual(gate.missingCapabilities, ["jobControl", "shareSubmission"]);
  assert.match(gate.nextStep, /jobControl, shareSubmission/);
});

test("external hash engine candidate gate stays reserved for direct endpoints", () => {
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const gate = deriveExternalHashEngineCandidateGate(snapshot);

  assert.equal(gate.status, "reserved");
  assert.equal(gate.eligible, false);
  assert.deepEqual(gate.missingCapabilities, ["telemetry", "jobControl", "shareSubmission"]);
  assert.match(gate.nextStep, /physical protocol/i);
});

test("external hash engine candidate gate opens only after engine capabilities are declared", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
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
  });
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: capabilities.includes("versionRolling"),
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot);

  assert.equal(gate.status, "candidate");
  assert.equal(gate.eligible, true);
  assert.equal(gate.efficiencyReady, true);
  assert.equal(gate.performanceReady, true);
  assert.deepEqual(gate.missingCapabilities, []);
  assert.deepEqual(gate.advisoryMissingCapabilities, []);
  assert.match(gate.nextStep, /stale-job rejection/);
});

test("external hash engine candidate gate warns when power telemetry is missing", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Future Miner",
    hostname: "future-miner.local",
    hash_rate_hs: 2_000_000_000_000,
    power_watts: null,
    joules_per_terahash: null,
    summary: "Future miner telemetry: 2 TH/s",
  });
  const capabilities = ["telemetry", "versionRolling", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: capabilities.includes("versionRolling"),
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot);

  assert.equal(gate.status, "candidate");
  assert.equal(gate.eligible, true);
  assert.equal(gate.efficiencyReady, false);
  assert.deepEqual(gate.missingCapabilities, []);
  assert.deepEqual(gate.advisoryMissingCapabilities, ["powerTelemetry"]);
  assert.match(gate.summary, /power telemetry is still needed/i);
});

test("external hash engine candidate gate warns when version rolling is missing", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Future Miner",
    hostname: "future-miner.local",
    hash_rate_hs: 2_000_000_000_000,
    power_watts: 40,
    joules_per_terahash: 20,
    summary: "Future miner telemetry: 2 TH/s at 40 W",
  });
  const capabilities = ["telemetry", "powerTelemetry", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: false,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot);

  assert.equal(gate.status, "candidate");
  assert.equal(gate.eligible, true);
  assert.equal(gate.efficiencyReady, true);
  assert.equal(gate.performanceReady, false);
  assert.deepEqual(gate.missingCapabilities, []);
  assert.deepEqual(gate.advisoryMissingCapabilities, ["versionRolling"]);
  assert.match(gate.summary, /version rolling/i);
  assert.match(gate.nextStep, /version rolling/i);
});

test("external hash capability matrix asks for work partitioning above version rolling search space", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-miner.local",
  }, {
    status: "ok",
    base_url: "http://future-miner.local",
    device_name: "Future Rack Miner",
    hostname: "future-miner.local",
    hash_rate_hs: 500_000_000_000_000,
    power_watts: 10_000,
    joules_per_terahash: 20,
    summary: "Future rack telemetry: 500 TH/s at 10 kW",
  });
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: true,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const matrix = deriveExternalHashCapabilityMatrix(engineSnapshot);
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot, matrix);

  assert.equal(matrix.canPartitionWork, false);
  assert.equal(matrix.searchSpace.requiresVersionRolling, false);
  assert.equal(matrix.searchSpace.requiresExtranonce, true);
  assert.deepEqual(matrix.missingPerformanceCapabilities, ["workPartitioning"]);
  assert.equal(gate.performanceReady, false);
  assert.deepEqual(gate.advisoryMissingCapabilities, ["workPartitioning"]);
  assert.match(gate.nextStep, /work partitioning/i);
});
test("external hash capability matrix blocks overlapping parallel work leases", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-miner.local",
  }, {
    status: "ok",
    base_url: "http://future-miner.local",
    device_name: "Future Multi Worker Miner",
    hostname: "future-miner.local",
    hash_rate_hs: 1_200_000_000_000,
    power_watts: 18,
    joules_per_terahash: 15,
    parallel_workers: 4,
    summary: "Future miner telemetry: 1.2 TH/s across 4 workers",
  });
  const capabilities = ["telemetry", "powerTelemetry", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: false,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const matrix = deriveExternalHashCapabilityMatrix(engineSnapshot);
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot, matrix);

  assert.equal(telemetrySnapshot.parallelWorkers, 4);
  assert.equal(matrix.workLease.status, "overlap-risk");
  assert.equal(matrix.workLease.hashWasteRisk, "high");
  assert.equal(matrix.workLeaseWasteRisk, "high");
  assert.ok(matrix.workLease.routeUtilizationRatio !== null && matrix.workLease.routeUtilizationRatio < Number(matrix.workLease.leaseUtilizationRatio));
  assert.equal(matrix.workLeaseUtilizationRatio, matrix.workLease.routeUtilizationRatio);
  assert.equal(matrix.workLeaseUniquePartitionRatio, matrix.workLease.uniquePartitionRatio);
  assert.equal(matrix.workLeaseRouteUtilizationRatio, matrix.workLease.routeUtilizationRatio);
  assert.equal(matrix.workLeaseReady, false);
  assert.equal(matrix.workLease.requiresWorkPartitioning, true);
  assert.deepEqual(matrix.missingPerformanceCapabilities, ["versionRolling", "workPartitioning"]);
  assert.equal(gate.performanceReady, false);
  assert.deepEqual(gate.advisoryMissingCapabilities, ["versionRolling", "workPartitioning"]);
  assert.match(gate.summary, /Work lease/);
});

test("external hash capability matrix accepts safe parallel work leases", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-rack.local",
  }, {
    status: "ok",
    base_url: "http://future-rack.local",
    device_name: "Future Partitioned Rack",
    hostname: "future-rack.local",
    hash_rate_hs: 500_000_000_000_000,
    power_watts: 10_000,
    joules_per_terahash: 20,
    parallel_workers: 4,
    summary: "Future rack telemetry: 500 TH/s across 4 workers",
  });
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: true,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const matrix = deriveExternalHashCapabilityMatrix(engineSnapshot);
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot, matrix);

  assert.equal(matrix.workLease.parallelWorkers, 4);
  assert.equal(matrix.workLeaseReady, true);
  assert.equal(matrix.workLease.overlapRisk, "low");
  assert.equal(matrix.workLeaseWasteRisk, "none");
  assert.equal(matrix.workLeaseUtilizationRatio, 1);
  assert.equal(matrix.workLeaseUniquePartitionRatio, 1);
  assert.equal(matrix.workLeaseRouteUtilizationRatio, 1);
  assert.deepEqual(matrix.missingPerformanceCapabilities, []);
  assert.equal(gate.performanceReady, true);
  assert.match(gate.summary, /safe work lease/i);
});

test("external hash capability matrix reports hash waste when declared partitioning is too small", () => {
  const telemetrySnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-rack.local",
  }, {
    status: "ok",
    base_url: "http://future-rack.local",
    device_name: "Future Extreme Rack",
    hostname: "future-rack.local",
    hash_rate_hs: 50_000_000_000_000_000_000,
    power_watts: 250_000,
    joules_per_terahash: 5,
    summary: "Future rack telemetry: 50 EH/s",
  });
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"];
  const engineSnapshot = {
    ...telemetrySnapshot,
    integrationStage: "hash-engine",
    capabilities,
    canControlMining: true,
    canSubmitShares: true,
    canRollVersion: true,
    adapter: {
      ...telemetrySnapshot.adapter,
      integrationStage: "hash-engine",
      capabilities,
      engineEligible: true,
    },
  };
  const matrix = deriveExternalHashCapabilityMatrix(engineSnapshot);
  const gate = deriveExternalHashEngineCandidateGate(engineSnapshot, matrix);
  const spec = deriveExternalHashInterfaceSpec(engineSnapshot, matrix, gate);

  assert.equal(matrix.missingPerformanceCapabilities.length, 0);
  assert.equal(matrix.workLeaseWasteRisk, "high");
  assert.equal(matrix.workLeaseReady, false);
  assert.equal(gate.performanceReady, false);
  assert.equal(spec.dryRunWorkAllowed, false);
  assert.match(gate.summary, /waste risk high/i);
  assert.match(gate.nextStep, /lease utilization is safe/i);
});
test("external hash interface spec separates network telemetry from direct endpoint probing", () => {
  const networkSnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe",
    hostname: "bitaxe.local",
    hash_rate_hs: 1_200_000_000_000,
    power_watts: 18,
    joules_per_terahash: 15,
    summary: "ASIC telemetry: 1.2 TH/s at 18 W",
  });
  const networkSpec = deriveExternalHashInterfaceSpec(networkSnapshot);
  const networkContract = deriveExternalHashProtocolContract(networkSpec, deriveExternalHashCapabilityMatrix(networkSnapshot));

  assert.equal(networkSpec.transportKind, "network-http");
  assert.equal(networkSpec.stage, "telemetry-reference");
  assert.equal(networkSpec.readOnlyProbeAllowed, true);
  assert.equal(networkSpec.telemetryReferenceAllowed, true);
  assert.equal(networkSpec.dryRunWorkAllowed, false);
  assert.equal(networkSpec.miningStartAllowed, false);
  assert.ok(networkSpec.validationOrder.includes("share_submission"));
  assert.ok(networkSpec.blockedBy.includes("Job Control"));
  assert.equal(networkContract.stage, "telemetry-only");
  assert.equal(networkContract.networkTelemetryOnly, true);
  assert.deepEqual(networkContract.allowedOperations, ["endpoint_access", "read_telemetry", "read_power"]);
  assert.ok(networkContract.blockedOperations.includes("control_jobs"));
  assert.ok(networkContract.blockedOperations.includes("submit_shares"));
  assert.ok(networkContract.blockedOperations.includes("start_mining"));

  const directSnapshot = deriveExternalHashSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const directSpec = deriveExternalHashInterfaceSpec(directSnapshot);
  const directContract = deriveExternalHashProtocolContract(directSpec, deriveExternalHashCapabilityMatrix(directSnapshot));

  assert.equal(directSpec.transportKind, "direct-serial");
  assert.equal(directSpec.stage, "read-only-probe");
  assert.equal(directSpec.readOnlyProbeAllowed, true);
  assert.equal(directSpec.telemetryReferenceAllowed, false);
  assert.equal(directSpec.dryRunWorkAllowed, false);
  assert.equal(directSpec.miningStartAllowed, false);
  assert.ok(directSpec.blockedBy.includes("endpoint access"));
  assert.match(directSpec.nextStep, /serial identity handshake/i);
  assert.equal(directContract.stage, "reserved-direct");
  assert.equal(directContract.directReserved, true);
  assert.equal(directContract.directProbeTarget, "serial");
  assert.deepEqual(directContract.allowedOperations, ["endpoint_access"]);
  assert.ok(directContract.blockedOperations.includes("read_telemetry"));
  assert.ok(directContract.blockedOperations.includes("start_mining"));
});

test("external hash diagnostic snapshot redacts raw endpoints while preserving interface gates", () => {
  const networkDiagnostic = createExternalHashDiagnosticSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "bitaxe.local",
    external_hash_polling_enabled: true,
    external_hash_poll_interval_seconds: 90,
  }, {
    status: "ok",
    base_url: "http://bitaxe.local",
    device_name: "Bitaxe Gamma",
    hostname: "bitaxe.local",
    hash_rate_hs: 525_000_000_000,
    power_watts: 14,
    joules_per_terahash: 26.7,
    summary: "ASIC telemetry: 525 GH/s at 14 W",
  });
  const networkText = formatExternalHashDiagnosticSnapshot(networkDiagnostic);

  assert.equal(networkDiagnostic.interfaceKind, "network");
  assert.equal(networkDiagnostic.endpointKind, "http");
  assert.equal(networkDiagnostic.interfaceStage, "telemetry-reference");
  assert.equal(networkDiagnostic.pollingStatus, "ready");
  assert.equal(networkDiagnostic.telemetryOnline, true);
  assert.equal(networkDiagnostic.hashrate, 525_000_000_000);
  assert.equal(networkDiagnostic.miningStartAllowed, false);
  assert.equal(networkDiagnostic.protocolContract.stage, "telemetry-only");
  assert.equal(networkDiagnostic.workLeaseWasteRisk, "high");
  assert.ok(networkDiagnostic.workLeaseUtilizationRatio !== null && networkDiagnostic.workLeaseUtilizationRatio < 0.01);
  assert.equal(networkDiagnostic.workLeaseUniquePartitionRatio, 1);
  assert.equal(networkDiagnostic.workLeaseRouteUtilizationRatio, networkDiagnostic.workLeaseUtilizationRatio);
  assert.ok(networkDiagnostic.protocolContract.blockedOperations.includes("start_mining"));
  assert.ok(!networkText.includes("bitaxe.local"));
  assert.ok(!networkText.includes("http://"));
  assert.ok(networkText.includes("workLeaseWasteRisk"));
  assert.ok(networkText.includes("workLeaseRouteUtilizationRatio"));

  const directDiagnostic = createExternalHashDiagnosticSnapshot({
    external_hash_interface: "direct",
    external_hash_direct_port: "COM7",
  }, null);
  const directText = formatExternalHashDiagnosticSnapshot(directDiagnostic);

  assert.equal(directDiagnostic.interfaceKind, "direct");
  assert.equal(directDiagnostic.endpointKind, "serial");
  assert.equal(directDiagnostic.interfaceStage, "read-only-probe");
  assert.equal(directDiagnostic.readOnlyProbeAllowed, true);
  assert.equal(directDiagnostic.telemetryReferenceAllowed, false);
  assert.equal(directDiagnostic.dryRunWorkAllowed, false);
  assert.equal(directDiagnostic.miningStartAllowed, false);
  assert.equal(directDiagnostic.protocolContract.stage, "reserved-direct");
  assert.equal(directDiagnostic.protocolContract.directProbeTarget, "serial");
  assert.ok(!directText.includes("COM7"));
});
test("external hash interface spec marks future engine adapters as dry-run only", () => {
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
  const candidateSnapshot = {
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
  };
  const matrix = deriveExternalHashCapabilityMatrix(candidateSnapshot);
  const gate = deriveExternalHashEngineCandidateGate(candidateSnapshot, matrix);
  const spec = deriveExternalHashInterfaceSpec(candidateSnapshot, matrix, gate);
  const contract = deriveExternalHashProtocolContract(spec, matrix);

  assert.equal(spec.stage, "dry-run-candidate");
  assert.equal(spec.dryRunWorkAllowed, true);
  assert.equal(spec.miningStartAllowed, false);
  assert.equal(contract.stage, "dry-run-only");
  assert.deepEqual(contract.allowedOperations, ["endpoint_access", "read_telemetry", "read_power", "partition_work"]);
  assert.ok(contract.blockedOperations.includes("control_jobs"));
  assert.ok(contract.blockedOperations.includes("submit_shares"));
  assert.ok(contract.blockedOperations.includes("start_mining"));
  assert.match(spec.summary, /dry-run candidate only/i);
});

test("external hash snapshot accepts future network hash-engine capability declarations", () => {
  const capabilities = ["telemetry", "powerTelemetry", "versionRolling", "workPartitioning", "jobControl", "shareSubmission"];
  const snapshot = deriveExternalHashSnapshot({
    external_hash_interface: "network",
    external_hash_network_host: "future-rack.local",
  }, {
    status: "ok",
    base_url: "http://future-rack.local",
    device_name: "Future Rack Adapter",
    hostname: "future-rack.local",
    hash_rate_hs: 2_400_000_000_000,
    power_watts: 32,
    joules_per_terahash: 13,
    temp_c: 58,
    parallel_workers: 4,
    integration_stage: "hash-engine",
    engine_eligible: true,
    capabilities,
    summary: "Future adapter declares dry-run hash-engine capabilities.",
  });
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const gate = deriveExternalHashEngineCandidateGate(snapshot, matrix);
  const spec = deriveExternalHashInterfaceSpec(snapshot, matrix, gate);

  assert.equal(snapshot.integrationStage, "hash-engine");
  assert.equal(snapshot.adapter.engineEligible, true);
  assert.equal(snapshot.canControlMining, true);
  assert.equal(snapshot.canSubmitShares, true);
  assert.equal(snapshot.canRollVersion, true);
  assert.equal(matrix.canPartitionWork, true);
  assert.equal(gate.status, "candidate");
  assert.equal(spec.stage, "dry-run-candidate");
  assert.equal(spec.miningStartAllowed, false);
  assert.match(snapshot.capabilitySummary, /dry-run validation/i);
});
import test from "node:test";
import assert from "node:assert/strict";

import {
  backendDiagnosticBridgeFromKernelBenchmark,
  extractBackendDiagnosticBridge,
  parseBackendDiagnosticBridge,
} from "../.test-dist/domain/diagnosticSnapshotBridge.js";

test("diagnostic bridge extracts backend algorithm kernel benchmark", () => {
  const bridge = extractBackendDiagnosticBridge({
    algorithm_kernel_benchmark: {
      status: "ok",
      nonce_count: 2048,
      full_header_hashrate: 10,
      midstate_hashrate: 20,
      speedup_ratio: 2,
      checksum_hex: "0123456789abcdef",
    },
  });

  assert.equal(bridge.algorithmKernelBenchmark?.status, "ok");
  assert.equal(bridge.algorithmKernelBenchmark?.nonce_count, 2048);
  assert.equal(bridge.algorithmKernelBenchmark?.speedup_ratio, 2);
});

test("diagnostic bridge tolerates missing or malformed backend snapshots", () => {
  assert.equal(extractBackendDiagnosticBridge(null).algorithmKernelBenchmark, null);
  assert.equal(extractBackendDiagnosticBridge([]).algorithmKernelBenchmark, null);
  assert.equal(parseBackendDiagnosticBridge("{not json").algorithmKernelBenchmark, null);
  assert.equal(parseBackendDiagnosticBridge("").algorithmKernelBenchmark, null);
});

test("diagnostic bridge wraps a lightweight backend kernel benchmark", () => {
  const bridge = backendDiagnosticBridgeFromKernelBenchmark({
    status: "ok",
    nonce_count: 2048,
    full_header_hashrate: 10,
    midstate_hashrate: 20,
    speedup_ratio: 2,
    checksum_hex: "0123456789abcdef",
  });

  assert.equal(bridge.algorithmKernelBenchmark?.status, "ok");
  assert.equal(bridge.algorithmKernelBenchmark?.midstate_hashrate, 20);
});

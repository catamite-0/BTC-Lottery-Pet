import test from "node:test";
import assert from "node:assert/strict";

import { deriveHashKernelBenchmarkEvidence } from "../.test-dist/domain/hashKernelBenchmark.js";

test("kernel benchmark evidence passes ok fixed-window midstate proof", () => {
  const evidence = deriveHashKernelBenchmarkEvidence({
    status: "ok",
    nonce_count: 2048,
    full_header_hashrate: 34_000,
    midstate_hashrate: 69_000,
    speedup_ratio: 2.03,
    checksum_hex: "0123456789abcdef",
  });

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.midstateReady, true);
  assert.equal(evidence.performance, "faster");
  assert.equal(evidence.nonceCount, 2048);
  assert.equal(evidence.hashDensityGainPercent, 103);
  assert.equal(evidence.fullHeaderCompressionBlocksPerHash, 3);
  assert.equal(evidence.midstateCompressionBlocksPerHash, 2.0005);
  assert.equal(evidence.compressionWorkSavedPercent, 33.3);
  assert.match(evidence.summary, /2\.03x/);
  assert.match(evidence.summary, /33\.3% compression work saved/);
});

test("kernel benchmark evidence blocks failed diagnostics", () => {
  const evidence = deriveHashKernelBenchmarkEvidence({
    status: "error",
    note: "midstate hash mismatch at nonce 7",
  });

  assert.equal(evidence.status, "blocked");
  assert.equal(evidence.midstateReady, false);
  assert.match(evidence.nextStep, /mismatch/i);
});

test("kernel benchmark evidence waits on thin or malformed snapshots", () => {
  const evidence = deriveHashKernelBenchmarkEvidence({
    status: "ok",
    nonceCount: 128,
    fullHeaderHashrate: 34_000,
    midstateHashrate: 69_000,
    speedupRatio: 2.03,
    checksumHex: "bad-checksum",
  });

  assert.equal(evidence.status, "waiting");
  assert.equal(evidence.midstateReady, false);
  assert.equal(evidence.compressionWorkSavedPercent, 33.1);
  assert.match(evidence.nextStep, /1024/);
});

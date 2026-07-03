import assert from "node:assert/strict";
import test from "node:test";
import { deriveHashRuntimeEfficiencySnapshot } from "../.test-dist/domain/hashRuntimeEfficiency.js";

test("runtime efficiency waits for live hashrate", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({ hashrate: 0 });

  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.effectiveHashrate, 0);
  assert.equal(snapshot.wastedHashrate, 0);
  assert.equal(snapshot.gpuThrottleHashrateAtRisk, null);
  assert.equal(snapshot.shareWasteRatio, null);
});

test("runtime efficiency keeps effective hash unproven until share events arrive", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 0,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });

  assert.equal(snapshot.status, "watch");
  assert.equal(snapshot.shareEvidenceReady, false);
  assert.equal(snapshot.effectiveRatio, null);
  assert.equal(snapshot.effectiveHashrate, 1_000_000);
  assert.equal(snapshot.provenEffectiveHashrate, null);
  assert.equal(snapshot.provenWastedHashrate, null);
  assert.match(snapshot.summary, /share evidence waiting/i);
});

test("runtime efficiency discounts rejected stale and queued share events", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 8,
    rejectedShares: 1,
    staleSharesDropped: 1,
    queuedSharesDropped: 0,
  });

  assert.equal(snapshot.totalShareEvents, 10);
  assert.equal(snapshot.sampleSeconds, null);
  assert.equal(snapshot.wastedShareEvents, 2);
  assert.equal(snapshot.shareWasteRatio, 0.2);
  assert.equal(snapshot.shareEvidenceReady, true);
  assert.equal(snapshot.effectiveHashrate, 800_000);
  assert.equal(snapshot.provenEffectiveHashrate, 800_000);
  assert.equal(snapshot.wastedHashrate, 200_000);
  assert.equal(snapshot.provenWastedHashrate, 200_000);
  assert.match(snapshot.summary, /200\.00 KH\/s quality loss/);
  assert.equal(snapshot.status, "watch");
});


test("runtime efficiency keeps clean but thin share evidence out of promotion", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 1,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 120,
  });

  assert.equal(snapshot.status, "efficient");
  assert.equal(snapshot.shareEvidenceReady, true);
  assert.equal(snapshot.promotionEvidenceReady, false);
  assert.equal(snapshot.effectiveRatio, 1);
});

test("runtime efficiency accepts dense or long sparse clean promotion evidence", () => {
  const dense = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 3,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 180,
  });
  const sparse = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 1,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 900,
  });

  assert.equal(dense.promotionEvidenceReady, true);
  assert.equal(sparse.promotionEvidenceReady, true);
});
test("runtime efficiency marks high share waste as wasteful", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 1_000_000,
    acceptedShares: 6,
    rejectedShares: 1,
    staleSharesDropped: 2,
    queuedSharesDropped: 1,
  });

  assert.equal(snapshot.shareWasteRatio, 0.4);
  assert.equal(snapshot.status, "wasteful");
});

test("runtime efficiency reports gpu throttle separately from share waste", () => {
  const snapshot = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 2_000_000,
    acceptedShares: 20,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 200,
    gpuThrottleMs: 300,
    sampleSeconds: 900.9,
  });

  assert.equal(snapshot.effectiveHashrate, 2_000_000);
  assert.equal(snapshot.sampleSeconds, 900);
  assert.equal(snapshot.gpuDutyCycle, 0.4);
  assert.equal(snapshot.gpuThrottleRatio, 0.6);
  assert.equal(snapshot.gpuThrottleHashrateAtRisk, 1_200_000);
  assert.equal(snapshot.status, "throttled");
});

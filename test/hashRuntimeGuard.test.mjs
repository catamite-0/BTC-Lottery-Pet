import test from "node:test";
import assert from "node:assert/strict";

import { deriveHashRuntimeEfficiencySnapshot } from "../.test-dist/domain/hashRuntimeEfficiency.js";
import { deriveHashRuntimeGuard, targetRaisesHashLoad } from "../.test-dist/domain/hashRuntimeGuard.js";

test("runtime guard observes thin live share evidence without blocking recovery", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 9,
    rejectedShares: 1,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(guard.level, "observe");
  assert.equal(guard.status, "watch");
  assert.equal(guard.promotionAllowed, false);
  assert.equal(guard.recoveryAction, "hold_load");
  assert.equal(guard.qualityLossHashrate, 12_000_000);
  assert.equal(guard.throttleHashrateAtRisk, null);
  assert.match(guard.summary, /observation/i);
  assert.match(guard.nextStep, /quality loss is 12\.00 MH\/s/i);
});

test("runtime guard keeps no-share hashrate unproven", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 0,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(runtime.shareEvidenceReady, false);
  assert.equal(guard.level, "observe");
  assert.equal(guard.status, "watch");
  assert.equal(guard.promotionAllowed, false);
  assert.equal(guard.qualityLossHashrate, null);
  assert.match(guard.nextStep, /share evidence is still waiting/i);
});


test("runtime guard holds clean but thin promotion evidence", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 1,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 120,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(runtime.status, "efficient");
  assert.equal(runtime.promotionEvidenceReady, false);
  assert.equal(guard.level, "observe");
  assert.equal(guard.status, "efficient");
  assert.equal(guard.promotionAllowed, false);
  assert.equal(guard.recoveryAction, "hold_load");
  assert.match(guard.summary, /too thin for promotion/i);
  assert.match(guard.nextStep, /3 live share events|900 seconds/i);
});

test("runtime guard clears promotion after clean runtime evidence matures", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 3,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 120,
    gpuThrottleMs: 0,
    sampleSeconds: 180,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(runtime.status, "efficient");
  assert.equal(runtime.promotionEvidenceReady, true);
  assert.equal(guard.level, "clear");
  assert.equal(guard.promotionAllowed, true);
  assert.equal(guard.recoveryAction, "allow_promotion");
});
test("runtime guard exposes throttled hash at risk", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 200_000_000,
    acceptedShares: 20,
    rejectedShares: 0,
    staleSharesDropped: 0,
    queuedSharesDropped: 0,
    gpuDispatchMs: 200,
    gpuThrottleMs: 300,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(guard.level, "block");
  assert.equal(guard.status, "throttled");
  assert.equal(guard.recoveryAction, "lower_load");
  assert.equal(guard.throttleHashrateAtRisk, 120_000_000);
  assert.match(guard.summary, /120\.00 MH\/s hash at risk/i);
});

test("runtime guard blocks wasteful live evidence", () => {
  const runtime = deriveHashRuntimeEfficiencySnapshot({
    hashrate: 120_000_000,
    acceptedShares: 6,
    rejectedShares: 1,
    staleSharesDropped: 2,
    queuedSharesDropped: 1,
  });
  const guard = deriveHashRuntimeGuard(runtime);

  assert.equal(guard.level, "block");
  assert.equal(guard.status, "wasteful");
  assert.equal(guard.promotionAllowed, false);
  assert.equal(guard.recoveryAction, "lower_load");
  assert.equal(guard.qualityLossHashrate, 48_000_000);
  assert.match(guard.summary, /48\.00 MH\/s quality loss/i);
  assert.match(guard.nextStep, /lower-load|share quality/i);
});

test("load target detects GPU intensity and watt increases", () => {
  assert.equal(targetRaisesHashLoad(
    { computeMode: "gpu", gpuIntensityPercent: 50, estimatedWatts: 24 },
    { computeMode: "gpu", gpuIntensityPercent: 25, estimatedWatts: 20 },
  ), true);
  assert.equal(targetRaisesHashLoad(
    { computeMode: "gpu", gpuIntensityPercent: 25, estimatedWatts: 20 },
    { computeMode: "gpu", gpuIntensityPercent: 50, estimatedWatts: 30 },
  ), false);
  assert.equal(targetRaisesHashLoad(
    { computeMode: "cpu", gpuIntensityPercent: 0, estimatedWatts: 22.5 },
    { computeMode: "cpu", gpuIntensityPercent: 0, estimatedWatts: 20 },
  ), true);
});
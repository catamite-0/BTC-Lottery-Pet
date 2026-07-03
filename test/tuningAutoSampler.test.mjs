import test from "node:test";
import assert from "node:assert/strict";

import { createTuningSweepPlan } from "../.test-dist/domain/efficiencyTuning.js";
import { calculateTuningWindowElapsedSeconds, createTuningAutoSampleCapture, evaluateTuningAutoSampleGate, hasTuningWindowCounterReset } from "../.test-dist/domain/tuningAutoSampler.js";

function firstStep() {
  return createTuningSweepPlan({
    goal: "balanced",
    availableCpuThreads: 8,
    recommendedCpuThreads: 2,
    hardwareGpuAvailable: true,
    maxSteps: 3,
    sampleSeconds: 30,
  }).steps[0];
}

test("auto sampler derives elapsed seconds from the active profile window", () => {
  assert.equal(calculateTuningWindowElapsedSeconds(120, 90), 30);
  assert.equal(calculateTuningWindowElapsedSeconds(120.8, 90.2), 30);
  assert.equal(calculateTuningWindowElapsedSeconds(12, 90), null);
  assert.equal(calculateTuningWindowElapsedSeconds(0, 0), null);
  assert.equal(hasTuningWindowCounterReset(12, 90), true);
  assert.equal(hasTuningWindowCounterReset(90, 90), false);
});

test("auto sampler waits for an active tuning step and hashrate", () => {
  assert.equal(evaluateTuningAutoSampleGate({ activeStep: null }).status, "inactive");
  assert.equal(evaluateTuningAutoSampleGate({ activeStep: firstStep(), observedHashrate: 0 }).status, "waiting_hashrate");
});

test("auto sampler can be disabled by the objective experiment policy", () => {
  const gate = evaluateTuningAutoSampleGate({
    enabled: false,
    activeStep: firstStep(),
    observedHashrate: 100_000_000,
    elapsedSeconds: 900,
  });

  assert.equal(gate.status, "inactive");
  assert.equal(gate.canCapture, false);
  assert.match(gate.summary, /does not require local capture/i);
});
test("auto sampler blocks capture until the profile runs long enough", () => {
  const step = firstStep();
  const gate = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 12,
  });

  assert.equal(gate.status, "warming_up");
  assert.equal(gate.canCapture, false);
  assert.equal(gate.nextCaptureInSeconds, 18);
});

test("auto sampler allows capture after the sample window", () => {
  const step = firstStep();
  const gate = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 31,
  });

  assert.equal(gate.status, "ready");
  assert.equal(gate.canCapture, true);
  assert.equal(gate.elapsedSeconds, 31);
  assert.ok(gate.summary.includes("will not change the active profile"));
});

test("auto sampler can require measured power for unattended evidence", () => {
  const step = firstStep();
  const waitingPower = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 31,
    requireMeasuredPower: true,
    hasMeasuredPower: false,
  });
  const measuredReady = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 31,
    requireMeasuredPower: true,
    hasMeasuredPower: true,
  });
  const manualExploration = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 31,
  });

  assert.equal(waitingPower.status, "waiting_power");
  assert.equal(waitingPower.canCapture, false);
  assert.match(waitingPower.summary, /measured watts/i);
  assert.equal(measuredReady.status, "ready");
  assert.equal(measuredReady.canCapture, true);
  assert.equal(manualExploration.status, "ready");
  assert.equal(manualExploration.canCapture, true);
});

test("auto sampler waits until the active profile matches the tuning target", () => {
  const step = firstStep();
  const gate = evaluateTuningAutoSampleGate({
    activeStep: step,
    requiredStepId: `${step.id}-next`,
    observedHashrate: 100_000_000,
    elapsedSeconds: 900,
    minCaptureSeconds: 900,
  });

  assert.equal(gate.status, "waiting_profile");
  assert.equal(gate.canCapture, false);
  assert.match(gate.summary, /active profile/i);
});
test("auto sampler suppresses repeated captures until refresh window passes", () => {
  const step = firstStep();
  const recent = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 40,
    existingObservation: { stepId: step.id, hashrate: 100_000_000, sampleSeconds: 31 },
    refreshSeconds: 30,
  });
  const refresh = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 70,
    existingObservation: { stepId: step.id, hashrate: 100_000_000, sampleSeconds: 31 },
    refreshSeconds: 30,
  });

  assert.equal(recent.status, "recorded");
  assert.equal(recent.canCapture, false);
  assert.equal(refresh.status, "ready");
  assert.equal(refresh.canCapture, true);
});
test("auto sampler honors a raised evidence window above the step default", () => {
  const step = firstStep();
  const waiting = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 180,
    minCaptureSeconds: 300,
  });
  const ready = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 100_000_000,
    elapsedSeconds: 300,
    minCaptureSeconds: 300,
  });

  assert.equal(waiting.status, "warming_up");
  assert.equal(waiting.canCapture, false);
  assert.equal(waiting.requiredSeconds, 300);
  assert.equal(waiting.nextCaptureInSeconds, 120);
  assert.equal(ready.status, "ready");
  assert.equal(ready.canCapture, true);
});
test("auto sampler builds a capture observation from share deltas", () => {
  const step = firstStep();
  const gate = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
  });
  const decision = createTuningAutoSampleCapture({
    gate,
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
    currentShareCounters: { acceptedShares: 12, rejectedShares: 2, staleSharesDropped: 3, queuedSharesDropped: 4 },
    baselineShareCounters: { acceptedShares: 10, rejectedShares: 1, staleSharesDropped: 1, queuedSharesDropped: 2 },
    gpuDispatchMs: 100,
    gpuThrottleMs: 25,
  });

  assert.equal(decision.reason, "ready");
  assert.ok(decision.captureKey);
  assert.deepEqual(decision.nextShareBaseline, { acceptedShares: 12, rejectedShares: 2, staleSharesDropped: 3, queuedSharesDropped: 4 });
  assert.deepEqual(
    {
      stepId: decision.observation?.stepId,
      hashrate: decision.observation?.hashrate,
      watts: decision.observation?.watts,
      powerEvidenceStatus: decision.observation?.powerEvidenceStatus,
      acceptedShares: decision.observation?.acceptedShares,
      rejectedShares: decision.observation?.rejectedShares,
      staleSharesDropped: decision.observation?.staleSharesDropped,
      queuedSharesDropped: decision.observation?.queuedSharesDropped,
      gpuDispatchMs: decision.observation?.gpuDispatchMs,
      gpuThrottleMs: decision.observation?.gpuThrottleMs,
      sampleSeconds: decision.observation?.sampleSeconds,
    },
    {
      stepId: step.id,
      hashrate: 150_000_000,
      watts: step.estimatedWatts,
      powerEvidenceStatus: "estimated",
      acceptedShares: 2,
      rejectedShares: 1,
      staleSharesDropped: 2,
      queuedSharesDropped: 2,
      gpuDispatchMs: 100,
      gpuThrottleMs: 25,
      sampleSeconds: 45,
    },
  );
});

test("auto sampler capture helper blocks duplicates and missing measured power", () => {
  const step = firstStep();
  const measuredGate = evaluateTuningAutoSampleGate({
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
    requireMeasuredPower: true,
    hasMeasuredPower: true,
  });
  const missingPower = createTuningAutoSampleCapture({
    gate: measuredGate,
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
    currentShareCounters: { acceptedShares: 1, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
    requireMeasuredPower: true,
  });
  const measured = createTuningAutoSampleCapture({
    gate: measuredGate,
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
    currentShareCounters: { acceptedShares: 1, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
    requireMeasuredPower: true,
    measuredWatts: 12.5,
  });
  const duplicate = createTuningAutoSampleCapture({
    gate: measuredGate,
    activeStep: step,
    observedHashrate: 150_000_000,
    elapsedSeconds: 45,
    currentShareCounters: { acceptedShares: 1, rejectedShares: 0, staleSharesDropped: 0, queuedSharesDropped: 0 },
    requireMeasuredPower: true,
    measuredWatts: 12.5,
    lastCaptureKey: measured.captureKey,
  });

  assert.equal(missingPower.reason, "waiting_power");
  assert.equal(missingPower.observation, null);
  assert.equal(measured.reason, "ready");
  assert.equal(measured.observation?.powerEvidenceStatus, "measured");
  assert.equal(measured.observation?.watts, 12.5);
  assert.equal(duplicate.reason, "duplicate");
  assert.equal(duplicate.observation, null);
  assert.equal(duplicate.captureKey, measured.captureKey);
});

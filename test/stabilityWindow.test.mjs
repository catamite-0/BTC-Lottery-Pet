import test from "node:test";
import assert from "node:assert/strict";

import { calculateStabilityWindow } from "../.test-dist/domain/stabilityWindow.js";

test("stability window marks short timed samples as probing", () => {
  const window = calculateStabilityWindow({ sampleSeconds: 30, rejectedShareRatio: 0, thermalStatus: "cool" });

  assert.equal(window.status, "probing");
  assert.ok(window.qualityWeight < 1);
  assert.equal(window.requiredSeconds, 180);
  assert.ok(window.progress > 0);
});

test("stability window accepts long low-reject cool samples", () => {
  const window = calculateStabilityWindow({ sampleSeconds: 240, rejectedShareRatio: 0.01, thermalStatus: "warm" });

  assert.equal(window.status, "stable");
  assert.equal(window.qualityWeight, 1);
  assert.equal(window.progress, 1);
});

test("stability window rejects unsafe thermal states", () => {
  const window = calculateStabilityWindow({ sampleSeconds: 240, rejectedShareRatio: 0, thermalStatus: "critical" });

  assert.equal(window.status, "unsafe");
  assert.ok(window.qualityWeight < 0.5);
});
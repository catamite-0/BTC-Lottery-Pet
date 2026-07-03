import test from "node:test";
import assert from "node:assert/strict";

import { calculateThermalGuard } from "../.test-dist/domain/thermalGuard.js";

test("thermal guard keeps cool telemetry at full quality", () => {
  const guard = calculateThermalGuard({ tempC: 52, vrTempC: 61, fanRpm: 3200 });

  assert.equal(guard.status, "cool");
  assert.equal(guard.qualityWeight, 1);
  assert.equal(guard.maxObservedTempC, 61);
});

test("thermal guard penalizes hot and critical telemetry", () => {
  const hot = calculateThermalGuard({ tempC: 82, vrTempC: 90, fanRpm: 4200 });
  const critical = calculateThermalGuard({ tempC: 88, vrTempC: 112, fanRpm: 5000 });

  assert.equal(hot.status, "hot");
  assert.ok(hot.qualityWeight < 1);
  assert.equal(critical.status, "critical");
  assert.ok(critical.qualityWeight < hot.qualityWeight);
});

test("thermal guard treats paused mining as unsafe for tuning", () => {
  const guard = calculateThermalGuard({ tempC: 58, miningPaused: true });

  assert.equal(guard.status, "paused");
  assert.ok(guard.qualityWeight < 0.5);
});
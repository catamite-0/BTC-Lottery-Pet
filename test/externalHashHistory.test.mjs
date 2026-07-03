import test from "node:test";
import assert from "node:assert/strict";

import {
  appendExternalHashHistorySample,
  externalHashReportToHistorySample,
  summarizeExternalHashHistory,
} from "../.test-dist/domain/externalHashHistory.js";

function report(overrides = {}) {
  return {
    generated_at: "2026-07-01T00:00:00.000Z",
    base_url: "http://bitaxe.local",
    status: "ok",
    hash_rate_hs: 1_000_000_000_000,
    power_watts: 15,
    joules_per_terahash: 15,
    temp_c: 72,
    vr_temp_c: 80,
    fan_rpm: 3200,
    shares_accepted: 12,
    shares_rejected: 1,
    mining_paused: false,
    ...overrides,
  };
}

test("external hash history converts telemetry into safe samples", () => {
  const sample = externalHashReportToHistorySample(report({
    hash_rate_hs: -1,
    power_watts: 0,
    joules_per_terahash: Number.NaN,
    temp_c: 71,
  }));

  assert.equal(sample.hashrate, 0);
  assert.equal(sample.watts, null);
  assert.equal(sample.joulesPerTerahash, null);
  assert.equal(sample.tempC, 71);
  assert.equal(sample.fanRpm, 3200);
  assert.equal(sample.miningPaused, false);
});

test("external hash history appends newest first, deduplicates, and caps length", () => {
  let history = [];
  history = appendExternalHashHistorySample(history, report({ generated_at: "2026-07-01T00:00:00Z" }), 2);
  history = appendExternalHashHistorySample(history, report({ generated_at: "2026-07-01T00:01:00Z" }), 2);
  history = appendExternalHashHistorySample(history, report({ generated_at: "2026-07-01T00:01:00Z", hash_rate_hs: 2_000_000_000_000 }), 2);
  history = appendExternalHashHistorySample(history, report({ generated_at: "2026-07-01T00:02:00Z" }), 2);

  assert.equal(history.length, 2);
  assert.equal(history[0].generatedAt, "2026-07-01T00:02:00Z");
  assert.equal(history[1].generatedAt, "2026-07-01T00:01:00Z");
  assert.equal(history[1].hashrate, 2_000_000_000_000);
});

test("external hash history summarizes efficiency and online samples", () => {
  const history = [
    externalHashReportToHistorySample(report({ generated_at: "4", hash_rate_hs: 900_000_000_000, power_watts: 18, joules_per_terahash: 20 })),
    externalHashReportToHistorySample(report({ generated_at: "3", hash_rate_hs: 1_100_000_000_000, power_watts: 16.5, joules_per_terahash: 15 })),
    externalHashReportToHistorySample(report({ generated_at: "2", status: "failed", hash_rate_hs: 0, power_watts: null, joules_per_terahash: null })),
  ];

  const summary = summarizeExternalHashHistory(history);
  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.onlineSampleCount, 2);
  assert.equal(summary.efficiencySampleCount, 2);
  assert.equal(summary.usableEfficiencySampleCount, 2);
  assert.equal(summary.evidenceStatus, "probing");
  assert.equal(summary.evidenceReady, false);
  assert.equal(summary.evidenceGap, 1);
  assert.equal(summary.averageHashrate, 1_000_000_000_000);
  assert.equal(summary.averageJoulesPerTerahash, 17.5);
  assert.equal(summary.bestJoulesPerTerahash, 15);
  assert.equal(summary.latestSample?.generatedAt, "4");
});

test("external hash history detects improving efficiency trend", () => {
  const history = [
    externalHashReportToHistorySample(report({ generated_at: "6", joules_per_terahash: 13 })),
    externalHashReportToHistorySample(report({ generated_at: "5", joules_per_terahash: 14 })),
    externalHashReportToHistorySample(report({ generated_at: "4", joules_per_terahash: 15 })),
    externalHashReportToHistorySample(report({ generated_at: "3", joules_per_terahash: 18 })),
    externalHashReportToHistorySample(report({ generated_at: "2", joules_per_terahash: 19 })),
    externalHashReportToHistorySample(report({ generated_at: "1", joules_per_terahash: 20 })),
  ];

  const summary = summarizeExternalHashHistory(history);
  assert.equal(summary.trend, "improving");
  assert.ok(summary.trendPercent && summary.trendPercent > 20);
});

test("external hash history marks three usable efficiency samples as route-ready", () => {
  const history = [
    externalHashReportToHistorySample(report({ generated_at: "3", temp_c: 61, joules_per_terahash: 14 })),
    externalHashReportToHistorySample(report({ generated_at: "2", temp_c: 62, joules_per_terahash: 15 })),
    externalHashReportToHistorySample(report({ generated_at: "1", temp_c: 63, joules_per_terahash: 16 })),
  ];

  const summary = summarizeExternalHashHistory(history);
  assert.equal(summary.usableEfficiencySampleCount, 3);
  assert.equal(summary.evidenceStatus, "ready");
  assert.equal(summary.evidenceReady, true);
  assert.equal(summary.evidenceGap, 0);
});

test("external hash history excludes hot paused and unknown thermal samples from route evidence", () => {
  const hotHistory = [
    externalHashReportToHistorySample(report({ generated_at: "3", temp_c: 83, vr_temp_c: 96, fan_rpm: 4500, joules_per_terahash: 14 })),
    externalHashReportToHistorySample(report({ generated_at: "2", temp_c: 84, vr_temp_c: 97, fan_rpm: 4500, joules_per_terahash: 15 })),
    externalHashReportToHistorySample(report({ generated_at: "1", temp_c: 85, vr_temp_c: 98, fan_rpm: 4500, joules_per_terahash: 16 })),
  ];
  const unknownHistory = [
    externalHashReportToHistorySample(report({ generated_at: "3", temp_c: null, vr_temp_c: null, fan_rpm: null, joules_per_terahash: 14 })),
    externalHashReportToHistorySample(report({ generated_at: "2", temp_c: null, vr_temp_c: null, fan_rpm: null, joules_per_terahash: 15 })),
    externalHashReportToHistorySample(report({ generated_at: "1", temp_c: null, vr_temp_c: null, fan_rpm: null, joules_per_terahash: 16 })),
  ];

  const hotSummary = summarizeExternalHashHistory(hotHistory);
  const unknownSummary = summarizeExternalHashHistory(unknownHistory);

  assert.equal(hotSummary.efficiencySampleCount, 3);
  assert.equal(hotSummary.usableEfficiencySampleCount, 0);
  assert.equal(hotSummary.evidenceReady, false);
  assert.equal(hotSummary.evidenceGap, 3);
  assert.equal(hotSummary.averageJoulesPerTerahash, null);
  assert.equal(hotSummary.trend, "waiting");
  assert.equal(unknownSummary.usableEfficiencySampleCount, 0);
  assert.equal(unknownSummary.evidenceStatus, "waiting");
});

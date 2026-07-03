import {
  OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
  OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
} from "./optimizationThresholds.js";
import { calculateThermalGuard } from "./thermalGuard.js";

export type ExternalHashHistoryTrend = "waiting" | "improving" | "stable" | "degrading";
export type ExternalHashEvidenceStatus = "waiting" | "probing" | "ready" | "stable";

export const DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT = 60;

export interface ExternalHashTelemetryHistoryLike {
  generated_at: string;
  base_url: string;
  status: string;
  hash_rate_hs: number;
  power_watts: number | null;
  joules_per_terahash: number | null;
  temp_c?: number | null;
  vr_temp_c?: number | null;
  fan_rpm?: number | null;
  shares_accepted?: number | null;
  shares_rejected?: number | null;
  mining_paused?: boolean | null;
}

export interface ExternalHashHistorySample {
  generatedAt: string;
  endpoint: string;
  status: string;
  hashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  tempC: number | null;
  vrTempC: number | null;
  fanRpm: number | null;
  acceptedShares: number | null;
  rejectedShares: number | null;
  miningPaused: boolean | null;
}

export interface ExternalHashHistorySummary {
  sampleCount: number;
  onlineSampleCount: number;
  efficiencySampleCount: number;
  usableEfficiencySampleCount: number;
  evidenceStatus: ExternalHashEvidenceStatus;
  evidenceReady: boolean;
  evidenceSampleTarget: number;
  evidenceGap: number;
  latestSample: ExternalHashHistorySample | null;
  bestEfficiencySample: ExternalHashHistorySample | null;
  averageHashrate: number;
  averageWatts: number | null;
  averageJoulesPerTerahash: number | null;
  bestJoulesPerTerahash: number | null;
  trend: ExternalHashHistoryTrend;
  trendPercent: number | null;
  summary: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function clampHistoryLimit(limit: number | null | undefined) {
  if (!Number.isFinite(limit) || !limit || limit <= 0) {
    return DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT;
  }
  return Math.max(1, Math.trunc(limit));
}

function isExternalEvidenceSampleUsable(sample: ExternalHashHistorySample) {
  const thermal = calculateThermalGuard({
    tempC: sample.tempC,
    vrTempC: sample.vrTempC,
    fanRpm: sample.fanRpm,
    miningPaused: sample.miningPaused,
  });
  return thermal.status === "cool" || thermal.status === "warm";
}

function evidenceStatusFor(usableEfficiencySampleCount: number): ExternalHashEvidenceStatus {
  if (usableEfficiencySampleCount <= 0) {
    return "waiting";
  }
  if (usableEfficiencySampleCount >= OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "stable";
  }
  if (usableEfficiencySampleCount >= OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "ready";
  }
  return "probing";
}

function evidenceText(status: ExternalHashEvidenceStatus, gap: number) {
  if (status === "stable") {
    return "external evidence stable";
  }
  if (status === "ready") {
    return "external evidence ready";
  }
  if (gap > 0) {
    return `needs ${gap} more usable efficiency sample${gap === 1 ? "" : "s"}`;
  }
  return "waiting for external efficiency evidence";
}

export function externalHashReportToHistorySample(
  report: ExternalHashTelemetryHistoryLike,
): ExternalHashHistorySample {
  return {
    generatedAt: report.generated_at,
    endpoint: report.base_url,
    status: report.status,
    hashrate: finitePositive(report.hash_rate_hs) ? report.hash_rate_hs : 0,
    watts: finitePositive(report.power_watts) ? Number(report.power_watts) : null,
    joulesPerTerahash: finitePositive(report.joules_per_terahash)
      ? Number(report.joules_per_terahash)
      : null,
    tempC: typeof report.temp_c === "number" && Number.isFinite(report.temp_c) ? report.temp_c : null,
    vrTempC: typeof report.vr_temp_c === "number" && Number.isFinite(report.vr_temp_c) ? report.vr_temp_c : null,
    fanRpm: typeof report.fan_rpm === "number" && Number.isFinite(report.fan_rpm) ? report.fan_rpm : null,
    acceptedShares: typeof report.shares_accepted === "number" && Number.isFinite(report.shares_accepted)
      ? report.shares_accepted
      : null,
    rejectedShares: typeof report.shares_rejected === "number" && Number.isFinite(report.shares_rejected)
      ? report.shares_rejected
      : null,
    miningPaused: typeof report.mining_paused === "boolean" ? report.mining_paused : null,
  };
}

export function appendExternalHashHistorySample(
  current: ExternalHashHistorySample[],
  report: ExternalHashTelemetryHistoryLike,
  limit = DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT,
): ExternalHashHistorySample[] {
  const sample = externalHashReportToHistorySample(report);
  const deduped = current.filter((entry) => !(
    entry.generatedAt === sample.generatedAt && entry.endpoint === sample.endpoint
  ));
  return [sample, ...deduped].slice(0, clampHistoryLimit(limit));
}

function deriveEfficiencyTrend(samplesNewestFirst: ExternalHashHistorySample[]): {
  trend: ExternalHashHistoryTrend;
  trendPercent: number | null;
} {
  const efficiencySamples = samplesNewestFirst.filter((sample) => finitePositive(sample.joulesPerTerahash));
  if (efficiencySamples.length < 4) {
    return { trend: "waiting", trendPercent: null };
  }

  const midpoint = Math.floor(efficiencySamples.length / 2);
  const recent = efficiencySamples.slice(0, midpoint).map((sample) => Number(sample.joulesPerTerahash));
  const older = efficiencySamples.slice(midpoint).map((sample) => Number(sample.joulesPerTerahash));
  const recentAverage = average(recent);
  const olderAverage = average(older);
  if (!finitePositive(recentAverage) || !finitePositive(olderAverage)) {
    return { trend: "waiting", trendPercent: null };
  }

  const changeRatio = (Number(recentAverage) - Number(olderAverage)) / Number(olderAverage);
  const trendPercent = Math.abs(changeRatio) * 100;
  if (changeRatio <= -0.05) {
    return { trend: "improving", trendPercent };
  }
  if (changeRatio >= 0.05) {
    return { trend: "degrading", trendPercent };
  }
  return { trend: "stable", trendPercent };
}

function trendText(trend: ExternalHashHistoryTrend, trendPercent: number | null) {
  if (trend === "waiting" || trendPercent === null) {
    return "waiting for more efficiency samples";
  }
  return `${trend} by ${trendPercent.toFixed(1)}%`;
}

export function summarizeExternalHashHistory(
  samplesNewestFirst: ExternalHashHistorySample[],
): ExternalHashHistorySummary {
  const onlineSamples = samplesNewestFirst.filter((sample) => sample.status !== "failed" && sample.hashrate > 0);
  const efficiencySamples = onlineSamples.filter((sample) => finitePositive(sample.joulesPerTerahash));
  const usableOnlineSamples = onlineSamples.filter(isExternalEvidenceSampleUsable);
  const usableEfficiencySamples = efficiencySamples.filter(isExternalEvidenceSampleUsable);
  const usableEfficiencySampleCount = usableEfficiencySamples.length;
  const evidenceGap = Math.max(0, OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES - usableEfficiencySampleCount);
  const evidenceStatus = evidenceStatusFor(usableEfficiencySampleCount);
  const evidenceReady = usableEfficiencySampleCount >= OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES;
  const averageHashrate = average(usableOnlineSamples.map((sample) => sample.hashrate)) ?? 0;
  const averageWatts = average(
    usableOnlineSamples
      .map((sample) => sample.watts)
      .filter((value): value is number => finitePositive(value)),
  );
  const averageJoulesPerTerahash = average(
    usableEfficiencySamples.map((sample) => Number(sample.joulesPerTerahash)),
  );
  const bestEfficiencySample = usableEfficiencySamples.reduce<ExternalHashHistorySample | null>((best, sample) => {
    if (!best || Number(sample.joulesPerTerahash) < Number(best.joulesPerTerahash)) {
      return sample;
    }
    return best;
  }, null);
  const trend = deriveEfficiencyTrend(usableEfficiencySamples);
  const latestSample = samplesNewestFirst[0] ?? null;

  return {
    sampleCount: samplesNewestFirst.length,
    onlineSampleCount: onlineSamples.length,
    efficiencySampleCount: efficiencySamples.length,
    usableEfficiencySampleCount,
    evidenceStatus,
    evidenceReady,
    evidenceSampleTarget: OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
    evidenceGap,
    latestSample,
    bestEfficiencySample,
    averageHashrate,
    averageWatts,
    averageJoulesPerTerahash,
    bestJoulesPerTerahash: bestEfficiencySample?.joulesPerTerahash ?? null,
    trend: trend.trend,
    trendPercent: trend.trendPercent,
    summary: samplesNewestFirst.length === 0
      ? "No external telemetry history yet."
      : `${onlineSamples.length}/${samplesNewestFirst.length} online samples; ${trendText(trend.trend, trend.trendPercent)}; ${evidenceText(evidenceStatus, evidenceGap)}.`,
  };
}
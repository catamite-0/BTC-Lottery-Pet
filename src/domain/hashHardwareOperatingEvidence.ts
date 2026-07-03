import {
  OPTIMIZATION_MAX_SHARE_WASTE_RATIO,
  OPTIMIZATION_MIN_SHARE_EVENTS,
  OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
} from "./optimizationThresholds.js";
import type { ExternalHashHistorySample } from "./externalHashHistory.js";
import { calculateThermalGuard } from "./thermalGuard.js";

export type HashHardwarePowerEvidenceSource = "wall_meter" | "trusted_device_telemetry" | "estimated";
export type HashHardwareOperatingEvidenceStatus = "missing" | "provisional" | "passed" | "failed";

export interface HashHardwareOperatingEvidenceSample {
  generatedAt?: string | null;
  durationSeconds?: number | null;
  hashrate?: number | null;
  wallWatts?: number | null;
  joulesPerTerahash?: number | null;
  powerEvidenceSource?: HashHardwarePowerEvidenceSource | null;
  tempC?: number | null;
  vrTempC?: number | null;
  fanRpm?: number | null;
  noiseDba?: number | null;
  acceptedShares?: number | null;
  rejectedShares?: number | null;
  staleSharesDropped?: number | null;
  queuedSharesDropped?: number | null;
  miningPaused?: boolean | null;
}

export interface HashHardwareOperatingEvidenceOptions {
  maxNoiseDba?: number | null;
}

export interface HashHardwareOperatingEvidenceSnapshot {
  schemaVersion: 1;
  status: HashHardwareOperatingEvidenceStatus;
  releaseReady: boolean;
  sampleCount: number;
  usableSampleCount: number;
  requiredSeconds: number;
  requiredShareEvents: number;
  maxNoiseDba: number;
  primarySample: HashHardwareOperatingEvidenceSample | null;
  averageWallWatts: number | null;
  averageHashrate: number;
  effectiveHashrate: number;
  bestJoulesPerTerahash: number | null;
  effectiveJoulesPerTerahash: number | null;
  maxObservedTempC: number | null;
  maxObservedNoiseDba: number | null;
  shareWasteRatio: number | null;
  missingEvidence: string[];
  summary: string;
  nextStep: string;
}

const DEFAULT_MAX_NOISE_DBA = 60;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function average(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function maxValue(values: number[]) {
  return values.length > 0 ? Math.max(...values) : null;
}

function normalizeMaxNoiseDba(value: number | null | undefined) {
  return finitePositive(value) ? Number(value) : DEFAULT_MAX_NOISE_DBA;
}

function shareEvents(sample: HashHardwareOperatingEvidenceSample) {
  return Math.max(0, Math.trunc(Number(sample.acceptedShares) || 0)) +
    Math.max(0, Math.trunc(Number(sample.rejectedShares) || 0)) +
    Math.max(0, Math.trunc(Number(sample.staleSharesDropped) || 0)) +
    Math.max(0, Math.trunc(Number(sample.queuedSharesDropped) || 0));
}

function shareWasteRatioFor(sample: HashHardwareOperatingEvidenceSample) {
  const accepted = Math.max(0, Math.trunc(Number(sample.acceptedShares) || 0));
  const rejected = Math.max(0, Math.trunc(Number(sample.rejectedShares) || 0));
  const stale = Math.max(0, Math.trunc(Number(sample.staleSharesDropped) || 0));
  const queued = Math.max(0, Math.trunc(Number(sample.queuedSharesDropped) || 0));
  const total = accepted + rejected + stale + queued;
  return total > 0 ? (rejected + stale + queued) / total : null;
}

function effectiveHashrateFor(sample: HashHardwareOperatingEvidenceSample) {
  const hashrate = finitePositive(sample.hashrate) ? Number(sample.hashrate) : 0;
  const wasteRatio = shareWasteRatioFor(sample);
  return wasteRatio === null ? hashrate : hashrate * Math.max(0, 1 - wasteRatio);
}

function joulesPerTerahashFrom(watts: number | null, hashrate: number) {
  return finitePositive(watts) && finitePositive(hashrate)
    ? Number(watts) * 1_000_000_000_000 / hashrate
    : null;
}

export function deriveHashHardwareOperatingEvidenceSamplesFromExternalHistory(
  samplesNewestFirst: ExternalHashHistorySample[] = [],
): HashHardwareOperatingEvidenceSample[] {
  return samplesNewestFirst
    .filter((sample) => sample.status !== "failed" && finitePositive(sample.hashrate))
    .map((sample) => ({
      generatedAt: sample.generatedAt,
      durationSeconds: null,
      hashrate: sample.hashrate,
      wallWatts: finitePositive(sample.watts) ? Number(sample.watts) : null,
      joulesPerTerahash: finitePositive(sample.joulesPerTerahash) ? Number(sample.joulesPerTerahash) : null,
      powerEvidenceSource: finitePositive(sample.watts) ? "trusted_device_telemetry" : null,
      tempC: finiteNonNegative(sample.tempC) ? Number(sample.tempC) : null,
      vrTempC: finiteNonNegative(sample.vrTempC) ? Number(sample.vrTempC) : null,
      fanRpm: finiteNonNegative(sample.fanRpm) ? Number(sample.fanRpm) : null,
      noiseDba: null,
      acceptedShares: finiteNonNegative(sample.acceptedShares) ? Number(sample.acceptedShares) : null,
      rejectedShares: finiteNonNegative(sample.rejectedShares) ? Number(sample.rejectedShares) : null,
      staleSharesDropped: 0,
      queuedSharesDropped: 0,
      miningPaused: sample.miningPaused,
    }));
}

function hasTrustedPower(sample: HashHardwareOperatingEvidenceSample) {
  return finitePositive(sample.wallWatts) &&
    (sample.powerEvidenceSource === "wall_meter" || sample.powerEvidenceSource === "trusted_device_telemetry");
}

function missingEvidenceFor(sample: HashHardwareOperatingEvidenceSample | null, maxNoiseDba: number) {
  if (!sample) {
    return [
      "hardware operating sample",
      "900 second runtime",
      "wall power or trusted power telemetry",
      "cool or warm thermal state",
      "noise sample",
      "accepted/rejected/drop share events",
    ];
  }

  const missing: string[] = [];
  if (!finitePositive(sample.durationSeconds) || Number(sample.durationSeconds) < OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS) {
    missing.push("900 second runtime");
  }
  if (!hasTrustedPower(sample)) {
    missing.push("wall power or trusted power telemetry");
  }
  if (!finitePositive(sample.hashrate)) {
    missing.push("positive hashrate");
  }
  const thermal = calculateThermalGuard({
    tempC: sample.tempC,
    vrTempC: sample.vrTempC,
    fanRpm: sample.fanRpm,
    miningPaused: sample.miningPaused,
  });
  if (thermal.status !== "cool" && thermal.status !== "warm") {
    missing.push("cool or warm thermal state");
  }
  if (!finiteNonNegative(sample.noiseDba)) {
    missing.push("noise sample");
  } else if (Number(sample.noiseDba) > maxNoiseDba) {
    missing.push("noise below configured limit");
  }
  if (shareEvents(sample) < OPTIMIZATION_MIN_SHARE_EVENTS) {
    missing.push("accepted/rejected/drop share events");
  }
  const wasteRatio = shareWasteRatioFor(sample);
  if (wasteRatio === null || wasteRatio > OPTIMIZATION_MAX_SHARE_WASTE_RATIO) {
    missing.push("low share waste");
  }
  return missing;
}

function isUsableSample(sample: HashHardwareOperatingEvidenceSample, maxNoiseDba: number) {
  return missingEvidenceFor(sample, maxNoiseDba).length === 0;
}

function hasHardFailure(sample: HashHardwareOperatingEvidenceSample, maxNoiseDba: number) {
  const thermal = calculateThermalGuard({
    tempC: sample.tempC,
    vrTempC: sample.vrTempC,
    fanRpm: sample.fanRpm,
    miningPaused: sample.miningPaused,
  });
  return thermal.status === "hot" ||
    thermal.status === "critical" ||
    thermal.status === "paused" ||
    (finiteNonNegative(sample.noiseDba) && Number(sample.noiseDba) > maxNoiseDba) ||
    (shareWasteRatioFor(sample) ?? 0) > OPTIMIZATION_MAX_SHARE_WASTE_RATIO;
}

function statusFor(
  samples: HashHardwareOperatingEvidenceSample[],
  usableSampleCount: number,
  maxNoiseDba: number,
): HashHardwareOperatingEvidenceStatus {
  if (usableSampleCount > 0) {
    return "passed";
  }
  if (samples.length === 0) {
    return "missing";
  }
  return samples.some((sample) => hasHardFailure(sample, maxNoiseDba)) ? "failed" : "provisional";
}

function nextStepFor(status: HashHardwareOperatingEvidenceStatus, missingEvidence: string[]) {
  if (status === "passed") {
    return "Attach this measured operating sample to the hardware release review.";
  }
  if (status === "failed") {
    return "Fix thermal, noise, or share-waste failures before collecting another release sample.";
  }
  return `Collect external operating evidence: ${missingEvidence.slice(0, 3).join(", ")}.`;
}

export function assessHashHardwareOperatingEvidence(
  samples: HashHardwareOperatingEvidenceSample[] = [],
  options: HashHardwareOperatingEvidenceOptions = {},
): HashHardwareOperatingEvidenceSnapshot {
  const maxNoiseDba = normalizeMaxNoiseDba(options.maxNoiseDba);
  const usableSamples = samples.filter((sample) => isUsableSample(sample, maxNoiseDba));
  const primarySample = usableSamples[0] ?? samples[0] ?? null;
  const missingEvidence = missingEvidenceFor(primarySample, maxNoiseDba);
  const status = statusFor(samples, usableSamples.length, maxNoiseDba);
  const wallWatts = usableSamples
    .map((sample) => sample.wallWatts)
    .filter((value): value is number => finitePositive(value));
  const hashrates = usableSamples
    .map((sample) => sample.hashrate)
    .filter((value): value is number => finitePositive(value));
  const effectiveHashrates = usableSamples
    .map((sample) => effectiveHashrateFor(sample))
    .filter((value): value is number => finitePositive(value));
  const joulesPerTerahash = usableSamples
    .map((sample) => sample.joulesPerTerahash)
    .filter((value): value is number => finitePositive(value));
  const temps = usableSamples
    .flatMap((sample) => [sample.tempC, sample.vrTempC])
    .filter((value): value is number => finiteNonNegative(value));
  const noise = usableSamples
    .map((sample) => sample.noiseDba)
    .filter((value): value is number => finiteNonNegative(value));

  return {
    schemaVersion: 1,
    status,
    releaseReady: status === "passed",
    sampleCount: samples.length,
    usableSampleCount: usableSamples.length,
    requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
    requiredShareEvents: OPTIMIZATION_MIN_SHARE_EVENTS,
    maxNoiseDba,
    primarySample,
    averageWallWatts: average(wallWatts),
    averageHashrate: average(hashrates) ?? 0,
    effectiveHashrate: average(effectiveHashrates) ?? 0,
    bestJoulesPerTerahash: joulesPerTerahash.length > 0 ? Math.min(...joulesPerTerahash) : null,
    effectiveJoulesPerTerahash: joulesPerTerahashFrom(average(wallWatts), average(effectiveHashrates) ?? 0),
    maxObservedTempC: maxValue(temps),
    maxObservedNoiseDba: maxValue(noise),
    shareWasteRatio: primarySample ? shareWasteRatioFor(primarySample) : null,
    missingEvidence,
    summary: status === "passed"
      ? `${usableSamples.length} hardware operating sample${usableSamples.length === 1 ? "" : "s"} prove wall power, thermal, noise, and share quality.`
      : `Hardware operating evidence is ${status}; missing ${missingEvidence.slice(0, 3).join(", ")}.`,
    nextStep: nextStepFor(status, missingEvidence),
  };
}

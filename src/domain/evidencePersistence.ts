import type { TuningObservation, TuningPowerEvidenceStatus } from "./efficiencyTuning.js";
import {
  DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT,
} from "./externalHashHistory.js";
import type { ExternalHashHistorySample } from "./externalHashHistory.js";
import type {
  HashHardwareOperatingEvidenceSample,
  HashHardwarePowerEvidenceSource,
} from "./hashHardwareOperatingEvidence.js";

export const MINING_EVIDENCE_STORAGE_VERSION = 1;
export const TUNING_EVIDENCE_STORAGE_KEY = "btc-lottery-pet:evidence:v1:tuning-observations";
export const TUNING_REPLICATION_HISTORY_STORAGE_KEY = "btc-lottery-pet:evidence:v1:tuning-replication-history";
export const EXTERNAL_HASH_EVIDENCE_STORAGE_KEY = "btc-lottery-pet:evidence:v1:external-hash-history";
export const EXTERNAL_HASH_OPERATING_EVIDENCE_STORAGE_KEY = "btc-lottery-pet:evidence:v1:external-operating-evidence";
export const DEFAULT_TUNING_OBSERVATION_STORAGE_LIMIT = 40;
export const DEFAULT_TUNING_REPLICATION_HISTORY_STORAGE_LIMIT = 120;
export const DEFAULT_EXTERNAL_OPERATING_EVIDENCE_STORAGE_LIMIT = 24;

export interface MiningEvidenceSnapshot {
  version: typeof MINING_EVIDENCE_STORAGE_VERSION;
  savedAt: string;
  tuningObservations: TuningObservation[];
  tuningObservationHistory: TuningObservation[];
  externalHashHistory: ExternalHashHistorySample[];
  externalOperatingEvidence: HashHardwareOperatingEvidenceSample[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function finitePositive(value: unknown) {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue > 0 ? numericValue : null;
}

function finiteNonNegative(value: unknown) {
  const numericValue = finiteNumber(value);
  return numericValue !== null && numericValue >= 0 ? numericValue : null;
}

function boundedNumber(value: unknown, min: number, max: number) {
  const numericValue = finiteNumber(value);
  if (numericValue === null || numericValue < min || numericValue > max) {
    return null;
  }
  return numericValue;
}

function boundedInteger(value: unknown, min: number, max: number) {
  const numericValue = finiteNumber(value);
  if (numericValue === null) {
    return null;
  }
  return Math.min(max, Math.max(min, Math.trunc(numericValue)));
}

function limitedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function booleanOrNull(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function powerEvidenceStatus(value: unknown): TuningPowerEvidenceStatus | null {
  return value === "estimated" || value === "measured" ? value : null;
}

function hashHardwarePowerEvidenceSource(value: unknown): HashHardwarePowerEvidenceSource | null {
  return value === "wall_meter" || value === "trusted_device_telemetry" || value === "estimated" ? value : null;
}

function clampLimit(limit: number | null | undefined, fallback: number) {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return fallback;
  }
  return Math.max(1, Math.trunc(limit));
}

function sanitizeTuningObservation(value: unknown): TuningObservation | null {
  if (!isRecord(value)) {
    return null;
  }
  const stepId = limitedText(value.stepId, 96);
  const hashrate = finitePositive(value.hashrate);
  if (!stepId || hashrate === null) {
    return null;
  }

  return {
    stepId,
    capturedAt: limitedText(value.capturedAt, 64) || null,
    hashrate,
    watts: finitePositive(value.watts),
    powerEvidenceStatus: powerEvidenceStatus(value.powerEvidenceStatus),
    acceptedShares: boundedInteger(value.acceptedShares, 0, Number.MAX_SAFE_INTEGER),
    rejectedShares: boundedInteger(value.rejectedShares, 0, Number.MAX_SAFE_INTEGER),
    staleSharesDropped: boundedInteger(value.staleSharesDropped, 0, Number.MAX_SAFE_INTEGER),
    queuedSharesDropped: boundedInteger(value.queuedSharesDropped, 0, Number.MAX_SAFE_INTEGER),
    gpuDispatchMs: boundedInteger(value.gpuDispatchMs, 0, Number.MAX_SAFE_INTEGER),
    gpuThrottleMs: boundedInteger(value.gpuThrottleMs, 0, Number.MAX_SAFE_INTEGER),
    sampleSeconds: boundedInteger(value.sampleSeconds, 1, 86_400),
    tempC: boundedNumber(value.tempC, -40, 150),
    vrTempC: boundedNumber(value.vrTempC, -40, 150),
    fanRpm: boundedInteger(value.fanRpm, 0, 100_000),
    miningPaused: booleanOrNull(value.miningPaused),
  };
}

function sanitizeExternalHashSample(value: unknown): ExternalHashHistorySample | null {
  if (!isRecord(value)) {
    return null;
  }
  const generatedAt = limitedText(value.generatedAt, 64);
  const endpoint = limitedText(value.endpoint, 240);
  if (!generatedAt || !endpoint) {
    return null;
  }

  return {
    generatedAt,
    endpoint,
    status: limitedText(value.status, 48) || "unknown",
    hashrate: finiteNonNegative(value.hashrate) ?? 0,
    watts: finitePositive(value.watts),
    joulesPerTerahash: finitePositive(value.joulesPerTerahash),
    tempC: boundedNumber(value.tempC, -40, 150),
    vrTempC: boundedNumber(value.vrTempC, -40, 150),
    fanRpm: boundedInteger(value.fanRpm, 0, 100_000),
    acceptedShares: boundedInteger(value.acceptedShares, 0, Number.MAX_SAFE_INTEGER),
    rejectedShares: boundedInteger(value.rejectedShares, 0, Number.MAX_SAFE_INTEGER),
    miningPaused: booleanOrNull(value.miningPaused),
  };
}

function sanitizeExternalOperatingEvidenceSample(value: unknown): HashHardwareOperatingEvidenceSample | null {
  if (!isRecord(value)) {
    return null;
  }
  const hashrate = finitePositive(value.hashrate);
  if (hashrate === null) {
    return null;
  }

  return {
    generatedAt: limitedText(value.generatedAt, 64) || null,
    durationSeconds: boundedInteger(value.durationSeconds, 1, 86_400),
    hashrate,
    wallWatts: finitePositive(value.wallWatts),
    joulesPerTerahash: finitePositive(value.joulesPerTerahash),
    powerEvidenceSource: hashHardwarePowerEvidenceSource(value.powerEvidenceSource),
    tempC: boundedNumber(value.tempC, -40, 150),
    vrTempC: boundedNumber(value.vrTempC, -40, 150),
    fanRpm: boundedInteger(value.fanRpm, 0, 100_000),
    noiseDba: boundedNumber(value.noiseDba, 0, 140),
    acceptedShares: boundedInteger(value.acceptedShares, 0, Number.MAX_SAFE_INTEGER),
    rejectedShares: boundedInteger(value.rejectedShares, 0, Number.MAX_SAFE_INTEGER),
    staleSharesDropped: boundedInteger(value.staleSharesDropped, 0, Number.MAX_SAFE_INTEGER),
    queuedSharesDropped: boundedInteger(value.queuedSharesDropped, 0, Number.MAX_SAFE_INTEGER),
    miningPaused: booleanOrNull(value.miningPaused),
  };
}

export function sanitizeTuningObservationsForStorage(
  observations: unknown,
  limit = DEFAULT_TUNING_OBSERVATION_STORAGE_LIMIT,
): TuningObservation[] {
  if (!Array.isArray(observations)) {
    return [];
  }
  const deduped: TuningObservation[] = [];
  for (const value of observations) {
    const observation = sanitizeTuningObservation(value);
    if (!observation) {
      continue;
    }
    const existingIndex = deduped.findIndex((current) => current.stepId === observation.stepId);
    if (existingIndex >= 0) {
      deduped.splice(existingIndex, 1);
    }
    deduped.push(observation);
  }
  return deduped.slice(-clampLimit(limit, DEFAULT_TUNING_OBSERVATION_STORAGE_LIMIT));
}


function tuningObservationHistoryKey(observation: TuningObservation) {
  const timeKey = observation.capturedAt || [
    observation.hashrate,
    observation.watts ?? "",
    observation.sampleSeconds ?? "",
    observation.acceptedShares ?? "",
    observation.rejectedShares ?? "",
    observation.staleSharesDropped ?? "",
    observation.queuedSharesDropped ?? "",
  ].join(":");
  return `${observation.stepId}|${timeKey}`;
}

export function sanitizeTuningObservationHistoryForStorage(
  observations: unknown,
  limit = DEFAULT_TUNING_REPLICATION_HISTORY_STORAGE_LIMIT,
): TuningObservation[] {
  if (!Array.isArray(observations)) {
    return [];
  }
  const deduped: TuningObservation[] = [];
  const seen = new Set<string>();
  for (const value of observations) {
    const observation = sanitizeTuningObservation(value);
    if (!observation) {
      continue;
    }
    const key = tuningObservationHistoryKey(observation);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(observation);
  }
  return deduped.slice(0, clampLimit(limit, DEFAULT_TUNING_REPLICATION_HISTORY_STORAGE_LIMIT));
}

export function appendTuningObservationHistory(
  current: unknown,
  observation: TuningObservation,
  capturedAt = new Date().toISOString(),
  limit = DEFAULT_TUNING_REPLICATION_HISTORY_STORAGE_LIMIT,
): TuningObservation[] {
  return sanitizeTuningObservationHistoryForStorage([
    {
      ...observation,
      capturedAt,
    },
    ...(Array.isArray(current) ? current : []),
  ], limit);
}
export function sanitizeExternalHashHistoryForStorage(
  history: unknown,
  limit = DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT,
): ExternalHashHistorySample[] {
  if (!Array.isArray(history)) {
    return [];
  }
  const deduped: ExternalHashHistorySample[] = [];
  for (const value of history) {
    const sample = sanitizeExternalHashSample(value);
    if (!sample) {
      continue;
    }
    const exists = deduped.some((current) => (
      current.generatedAt === sample.generatedAt && current.endpoint === sample.endpoint
    ));
    if (!exists) {
      deduped.push(sample);
    }
  }
  return deduped.slice(0, clampLimit(limit, DEFAULT_EXTERNAL_HASH_HISTORY_LIMIT));
}

function externalOperatingEvidenceKey(sample: HashHardwareOperatingEvidenceSample) {
  return [
    sample.generatedAt ?? "",
    sample.hashrate ?? "",
    sample.durationSeconds ?? "",
    sample.wallWatts ?? "",
    sample.noiseDba ?? "",
  ].join("|");
}

export function sanitizeExternalOperatingEvidenceForStorage(
  samples: unknown,
  limit = DEFAULT_EXTERNAL_OPERATING_EVIDENCE_STORAGE_LIMIT,
): HashHardwareOperatingEvidenceSample[] {
  if (!Array.isArray(samples)) {
    return [];
  }
  const deduped: HashHardwareOperatingEvidenceSample[] = [];
  const seen = new Set<string>();
  for (const value of samples) {
    const sample = sanitizeExternalOperatingEvidenceSample(value);
    if (!sample) {
      continue;
    }
    const key = externalOperatingEvidenceKey(sample);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(sample);
  }
  return deduped.slice(0, clampLimit(limit, DEFAULT_EXTERNAL_OPERATING_EVIDENCE_STORAGE_LIMIT));
}

export function appendExternalOperatingEvidenceSample(
  current: unknown,
  sample: HashHardwareOperatingEvidenceSample,
  capturedAt = new Date().toISOString(),
  limit = DEFAULT_EXTERNAL_OPERATING_EVIDENCE_STORAGE_LIMIT,
): HashHardwareOperatingEvidenceSample[] {
  return sanitizeExternalOperatingEvidenceForStorage([
    {
      ...sample,
      generatedAt: sample.generatedAt || capturedAt,
    },
    ...(Array.isArray(current) ? current : []),
  ], limit);
}

export function createMiningEvidenceSnapshot(
  tuningObservations: unknown,
  externalHashHistory: unknown,
  savedAt = new Date().toISOString(),
  tuningObservationHistory: unknown = tuningObservations,
  externalOperatingEvidence: unknown = [],
): MiningEvidenceSnapshot {
  return {
    version: MINING_EVIDENCE_STORAGE_VERSION,
    savedAt,
    tuningObservations: sanitizeTuningObservationsForStorage(tuningObservations),
    tuningObservationHistory: sanitizeTuningObservationHistoryForStorage(tuningObservationHistory),
    externalHashHistory: sanitizeExternalHashHistoryForStorage(externalHashHistory),
    externalOperatingEvidence: sanitizeExternalOperatingEvidenceForStorage(externalOperatingEvidence),
  };
}

export function parseMiningEvidenceSnapshot(value: unknown): MiningEvidenceSnapshot {
  if (!isRecord(value)) {
    return createMiningEvidenceSnapshot([], [], "");
  }
  return createMiningEvidenceSnapshot(
    value.tuningObservations,
    value.externalHashHistory,
    limitedText(value.savedAt, 64),
    value.tuningObservationHistory ?? value.tuningObservations,
    value.externalOperatingEvidence,
  );
}

export function parseMiningEvidenceSnapshotJson(text: string | null): MiningEvidenceSnapshot {
  if (!text) {
    return createMiningEvidenceSnapshot([], [], "");
  }
  try {
    return parseMiningEvidenceSnapshot(JSON.parse(text));
  } catch {
    return createMiningEvidenceSnapshot([], [], "");
  }
}

export function serializeMiningEvidenceSnapshot(snapshot: MiningEvidenceSnapshot): string {
  return JSON.stringify(parseMiningEvidenceSnapshot(snapshot));
}

export function parseTuningObservationsStorageJson(text: string | null): TuningObservation[] {
  if (!text) {
    return [];
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value)
      ? sanitizeTuningObservationsForStorage(value.tuningObservations)
      : sanitizeTuningObservationsForStorage(value);
  } catch {
    return [];
  }
}

export function serializeTuningObservationsForStorage(observations: unknown): string {
  return JSON.stringify(sanitizeTuningObservationsForStorage(observations));
}


export function parseTuningReplicationHistoryStorageJson(text: string | null): TuningObservation[] {
  if (!text) {
    return [];
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value)
      ? sanitizeTuningObservationHistoryForStorage(value.tuningObservationHistory)
      : sanitizeTuningObservationHistoryForStorage(value);
  } catch {
    return [];
  }
}

export function serializeTuningReplicationHistoryForStorage(history: unknown): string {
  return JSON.stringify(sanitizeTuningObservationHistoryForStorage(history));
}
export function parseExternalHashHistoryStorageJson(text: string | null): ExternalHashHistorySample[] {
  if (!text) {
    return [];
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value)
      ? sanitizeExternalHashHistoryForStorage(value.externalHashHistory)
      : sanitizeExternalHashHistoryForStorage(value);
  } catch {
    return [];
  }
}

export function serializeExternalHashHistoryForStorage(history: unknown): string {
  return JSON.stringify(sanitizeExternalHashHistoryForStorage(history));
}

export function parseExternalOperatingEvidenceStorageJson(text: string | null): HashHardwareOperatingEvidenceSample[] {
  if (!text) {
    return [];
  }
  try {
    const value = JSON.parse(text);
    return isRecord(value)
      ? sanitizeExternalOperatingEvidenceForStorage(value.externalOperatingEvidence)
      : sanitizeExternalOperatingEvidenceForStorage(value);
  } catch {
    return [];
  }
}

export function serializeExternalOperatingEvidenceForStorage(samples: unknown): string {
  return JSON.stringify(sanitizeExternalOperatingEvidenceForStorage(samples));
}
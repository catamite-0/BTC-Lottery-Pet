import type { TuningObservation } from "./efficiencyTuning.js";
import {
  createMiningEvidenceSnapshot,
} from "./evidencePersistence.js";
import {
  summarizeExternalHashHistory,
} from "./externalHashHistory.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import {
  OPTIMIZATION_MAX_SHARE_WASTE_RATIO,
  OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
  OPTIMIZATION_MIN_SHARE_EVENTS,
  OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
} from "./optimizationThresholds.js";
import { calculateStabilityWindow } from "./stabilityWindow.js";
import type { StabilityWindowStatus } from "./stabilityWindow.js";
import { calculateThermalGuard } from "./thermalGuard.js";
import type { ThermalGuardStatus } from "./thermalGuard.js";

export const OPTIMIZATION_EVIDENCE_SCHEMA_VERSION = 1;
export const OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS = OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS;

export type OptimizationEvidenceStatus = "missing" | "thin" | "ready";
export type OptimizationOperatingGoal = "lowest_power" | "max_efficiency" | "balanced" | "max_hashrate";
export type OptimizationOperatingCandidateStatus = "missing" | "provisional" | "qualified";

export interface OptimizationEvidenceLocalSummary {
  sampleCount: number;
  measuredPowerSampleCount: number;
  estimatedPowerSampleCount: number;
  provenShareSampleCount: number;
  totalShareEvents: number;
  totalAcceptedShares: number;
  totalRejectedShares: number;
  totalDroppedShares: number;
  bestHashrate: number;
  bestRawHashrate: number;
  bestEffectiveHashrate: number;
  lowestMeasuredWatts: number | null;
  sampleStepIds: string[];
  powerEvidenceStatus: OptimizationEvidenceStatus;
  shareEvidenceStatus: OptimizationEvidenceStatus;
}

export interface OptimizationEvidenceExternalSummary {
  sampleCount: number;
  onlineSampleCount: number;
  efficiencySampleCount: number;
  usableEfficiencySampleCount: number;
  externalEvidenceStatus: ExternalHashHistorySummary["evidenceStatus"];
  externalEvidenceReady: boolean;
  externalEvidenceGap: number;
  latestStatus: string | null;
  endpointRecorded: boolean;
  averageHashrate: number;
  averageWatts: number | null;
  averageJoulesPerTerahash: number | null;
  bestJoulesPerTerahash: number | null;
  trend: ExternalHashHistorySummary["trend"];
  efficiencyEvidenceStatus: OptimizationEvidenceStatus;
}

export interface OptimizationOperatingCandidate {
  goal: OptimizationOperatingGoal;
  status: OptimizationOperatingCandidateStatus;
  stepId: string | null;
  hashrate: number | null;
  rawHashrate: number | null;
  effectiveHashrate: number | null;
  watts: number | null;
  joulesPerTerahash: number | null;
  shareWasteRatio: number | null;
  totalShareEvents: number;
  measuredPower: boolean;
  sampleSeconds: number | null;
  requiredSampleSeconds: number;
  stabilityWindowStatus: StabilityWindowStatus;
  stabilityWindowProgress: number;
  thermalStatus: ThermalGuardStatus;
  maxObservedTempC: number | null;
  score: number;
  summary: string;
  nextStep: string;
}

export interface OptimizationOperatingPlan {
  candidates: OptimizationOperatingCandidate[];
  qualifiedCandidateCount: number;
  preferredGoal: OptimizationOperatingGoal;
  primaryCandidate: OptimizationOperatingCandidate | null;
  summary: string;
}

export interface OptimizationEvidenceReadinessHints {
  localEvidenceReady: boolean;
  externalEfficiencyReady: boolean;
  nextEvidenceGap: string;
}

export interface OptimizationEvidenceSnapshot {
  schemaVersion: typeof OPTIMIZATION_EVIDENCE_SCHEMA_VERSION;
  generatedAt: string;
  storageVersion: number;
  privacyNote: string;
  localTuning: OptimizationEvidenceLocalSummary;
  externalHash: OptimizationEvidenceExternalSummary;
  operatingPlan: OptimizationOperatingPlan;
  readinessHints: OptimizationEvidenceReadinessHints;
}

interface LocalObservationMetrics {
  stepId: string;
  rawHashrate: number;
  hashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  shareWasteRatio: number | null;
  totalShareEvents: number;
  measuredPower: boolean;
  sampleSeconds: number | null;
  requiredSampleSeconds: number;
  stabilityWindowStatus: StabilityWindowStatus;
  stabilityWindowProgress: number;
  thermalStatus: ThermalGuardStatus;
  thermalWeight: number;
  maxObservedTempC: number | null;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function safeCounter(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function shareEvents(observation: TuningObservation) {
  return {
    accepted: safeCounter(observation.acceptedShares),
    rejected: safeCounter(observation.rejectedShares),
    dropped: safeCounter(observation.staleSharesDropped) + safeCounter(observation.queuedSharesDropped),
  };
}

function evidenceStatus(count: number, readyThreshold: number): OptimizationEvidenceStatus {
  if (count <= 0) {
    return "missing";
  }
  return count >= readyThreshold ? "ready" : "thin";
}

function joulesPerTerahash(hashrate: number, watts: number | null) {
  if (!finitePositive(hashrate) || !finitePositive(watts)) {
    return null;
  }
  return Number(watts) * 1_000_000_000_000 / hashrate;
}

function usefulHashrate(
  rawHashrate: number,
  shareWasteRatio: number | null,
  stabilityWeight: number,
  thermalWeight: number,
) {
  const shareWeight = shareWasteRatio === null ? 1 : Math.max(0, 1 - Math.min(1, shareWasteRatio));
  return Math.max(0, rawHashrate * shareWeight * stabilityWeight * thermalWeight);
}

function observationMetrics(observation: TuningObservation): LocalObservationMetrics | null {
  if (!finitePositive(observation.hashrate)) {
    return null;
  }
  const events = shareEvents(observation);
  const totalShareEvents = events.accepted + events.rejected + events.dropped;
  const wastedShares = events.rejected + events.dropped;
  const watts = finitePositive(observation.watts) ? Number(observation.watts) : null;
  const sampleSeconds = finitePositive(observation.sampleSeconds) ? Number(observation.sampleSeconds) : null;
  const shareWasteRatio = totalShareEvents > 0 ? wastedShares / totalShareEvents : null;
  const thermal = calculateThermalGuard({
    tempC: observation.tempC,
    vrTempC: observation.vrTempC,
    fanRpm: observation.fanRpm,
    miningPaused: observation.miningPaused,
  });
  const stabilityWindow = calculateStabilityWindow({
    sampleSeconds,
    rejectedShareRatio: shareWasteRatio,
    thermalStatus: thermal.status,
    requiredSeconds: OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
  });
  const rawHashrate = Number(observation.hashrate);
  const effectiveHashrate = usefulHashrate(
    rawHashrate,
    shareWasteRatio,
    stabilityWindow.qualityWeight,
    thermal.qualityWeight,
  );
  return {
    stepId: observation.stepId,
    rawHashrate,
    hashrate: effectiveHashrate,
    watts,
    joulesPerTerahash: joulesPerTerahash(effectiveHashrate, watts),
    shareWasteRatio,
    totalShareEvents,
    measuredPower: watts !== null && observation.powerEvidenceStatus === "measured",
    sampleSeconds,
    requiredSampleSeconds: stabilityWindow.requiredSeconds,
    stabilityWindowStatus: stabilityWindow.status,
    stabilityWindowProgress: stabilityWindow.progress,
    thermalStatus: thermal.status,
    thermalWeight: thermal.qualityWeight,
    maxObservedTempC: thermal.maxObservedTempC,
  };
}

function summarizeLocalTuning(observations: TuningObservation[]): OptimizationEvidenceLocalSummary {
  let totalAcceptedShares = 0;
  let totalRejectedShares = 0;
  let totalDroppedShares = 0;
  let provenShareSampleCount = 0;
  let measuredPowerSampleCount = 0;
  let estimatedPowerSampleCount = 0;
  let bestHashrate = 0;
  let bestRawHashrate = 0;
  let bestEffectiveHashrate = 0;
  let lowestMeasuredWatts: number | null = null;

  for (const observation of observations) {
    const events = shareEvents(observation);
    const totalEvents = events.accepted + events.rejected + events.dropped;
    totalAcceptedShares += events.accepted;
    totalRejectedShares += events.rejected;
    totalDroppedShares += events.dropped;
    if (totalEvents >= OPTIMIZATION_MIN_SHARE_EVENTS) {
      provenShareSampleCount += 1;
    }
    const metrics = observationMetrics(observation);
    if (metrics) {
      bestRawHashrate = Math.max(bestRawHashrate, metrics.rawHashrate);
      bestEffectiveHashrate = Math.max(bestEffectiveHashrate, metrics.hashrate);
      bestHashrate = bestEffectiveHashrate;
    }
    if (finitePositive(observation.watts) && observation.powerEvidenceStatus === "measured") {
      measuredPowerSampleCount += 1;
      lowestMeasuredWatts = lowestMeasuredWatts === null
        ? Number(observation.watts)
        : Math.min(lowestMeasuredWatts, Number(observation.watts));
    } else if (finitePositive(observation.watts)) {
      estimatedPowerSampleCount += 1;
    }
  }

  const totalShareEvents = totalAcceptedShares + totalRejectedShares + totalDroppedShares;
  return {
    sampleCount: observations.length,
    measuredPowerSampleCount,
    estimatedPowerSampleCount,
    provenShareSampleCount,
    totalShareEvents,
    totalAcceptedShares,
    totalRejectedShares,
    totalDroppedShares,
    bestHashrate,
    bestRawHashrate,
    bestEffectiveHashrate,
    lowestMeasuredWatts,
    sampleStepIds: observations.map((observation) => observation.stepId),
    powerEvidenceStatus: evidenceStatus(measuredPowerSampleCount, 1),
    shareEvidenceStatus: evidenceStatus(totalShareEvents, OPTIMIZATION_MIN_SHARE_EVENTS),
  };
}

function candidateStatus(metrics: LocalObservationMetrics | null): OptimizationOperatingCandidateStatus {
  if (!metrics) {
    return "missing";
  }
  if (
    metrics.measuredPower &&
    metrics.totalShareEvents >= OPTIMIZATION_MIN_SHARE_EVENTS &&
    (metrics.shareWasteRatio ?? 0) <= OPTIMIZATION_MAX_SHARE_WASTE_RATIO &&
    metrics.stabilityWindowStatus === "stable" &&
    metrics.thermalStatus !== "hot" &&
    metrics.thermalStatus !== "critical" &&
    metrics.thermalStatus !== "paused"
  ) {
    return "qualified";
  }
  return "provisional";
}

function candidateGaps(metrics: LocalObservationMetrics | null) {
  if (!metrics) {
    return ["capture a matching local tuning sample"];
  }
  const gaps: string[] = [];
  if (!metrics.measuredPower) {
    gaps.push("measured watts missing");
  }
  if (metrics.totalShareEvents < OPTIMIZATION_MIN_SHARE_EVENTS) {
    gaps.push("share evidence thin");
  }
  if (metrics.shareWasteRatio !== null && metrics.shareWasteRatio > OPTIMIZATION_MAX_SHARE_WASTE_RATIO) {
    gaps.push("share waste above 5%");
  }
  if (metrics.sampleSeconds === null) {
    gaps.push("timed sample missing");
  } else if (metrics.sampleSeconds < metrics.requiredSampleSeconds) {
    gaps.push(`needs stable ${Math.round(metrics.requiredSampleSeconds / 60)} minute runtime (${Math.ceil((metrics.requiredSampleSeconds - metrics.sampleSeconds) / 60)} more min)`);
  }
  if (metrics.stabilityWindowStatus === "noisy") {
    gaps.push("long-run window noisy");
  } else if (metrics.stabilityWindowStatus === "unstable") {
    gaps.push("long-run window unstable");
  } else if (metrics.stabilityWindowStatus === "unsafe") {
    gaps.push("long-run window unsafe");
  }
  if (metrics.thermalStatus === "hot") {
    gaps.push("thermal headroom tight");
  } else if (metrics.thermalStatus === "critical" || metrics.thermalStatus === "paused") {
    gaps.push("thermal state unsafe");
  }
  return gaps;
}

function goalLabel(goal: OptimizationOperatingGoal) {
  switch (goal) {
    case "lowest_power":
      return "Lowest power";
    case "max_efficiency":
      return "Max efficiency";
    case "balanced":
      return "Balanced";
    case "max_hashrate":
      return "Max hashrate";
  }
}

function createCandidate(
  goal: OptimizationOperatingGoal,
  metrics: LocalObservationMetrics | null,
  score: number,
): OptimizationOperatingCandidate {
  const status = candidateStatus(metrics);
  const gaps = candidateGaps(metrics);
  const label = goalLabel(goal);
  return {
    goal,
    status,
    stepId: metrics?.stepId ?? null,
    hashrate: metrics?.hashrate ?? null,
    rawHashrate: metrics?.rawHashrate ?? null,
    effectiveHashrate: metrics?.hashrate ?? null,
    watts: metrics?.watts ?? null,
    joulesPerTerahash: metrics?.joulesPerTerahash ?? null,
    shareWasteRatio: metrics?.shareWasteRatio ?? null,
    totalShareEvents: metrics?.totalShareEvents ?? 0,
    measuredPower: metrics?.measuredPower ?? false,
    sampleSeconds: metrics?.sampleSeconds ?? null,
    requiredSampleSeconds: metrics?.requiredSampleSeconds ?? OPERATING_CANDIDATE_REQUIRED_SAMPLE_SECONDS,
    stabilityWindowStatus: metrics?.stabilityWindowStatus ?? "unknown",
    stabilityWindowProgress: metrics?.stabilityWindowProgress ?? 0,
    thermalStatus: metrics?.thermalStatus ?? "unknown",
    maxObservedTempC: metrics?.maxObservedTempC ?? null,
    score,
    summary: !metrics
      ? `${label} candidate is waiting for local tuning evidence.`
      : status === "qualified"
        ? `${label} candidate ${metrics.stepId} is qualified for unattended validation.`
        : `${label} candidate ${metrics.stepId} is provisional: ${gaps.join(", ")}.`,
    nextStep: status === "qualified"
      ? "Keep this point running and compare it against wall-power, thermal, and share-quality history before packaging it as the default."
      : `Before adopting this point, ${gaps.join(", ")}.`,
  };
}

function selectLowestPower(metrics: LocalObservationMetrics[]) {
  const withWatts = metrics.filter((metric) => finitePositive(metric.watts));
  if (withWatts.length === 0) {
    return null;
  }
  return [...withWatts].sort((left, right) => Number(left.watts) - Number(right.watts))[0];
}

function selectMaxEfficiency(metrics: LocalObservationMetrics[]) {
  const withEfficiency = metrics.filter((metric) => finitePositive(metric.joulesPerTerahash));
  if (withEfficiency.length === 0) {
    return null;
  }
  return [...withEfficiency].sort((left, right) => Number(left.joulesPerTerahash) - Number(right.joulesPerTerahash))[0];
}

function selectMaxHashrate(metrics: LocalObservationMetrics[]) {
  if (metrics.length === 0) {
    return null;
  }
  return [...metrics].sort((left, right) => right.hashrate - left.hashrate)[0];
}

function balancedScore(metric: LocalObservationMetrics, maxHashrate: number, bestJoules: number) {
  const hashScore = finitePositive(maxHashrate) ? metric.hashrate / maxHashrate : 0;
  const efficiencyScore = finitePositive(metric.joulesPerTerahash) && finitePositive(bestJoules)
    ? bestJoules / Number(metric.joulesPerTerahash)
    : 0.35;
  const wasteScore = metric.shareWasteRatio === null
    ? 0.75
    : Math.max(0.2, 1 - Math.min(1, metric.shareWasteRatio) * 2);
  const powerEvidenceWeight = metric.measuredPower ? 1 : 0.85;
  const shareEvidenceWeight = metric.totalShareEvents >= OPTIMIZATION_MIN_SHARE_EVENTS ? 1 : metric.totalShareEvents > 0 ? 0.85 : 0.7;
  const stabilityWeight =
    metric.stabilityWindowStatus === "stable" ? 1 :
      metric.stabilityWindowStatus === "noisy" ? 0.86 :
        metric.stabilityWindowStatus === "probing" ? 0.72 :
          metric.stabilityWindowStatus === "unknown" ? 0.7 : 0.45;
  return Math.round(
    Math.max(0, Math.min(1, (
      hashScore * 0.42 + efficiencyScore * 0.42 + wasteScore * 0.16
    ) * powerEvidenceWeight * shareEvidenceWeight * stabilityWeight * metric.thermalWeight)) * 100,
  );
}

function selectBalanced(metrics: LocalObservationMetrics[]) {
  if (metrics.length === 0) {
    return { metric: null, score: 0 };
  }
  const maxHashrate = Math.max(...metrics.map((metric) => metric.hashrate));
  const joulesValues = metrics
    .map((metric) => metric.joulesPerTerahash)
    .filter((value): value is number => finitePositive(value));
  const bestJoules = joulesValues.length > 0 ? Math.min(...joulesValues) : 0;
  return metrics
    .map((metric) => ({ metric, score: balancedScore(metric, maxHashrate, bestJoules) }))
    .sort((left, right) => right.score - left.score)[0];
}

function normalizeOperatingGoal(goal: OptimizationOperatingGoal | null | undefined): OptimizationOperatingGoal {
  switch (goal) {
    case "lowest_power":
    case "max_efficiency":
    case "balanced":
    case "max_hashrate":
      return goal;
    default:
      return "balanced";
  }
}

function deriveOperatingPlan(
  observations: TuningObservation[],
  preferredGoal: OptimizationOperatingGoal = "balanced",
): OptimizationOperatingPlan {
  const metrics = observations
    .map(observationMetrics)
    .filter((metric): metric is LocalObservationMetrics => metric !== null);
  const lowestPower = selectLowestPower(metrics);
  const maxEfficiency = selectMaxEfficiency(metrics);
  const maxHashrate = selectMaxHashrate(metrics);
  const balanced = selectBalanced(metrics);
  const normalizedGoal = normalizeOperatingGoal(preferredGoal);
  const candidates = [
    createCandidate("lowest_power", lowestPower, lowestPower ? balancedScore(lowestPower, maxHashrate?.hashrate ?? 0, maxEfficiency?.joulesPerTerahash ?? 0) : 0),
    createCandidate("max_efficiency", maxEfficiency, maxEfficiency ? balancedScore(maxEfficiency, maxHashrate?.hashrate ?? 0, maxEfficiency.joulesPerTerahash ?? 0) : 0),
    createCandidate("balanced", balanced.metric, balanced.score),
    createCandidate("max_hashrate", maxHashrate, maxHashrate ? balancedScore(maxHashrate, maxHashrate.hashrate, maxEfficiency?.joulesPerTerahash ?? 0) : 0),
  ];
  const qualified = candidates.filter((candidate) => candidate.status === "qualified");
  const preferredCandidate = candidates.find((candidate) => candidate.goal === normalizedGoal && candidate.status !== "missing") ?? null;
  const primaryCandidate = preferredCandidate ??
    qualified.find((candidate) => candidate.goal === "balanced") ??
    qualified.find((candidate) => candidate.goal === "max_efficiency") ??
    qualified.find((candidate) => candidate.goal === "lowest_power") ??
    qualified[0] ??
    candidates.find((candidate) => candidate.status === "provisional") ??
    null;

  return {
    candidates,
    qualifiedCandidateCount: qualified.length,
    preferredGoal: normalizedGoal,
    primaryCandidate,
    summary: primaryCandidate
      ? `Operating plan: ${qualified.length} qualified candidate${qualified.length === 1 ? "" : "s"}; preferred ${normalizedGoal.replace(/_/g, " ")} primary ${primaryCandidate.goal.replace(/_/g, " ")} is ${primaryCandidate.status}.`
      : `Operating plan is waiting for local tuning evidence for ${normalizedGoal.replace(/_/g, " ")}.`,
  };
}

function summarizeExternal(summary: ExternalHashHistorySummary): OptimizationEvidenceExternalSummary {
  const sampleEvidenceStatus = evidenceStatus(
    summary.usableEfficiencySampleCount,
    OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
  );
  const efficiencyEvidenceStatus = summary.evidenceReady && summary.trend !== "degrading"
    ? "ready"
    : summary.trend === "degrading" && summary.usableEfficiencySampleCount > 0
      ? "thin"
      : sampleEvidenceStatus;

  return {
    sampleCount: summary.sampleCount,
    onlineSampleCount: summary.onlineSampleCount,
    efficiencySampleCount: summary.efficiencySampleCount,
    usableEfficiencySampleCount: summary.usableEfficiencySampleCount,
    externalEvidenceStatus: summary.evidenceStatus,
    externalEvidenceReady: summary.evidenceReady,
    externalEvidenceGap: summary.evidenceGap,
    latestStatus: summary.latestSample?.status ?? null,
    endpointRecorded: Boolean(summary.latestSample?.endpoint),
    averageHashrate: summary.averageHashrate,
    averageWatts: summary.averageWatts,
    averageJoulesPerTerahash: summary.averageJoulesPerTerahash,
    bestJoulesPerTerahash: summary.bestJoulesPerTerahash,
    trend: summary.trend,
    efficiencyEvidenceStatus,
  };
}

function nextEvidenceGap(
  local: OptimizationEvidenceLocalSummary,
  external: OptimizationEvidenceExternalSummary,
  operatingPlan: OptimizationOperatingPlan,
) {
  if (local.sampleCount <= 0) {
    return "Capture a local CPU/GPU tuning sample with hashrate and share counters.";
  }
  if (local.powerEvidenceStatus !== "ready") {
    return "Add measured wall-power or device-power watts for at least one local tuning sample.";
  }
  if (local.shareEvidenceStatus !== "ready") {
    return "Keep sampling until accepted, rejected, stale, or queued share events prove useful work.";
  }
  if (operatingPlan.primaryCandidate && operatingPlan.primaryCandidate.status !== "qualified") {
    return operatingPlan.primaryCandidate.nextStep;
  }
  if (operatingPlan.qualifiedCandidateCount <= 0) {
    return "Extend at least one local operating point through a stable 15 minute runtime window with safe thermals and low share waste.";
  }
  if (external.sampleCount > 0 && external.efficiencyEvidenceStatus !== "ready") {
    return external.externalEvidenceGap > 0
      ? `Collect ${external.externalEvidenceGap} more usable external efficiency sample${external.externalEvidenceGap === 1 ? "" : "s"} before comparing ASIC routing.`
      : "Keep sampling until external efficiency stops degrading before comparing ASIC routing.";
  }
  return "Extend the stability window with long-run thermal, share, and wall-power evidence.";
}

export function createOptimizationEvidenceSnapshot({
  tuningObservations,
  externalHashHistory,
  preferredGoal = "balanced",
  generatedAt = new Date().toISOString(),
}: {
  tuningObservations: unknown;
  externalHashHistory: unknown;
  preferredGoal?: OptimizationOperatingGoal | null;
  generatedAt?: string;
}): OptimizationEvidenceSnapshot {
  const evidence = createMiningEvidenceSnapshot(tuningObservations, externalHashHistory, generatedAt);
  const local = summarizeLocalTuning(evidence.tuningObservations);
  const external = summarizeExternal(summarizeExternalHashHistory(evidence.externalHashHistory));
  const operatingPlan = deriveOperatingPlan(evidence.tuningObservations, normalizeOperatingGoal(preferredGoal));

  return {
    schemaVersion: OPTIMIZATION_EVIDENCE_SCHEMA_VERSION,
    generatedAt,
    storageVersion: evidence.version,
    privacyNote: "Optimization evidence excludes BTC address, pool password, webhook URL, raw endpoint host, and Stratum messages.",
    localTuning: local,
    externalHash: external,
    operatingPlan,
    readinessHints: {
      localEvidenceReady: local.powerEvidenceStatus === "ready" && local.shareEvidenceStatus === "ready",
      externalEfficiencyReady: external.efficiencyEvidenceStatus === "ready",
      nextEvidenceGap: nextEvidenceGap(local, external, operatingPlan),
    },
  };
}

export function formatOptimizationEvidenceSnapshot(snapshot: OptimizationEvidenceSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}
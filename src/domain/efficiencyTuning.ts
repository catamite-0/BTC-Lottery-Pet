import {
  calculateEfficiencySnapshot,
  createEfficiencyCandidates,
} from "./efficiencyEngine.js";
import { calculateStabilityWindow } from "./stabilityWindow.js";
import type { StabilityWindowStatus } from "./stabilityWindow.js";
import { calculateThermalGuard } from "./thermalGuard.js";
import type { ThermalGuardStatus } from "./thermalGuard.js";
import type {
  EfficiencyCandidate,
  EfficiencyComputeMode,
  EfficiencyGoal,
  EfficiencyPerformancePreset,
  EfficiencySchedulerInput,
} from "./efficiencyEngine.js";
import type { HashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";
import type { HashRuntimeGuardLevel, HashRuntimeGuardSnapshot } from "./hashRuntimeGuard.js";
import { deriveHashRuntimeGuard, targetRaisesHashLoad } from "./hashRuntimeGuard.js";

export type TuningStepPriority = "baseline" | "power" | "efficiency" | "balanced" | "throughput" | "hybrid";

export interface TuningSweepInput extends EfficiencySchedulerInput {
  currentComputeMode?: EfficiencyComputeMode | null;
  currentCpuThreads?: number | null;
  currentGpuIntensityPercent?: number | null;
  maxSteps?: number | null;
  sampleSeconds?: number | null;
}

export interface TuningSweepStep {
  id: string;
  order: number;
  priority: TuningStepPriority;
  computeMode: EfficiencyComputeMode;
  performancePreset: EfficiencyPerformancePreset;
  cpuThreads: number;
  gpuIntensityPercent: number;
  sampleSeconds: number;
  estimatedHashrate: number;
  estimatedWatts: number;
  joulesPerTerahash: number | null;
  summary: string;
  reason: string;
}

export interface TuningSweepPlan {
  goal: EfficiencyGoal;
  steps: TuningSweepStep[];
  totalSeconds: number;
  summary: string;
}

export interface TuningRuntimeStepInput {
  computeMode?: EfficiencyComputeMode | null;
  cpuThreads?: number | null;
  gpuIntensityPercent?: number | null;
}

export interface TuningShareCounters {
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
}

export interface TuningObservation {
  stepId: string;
  capturedAt?: string | null;
  hashrate: number;
  watts?: number | null;
  powerEvidenceStatus?: TuningPowerEvidenceStatus | null;
  acceptedShares?: number | null;
  rejectedShares?: number | null;
  staleSharesDropped?: number | null;
  queuedSharesDropped?: number | null;
  gpuDispatchMs?: number | null;
  gpuThrottleMs?: number | null;
  sampleSeconds?: number | null;
  tempC?: number | null;
  vrTempC?: number | null;
  fanRpm?: number | null;
  miningPaused?: boolean | null;
}

export type TuningSampleStability = "stable" | "noisy" | "unstable" | "unknown";
export type TuningShareEvidenceStatus = "none" | "thin" | "proven";
export type TuningPowerEvidenceStatus = "estimated" | "measured";
export type TuningLongRunRisk = "unknown" | "excellent" | "good" | "watch" | "avoid";
export type TuningRuntimeDutyStatus = "unknown" | "full_duty" | "intentional_low_power" | "throttled";

export interface TuningObservationResult {
  step: TuningSweepStep;
  hashrate: number;
  effectiveHashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  effectiveJoulesPerTerahash: number | null;
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
  gpuDispatchMs: number;
  gpuThrottleMs: number;
  gpuDutyCycle: number | null;
  gpuThrottleRatio: number | null;
  runtimeDutyStatus: TuningRuntimeDutyStatus;
  runtimeDutyWeight: number;
  runtimeDutySummary: string;
  rejectedShareRatio: number | null;
  staleShareRatio: number | null;
  shareWasteRatio: number | null;
  shareEvidenceStatus: TuningShareEvidenceStatus;
  shareEvidenceWeight: number;
  shareEvidenceSummary: string;
  powerEvidenceStatus: TuningPowerEvidenceStatus;
  powerEvidenceWeight: number;
  powerEvidenceSummary: string;
  sampleSeconds: number | null;
  stability: TuningSampleStability;
  thermalStatus: ThermalGuardStatus;
  thermalWeight: number;
  thermalSummary: string;
  maxObservedTempC: number | null;
  stabilityWindowStatus: StabilityWindowStatus;
  stabilityWindowWeight: number;
  stabilityWindowSummary: string;
  stabilityWindowProgress: number;
  qualityScore: number;
  qualityAdjustedHashrate: number;
  qualityAdjustedJoulesPerTerahash: number | null;
  longRunScore: number;
  longRunRisk: TuningLongRunRisk;
  longRunSummary: string;
}

export type TuningResultSelection = "lowest_power" | "best_efficiency" | "best_hashrate";
export type TuningApplyEligibilityStatus = "ready" | "waiting" | "blocked";
export type TuningApplyRuntimeGuardLevel = HashRuntimeGuardLevel;

export interface TuningApplyOptionInput {
  runtimeEfficiency?: HashRuntimeEfficiencySnapshot | null;
  currentStep?: TuningSweepStep | null;
}

export interface TuningApplyOption {
  selection: TuningResultSelection;
  result: TuningObservationResult | null;
  status: TuningApplyEligibilityStatus;
  canApply: boolean;
  runtimeGuard: TuningApplyRuntimeGuardLevel;
  runtimeEfficiencyStatus: HashRuntimeEfficiencySnapshot["status"] | "not_observed";
  summary: string;
  nextStep: string;
}

export interface TuningMarginalFrontierStep {
  from: TuningObservationResult | null;
  to: TuningObservationResult;
  extraWatts: number;
  extraQualityAdjustedHashrate: number;
  marginalHashratePerWatt: number;
  previousAverageHashratePerWatt: number;
  densityRetention: number;
  acceptedByDensityKnee: boolean;
  summary: string;
}

export const TUNING_MARGINAL_DENSITY_RETENTION = 0.9;

export interface TuningAnalysis {
  results: TuningObservationResult[];
  lowestPower: TuningObservationResult | null;
  bestEfficiency: TuningObservationResult | null;
  bestHashrate: TuningObservationResult | null;
  paretoFrontier: TuningObservationResult[];
  marginalFrontier: TuningMarginalFrontierStep[];
  powerDensityKnee: TuningObservationResult | null;
  powerDensityKneeSummary: string;
  paretoRecommendation: TuningObservationResult | null;
  paretoRecommendationSummary: string;
  paretoSummary: string;
  summary: string;
}

export interface TuningPowerBudgetPoint {
  maxWatts: number;
  result: TuningObservationResult;
  watts: number;
  headroomWatts: number;
  qualityAdjustedHashrate: number;
  summary: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeShareCounter(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0));
}

export function diffTuningShareCounters(
  current: TuningShareCounters,
  baseline: TuningShareCounters | null,
): TuningShareCounters {
  const currentAccepted = sanitizeShareCounter(current.acceptedShares);
  const currentRejected = sanitizeShareCounter(current.rejectedShares);
  const currentStaleDropped = sanitizeShareCounter(current.staleSharesDropped);
  const currentQueuedDropped = sanitizeShareCounter(current.queuedSharesDropped);
  if (!baseline) {
    return {
      acceptedShares: currentAccepted,
      rejectedShares: currentRejected,
      staleSharesDropped: currentStaleDropped,
      queuedSharesDropped: currentQueuedDropped,
    };
  }

  return {
    acceptedShares: Math.max(0, currentAccepted - sanitizeShareCounter(baseline.acceptedShares)),
    rejectedShares: Math.max(0, currentRejected - sanitizeShareCounter(baseline.rejectedShares)),
    staleSharesDropped: Math.max(0, currentStaleDropped - sanitizeShareCounter(baseline.staleSharesDropped)),
    queuedSharesDropped: Math.max(0, currentQueuedDropped - sanitizeShareCounter(baseline.queuedSharesDropped)),
  };
}

export function upsertTuningObservation(
  observations: TuningObservation[],
  observation: TuningObservation,
): TuningObservation[] {
  if (!finitePositive(observation.hashrate)) {
    return observations;
  }

  return [
    ...observations.filter((current) => current.stepId !== observation.stepId),
    observation,
  ];
}

function clampInteger(value: number | null | undefined, min: number, max: number) {
  const numericValue = Number(value);
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(numericValue) ? numericValue : min)));
}

function finiteRuntimeInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

export function findTuningSweepStepForRuntime(
  plan: TuningSweepPlan,
  input: TuningRuntimeStepInput,
): TuningSweepStep | null {
  const mode = input.computeMode;
  if (!mode) {
    return null;
  }

  const cpuThreads = finiteRuntimeInteger(input.cpuThreads);
  const gpuIntensityPercent = finiteRuntimeInteger(input.gpuIntensityPercent);

  return plan.steps.find((step) => {
    if (step.computeMode !== mode) {
      return false;
    }

    if (mode === "cpu") {
      return cpuThreads === null || step.cpuThreads === cpuThreads;
    }

    if (mode === "hybrid" && cpuThreads !== null && step.cpuThreads !== cpuThreads) {
      return false;
    }

    return gpuIntensityPercent === null || step.gpuIntensityPercent === gpuIntensityPercent;
  }) ?? null;
}

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function sampleCompleteness(sampleSeconds: number | null, expectedSeconds: number) {
  if (!finitePositive(sampleSeconds)) {
    return 1;
  }

  return clampRatio(Number(sampleSeconds) / Math.max(1, expectedSeconds));
}

function stabilityFromSample(
  shareWasteRatio: number | null,
  completeness: number,
): TuningSampleStability {
  if (completeness < 0.5) {
    return "unstable";
  }
  if (completeness < 0.8) {
    return "noisy";
  }
  if (shareWasteRatio === null) {
    return "unknown";
  }
  if (shareWasteRatio <= 0.02) {
    return "stable";
  }
  if (shareWasteRatio <= 0.1) {
    return "noisy";
  }
  return "unstable";
}

function shareWasteWeight(shareWasteRatio: number | null) {
  if (shareWasteRatio === null) {
    return 1;
  }

  return Math.max(0.2, 1 - clampRatio(shareWasteRatio) * 1.5);
}

function runtimeMilliseconds(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function runtimeDutySnapshot(step: TuningSweepStep, observation: TuningObservation) {
  const gpuDispatchMs = runtimeMilliseconds(observation.gpuDispatchMs);
  const gpuThrottleMs = runtimeMilliseconds(observation.gpuThrottleMs);
  const totalMs = gpuDispatchMs + gpuThrottleMs;

  if (step.computeMode === "cpu" || totalMs <= 0) {
    return {
      gpuDispatchMs,
      gpuThrottleMs,
      gpuDutyCycle: null,
      gpuThrottleRatio: null,
      status: "unknown" as const,
      weight: 1,
      summary: "GPU duty: waiting for dispatch telemetry.",
    };
  }

  const gpuDutyCycle = gpuDispatchMs / totalMs;
  const gpuThrottleRatio = gpuThrottleMs / totalMs;
  const lowPowerProfile = step.priority === "power" ||
    (step.priority !== "throughput" && (step.performancePreset === "eco" || step.gpuIntensityPercent <= 25));
  if (gpuThrottleRatio <= 0.25) {
    return {
      gpuDispatchMs,
      gpuThrottleMs,
      gpuDutyCycle,
      gpuThrottleRatio,
      status: "full_duty" as const,
      weight: 1,
      summary: "GPU duty: " + Math.round(gpuDutyCycle * 100) + "% active, throttle normal.",
    };
  }

  if (lowPowerProfile) {
    return {
      gpuDispatchMs,
      gpuThrottleMs,
      gpuDutyCycle,
      gpuThrottleRatio,
      status: "intentional_low_power" as const,
      weight: 0.98,
      summary: "GPU duty: " + Math.round(gpuDutyCycle * 100) + "% active as a low-power profile.",
    };
  }

  return {
    gpuDispatchMs,
    gpuThrottleMs,
    gpuDutyCycle,
    gpuThrottleRatio,
    status: "throttled" as const,
    weight: gpuThrottleRatio <= 0.5 ? 0.9 : 0.72,
    summary: "GPU duty: " + Math.round(gpuDutyCycle * 100) + "% active; throughput profile is throttle-limited.",
  };
}

function shareEvidenceSnapshot(totalShareEvents: number) {
  if (totalShareEvents <= 0) {
    return {
      status: "none" as const,
      weight: 0.7,
      summary: "Share evidence: waiting for accepted, rejected, or locally dropped share events.",
    };
  }

  if (totalShareEvents < 3) {
    return {
      status: "thin" as const,
      weight: 0.88,
      summary: `Share evidence: ${totalShareEvents} share event${totalShareEvents === 1 ? "" : "s"}; keep sampling.`,
    };
  }

  return {
    status: "proven" as const,
    weight: 1,
    summary: `Share evidence: ${totalShareEvents} share events observed.`,
  };
}

function powerEvidenceSnapshot(observation: TuningObservation) {
  if (finitePositive(observation.watts) && observation.powerEvidenceStatus !== "estimated") {
    return {
      status: "measured" as const,
      weight: 1,
      summary: "Power evidence: measured watts are available.",
    };
  }

  return {
    status: "estimated" as const,
    weight: 0.9,
    summary: "Power evidence: estimated watts; verify with telemetry or wall power before trusting lowest-power routing.",
  };
}

function stabilityWeight(stability: TuningSampleStability) {
  switch (stability) {
    case "stable":
      return 1;
    case "unknown":
      return 0.9;
    case "noisy":
      return 0.65;
    case "unstable":
      return 0.25;
  }
}

function selectionScore(result: TuningObservationResult) {
  return result.qualityScore;
}

function qualityAdjustedJoules(result: TuningObservationResult) {
  return finitePositive(result.qualityAdjustedJoulesPerTerahash)
    ? Number(result.qualityAdjustedJoulesPerTerahash)
    : Number.POSITIVE_INFINITY;
}

function observedWatts(result: TuningObservationResult) {
  return finitePositive(result.watts)
    ? Number(result.watts)
    : Number.POSITIVE_INFINITY;
}

function longRunRiskRank(risk: TuningLongRunRisk) {
  switch (risk) {
    case "excellent":
      return 0;
    case "good":
      return 1;
    case "watch":
      return 2;
    case "unknown":
      return 3;
    case "avoid":
      return 4;
  }
}

function powerEvidenceRank(result: TuningObservationResult) {
  return result.powerEvidenceStatus === "measured" ? 0 : 1;
}

function scoreFromAdjustedJoules(
  result: TuningObservationResult,
  bestAdjustedJoulesPerTerahash: number | null,
) {
  if (!finitePositive(bestAdjustedJoulesPerTerahash) || !finitePositive(result.qualityAdjustedJoulesPerTerahash)) {
    return 0.65;
  }

  return clampRatio(Number(bestAdjustedJoulesPerTerahash) / Number(result.qualityAdjustedJoulesPerTerahash));
}

function longRunRiskFromScore(
  score: number,
  shareWasteRatio: number | null,
  thermalStatus: ThermalGuardStatus,
  stabilityWindowStatus: StabilityWindowStatus,
  shareEvidenceStatus: TuningShareEvidenceStatus,
  powerEvidenceStatus: TuningPowerEvidenceStatus,
  runtimeDutyStatus: TuningRuntimeDutyStatus,
): TuningLongRunRisk {
  if (!Number.isFinite(score) || score <= 0) {
    return "unknown";
  }
  if (
    thermalStatus === "critical" ||
    thermalStatus === "paused" ||
    stabilityWindowStatus === "unsafe" ||
    (shareWasteRatio !== null && shareWasteRatio > 0.2) ||
    score < 45
  ) {
    return "avoid";
  }
  if (
    shareEvidenceStatus === "none" ||
    thermalStatus === "hot" ||
    stabilityWindowStatus === "probing" ||
    stabilityWindowStatus === "noisy" ||
    stabilityWindowStatus === "unstable" ||
    runtimeDutyStatus === "throttled" ||
    (shareWasteRatio !== null && shareWasteRatio > 0.05) ||
    score < 70
  ) {
    return "watch";
  }
  if (
    score < 88 ||
    thermalStatus === "warm" ||
    stabilityWindowStatus === "unknown" ||
    shareEvidenceStatus === "thin" ||
    powerEvidenceStatus === "estimated"
  ) {
    return "good";
  }
  return "excellent";
}

function summarizeLongRunProfile(
  score: number,
  risk: TuningLongRunRisk,
  shareWasteRatio: number | null,
  thermalStatus: ThermalGuardStatus,
  stabilityWindowStatus: StabilityWindowStatus,
  shareEvidenceStatus: TuningShareEvidenceStatus,
  powerEvidenceStatus: TuningPowerEvidenceStatus,
  runtimeDutySummary: string,
) {
  const wasteSummary = shareWasteRatio === null ? "share waste waiting" : `${Math.round(shareWasteRatio * 100)}% share waste`;
  const evidenceSummary = shareEvidenceStatus === "proven" ? "share evidence proven" : `${shareEvidenceStatus} share evidence`;
  const powerSummary = powerEvidenceStatus === "measured" ? "power measured" : "power estimated";
  return `Long-run score ${score}/100 (${risk}); ${wasteSummary}, ${thermalStatus} thermal, ${stabilityWindowStatus} window, ${evidenceSummary}, ${powerSummary}, ${runtimeDutySummary}`;
}

function attachLongRunProfileScores(results: TuningObservationResult[]) {
  const adjustedJoules = results
    .map((result) => result.qualityAdjustedJoulesPerTerahash)
    .filter(finitePositive)
    .map(Number);
  const bestAdjustedJoulesPerTerahash = adjustedJoules.length > 0
    ? Math.min(...adjustedJoules)
    : null;

  return results.map((result) => {
    const efficiencyScore = scoreFromAdjustedJoules(result, bestAdjustedJoulesPerTerahash);
    const longRunScore = Math.round(clampRatio(result.qualityScore * 0.6 + efficiencyScore * 0.4) * 100);
    const longRunRisk = longRunRiskFromScore(
      longRunScore,
      result.shareWasteRatio,
      result.thermalStatus,
      result.stabilityWindowStatus,
      result.shareEvidenceStatus,
      result.powerEvidenceStatus,
      result.runtimeDutyStatus,
    );
    return {
      ...result,
      longRunScore,
      longRunRisk,
      longRunSummary: summarizeLongRunProfile(
        longRunScore,
        longRunRisk,
        result.shareWasteRatio,
        result.thermalStatus,
        result.stabilityWindowStatus,
        result.shareEvidenceStatus,
        result.powerEvidenceStatus,
        result.runtimeDutySummary,
      ),
    } satisfies TuningObservationResult;
  });
}

function resultDominates(left: TuningObservationResult, right: TuningObservationResult) {
  const leftJoules = qualityAdjustedJoules(left);
  const rightJoules = qualityAdjustedJoules(right);
  if (!Number.isFinite(leftJoules) || !Number.isFinite(rightJoules)) {
    return false;
  }

  const atLeastAsMuchEffectiveHash = left.qualityAdjustedHashrate >= right.qualityAdjustedHashrate;
  const noWorseEfficiency = leftJoules <= rightJoules;
  const strictlyBetter = left.qualityAdjustedHashrate > right.qualityAdjustedHashrate ||
    leftJoules < rightJoules;
  return atLeastAsMuchEffectiveHash && noWorseEfficiency && strictlyBetter;
}

function summarizeParetoFrontier(frontier: TuningObservationResult[]) {
  if (frontier.length === 0) {
    return "Pareto frontier is waiting for stable power and hashrate samples.";
  }

  const bestEfficiency = frontier[0];
  const bestHashrate = frontier
    .slice()
    .sort((left, right) => right.qualityAdjustedHashrate - left.qualityAdjustedHashrate)[0];
  if (bestEfficiency.step.id === bestHashrate.step.id) {
    return `Pareto frontier: ${bestEfficiency.step.summary} leads both efficiency and effective hash.`;
  }

  return `Pareto frontier: ${frontier.length} viable profiles from ${bestEfficiency.step.summary} to ${bestHashrate.step.summary}.`;
}


function powerDensityCandidates(frontier: TuningObservationResult[]) {
  return frontier
    .filter((result) => (
      finitePositive(result.watts) &&
      finitePositive(result.qualityAdjustedHashrate) &&
      finitePositive(result.qualityAdjustedJoulesPerTerahash) &&
      result.powerEvidenceStatus === "measured" &&
      result.longRunRisk !== "avoid"
    ))
    .slice()
    .sort((left, right) => qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
      left.qualityAdjustedHashrate - right.qualityAdjustedHashrate ||
      observedWatts(left) - observedWatts(right));
}

function averageQualityHashratePerWatt(result: TuningObservationResult) {
  const watts = observedWatts(result);
  return Number.isFinite(watts) && watts > 0
    ? result.qualityAdjustedHashrate / watts
    : 0;
}

function formatHashratePerWatt(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 H/s/W";
  }

  if (value >= 1_000_000_000_000) {
    return (value / 1_000_000_000_000).toFixed(2) + " TH/s/W";
  }
  if (value >= 1_000_000_000) {
    return (value / 1_000_000_000).toFixed(2) + " GH/s/W";
  }
  if (value >= 1_000_000) {
    return (value / 1_000_000).toFixed(2) + " MH/s/W";
  }
  if (value >= 1_000) {
    return (value / 1_000).toFixed(2) + " KH/s/W";
  }

  return Math.round(value) + " H/s/W";
}

export function deriveMarginalPowerDensityFrontier(
  frontier: TuningObservationResult[],
  minDensityRetention = TUNING_MARGINAL_DENSITY_RETENTION,
): TuningMarginalFrontierStep[] {
  const candidates = powerDensityCandidates(frontier);
  if (candidates.length === 0) {
    return [];
  }

  let selected = candidates[0];
  let stopped = false;
  const baselineDensity = averageQualityHashratePerWatt(selected);
  const steps: TuningMarginalFrontierStep[] = [{
    from: null,
    to: selected,
    extraWatts: Number(selected.watts),
    extraQualityAdjustedHashrate: selected.qualityAdjustedHashrate,
    marginalHashratePerWatt: baselineDensity,
    previousAverageHashratePerWatt: baselineDensity,
    densityRetention: 1,
    acceptedByDensityKnee: true,
    summary: `Power-density baseline uses ${selected.step.summary} at ${formatHashratePerWatt(baselineDensity)}.`,
  }];

  for (const candidate of candidates.slice(1)) {
    const previous = selected;
    const extraWatts = Number(candidate.watts) - Number(previous.watts);
    const extraHashrate = candidate.qualityAdjustedHashrate - previous.qualityAdjustedHashrate;
    const previousAverage = averageQualityHashratePerWatt(previous);
    const marginalHashratePerWatt = extraWatts > 0 ? extraHashrate / extraWatts : 0;
    const densityRetention = previousAverage > 0 ? marginalHashratePerWatt / previousAverage : 0;
    const accepted = !stopped &&
      extraWatts > 0 &&
      extraHashrate > 0 &&
      densityRetention >= minDensityRetention;

    steps.push({
      from: previous,
      to: candidate,
      extraWatts,
      extraQualityAdjustedHashrate: extraHashrate,
      marginalHashratePerWatt,
      previousAverageHashratePerWatt: previousAverage,
      densityRetention,
      acceptedByDensityKnee: accepted,
      summary: accepted
        ? `Power-density step accepts ${candidate.step.summary}: +${Math.round(extraHashrate)} quality H/s at ${formatHashratePerWatt(marginalHashratePerWatt)}.`
        : `Power-density step stops before ${candidate.step.summary}: ${formatHashratePerWatt(marginalHashratePerWatt)} is below ${Math.round(minDensityRetention * 100)}% retention.`,
    });

    if (accepted) {
      selected = candidate;
    } else {
      stopped = true;
    }
  }

  return steps;
}

export function selectPowerDensityTuningResult(
  frontier: TuningObservationResult[],
  minDensityRetention = TUNING_MARGINAL_DENSITY_RETENTION,
): TuningObservationResult | null {
  const marginalFrontier = deriveMarginalPowerDensityFrontier(frontier, minDensityRetention);
  return marginalFrontier
    .slice()
    .reverse()
    .find((step) => step.acceptedByDensityKnee)?.to ?? null;
}

function summarizePowerDensityKnee(
  result: TuningObservationResult | null,
  marginalFrontier: TuningMarginalFrontierStep[],
) {
  if (!result) {
    return "Power-density frontier knee is waiting for measured Pareto frontier samples.";
  }

  const blockedStep = marginalFrontier.find((step) => !step.acceptedByDensityKnee);
  if (blockedStep) {
    return `Power-density frontier knee keeps ${result.step.summary}; next profile ${blockedStep.to.step.summary} adds only ${formatHashratePerWatt(blockedStep.marginalHashratePerWatt)}.`;
  }

  return marginalFrontier.length > 1
    ? `Power-density frontier knee selects ${result.step.summary}; all measured marginal steps retain at least ${Math.round(TUNING_MARGINAL_DENSITY_RETENTION * 100)}% density.`
    : `Power-density frontier knee selects ${result.step.summary}; collect another measured frontier point to verify the next marginal watt.`;
}

function normalizedScore(value: number, min: number, max: number) {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  if (max <= min) {
    return 1;
  }

  return clampRatio((value - min) / (max - min));
}

function selectParetoFrontierResult(
  frontier: TuningObservationResult[],
  goal: EfficiencyGoal,
): TuningObservationResult | null {
  if (frontier.length === 0) {
    return null;
  }

  if (goal === "lowest_power") {
    return frontier
      .slice()
      .sort((left, right) => observedWatts(left) - observedWatts(right) ||
        qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
        right.qualityAdjustedHashrate - left.qualityAdjustedHashrate)[0];
  }

  if (goal === "max_efficiency") {
    return frontier
      .slice()
      .sort((left, right) => qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
        right.qualityAdjustedHashrate - left.qualityAdjustedHashrate)[0];
  }

  if (goal === "max_hashrate") {
    return frontier
      .slice()
      .sort((left, right) => right.qualityAdjustedHashrate - left.qualityAdjustedHashrate ||
        qualityAdjustedJoules(left) - qualityAdjustedJoules(right))[0];
  }

  const hashes = frontier.map((result) => result.qualityAdjustedHashrate);
  const joules = frontier.map(qualityAdjustedJoules).filter((value) => Number.isFinite(value));
  const minHashrate = Math.min(...hashes);
  const maxHashrate = Math.max(...hashes);
  const minJoules = Math.min(...joules);
  const maxJoules = Math.max(...joules);

  return frontier
    .slice()
    .sort((left, right) => {
      const leftScore = normalizedScore(left.qualityAdjustedHashrate, minHashrate, maxHashrate) * 0.55 +
        (1 - normalizedScore(qualityAdjustedJoules(left), minJoules, maxJoules)) * 0.45;
      const rightScore = normalizedScore(right.qualityAdjustedHashrate, minHashrate, maxHashrate) * 0.55 +
        (1 - normalizedScore(qualityAdjustedJoules(right), minJoules, maxJoules)) * 0.45;
      return rightScore - leftScore ||
        right.qualityAdjustedHashrate - left.qualityAdjustedHashrate ||
        qualityAdjustedJoules(left) - qualityAdjustedJoules(right);
    })[0];
}

function tuningGoalSummary(goal: EfficiencyGoal) {
  switch (goal) {
    case "lowest_power":
      return "lowest power";
    case "max_efficiency":
      return "efficiency";
    case "balanced":
      return "balanced";
    case "max_hashrate":
      return "hashrate";
  }
}

function summarizeParetoRecommendation(
  result: TuningObservationResult | null,
  goal: EfficiencyGoal,
) {
  if (!result) {
    return "Pareto recommendation is waiting for comparable tuning samples.";
  }

  return `Pareto ${tuningGoalSummary(goal)} pick: ${result.step.summary} from measured frontier.`;
}

function sameRuntime(candidate: EfficiencyCandidate, input: TuningSweepInput) {
  if (!input.currentComputeMode || candidate.computeMode !== input.currentComputeMode) {
    return false;
  }

  const currentCpuThreads = clampInteger(input.currentCpuThreads, 0, 256);
  const currentGpuIntensityPercent = clampInteger(input.currentGpuIntensityPercent, 0, 100);
  return candidate.cpuThreads === currentCpuThreads &&
    candidate.gpuIntensityPercent === currentGpuIntensityPercent;
}

function candidateUtility(candidate: EfficiencyCandidate, goal: EfficiencyGoal) {
  const joulesPerTerahash = candidate.joulesPerTerahash ?? Number.POSITIVE_INFINITY;
  switch (goal) {
    case "lowest_power":
      return -candidate.estimatedWatts + Math.log10(candidate.estimatedHashrate + 1) * 0.02;
    case "max_efficiency":
      return -joulesPerTerahash - candidate.estimatedWatts * 0.02;
    case "balanced":
      return Math.log10(candidate.estimatedHashrate + 1) * 10 -
        joulesPerTerahash * 0.01 -
        candidate.estimatedWatts * 0.05;
    case "max_hashrate":
      return candidate.estimatedHashrate - candidate.estimatedWatts * 30_000;
  }
}

function priorityForCandidate(
  candidate: EfficiencyCandidate,
  goal: EfficiencyGoal,
  isBaseline: boolean,
): TuningStepPriority {
  if (isBaseline) {
    return "baseline";
  }
  if (candidate.computeMode === "hybrid") {
    return "hybrid";
  }
  if (goal === "lowest_power") {
    return "power";
  }
  if (goal === "max_hashrate") {
    return "throughput";
  }
  if (goal === "balanced") {
    return "balanced";
  }
  return "efficiency";
}

function reasonForCandidate(candidate: EfficiencyCandidate, priority: TuningStepPriority) {
  switch (priority) {
    case "baseline":
      return "Measures the current local profile before changing anything.";
    case "power":
      return "Checks the lowest local watt draw before chasing more hashrate.";
    case "efficiency":
      return "Checks whether lower watts per terahash beats the current profile.";
    case "balanced":
      return "Balances useful hashrate against moderate estimated power.";
    case "throughput":
      return "Measures the highest practical local hashrate profile.";
    case "hybrid":
      return "Verifies whether adding CPU workers is worth the extra watts.";
  }
}

function eligibleForGoal(candidate: EfficiencyCandidate, goal: EfficiencyGoal) {
  if (goal === "lowest_power") {
    return candidate.computeMode !== "hybrid" && candidate.gpuIntensityPercent <= 25;
  }

  if (goal === "max_efficiency") {
    return candidate.computeMode !== "hybrid" && candidate.gpuIntensityPercent <= 75;
  }

  if (goal === "balanced") {
    return candidate.computeMode !== "hybrid" || candidate.gpuIntensityPercent === 75;
  }

  return true;
}

function uniqueCandidates(candidates: EfficiencyCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) {
      return false;
    }
    seen.add(candidate.id);
    return true;
  });
}

function stepFromCandidate(
  candidate: EfficiencyCandidate,
  order: number,
  sampleSeconds: number,
  goal: EfficiencyGoal,
  isBaseline: boolean,
): TuningSweepStep {
  const priority = priorityForCandidate(candidate, goal, isBaseline);
  return {
    id: candidate.id,
    order,
    priority,
    computeMode: candidate.computeMode,
    performancePreset: candidate.performancePreset,
    cpuThreads: candidate.cpuThreads,
    gpuIntensityPercent: candidate.gpuIntensityPercent,
    sampleSeconds,
    estimatedHashrate: candidate.estimatedHashrate,
    estimatedWatts: candidate.estimatedWatts,
    joulesPerTerahash: candidate.joulesPerTerahash,
    summary: candidate.summary,
    reason: reasonForCandidate(candidate, priority),
  };
}

export function createTuningSweepPlan(input: TuningSweepInput): TuningSweepPlan {
  const maxSteps = clampInteger(input.maxSteps, 2, 8);
  const sampleSeconds = clampInteger(input.sampleSeconds, 15, 180);
  const candidates = createEfficiencyCandidates(input);
  const baseline = candidates.find((candidate) => sameRuntime(candidate, input)) ??
    candidates.find((candidate) => candidate.computeMode === "cpu" && candidate.cpuThreads === input.recommendedCpuThreads) ??
    candidates[0];

  const ranked = candidates
    .filter((candidate) => candidate.id !== baseline.id)
    .filter((candidate) => eligibleForGoal(candidate, input.goal))
    .sort((left, right) => candidateUtility(right, input.goal) - candidateUtility(left, input.goal))
    .slice(0, Math.max(0, maxSteps - 1));

  const ordered = uniqueCandidates([baseline, ...ranked])
    .slice(0, maxSteps)
    .sort((left, right) => {
      if (left.id === baseline.id) return -1;
      if (right.id === baseline.id) return 1;
      return left.estimatedWatts - right.estimatedWatts ||
        right.estimatedHashrate - left.estimatedHashrate;
    });

  const steps = ordered.map((candidate, index) => stepFromCandidate(
    candidate,
    index + 1,
    sampleSeconds,
    input.goal,
    candidate.id === baseline.id,
  ));
  const totalSeconds = steps.reduce((total, step) => total + step.sampleSeconds, 0);
  const summary = steps.length > 0
    ? `${steps.length} safe steps, about ${Math.round(totalSeconds / 60)} min.`
    : "No local tuning steps available.";

  return {
    goal: input.goal,
    steps,
    totalSeconds,
    summary,
  };
}

export function analyzeTuningObservations(
  plan: TuningSweepPlan,
  observations: TuningObservation[],
): TuningAnalysis {
  const stepById = new Map(plan.steps.map((step) => [step.id, step]));
  const rawResults = observations
    .map((observation): TuningObservationResult | null => {
      const step = stepById.get(observation.stepId);
      if (!step || !finitePositive(observation.hashrate)) {
        return null;
      }

      const watts = finitePositive(observation.watts) ? Number(observation.watts) : step.estimatedWatts;
      const acceptedShares = Math.max(0, Number(observation.acceptedShares ?? 0));
      const rejectedShares = Math.max(0, Number(observation.rejectedShares ?? 0));
      const staleSharesDropped = Math.max(0, Number(observation.staleSharesDropped ?? 0));
      const queuedSharesDropped = Math.max(0, Number(observation.queuedSharesDropped ?? 0));
      const totalSubmittedShares = acceptedShares + rejectedShares;
      const totalDroppedShares = staleSharesDropped + queuedSharesDropped;
      const totalShareEvents = totalSubmittedShares + totalDroppedShares;
      const rejectedShareRatio = totalSubmittedShares > 0 ? rejectedShares / totalSubmittedShares : null;
      const staleShareRatio = totalShareEvents > 0 ? staleSharesDropped / totalShareEvents : null;
      const shareWasteRatio = totalShareEvents > 0 ? (rejectedShares + totalDroppedShares) / totalShareEvents : null;
      const shareEvidence = shareEvidenceSnapshot(totalShareEvents);
      const powerEvidence = powerEvidenceSnapshot(observation);
      const runtimeDuty = runtimeDutySnapshot(step, observation);
      const effectiveHashrate = observation.hashrate * (1 - (shareWasteRatio ?? 0));
      const snapshot = calculateEfficiencySnapshot({
        mode: step.computeMode,
        hashrate: observation.hashrate,
        watts,
      });
      const effectiveSnapshot = calculateEfficiencySnapshot({
        mode: step.computeMode,
        hashrate: effectiveHashrate,
        watts,
      });
      const sampleSeconds = finitePositive(observation.sampleSeconds)
        ? Number(observation.sampleSeconds)
        : null;
      const completeness = sampleCompleteness(sampleSeconds, step.sampleSeconds);
      const stability = stabilityFromSample(shareWasteRatio, completeness);
      const thermalGuard = calculateThermalGuard({
        tempC: observation.tempC,
        vrTempC: observation.vrTempC,
        fanRpm: observation.fanRpm,
        miningPaused: observation.miningPaused,
      });
      const stabilityWindow = calculateStabilityWindow({
        sampleSeconds,
        rejectedShareRatio: shareWasteRatio,
        thermalStatus: thermalGuard.status,
      });
      const qualityScore = completeness *
        stabilityWeight(stability) *
        shareWasteWeight(shareWasteRatio) *
        shareEvidence.weight *
        powerEvidence.weight *
        thermalGuard.qualityWeight *
        stabilityWindow.qualityWeight *
        runtimeDuty.weight;
      const qualityAdjustedHashrate = effectiveSnapshot.hashrate * qualityScore;
      const qualityAdjustedJoulesPerTerahash = effectiveSnapshot.joulesPerTerahash === null
        ? null
        : effectiveSnapshot.joulesPerTerahash / Math.max(0.1, qualityScore);

      return {
        step,
        hashrate: snapshot.hashrate,
        effectiveHashrate: effectiveSnapshot.hashrate,
        watts: snapshot.watts,
        joulesPerTerahash: snapshot.joulesPerTerahash,
        effectiveJoulesPerTerahash: effectiveSnapshot.joulesPerTerahash,
        acceptedShares,
        rejectedShares,
        staleSharesDropped,
        queuedSharesDropped,
        gpuDispatchMs: runtimeDuty.gpuDispatchMs,
        gpuThrottleMs: runtimeDuty.gpuThrottleMs,
        gpuDutyCycle: runtimeDuty.gpuDutyCycle,
        gpuThrottleRatio: runtimeDuty.gpuThrottleRatio,
        runtimeDutyStatus: runtimeDuty.status,
        runtimeDutyWeight: runtimeDuty.weight,
        runtimeDutySummary: runtimeDuty.summary,
        rejectedShareRatio,
        staleShareRatio,
        shareWasteRatio,
        shareEvidenceStatus: shareEvidence.status,
        shareEvidenceWeight: shareEvidence.weight,
        shareEvidenceSummary: shareEvidence.summary,
        powerEvidenceStatus: powerEvidence.status,
        powerEvidenceWeight: powerEvidence.weight,
        powerEvidenceSummary: powerEvidence.summary,
        sampleSeconds,
        stability,
        thermalStatus: thermalGuard.status,
        thermalWeight: thermalGuard.qualityWeight,
        thermalSummary: thermalGuard.summary,
        maxObservedTempC: thermalGuard.maxObservedTempC,
        stabilityWindowStatus: stabilityWindow.status,
        stabilityWindowWeight: stabilityWindow.qualityWeight,
        stabilityWindowSummary: stabilityWindow.summary,
        stabilityWindowProgress: stabilityWindow.progress,
        qualityScore,
        qualityAdjustedHashrate,
        qualityAdjustedJoulesPerTerahash,
        longRunScore: 0,
        longRunRisk: "unknown",
        longRunSummary: "Long-run score is waiting for comparable tuning samples.",
      } satisfies TuningObservationResult;
    })
    .filter((result): result is TuningObservationResult => result !== null);
  const results = attachLongRunProfileScores(rawResults);

  const bestEfficiency = results
    .filter((result) => finitePositive(result.effectiveJoulesPerTerahash))
    .sort((left, right) => {
      const leftAdjusted = Number(left.effectiveJoulesPerTerahash) / Math.max(0.1, selectionScore(left));
      const rightAdjusted = Number(right.effectiveJoulesPerTerahash) / Math.max(0.1, selectionScore(right));
      return leftAdjusted - rightAdjusted;
    })[0] ?? null;
  const bestHashrate = results
    .slice()
    .sort((left, right) => (
      right.effectiveHashrate * selectionScore(right) -
      left.effectiveHashrate * selectionScore(left)
    ))[0] ?? null;
  const powerCandidates = results.filter((result) => finitePositive(result.watts));
  const lowPowerCandidates = powerCandidates.filter((result) => result.longRunRisk !== "avoid");
  const lowestPower = (lowPowerCandidates.length > 0 ? lowPowerCandidates : powerCandidates)
    .slice()
    .sort((left, right) => Number(left.watts) - Number(right.watts) ||
      longRunRiskRank(left.longRunRisk) - longRunRiskRank(right.longRunRisk) ||
      powerEvidenceRank(left) - powerEvidenceRank(right) ||
      qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
      right.qualityAdjustedHashrate - left.qualityAdjustedHashrate)[0] ?? null;
  const paretoFrontier = results
    .filter((result) => finitePositive(result.qualityAdjustedJoulesPerTerahash) && finitePositive(result.qualityAdjustedHashrate))
    .filter((candidate) => !results.some((other) => other.step.id !== candidate.step.id && resultDominates(other, candidate)))
    .sort((left, right) => qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
      left.qualityAdjustedHashrate - right.qualityAdjustedHashrate);
  const marginalFrontier = deriveMarginalPowerDensityFrontier(paretoFrontier);
  const powerDensityKnee = selectPowerDensityTuningResult(paretoFrontier);
  const powerDensityKneeSummary = summarizePowerDensityKnee(powerDensityKnee, marginalFrontier);
  const paretoRecommendation = selectParetoFrontierResult(paretoFrontier, plan.goal);
  const paretoRecommendationSummary = summarizeParetoRecommendation(paretoRecommendation, plan.goal);
  const paretoSummary = summarizeParetoFrontier(paretoFrontier);
  const summary = lowestPower && bestEfficiency && bestHashrate
    ? `Lowest power: ${lowestPower.step.summary}. Best efficiency: ${bestEfficiency.step.summary}. Best effective hash: ${bestHashrate.step.summary}.`
    : "Collect at least one tuning sample to compare local profiles.";

  return {
    results,
    lowestPower,
    bestEfficiency,
    bestHashrate,
    paretoFrontier,
    marginalFrontier,
    powerDensityKnee,
    powerDensityKneeSummary,
    paretoRecommendation,
    paretoRecommendationSummary,
    paretoSummary,
    summary,
  };
}

export function selectParetoTuningResult(
  analysis: TuningAnalysis,
  goal: EfficiencyGoal,
): TuningObservationResult | null {
  return selectParetoFrontierResult(analysis.paretoFrontier, goal);
}

export function selectPowerBudgetTuningResult(
  analysis: TuningAnalysis,
  maxWatts: number | null | undefined,
): TuningObservationResult | null {
  if (!finitePositive(maxWatts)) {
    return null;
  }

  const candidates = analysis.results.filter((result) => (
    finitePositive(result.watts) && Number(result.watts) <= Number(maxWatts)
  ));
  const longRunCandidates = candidates.filter((result) => result.longRunRisk !== "avoid");
  return (longRunCandidates.length > 0 ? longRunCandidates : candidates)
    .slice()
    .sort((left, right) => right.qualityAdjustedHashrate - left.qualityAdjustedHashrate ||
      longRunRiskRank(left.longRunRisk) - longRunRiskRank(right.longRunRisk) ||
      powerEvidenceRank(left) - powerEvidenceRank(right) ||
      qualityAdjustedJoules(left) - qualityAdjustedJoules(right) ||
      Number(left.watts) - Number(right.watts))[0] ?? null;
}

function uniqueSortedBudgets(budgets: Array<number | null | undefined>) {
  return Array.from(new Set(
    budgets
      .filter(finitePositive)
      .map((budget) => Number(Number(budget).toFixed(3))),
  )).sort((left, right) => left - right);
}

export function createPowerBudgetCurve(
  analysis: TuningAnalysis,
  budgets?: Array<number | null | undefined>,
): TuningPowerBudgetPoint[] {
  const budgetPoints = uniqueSortedBudgets(
    budgets && budgets.length > 0
      ? budgets
      : analysis.results.map((result) => result.watts),
  );

  return budgetPoints
    .map((maxWatts): TuningPowerBudgetPoint | null => {
      const result = selectPowerBudgetTuningResult(analysis, maxWatts);
      if (!result || !finitePositive(result.watts)) {
        return null;
      }

      const watts = Number(result.watts);
      const headroomWatts = Math.max(0, maxWatts - watts);
      return {
        maxWatts,
        result,
        watts,
        headroomWatts,
        qualityAdjustedHashrate: result.qualityAdjustedHashrate,
        summary: `Budget ${maxWatts} W selects ${result.step.summary} with ${Math.round(result.qualityAdjustedHashrate)} quality H/s.`,
      };
    })
    .filter((point): point is TuningPowerBudgetPoint => point !== null);
}

export function selectTuningResult(
  analysis: TuningAnalysis,
  selection: TuningResultSelection,
): TuningObservationResult | null {
  switch (selection) {
    case "lowest_power":
      return analysis.lowestPower;
    case "best_efficiency":
      return analysis.bestEfficiency;
    case "best_hashrate":
      return analysis.bestHashrate;
  }
}

function tuningSelectionLabel(selection: TuningResultSelection) {
  switch (selection) {
    case "lowest_power":
      return "Lowest power";
    case "best_efficiency":
      return "Best efficiency";
    case "best_hashrate":
      return "Best hashrate";
  }
}


function applyOption(
  selection: TuningResultSelection,
  result: TuningObservationResult | null,
  status: TuningApplyEligibilityStatus,
  summary: string,
  nextStep: string,
  runtime: HashRuntimeGuardSnapshot = deriveHashRuntimeGuard(null),
): TuningApplyOption {
  return {
    selection,
    result,
    status,
    canApply: status === "ready" && result !== null,
    runtimeGuard: runtime.level,
    runtimeEfficiencyStatus: runtime.status,
    summary,
    nextStep,
  };
}

export function deriveTuningApplyOption(
  analysis: TuningAnalysis,
  selection: TuningResultSelection,
  input: TuningApplyOptionInput = {},
): TuningApplyOption {
  const result = selectTuningResult(analysis, selection);
  const label = tuningSelectionLabel(selection);
  const runtime = deriveHashRuntimeGuard(input.runtimeEfficiency);
  const raisesLoad = targetRaisesHashLoad(result?.step ?? null, input.currentStep);

  if (!result) {
    return applyOption(
      selection,
      null,
      "waiting",
      `${label} is waiting for local evidence.`,
      "Capture a measured local tuning sample first.",
    );
  }

  if (result.longRunRisk === "avoid" || result.stabilityWindowStatus === "unsafe" || result.stabilityWindowStatus === "unstable") {
    return applyOption(
      selection,
      result,
      "blocked",
      `${label} is blocked by long-run risk on ${result.step.summary}.`,
      result.longRunSummary,
    );
  }

  if ((selection === "lowest_power" || selection === "best_efficiency") && result.powerEvidenceStatus !== "measured") {
    return applyOption(
      selection,
      result,
      "waiting",
      `${label} needs measured watts before it can be applied.`,
      "Enter measured wall or device watts, then capture this profile again.",
    );
  }

  if (result.shareEvidenceStatus === "none") {
    return applyOption(
      selection,
      result,
      "waiting",
      `${label} needs share evidence before it can be applied.`,
      "Let the profile run until accepted, rejected, stale, or queued share counters move, then capture again.",
    );
  }

  if (result.stabilityWindowStatus === "unknown" || result.stabilityWindowStatus === "probing") {
    return applyOption(
      selection,
      result,
      "waiting",
      `${label} needs a complete stability window before it can be applied.`,
      result.stabilityWindowSummary,
    );
  }

  if (raisesLoad && runtime.level !== "clear") {
    return applyOption(
      selection,
      result,
      "blocked",
      `${label} is blocked because ${runtime.summary}.`,
      runtime.nextStep,
      runtime,
    );
  }

  return applyOption(
    selection,
    result,
    "ready",
    `${label} can apply ${result.step.summary}.`,
    result.longRunSummary,
    runtime,
  );
}

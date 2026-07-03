import type { AlgorithmExperimentAdvisorSnapshot } from "./algorithmExperimentAdvisor.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import type { TuningAnalysis, TuningObservation, TuningObservationResult } from "./efficiencyTuning.js";
import { OPTIMIZATION_MIN_SHARE_EVENTS } from "./optimizationThresholds.js";
import { calculateStabilityWindow } from "./stabilityWindow.js";
import { calculateThermalGuard } from "./thermalGuard.js";

export type AlgorithmExperimentConfidenceScope = "local" | "external" | "direct" | "research";
export type AlgorithmExperimentConfidenceStatus =
  | "missing"
  | "single_sample"
  | "replication_needed"
  | "provisional"
  | "confident"
  | "blocked";

export interface AlgorithmExperimentConfidenceInput {
  advisor: AlgorithmExperimentAdvisorSnapshot;
  tuningAnalysis?: TuningAnalysis | null;
  tuningHistory?: TuningObservation[] | null;
  externalHistory?: ExternalHashHistorySummary | null;
}

export interface AlgorithmExperimentConfidenceSnapshot {
  schemaVersion: 1;
  scope: AlgorithmExperimentConfidenceScope;
  status: AlgorithmExperimentConfidenceStatus;
  confidenceScore: number;
  requiredReplications: number;
  observedReplications: number;
  requiredEvidencePoints: number;
  observedEvidencePoints: number;
  bestStepId: string | null;
  candidateStepId: string | null;
  candidateDominatesBaseline: boolean;
  powerDeltaPercent: number | null;
  hashrateDeltaPercent: number | null;
  joulesDeltaPercent: number | null;
  evidenceToRepeat: string[];
  missingEvidence: string[];
  stopConditions: string[];
  claimReady: boolean;
  miningStartAllowed: false;
  summary: string;
  nextStep: string;
}

const LOCAL_REQUIRED_EVIDENCE_POINTS = 5;
const LOCAL_REQUIRED_REPLICATIONS = 2;
const EXTERNAL_STABLE_SAMPLE_TARGET = 6;
const EXTERNAL_MIN_SAMPLE_TARGET = 3;

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function percentDelta(candidate: number | null | undefined, baseline: number | null | undefined) {
  if (!finitePositive(candidate) || !finitePositive(baseline)) {
    return null;
  }
  return ((Number(candidate) - Number(baseline)) / Number(baseline)) * 100;
}

function confidenceScope(advisor: AlgorithmExperimentAdvisorSnapshot): AlgorithmExperimentConfidenceScope {
  if (advisor.route === "network" || advisor.route === "external") {
    return "external";
  }
  if (advisor.route === "direct") {
    return "direct";
  }
  if (advisor.route === "research") {
    return "research";
  }
  return "local";
}

function localCandidate(
  advisor: AlgorithmExperimentAdvisorSnapshot,
  analysis: TuningAnalysis | null | undefined,
) {
  if (!analysis || analysis.results.length === 0) {
    return null;
  }

  if (advisor.applyTargetStepId) {
    const target = analysis.results.find((result) => result.step.id === advisor.applyTargetStepId);
    if (target) {
      return target;
    }
  }

  if (advisor.focus === "hashrate_headroom") {
    return analysis.bestHashrate;
  }
  if (advisor.focus === "power_density_knee") {
    return analysis.powerDensityKnee ?? analysis.bestEfficiency ?? analysis.paretoRecommendation;
  }
  if (advisor.focus === "power_baseline") {
    return analysis.lowestPower ?? analysis.bestEfficiency ?? analysis.paretoRecommendation;
  }
  return analysis.paretoRecommendation ?? analysis.bestEfficiency ?? analysis.lowestPower ?? analysis.bestHashrate;
}

function localBaseline(analysis: TuningAnalysis | null | undefined) {
  if (!analysis || analysis.results.length === 0) {
    return null;
  }
  return analysis.results
    .slice()
    .sort((left, right) => left.step.order - right.step.order)[0] ?? null;
}

function hasEnoughSampleSeconds(
  result: TuningObservationResult,
  advisor: AlgorithmExperimentAdvisorSnapshot,
) {
  const targetSeconds = advisor.requiredSeconds ?? result.step.sampleSeconds;
  return finitePositive(result.sampleSeconds) && Number(result.sampleSeconds) >= targetSeconds;
}

function localEvidencePoints(
  result: TuningObservationResult,
  advisor: AlgorithmExperimentAdvisorSnapshot,
) {
  const points = [
    {
      id: "measured_power",
      passed: result.powerEvidenceStatus === "measured",
      missing: "measured wall-power sample",
    },
    {
      id: "sample_duration",
      passed: hasEnoughSampleSeconds(result, advisor),
      missing: `${advisor.requiredSeconds ?? result.step.sampleSeconds}s sample duration`,
    },
    {
      id: "share_quality",
      passed: result.shareEvidenceStatus === "proven",
      missing: `${advisor.requiredShareEvents ?? 3} useful share events`,
    },
    {
      id: "thermal_state",
      passed: result.thermalStatus === "cool" || result.thermalStatus === "warm",
      missing: "cool or warm thermal state",
    },
    {
      id: "stability_window",
      passed: result.stabilityWindowStatus === "stable" && result.longRunRisk !== "avoid",
      missing: "stable long-run window",
    },
  ];

  return {
    observed: points.filter((point) => point.passed).length,
    missing: points.filter((point) => !point.passed).map((point) => point.missing),
  };
}

function localDominates(candidate: TuningObservationResult, baseline: TuningObservationResult | null) {
  if (!baseline || candidate.step.id === baseline.step.id) {
    return true;
  }

  const candidateHashrate = finitePositive(candidate.qualityAdjustedHashrate)
    ? candidate.qualityAdjustedHashrate
    : candidate.effectiveHashrate;
  const baselineHashrate = finitePositive(baseline.qualityAdjustedHashrate)
    ? baseline.qualityAdjustedHashrate
    : baseline.effectiveHashrate;
  const hashrateBetter = finitePositive(candidateHashrate) && finitePositive(baselineHashrate)
    ? Number(candidateHashrate) >= Number(baselineHashrate) * 0.95
    : false;

  if (finitePositive(candidate.qualityAdjustedJoulesPerTerahash) && finitePositive(baseline.qualityAdjustedJoulesPerTerahash)) {
    return Number(candidate.qualityAdjustedJoulesPerTerahash) <= Number(baseline.qualityAdjustedJoulesPerTerahash) * 1.05 || hashrateBetter;
  }

  if (finitePositive(candidate.watts) && finitePositive(baseline.watts)) {
    return Number(candidate.watts) <= Number(baseline.watts) * 1.05 || hashrateBetter;
  }

  return hashrateBetter;
}


function nonNegativeInteger(value: number | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function tuningShareEvents(observation: TuningObservation) {
  return nonNegativeInteger(observation.acceptedShares) +
    nonNegativeInteger(observation.rejectedShares) +
    nonNegativeInteger(observation.staleSharesDropped) +
    nonNegativeInteger(observation.queuedSharesDropped);
}

function tuningRejectedShareRatio(observation: TuningObservation) {
  const total = tuningShareEvents(observation);
  if (total <= 0) {
    return null;
  }
  return (
    nonNegativeInteger(observation.rejectedShares) +
    nonNegativeInteger(observation.staleSharesDropped) +
    nonNegativeInteger(observation.queuedSharesDropped)
  ) / total;
}

function localHistorySampleComplete(
  observation: TuningObservation,
  candidate: TuningObservationResult,
  advisor: AlgorithmExperimentAdvisorSnapshot,
) {
  if (observation.stepId !== candidate.step.id) {
    return false;
  }
  const requiredSeconds = advisor.requiredSeconds ?? candidate.step.sampleSeconds;
  const requiredShareEvents = advisor.requiredShareEvents ?? OPTIMIZATION_MIN_SHARE_EVENTS;
  const thermal = calculateThermalGuard({
    tempC: observation.tempC,
    vrTempC: observation.vrTempC,
    fanRpm: observation.fanRpm,
    miningPaused: observation.miningPaused,
  });
  const stability = calculateStabilityWindow({
    sampleSeconds: observation.sampleSeconds,
    rejectedShareRatio: tuningRejectedShareRatio(observation),
    thermalStatus: thermal.status,
    requiredSeconds,
  });

  return observation.powerEvidenceStatus === "measured" &&
    finitePositive(observation.watts) &&
    finitePositive(observation.sampleSeconds) &&
    Number(observation.sampleSeconds) >= requiredSeconds &&
    tuningShareEvents(observation) >= requiredShareEvents &&
    (thermal.status === "cool" || thermal.status === "warm") &&
    stability.status === "stable";
}

function countLocalReplications(
  history: TuningObservation[] | null | undefined,
  candidate: TuningObservationResult,
  advisor: AlgorithmExperimentAdvisorSnapshot,
) {
  if (!Array.isArray(history) || history.length === 0) {
    return 0;
  }
  const completeKeys = new Set<string>();
  history.forEach((observation, index) => {
    if (!localHistorySampleComplete(observation, candidate, advisor)) {
      return;
    }
    completeKeys.add(observation.capturedAt || `${observation.stepId}:${index}`);
  });
  return completeKeys.size;
}
function localConfidence(input: AlgorithmExperimentConfidenceInput): AlgorithmExperimentConfidenceSnapshot {
  const analysis = input.tuningAnalysis ?? null;
  const candidate = localCandidate(input.advisor, analysis);
  const baseline = localBaseline(analysis);
  const bestStepId = analysis?.paretoRecommendation?.step.id
    ?? analysis?.bestEfficiency?.step.id
    ?? analysis?.lowestPower?.step.id
    ?? analysis?.bestHashrate?.step.id
    ?? null;
  const marginalStatus = input.advisor.marginalDecisionStatus;
  const marginalBlocksHeadroom = input.advisor.focus === "hashrate_headroom" &&
    (marginalStatus === "hold" || marginalStatus === "cooldown");

  if (marginalBlocksHeadroom) {
    const reason = marginalStatus === "cooldown"
      ? "max-hash marginal density is blocked by cooling or long-run risk"
      : "max-hash marginal density does not justify the extra watts";
    return {
      schemaVersion: 1,
      scope: "local",
      status: "blocked",
      confidenceScore: 0,
      requiredReplications: LOCAL_REQUIRED_REPLICATIONS,
      observedReplications: 0,
      requiredEvidencePoints: LOCAL_REQUIRED_EVIDENCE_POINTS,
      observedEvidencePoints: 0,
      bestStepId,
      candidateStepId: input.advisor.applyTargetStepId ?? candidate?.step.id ?? null,
      candidateDominatesBaseline: false,
      powerDeltaPercent: null,
      hashrateDeltaPercent: null,
      joulesDeltaPercent: null,
      evidenceToRepeat: input.advisor.evidenceToRecord,
      missingEvidence: [reason],
      stopConditions: input.advisor.stopConditions,
      claimReady: false,
      miningStartAllowed: false,
      summary: `Local max-hash confidence is blocked because ${reason}.`,
      nextStep: input.advisor.nextStep,
    };
  }

  if (!candidate) {
    return {
      schemaVersion: 1,
      scope: "local",
      status: "missing",
      confidenceScore: 0,
      requiredReplications: LOCAL_REQUIRED_REPLICATIONS,
      observedReplications: 0,
      requiredEvidencePoints: LOCAL_REQUIRED_EVIDENCE_POINTS,
      observedEvidencePoints: 0,
      bestStepId,
      candidateStepId: input.advisor.applyTargetStepId,
      candidateDominatesBaseline: false,
      powerDeltaPercent: null,
      hashrateDeltaPercent: null,
      joulesDeltaPercent: null,
      evidenceToRepeat: input.advisor.evidenceToRecord,
      missingEvidence: ["target profile sample", "measured watts", "share evidence", "thermal stability"],
      stopConditions: input.advisor.stopConditions,
      claimReady: false,
      miningStartAllowed: false,
      summary: "No local experiment sample is available for the current target.",
      nextStep: input.advisor.nextStep,
    };
  }

  const evidence = localEvidencePoints(candidate, input.advisor);
  const completeEvidence = evidence.observed >= LOCAL_REQUIRED_EVIDENCE_POINTS;
  const historyReplications = countLocalReplications(input.tuningHistory, candidate, input.advisor);
  const observedReplications = completeEvidence ? Math.max(1, historyReplications) : historyReplications;
  const candidateDominatesBaseline = localDominates(candidate, baseline);
  const claimReady = completeEvidence &&
    observedReplications >= LOCAL_REQUIRED_REPLICATIONS &&
    candidateDominatesBaseline;
  const missingEvidence = claimReady
    ? []
    : completeEvidence
      ? [`${LOCAL_REQUIRED_REPLICATIONS - observedReplications} more independent same-profile sample${LOCAL_REQUIRED_REPLICATIONS - observedReplications === 1 ? "" : "s"}`]
      : evidence.missing;
  const status: AlgorithmExperimentConfidenceStatus = claimReady
    ? "confident"
    : completeEvidence
      ? "replication_needed"
      : evidence.observed <= 1
        ? "single_sample"
        : "provisional";
  const evidenceScore = evidence.observed / LOCAL_REQUIRED_EVIDENCE_POINTS * 70;
  const replicationScore = Math.min(observedReplications, LOCAL_REQUIRED_REPLICATIONS) / LOCAL_REQUIRED_REPLICATIONS * 30;
  const confidenceScore = clampScore(evidenceScore + replicationScore);

  return {
    schemaVersion: 1,
    scope: "local",
    status,
    confidenceScore,
    requiredReplications: LOCAL_REQUIRED_REPLICATIONS,
    observedReplications,
    requiredEvidencePoints: LOCAL_REQUIRED_EVIDENCE_POINTS,
    observedEvidencePoints: evidence.observed,
    bestStepId,
    candidateStepId: candidate.step.id,
    candidateDominatesBaseline,
    powerDeltaPercent: percentDelta(candidate.watts, baseline?.watts),
    hashrateDeltaPercent: percentDelta(candidate.qualityAdjustedHashrate, baseline?.qualityAdjustedHashrate),
    joulesDeltaPercent: percentDelta(candidate.qualityAdjustedJoulesPerTerahash, baseline?.qualityAdjustedJoulesPerTerahash),
    evidenceToRepeat: input.advisor.evidenceToRecord,
    missingEvidence,
    stopConditions: input.advisor.stopConditions,
    claimReady,
    miningStartAllowed: false,
    summary: claimReady
      ? `Local profile ${candidate.step.id} has ${observedReplications} complete independent samples and clears the confidence gate.`
      : completeEvidence
        ? `Local profile ${candidate.step.id} has ${observedReplications} complete sample${observedReplications === 1 ? "" : "s"}; repeat it before claiming lowest-power or highest-hash status.`
        : `Local profile ${candidate.step.id} has ${evidence.observed}/${LOCAL_REQUIRED_EVIDENCE_POINTS} required evidence points.`,
    nextStep: claimReady
      ? "Keep collecting periodic verification; this profile can support a local claim but still requires manual operation policy checks."
      : completeEvidence
        ? "Repeat the same profile with measured watts, share counters, duration, and thermals before promoting the result."
        : `Capture missing evidence: ${missingEvidence.slice(0, 3).join(", ")}.`,
  };
}

function externalConfidence(input: AlgorithmExperimentConfidenceInput): AlgorithmExperimentConfidenceSnapshot {
  const summary = input.externalHistory;
  const samples = summary?.usableEfficiencySampleCount ?? 0;
  const trendStable = summary?.trend === "stable" || summary?.trend === "improving";
  const trendDegrading = summary?.trend === "degrading";
  const observedEvidencePoints = [
    samples >= 1,
    samples >= EXTERNAL_MIN_SAMPLE_TARGET,
    samples >= EXTERNAL_STABLE_SAMPLE_TARGET,
    trendStable,
  ].filter(Boolean).length;

  let status: AlgorithmExperimentConfidenceStatus = "missing";
  if (samples === 1) {
    status = "single_sample";
  } else if (samples > 1 && samples < EXTERNAL_MIN_SAMPLE_TARGET) {
    status = "replication_needed";
  } else if (samples >= EXTERNAL_STABLE_SAMPLE_TARGET && trendStable && summary?.evidenceStatus === "stable") {
    status = "confident";
  } else if (samples >= EXTERNAL_MIN_SAMPLE_TARGET) {
    status = "provisional";
  }

  const missingEvidence: string[] = [];
  if (samples < EXTERNAL_MIN_SAMPLE_TARGET) {
    missingEvidence.push(`${EXTERNAL_MIN_SAMPLE_TARGET - samples} more usable external efficiency samples`);
  } else if (samples < EXTERNAL_STABLE_SAMPLE_TARGET) {
    missingEvidence.push(`${EXTERNAL_STABLE_SAMPLE_TARGET - samples} more stable external efficiency samples`);
  }
  if (trendDegrading) {
    missingEvidence.push("non-degrading external efficiency trend");
  }
  if (!summary?.bestEfficiencySample) {
    missingEvidence.push("external watts or J/TH telemetry");
  }

  const evidenceScore = samples >= EXTERNAL_STABLE_SAMPLE_TARGET
    ? 82
    : Math.min(75, samples / EXTERNAL_STABLE_SAMPLE_TARGET * 75);
  const trendScore = trendStable ? 18 : trendDegrading ? 0 : 8;
  const claimReady = status === "confident" && missingEvidence.length === 0;

  return {
    schemaVersion: 1,
    scope: "external",
    status,
    confidenceScore: clampScore(evidenceScore + trendScore),
    requiredReplications: EXTERNAL_STABLE_SAMPLE_TARGET,
    observedReplications: samples,
    requiredEvidencePoints: 4,
    observedEvidencePoints,
    bestStepId: null,
    candidateStepId: null,
    candidateDominatesBaseline: status === "confident" || status === "provisional",
    powerDeltaPercent: percentDelta(summary?.averageWatts ?? null, summary?.latestSample?.watts ?? null),
    hashrateDeltaPercent: percentDelta(summary?.averageHashrate ?? null, summary?.latestSample?.hashrate ?? null),
    joulesDeltaPercent: percentDelta(summary?.bestJoulesPerTerahash ?? null, summary?.averageJoulesPerTerahash ?? null),
    evidenceToRepeat: input.advisor.evidenceToRecord,
    missingEvidence,
    stopConditions: input.advisor.stopConditions,
    claimReady,
    miningStartAllowed: false,
    summary: claimReady
      ? `External telemetry has ${samples} usable stable samples and a non-degrading efficiency trend.`
      : `External telemetry has ${samples}/${EXTERNAL_STABLE_SAMPLE_TARGET} stable-sample target; ${summary?.summary ?? "history is waiting"}`,
    nextStep: claimReady
      ? "Keep external work dry-run gated; this evidence can support efficiency comparison but not automatic external mining."
      : missingEvidence.length > 0
        ? `Repeat external telemetry until ${missingEvidence[0]}.`
        : input.advisor.nextStep,
  };
}

function blockedConfidence(
  scope: AlgorithmExperimentConfidenceScope,
  input: AlgorithmExperimentConfidenceInput,
): AlgorithmExperimentConfidenceSnapshot {
  const direct = scope === "direct";
  return {
    schemaVersion: 1,
    scope,
    status: "blocked",
    confidenceScore: 0,
    requiredReplications: direct ? 1 : 0,
    observedReplications: 0,
    requiredEvidencePoints: direct ? 3 : 1,
    observedEvidencePoints: 0,
    bestStepId: null,
    candidateStepId: input.advisor.applyTargetStepId,
    candidateDominatesBaseline: false,
    powerDeltaPercent: null,
    hashrateDeltaPercent: null,
    joulesDeltaPercent: null,
    evidenceToRepeat: input.advisor.evidenceToRecord,
    missingEvidence: direct
      ? ["physical endpoint kind", "read-only endpoint identity", "protocol framing notes"]
      : ["consensus-safe production evidence"],
    stopConditions: input.advisor.stopConditions,
    claimReady: false,
    miningStartAllowed: false,
    summary: direct
      ? "Direct external hash is still reserved until real hardware proves the physical protocol."
      : "Research-frontier ideas are not claim-ready for runtime mining.",
    nextStep: input.advisor.nextStep,
  };
}

export function deriveAlgorithmExperimentConfidence(
  input: AlgorithmExperimentConfidenceInput,
): AlgorithmExperimentConfidenceSnapshot {
  const scope = confidenceScope(input.advisor);
  if (scope === "direct" || scope === "research") {
    return blockedConfidence(scope, input);
  }
  if (scope === "external") {
    return externalConfidence(input);
  }
  return localConfidence(input);
}

import type { EfficiencyComputeMode, EfficiencyGoal } from "./efficiencyEngine.js";
import type { TuningObservation } from "./efficiencyTuning.js";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
  deriveTuningApplyOption,
  findTuningSweepStepForRuntime,
  upsertTuningObservation,
} from "./efficiencyTuning.js";
import type { ExternalHashHistorySample } from "./externalHashHistory.js";
import { summarizeExternalHashHistory } from "./externalHashHistory.js";
import type { ExternalHashConfigLike, ExternalHashTelemetryLike } from "./externalHashInterface.js";
import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashEngineCandidateGate,
  deriveExternalHashInterfaceSpec,
  deriveExternalHashProtocolContract,
  deriveExternalHashSnapshot,
} from "./externalHashInterface.js";
import type { MiningAlgorithmPlan } from "./algorithmPlanner.js";
import { deriveMiningAlgorithmPlan } from "./algorithmPlanner.js";
import type { HashClaimCertificate } from "./hashClaimCertificate.js";
import { createHashClaimCertificate } from "./hashClaimCertificate.js";
import { assessHashHardwareCandidate } from "./hashHardwareAdvisor.js";
import type { HashHardwareReleaseEvidenceDossier, HashHardwareReleaseGate } from "./hashHardwareReleaseGate.js";
import { createHashHardwareReleaseEvidenceDossier, deriveHashHardwareReleaseGate } from "./hashHardwareReleaseGate.js";
import type { HashHardwareOperatingEvidenceSample, HashHardwareOperatingEvidenceSnapshot } from "./hashHardwareOperatingEvidence.js";
import {
  assessHashHardwareOperatingEvidence,
  deriveHashHardwareOperatingEvidenceSamplesFromExternalHistory,
} from "./hashHardwareOperatingEvidence.js";
import type { HashHardwareMeasurementProtocol } from "./hashHardwareMeasurementProtocol.js";
import { deriveHashHardwareMeasurementProtocol } from "./hashHardwareMeasurementProtocol.js";
import type { HashOperatingPolicySnapshot } from "./hashOperatingPolicy.js";
import { deriveHashOperatingPolicy } from "./hashOperatingPolicy.js";
import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import { deriveAlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmObjectiveActionPlan } from "./algorithmObjectiveActionPlan.js";
import { deriveAlgorithmObjectiveActionPlan } from "./algorithmObjectiveActionPlan.js";
import type { AlgorithmObjectiveExperimentPlan } from "./algorithmObjectiveExperiment.js";
import { deriveAlgorithmObjectiveExperimentPlan } from "./algorithmObjectiveExperiment.js";
import type { AlgorithmObjectiveFeedbackSnapshot } from "./algorithmObjectiveFeedback.js";
import { deriveAlgorithmObjectiveFeedback } from "./algorithmObjectiveFeedback.js";
import type { AlgorithmRuntimeRecommendationSnapshot } from "./algorithmRuntimeRecommendation.js";
import { deriveAlgorithmRuntimeRecommendation } from "./algorithmRuntimeRecommendation.js";
import type { AlgorithmPowerHashEnvelopeSnapshot } from "./algorithmPowerHashEnvelope.js";
import { deriveAlgorithmPowerHashEnvelope } from "./algorithmPowerHashEnvelope.js";
import type { AlgorithmRouteCertificate } from "./algorithmRouteCertificate.js";
import { deriveAlgorithmRouteCertificate } from "./algorithmRouteCertificate.js";
import type { AlgorithmObjectiveAuditSnapshot } from "./algorithmObjectiveAudit.js";
import { deriveAlgorithmObjectiveAudit } from "./algorithmObjectiveAudit.js";
import type { AlgorithmRunWindowPlanSnapshot } from "./algorithmRunWindowPlan.js";
import { deriveAlgorithmRunWindowPlan } from "./algorithmRunWindowPlan.js";
import type { AlgorithmRunEvidenceReviewSnapshot } from "./algorithmRunEvidenceReview.js";
import { deriveAlgorithmRunEvidenceReview } from "./algorithmRunEvidenceReview.js";
import type { AlgorithmProfileApplyGate, AlgorithmProfileApplyIntent } from "./algorithmProfileApplyGate.js";
import { deriveAlgorithmProfileApplyGate } from "./algorithmProfileApplyGate.js";
import { deriveHashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";
import type { HashBatchOptimizationSnapshot } from "./hashBatchOptimizer.js";
import { deriveHashBatchOptimization } from "./hashBatchOptimizer.js";
import type { HashKernelBenchmarkEvidence, HashKernelBenchmarkLike } from "./hashKernelBenchmark.js";
import { deriveHashKernelBenchmarkEvidence } from "./hashKernelBenchmark.js";
import type { AlgorithmSourceReference } from "./algorithmSourceRegistry.js";
import { algorithmSourceReferences } from "./algorithmSourceRegistry.js";
import type { AlgorithmExperimentAdvisorSnapshot } from "./algorithmExperimentAdvisor.js";
import { deriveAlgorithmExperimentAdvisor } from "./algorithmExperimentAdvisor.js";
import type { AlgorithmExperimentConfidenceSnapshot } from "./algorithmExperimentConfidence.js";
import { deriveAlgorithmExperimentConfidence } from "./algorithmExperimentConfidence.js";
import { deriveAlgorithmTuningDirective } from "./algorithmTuningDirective.js";
import { deriveExternalHashDryRunValidationInputs } from "../engines/externalHashDryRunValidation.js";
import type { ExternalHashShareSubmissionProof } from "../engines/externalHashShareProof.js";
import { deriveExternalHashWorkAdapterPlan } from "../engines/externalHashWorkAdapter.js";
import { deriveExternalHashEngineValidationChecklist } from "../engines/externalHashEngineValidation.js";

export interface MiningAlgorithmDiagnosticInput {
  config: ExternalHashConfigLike;
  telemetry?: ExternalHashTelemetryLike | null;
  tuningObservations: TuningObservation[];
  tuningHistory?: TuningObservation[] | null;
  externalHashHistory: ExternalHashHistorySample[];
  externalOperatingEvidenceSamples?: HashHardwareOperatingEvidenceSample[] | null;
  externalShareProofs?: ExternalHashShareSubmissionProof[] | null;
  algorithmKernelBenchmark?: HashKernelBenchmarkLike | null;
  goal?: EfficiencyGoal | null;
  generatedAt?: string;
  availableCpuThreads: number;
  recommendedCpuThreads: number;
  hardwareGpuAvailable: boolean;
  observedHashrate?: number | null;
  observedComputeMode?: EfficiencyComputeMode | null;
  observedCpuThreads?: number | null;
  observedGpuIntensityPercent?: number | null;
  observedSampleSeconds?: number | null;
  acceptedShares?: number | null;
  rejectedShares?: number | null;
  staleSharesDropped?: number | null;
  queuedSharesDropped?: number | null;
  gpuDispatchMs?: number | null;
  gpuThrottleMs?: number | null;
  benchmarkHashrate?: number | null;
  benchmarkGpuIntensityPercent?: number | null;
  currentComputeMode?: EfficiencyComputeMode | null;
  currentCpuThreads?: number | null;
  currentGpuIntensityPercent?: number | null;
}

export interface MiningAlgorithmDiagnosticSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  privacyNote: string;
  strategy: MiningAlgorithmPlan["strategy"];
  recommendedRoute: MiningAlgorithmPlan["recommendedRoute"];
  confidence: MiningAlgorithmPlan["confidence"];
  dryRunOnly: boolean;
  canAssignExternalWork: boolean;
  consensusBoundary: string;
  algorithmStack: MiningAlgorithmPlan["algorithmStack"];
  kernelBenchmark: HashKernelBenchmarkEvidence;
  summary: string;
  claimCertificate: HashClaimCertificate;
  hardwareReleaseGate: HashHardwareReleaseGate;
  hardwareReleaseDossier: HashHardwareReleaseEvidenceDossier;
  hardwareMeasurementProtocol: HashHardwareMeasurementProtocol;
  hardwareOperatingEvidence: {
    status: HashHardwareOperatingEvidenceSnapshot["status"];
    releaseReady: boolean;
    sampleCount: number;
    usableSampleCount: number;
    averageWallWatts: number | null;
    averageHashrate: number;
    effectiveHashrate: number;
    effectiveJoulesPerTerahash: number | null;
    shareWasteRatio: number | null;
    summary: string;
    nextStep: string;
  };
  operatingPolicy: HashOperatingPolicySnapshot;
  objectiveCertificate: AlgorithmObjectiveCertificate;
  routeCertificate: AlgorithmRouteCertificate;
  objectiveAudit: AlgorithmObjectiveAuditSnapshot;
  objectiveActionPlan: AlgorithmObjectiveActionPlan;
  objectiveExperiment: AlgorithmObjectiveExperimentPlan;
  objectiveFeedback: AlgorithmObjectiveFeedbackSnapshot;
  runtimeRecommendation: AlgorithmRuntimeRecommendationSnapshot;
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot;
  runWindowPlan: AlgorithmRunWindowPlanSnapshot;
  runEvidenceReview: AlgorithmRunEvidenceReviewSnapshot;
  profileApplyGates: Record<AlgorithmProfileApplyIntent, AlgorithmProfileApplyGate>;
  batchOptimization: {
    status: HashBatchOptimizationSnapshot["status"];
    action: HashBatchOptimizationSnapshot["action"];
    pressure: HashBatchOptimizationSnapshot["pressure"];
    confidence: HashBatchOptimizationSnapshot["confidence"];
    runtimeGuard: HashBatchOptimizationSnapshot["runtimeGuard"];
    runtimeEfficiencyStatus: HashBatchOptimizationSnapshot["runtimeEfficiencyStatus"];
    runtimePromotionAllowed: boolean;
    runtimeRecoveryAction: HashBatchOptimizationSnapshot["runtimeRecoveryAction"];
    runtimeQualityLossHashrate: number | null;
    runtimeThrottleHashrateAtRisk: number | null;
    currentStepId: string | null;
    currentStepSummary: string | null;
    targetStepId: string | null;
    targetStepSummary: string | null;
    targetComputeMode: string | null;
    targetCpuThreads: number | null;
    targetGpuIntensityPercent: number | null;
    dispatchLatencyMs: number | null;
    gpuThrottleRatio: number | null;
    shareWasteRatio: number | null;
    effectiveHashrate: number | null;
    wastedHashrate: number | null;
    gpuThrottleHashrateAtRisk: number | null;
    effectiveRatio: number | null;
    canApply: boolean;
    guardrails: string[];
    summary: string;
    nextStep: string;
  };
  experimentAdvisor: AlgorithmExperimentAdvisorSnapshot;
  experimentConfidence: AlgorithmExperimentConfidenceSnapshot;
  researchPolicy: {
    primaryLaneId: MiningAlgorithmPlan["researchPolicy"]["primaryLaneId"];
    allowedLaneIds: MiningAlgorithmPlan["researchPolicy"]["allowedLaneIds"];
    rejectedLaneIds: MiningAlgorithmPlan["researchPolicy"]["rejectedLaneIds"];
    runtimeIdeaIds: MiningAlgorithmPlan["researchPolicy"]["runtimeIdeaIds"];
    dryRunIdeaIds: MiningAlgorithmPlan["researchPolicy"]["dryRunIdeaIds"];
    telemetryIdeaIds: MiningAlgorithmPlan["researchPolicy"]["telemetryIdeaIds"];
    offlineIdeaIds: MiningAlgorithmPlan["researchPolicy"]["offlineIdeaIds"];
    deploymentSummary: string;
    powerPriority: string;
    hashratePriority: string;
  };
  researchReview: {
    primaryProductionIdeaId: string;
    primaryExperimentIdeaId: string | null;
    productionIdeaIds: MiningAlgorithmPlan["researchReview"]["productionIdeaIds"];
    experimentIdeaIds: MiningAlgorithmPlan["researchReview"]["experimentIdeaIds"];
    decisionOnlyIdeaIds: MiningAlgorithmPlan["researchReview"]["decisionOnlyIdeaIds"];
    rejectedIdeaIds: MiningAlgorithmPlan["researchReview"]["rejectedIdeaIds"];
    sourceIds: MiningAlgorithmPlan["researchReview"]["sourceIds"];
    sourceCount: number;
    sourceReferences: AlgorithmSourceReference[];
    primaryProductionSourceIds: string[];
    primaryExperimentSourceIds: string[];
    sourceSummary: string;
    nextStep: string;
    summary: string;
  };
  researchFreshness: {
    status: "current" | "review_due" | "unknown_dates";
    frontierReviewDays: number;
    frontierSourceIds: string[];
    reviewDueSourceIds: string[];
    undatedFrontierSourceIds: string[];
    latestPublishedAt: string | null;
    summary: string;
    nextStep: string;
  };
  researchPromotionGate: {
    status: "clear" | "review_required";
    frontierPromotionAllowed: boolean;
    runtimeProfilePromotionAllowed: boolean;
    blockedSourceIds: string[];
    protectedRuntimeSourceIds: string[];
    summary: string;
    nextStep: string;
  };
  offlineResearchGuard: {
    isolatedIdeaIds: MiningAlgorithmPlan["researchPolicy"]["offlineIdeaIds"];
    productionInfluenceAllowed: false;
    dryRunInfluenceAllowed: false;
    routeInfluenceAllowed: false;
    timingProbeExperimentId: string | null;
    timingProbeStatus: string | null;
    summary: string;
    nextStep: string;
  };
  readiness: {
    readinessScore: number;
    readyForUnattendedLocal: boolean;
    readyForExternalDryRun: boolean;
    readyForExternalMining: boolean;
    primaryMissingGateId: string | null;
    primaryMissingGateStatus: string | null;
    primaryMissingGateSummary: string | null;
    summary: string;
  };
  density: {
    strategy: MiningAlgorithmPlan["densityPlan"]["strategy"];
    readinessScore: number;
    readyForLongRun: boolean;
    externalIsEfficiencyReference: boolean;
    externalDryRunOnly: boolean;
    miningStartAllowed: false;
    selectedLaneId: string;
    selectedLaneSource: string;
    selectedLaneStatus: string;
    selectedLaneHashrate: number | null;
    selectedLaneWatts: number | null;
    selectedLaneJoulesPerTerahash: number | null;
    primaryMissingGateId: string | null;
    headroomStatus: string;
    marginalDecisionStatus: MiningAlgorithmPlan["densityPlan"]["marginalDecision"]["status"];
    marginalDensityRetentionRatio: number | null;
    marginalDecisionSummary: string;
    marginalDecisionNextStep: string;
    summary: string;
    nextStep: string;
  };
  hardwareCandidate: {
    status: MiningAlgorithmPlan["hardwareCandidate"]["status"];
    score: number;
    hashrate: number;
    effectiveHashrate: number;
    watts: number | null;
    joulesPerTerahash: number | null;
    workLeaseUtilizationRatio: number | null;
    workLeaseUniquePartitionRatio: number | null;
    workLeaseRouteUtilizationRatio: number | null;
    hashWasteRisk: MiningAlgorithmPlan["hardwareCandidate"]["hashWasteRisk"];
    canReadTelemetry: boolean;
    canCompareEfficiency: boolean;
    canControlJobs: boolean;
    canSubmitShares: boolean;
    canRouteWork: boolean;
    miningStartAllowed: false;
    riskFlags: string[];
    summary: string;
    nextStep: string;
  };
  evidenceRoadmap: {
    completionScore: number;
    primaryPhaseId: string;
    primaryPhaseStatus: string;
    blockedPhaseIds: string[];
    researchFrontierStatus: string | null;
    researchFrontierNextStep: string | null;
    localLongRunReady: boolean;
    externalDryRunReady: boolean;
    externalMiningAllowed: false;
    summary: string;
    nextStep: string;
  };
  samplingPlan: {
    primaryTaskId: string;
    primaryTaskStatus: string;
    requiredSeconds: number | null;
    remainingSeconds: number | null;
    requiredShareEvents: number | null;
    remainingShareEvents: number | null;
    requiresMeasuredPower: boolean;
    requiresCoolOrWarmThermals: boolean;
    targetProfile: string | null;
    summary: string;
    nextStep: string;
  };
  riskFlags: string[];
}

export interface MiningAlgorithmRuntimeSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  routeCertificate: AlgorithmRouteCertificate;
  runtimeRecommendation: AlgorithmRuntimeRecommendationSnapshot;
  objectiveExperiment: AlgorithmObjectiveExperimentPlan;
  objectiveAudit: AlgorithmObjectiveAuditSnapshot;
  objectiveCertificate: AlgorithmObjectiveCertificate;
  objectiveActionPlan: AlgorithmObjectiveActionPlan;
  claimCertificate: HashClaimCertificate;
}

function normalizeGoal(goal: EfficiencyGoal | null | undefined): EfficiencyGoal {
  return goal === "lowest_power" || goal === "max_efficiency" || goal === "max_hashrate" ? goal : "balanced";
}

function positiveInteger(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.trunc(value)) : fallback;
}

function finitePositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function diagnosticCounter(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0));
}

const FRONTIER_RESEARCH_REVIEW_DAYS = 90;

function deriveResearchFreshness(review: MiningAlgorithmPlan["researchReview"]) {
  const envelope = review.safetyEnvelope;
  const frontierSourceIds = envelope.speculativeSourceIds;
  const reviewDueSourceIds = envelope.staleFrontierSourceIds;
  const undatedFrontierSourceIds = envelope.undatedDecisionSourceIds;
  const latestPublishedAt = envelope.sourceFreshness
    .filter((source) => frontierSourceIds.includes(source.sourceId) && source.publishedAt !== null)
    .map((source) => source.publishedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const status: "current" | "review_due" | "unknown_dates" = reviewDueSourceIds.length > 0
    ? "review_due"
    : undatedFrontierSourceIds.length > 0 ? "unknown_dates" : "current";

  return {
    status,
    frontierReviewDays: FRONTIER_RESEARCH_REVIEW_DAYS,
    frontierSourceIds,
    reviewDueSourceIds,
    undatedFrontierSourceIds,
    latestPublishedAt,
    summary: reviewDueSourceIds.length > 0
      ? `Research freshness review due for ${reviewDueSourceIds.length} frontier source${reviewDueSourceIds.length === 1 ? "" : "s"}; refresh before promoting any new algorithm claim.`
      : undatedFrontierSourceIds.length > 0
        ? `Research freshness has ${undatedFrontierSourceIds.length} undated frontier source${undatedFrontierSourceIds.length === 1 ? "" : "s"}; keep them decision-only or offline.`
        : `Research freshness is current for frontier sources within ${FRONTIER_RESEARCH_REVIEW_DAYS} days of this diagnostic snapshot.`,
    nextStep: reviewDueSourceIds.length > 0
      ? "Refresh the paper/protocol watchlist and update source boundaries before claiming the latest low-power or high-hash algorithm path."
      : undatedFrontierSourceIds.length > 0
        ? "Add dated source references or keep undated frontier sources out of runtime and dry-run decisions."
        : "Keep protocol and consensus sources stable; refresh frontier research during the next algorithm review.",
  };
}
function diagnosticRuntimeStep(
  plan: ReturnType<typeof createTuningSweepPlan>,
  input: MiningAlgorithmDiagnosticInput,
) {
  const mode = input.observedComputeMode ?? input.currentComputeMode;
  if (!mode) {
    return null;
  }

  const cpuThreads = typeof input.observedCpuThreads === "number"
    ? input.observedCpuThreads
    : input.currentCpuThreads;
  const gpuIntensity = typeof input.observedGpuIntensityPercent === "number"
    ? input.observedGpuIntensityPercent
    : input.currentGpuIntensityPercent;

  return findTuningSweepStepForRuntime(plan, {
    computeMode: mode,
    cpuThreads,
    gpuIntensityPercent: gpuIntensity,
  });
}

function liveTuningObservation(
  plan: ReturnType<typeof createTuningSweepPlan>,
  input: MiningAlgorithmDiagnosticInput,
): TuningObservation | null {
  if (!finitePositiveNumber(input.observedHashrate)) {
    return null;
  }

  const step = diagnosticRuntimeStep(plan, input);
  if (!step) {
    return null;
  }

  return {
    stepId: step.id,
    hashrate: Number(input.observedHashrate),
    watts: step.estimatedWatts,
    powerEvidenceStatus: "estimated",
    acceptedShares: diagnosticCounter(input.acceptedShares),
    rejectedShares: diagnosticCounter(input.rejectedShares),
    staleSharesDropped: diagnosticCounter(input.staleSharesDropped),
    queuedSharesDropped: diagnosticCounter(input.queuedSharesDropped),
    gpuDispatchMs: diagnosticCounter(input.gpuDispatchMs),
    gpuThrottleMs: diagnosticCounter(input.gpuThrottleMs),
    sampleSeconds: finitePositiveNumber(input.observedSampleSeconds) ? Number(input.observedSampleSeconds) : null,
  };
}

function diagnosticTuningObservations(
  plan: ReturnType<typeof createTuningSweepPlan>,
  input: MiningAlgorithmDiagnosticInput,
  replaceExisting: boolean,
) {
  const liveObservation = liveTuningObservation(plan, input);
  if (!liveObservation) {
    return input.tuningObservations;
  }
  if (!replaceExisting && input.tuningObservations.some((observation) => observation.stepId === liveObservation.stepId)) {
    return input.tuningObservations;
  }
  return upsertTuningObservation(input.tuningObservations, liveObservation);
}

function buildPlan(input: MiningAlgorithmDiagnosticInput) {
  const availableCpuThreads = positiveInteger(input.availableCpuThreads, 1);
  const recommendedCpuThreads = Math.min(
    availableCpuThreads,
    positiveInteger(input.recommendedCpuThreads, Math.min(availableCpuThreads, 2)),
  );
  const tuningSweepPlan = createTuningSweepPlan({
    goal: normalizeGoal(input.goal),
    availableCpuThreads,
    recommendedCpuThreads,
    hardwareGpuAvailable: input.hardwareGpuAvailable,
    observedHashrate: input.observedHashrate,
    observedComputeMode: input.observedComputeMode,
    observedCpuThreads: input.observedCpuThreads,
    observedGpuIntensityPercent: input.observedGpuIntensityPercent,
    benchmarkHashrate: input.benchmarkHashrate,
    benchmarkGpuIntensityPercent: input.benchmarkGpuIntensityPercent,
    currentComputeMode: input.currentComputeMode,
    currentCpuThreads: input.currentCpuThreads,
    currentGpuIntensityPercent: input.currentGpuIntensityPercent,
    maxSteps: 5,
    sampleSeconds: 60,
  });
  const tuningAnalysis = analyzeTuningObservations(tuningSweepPlan, diagnosticTuningObservations(tuningSweepPlan, input, false));
  const externalSnapshot = deriveExternalHashSnapshot(input.config, input.telemetry ?? null);
  const externalCapabilityMatrix = deriveExternalHashCapabilityMatrix(externalSnapshot);
  const externalWorkAdapterPlan = deriveExternalHashWorkAdapterPlan(externalSnapshot, externalCapabilityMatrix);
  const externalHistorySummary = summarizeExternalHashHistory([]);
  const kernelBenchmark = deriveHashKernelBenchmarkEvidence(input.algorithmKernelBenchmark ?? null);
  const plan = deriveMiningAlgorithmPlan({
    tuningAnalysis,
    externalHistory: externalHistorySummary,
    externalSnapshot,
    externalCapabilityMatrix,
    externalWorkAdapterPlan,
    externalOperatingEvidence: null,
    externalAlgorithmMode: "local_only",
    midstateReuseReady: kernelBenchmark.status === "passed" ? true : kernelBenchmark.status === "blocked" ? false : null,
    midstatePerformance: kernelBenchmark.performance,
    researchReviewedAt: input.generatedAt?.slice(0, 10),
  });
  return { plan, tuningSweepPlan, tuningAnalysis, kernelBenchmark };
}

function createLocalClaimCertificate(
  input: MiningAlgorithmDiagnosticInput,
  plan: MiningAlgorithmPlan,
  generatedAt: string,
) {
  return createHashClaimCertificate({
    tuningObservations: input.tuningObservations,
    tuningHistory: input.tuningHistory ?? input.tuningObservations,
    externalHashHistory: [],
    externalEffectiveHashrate: null,
    preferredGoal: normalizeGoal(input.goal),
    externalWorkAssignable: false,
    externalMiningStartAllowed: false,
    marginalDecision: plan.densityPlan.marginalDecision,
    generatedAt,
  });
}

function buildRuntimeDiagnostic(input: MiningAlgorithmDiagnosticInput) {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const { plan, tuningSweepPlan, tuningAnalysis, kernelBenchmark } = buildPlan({ ...input, generatedAt });
  const runtimeEfficiency = deriveHashRuntimeEfficiencySnapshot({
    hashrate: input.observedHashrate,
    acceptedShares: input.acceptedShares,
    rejectedShares: input.rejectedShares,
    staleSharesDropped: input.staleSharesDropped,
    queuedSharesDropped: input.queuedSharesDropped,
    gpuDispatchMs: input.gpuDispatchMs,
    gpuThrottleMs: input.gpuThrottleMs,
    sampleSeconds: input.observedSampleSeconds,
  });
  const operatingPolicy = deriveHashOperatingPolicy(plan, { runtimeEfficiency, kernelBenchmark });
  const objectiveCertificate = deriveAlgorithmObjectiveCertificate(plan, operatingPolicy);
  const diagnosticCurrentMode = input.currentComputeMode ?? input.observedComputeMode;
  const diagnosticCurrentCpuThreads = input.currentCpuThreads ?? input.observedCpuThreads;
  const diagnosticCurrentGpuIntensityPercent = input.currentGpuIntensityPercent ?? input.observedGpuIntensityPercent;
  const diagnosticCurrentStep = findTuningSweepStepForRuntime(tuningSweepPlan, {
    computeMode: diagnosticCurrentMode,
    cpuThreads: diagnosticCurrentCpuThreads,
    gpuIntensityPercent: diagnosticCurrentGpuIntensityPercent,
  });
  const algorithmTuningDirective = deriveAlgorithmTuningDirective({
    samplingPlan: plan.samplingPlan,
    tuningSweepPlan,
    tuningAnalysis,
    runtimeEfficiency,
    currentStep: diagnosticCurrentStep,
  });
  const batchTuningAnalysis = analyzeTuningObservations(
    tuningSweepPlan,
    diagnosticTuningObservations(tuningSweepPlan, input, true),
  );
  const batchOptimization = deriveHashBatchOptimization({
    tuningSweepPlan,
    tuningAnalysis: batchTuningAnalysis,
    currentComputeMode: input.currentComputeMode ?? input.observedComputeMode,
    currentCpuThreads: input.currentCpuThreads ?? input.observedCpuThreads,
    currentGpuIntensityPercent: input.currentGpuIntensityPercent ?? input.observedGpuIntensityPercent,
    objective: normalizeGoal(input.goal),
    runtimeEfficiency,
  });
  const experimentAdvisor = deriveAlgorithmExperimentAdvisor(plan, algorithmTuningDirective);
  const objectiveActionPlan = deriveAlgorithmObjectiveActionPlan(objectiveCertificate, experimentAdvisor, algorithmTuningDirective);
  const objectiveExperiment = deriveAlgorithmObjectiveExperimentPlan({
    certificate: objectiveCertificate,
    samplingPlan: plan.samplingPlan,
    tuningDirective: algorithmTuningDirective,
    actionPlan: objectiveActionPlan,
  });
  const objectiveFeedback = deriveAlgorithmObjectiveFeedback({
    experiment: objectiveExperiment,
    tuningSweepPlan,
    tuningAnalysis,
  });
  const profileApplyGateInput = (
    intent: AlgorithmProfileApplyIntent,
    baseCanApply: boolean,
    baseSummary: string,
    baseNextStep: string,
    targetStep: Parameters<typeof deriveAlgorithmProfileApplyGate>[0]["targetStep"],
  ) => deriveAlgorithmProfileApplyGate({
    certificate: objectiveCertificate,
    actionPlan: objectiveActionPlan,
    intent,
    baseCanApply,
    baseSummary,
    baseNextStep,
    targetStep,
    currentStep: diagnosticCurrentStep,
  });
  const tuningApplyGateInput = { runtimeEfficiency, currentStep: diagnosticCurrentStep };
  const lowestPowerApplyOption = deriveTuningApplyOption(tuningAnalysis, "lowest_power", tuningApplyGateInput);
  const bestEfficiencyApplyOption = deriveTuningApplyOption(tuningAnalysis, "best_efficiency", tuningApplyGateInput);
  const bestHashrateApplyOption = deriveTuningApplyOption(tuningAnalysis, "best_hashrate", tuningApplyGateInput);
  const profileApplyGates: Record<AlgorithmProfileApplyIntent, AlgorithmProfileApplyGate> = {
    objective_tune: profileApplyGateInput(
      "objective_tune",
      algorithmTuningDirective.canApplyLocalProfile,
      algorithmTuningDirective.summary,
      algorithmTuningDirective.nextStep,
      algorithmTuningDirective.step,
    ),
    batch_optimize: profileApplyGateInput(
      "batch_optimize",
      batchOptimization.canApply,
      batchOptimization.summary,
      batchOptimization.nextStep,
      batchOptimization.targetStep,
    ),
    lowest_power: profileApplyGateInput(
      "lowest_power",
      lowestPowerApplyOption.canApply,
      lowestPowerApplyOption.summary,
      lowestPowerApplyOption.nextStep,
      lowestPowerApplyOption.result?.step ?? null,
    ),
    best_efficiency: profileApplyGateInput(
      "best_efficiency",
      bestEfficiencyApplyOption.canApply,
      bestEfficiencyApplyOption.summary,
      bestEfficiencyApplyOption.nextStep,
      bestEfficiencyApplyOption.result?.step ?? null,
    ),
    best_hashrate: profileApplyGateInput(
      "best_hashrate",
      bestHashrateApplyOption.canApply,
      bestHashrateApplyOption.summary,
      bestHashrateApplyOption.nextStep,
      bestHashrateApplyOption.result?.step ?? null,
    ),
  };
  const runtimeRecommendation = deriveAlgorithmRuntimeRecommendation({
    operatingPolicy,
    objectiveFeedback,
    profileApplyGates,
    runtimeSampleSeconds: input.observedSampleSeconds,
  });
  const powerHashEnvelope = deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate,
    operatingPolicy,
    runtimeRecommendation,
  });
  const runWindowPlan = deriveAlgorithmRunWindowPlan({
    powerHashEnvelope,
    runtimeRecommendation,
    objectiveExperiment,
  });
  const routeCertificate = deriveAlgorithmRouteCertificate({
    plan,
    objectiveCertificate,
    objectiveActionPlan,
    powerHashEnvelope,
  });
  const runEvidenceReview = deriveAlgorithmRunEvidenceReview({
    runWindowPlan,
    powerHashEnvelope,
    tuningAnalysis,
  });
  const selectedLane = plan.densityPlan.selectedLane;
  const primarySamplingTask = plan.samplingPlan.primaryTask;
  const offlineTimingProbe = plan.experimentQueue.experiments.find((experiment) => experiment.id === "record_offline_timing_probe") ?? null;
  const offlineTimingIdeaIds = plan.researchPolicy.offlineIdeaIds.filter((id) => id === "thermodynamic_asic_prediction");
  const researchFreshness = deriveResearchFreshness(plan.researchReview);
  const researchPromotionGate = plan.researchPromotionGate;
  const diagnosticEvidenceRoadmap = plan.evidenceRoadmap;
  const diagnosticResearchFrontierPhase = diagnosticEvidenceRoadmap.phases.find((phase) => phase.id === "research_frontier_filter") ?? null;
  const diagnosticReadiness = {
    readinessScore: plan.readinessCertificate.readinessScore,
    readyForUnattendedLocal: plan.readinessCertificate.readyForUnattendedLocal,
    readyForExternalDryRun: plan.readinessCertificate.readyForExternalDryRun,
    readyForExternalMining: plan.readinessCertificate.readyForExternalMining,
    primaryMissingGateId: plan.readinessCertificate.primaryMissingGate?.id ?? null,
    primaryMissingGateStatus: plan.readinessCertificate.primaryMissingGate?.status ?? null,
    primaryMissingGateSummary: plan.readinessCertificate.primaryMissingGate?.summary ?? null,
    summary: plan.readinessCertificate.summary,
  };
  const diagnosticEvidenceRoadmapSnapshot = {
    completionScore: diagnosticEvidenceRoadmap.completionScore,
    primaryPhaseId: diagnosticEvidenceRoadmap.primaryPhase.id,
    primaryPhaseStatus: diagnosticEvidenceRoadmap.primaryPhase.status,
    blockedPhaseIds: diagnosticEvidenceRoadmap.blockedPhaseIds,
    researchFrontierStatus: diagnosticResearchFrontierPhase?.status ?? null,
    researchFrontierNextStep: diagnosticResearchFrontierPhase?.nextStep ?? null,
    localLongRunReady: diagnosticEvidenceRoadmap.localLongRunReady,
    externalDryRunReady: diagnosticEvidenceRoadmap.externalDryRunReady,
    externalMiningAllowed: false as const,
    summary: diagnosticEvidenceRoadmap.summary,
    nextStep: diagnosticEvidenceRoadmap.nextStep,
  };
  const objectiveAudit = deriveAlgorithmObjectiveAudit({
    objectiveCertificate,
    routeCertificate,
    powerHashEnvelope,
    researchFreshness,
    readiness: diagnosticReadiness,
    evidenceRoadmap: diagnosticEvidenceRoadmapSnapshot,
  });
  const claimCertificate = createLocalClaimCertificate(input, plan, generatedAt);
  return {
    generatedAt,
    plan,
    tuningSweepPlan,
    tuningAnalysis,
    kernelBenchmark,
    runtimeEfficiency,
    operatingPolicy,
    objectiveCertificate,
    diagnosticCurrentStep,
    algorithmTuningDirective,
    batchOptimization,
    experimentAdvisor,
    objectiveActionPlan,
    objectiveExperiment,
    objectiveFeedback,
    profileApplyGates,
    runtimeRecommendation,
    powerHashEnvelope,
    runWindowPlan,
    routeCertificate,
    runEvidenceReview,
    selectedLane,
    primarySamplingTask,
    offlineTimingProbe,
    offlineTimingIdeaIds,
    researchFreshness,
    researchPromotionGate,
    diagnosticEvidenceRoadmapSnapshot,
    diagnosticReadiness,
    objectiveAudit,
    claimCertificate,
  };
}

export function createMiningAlgorithmRuntimeSnapshot(
  input: MiningAlgorithmDiagnosticInput,
): MiningAlgorithmRuntimeSnapshot {
  const runtime = buildRuntimeDiagnostic(input);
  return {
    schemaVersion: 1,
    generatedAt: runtime.generatedAt,
    routeCertificate: runtime.routeCertificate,
    runtimeRecommendation: runtime.runtimeRecommendation,
    objectiveExperiment: runtime.objectiveExperiment,
    objectiveAudit: runtime.objectiveAudit,
    objectiveCertificate: runtime.objectiveCertificate,
    objectiveActionPlan: runtime.objectiveActionPlan,
    claimCertificate: runtime.claimCertificate,
  };
}

export function createMiningAlgorithmDiagnosticSnapshot(
  input: MiningAlgorithmDiagnosticInput,
): MiningAlgorithmDiagnosticSnapshot {
  const {
    generatedAt,
    plan,
    tuningAnalysis,
    kernelBenchmark,
    runtimeEfficiency,
    operatingPolicy,
    objectiveCertificate,
    routeCertificate,
    objectiveAudit,
    objectiveActionPlan,
    objectiveExperiment,
    objectiveFeedback,
    runtimeRecommendation,
    powerHashEnvelope,
    runWindowPlan,
    runEvidenceReview,
    profileApplyGates,
    batchOptimization,
    experimentAdvisor,
    selectedLane,
    primarySamplingTask,
    offlineTimingProbe,
    offlineTimingIdeaIds,
    researchFreshness,
    researchPromotionGate,
    diagnosticEvidenceRoadmapSnapshot,
    diagnosticReadiness,
    claimCertificate,
  } = buildRuntimeDiagnostic(input);
  const externalHistorySummary = summarizeExternalHashHistory(input.externalHashHistory);
  const experimentConfidence = deriveAlgorithmExperimentConfidence({
    advisor: experimentAdvisor,
    tuningAnalysis,
    tuningHistory: input.tuningHistory ?? input.tuningObservations,
    externalHistory: externalHistorySummary,
  });
  const externalSnapshot = deriveExternalHashSnapshot(input.config, input.telemetry ?? null);
  const externalCapabilityMatrix = deriveExternalHashCapabilityMatrix(externalSnapshot);
  const externalEngineGate = deriveExternalHashEngineCandidateGate(externalSnapshot, externalCapabilityMatrix);
  const externalInterfaceSpec = deriveExternalHashInterfaceSpec(externalSnapshot, externalCapabilityMatrix, externalEngineGate);
  const externalProtocolContract = deriveExternalHashProtocolContract(externalInterfaceSpec, externalCapabilityMatrix);
  const operatingEvidenceSamples = input.externalOperatingEvidenceSamples ??
    deriveHashHardwareOperatingEvidenceSamplesFromExternalHistory(input.externalHashHistory);
  const operatingEvidence = assessHashHardwareOperatingEvidence(operatingEvidenceSamples);
  const externalReleaseWorkAdapterPlan = deriveExternalHashWorkAdapterPlan(externalSnapshot, externalCapabilityMatrix);
  const externalHardwareCandidate = assessHashHardwareCandidate({
    id: externalSnapshot.endpoint || externalSnapshot.interfaceKind,
    label: externalSnapshot.label || externalSnapshot.endpoint || "External Candidate",
    interfaceKind: externalSnapshot.interfaceKind === "network" || externalSnapshot.interfaceKind === "direct" ? externalSnapshot.interfaceKind : "unknown",
    hashrate: operatingEvidence.effectiveHashrate ?? externalSnapshot.hashrate ?? externalHistorySummary.averageHashrate,
    watts: operatingEvidence.averageWallWatts ?? externalSnapshot.watts ?? externalHistorySummary.averageWatts,
    joulesPerTerahash: operatingEvidence.effectiveJoulesPerTerahash ?? operatingEvidence.bestJoulesPerTerahash ?? externalSnapshot.joulesPerTerahash ?? externalHistorySummary.averageJoulesPerTerahash ?? externalHistorySummary.bestJoulesPerTerahash,
    supportsTelemetry: externalCapabilityMatrix.canReadTelemetry,
    supportsPowerTelemetry: externalCapabilityMatrix.canCompareEfficiency,
    supportsJobControl: externalCapabilityMatrix.canControlMining,
    supportsShareSubmission: externalCapabilityMatrix.canSubmitShares,
    supportsVersionRolling: externalCapabilityMatrix.canRollVersion,
    supportsWorkPartitioning: externalCapabilityMatrix.canPartitionWork,
    parallelWorkers: externalSnapshot.parallelWorkers,
    targetJobSeconds: 1,
  }, normalizeGoal(input.goal));
  const externalValidationInputs = deriveExternalHashDryRunValidationInputs(
    externalSnapshot,
    externalCapabilityMatrix,
    { shareProofs: input.externalShareProofs ?? [] },
  );
  const externalValidationChecklist = deriveExternalHashEngineValidationChecklist(externalValidationInputs);
  const hardwareClaimCertificate = createHashClaimCertificate({
    tuningObservations: input.tuningObservations,
    tuningHistory: input.tuningHistory ?? input.tuningObservations,
    externalHashHistory: input.externalHashHistory,
    externalEffectiveHashrate: operatingEvidence.effectiveHashrate ?? externalSnapshot.hashrate ?? externalHistorySummary.averageHashrate,
    preferredGoal: normalizeGoal(input.goal),
    externalWorkAssignable: externalReleaseWorkAdapterPlan.canAssignWork,
    externalMiningStartAllowed: false,
    marginalDecision: plan.densityPlan.marginalDecision,
    generatedAt,
  });
  const hardwareReleaseGate = deriveHashHardwareReleaseGate({
    protocolContract: externalProtocolContract,
    externalHistory: externalHistorySummary,
    operatingEvidence,
    validationChecklist: externalValidationChecklist,
    claimCertificate: hardwareClaimCertificate,
  });
  const hardwareReleaseDossier = createHashHardwareReleaseEvidenceDossier(hardwareReleaseGate);
  const hardwareMeasurementProtocol = deriveHashHardwareMeasurementProtocol(hardwareReleaseDossier);
  return {
    schemaVersion: 1,
    generatedAt,
    privacyNote: "Mining algorithm diagnostics omit raw external endpoints, BTC address, pool password, webhook URL, and Stratum messages.",
    strategy: plan.strategy,
    recommendedRoute: plan.recommendedRoute,
    confidence: plan.confidence,
    dryRunOnly: plan.dryRunOnly,
    canAssignExternalWork: plan.canAssignExternalWork,
    consensusBoundary: plan.consensusBoundary,
    algorithmStack: plan.algorithmStack,
    kernelBenchmark,
    summary: plan.summary,
    claimCertificate,
    hardwareReleaseGate,
    hardwareReleaseDossier,
    hardwareMeasurementProtocol,
    hardwareOperatingEvidence: {
      status: operatingEvidence.status,
      releaseReady: operatingEvidence.releaseReady,
      sampleCount: operatingEvidence.sampleCount,
      usableSampleCount: operatingEvidence.usableSampleCount,
      averageWallWatts: operatingEvidence.averageWallWatts,
      averageHashrate: operatingEvidence.averageHashrate,
      effectiveHashrate: operatingEvidence.effectiveHashrate,
      effectiveJoulesPerTerahash: operatingEvidence.effectiveJoulesPerTerahash,
      shareWasteRatio: operatingEvidence.shareWasteRatio,
      summary: operatingEvidence.summary,
      nextStep: operatingEvidence.nextStep,
    },
    operatingPolicy,
    objectiveCertificate,
    routeCertificate,
    objectiveAudit,
    objectiveActionPlan,
    objectiveExperiment,
    objectiveFeedback,
    runtimeRecommendation,
    powerHashEnvelope,
    runWindowPlan,
    runEvidenceReview,
    profileApplyGates,
    batchOptimization: {
      status: batchOptimization.status,
      action: batchOptimization.action,
      pressure: batchOptimization.pressure,
      confidence: batchOptimization.confidence,
      runtimeGuard: batchOptimization.runtimeGuard,
      runtimeEfficiencyStatus: batchOptimization.runtimeEfficiencyStatus,
      runtimePromotionAllowed: batchOptimization.runtimePromotionAllowed,
      runtimeRecoveryAction: batchOptimization.runtimeRecoveryAction,
      runtimeQualityLossHashrate: batchOptimization.runtimeQualityLossHashrate,
      runtimeThrottleHashrateAtRisk: batchOptimization.runtimeThrottleHashrateAtRisk,
      currentStepId: batchOptimization.currentStep?.id ?? null,
      currentStepSummary: batchOptimization.currentStep?.summary ?? null,
      targetStepId: batchOptimization.targetStep?.id ?? null,
      targetStepSummary: batchOptimization.targetStep?.summary ?? null,
      targetComputeMode: batchOptimization.targetStep?.computeMode ?? null,
      targetCpuThreads: batchOptimization.targetStep?.cpuThreads ?? null,
      targetGpuIntensityPercent: batchOptimization.targetGpuIntensityPercent,
      dispatchLatencyMs: batchOptimization.dispatchLatencyMs,
      gpuThrottleRatio: batchOptimization.gpuThrottleRatio,
      shareWasteRatio: batchOptimization.shareWasteRatio,
      effectiveHashrate: runtimeEfficiency.rawHashrate > 0 ? runtimeEfficiency.provenEffectiveHashrate : null,
      wastedHashrate: runtimeEfficiency.rawHashrate > 0 ? runtimeEfficiency.provenWastedHashrate : null,
      gpuThrottleHashrateAtRisk: runtimeEfficiency.rawHashrate > 0 ? runtimeEfficiency.gpuThrottleHashrateAtRisk : null,
      effectiveRatio: runtimeEfficiency.rawHashrate > 0 ? runtimeEfficiency.effectiveRatio : null,
      canApply: batchOptimization.canApply,
      guardrails: batchOptimization.guardrails,
      summary: batchOptimization.summary,
      nextStep: batchOptimization.nextStep,
    },
    experimentAdvisor,
    experimentConfidence,
    researchPolicy: {
      primaryLaneId: plan.researchPolicy.primaryLaneId,
      allowedLaneIds: plan.researchPolicy.allowedLaneIds,
      rejectedLaneIds: plan.researchPolicy.rejectedLaneIds,
      runtimeIdeaIds: plan.researchPolicy.runtimeIdeaIds,
      dryRunIdeaIds: plan.researchPolicy.dryRunIdeaIds,
      telemetryIdeaIds: plan.researchPolicy.telemetryIdeaIds,
      offlineIdeaIds: plan.researchPolicy.offlineIdeaIds,
      deploymentSummary: plan.researchPolicy.deploymentSummary,
      powerPriority: plan.researchPolicy.powerPriority,
      hashratePriority: plan.researchPolicy.hashratePriority,
    },
    researchReview: {
      primaryProductionIdeaId: plan.researchReview.primaryProductionIdea.id,
      primaryExperimentIdeaId: plan.researchReview.primaryExperimentIdea?.id ?? null,
      productionIdeaIds: plan.researchReview.productionIdeaIds,
      experimentIdeaIds: plan.researchReview.experimentIdeaIds,
      decisionOnlyIdeaIds: plan.researchReview.decisionOnlyIdeaIds,
      rejectedIdeaIds: plan.researchReview.rejectedIdeaIds,
      sourceIds: plan.researchReview.sourceIds,
      sourceCount: plan.researchReview.sourceIds.length,
      sourceReferences: algorithmSourceReferences(plan.researchReview.sourceIds),
      primaryProductionSourceIds: plan.researchReview.primaryProductionIdea.sourceIds,
      primaryExperimentSourceIds: plan.researchReview.primaryExperimentIdea?.sourceIds ?? [],
      sourceSummary: `${plan.researchReview.sourceIds.length} source-backed research constraints are active; production ideas stay consensus-safe and frontier ideas remain dry-run, telemetry, offline, or decision-only until evidence gates pass.`,
      nextStep: plan.researchReview.nextStep,
      summary: plan.researchReview.summary,
    },
    researchFreshness,
    researchPromotionGate,
    offlineResearchGuard: {
      isolatedIdeaIds: offlineTimingIdeaIds,
      productionInfluenceAllowed: false,
      dryRunInfluenceAllowed: false,
      routeInfluenceAllowed: false,
      timingProbeExperimentId: offlineTimingProbe?.id ?? null,
      timingProbeStatus: offlineTimingProbe?.status ?? null,
      summary: offlineTimingIdeaIds.length > 0
        ? "Timing-prediction, thermodynamic, and TPF research is isolated from production mining, dry-run routing, and nonce pruning."
        : "No timing-prediction research idea is active in this diagnostic snapshot.",
      nextStep: offlineTimingProbe?.nextStep ?? "Keep predictive timing claims offline until independent accepted-share validation exists.",
    },
    readiness: diagnosticReadiness,

    density: {
      strategy: plan.densityPlan.strategy,
      readinessScore: plan.densityPlan.readinessScore,
      readyForLongRun: plan.densityPlan.readyForLongRun,
      externalIsEfficiencyReference: plan.densityPlan.externalIsEfficiencyReference,
      externalDryRunOnly: plan.densityPlan.externalDryRunOnly,
      miningStartAllowed: false,
      selectedLaneId: selectedLane.id,
      selectedLaneSource: selectedLane.source,
      selectedLaneStatus: selectedLane.status,
      selectedLaneHashrate: selectedLane.hashrate,
      selectedLaneWatts: selectedLane.watts,
      selectedLaneJoulesPerTerahash: selectedLane.joulesPerTerahash,
      primaryMissingGateId: plan.densityPlan.primaryMissingGate?.id ?? null,
      headroomStatus: plan.densityPlan.hashrateHeadroom.status,
      marginalDecisionStatus: plan.densityPlan.marginalDecision.status,
      marginalDensityRetentionRatio: plan.densityPlan.marginalDecision.densityRetentionRatio,
      marginalDecisionSummary: plan.densityPlan.marginalDecision.summary,
      marginalDecisionNextStep: plan.densityPlan.marginalDecision.nextStep,
      summary: plan.densityPlan.summary,
      nextStep: plan.densityPlan.nextStep,
    },
    hardwareCandidate: {
      status: externalHardwareCandidate.status,
      score: externalHardwareCandidate.score,
      hashrate: externalHardwareCandidate.hashrate,
      effectiveHashrate: externalHardwareCandidate.effectiveHashrate,
      watts: externalHardwareCandidate.watts,
      joulesPerTerahash: externalHardwareCandidate.joulesPerTerahash,
      workLeaseUtilizationRatio: externalHardwareCandidate.workLeaseUtilizationRatio,
      workLeaseUniquePartitionRatio: externalHardwareCandidate.workLeaseUniquePartitionRatio,
      workLeaseRouteUtilizationRatio: externalHardwareCandidate.workLeaseRouteUtilizationRatio,
      hashWasteRisk: externalHardwareCandidate.hashWasteRisk,
      canReadTelemetry: externalHardwareCandidate.canReadTelemetry,
      canCompareEfficiency: externalHardwareCandidate.canCompareEfficiency,
      canControlJobs: externalHardwareCandidate.canControlJobs,
      canSubmitShares: externalHardwareCandidate.canSubmitShares,
      canRouteWork: externalHardwareCandidate.canRouteWork,
      miningStartAllowed: false,
      riskFlags: externalHardwareCandidate.riskFlags,
      summary: externalHardwareCandidate.summary,
      nextStep: externalHardwareCandidate.nextStep,
    },
    evidenceRoadmap: diagnosticEvidenceRoadmapSnapshot,

    samplingPlan: {
      primaryTaskId: primarySamplingTask.id,
      primaryTaskStatus: primarySamplingTask.status,
      requiredSeconds: primarySamplingTask.requiredSeconds,
      remainingSeconds: primarySamplingTask.remainingSeconds,
      requiredShareEvents: primarySamplingTask.requiredShareEvents,
      remainingShareEvents: primarySamplingTask.remainingShareEvents,
      requiresMeasuredPower: primarySamplingTask.requiresMeasuredPower,
      requiresCoolOrWarmThermals: primarySamplingTask.requiresCoolOrWarmThermals,
      targetProfile: primarySamplingTask.targetProfile ?? null,
      summary: plan.samplingPlan.summary,
      nextStep: plan.samplingPlan.nextStep,
    },
    riskFlags: plan.riskFlags,
  };
}

export function formatMiningAlgorithmDiagnosticSnapshot(snapshot: MiningAlgorithmDiagnosticSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}

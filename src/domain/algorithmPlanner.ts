import type { TuningAnalysis, TuningObservationResult } from "./efficiencyTuning.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import type { ExternalHashCapability, ExternalHashCapabilityMatrix, ExternalHashSnapshot } from "./externalHashInterface.js";
import type { AlgorithmEvidenceRoadmap, AlgorithmEvidenceRoadmapResearchPromotionGateLike } from "./algorithmEvidenceRoadmap.js";
import { deriveAlgorithmEvidenceRoadmap } from "./algorithmEvidenceRoadmap.js";
import type { AlgorithmResearchIdeaId, AlgorithmResearchReview } from "./algorithmResearchReview.js";
import { deriveAlgorithmResearchReview } from "./algorithmResearchReview.js";
import type { AlgorithmSamplingPlan } from "./algorithmSamplingPlan.js";
import { deriveAlgorithmSamplingPlan } from "./algorithmSamplingPlan.js";
import type { HashDensityPlan } from "./hashDensityPlanner.js";
import { deriveHashDensityPlan } from "./hashDensityPlanner.js";
import type { HashHardwareCandidateAssessment } from "./hashHardwareAdvisor.js";
import type { HashHardwareOperatingEvidenceSnapshot } from "./hashHardwareOperatingEvidence.js";
import { assessHashHardwareCandidate } from "./hashHardwareAdvisor.js";
import type { HashRouteDecision, HashRouteExternalMode, HashRouteManualAction } from "./hashRouteAdvisor.js";
import { OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS } from "./optimizationThresholds.js";
import {
  planHashRouteManualActions,
  recommendHashRouteStrategies,
  summarizeHashRouteDecision,
} from "./hashRouteAdvisor.js";
import type { ExternalHashWorkAdapterPlan } from "../engines/externalHashWorkAdapter.js";

export type MiningAlgorithmPlanStrategy =
  | "collect_baseline"
  | "local_midstate_tuning"
  | "external_telemetry_sampling"
  | "external_work_dry_run"
  | "direct_protocol_reserved"
  | "route_monitoring";

export type MiningAlgorithmActionStatus = "ready" | "waiting" | "blocked" | "reserved" | "done";
export type MiningAlgorithmOperatingPointRole = "lowest_power" | "max_efficiency" | "balanced" | "max_hashrate" | "external_reference";
export type MiningAlgorithmOperatingPointSource = "local" | "external" | "waiting";
export type MiningAlgorithmOperatingPointStatus = "ready" | "waiting" | "blocked" | "dry-run";
export type MiningAlgorithmPolicyLaneId =
  | "consensus_sha256"
  | "midstate_reuse"
  | "local_power_tuning"
  | "network_telemetry"
  | "direct_transport"
  | "search_space_partitioning"
  | "external_work_dry_run"
  | "offline_timing_research"
  | "predictive_pruning"
  | "hash_search_compression";
export type MiningAlgorithmPolicyLaneStatus =
  | "active"
  | "ready"
  | "waiting"
  | "reserved"
  | "blocked"
  | "rejected"
  | "done";
export type MiningAlgorithmPolicyLaneImpact = "consensus" | "power" | "hashrate" | "safety";

export interface MiningAlgorithmOperatingPoint {
  role: MiningAlgorithmOperatingPointRole;
  source: MiningAlgorithmOperatingPointSource;
  status: MiningAlgorithmOperatingPointStatus;
  label: string;
  hashrate: number | null;
  watts: number | null;
  joulesPerTerahash: number | null;
  qualityScore: number | null;
  longRunScore: number | null;
  summary: string;
  nextStep: string;
}

export interface MiningAlgorithmOperatingEnvelope {
  points: MiningAlgorithmOperatingPoint[];
  lowestPower: MiningAlgorithmOperatingPoint;
  maxEfficiency: MiningAlgorithmOperatingPoint;
  balanced: MiningAlgorithmOperatingPoint;
  maxHashrate: MiningAlgorithmOperatingPoint;
  externalReference: MiningAlgorithmOperatingPoint;
  recommendedPoint: MiningAlgorithmOperatingPoint;
  recommendationReason: string;
  summary: string;
}

export interface MiningAlgorithmPolicyLane {
  id: MiningAlgorithmPolicyLaneId;
  status: MiningAlgorithmPolicyLaneStatus;
  impact: MiningAlgorithmPolicyLaneImpact;
  summary: string;
  nextStep: string;
}

export interface MiningAlgorithmResearchPolicy {
  lanes: MiningAlgorithmPolicyLane[];
  primaryLaneId: MiningAlgorithmPolicyLaneId;
  allowedLaneIds: MiningAlgorithmPolicyLaneId[];
  rejectedLaneIds: MiningAlgorithmPolicyLaneId[];
  runtimeIdeaIds: AlgorithmResearchIdeaId[];
  dryRunIdeaIds: AlgorithmResearchIdeaId[];
  telemetryIdeaIds: AlgorithmResearchIdeaId[];
  offlineIdeaIds: AlgorithmResearchIdeaId[];
  deploymentSummary: string;
  powerPriority: string;
  hashratePriority: string;
  summary: string;
}

export interface MiningAlgorithmResearchPromotionGate extends AlgorithmEvidenceRoadmapResearchPromotionGateLike {
  runtimeProfilePromotionAllowed: true;
  protectedRuntimeSourceIds: string[];
}

export type MiningAlgorithmStackLocalKernel = "midstate_reuse" | "midstate_waiting" | "midstate_blocked" | "midstate_regression";
export type MiningAlgorithmStackHighHashPath =
  | "local_runtime"
  | "external_telemetry_only"
  | "external_dry_run"
  | "direct_reserved"
  | "waiting";
export type MiningAlgorithmStackExternalWorkPolicy =
  | "disabled"
  | "telemetry_only"
  | "dry_run_only"
  | "direct_reserved"
  | "release_gated";

export interface MiningAlgorithmStackSnapshot {
  consensusHashing: "double_sha256";
  consensusScope: "fixed_header_pow";
  localKernel: {
    mode: MiningAlgorithmStackLocalKernel;
    status: MiningAlgorithmActionStatus;
    summary: string;
    nextStep: string;
  };
  defaultOperatingLane: {
    id: HashDensityPlan["selectedLane"]["id"];
    source: HashDensityPlan["selectedLane"]["source"];
    status: HashDensityPlan["selectedLane"]["status"];
    strategy: HashDensityPlan["strategy"];
    summary: string;
    nextStep: string;
  };
  powerObjective: MiningAlgorithmOperatingPointRole;
  highHashPath: MiningAlgorithmStackHighHashPath;
  externalWorkPolicy: MiningAlgorithmStackExternalWorkPolicy;
  frontierPolicy: MiningAlgorithmResearchPromotionGate["status"];
  rejectedShortcutIdeaIds: AlgorithmResearchIdeaId[];
  summary: string;
  nextStep: string;
}

export type MiningAlgorithmExperimentId =
  | "verify_consensus_midstate"
  | "capture_local_baseline"
  | "measure_local_power"
  | "prove_share_quality"
  | "extend_stability_window"
  | "probe_power_density_knee"
  | "sample_network_asic"
  | "choose_direct_protocol"
  | "review_search_space"
  | "validate_external_work_lease"
  | "record_offline_timing_probe"
  | "apply_operating_point";
export type MiningAlgorithmExperimentStatus = "ready" | "waiting" | "blocked" | "reserved" | "done";
export type MiningAlgorithmExperimentPriority = "critical" | "high" | "medium" | "low";
export type MiningAlgorithmExperimentRoute = "consensus" | "local" | "network" | "direct" | "external" | "offline";
export type MiningAlgorithmExperimentMetric = "safety" | "power" | "efficiency" | "hashrate" | "research";

export interface MiningAlgorithmExperiment {
  id: MiningAlgorithmExperimentId;
  status: MiningAlgorithmExperimentStatus;
  priority: MiningAlgorithmExperimentPriority;
  route: MiningAlgorithmExperimentRoute;
  metric: MiningAlgorithmExperimentMetric;
  summary: string;
  successCriteria: string;
  nextStep: string;
}

export interface MiningAlgorithmExperimentQueue {
  experiments: MiningAlgorithmExperiment[];
  primaryExperiment: MiningAlgorithmExperiment;
  readyCount: number;
  blockedCount: number;
  doneCount: number;
  summary: string;
}

export type MiningAlgorithmReadinessGateId =
  | "consensus_midstate"
  | "measured_power"
  | "share_quality"
  | "stability_window"
  | "thermal_safety"
  | "external_efficiency_history"
  | "search_space_lease"
  | "external_work_validation"
  | "direct_protocol";
export type MiningAlgorithmReadinessGateStatus = "passed" | "waiting" | "blocked" | "reserved";
export type MiningAlgorithmReadinessScope = "local" | "external" | "direct" | "consensus";

export interface MiningAlgorithmReadinessGate {
  id: MiningAlgorithmReadinessGateId;
  status: MiningAlgorithmReadinessGateStatus;
  scope: MiningAlgorithmReadinessScope;
  requiredForReady: boolean;
  summary: string;
  evidence: string;
  nextStep: string;
}

export interface MiningAlgorithmReadinessCertificate {
  gates: MiningAlgorithmReadinessGate[];
  requiredPassed: number;
  requiredTotal: number;
  readinessScore: number;
  readyForUnattendedLocal: boolean;
  readyForExternalDryRun: boolean;
  readyForExternalMining: boolean;
  primaryMissingGate: MiningAlgorithmReadinessGate | null;
  summary: string;
}

export interface MiningAlgorithmPlanAction {
  id: string;
  status: MiningAlgorithmActionStatus;
  summary: string;
  nextStep: string;
}

export type MiningAlgorithmMidstatePerformance = "faster" | "neutral" | "regression" | "unknown";

export interface MiningAlgorithmPlanInput {
  tuningAnalysis: TuningAnalysis;
  externalHistory: ExternalHashHistorySummary;
  externalSnapshot: ExternalHashSnapshot;
  externalCapabilityMatrix: ExternalHashCapabilityMatrix;
  externalWorkAdapterPlan: ExternalHashWorkAdapterPlan;
  externalOperatingEvidence?: HashHardwareOperatingEvidenceSnapshot | null;
  externalAlgorithmMode?: HashRouteExternalMode | null;
  midstateReuseReady?: boolean | null;
  midstatePerformance?: MiningAlgorithmMidstatePerformance | null;
  researchReviewedAt?: string | null;
}

export interface MiningAlgorithmPlan {
  strategy: MiningAlgorithmPlanStrategy;
  recommendedRoute: "local" | "external" | "monitor" | "waiting";
  confidence: "waiting" | "low" | "medium" | "high";
  dryRunOnly: boolean;
  canAssignExternalWork: boolean;
  consensusBoundary: string;
  localSummary: string;
  externalSummary: string;
  routeDecision: HashRouteDecision | null;
  routeAction: HashRouteManualAction | null;
  hardwareCandidate: HashHardwareCandidateAssessment;
  densityPlan: HashDensityPlan;
  operatingEnvelope: MiningAlgorithmOperatingEnvelope;
  algorithmStack: MiningAlgorithmStackSnapshot;
  researchPolicy: MiningAlgorithmResearchPolicy;
  researchReview: AlgorithmResearchReview;
  researchPromotionGate: MiningAlgorithmResearchPromotionGate;
  experimentQueue: MiningAlgorithmExperimentQueue;
  readinessCertificate: MiningAlgorithmReadinessCertificate;
  evidenceRoadmap: AlgorithmEvidenceRoadmap;
  samplingPlan: AlgorithmSamplingPlan;
  actions: MiningAlgorithmPlanAction[];
  riskFlags: string[];
  summary: string;
}

function measuredPowerProfiles(analysis: TuningAnalysis) {
  return analysis.results.filter((result) => result.powerEvidenceStatus === "measured");
}

function provenShareProfiles(analysis: TuningAnalysis) {
  return analysis.results.filter((result) => result.shareEvidenceStatus === "proven");
}

function bestLocalProfile(analysis: TuningAnalysis): TuningObservationResult | null {
  return analysis.powerDensityKnee ?? analysis.paretoRecommendation ?? analysis.bestEfficiency ?? analysis.lowestPower ?? analysis.bestHashrate ?? null;
}

function missingList(values: readonly ExternalHashCapability[]) {
  return values.length > 0 ? values.join(", ") : "none";
}

function finitePositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function externalAlgorithmMode(input: MiningAlgorithmPlanInput): HashRouteExternalMode {
  if (input.externalAlgorithmMode === "local_only") {
    return "local_only";
  }
  return input.externalAlgorithmMode === "reference_only" ? "reference_only" : "candidate";
}

function externalAlgorithmLocalOnly(input: MiningAlgorithmPlanInput) {
  return externalAlgorithmMode(input) === "local_only";
}

function externalAlgorithmReferenceOnly(input: MiningAlgorithmPlanInput) {
  return externalAlgorithmMode(input) === "reference_only";
}

function externalAlgorithmParked(input: MiningAlgorithmPlanInput) {
  return externalAlgorithmMode(input) !== "candidate";
}

function clampUtilizationRatio(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.max(0, Math.min(1, value))
    : null;
}

function externalOperatingEvidenceReady(input: MiningAlgorithmPlanInput) {
  if (externalAlgorithmLocalOnly(input)) {
    return false;
  }
  const evidence = input.externalOperatingEvidence;
  return evidence?.releaseReady === true && evidence.status === "passed";
}

function midstatePerformanceRegresses(input: MiningAlgorithmPlanInput) {
  return input.midstatePerformance === "regression";
}

function midstatePreferred(input: MiningAlgorithmPlanInput) {
  return input.midstateReuseReady === true && !midstatePerformanceRegresses(input);
}

function externalOperatingHashrate(input: MiningAlgorithmPlanInput) {
  const evidence = input.externalOperatingEvidence;
  if (!externalOperatingEvidenceReady(input)) {
    return null;
  }
  return finitePositiveNumber(evidence?.effectiveHashrate)
    ? Number(evidence?.effectiveHashrate)
    : null;
}

function externalOperatingWatts(input: MiningAlgorithmPlanInput) {
  const evidence = input.externalOperatingEvidence;
  return externalOperatingEvidenceReady(input) && finitePositiveNumber(evidence?.averageWallWatts)
    ? Number(evidence?.averageWallWatts)
    : null;
}

function externalOperatingJoulesPerTerahash(input: MiningAlgorithmPlanInput) {
  const evidence = input.externalOperatingEvidence;
  if (!externalOperatingEvidenceReady(input)) {
    return null;
  }
  if (finitePositiveNumber(evidence?.effectiveJoulesPerTerahash)) {
    return Number(evidence?.effectiveJoulesPerTerahash);
  }
  return finitePositiveNumber(evidence?.bestJoulesPerTerahash) ? Number(evidence?.bestJoulesPerTerahash) : null;
}

function bestExternalJoulesForPlanning(input: MiningAlgorithmPlanInput) {
  const operating = externalOperatingJoulesPerTerahash(input);
  const history = finitePositiveNumber(input.externalHistory.bestJoulesPerTerahash)
    ? Number(input.externalHistory.bestJoulesPerTerahash)
    : null;
  if (operating !== null && history !== null) {
    return Math.min(operating, history);
  }
  return operating ?? history;
}

function planningExternalHistory(input: MiningAlgorithmPlanInput): ExternalHashHistorySummary {
  if (externalAlgorithmLocalOnly(input)) {
    return sealedExternalHistory(input);
  }

  if (!externalOperatingEvidenceReady(input)) {
    return input.externalHistory;
  }

  const evidence = input.externalOperatingEvidence;
  const trendIsDegrading = input.externalHistory.trend === "degrading";
  const usableEvidenceSamples = Math.max(1, evidence?.usableSampleCount ?? 0);
  const averageHashrate = externalOperatingHashrate(input) ?? input.externalHistory.averageHashrate;
  const averageWatts = externalOperatingWatts(input) ?? input.externalHistory.averageWatts;
  const averageJoulesPerTerahash = externalOperatingJoulesPerTerahash(input) ?? input.externalHistory.averageJoulesPerTerahash;

  return {
    ...input.externalHistory,
    sampleCount: Math.max(input.externalHistory.sampleCount, evidence?.sampleCount ?? 0),
    onlineSampleCount: Math.max(input.externalHistory.onlineSampleCount, usableEvidenceSamples),
    efficiencySampleCount: Math.max(input.externalHistory.efficiencySampleCount, usableEvidenceSamples),
    usableEfficiencySampleCount: Math.max(input.externalHistory.usableEfficiencySampleCount, usableEvidenceSamples),
    evidenceReady: !trendIsDegrading,
    evidenceStatus: trendIsDegrading ? input.externalHistory.evidenceStatus : "stable",
    evidenceGap: trendIsDegrading ? input.externalHistory.evidenceGap : 0,
    averageHashrate,
    averageWatts,
    averageJoulesPerTerahash,
    bestJoulesPerTerahash: bestExternalJoulesForPlanning(input),
    trend: trendIsDegrading ? input.externalHistory.trend : "stable",
    summary: `${input.externalHistory.summary} Operating proof: ${evidence?.summary ?? "passed"}`,
  };
}

function sealedExternalHistory(input: MiningAlgorithmPlanInput): ExternalHashHistorySummary {
  const evidenceSampleTarget = Math.max(1, Math.trunc(Number(input.externalHistory.evidenceSampleTarget) || 3));
  return {
    ...input.externalHistory,
    sampleCount: 0,
    onlineSampleCount: 0,
    efficiencySampleCount: 0,
    usableEfficiencySampleCount: 0,
    evidenceStatus: "waiting",
    evidenceReady: false,
    evidenceSampleTarget,
    evidenceGap: evidenceSampleTarget,
    latestSample: null,
    bestEfficiencySample: null,
    averageHashrate: 0,
    averageWatts: null,
    averageJoulesPerTerahash: null,
    bestJoulesPerTerahash: null,
    trend: "waiting",
    trendPercent: null,
    summary: "External hash is sealed off from local algorithm planning.",
  };
}

function localOnlyExternalSnapshot(input: MiningAlgorithmPlanInput): ExternalHashSnapshot {
  const snapshot = input.externalSnapshot;
  return {
    ...snapshot,
    adapter: {
      ...snapshot.adapter,
      adapterId: "none",
      interfaceKind: "none",
      endpoint: "",
      endpointKind: "none",
      status: "disabled",
      integrationStage: "disabled",
      capabilities: [],
      engineEligible: false,
      nextIntegrationStep: "External hash is sealed off from local algorithm planning.",
    },
    polling: {
      ...snapshot.polling,
      enabled: false,
      canPoll: false,
      status: "disabled",
      summary: "External hash polling is sealed off from local algorithm planning.",
    },
    transport: {
      ...snapshot.transport,
      interfaceKind: "none",
      transportKind: "none",
      endpointKind: "none",
      endpoint: "",
      status: "disabled",
      canProbeTelemetry: false,
      canControlJobs: false,
      canSubmitShares: false,
      miningStartAllowed: false,
      requiredProof: [],
      summary: "External hash transport is sealed off from local algorithm planning.",
      nextStep: "Continue local CPU/GPU algorithm optimization only.",
    },
    interfaceKind: "none",
    label: "External Hash Sealed",
    endpoint: "",
    integrationStage: "disabled",
    capabilities: [],
    parallelWorkers: 0,
    canReadTelemetry: false,
    canControlMining: false,
    canSubmitShares: false,
    canRollVersion: false,
    telemetryOnline: false,
    hashrate: 0,
    watts: null,
    joulesPerTerahash: null,
    status: "disabled",
    summary: "External hash is sealed off from local algorithm planning.",
    capabilitySummary: "External capabilities are disabled for this local-only pass.",
  };
}

function localOnlyExternalCapabilityMatrix(input: MiningAlgorithmPlanInput): ExternalHashCapabilityMatrix {
  const matrix = input.externalCapabilityMatrix;
  return {
    ...matrix,
    interfaceKind: "none",
    integrationStage: "disabled",
    engineEligible: false,
    canReadTelemetry: false,
    canCompareEfficiency: false,
    canControlMining: false,
    canSubmitShares: false,
    canRollVersion: false,
    canPartitionWork: false,
    rows: matrix.rows.map((row) => ({
      ...row,
      status: "disabled",
      available: false,
      engineBlocking: false,
      efficiencyBlocking: false,
      summary: "External hash is sealed off from local algorithm planning.",
    })),
    missingEngineCapabilities: [],
    missingEfficiencyCapabilities: [],
    missingPerformanceCapabilities: [],
    searchSpaceReady: false,
    workLeaseReady: false,
    workLeaseUtilizationRatio: null,
    workLeaseUniquePartitionRatio: null,
    workLeaseRouteUtilizationRatio: null,
    workLeaseWasteRisk: "unknown",
    summary: "External hash capabilities are sealed off from local algorithm planning.",
  };
}

function localOnlyExternalWorkAdapterPlan(input: MiningAlgorithmPlanInput): ExternalHashWorkAdapterPlan {
  const plan = input.externalWorkAdapterPlan;
  return {
    ...plan,
    status: "disabled",
    canAssignWork: false,
    interfaceKind: "none",
    endpoint: "",
    missingCapabilities: [],
    missingPerformanceCapabilities: [],
    searchSpaceReady: false,
    workLeaseReady: false,
    workLeaseUtilizationRatio: null,
    workLeaseUniquePartitionRatio: null,
    workLeaseRouteUtilizationRatio: null,
    workLeaseWasteRisk: "unknown",
    summary: "External work adapter is sealed off from local algorithm planning.",
    nextStep: "Continue local CPU/GPU tuning; re-enable the external hardware workflow separately when hardware exists.",
  };
}

function localOnlyAlgorithmInput(input: MiningAlgorithmPlanInput): MiningAlgorithmPlanInput {
  if (!externalAlgorithmLocalOnly(input)) {
    return input;
  }
  return {
    ...input,
    externalHistory: sealedExternalHistory(input),
    externalSnapshot: localOnlyExternalSnapshot(input),
    externalCapabilityMatrix: localOnlyExternalCapabilityMatrix(input),
    externalWorkAdapterPlan: localOnlyExternalWorkAdapterPlan(input),
    externalOperatingEvidence: null,
    externalAlgorithmMode: "local_only",
  };
}
function externalRouteLeaseUtilizationRatio(input: MiningAlgorithmPlanInput) {
  const history = planningExternalHistory(input);
  const rawHashrate = finitePositiveNumber(history.averageHashrate)
    ? Number(history.averageHashrate)
    : null;
  const snapshotHashrate = finitePositiveNumber(input.externalSnapshot.hashrate)
    ? Number(input.externalSnapshot.hashrate)
    : null;
  const leaseUtilizationRatio = clampUtilizationRatio(input.externalCapabilityMatrix.workLeaseUtilizationRatio);
  if (rawHashrate === null || snapshotHashrate === null || leaseUtilizationRatio === null) {
    return null;
  }
  return leaseUtilizationRatio;
}

function externalRouteEffectiveHashrate(input: MiningAlgorithmPlanInput) {
  const operatingHashrate = externalOperatingHashrate(input);
  if (operatingHashrate !== null) {
    return operatingHashrate;
  }

  const history = planningExternalHistory(input);
  const rawHashrate = finitePositiveNumber(history.averageHashrate)
    ? Number(history.averageHashrate)
    : null;
  const leaseUtilizationRatio = externalRouteLeaseUtilizationRatio(input);
  if (rawHashrate === null || leaseUtilizationRatio === null) {
    return null;
  }
  return rawHashrate * leaseUtilizationRatio;
}

function routeReadiness(input: MiningAlgorithmPlanInput) {
  const workLeaseWasteAcceptable = input.externalCapabilityMatrix.workLeaseWasteRisk !== "high";
  return {
    externalMode: externalAlgorithmMode(input),
    searchSpaceReady: input.externalCapabilityMatrix.searchSpaceReady && input.externalCapabilityMatrix.workLeaseReady && workLeaseWasteAcceptable,
    searchSpaceSummary: `${input.externalCapabilityMatrix.searchSpace.summary} ${input.externalCapabilityMatrix.workLease.summary}`,
    workLeaseUtilizationRatio: externalRouteLeaseUtilizationRatio(input),
    hashWasteRisk: input.externalCapabilityMatrix.workLeaseWasteRisk,
    effectiveHashrate: externalRouteEffectiveHashrate(input),
    workAdapterReady: input.externalWorkAdapterPlan.canAssignWork,
    workAdapterStatus: input.externalWorkAdapterPlan.status,
    workAdapterSummary: `${input.externalWorkAdapterPlan.summary} ${input.externalWorkAdapterPlan.nextStep}`,
  };
}

function deriveRouteDecision(input: MiningAlgorithmPlanInput) {
  const recommendations = recommendHashRouteStrategies(
    input.tuningAnalysis,
    planningExternalHistory(input),
    routeReadiness(input),
  );
  const actions = planHashRouteManualActions(recommendations);
  return summarizeHashRouteDecision(recommendations, actions);
}

function planRecommendedRoute(decision: HashRouteDecision | null): MiningAlgorithmPlan["recommendedRoute"] {
  if (!decision) {
    return "waiting";
  }
  switch (decision.status) {
    case "waiting":
      return "waiting";
    case "apply_local":
      return decision.target === "local" ? "local" : "monitor";
    case "verify_external":
      return decision.target === "external" ? "external" : "monitor";
    case "monitor":
    case "risk":
      return "monitor";
  }
}
function deriveStrategy(
  input: MiningAlgorithmPlanInput,
  decision: HashRouteDecision | null,
): MiningAlgorithmPlanStrategy {
  if (input.tuningAnalysis.results.length === 0 && planningExternalHistory(input).efficiencySampleCount === 0) {
    return "collect_baseline";
  }

  if (input.externalSnapshot.interfaceKind === "direct") {
    return "direct_protocol_reserved";
  }

  if (externalAlgorithmReferenceOnly(input)) {
    if (input.tuningAnalysis.results.length === 0) {
      return "collect_baseline";
    }
    if (decision?.status === "apply_local") {
      return "local_midstate_tuning";
    }
    return "route_monitoring";
  }

  if (input.externalWorkAdapterPlan.canAssignWork && planRecommendedRoute(decision) === "external") {
    return "external_work_dry_run";
  }

  if (input.externalSnapshot.interfaceKind === "network" && !input.externalWorkAdapterPlan.canAssignWork) {
    return "external_telemetry_sampling";
  }

  if (decision?.status === "apply_local") {
    return "local_midstate_tuning";
  }

  return "route_monitoring";
}

function hasRequiredUnattendedRuntime(result: TuningObservationResult) {
  return typeof result.sampleSeconds === "number" &&
    Number.isFinite(result.sampleSeconds) &&
    result.sampleSeconds >= OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS;
}

function hasSafeUnattendedThermals(result: TuningObservationResult) {
  return result.thermalStatus !== "hot" &&
    result.thermalStatus !== "critical" &&
    result.thermalStatus !== "paused";
}

function isUnattendedLocalProfileReady(result: TuningObservationResult) {
  return (result.longRunRisk === "excellent" || result.longRunRisk === "good") &&
    result.stabilityWindowStatus === "stable" &&
    result.shareEvidenceStatus === "proven" &&
    result.powerEvidenceStatus === "measured" &&
    hasRequiredUnattendedRuntime(result) &&
    hasSafeUnattendedThermals(result);
}

function unattendedRuntimeSummary() {
  return `${Math.round(OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS / 60)} minute`;
}

function localPointReadinessGaps(result: TuningObservationResult) {
  const gaps: string[] = [];
  if (result.powerEvidenceStatus !== "measured") {
    gaps.push(result.powerEvidenceSummary);
  }
  if (result.shareEvidenceStatus !== "proven") {
    gaps.push(result.shareEvidenceSummary);
  }
  if (!hasRequiredUnattendedRuntime(result)) {
    gaps.push(`Needs a stable ${unattendedRuntimeSummary()} runtime sample.`);
  }
  if (result.stabilityWindowStatus !== "stable") {
    gaps.push(result.stabilityWindowSummary);
  }
  if (!hasSafeUnattendedThermals(result)) {
    gaps.push(result.thermalSummary);
  }
  if (result.longRunRisk !== "excellent" && result.longRunRisk !== "good") {
    gaps.push(result.longRunSummary);
  }
  return gaps.length > 0 ? gaps.join(" ") : result.longRunSummary;
}
function pointLabel(role: MiningAlgorithmOperatingPointRole) {
  switch (role) {
    case "lowest_power":
      return "Lowest Power";
    case "max_efficiency":
      return "Max Efficiency";
    case "balanced":
      return "Balanced";
    case "max_hashrate":
      return "Max Hashrate";
    case "external_reference":
      return "External Reference";
  }
}

function localPoint(role: MiningAlgorithmOperatingPointRole, result: TuningObservationResult | null): MiningAlgorithmOperatingPoint {
  if (!result) {
    return {
      role,
      source: "waiting",
      status: "waiting",
      label: pointLabel(role),
      hashrate: null,
      watts: null,
      joulesPerTerahash: null,
      qualityScore: null,
      longRunScore: null,
      summary: `${pointLabel(role)} is waiting for a local tuning sample.`,
      nextStep: "Capture a local profile with hashrate, share evidence, and power evidence.",
    };
  }

  const evidenceReady = isUnattendedLocalProfileReady(result);
  return {
    role,
    source: "local",
    status: evidenceReady ? "ready" : "waiting",
    label: result.step.summary,
    hashrate: result.qualityAdjustedHashrate,
    watts: result.watts,
    joulesPerTerahash: result.qualityAdjustedJoulesPerTerahash,
    qualityScore: result.qualityScore,
    longRunScore: result.longRunScore,
    summary: `${pointLabel(role)} uses ${result.step.summary}: ${Math.round(result.qualityAdjustedHashrate).toLocaleString("en-US")} quality H/s, score ${result.longRunScore}/100 (${result.longRunRisk}).`,
    nextStep: evidenceReady
      ? "Eligible for manual apply or route comparison."
      : localPointReadinessGaps(result),
  };
}

function externalHistoryEvidenceReady(input: MiningAlgorithmPlanInput) {
  const history = planningExternalHistory(input);
  return history.evidenceReady === true && history.trend !== "degrading";
}

function externalHistoryGap(input: MiningAlgorithmPlanInput) {
  const gap = Number(planningExternalHistory(input).evidenceGap);
  if (Number.isFinite(gap) && gap > 0) {
    return Math.trunc(gap);
  }
  return 0;
}

function externalPoint(input: MiningAlgorithmPlanInput): MiningAlgorithmOperatingPoint {
  const history = planningExternalHistory(input);
  if (history.efficiencySampleCount <= 0) {
    return {
      role: "external_reference",
      source: "waiting",
      status: "waiting",
      label: "External Reference",
      hashrate: null,
      watts: null,
      joulesPerTerahash: null,
      qualityScore: null,
      longRunScore: null,
      summary: "External reference is waiting for telemetry samples.",
      nextStep: "Sample external hashrate, watts, and J/TH before comparing routes.",
    };
  }

  const canUseDryRun = input.externalWorkAdapterPlan.canAssignWork;
  const canCompare = input.externalCapabilityMatrix.canCompareEfficiency;
  const evidenceReady = externalHistoryEvidenceReady(input);
  return {
    role: "external_reference",
    source: "external",
    status: canUseDryRun ? "dry-run" : evidenceReady && canCompare ? "blocked" : "waiting",
    label: input.externalSnapshot.label || "External Reference",
    hashrate: externalRouteEffectiveHashrate(input),
    watts: history.averageWatts ?? null,
    joulesPerTerahash: history.averageJoulesPerTerahash ?? history.bestJoulesPerTerahash ?? null,
    qualityScore: null,
    longRunScore: null,
    summary: canUseDryRun
      ? `External reference can receive dry-run work: ${input.externalWorkAdapterPlan.summary}`
      : `External reference is telemetry-only or blocked: ${input.externalWorkAdapterPlan.summary}`,
    nextStep: evidenceReady
      ? input.externalWorkAdapterPlan.nextStep
      : externalHistoryGap(input) > 0
        ? `Collect ${externalHistoryGap(input)} more usable external efficiency sample${externalHistoryGap(input) === 1 ? "" : "s"} before comparing routes.`
        : "Keep sampling until usable external efficiency is thermally safe and non-degrading.",
  };
}

function localPointForGoal(
  goal: HashRouteDecision["primaryGoal"] | null | undefined,
  points: {
    lowestPower: MiningAlgorithmOperatingPoint;
    maxEfficiency: MiningAlgorithmOperatingPoint;
    balanced: MiningAlgorithmOperatingPoint;
    maxHashrate: MiningAlgorithmOperatingPoint;
  },
) {
  switch (goal) {
    case "lowest_power":
      return points.lowestPower;
    case "max_efficiency":
      return points.maxEfficiency;
    case "max_hashrate":
      return points.maxHashrate;
    case "balanced":
    default:
      return points.balanced;
  }
}

function fallbackOperatingPoint(
  points: MiningAlgorithmOperatingPoint[],
  options: { allowDryRun?: boolean } = {},
) {
  return points.find((point) => point.role === "balanced" && point.status === "ready") ??
    points.find((point) => point.role === "max_efficiency" && point.status === "ready") ??
    points.find((point) => point.role === "lowest_power" && point.status === "ready") ??
    points.find((point) => point.role === "max_hashrate" && point.status === "ready") ??
    (options.allowDryRun === false ? undefined : points.find((point) => point.status === "dry-run")) ??
    points[0];
}

function deriveRecommendedOperatingPoint(
  decision: HashRouteDecision | null,
  points: MiningAlgorithmOperatingPoint[],
  localPoints: {
    lowestPower: MiningAlgorithmOperatingPoint;
    maxEfficiency: MiningAlgorithmOperatingPoint;
    balanced: MiningAlgorithmOperatingPoint;
    maxHashrate: MiningAlgorithmOperatingPoint;
  },
  externalReference: MiningAlgorithmOperatingPoint,
) {
  if (externalReference.status === "dry-run" && planRecommendedRoute(decision) === "external") {
    return {
      point: externalReference,
      reason: decision?.target === "external"
        ? "Hash Route Decision points to external hash, and the adapter is dry-run assignable only."
        : "External hash adapter is dry-run assignable; validate mock work before comparing it with local operating points.",
    };
  }

  if (decision?.target === "local") {
    const point = localPointForGoal(decision.primaryGoal, localPoints);
    return {
      point,
      reason: `Hash Route Decision maps ${decision.primaryGoal} to the local ${point.role.replace(/_/g, " ")} point.`,
    };
  }

  const fallback = fallbackOperatingPoint(points, { allowDryRun: planRecommendedRoute(decision) === "external" });
  return {
    point: fallback,
    reason: decision
      ? `Route is ${decision.status}; keep the safest ready operating point while more evidence accumulates.`
      : "Route evidence is not ready; keep the first safe operating point available.",
  };
}

function deriveOperatingEnvelope(input: MiningAlgorithmPlanInput, decision: HashRouteDecision | null): MiningAlgorithmOperatingEnvelope {
  const lowestPower = localPoint("lowest_power", input.tuningAnalysis.lowestPower);
  const maxEfficiency = localPoint("max_efficiency", input.tuningAnalysis.bestEfficiency);
  const balanced = localPoint("balanced", input.tuningAnalysis.powerDensityKnee ?? input.tuningAnalysis.paretoRecommendation);
  const maxHashrate = localPoint("max_hashrate", input.tuningAnalysis.bestHashrate);
  const externalReference = externalPoint(input);
  const points = [lowestPower, maxEfficiency, balanced, maxHashrate, externalReference];
  const readyLocalCount = points.filter((point) => point.source === "local" && point.status === "ready").length;
  const externalStatus = externalReference.status === "dry-run"
    ? "external dry-run ready"
    : externalReference.source === "external"
      ? "external telemetry gated"
      : "external waiting";
  const recommended = deriveRecommendedOperatingPoint(
    decision,
    points,
    { lowestPower, maxEfficiency, balanced, maxHashrate },
    externalReference,
  );

  return {
    points,
    lowestPower,
    maxEfficiency,
    balanced,
    maxHashrate,
    externalReference,
    recommendedPoint: recommended.point,
    recommendationReason: recommended.reason,
    summary: `Operating envelope: ${readyLocalCount}/4 local points ready; ${externalStatus}; primary ${recommended.point.role.replace(/_/g, " ")}.`,
  };
}

function policyLane(
  id: MiningAlgorithmPolicyLaneId,
  status: MiningAlgorithmPolicyLaneStatus,
  impact: MiningAlgorithmPolicyLaneImpact,
  summary: string,
  nextStep: string,
): MiningAlgorithmPolicyLane {
  return { id, status, impact, summary, nextStep };
}

function primaryPolicyLane(input: MiningAlgorithmPlanInput, strategy: MiningAlgorithmPlanStrategy): MiningAlgorithmPolicyLaneId {
  if (!externalAlgorithmParked(input) && input.externalWorkAdapterPlan.canAssignWork) {
    return "external_work_dry_run";
  }
  if (!externalAlgorithmParked(input) && input.externalSnapshot.interfaceKind === "network") {
    return "network_telemetry";
  }
  if (input.externalSnapshot.interfaceKind === "direct") {
    return "direct_transport";
  }
  if (strategy === "collect_baseline") {
    return "local_power_tuning";
  }
  return midstatePreferred(input) ? "midstate_reuse" : "consensus_sha256";
}

function deriveResearchPolicy(
  input: MiningAlgorithmPlanInput,
  strategy: MiningAlgorithmPlanStrategy,
  researchReview: AlgorithmResearchReview,
): MiningAlgorithmResearchPolicy {
  const midstateReady = midstatePreferred(input);
  const hasLocalSamples = input.tuningAnalysis.results.length > 0;
  const hasMeasuredPower = input.tuningAnalysis.results.some((result) => result.powerEvidenceStatus === "measured");
  const canReadNetworkTelemetry = input.externalSnapshot.interfaceKind === "network" &&
    input.externalCapabilityMatrix.canReadTelemetry;
  const directSelected = input.externalSnapshot.interfaceKind === "direct";
  const externalReferenceOnly = externalAlgorithmReferenceOnly(input);
  const searchSpaceReady = !externalReferenceOnly && input.externalCapabilityMatrix.searchSpaceReady &&
    input.externalCapabilityMatrix.workLeaseReady;
  const canAssignExternalWork = !externalReferenceOnly && input.externalWorkAdapterPlan.canAssignWork;
  const lanes = [
    policyLane(
      "consensus_sha256",
      "active",
      "consensus",
      "Bitcoin consensus work stays double SHA-256 over the 80-byte block header.",
      "Keep all optimizations outside proof-of-work semantics.",
    ),
    policyLane(
      "midstate_reuse",
      midstateReady ? "done" : input.midstateReuseReady === true && midstatePerformanceRegresses(input) ? "blocked" : input.midstateReuseReady === false ? "blocked" : "ready",
      "hashrate",
      "Reuse the SHA-256 midstate for the fixed first header chunk.",
      midstateReady
        ? "Keep CPU/GPU hashing on the HeaderWork path and verify against full-header hashing."
        : input.midstateReuseReady === true && midstatePerformanceRegresses(input)
          ? "Keep full-header as the default until the midstate benchmark no longer regresses."
          : input.midstateReuseReady === false
            ? "Restore midstate verification before chasing higher hash density."
            : "Run the fixed-window benchmark before promoting midstate reuse.",
    ),
    policyLane(
      "local_power_tuning",
      hasLocalSamples ? hasMeasuredPower ? "ready" : "waiting" : "waiting",
      "power",
      "Tune CPU/GPU profiles by measured or explicitly estimated watts, share waste, and thermal stability.",
      hasMeasuredPower
        ? "Use measured samples for lowest-power, max-efficiency, balanced, and max-hashrate operating points."
        : "Collect measured wall-power or device telemetry before treating local J/TH as final.",
    ),
    policyLane(
      "network_telemetry",
      input.externalSnapshot.interfaceKind === "network"
        ? canReadNetworkTelemetry ? "ready" : "waiting"
        : "waiting",
      "power",
      "Use network ASIC telemetry as an efficiency reference only.",
      input.externalSnapshot.interfaceKind === "network"
        ? planningExternalHistory(input).summary
        : "Select Network and add a host before sampling external efficiency.",
    ),
    policyLane(
      "direct_transport",
      directSelected ? "reserved" : "waiting",
      "safety",
      "Reserve serial, USB, HID, or device-path Direct endpoints until hardware protocol is known.",
      directSelected
        ? "Choose the physical endpoint and protocol with real hardware before enabling telemetry or work routing."
        : "Do not assume a Direct endpoint shape until the device exists.",
    ),
    policyLane(
      "search_space_partitioning",
      input.externalSnapshot.interfaceKind === "none"
        ? "waiting"
        : externalReferenceOnly ? "reserved"
          : searchSpaceReady ? "ready" : "blocked",
      "hashrate",
      "External high-hash routes need unique nonce, version, nTime, or extranonce work space.",
      externalReferenceOnly
        ? "External search-space planning is parked as reference-only; keep current algorithm work on local CPU/GPU evidence."
        : searchSpaceReady
          ? "Keep BIP320/BIP323/SV2-style version rolling and work leases as hard gates before real external mining."
          : `${input.externalCapabilityMatrix.searchSpace.summary} ${input.externalCapabilityMatrix.workLease.summary}`,
    ),
    policyLane(
      "external_work_dry_run",
      externalReferenceOnly ? "reserved" : canAssignExternalWork ? "ready" : input.externalWorkAdapterPlan.status === "reserved" ? "reserved" : "blocked",
      "safety",
      "External work assignment is mock/dry-run only until job lifecycle and share submission are proven.",
      externalReferenceOnly
        ? "Keep external work assignment code as future dry-run infrastructure; do not use it for the current algorithm route."
        : input.externalWorkAdapterPlan.nextStep,
    ),
    policyLane(
      "offline_timing_research",
      researchReview.offlineIdeaIds.includes("thermodynamic_asic_prediction") ? "reserved" : "waiting",
      "safety",
      "Keep thermodynamic, timing-noise, and TPF claims in offline telemetry research only.",
      "Record timing features only outside pool-submitted work; require independent accepted-share validation before any runtime or dry-run claim.",
    ),
    policyLane(
      "predictive_pruning",
      "rejected",
      "consensus",
      "Do not predict winning nonces or narrow the search range; that would only reduce lottery coverage.",
      "Treat every nonce/search-space slice as uniformly random unless a consensus-valid share proves otherwise.",
    ),
    policyLane(
      "hash_search_compression",
      "rejected",
      "consensus",
      "Do not claim data compression can reduce the amount of valid SHA-256 work.",
      "Compress logs, telemetry, or job transport if useful, but not the proof-of-work search itself.",
    ),
  ];
  const primaryLaneId = primaryPolicyLane(input, strategy);
  const allowedLaneIds = lanes
    .filter((candidate) => candidate.status !== "rejected" && candidate.status !== "blocked")
    .map((candidate) => candidate.id);
  const rejectedLaneIds = lanes
    .filter((candidate) => candidate.status === "rejected")
    .map((candidate) => candidate.id);
  const deploymentSummary = [
    `runtime ${researchReview.runtimeIdeaIds.length}`,
    `dry-run ${researchReview.dryRunIdeaIds.length}`,
    `telemetry ${researchReview.telemetryIdeaIds.length}`,
    `offline ${researchReview.offlineIdeaIds.length}`,
  ].join(", ");
  const powerPriority = externalReferenceOnly
    ? "Use external ASIC telemetry as reference-only; current power routing stays on measured local watts."
    : researchReview.telemetryIdeaIds.includes("external_asic_autotune")
    ? hasMeasuredPower
      ? "Use external ASIC telemetry as a reference, but route power changes through measured local watts and stable external history."
      : "Treat external ASIC telemetry as reference-only until local wall-power evidence exists."
    : canReadNetworkTelemetry
      ? "Compare external J/TH and watts against measured local tuning before changing route."
      : "Collect measured local watts first; keep unknown power explicit.";
  const hasExternalDryRunIdeas = researchReview.dryRunIdeaIds.includes("version_rolling_asicboost") ||
    researchReview.dryRunIdeaIds.includes("stratum_v2_extended_jobs");
  const hasOfflineExternalHashIdeas = researchReview.offlineIdeaIds.includes("version_rolling_asicboost") ||
    researchReview.offlineIdeaIds.includes("stratum_v2_extended_jobs");
  const hasOfflineTimingIdeas = researchReview.offlineIdeaIds.includes("thermodynamic_asic_prediction");
  const hashratePriority = externalReferenceOnly
    ? "Current algorithm pass is local-only; keep external high-hash work parked as telemetry/reference infrastructure."
    : hasExternalDryRunIdeas
    ? "Keep external high-hash ideas in dry-run validation; real external mining remains release-gated."
    : hasOfflineExternalHashIdeas
      ? "Do not chase external high-hash routing yet; prove version rolling, partitioned leases, and share submission first."
      : hasOfflineTimingIdeas
        ? "Keep timing-prediction and TPF claims offline; production hashrate comes from midstate reuse, local tuning, and proven work partitioning only."
        : searchSpaceReady
          ? "Use version rolling and partitioned work leases before trusting external high-hash routing."
          : "Increase hashrate through midstate reuse, local tuning, and external telemetry while work assignment remains gated.";

  return {
    lanes,
    primaryLaneId,
    allowedLaneIds,
    rejectedLaneIds,
    runtimeIdeaIds: researchReview.runtimeIdeaIds,
    dryRunIdeaIds: researchReview.dryRunIdeaIds,
    telemetryIdeaIds: researchReview.telemetryIdeaIds,
    offlineIdeaIds: researchReview.offlineIdeaIds,
    deploymentSummary,
    powerPriority,
    hashratePriority,
    summary: `Research policy: primary ${primaryLaneId.replace(/_/g, " ")}; ${deploymentSummary}; rejected ${rejectedLaneIds.map((id) => id.replace(/_/g, " ")).join(", ")}.`,
  };
}

function algorithmExperiment(args: MiningAlgorithmExperiment): MiningAlgorithmExperiment {
  return args;
}

function experimentPriorityRank(priority: MiningAlgorithmExperimentPriority) {
  switch (priority) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
  }
}

function experimentStatusRank(status: MiningAlgorithmExperimentStatus) {
  switch (status) {
    case "ready":
      return 0;
    case "blocked":
    case "reserved":
      return 1;
    case "waiting":
      return 2;
    case "done":
      return 3;
  }
}

function hasLongRunReadyLocalProfile(input: MiningAlgorithmPlanInput) {
  return input.tuningAnalysis.results.some(isUnattendedLocalProfileReady);
}

function powerDensityBoundaryStep(input: MiningAlgorithmPlanInput) {
  return input.tuningAnalysis.marginalFrontier.find((step) => !step.acceptedByDensityKnee) ?? null;
}

function powerDensityProbeStatus(input: MiningAlgorithmPlanInput): MiningAlgorithmExperimentStatus {
  if (!input.tuningAnalysis.powerDensityKnee) {
    return "waiting";
  }
  return powerDensityBoundaryStep(input) ? "done" : "ready";
}

function powerDensityProbeSummary(input: MiningAlgorithmPlanInput) {
  const blocked = powerDensityBoundaryStep(input);
  if (blocked) {
    return `Power-density frontier is bounded before ${blocked.to.step.summary}.`;
  }
  if (input.tuningAnalysis.powerDensityKnee) {
    return `Power-density frontier knee ${input.tuningAnalysis.powerDensityKnee.step.summary} needs the next marginal watt probe.`;
  }
  return "Power-density frontier knee is waiting for measured local samples.";
}

function powerDensityProbeNextStep(input: MiningAlgorithmPlanInput) {
  const blocked = powerDensityBoundaryStep(input);
  if (blocked) {
    return `${input.tuningAnalysis.powerDensityKneeSummary} Keep ${input.tuningAnalysis.powerDensityKnee?.step.summary ?? "the current knee"} unless power, thermals, or share quality change.`;
  }
  if (input.tuningAnalysis.powerDensityKnee) {
    return `${input.tuningAnalysis.powerDensityKneeSummary} Measure the next higher local tuning profile with watts, thermals, and share counters to find the boundary.`;
  }
  return "Capture at least two measured local Pareto frontier samples before probing the power-density knee.";
}

function deriveExperimentQueue(
  input: MiningAlgorithmPlanInput,
  operatingEnvelope: MiningAlgorithmOperatingEnvelope,
): MiningAlgorithmExperimentQueue {
  const localSampleCount = input.tuningAnalysis.results.length;
  const measuredPowerCount = measuredPowerProfiles(input.tuningAnalysis).length;
  const provenShareCount = provenShareProfiles(input.tuningAnalysis).length;
  const longRunReady = hasLongRunReadyLocalProfile(input);
  const networkEndpointReady = input.externalSnapshot.interfaceKind === "network" && Boolean(input.externalSnapshot.endpoint);
  const networkSamplesReady = externalHistoryEvidenceReady(input);
  const directSelected = input.externalSnapshot.interfaceKind === "direct";
  const searchSpaceReady = input.externalCapabilityMatrix.searchSpaceReady && input.externalCapabilityMatrix.workLeaseReady;
  const externalReferenceOnly = externalAlgorithmReferenceOnly(input);
  const canAssignExternalWork = !externalReferenceOnly && input.externalWorkAdapterPlan.canAssignWork;
  const recommended = operatingEnvelope.recommendedPoint;
  const experiments = [
    algorithmExperiment({
      id: "verify_consensus_midstate",
      status: midstateActionStatus(input),
      priority: "critical",
      route: "consensus",
      metric: "safety",
      summary: "Consensus SHA-256 and HeaderWork midstate verification.",
      successCriteria: "Midstate output matches full 80-byte header double SHA-256 for CPU and GPU paths.",
      nextStep: input.midstateReuseReady === true
        ? "Keep this as a non-negotiable regression gate."
        : input.midstateReuseReady === false
          ? "Restore HeaderWork verification before any higher-density optimization."
          : "Run or import the fixed-window full-header vs HeaderWork benchmark before promoting midstate reuse.",
    }),
    algorithmExperiment({
      id: "capture_local_baseline",
      status: localSampleCount > 0 ? "done" : "ready",
      priority: "critical",
      route: "local",
      metric: "hashrate",
      summary: "Capture a local CPU/GPU baseline sample.",
      successCriteria: "At least one tuning sample has live hashrate and elapsed runtime.",
      nextStep: localSampleCount > 0
        ? `${localSampleCount} local sample${localSampleCount === 1 ? "" : "s"} available.`
        : "Run one conservative local profile long enough for a stable hashrate sample.",
    }),
    algorithmExperiment({
      id: "measure_local_power",
      status: measuredPowerCount > 0 ? "done" : localSampleCount > 0 ? "ready" : "waiting",
      priority: "high",
      route: "local",
      metric: "power",
      summary: "Measure local watts instead of relying on estimates.",
      successCriteria: "At least one local profile has measured watts for J/TH routing.",
      nextStep: measuredPowerCount > 0
        ? `${measuredPowerCount} local sample${measuredPowerCount === 1 ? "" : "s"} have measured power.`
        : "Add wall-power or device telemetry before treating local J/TH as final.",
    }),
    algorithmExperiment({
      id: "prove_share_quality",
      status: provenShareCount > 0 ? "done" : localSampleCount > 0 ? "ready" : "waiting",
      priority: "high",
      route: "local",
      metric: "safety",
      summary: "Prove local hash work reaches useful pool shares.",
      successCriteria: "Accepted/rejected/stale/queue-drop counters provide proven share evidence.",
      nextStep: provenShareCount > 0
        ? `${provenShareCount} local sample${provenShareCount === 1 ? "" : "s"} have proven share evidence.`
        : "Keep sampling until share counters show useful non-stale pool work.",
    }),
    algorithmExperiment({
      id: "extend_stability_window",
      status: longRunReady ? "done" : localSampleCount > 0 ? "ready" : "waiting",
      priority: "medium",
      route: "local",
      metric: "safety",
      summary: `Run the chosen local profile through a stable ${unattendedRuntimeSummary()} window.`,
      successCriteria: `A measured profile runs at least ${unattendedRuntimeSummary()}, is stable, proven, thermally safe, and rated good or excellent.`,
      nextStep: longRunReady
        ? "A local profile is ready for long unattended mining consideration."
        : `Let the leading local profile run for at least ${unattendedRuntimeSummary()} with low share waste and safe thermals.`,
    }),
    algorithmExperiment({
      id: "probe_power_density_knee",
      status: powerDensityProbeStatus(input),
      priority: "medium",
      route: "local",
      metric: "efficiency",
      summary: powerDensityProbeSummary(input),
      successCriteria: "Measured marginal H/s/W confirms where the next watt stops paying for useful hash.",
      nextStep: powerDensityProbeNextStep(input),
    }),
    algorithmExperiment({
      id: "sample_network_asic",
      status: networkSamplesReady ? "done" : networkEndpointReady ? "ready" : "waiting",
      priority: "high",
      route: "network",
      metric: "efficiency",
      summary: "Sample network ASIC telemetry for watts, J/TH, temperature, and hashrate.",
      successCriteria: "At least three usable cool/warm external efficiency samples exist and trend is not degrading.",
      nextStep: networkSamplesReady
        ? planningExternalHistory(input).summary
        : networkEndpointReady
          ? "External hash telemetry is sealed on this branch; use the archive branch for future hardware validation."
          : "Configure a Network host before comparing external efficiency.",
    }),
    algorithmExperiment({
      id: "choose_direct_protocol",
      status: directSelected ? "reserved" : "waiting",
      priority: "medium",
      route: "direct",
      metric: "safety",
      summary: "Choose the Direct physical protocol only after hardware exists.",
      successCriteria: "Serial, USB, HID, or device-path protocol is documented and testable on real hardware.",
      nextStep: directSelected
        ? "Keep Direct reserved until the physical endpoint and protocol are known."
        : "No Direct hardware is selected yet.",
    }),
    algorithmExperiment({
      id: "review_search_space",
      status: input.externalSnapshot.interfaceKind === "none" ? "waiting" : searchSpaceReady ? "done" : "blocked",
      priority: "critical",
      route: "external",
      metric: "hashrate",
      summary: "Prove unique enough search space for external high-hash workers.",
      successCriteria: "Nonce, version, nTime, or extranonce partitions last long enough without overlap.",
      nextStep: searchSpaceReady
        ? "Search-space and lease gates are ready for dry-run validation."
        : `${input.externalCapabilityMatrix.searchSpace.summary} ${input.externalCapabilityMatrix.workLease.summary}`,
    }),
    algorithmExperiment({
      id: "validate_external_work_lease",
      status: canAssignExternalWork ? "ready" : directSelected ? "reserved" : networkEndpointReady ? "blocked" : "waiting",
      priority: "critical",
      route: "external",
      metric: "safety",
      summary: "Validate external work leases before any real external start().",
      successCriteria: "Mock leases prove job lifecycle, stale-result rejection, thermals, and accepted share evidence.",
      nextStep: input.externalWorkAdapterPlan.nextStep,
    }),
    algorithmExperiment({
      id: "record_offline_timing_probe",
      status: "reserved",
      priority: "low",
      route: "offline",
      metric: "research",
      summary: "Record ASIC timing/noise telemetry for offline thermodynamic or TPF research only.",
      successCriteria: "Offline traces include timestamps, thermals, voltage/frequency, and share outcomes without nonce pruning or live route changes.",
      nextStep: networkEndpointReady
        ? "Export bounded telemetry for offline analysis; never feed timing predictions into production search or pool submissions."
        : "Wait for external ASIC telemetry hardware before collecting silicon timing evidence.",
    }),
    algorithmExperiment({
      id: "apply_operating_point",
      status: recommended.source === "local" && recommended.status === "ready"
        ? "ready"
        : recommended.status === "dry-run" ? "reserved" : "waiting",
      priority: "medium",
      route: recommended.source === "external" ? "external" : "local",
      metric: recommended.role === "max_hashrate" ? "hashrate" : recommended.role === "lowest_power" ? "power" : "efficiency",
      summary: `Apply or verify the primary operating point: ${recommended.role.replace(/_/g, " ")}.`,
      successCriteria: "The primary point has enough measured power, share quality, and stability evidence for its role.",
      nextStep: recommended.nextStep,
    }),
  ];
  const sorted = experiments.slice().sort((left, right) => (
    experimentStatusRank(left.status) - experimentStatusRank(right.status) ||
    experimentPriorityRank(left.priority) - experimentPriorityRank(right.priority)
  ));
  const primaryExperiment = sorted[0] ?? experiments[0];
  const readyCount = experiments.filter((experiment) => experiment.status === "ready").length;
  const blockedCount = experiments.filter((experiment) => experiment.status === "blocked" || experiment.status === "reserved").length;
  const doneCount = experiments.filter((experiment) => experiment.status === "done").length;

  return {
    experiments: sorted,
    primaryExperiment,
    readyCount,
    blockedCount,
    doneCount,
    summary: `Experiment queue: primary ${primaryExperiment.id.replace(/_/g, " ")}; ${readyCount} ready, ${blockedCount} blocked/reserved, ${doneCount} done.`,
  };
}

function readinessGate(args: MiningAlgorithmReadinessGate): MiningAlgorithmReadinessGate {
  return args;
}

function readinessStatusReady(status: MiningAlgorithmReadinessGateStatus) {
  return status === "passed";
}

function midstateReadinessStatus(input: MiningAlgorithmPlanInput): MiningAlgorithmReadinessGateStatus {
  if (input.midstateReuseReady === true) {
    return "passed";
  }
  if (input.midstateReuseReady === false) {
    return "blocked";
  }
  return "waiting";
}

function midstateActionStatus(input: MiningAlgorithmPlanInput): MiningAlgorithmActionStatus {
  if (input.midstateReuseReady === true) {
    return "done";
  }
  if (input.midstateReuseReady === false) {
    return "blocked";
  }
  return "ready";
}

function deriveReadinessCertificate(
  input: MiningAlgorithmPlanInput,
): MiningAlgorithmReadinessCertificate {
  const measuredPowerCount = measuredPowerProfiles(input.tuningAnalysis).length;
  const provenShareCount = provenShareProfiles(input.tuningAnalysis).length;
  const localSampleCount = input.tuningAnalysis.results.length;
  const longRunReady = hasLongRunReadyLocalProfile(input);
  const localThermalUnsafe = localSampleCount > 0 && !input.tuningAnalysis.results.some(hasSafeUnattendedThermals);
  const externalConfigured = input.externalSnapshot.interfaceKind === "network" && Boolean(input.externalSnapshot.endpoint);
  const externalSamplesReady = externalHistoryEvidenceReady(input);
  const directSelected = input.externalSnapshot.interfaceKind === "direct";
  const searchSpaceReady = input.externalCapabilityMatrix.searchSpaceReady && input.externalCapabilityMatrix.workLeaseReady;
  const externalReferenceOnly = externalAlgorithmReferenceOnly(input);
  const canAssignExternalWork = !externalReferenceOnly && input.externalWorkAdapterPlan.canAssignWork;
  const externalRouteActive = !externalReferenceOnly && (input.externalSnapshot.interfaceKind === "network" || canAssignExternalWork);
  const consensusMidstateStatus = midstateReadinessStatus(input);
  const gates = [
    readinessGate({
      id: "consensus_midstate",
      status: consensusMidstateStatus,
      scope: "consensus",
      requiredForReady: true,
      summary: "Consensus double SHA-256 and HeaderWork midstate path.",
      evidence: consensusMidstateStatus === "passed"
        ? "Midstate proof is available in the local hash path."
        : consensusMidstateStatus === "blocked"
          ? "Midstate proof failed or is explicitly blocked."
          : "Midstate proof has not been reported by the fixed-window benchmark.",
      nextStep: consensusMidstateStatus === "passed"
        ? "Keep this covered by frontend and Rust regression tests."
        : consensusMidstateStatus === "blocked"
          ? "Restore CPU/GPU full-header verification before tuning routes."
          : "Run or import the fixed-window full-header vs HeaderWork benchmark before claiming midstate readiness.",
    }),
    readinessGate({
      id: "measured_power",
      status: measuredPowerCount > 0 ? "passed" : localSampleCount > 0 ? "waiting" : "waiting",
      scope: "local",
      requiredForReady: true,
      summary: "Measured local watts for true J/TH decisions.",
      evidence: measuredPowerCount > 0
        ? `${measuredPowerCount} measured-power local sample${measuredPowerCount === 1 ? "" : "s"}.`
        : "Only estimated local watts are available.",
      nextStep: measuredPowerCount > 0
        ? "Use measured samples for low-power and max-efficiency route decisions."
        : "Enter wall-meter/device watts before capturing the next local tuning sample.",
    }),
    readinessGate({
      id: "share_quality",
      status: provenShareCount > 0 ? "passed" : localSampleCount > 0 ? "waiting" : "waiting",
      scope: "local",
      requiredForReady: true,
      summary: "Share evidence proves useful non-stale pool work.",
      evidence: provenShareCount > 0
        ? `${provenShareCount} local sample${provenShareCount === 1 ? "" : "s"} have proven share evidence.`
        : "Share evidence is missing or thin.",
      nextStep: provenShareCount > 0
        ? "Keep rejected, stale, and queue-drop waste low during longer runs."
        : "Let the profile run until accepted/rejected/local-drop counters prove useful work.",
    }),
    readinessGate({
      id: "stability_window",
      status: longRunReady ? "passed" : localSampleCount > 0 ? "waiting" : "waiting",
      scope: "local",
      requiredForReady: true,
      summary: `Stable ${unattendedRuntimeSummary()} window for unattended local mining.`,
      evidence: longRunReady
        ? `A local profile is stable for at least ${unattendedRuntimeSummary()} with measured power and proven shares.`
        : `No local profile has cleared the ${unattendedRuntimeSummary()} stability gate yet.`,
      nextStep: longRunReady
        ? "This profile can be considered for long unattended local operation."
        : `Run the leading profile for at least ${unattendedRuntimeSummary()} with measured watts and low share waste.`,
    }),
    readinessGate({
      id: "thermal_safety",
      status: localSampleCount === 0 ? "waiting" : localThermalUnsafe ? "blocked" : "passed",
      scope: "local",
      requiredForReady: true,
      summary: "Thermal state is safe for long-running optimization.",
      evidence: localSampleCount === 0
        ? "Thermal evidence is waiting for local samples."
        : localThermalUnsafe
          ? "All relevant local samples are hot, critical, or paused."
          : "At least one local thermal sample is below the hot/critical/paused guardrail.",
      nextStep: localThermalUnsafe
        ? "Lower intensity or improve cooling before treating the profile as stable."
        : "Keep thermal telemetry in future tuning captures.",
    }),
    readinessGate({
      id: "external_efficiency_history",
      status: externalSamplesReady ? "passed" : externalConfigured ? "waiting" : "waiting",
      scope: "external",
      requiredForReady: externalRouteActive,
      summary: "External telemetry history has enough stable efficiency samples.",
      evidence: externalSamplesReady
        ? planningExternalHistory(input).summary
        : externalConfigured
          ? planningExternalHistory(input).summary
          : "No external network telemetry endpoint is configured.",
      nextStep: externalSamplesReady
        ? "Keep sampling to detect degrading external efficiency."
        : externalConfigured
          ? "Collect at least three usable cool/warm external efficiency samples."
          : "Configure Network external hash before comparing ASIC efficiency.",
    }),
    readinessGate({
      id: "search_space_lease",
      status: searchSpaceReady ? "passed" : externalRouteActive ? "blocked" : "waiting",
      scope: "external",
      requiredForReady: externalRouteActive,
      summary: "External workers have unique enough search space and safe leases.",
      evidence: `${input.externalCapabilityMatrix.searchSpace.summary} ${input.externalCapabilityMatrix.workLease.summary}`,
      nextStep: searchSpaceReady
        ? "Keep this as a hard gate before external high-hash routing."
        : "Prove BIP320/BIP323/SV2 version rolling, extranonce, or equivalent work partitioning.",
    }),
    readinessGate({
      id: "external_work_validation",
      status: canAssignExternalWork ? "waiting" : directSelected ? "reserved" : externalConfigured ? "blocked" : "waiting",
      scope: "external",
      requiredForReady: externalRouteActive,
      summary: "External work validation remains dry-run until hardware proof exists.",
      evidence: input.externalWorkAdapterPlan.summary,
      nextStep: canAssignExternalWork
        ? "Run dry-run lease validation, stale-result rejection, thermal, and accepted-share checks."
        : input.externalWorkAdapterPlan.nextStep,
    }),
    readinessGate({
      id: "direct_protocol",
      status: directSelected ? "reserved" : "waiting",
      scope: "direct",
      requiredForReady: directSelected,
      summary: "Direct physical protocol is selected and proven.",
      evidence: directSelected
        ? `Direct endpoint ${input.externalSnapshot.endpoint || "waiting"} is reserved.`
        : "Direct interface is not selected.",
      nextStep: directSelected
        ? "Choose and test the real serial, USB, HID, or device-path protocol."
        : "No Direct protocol work is required until hardware exists.",
    }),
  ];
  const requiredGates = gates.filter((gate) => gate.requiredForReady);
  const requiredPassed = requiredGates.filter((gate) => readinessStatusReady(gate.status)).length;
  const requiredTotal = requiredGates.length;
  const readinessScore = requiredTotal > 0 ? Math.round(requiredPassed * 100 / requiredTotal) : 0;
  const primaryMissingGate = requiredGates.find((gate) => !readinessStatusReady(gate.status)) ?? null;
  const readyForUnattendedLocal = ["consensus_midstate", "measured_power", "share_quality", "stability_window", "thermal_safety"].every((id) => (
    readinessStatusReady(gates.find((gate) => gate.id === id)?.status ?? "waiting")
  ));
  const readyForExternalDryRun = canAssignExternalWork &&
    readinessStatusReady(gates.find((gate) => gate.id === "external_efficiency_history")?.status ?? "waiting") &&
    readinessStatusReady(gates.find((gate) => gate.id === "search_space_lease")?.status ?? "waiting");
  const readyForExternalMining = false;

  return {
    gates,
    requiredPassed,
    requiredTotal,
    readinessScore,
    readyForUnattendedLocal,
    readyForExternalDryRun,
    readyForExternalMining,
    primaryMissingGate,
    summary: primaryMissingGate
      ? `Optimization readiness ${readinessScore}%: waiting on ${primaryMissingGate.id.replace(/_/g, " ")}.`
      : `Optimization readiness ${readinessScore}%: local unattended gates are satisfied; external mining start remains release-gated.`,
  };
}

function localSummary(input: MiningAlgorithmPlanInput) {
  const local = bestLocalProfile(input.tuningAnalysis);
  if (!local) {
    return "Local CPU/GPU route is waiting for a measured tuning sample.";
  }

  return `Local route ${local.step.summary}: ${Math.round(local.qualityAdjustedHashrate).toLocaleString("en-US")} quality H/s, score ${local.longRunScore}/100 (${local.longRunRisk}).`;
}

function externalSummary(input: MiningAlgorithmPlanInput) {
  if (externalAlgorithmLocalOnly(input)) {
    return "External hash is sealed off from local algorithm planning; optimize local CPU/GPU only.";
  }
  const matrix = input.externalCapabilityMatrix;
  if (input.externalSnapshot.interfaceKind === "none") {
    return "External hash interface is disabled.";
  }
  if (input.externalSnapshot.interfaceKind === "direct") {
    return input.externalSnapshot.endpoint
      ? `Direct endpoint ${input.externalSnapshot.endpoint} is recorded but reserved.`
      : "Direct endpoint is reserved until hardware and protocol are chosen.";
  }
  if (!input.externalSnapshot.endpoint) {
    return "Network external hash needs a host before telemetry can be sampled.";
  }
  if (externalOperatingEvidenceReady(input)) {
    return `External operating proof is available; ${input.externalWorkAdapterPlan.summary}`;
  }
  if (input.externalWorkAdapterPlan.canAssignWork) {
    return `External dry-run work leases are assignable. ${matrix.workLease.summary}`;
  }
  if (matrix.canCompareEfficiency) {
    return `External telemetry can be compared, but work assignment is blocked: ${input.externalWorkAdapterPlan.nextStep}`;
  }
  return input.externalWorkAdapterPlan.summary;
}

function deriveActions(
  input: MiningAlgorithmPlanInput,
  decision: HashRouteDecision | null,
  operatingEnvelope: MiningAlgorithmOperatingEnvelope,
): MiningAlgorithmPlanAction[] {
  const hasLocalSample = input.tuningAnalysis.results.length > 0;
  const hasMeasuredPower = measuredPowerProfiles(input.tuningAnalysis).length > 0;
  const hasProvenShares = provenShareProfiles(input.tuningAnalysis).length > 0;
  const matrix = input.externalCapabilityMatrix;
  const workPlan = input.externalWorkAdapterPlan;
  const externalReferenceOnly = externalAlgorithmReferenceOnly(input);
  const midstateStatus = midstateActionStatus(input);
  const actions: MiningAlgorithmPlanAction[] = [{
    id: "consensus_midstate",
    status: midstateStatus,
    summary: "Keep consensus hashing unchanged and reuse SHA-256 midstate for local header work.",
    nextStep: midstateStatus === "done"
      ? "Continue optimizing around work preparation, not proof-of-work semantics."
      : midstateStatus === "blocked"
        ? "Restore or prove the local HeaderWork/midstate path before chasing higher hash density."
        : "Run the fixed-window full-header vs HeaderWork benchmark before claiming midstate density gains.",
  }, {
    id: "local_sample",
    status: hasLocalSample ? "done" : "ready",
    summary: hasLocalSample
      ? `${input.tuningAnalysis.results.length} local tuning sample${input.tuningAnalysis.results.length === 1 ? "" : "s"} available.`
      : "Capture at least one local CPU/GPU tuning sample.",
    nextStep: hasLocalSample
      ? input.tuningAnalysis.summary
      : "Run a stable local profile long enough to record hashrate, share counters, and power evidence.",
  }, {
    id: "power_evidence",
    status: hasMeasuredPower ? "done" : "waiting",
    summary: hasMeasuredPower
      ? `${measuredPowerProfiles(input.tuningAnalysis).length} local sample${measuredPowerProfiles(input.tuningAnalysis).length === 1 ? "" : "s"} have measured watts.`
      : "Measured watts are still missing for local J/TH decisions.",
    nextStep: hasMeasuredPower
      ? "Use measured-power samples for lowest-power and max-efficiency routing."
      : "Add wall-power/device telemetry before treating estimated local J/TH as final.",
  }, {
    id: "share_evidence",
    status: hasProvenShares ? "done" : "waiting",
    summary: hasProvenShares
      ? `${provenShareProfiles(input.tuningAnalysis).length} local sample${provenShareProfiles(input.tuningAnalysis).length === 1 ? "" : "s"} have proven share evidence.`
      : "Share evidence is thin or missing for long-run routing.",
    nextStep: hasProvenShares
      ? "Prefer profiles with low rejected, stale, and queue-drop waste."
      : "Keep sampling until accepted/rejected/local-drop events prove useful pool work.",
  }];

  if (input.externalSnapshot.interfaceKind === "direct") {
    actions.push({
      id: "direct_protocol",
      status: "reserved",
      summary: "Direct external hash is reserved.",
      nextStep: input.externalSnapshot.endpoint
        ? "Choose and validate the serial, USB, HID, or device-path protocol before assigning work."
        : "Record the endpoint shape after hardware is available.",
    });
  } else if (input.externalSnapshot.interfaceKind === "network") {
    actions.push({
      id: "network_telemetry",
      status: input.externalSnapshot.endpoint ? "ready" : "waiting",
      summary: input.externalSnapshot.endpoint
        ? "Network external telemetry endpoint is configured."
        : "Network external telemetry needs a host.",
      nextStep: input.externalSnapshot.endpoint
        ? "Sample hashrate, watts, temperature, and J/TH without taking over pool jobs."
        : "Set a network host before comparing external efficiency.",
    }, {
      id: "external_capabilities",
      status: externalReferenceOnly ? "reserved" : workPlan.canAssignWork ? "done" : "blocked",
      summary: externalReferenceOnly
        ? "External adapter capabilities are parked as reference-only for this algorithm pass."
        : workPlan.canAssignWork
          ? "External adapter can receive dry-run work leases."
          : `External work assignment is blocked; missing capabilities: ${missingList(workPlan.missingCapabilities)}; missing performance: ${missingList(workPlan.missingPerformanceCapabilities)}.`,
      nextStep: externalReferenceOnly
        ? "Keep collecting reference telemetry only; do not validate external work as the current algorithm route."
        : workPlan.nextStep,
    }, {
      id: "external_search_space",
      status: externalReferenceOnly ? "reserved" : matrix.searchSpaceReady && matrix.workLeaseReady ? "done" : "blocked",
      summary: `${matrix.searchSpace.summary} ${matrix.workLease.summary}`,
      nextStep: externalReferenceOnly
        ? "Search-space planning is retained for future hardware, not used by the current local algorithm route."
        : matrix.searchSpaceReady && matrix.workLeaseReady
          ? "Keep unique work partitioning as a hard gate before real external start()."
          : "Prove version rolling, extranonce, or equivalent unique work partitioning before high-hash routing.",
    });

    if (workPlan.canAssignWork && !externalReferenceOnly) {
      actions.push({
        id: "external_dry_run_validation",
        status: "ready",
        summary: "External work adapter is ready for mock lease validation.",
        nextStep: "Validate job lifecycle, stale-result rejection, thermal limits, and accepted pool-share evidence before hardware start().",
      });
    }
  }

  if (decision?.primaryAction) {
    const primaryPoint = operatingEnvelope.recommendedPoint;
    const routeActionReady = decision.primaryAction.enabledByRecommendation &&
      (decision.primaryAction.kind !== "apply_local_profile" || primaryPoint.source === "local" && primaryPoint.status === "ready") &&
      (decision.primaryAction.kind !== "test_external_telemetry" || primaryPoint.status !== "dry-run");
    actions.push({
      id: "route_action",
      status: routeActionReady ? "ready" : "waiting",
      summary: routeActionReady ? decision.summary : `Route action gated: ${primaryPoint.nextStep}`,
      nextStep: routeActionReady ? decision.primaryAction.detail : primaryPoint.nextStep,
    });
  }

  return actions;
}

function deriveHardwareCandidateAssessment(
  input: MiningAlgorithmPlanInput,
  decision: HashRouteDecision | null,
): HashHardwareCandidateAssessment {
  const snapshot = input.externalSnapshot;
  const matrix = input.externalCapabilityMatrix;
  const goal = decision?.primaryGoal ?? "balanced";
  return assessHashHardwareCandidate({
    id: snapshot.endpoint || snapshot.interfaceKind,
    label: snapshot.label || snapshot.endpoint || "External Candidate",
    interfaceKind: snapshot.interfaceKind === "network" || snapshot.interfaceKind === "direct" ? snapshot.interfaceKind : "unknown",
    hashrate: (externalOperatingHashrate(input) ?? snapshot.hashrate) || planningExternalHistory(input).averageHashrate,
    watts: externalOperatingWatts(input) ?? snapshot.watts ?? planningExternalHistory(input).averageWatts,
    joulesPerTerahash: externalOperatingJoulesPerTerahash(input) ?? snapshot.joulesPerTerahash ?? planningExternalHistory(input).averageJoulesPerTerahash ?? planningExternalHistory(input).bestJoulesPerTerahash,
    supportsTelemetry: matrix.canReadTelemetry,
    supportsPowerTelemetry: matrix.canCompareEfficiency,
    supportsJobControl: matrix.canControlMining,
    supportsShareSubmission: matrix.canSubmitShares,
    supportsVersionRolling: matrix.canRollVersion,
    supportsWorkPartitioning: matrix.canPartitionWork,
    parallelWorkers: snapshot.parallelWorkers,
    targetJobSeconds: 1,
  }, goal);
}

function deriveResearchPromotionGate(researchReview: AlgorithmResearchReview): MiningAlgorithmResearchPromotionGate {
  const blockedSourceIds = Array.from(new Set(researchReview.safetyEnvelope.promotionBlockingSourceIds));
  const protectedRuntimeSourceIds = researchReview.sourceIds.filter((id) => (
    id === "bitcoin_consensus_pow" ||
    id === "local_midstate_regression" ||
    id === "measured_power_telemetry" ||
    id === "sha256_uniform_search"
  ));
  const frontierPromotionAllowed = blockedSourceIds.length === 0;
  return {
    status: frontierPromotionAllowed ? "clear" : "review_required",
    frontierPromotionAllowed,
    runtimeProfilePromotionAllowed: true,
    blockedSourceIds,
    protectedRuntimeSourceIds,
    summary: frontierPromotionAllowed
      ? "Frontier algorithm promotion gate is clear; runtime profile changes still require measured local evidence and profile gates."
      : "Frontier algorithm promotion is blocked until promotion-blocking offline hypothesis sources are refreshed; measured local runtime profiles remain governed by objective/profile gates.",
    nextStep: frontierPromotionAllowed
      ? "Use objective and profile gates for local runtime changes; keep refreshing frontier sources on schedule."
      : "Refresh frontier promotion-blocking offline hypothesis sources before promoting any new low-power or high-hash algorithm claim.",
  };
}

function stackLocalKernel(input: MiningAlgorithmPlanInput): MiningAlgorithmStackSnapshot["localKernel"] {
  if (input.midstateReuseReady === true && midstatePerformanceRegresses(input)) {
    return {
      mode: "midstate_regression",
      status: "done",
      summary: "Midstate equivalence is proven, but the local benchmark regresses; full-header hashing remains the default density baseline.",
      nextStep: "Rerun or optimize the HeaderWork benchmark before making midstate the default local kernel.",
    };
  }
  if (input.midstateReuseReady === true) {
    return {
      mode: "midstate_reuse",
      status: "done",
      summary: "Runtime kernel uses consensus-equivalent SHA-256 midstate reuse for the invariant header chunk.",
      nextStep: "Keep midstate/full-header equivalence tests green before changing hash preparation.",
    };
  }
  if (input.midstateReuseReady === false) {
    return {
      mode: "midstate_blocked",
      status: "blocked",
      summary: "Runtime kernel falls back to full-header hashing because midstate evidence is blocked.",
      nextStep: "Fix the midstate benchmark or keep using full-header hashing until equivalence is proven.",
    };
  }
  return {
    mode: "midstate_waiting",
    status: "ready",
    summary: "Runtime kernel is waiting for fixed-window midstate benchmark evidence.",
    nextStep: "Run the midstate/full-header benchmark before promoting midstate reuse as the default local kernel.",
  };
}

function stackHighHashPath(
  input: MiningAlgorithmPlanInput,
  operatingEnvelope: MiningAlgorithmOperatingEnvelope,
  recommendedRoute: MiningAlgorithmPlan["recommendedRoute"],
): MiningAlgorithmStackHighHashPath {
  if (input.externalSnapshot.interfaceKind === "direct") {
    return "direct_reserved";
  }
  if (recommendedRoute === "external" && input.externalWorkAdapterPlan.canAssignWork) {
    return "external_dry_run";
  }
  if (recommendedRoute === "external" && input.externalSnapshot.interfaceKind === "network") {
    return "external_telemetry_only";
  }
  if (operatingEnvelope.maxHashrate.status === "ready") {
    return "local_runtime";
  }
  return "waiting";
}

function stackExternalWorkPolicy(
  input: MiningAlgorithmPlanInput,
  readinessCertificate: MiningAlgorithmReadinessCertificate,
): MiningAlgorithmStackExternalWorkPolicy {
  if (input.externalSnapshot.interfaceKind === "direct") {
    return "direct_reserved";
  }
  if (input.externalWorkAdapterPlan.canAssignWork) {
    return readinessCertificate.readyForExternalMining ? "release_gated" : "dry_run_only";
  }
  if (input.externalSnapshot.interfaceKind === "network") {
    return "telemetry_only";
  }
  return "disabled";
}

function deriveAlgorithmStack(input: {
  planInput: MiningAlgorithmPlanInput;
  densityPlan: HashDensityPlan;
  operatingEnvelope: MiningAlgorithmOperatingEnvelope;
  researchReview: AlgorithmResearchReview;
  researchPromotionGate: MiningAlgorithmResearchPromotionGate;
  readinessCertificate: MiningAlgorithmReadinessCertificate;
  evidenceRoadmap: AlgorithmEvidenceRoadmap;
  samplingPlan: AlgorithmSamplingPlan;
  recommendedRoute: MiningAlgorithmPlan["recommendedRoute"];
}): MiningAlgorithmStackSnapshot {
  const lane = input.densityPlan.selectedLane;
  const point = input.operatingEnvelope.recommendedPoint;
  const highHashPath = stackHighHashPath(input.planInput, input.operatingEnvelope, input.recommendedRoute);
  const externalWorkPolicy = stackExternalWorkPolicy(input.planInput, input.readinessCertificate);
  return {
    consensusHashing: "double_sha256",
    consensusScope: "fixed_header_pow",
    localKernel: stackLocalKernel(input.planInput),
    defaultOperatingLane: {
      id: lane.id,
      source: lane.source,
      status: lane.status,
      strategy: input.densityPlan.strategy,
      summary: lane.summary,
      nextStep: lane.nextStep,
    },
    powerObjective: point.role,
    highHashPath,
    externalWorkPolicy,
    frontierPolicy: input.researchPromotionGate.status,
    rejectedShortcutIdeaIds: input.researchReview.rejectedIdeaIds,
    summary: `Algorithm stack: consensus double SHA-256; local kernel ${stackLocalKernel(input.planInput).mode.replace(/_/g, " ")}; lane ${lane.id.replace(/_/g, " ")} is ${lane.status}; high-hash path ${highHashPath.replace(/_/g, " ")}; external work ${externalWorkPolicy.replace(/_/g, " ")}.`,
    nextStep: input.samplingPlan.primaryTask.nextStep || input.evidenceRoadmap.nextStep,
  };
}

function deriveRisks(input: MiningAlgorithmPlanInput, decision: HashRouteDecision | null, hardwareCandidate: HashHardwareCandidateAssessment) {
  const risks: string[] = [];
  const local = bestLocalProfile(input.tuningAnalysis);
  if (input.midstateReuseReady === true && midstatePerformanceRegresses(input)) {
    risks.push("Local midstate benchmark is a performance regression; full-header remains the default density baseline.");
  } else if (input.midstateReuseReady !== true) {
    risks.push(input.midstateReuseReady === false
      ? "Local midstate reuse is blocked."
      : "Local midstate reuse is waiting for fixed-window benchmark evidence.");
  }
  if (local && !isUnattendedLocalProfileReady(local)) {
    risks.push(`Best local profile is not unattended-ready: ${localPointReadinessGaps(local)}`);
  }
  if (measuredPowerProfiles(input.tuningAnalysis).length === 0) {
    risks.push("Local power is estimated; J/TH decisions need measured watts.");
  }
  if (provenShareProfiles(input.tuningAnalysis).length === 0) {
    risks.push("Share evidence is not proven; effective hashrate may be optimistic.");
  }
  if (input.externalSnapshot.interfaceKind === "network" && !input.externalWorkAdapterPlan.canAssignWork) {
    risks.push("Network external hash is telemetry-only or blocked; no external job routing is enabled.");
  }
  if (input.externalSnapshot.interfaceKind === "direct") {
    risks.push("Direct external hash is reserved until hardware protocol validation.");
  }
  if (decision?.primaryRecommendation.reason === "external_search_space") {
    risks.push("External search-space or work-lease readiness is not proven.");
  }
  if (decision?.primaryRecommendation.reason === "external_work_adapter") {
    risks.push("External work adapter readiness is not proven.");
  }
  if (input.externalSnapshot.interfaceKind !== "none") {
    risks.push(...hardwareCandidate.riskFlags.slice(0, 2));
  }
  return Array.from(new Set(risks));
}

export function deriveMiningAlgorithmPlan(rawInput: MiningAlgorithmPlanInput): MiningAlgorithmPlan {
  const input = localOnlyAlgorithmInput(rawInput);
  const routeDecision = deriveRouteDecision(input);
  const strategy = deriveStrategy(input, routeDecision);
  const hardwareCandidate = deriveHardwareCandidateAssessment(input, routeDecision);
  const densityPlan = deriveHashDensityPlan({
    tuningAnalysis: input.tuningAnalysis,
    externalHistory: planningExternalHistory(input),
    externalSnapshot: input.externalSnapshot,
    externalWorkAdapterPlan: input.externalWorkAdapterPlan,
    hardwareCandidate,
  });
  const operatingEnvelope = deriveOperatingEnvelope(input, routeDecision);
  const actions = deriveActions(input, routeDecision, operatingEnvelope);
  const riskFlags = deriveRisks(input, routeDecision, hardwareCandidate);
  const researchReview = deriveAlgorithmResearchReview({
    midstateReady: midstatePreferred(input),
    hasMeasuredLocalPower: measuredPowerProfiles(input.tuningAnalysis).length > 0,
    networkTelemetryReady: input.externalSnapshot.interfaceKind === "network" && input.externalCapabilityMatrix.canReadTelemetry,
    externalEfficiencyReady: externalHistoryEvidenceReady(input),
    searchSpaceReady: input.externalCapabilityMatrix.searchSpaceReady && input.externalCapabilityMatrix.workLeaseReady,
    externalWorkAssignable: input.externalWorkAdapterPlan.canAssignWork,
    directProtocolSelected: input.externalSnapshot.interfaceKind === "direct" && Boolean(input.externalSnapshot.endpoint),
    researchReviewedAt: input.researchReviewedAt,
  });
  const researchPolicy = deriveResearchPolicy(input, strategy, researchReview);
  const researchPromotionGate = deriveResearchPromotionGate(researchReview);
  const experimentQueue = deriveExperimentQueue(input, operatingEnvelope);
  const readinessCertificate = deriveReadinessCertificate(input);
  const evidenceRoadmap = deriveAlgorithmEvidenceRoadmap({
    researchReview,
    primaryExperiment: experimentQueue.primaryExperiment,
    readinessScore: readinessCertificate.readinessScore,
    readyForUnattendedLocal: readinessCertificate.readyForUnattendedLocal,
    readyForExternalDryRun: readinessCertificate.readyForExternalDryRun,
    readyForExternalMining: readinessCertificate.readyForExternalMining,
    readinessGates: readinessCertificate.gates,
    densityPlan,
    researchPromotionGate,
  });
  const samplingPlan = deriveAlgorithmSamplingPlan({
    evidenceRoadmap,
    readinessCertificate,
    experimentQueue,
    densityPlan,
    externalHistory: planningExternalHistory(input),
  });
  const recommendedRoute = planRecommendedRoute(routeDecision);
  const algorithmStack = deriveAlgorithmStack({
    planInput: input,
    densityPlan,
    operatingEnvelope,
    researchReview,
    researchPromotionGate,
    readinessCertificate,
    evidenceRoadmap,
    samplingPlan,
    recommendedRoute,
  });
  const confidence = routeDecision?.primaryRecommendation.confidence ?? "waiting";
  const dryRunOnly = recommendedRoute === "external" && input.externalWorkAdapterPlan.canAssignWork;
  const summary = (() => {
    switch (strategy) {
      case "collect_baseline":
        return externalAlgorithmLocalOnly(input)
          ? "Collect local CPU/GPU baseline samples before choosing an optimization route."
          : "Collect local and external baseline samples before choosing an optimization route.";
      case "local_midstate_tuning":
        return "Use consensus-correct local midstate hashing and measured tuning samples for the next optimization step.";
      case "external_telemetry_sampling":
        return "Keep external hash in telemetry mode while local mining remains the only real work engine.";
      case "external_work_dry_run":
        return "Use external dry-run work leases to validate unique assignment before real hardware mining.";
      case "direct_protocol_reserved":
        return "Keep Direct external hash reserved until the hardware endpoint and protocol are selected.";
      case "route_monitoring":
        return "Keep monitoring until one route has enough evidence and safety margin to act.";
    }
  })();

  return {
    strategy,
    recommendedRoute,
    confidence,
    dryRunOnly,
    canAssignExternalWork: input.externalWorkAdapterPlan.canAssignWork,
    consensusBoundary: "Bitcoin proof-of-work remains double SHA-256 over the consensus block header; optimization only changes work preparation, routing, and power policy.",
    localSummary: localSummary(input),
    externalSummary: externalSummary(input),
    routeDecision,
    routeAction: routeDecision?.primaryAction ?? null,
    hardwareCandidate,
    densityPlan,
    operatingEnvelope,
    algorithmStack,
    researchPolicy,
    researchReview,
    researchPromotionGate,
    experimentQueue,
    readinessCertificate,
    evidenceRoadmap,
    samplingPlan,
    actions,
    riskFlags,
    summary,
  };
}

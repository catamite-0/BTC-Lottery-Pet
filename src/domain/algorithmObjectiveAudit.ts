import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmPowerHashEnvelopeSnapshot } from "./algorithmPowerHashEnvelope.js";
import type { AlgorithmRouteCertificate } from "./algorithmRouteCertificate.js";

export type AlgorithmObjectiveAuditStage =
  | "evidence_wait"
  | "local_density_default"
  | "local_density_manual_burst"
  | "external_dry_run_only"
  | "runtime_recovery";

export interface AlgorithmObjectiveAuditResearchFreshness {
  status: "current" | "review_due" | "unknown_dates";
  reviewDueSourceIds: string[];
  undatedFrontierSourceIds: string[];
  nextStep: string;
}

export interface AlgorithmObjectiveAuditReadiness {
  readyForUnattendedLocal: boolean;
  readyForExternalDryRun: boolean;
  readyForExternalMining: boolean;
  primaryMissingGateId: string | null;
  summary: string;
}

export interface AlgorithmObjectiveAuditEvidenceRoadmap {
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
}

export interface AlgorithmObjectiveAuditInput {
  objectiveCertificate: AlgorithmObjectiveCertificate;
  routeCertificate: AlgorithmRouteCertificate;
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot;
  researchFreshness: AlgorithmObjectiveAuditResearchFreshness;
  readiness: AlgorithmObjectiveAuditReadiness;
  evidenceRoadmap: AlgorithmObjectiveAuditEvidenceRoadmap;
}

export interface AlgorithmObjectiveAuditSnapshot {
  schemaVersion: 1;
  objective: "lowest_power_high_hashrate";
  stage: AlgorithmObjectiveAuditStage;
  currentAlgorithm: AlgorithmRouteCertificate["defaultAlgorithm"];
  runtimeStable: boolean;
  lowPowerClaimAllowed: boolean;
  highHashClaimAllowed: boolean;
  fullObjectiveClaimAllowed: boolean;
  latestResearchClaimAllowed: boolean;
  externalMiningAllowed: false;
  evidenceScore: number;
  objectiveProgressScore: number;
  defaultDutyPercent: number | null;
  burstDutyPercent: number | null;
  projectedAverageHashrate: number | null;
  projectedAverageWatts: number | null;
  requiredEvidenceIds: string[];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

function uniqueEvidence(values: Array<string | null | undefined | false>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value) && value !== "none")));
}

function stageFor(input: AlgorithmObjectiveAuditInput): AlgorithmObjectiveAuditStage {
  const { objectiveCertificate, routeCertificate, powerHashEnvelope } = input;
  if (
    objectiveCertificate.status === "blocked" ||
    routeCertificate.status === "blocked" ||
    powerHashEnvelope.status === "blocked"
  ) {
    return "runtime_recovery";
  }
  if (
    objectiveCertificate.runtimeMode === "external_dry_run" ||
    routeCertificate.status === "dry_run" ||
    powerHashEnvelope.mode === "external_dry_run"
  ) {
    return "external_dry_run_only";
  }
  if (
    !objectiveCertificate.lowPowerReady ||
    routeCertificate.productionMode === "collect_evidence" ||
    powerHashEnvelope.mode === "evidence_wait"
  ) {
    return "evidence_wait";
  }
  if (
    objectiveCertificate.highHashReady ||
    routeCertificate.productionMode === "local_density_manual_burst" ||
    powerHashEnvelope.canUseBurst
  ) {
    return "local_density_manual_burst";
  }
  return "local_density_default";
}

function requiredEvidenceIds(input: AlgorithmObjectiveAuditInput, latestResearchClaimAllowed: boolean) {
  const { objectiveCertificate, routeCertificate, researchFreshness, readiness, evidenceRoadmap } = input;
  return uniqueEvidence([
    !objectiveCertificate.lowPowerReady && "low_power_evidence",
    !objectiveCertificate.highHashReady && objectiveCertificate.primaryEvidenceGap,
    objectiveCertificate.primaryEvidenceGap,
    !readiness.readyForUnattendedLocal && readiness.primaryMissingGateId,
    !latestResearchClaimAllowed && "frontier_research_refresh",
    researchFreshness.status === "review_due" && "refresh_frontier_sources",
    researchFreshness.status === "unknown_dates" && "date_frontier_sources",
    evidenceRoadmap.primaryPhaseStatus !== "done" && evidenceRoadmap.primaryPhaseId,
    ...routeCertificate.missingEvidenceIds,
  ]);
}

function summaryFor(input: AlgorithmObjectiveAuditInput, stage: AlgorithmObjectiveAuditStage, latestResearchClaimAllowed: boolean) {
  const algorithm = input.routeCertificate.defaultAlgorithm.replace(/_/g, " ");
  const researchSummary = latestResearchClaimAllowed
    ? "frontier research is current"
    : "latest-paper claims remain review-gated";

  switch (stage) {
    case "runtime_recovery":
      return `Objective audit: ${algorithm} is not promotable until runtime, kernel, power, or share-quality recovery evidence is clean.`;
    case "external_dry_run_only":
      return `Objective audit: ${algorithm} stays local; external high-hash capacity is dry-run/reference only.`;
    case "evidence_wait":
      return `Objective audit: ${algorithm} is waiting for measured low-power density evidence before claiming the objective.`;
    case "local_density_manual_burst":
      return `Objective audit: ${algorithm} is the current local route; run the measured density lane by default, keep high-hash as manual burst, and ${researchSummary}.`;
    case "local_density_default":
      return `Objective audit: ${algorithm} is the current local route; run the measured density lane as default while high-hash evidence remains gated, and ${researchSummary}.`;
  }
}

function nextStepFor(input: AlgorithmObjectiveAuditInput, stage: AlgorithmObjectiveAuditStage, latestResearchClaimAllowed: boolean) {
  const { objectiveCertificate, routeCertificate, powerHashEnvelope, researchFreshness, readiness, evidenceRoadmap } = input;
  if (stage === "runtime_recovery") {
    return routeCertificate.nextStep || powerHashEnvelope.nextStep || objectiveCertificate.nextStep;
  }
  if (stage === "external_dry_run_only") {
    return routeCertificate.nextStep || powerHashEnvelope.nextStep || evidenceRoadmap.nextStep;
  }
  if (!objectiveCertificate.lowPowerReady) {
    return objectiveCertificate.nextStep || readiness.summary;
  }
  if (!objectiveCertificate.highHashReady) {
    return objectiveCertificate.nextStep || routeCertificate.nextStep;
  }
  if (!latestResearchClaimAllowed) {
    return researchFreshness.nextStep || routeCertificate.nextStep;
  }
  return powerHashEnvelope.nextStep || routeCertificate.nextStep || objectiveCertificate.nextStep;
}

export function deriveAlgorithmObjectiveAudit(input: AlgorithmObjectiveAuditInput): AlgorithmObjectiveAuditSnapshot {
  const stage = stageFor(input);
  const latestResearchClaimAllowed = input.routeCertificate.frontierClaimAllowed && input.researchFreshness.status === "current";
  const lowPowerClaimAllowed = input.objectiveCertificate.lowPowerReady &&
    input.routeCertificate.runtimeProfileClaimAllowed &&
    input.readiness.readyForUnattendedLocal &&
    input.powerHashEnvelope.status !== "blocked";
  const highHashClaimAllowed = input.objectiveCertificate.highHashReady &&
    input.routeCertificate.fullObjectiveClaimAllowed &&
    input.powerHashEnvelope.status !== "blocked";

  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    stage,
    currentAlgorithm: input.routeCertificate.defaultAlgorithm,
    runtimeStable: lowPowerClaimAllowed && stage !== "external_dry_run_only" && stage !== "runtime_recovery",
    lowPowerClaimAllowed,
    highHashClaimAllowed,
    fullObjectiveClaimAllowed: lowPowerClaimAllowed && highHashClaimAllowed,
    latestResearchClaimAllowed,
    externalMiningAllowed: false,
    evidenceScore: input.evidenceRoadmap.completionScore,
    objectiveProgressScore: input.objectiveCertificate.objectiveProgressScore,
    defaultDutyPercent: input.powerHashEnvelope.defaultDutyPercent,
    burstDutyPercent: input.powerHashEnvelope.burstDutyPercent,
    projectedAverageHashrate: input.powerHashEnvelope.projectedAverageHashrate,
    projectedAverageWatts: input.powerHashEnvelope.projectedAverageWatts,
    requiredEvidenceIds: requiredEvidenceIds(input, latestResearchClaimAllowed),
    guardrails: [
      "Production work remains consensus double SHA-256; prediction, nonce pruning, and proof-of-work compression stay forbidden.",
      "Default to the measured low-power density lane; high-hash is promoted only through measured local evidence.",
      "External engines remain dry-run/reference only until protocol, accounting, thermal, and release gates pass.",
    ],
    summary: summaryFor(input, stage, latestResearchClaimAllowed),
    nextStep: nextStepFor(input, stage, latestResearchClaimAllowed),
  };
}
import type { MiningAlgorithmPlan } from "./algorithmPlanner.js";
import type { AlgorithmObjectiveActionPlan } from "./algorithmObjectiveActionPlan.js";
import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmPowerHashEnvelopeSnapshot } from "./algorithmPowerHashEnvelope.js";

export type AlgorithmRouteCertificateStatus = "ready" | "partial" | "waiting" | "blocked" | "dry_run";
export type AlgorithmRouteProductionMode =
  | "collect_evidence"
  | "local_density_default"
  | "local_density_manual_burst"
  | "external_reference_only"
  | "external_dry_run_only"
  | "runtime_recovery";
export type AlgorithmRouteDefaultAlgorithm = "double_sha256_midstate" | "double_sha256_full_header" | "double_sha256_pending_midstate";

export interface AlgorithmRouteCertificateInput {
  plan: MiningAlgorithmPlan;
  objectiveCertificate: AlgorithmObjectiveCertificate;
  objectiveActionPlan: AlgorithmObjectiveActionPlan;
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot;
}

export interface AlgorithmRouteCertificate {
  schemaVersion: 1;
  objective: "lowest_power_high_hashrate";
  status: AlgorithmRouteCertificateStatus;
  productionMode: AlgorithmRouteProductionMode;
  defaultAlgorithm: AlgorithmRouteDefaultAlgorithm;
  consensusSafe: true;
  runtimeProfileClaimAllowed: boolean;
  fullObjectiveClaimAllowed: boolean;
  frontierClaimAllowed: boolean;
  externalMiningAllowed: false;
  localKernelMode: MiningAlgorithmPlan["algorithmStack"]["localKernel"]["mode"];
  defaultLaneId: MiningAlgorithmPlan["algorithmStack"]["defaultOperatingLane"]["id"];
  defaultLaneStatus: MiningAlgorithmPlan["algorithmStack"]["defaultOperatingLane"]["status"];
  highHashPath: MiningAlgorithmPlan["algorithmStack"]["highHashPath"];
  externalWorkPolicy: MiningAlgorithmPlan["algorithmStack"]["externalWorkPolicy"];
  powerEnvelopeMode: AlgorithmPowerHashEnvelopeSnapshot["mode"];
  objectiveProgressScore: number;
  evidenceRoadmapScore: number;
  lowPowerReady: boolean;
  highHashReady: boolean;
  missingEvidenceIds: string[];
  forbiddenShortcutIdeaIds: string[];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function defaultAlgorithm(plan: MiningAlgorithmPlan): AlgorithmRouteDefaultAlgorithm {
  switch (plan.algorithmStack.localKernel.mode) {
    case "midstate_reuse":
      return "double_sha256_midstate";
    case "midstate_blocked":
    case "midstate_regression":
      return "double_sha256_full_header";
    case "midstate_waiting":
      return "double_sha256_pending_midstate";
  }
}

function statusFor(
  plan: MiningAlgorithmPlan,
  certificate: AlgorithmObjectiveCertificate,
  envelope: AlgorithmPowerHashEnvelopeSnapshot,
): AlgorithmRouteCertificateStatus {
  if (certificate.status === "dry_run") {
    return "dry_run";
  }
  if (certificate.status === "blocked" || envelope.status === "blocked" || plan.algorithmStack.localKernel.status === "blocked") {
    return "blocked";
  }
  if (plan.algorithmStack.localKernel.mode === "midstate_waiting") {
    return certificate.lowPowerReady ? "partial" : "waiting";
  }
  return certificate.status;
}

function externalDryRunOwnsRoute(
  plan: MiningAlgorithmPlan,
  certificate: AlgorithmObjectiveCertificate,
  envelope: AlgorithmPowerHashEnvelopeSnapshot,
): boolean {
  return certificate.status === "dry_run" ||
    certificate.highHashPath === "external_dry_run" ||
    plan.algorithmStack.highHashPath === "external_dry_run" ||
    envelope.mode === "external_dry_run";
}

function productionMode(
  plan: MiningAlgorithmPlan,
  certificate: AlgorithmObjectiveCertificate,
  envelope: AlgorithmPowerHashEnvelopeSnapshot,
): AlgorithmRouteProductionMode {
  if (externalDryRunOwnsRoute(plan, certificate, envelope)) {
    return "external_dry_run_only";
  }
  if (certificate.status === "blocked" || envelope.status === "blocked") {
    return "runtime_recovery";
  }
  if (envelope.mode === "dominant_high_hash_density") {
    return "local_density_default";
  }
  if (certificate.lowPowerReady && certificate.highHashReady) {
    return "local_density_manual_burst";
  }
  if (certificate.lowPowerReady) {
    return plan.densityPlan.externalIsEfficiencyReference ? "external_reference_only" : "local_density_default";
  }
  return "collect_evidence";
}

function missingEvidence(input: AlgorithmRouteCertificateInput, status: AlgorithmRouteCertificateStatus) {
  const { plan, objectiveCertificate, powerHashEnvelope } = input;
  return unique([
    objectiveCertificate.lowPowerReady ? "" : "low_power_lane_evidence",
    objectiveCertificate.highHashReady ? "" : "high_hash_burst_evidence",
    objectiveCertificate.primaryEvidenceGap === "none" ? "" : objectiveCertificate.primaryEvidenceGap,
    powerHashEnvelope.status === "blocked" ? "runtime_power_hash_recovery" : "",
    plan.algorithmStack.localKernel.mode === "midstate_waiting" ? "midstate_benchmark_evidence" : "",
    plan.algorithmStack.localKernel.status === "blocked" ? "midstate_or_full_header_recovery" : "",
    plan.researchPromotionGate.frontierPromotionAllowed ? "" : "frontier_research_refresh",
    status === "dry_run" ? "external_work_validation" : "",
    plan.evidenceRoadmap.primaryPhase.status === "done" ? "" : plan.evidenceRoadmap.primaryPhase.id,
  ]);
}

function summaryFor(args: {
  status: AlgorithmRouteCertificateStatus;
  mode: AlgorithmRouteProductionMode;
  runtimeProfileClaimAllowed: boolean;
  fullObjectiveClaimAllowed: boolean;
  frontierClaimAllowed: boolean;
}) {
  if (args.status === "ready") {
    if (args.mode === "local_density_default") {
      return args.frontierClaimAllowed
        ? "Route certificate is ready: run the dominant measured density lane as the local default."
        : "Route certificate is runtime-ready for the dominant measured density lane, but frontier research must be refreshed before claiming any new latest-paper algorithm advantage.";
    }
    return args.frontierClaimAllowed
      ? "Route certificate is ready: run the local density lane by default and use verified high-hash only as a manual burst."
      : "Route certificate is runtime-ready, but frontier research must be refreshed before claiming any new latest-paper algorithm advantage.";
  }
  if (args.status === "dry_run") {
    return "Route certificate keeps external high-hash capacity in dry-run only; real external mining remains disabled.";
  }
  if (args.status === "blocked") {
    return "Route certificate is blocked by runtime, kernel, power, thermal, or share-quality evidence.";
  }
  if (args.runtimeProfileClaimAllowed) {
    return "Route certificate has a low-power runtime profile, but the full low-power plus high-hash objective still needs evidence.";
  }
  return `Route certificate is ${args.mode.replace(/_/g, " ")}; collect evidence before claiming the objective.`;
}

function nextStepFor(input: AlgorithmRouteCertificateInput, fullObjectiveClaimAllowed: boolean) {
  if (input.plan.algorithmStack.localKernel.mode === "midstate_waiting") {
    return input.plan.algorithmStack.localKernel.nextStep;
  }
  if (!fullObjectiveClaimAllowed) {
    return input.objectiveActionPlan.nextStep || input.objectiveCertificate.nextStep || input.plan.samplingPlan.nextStep;
  }
  if (!input.plan.researchPromotionGate.frontierPromotionAllowed) {
    return input.plan.researchPromotionGate.nextStep;
  }
  return input.powerHashEnvelope.nextStep || input.objectiveCertificate.nextStep;
}

export function deriveAlgorithmRouteCertificate(input: AlgorithmRouteCertificateInput): AlgorithmRouteCertificate {
  const { plan, objectiveCertificate, powerHashEnvelope } = input;
  const status = statusFor(plan, objectiveCertificate, powerHashEnvelope);
  const mode = productionMode(plan, objectiveCertificate, powerHashEnvelope);
  const externalDryRunRouteActive = externalDryRunOwnsRoute(plan, objectiveCertificate, powerHashEnvelope);
  const runtimeKernelClaimAllowed = defaultAlgorithm(plan) !== "double_sha256_pending_midstate";
  const runtimeProfileClaimAllowed = runtimeKernelClaimAllowed &&
    objectiveCertificate.consensusSafe &&
    objectiveCertificate.lowPowerReady &&
    plan.researchPromotionGate.runtimeProfilePromotionAllowed &&
    plan.algorithmStack.localKernel.status !== "blocked" &&
    powerHashEnvelope.status !== "blocked";
  const fullObjectiveClaimAllowed = runtimeProfileClaimAllowed &&
    objectiveCertificate.status === "ready" &&
    objectiveCertificate.highHashReady &&
    powerHashEnvelope.status !== "blocked" &&
    !externalDryRunRouteActive;
  const frontierClaimAllowed = plan.researchPromotionGate.frontierPromotionAllowed;
  const missingEvidenceIds = missingEvidence(input, status);

  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    status,
    productionMode: mode,
    defaultAlgorithm: defaultAlgorithm(plan),
    consensusSafe: true,
    runtimeProfileClaimAllowed,
    fullObjectiveClaimAllowed,
    frontierClaimAllowed,
    externalMiningAllowed: false,
    localKernelMode: plan.algorithmStack.localKernel.mode,
    defaultLaneId: plan.algorithmStack.defaultOperatingLane.id,
    defaultLaneStatus: plan.algorithmStack.defaultOperatingLane.status,
    highHashPath: plan.algorithmStack.highHashPath,
    externalWorkPolicy: plan.algorithmStack.externalWorkPolicy,
    powerEnvelopeMode: powerHashEnvelope.mode,
    objectiveProgressScore: objectiveCertificate.objectiveProgressScore,
    evidenceRoadmapScore: plan.evidenceRoadmap.completionScore,
    lowPowerReady: objectiveCertificate.lowPowerReady,
    highHashReady: objectiveCertificate.highHashReady,
    missingEvidenceIds,
    forbiddenShortcutIdeaIds: plan.algorithmStack.rejectedShortcutIdeaIds,
    guardrails: unique([
      "Keep Bitcoin proof-of-work as consensus double SHA-256.",
      "Use midstate reuse only as an equivalence-tested local implementation optimization.",
      "Treat prediction, nonce pruning, and proof-of-work compression as forbidden for pool-submitted work.",
      "Keep external hash engines dry-run or reference-only until release gates pass.",
      ...objectiveCertificate.guardrails,
    ]),
    summary: summaryFor({
      status,
      mode,
      runtimeProfileClaimAllowed,
      fullObjectiveClaimAllowed,
      frontierClaimAllowed,
    }),
    nextStep: nextStepFor(input, fullObjectiveClaimAllowed),
  };
}
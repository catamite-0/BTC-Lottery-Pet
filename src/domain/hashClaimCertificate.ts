import type { ExternalHashHistorySample } from "./externalHashHistory.js";
import type { TuningObservation } from "./efficiencyTuning.js";
import type { HashDensityMarginalDecision, HashDensityMarginalDecisionStatus } from "./hashDensityPlanner.js";
import type {
  OptimizationEvidenceSnapshot,
  OptimizationOperatingCandidate,
  OptimizationOperatingGoal,
} from "./optimizationEvidence.js";
import { createOptimizationEvidenceSnapshot } from "./optimizationEvidence.js";
import { OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES } from "./optimizationThresholds.js";
import { calculateStabilityWindow } from "./stabilityWindow.js";
import { calculateThermalGuard } from "./thermalGuard.js";

export type HashOptimizationClaimId = "lowest_power" | "highest_hash";
export type HashOptimizationClaimStatus = "missing" | "provisional" | "proven" | "blocked";
export type HashOptimizationClaimScope = "none" | "local" | "external_reference";
export type HashOptimizationHashrateBasis = "effective" | "raw_average" | "unknown";
export type HashClaimMarginalDecision = Pick<
  HashDensityMarginalDecision,
  "status" | "summary" | "nextStep" | "densityRetentionRatio"
>;
export type HashClaimNextAction =
  | "measure_power"
  | "collect_shares"
  | "run_stability_window"
  | "cooling"
  | "prove_external_work"
  | "collect_telemetry"
  | "release_gate"
  | "monitor"
  | "open_settings";

export interface HashOptimizationClaim {
  id: HashOptimizationClaimId;
  status: HashOptimizationClaimStatus;
  scope: HashOptimizationClaimScope;
  claimAllowed: boolean;
  candidateStepId: string | null;
  hashrate: number | null;
  rawHashrate: number | null;
  effectiveHashrate: number | null;
  hashrateBasis: HashOptimizationHashrateBasis;
  watts: number | null;
  joulesPerTerahash: number | null;
  evidenceScore: number;
  requiredReplications: number;
  observedReplications: number;
  marginalDecisionStatus: HashDensityMarginalDecisionStatus | null;
  marginalDensityRetentionRatio: number | null;
  missingEvidence: string[];
  summary: string;
  nextStep: string;
  nextAction: HashClaimNextAction;
}

export interface HashClaimCertificateInput {
  tuningObservations: TuningObservation[] | unknown;
  tuningHistory?: TuningObservation[] | unknown;
  externalHashHistory: ExternalHashHistorySample[] | unknown;
  externalEffectiveHashrate?: number | null;
  preferredGoal?: OptimizationOperatingGoal | null;
  externalWorkAssignable?: boolean | null;
  externalMiningStartAllowed?: boolean | null;
  marginalDecision?: HashClaimMarginalDecision | null;
  generatedAt?: string;
}

export interface HashClaimCertificate {
  schemaVersion: 1;
  generatedAt: string;
  privacyNote: string;
  lowestPower: HashOptimizationClaim;
  highestHash: HashOptimizationClaim;
  preferredGoal: OptimizationOperatingGoal;
  localQualifiedCandidateCount: number;
  externalEvidenceReady: boolean;
  externalWorkAssignable: boolean;
  externalMiningStartAllowed: boolean;
  marginalDecisionStatus: HashDensityMarginalDecisionStatus | null;
  marginalDensityRetentionRatio: number | null;
  summary: string;
  nextStep: string;
  nextAction: HashClaimNextAction;
}

const LOCAL_CLAIM_REQUIRED_REPLICATIONS = 2;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePreferredGoal(goal: OptimizationOperatingGoal | null | undefined): OptimizationOperatingGoal {
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

function claimLabel(id: HashOptimizationClaimId) {
  return id === "lowest_power" ? "Lowest-power" : "Highest-hash";
}

function localCandidate(
  snapshot: OptimizationEvidenceSnapshot,
  id: HashOptimizationClaimId,
): OptimizationOperatingCandidate | null {
  const goal = id === "lowest_power" ? "lowest_power" : "max_hashrate";
  return snapshot.operatingPlan.candidates.find((candidate) => candidate.goal === goal) ?? null;
}

function localMissingEvidence(candidate: OptimizationOperatingCandidate | null) {
  if (!candidate || candidate.status === "missing") {
    return ["matching local tuning sample"];
  }

  const missing: string[] = [];
  if (!candidate.measuredPower) {
    missing.push("measured watts");
  }
  if (candidate.totalShareEvents < 3) {
    missing.push("at least three useful share events");
  }
  if (candidate.sampleSeconds === null) {
    missing.push("timed runtime sample");
  } else if (candidate.sampleSeconds < candidate.requiredSampleSeconds) {
    missing.push("stable 15 minute runtime window");
  }
  if (candidate.stabilityWindowStatus !== "stable") {
    missing.push(`stable window is ${candidate.stabilityWindowStatus}`);
  }
  if (candidate.thermalStatus === "hot" || candidate.thermalStatus === "critical" || candidate.thermalStatus === "paused") {
    missing.push(`safe thermals, currently ${candidate.thermalStatus}`);
  }
  if (candidate.shareWasteRatio !== null && candidate.shareWasteRatio > 0.05) {
    missing.push("share waste below 5%");
  }
  return Array.from(new Set(missing));
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

function localHistorySampleComplete(observation: TuningObservation, candidate: OptimizationOperatingCandidate) {
  if (!candidate.stepId || observation.stepId !== candidate.stepId) {
    return false;
  }
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
    requiredSeconds: candidate.requiredSampleSeconds,
  });

  return observation.powerEvidenceStatus === "measured" &&
    finitePositive(observation.watts) &&
    finitePositive(observation.sampleSeconds) &&
    Number(observation.sampleSeconds) >= candidate.requiredSampleSeconds &&
    tuningShareEvents(observation) >= 3 &&
    (thermal.status === "cool" || thermal.status === "warm") &&
    stability.status === "stable";
}

function countLocalReplications(
  history: TuningObservation[] | unknown,
  candidate: OptimizationOperatingCandidate | null,
) {
  if (!candidate || !Array.isArray(history) || history.length === 0) {
    return 0;
  }
  const completeKeys = new Set<string>();
  history.forEach((observation, index) => {
    if (!localHistorySampleComplete(observation, candidate)) {
      return;
    }
    completeKeys.add(observation.capturedAt || `${observation.stepId}:${index}`);
  });
  return completeKeys.size;
}

function nextActionFromMissingEvidence(missingEvidence: string[]): HashClaimNextAction {
  const normalized = missingEvidence.map((item) => item.toLowerCase()).join(" ");

  if (normalized.includes("matching local tuning sample")) {
    return "open_settings";
  }
  if (normalized.includes("watt") || normalized.includes("power")) {
    return "measure_power";
  }
  if (normalized.includes("share")) {
    return "collect_shares";
  }
  if (normalized.includes("runtime") || normalized.includes("15 minute") || normalized.includes("stable window") || normalized.includes("independent same-profile")) {
    return "run_stability_window";
  }
  if (normalized.includes("thermal") || normalized.includes("cool")) {
    return "cooling";
  }
  if (normalized.includes("work assignment")) {
    return "prove_external_work";
  }
  if (normalized.includes("external efficiency") || normalized.includes("telemetry")) {
    return "collect_telemetry";
  }
  if (normalized.includes("release gate")) {
    return "release_gate";
  }
  return "open_settings";
}

function marginalDecisionClaimEvidence(decision: HashClaimMarginalDecision | null | undefined) {
  if (!decision) {
    return null;
  }

  switch (decision.status) {
    case "measure":
      return {
        status: "provisional" as const,
        missingEvidence: "marginal hashes per watt measurement",
        summary: decision.summary || "Marginal hash-density evidence is still waiting.",
        nextStep: decision.nextStep || "Measure marginal hashes per watt before calling the high-output profile highest-hash.",
        nextAction: "measure_power" as const,
      };
    case "hold":
      return {
        status: "blocked" as const,
        missingEvidence: "marginal hash-density decision is hold",
        summary: decision.summary || "Marginal hash density says the extra power is not worth the hashrate gain.",
        nextStep: decision.nextStep || "Keep the selected useful-hash density lane instead of promoting the high-output profile.",
        nextAction: "open_settings" as const,
      };
    case "cooldown":
      return {
        status: "blocked" as const,
        missingEvidence: "marginal hash-density cooldown",
        summary: decision.summary || "Marginal hash density is paused while the profile cools down.",
        nextStep: decision.nextStep || "Let the profile cool down and collect safe thermal evidence before retrying the high-output claim.",
        nextAction: "cooling" as const,
      };
    case "advance":
    case "none":
    default:
      return null;
  }
}

function localClaim(
  snapshot: OptimizationEvidenceSnapshot,
  id: HashOptimizationClaimId,
  tuningHistory?: TuningObservation[] | unknown,
  marginalDecision?: HashClaimMarginalDecision | null,
): HashOptimizationClaim {
  const candidate = localCandidate(snapshot, id);
  const baseMissingEvidence = localMissingEvidence(candidate);
  const baseStatus: HashOptimizationClaimStatus = !candidate || candidate.status === "missing"
    ? "missing"
    : candidate.status === "qualified"
      ? "proven"
      : "provisional";
  const marginalGate = id === "highest_hash" && candidate && candidate.status !== "missing"
    ? marginalDecisionClaimEvidence(marginalDecision)
    : null;
  const countedReplications = countLocalReplications(tuningHistory, candidate);
  const observedReplications = baseStatus === "proven"
    ? Math.max(1, countedReplications)
    : countedReplications;
  const replicationGap = Math.max(0, LOCAL_CLAIM_REQUIRED_REPLICATIONS - observedReplications);
  const replicationMissingEvidence = baseStatus === "proven" && replicationGap > 0
    ? [`${replicationGap} more independent same-profile sample${replicationGap === 1 ? "" : "s"}`]
    : [];
  const status: HashOptimizationClaimStatus = marginalGate?.status ?? (
    baseStatus === "proven" && replicationMissingEvidence.length > 0 ? "provisional" : baseStatus
  );
  const missingEvidence = marginalGate
    ? Array.from(new Set([...baseMissingEvidence, ...replicationMissingEvidence, marginalGate.missingEvidence]))
    : Array.from(new Set([...baseMissingEvidence, ...replicationMissingEvidence]));
  const label = claimLabel(id);
  const nextAction = status === "proven"
    ? "monitor"
    : marginalGate?.nextAction ?? nextActionFromMissingEvidence(missingEvidence);
  const rawHashrate = candidate?.rawHashrate ?? candidate?.hashrate ?? null;
  const effectiveHashrate = candidate?.effectiveHashrate ?? candidate?.hashrate ?? null;
  const hashrateBasis: HashOptimizationHashrateBasis = candidate && candidate.status !== "missing" ? "effective" : "unknown";

  return {
    id,
    status,
    scope: candidate && candidate.status !== "missing" ? "local" : "none",
    claimAllowed: status === "proven",
    candidateStepId: candidate?.stepId ?? null,
    hashrate: effectiveHashrate,
    rawHashrate,
    effectiveHashrate,
    hashrateBasis,
    watts: candidate?.watts ?? null,
    joulesPerTerahash: candidate?.joulesPerTerahash ?? null,
    evidenceScore: candidate?.score ?? 0,
    requiredReplications: candidate && candidate.status !== "missing" ? LOCAL_CLAIM_REQUIRED_REPLICATIONS : 0,
    observedReplications,
    marginalDecisionStatus: id === "highest_hash" ? marginalDecision?.status ?? null : null,
    marginalDensityRetentionRatio: id === "highest_hash" ? marginalDecision?.densityRetentionRatio ?? null : null,
    missingEvidence,
    summary: marginalGate
      ? `${label} local claim is ${status}: ${marginalGate.summary}.`
      : status === "proven"
        ? `${label} local claim is proven by measured power, share evidence, stable runtime, safe thermals, and repeated same-profile samples.`
        : baseStatus === "proven" && replicationMissingEvidence.length > 0
          ? `${label} local claim is provisional: ${observedReplications}/${LOCAL_CLAIM_REQUIRED_REPLICATIONS} complete independent samples.`
          : candidate
            ? `${label} local claim is ${status}: ${missingEvidence.join(", ") || "more comparison evidence needed"}.`
            : `${label} local claim is missing local tuning evidence.`,
    nextStep: status === "proven"
      ? "Keep collecting long-run evidence before changing the default operating profile."
      : marginalGate?.nextStep ?? candidate?.nextStep ?? "Capture local hashrate, watts, share counters, thermals, and runtime duration.",
    nextAction,
  };
}

function externalMissingEvidence(args: {
  stableEvidenceReady: boolean;
  externalStableGap: number;
  trend: string;
  externalWorkAssignable: boolean;
  effectiveHashrateMissing: boolean;
  externalMiningStartAllowed: boolean;
}) {
  const missing: string[] = [];
  if (!args.stableEvidenceReady) {
    missing.push(args.externalStableGap > 0
      ? `${args.externalStableGap} more stable external efficiency sample${args.externalStableGap === 1 ? "" : "s"}`
      : "stable external efficiency history");
  }
  if (args.trend === "degrading") {
    missing.push("non-degrading external efficiency trend");
  }
  if (!args.externalWorkAssignable) {
    missing.push("external work assignment");
  }
  if (args.effectiveHashrateMissing) {
    missing.push("external work assignment effective hashrate");
  }
  if (!args.externalMiningStartAllowed) {
    missing.push("external mining release gate");
  }
  return missing;
}
function externalStatus(args: {
  stableEvidenceReady: boolean;
  trend: string;
  externalWorkAssignable: boolean;
  effectiveHashrateMissing: boolean;
  externalMiningStartAllowed: boolean;
}): HashOptimizationClaimStatus {
  if (args.trend === "degrading") {
    return "blocked";
  }
  if (!args.externalWorkAssignable) {
    return "blocked";
  }
  if (args.effectiveHashrateMissing) {
    return "blocked";
  }
  if (!args.stableEvidenceReady) {
    return "provisional";
  }
  if (!args.externalMiningStartAllowed) {
    return "provisional";
  }
  return "proven";
}
function externalClaim(args: {
  id: HashOptimizationClaimId;
  snapshot: OptimizationEvidenceSnapshot;
  externalEffectiveHashrate: number | null | undefined;
  externalEffectiveHashrateRequired: boolean;
  externalWorkAssignable: boolean;
  externalMiningStartAllowed: boolean;
}): HashOptimizationClaim | null {
  const external = args.snapshot.externalHash;
  const rawExternalHashrate = finitePositive(external.averageHashrate) ? Number(external.averageHashrate) : null;
  const effectiveExternalHashrate = finitePositive(args.externalEffectiveHashrate) ? Number(args.externalEffectiveHashrate) : null;
  const externalHashrate = args.id === "highest_hash"
    ? effectiveExternalHashrate
    : effectiveExternalHashrate ?? rawExternalHashrate;
  const hasExternalHashrate = finitePositive(externalHashrate);
  const hasRawExternalHashrate = finitePositive(rawExternalHashrate);
  const hasExternalTelemetry = hasRawExternalHashrate || external.sampleCount > 0;
  const effectiveHashrateMissing = args.id === "highest_hash" && !hasExternalHashrate && hasExternalTelemetry;
  const hasExternalWatts = finitePositive(external.averageWatts);
  const hasExternalJoules = finitePositive(external.averageJoulesPerTerahash) || finitePositive(external.bestJoulesPerTerahash);
  const usableForClaim = args.id === "lowest_power"
    ? hasExternalWatts || hasExternalJoules
    : hasExternalHashrate || effectiveHashrateMissing;
  if (!usableForClaim) {
    return null;
  }

  const externalStableGap = Math.max(
    0,
    OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES - external.usableEfficiencySampleCount,
  );
  const stableEvidenceReady = external.externalEvidenceStatus === "stable" && external.trend !== "degrading";
  const status = externalStatus({
    stableEvidenceReady,
    trend: external.trend,
    externalWorkAssignable: args.externalWorkAssignable,
    effectiveHashrateMissing,
    externalMiningStartAllowed: args.externalMiningStartAllowed,
  });
  const missingEvidence = externalMissingEvidence({
    stableEvidenceReady,
    externalStableGap,
    trend: external.trend,
    externalWorkAssignable: args.externalWorkAssignable,
    effectiveHashrateMissing,
    externalMiningStartAllowed: args.externalMiningStartAllowed,
  });
  const label = claimLabel(args.id);
  const nextAction = status === "proven" ? "monitor" : nextActionFromMissingEvidence(missingEvidence);

  return {
    id: args.id,
    status,
    scope: "external_reference",
    claimAllowed: status === "proven",
    candidateStepId: null,
    hashrate: externalHashrate,
    rawHashrate: rawExternalHashrate,
    effectiveHashrate: effectiveExternalHashrate,
    hashrateBasis: hasExternalHashrate
      ? effectiveExternalHashrate !== null && externalHashrate === effectiveExternalHashrate ? "effective" : "raw_average"
      : "unknown",
    watts: external.averageWatts,
    joulesPerTerahash: external.averageJoulesPerTerahash ?? external.bestJoulesPerTerahash,
    evidenceScore: stableEvidenceReady
      ? 88
      : external.efficiencyEvidenceStatus === "ready"
        ? 65
        : external.sampleCount > 0 ? 45 : 0,
    requiredReplications: OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
    observedReplications: external.usableEfficiencySampleCount,
    marginalDecisionStatus: null,
    marginalDensityRetentionRatio: null,
    missingEvidence,
    summary: status === "proven"
      ? `${label} external claim is proven for an engine-enabled external adapter with stable non-degrading efficiency history.`
      : `${label} external reference is observed but not claimable for real app-controlled mining: ${missingEvidence.join(", ")}.`,
    nextStep: status === "proven"
      ? "Keep release-gated monitoring of external share quality, thermals, and power."
      : "Keep the device as telemetry/reference until external work assignment and release gates are proven.",
    nextAction,
  };
}

function betterLowestPower(external: HashOptimizationClaim, local: HashOptimizationClaim) {
  if (!finitePositive(external.watts)) {
    return false;
  }
  return !finitePositive(local.watts) || Number(external.watts) < Number(local.watts);
}

function betterHighestHash(external: HashOptimizationClaim, local: HashOptimizationClaim) {
  const externalComparableHashrate = finitePositive(external.hashrate)
    ? Number(external.hashrate)
    : finitePositive(external.rawHashrate)
      ? Number(external.rawHashrate)
      : null;
  if (!finitePositive(externalComparableHashrate)) {
    return false;
  }
  return !finitePositive(local.hashrate) || Number(externalComparableHashrate) > Number(local.hashrate) * 1.05;
}

function chooseClaim(local: HashOptimizationClaim, external: HashOptimizationClaim | null) {
  if (!external) {
    return local;
  }
  if (local.id === "lowest_power" && betterLowestPower(external, local)) {
    return external;
  }
  if (local.id === "highest_hash" && betterHighestHash(external, local)) {
    return external;
  }
  if (local.scope === "none" && external.scope !== "none") {
    return external;
  }
  return local;
}

function certificateNextStep(lowestPower: HashOptimizationClaim, highestHash: HashOptimizationClaim) {
  if (!lowestPower.claimAllowed) {
    return lowestPower.nextStep;
  }
  if (!highestHash.claimAllowed) {
    return highestHash.nextStep;
  }
  return "Both local low-power and high-hash claims are evidence-backed; keep long-run monitoring before packaging defaults.";
}

function certificateNextAction(lowestPower: HashOptimizationClaim, highestHash: HashOptimizationClaim): HashClaimNextAction {
  if (!lowestPower.claimAllowed) {
    return lowestPower.nextAction;
  }
  if (!highestHash.claimAllowed) {
    return highestHash.nextAction;
  }
  return "monitor";
}

export function createHashClaimCertificate(input: HashClaimCertificateInput): HashClaimCertificate {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const preferredGoal = normalizePreferredGoal(input.preferredGoal);
  const evidence = createOptimizationEvidenceSnapshot({
    tuningObservations: input.tuningObservations,
    externalHashHistory: input.externalHashHistory,
    preferredGoal,
    generatedAt,
  });
  const externalWorkAssignable = input.externalWorkAssignable === true;
  const externalMiningStartAllowed = input.externalMiningStartAllowed === true;
  const externalEffectiveHashrateRequired = Object.prototype.hasOwnProperty.call(input, "externalEffectiveHashrate");
  const marginalDecision = input.marginalDecision ?? null;
  const localLowestPower = localClaim(evidence, "lowest_power", input.tuningHistory);
  const localHighestHash = localClaim(evidence, "highest_hash", input.tuningHistory, marginalDecision);
  const externalLowestPower = externalClaim({
    id: "lowest_power",
    snapshot: evidence,
    externalEffectiveHashrate: input.externalEffectiveHashrate,
    externalEffectiveHashrateRequired,
    externalWorkAssignable,
    externalMiningStartAllowed,
  });
  const externalHighestHash = externalClaim({
    id: "highest_hash",
    snapshot: evidence,
    externalEffectiveHashrate: input.externalEffectiveHashrate,
    externalEffectiveHashrateRequired,
    externalWorkAssignable,
    externalMiningStartAllowed,
  });
  const lowestPower = chooseClaim(localLowestPower, externalLowestPower);
  const highestHash = chooseClaim(localHighestHash, externalHighestHash);
  const nextStep = certificateNextStep(lowestPower, highestHash);
  const nextAction = certificateNextAction(lowestPower, highestHash);

  return {
    schemaVersion: 1,
    generatedAt,
    privacyNote: "Hash claim certificate excludes raw endpoints, BTC address, pool password, webhook URL, and Stratum messages.",
    lowestPower,
    highestHash,
    preferredGoal,
    localQualifiedCandidateCount: evidence.operatingPlan.qualifiedCandidateCount,
    externalEvidenceReady: evidence.externalHash.efficiencyEvidenceStatus === "ready",
    externalWorkAssignable,
    externalMiningStartAllowed,
    marginalDecisionStatus: marginalDecision?.status ?? null,
    marginalDensityRetentionRatio: marginalDecision?.densityRetentionRatio ?? null,
    summary: `Hash claim certificate: lowest power ${lowestPower.status} (${lowestPower.scope}); highest hash ${highestHash.status} (${highestHash.scope}).`,
    nextStep,
    nextAction,
  };
}

export function formatHashClaimCertificate(certificate: HashClaimCertificate) {
  return JSON.stringify(certificate, null, 2);
}
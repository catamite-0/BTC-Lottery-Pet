import { calculateEfficiencySnapshot, formatJoulesPerTerahash } from "./efficiencyEngine.js";
import { estimateHashSearchSpacePlan, estimateHashWorkLeasePlan } from "./hashSearchSpace.js";
import type { HashSearchSpacePlan, HashWorkLeasePlan } from "./hashSearchSpace.js";

export type HashHardwareGoal = "lowest_power" | "max_efficiency" | "balanced" | "max_hashrate";
export type HashHardwareInterfaceKind = "network" | "direct" | "unknown";
export type HashHardwareCandidateStatus = "qualified" | "provisional" | "telemetry-only" | "reserved" | "blocked";

export interface HashHardwareCandidateSpec {
  id: string;
  label?: string | null;
  interfaceKind?: HashHardwareInterfaceKind | null;
  hashrate?: number | null;
  watts?: number | null;
  joulesPerTerahash?: number | null;
  supportsTelemetry?: boolean | null;
  supportsPowerTelemetry?: boolean | null;
  supportsJobControl?: boolean | null;
  supportsShareSubmission?: boolean | null;
  supportsVersionRolling?: boolean | null;
  supportsWorkPartitioning?: boolean | null;
  parallelWorkers?: number | null;
  targetJobSeconds?: number | null;
}

export interface HashHardwareCandidateAssessment {
  id: string;
  label: string;
  goal: HashHardwareGoal;
  status: HashHardwareCandidateStatus;
  score: number;
  hashrate: number;
  effectiveHashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  hashesPerJoule: number | null;
  efficiencyLabel: "waiting" | "unknown-power" | "pc-class" | "home-asic" | "industrial-asic";
  searchSpace: HashSearchSpacePlan;
  workLease: HashWorkLeasePlan;
  workLeaseUtilizationRatio: number | null;
  workLeaseUniquePartitionRatio: number | null;
  workLeaseRouteUtilizationRatio: number | null;
  hashWasteRisk: HashWorkLeasePlan["hashWasteRisk"];
  canReadTelemetry: boolean;
  canCompareEfficiency: boolean;
  canControlJobs: boolean;
  canSubmitShares: boolean;
  canRouteWork: boolean;
  miningStartAllowed: false;
  reasons: string[];
  riskFlags: string[];
  summary: string;
  nextStep: string;
}

const HASHES_PER_TH = 1_000_000_000_000;
const QUALIFIED_STATUS_SCORE = 100;
const PROVISIONAL_STATUS_SCORE = 68;
const TELEMETRY_ONLY_STATUS_SCORE = 58;
const RESERVED_STATUS_SCORE = 35;
const BLOCKED_STATUS_SCORE = 0;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function formatPercentRatio(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "waiting";
  }
  const bounded = Math.max(0, Math.min(1, value));
  return `${(bounded * 100).toFixed(bounded < 0.1 ? 2 : 1)}%`;
}

function statusScore(status: HashHardwareCandidateStatus) {
  switch (status) {
    case "qualified":
      return QUALIFIED_STATUS_SCORE;
    case "provisional":
      return PROVISIONAL_STATUS_SCORE;
    case "telemetry-only":
      return TELEMETRY_ONLY_STATUS_SCORE;
    case "reserved":
      return RESERVED_STATUS_SCORE;
    case "blocked":
      return BLOCKED_STATUS_SCORE;
  }
}

function statusCap(status: HashHardwareCandidateStatus) {
  switch (status) {
    case "qualified":
      return 100;
    case "provisional":
      return 80;
    case "telemetry-only":
      return 70;
    case "reserved":
      return 55;
    case "blocked":
      return 35;
  }
}

function hashWasteRiskCap(risk: HashWorkLeasePlan["hashWasteRisk"]) {
  switch (risk) {
    case "high":
      return 55;
    case "medium":
      return 85;
    default:
      return 100;
  }
}

function effectiveHashrateFromLease(hashrate: number, workLease: HashWorkLeasePlan) {
  if (!finitePositive(hashrate)) {
    return 0;
  }
  if (workLease.routeUtilizationRatio === null) {
    return hashrate;
  }
  return hashrate * Math.max(0, Math.min(1, workLease.routeUtilizationRatio));
}

function normalizeHashrate(spec: HashHardwareCandidateSpec) {
  return finitePositive(spec.hashrate) ? Number(spec.hashrate) : 0;
}

function normalizeWatts(spec: HashHardwareCandidateSpec, hashrate: number) {
  if (finitePositive(spec.watts)) {
    return Number(spec.watts);
  }
  if (finitePositive(spec.joulesPerTerahash) && hashrate > 0) {
    return Number(spec.joulesPerTerahash) * (hashrate / HASHES_PER_TH);
  }
  return null;
}

function normalizeJoulesPerTerahash(spec: HashHardwareCandidateSpec, hashrate: number, watts: number | null) {
  if (finitePositive(spec.joulesPerTerahash)) {
    return Number(spec.joulesPerTerahash);
  }
  if (hashrate > 0 && finitePositive(watts)) {
    return Number(watts) * HASHES_PER_TH / hashrate;
  }
  return null;
}

function routeJoulesPerTerahash(
  rawJoulesPerTerahash: number | null,
  effectiveHashrate: number,
  watts: number | null,
  leaseUtilizationRatio: number | null,
) {
  if (leaseUtilizationRatio === null) {
    return rawJoulesPerTerahash;
  }
  return finitePositive(watts) && finitePositive(effectiveHashrate)
    ? Number(watts) * HASHES_PER_TH / effectiveHashrate
    : rawJoulesPerTerahash;
}

function powerScore(watts: number | null) {
  if (!finitePositive(watts)) {
    return 20;
  }
  const value = Number(watts);
  if (value <= 20) {
    return 100;
  }
  if (value <= 100) {
    return 85 - ((value - 20) / 80) * 15;
  }
  if (value <= 1_000) {
    return 70 - ((value - 100) / 900) * 35;
  }
  return Math.max(5, 35 - Math.log10(value / 1_000 + 1) * 12);
}

function efficiencyScore(joulesPerTerahash: number | null) {
  if (!finitePositive(joulesPerTerahash)) {
    return 20;
  }
  const value = Number(joulesPerTerahash);
  if (value <= 15) {
    return 100;
  }
  if (value <= 25) {
    return 94 - ((value - 15) / 10) * 12;
  }
  if (value <= 80) {
    return 82 - ((value - 25) / 55) * 38;
  }
  return Math.max(5, 44 - Math.log10(value / 80 + 1) * 18);
}

function hashrateScore(hashrate: number) {
  if (!finitePositive(hashrate)) {
    return 0;
  }
  const ths = hashrate / HASHES_PER_TH;
  return clampScore(Math.log10(ths + 1) / Math.log10(500 + 1) * 100);
}

function goalScore(goal: HashHardwareGoal, scores: { power: number; efficiency: number; hashrate: number; readiness: number }) {
  switch (goal) {
    case "lowest_power":
      return scores.power * 0.38 + scores.efficiency * 0.32 + scores.hashrate * 0.10 + scores.readiness * 0.20;
    case "max_efficiency":
      return scores.efficiency * 0.42 + scores.power * 0.18 + scores.hashrate * 0.20 + scores.readiness * 0.20;
    case "max_hashrate":
      return scores.hashrate * 0.46 + scores.efficiency * 0.18 + scores.power * 0.12 + scores.readiness * 0.24;
    case "balanced":
      return scores.efficiency * 0.30 + scores.power * 0.23 + scores.hashrate * 0.23 + scores.readiness * 0.24;
  }
}

function candidateStatus(args: {
  interfaceKind: HashHardwareInterfaceKind;
  hashrate: number;
  effectiveHashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  canReadTelemetry: boolean;
  canCompareEfficiency: boolean;
  canControlJobs: boolean;
  canSubmitShares: boolean;
  searchSpace: HashSearchSpacePlan;
  workLease: HashWorkLeasePlan;
}): HashHardwareCandidateStatus {
  if (args.interfaceKind === "direct") {
    return "reserved";
  }
  if (!finitePositive(args.hashrate)) {
    return "blocked";
  }
  if (!finitePositive(args.watts) || !finitePositive(args.joulesPerTerahash) || !args.canCompareEfficiency) {
    return "provisional";
  }
  if (!args.canReadTelemetry || !args.canControlJobs || !args.canSubmitShares) {
    return "telemetry-only";
  }
  if (
    args.searchSpace.status === "insufficient" ||
    args.workLease.status === "insufficient" ||
    args.workLease.status === "overlap-risk" ||
    args.workLease.hashWasteRisk === "high"
  ) {
    return "provisional";
  }
  return "qualified";
}

function summarizeStatus(status: HashHardwareCandidateStatus) {
  switch (status) {
    case "qualified":
      return "ready as a hardware candidate after normal release review";
    case "provisional":
      return "provisional until missing power, protocol, or search-space evidence is proven";
    case "telemetry-only":
      return "usable as a telemetry reference but not a job-control engine";
    case "reserved":
      return "reserved until the Direct hardware protocol is selected and tested";
    case "blocked":
      return "blocked until hashrate and basic device evidence exist";
  }
}

function nextStepFor(status: HashHardwareCandidateStatus, riskFlags: string[]) {
  if (status === "blocked") {
    return "Add a measured or vendor-stated SHA-256 hashrate before evaluating this hardware route.";
  }
  if (status === "reserved") {
    return "Choose and test the Direct endpoint protocol with read-only endpoint access before telemetry or job control.";
  }
  if (riskFlags.some((risk) => /power/i.test(risk))) {
    return "Get measured watts or reliable device power telemetry before treating this as a low-power route.";
  }
  if (riskFlags.some((risk) => /version rolling/i.test(risk))) {
    return "Prove BIP320/BIP323/SV2 version rolling before using this candidate for high-hash routing.";
  }
  if (riskFlags.some((risk) => /work partitioning|lease|hash waste/i.test(risk))) {
    return "Prove unique extranonce, SV2 extended jobs, or equivalent work partitioning before assigning real workers.";
  }
  if (status === "telemetry-only") {
    return "Keep this candidate as a telemetry reference until job control and share submission are validated.";
  }
  if (status === "provisional") {
    return "Collect the missing efficiency and protocol evidence, then rerun candidate scoring.";
  }
  return "Run hardware validation and release review before wiring this candidate into a real MiningEngine.";
}

function riskFlagsFor(args: {
  interfaceKind: HashHardwareInterfaceKind;
  hashrate: number;
  effectiveHashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  canReadTelemetry: boolean;
  canCompareEfficiency: boolean;
  canControlJobs: boolean;
  canSubmitShares: boolean;
  searchSpace: HashSearchSpacePlan;
  workLease: HashWorkLeasePlan;
}) {
  const risks: string[] = [];
  if (!finitePositive(args.hashrate)) {
    risks.push("Hashrate is missing; candidate cannot be ranked for BTC SHA-256 work.");
  }
  if (!finitePositive(args.watts) || !finitePositive(args.joulesPerTerahash)) {
    risks.push("Power or J/TH evidence is missing; lowest-power and efficiency claims are provisional.");
  }
  if (args.interfaceKind === "direct") {
    risks.push("Direct protocol is reserved until endpoint access and framing are proven.");
  }
  if (!args.canReadTelemetry) {
    risks.push("Telemetry support is missing; the app cannot verify live hashrate or temperature.");
  }
  if (!args.canControlJobs || !args.canSubmitShares) {
    risks.push("Job control or share submission is missing; candidate cannot be a real external MiningEngine yet.");
  }
  if (args.searchSpace.requiresVersionRolling) {
    risks.push("Version rolling is required because nonce-only search space is too short for this hashrate.");
  }
  if (args.searchSpace.requiresExtranonce || args.workLease.requiresWorkPartitioning) {
    risks.push("Work partitioning is required before high-hash workers can receive unique leases.");
  }
  if (args.workLease.overlapRisk === "high") {
    risks.push("Work lease overlap risk is high; parallel workers could duplicate work.");
  }
  if (args.workLease.uniquePartitionRatio !== null && args.workLease.uniquePartitionRatio < 1) {
    risks.push(`Route utilization is limited by partition overlap; only ${formatPercentRatio(args.workLease.uniquePartitionRatio)} of parallel work is unique.`);
  }
  if (args.workLease.hashWasteRisk === "high") {
    risks.push("Hash waste risk is high; assigned search space would exhaust too quickly for useful high-hash routing.");
  } else if (args.workLease.hashWasteRisk === "medium") {
    risks.push("Hash waste risk is medium; lease utilization is tight and should be improved before default routing.");
  }
  return risks;
}

export function assessHashHardwareCandidate(
  spec: HashHardwareCandidateSpec,
  goal: HashHardwareGoal = "balanced",
): HashHardwareCandidateAssessment {
  const hashrate = normalizeHashrate(spec);
  const watts = normalizeWatts(spec, hashrate);
  const rawJoulesPerTerahash = normalizeJoulesPerTerahash(spec, hashrate, watts);
  const interfaceKind = spec.interfaceKind ?? "unknown";
  const canReadTelemetry = spec.supportsTelemetry === true;
  const canControlJobs = spec.supportsJobControl === true;
  const canSubmitShares = spec.supportsShareSubmission === true;
  const versionRollingBits = spec.supportsVersionRolling === true ? 16 : 0;
  const extranonceBytes = spec.supportsWorkPartitioning === true ? 2 : 0;
  const parallelWorkers = finitePositive(spec.parallelWorkers) ? Number(spec.parallelWorkers) : 1;
  const targetJobSeconds = finitePositive(spec.targetJobSeconds) ? Number(spec.targetJobSeconds) : 1;
  const searchSpace = estimateHashSearchSpacePlan({
    hashrate,
    targetJobSeconds,
    versionRollingBits,
    extranonceBytes,
  });
  const workLease = estimateHashWorkLeasePlan({
    hashrate,
    targetJobSeconds,
    versionRollingBits,
    extranonceBytes,
    parallelWorkers,
  });
  const effectiveHashrate = effectiveHashrateFromLease(hashrate, workLease);
  const shouldPriceRouteLease = canControlJobs && canSubmitShares;
  const joulesPerTerahash = routeJoulesPerTerahash(
    rawJoulesPerTerahash,
    effectiveHashrate,
    watts,
    shouldPriceRouteLease ? workLease.routeUtilizationRatio : null,
  );
  const snapshot = calculateEfficiencySnapshot({
    mode: "asic",
    hashrate: effectiveHashrate,
    watts,
    deviceName: spec.label ?? spec.id,
  });
  const canCompareEfficiency = canReadTelemetry && spec.supportsPowerTelemetry === true && finitePositive(joulesPerTerahash);
  const riskFlags = riskFlagsFor({
    interfaceKind,
    hashrate,
    effectiveHashrate,
    watts,
    joulesPerTerahash,
    canReadTelemetry,
    canCompareEfficiency,
    canControlJobs,
    canSubmitShares,
    searchSpace,
    workLease,
  });
  const status = candidateStatus({
    interfaceKind,
    hashrate,
    effectiveHashrate,
    watts,
    joulesPerTerahash,
    canReadTelemetry,
    canCompareEfficiency,
    canControlJobs,
    canSubmitShares,
    searchSpace,
    workLease,
  });
  const rawScore = goalScore(goal, {
    power: powerScore(watts),
    efficiency: efficiencyScore(joulesPerTerahash),
    hashrate: hashrateScore(effectiveHashrate),
    readiness: statusScore(status),
  });
  const score = Math.min(statusCap(status), hashWasteRiskCap(workLease.hashWasteRisk), clampScore(rawScore));
  const canRouteWork = status === "qualified";
  const label = spec.label || spec.id;
  const summary = `${label}: ${summarizeStatus(status)}; ${formatJoulesPerTerahash(joulesPerTerahash)} at ${watts === null ? "unknown watts" : `${watts.toFixed(watts < 100 ? 1 : 0)} W`}.`;

  return {
    id: spec.id,
    label,
    goal,
    status,
    score,
    hashrate,
    effectiveHashrate,
    watts,
    joulesPerTerahash,
    hashesPerJoule: snapshot.hashesPerJoule,
    efficiencyLabel: snapshot.efficiencyLabel,
    searchSpace,
    workLease,
    workLeaseUtilizationRatio: workLease.routeUtilizationRatio,
    workLeaseUniquePartitionRatio: workLease.uniquePartitionRatio,
    workLeaseRouteUtilizationRatio: workLease.routeUtilizationRatio,
    hashWasteRisk: workLease.hashWasteRisk,
    canReadTelemetry,
    canCompareEfficiency,
    canControlJobs,
    canSubmitShares,
    canRouteWork,
    miningStartAllowed: false,
    reasons: [
      `Goal ${goal.replace(/_/g, " ")} score ${score}/100.`,
      `Effective hashrate score uses ${effectiveHashrate.toFixed(0)} H/s after route utilization.`,
      `Route utilization combines lease window ${formatPercentRatio(workLease.leaseUtilizationRatio)} and unique partition ${formatPercentRatio(workLease.uniquePartitionRatio)} into ${formatPercentRatio(workLease.routeUtilizationRatio)} effective work.`,
      searchSpace.summary,
      workLease.summary,
    ],
    riskFlags,
    summary,
    nextStep: nextStepFor(status, riskFlags),
  };
}

export function rankHashHardwareCandidates(
  specs: HashHardwareCandidateSpec[],
  goal: HashHardwareGoal = "balanced",
): HashHardwareCandidateAssessment[] {
  return specs
    .map((spec) => assessHashHardwareCandidate(spec, goal))
    .sort((left, right) => right.score - left.score || right.hashrate - left.hashrate || left.label.localeCompare(right.label));
}
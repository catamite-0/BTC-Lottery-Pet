import type { TuningAnalysis, TuningObservationResult } from "./efficiencyTuning.js";
import {
  selectPowerBudgetTuningResult,
  selectPowerDensityTuningResult,
} from "./efficiencyTuning.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import type { ExternalHashSnapshot } from "./externalHashInterface.js";
import type { HashHardwareCandidateAssessment } from "./hashHardwareAdvisor.js";
import type { ExternalHashWorkAdapterPlan } from "../engines/externalHashWorkAdapter.js";

const HASHES_PER_TH = 1_000_000_000_000;

export type HashDensityPlanStrategy =
  | "collect_evidence"
  | "local_power_budget"
  | "external_telemetry_reference"
  | "external_dry_run"
  | "direct_reserved";

export type HashDensityPowerBudgetSource = "explicit" | "frontier_knee" | "eco_boost" | "lowest_power" | "unknown";

export type HashDensityLaneId =
  | "local_lowest_power"
  | "local_power_budget"
  | "local_best_efficiency"
  | "local_max_hashrate"
  | "external_reference"
  | "external_hardware";

export type HashDensityLaneSource = "local" | "external";
export type HashDensityLaneStatus = "ready" | "waiting" | "blocked" | "reserved" | "dry-run";
export type HashDensityHeadroomStatus = "none" | "available" | "waiting" | "unsafe";
export type HashDensityMarginalDecisionStatus = "none" | "advance" | "hold" | "measure" | "cooldown";
export type HashDensityEvidenceGateId =
  | "power_budget"
  | "measured_power"
  | "share_quality"
  | "stability_window"
  | "thermal_safety"
  | "external_efficiency_history"
  | "external_work_assignment"
  | "direct_protocol";
export type HashDensityEvidenceGateStatus = "passed" | "waiting" | "blocked" | "reserved";

export interface HashDensityEvidenceGate {
  id: HashDensityEvidenceGateId;
  status: HashDensityEvidenceGateStatus;
  requiredForLongRun: boolean;
  summary: string;
  nextStep: string;
}

export interface HashDensityLane {
  id: HashDensityLaneId;
  source: HashDensityLaneSource;
  status: HashDensityLaneStatus;
  label: string;
  hashrate: number | null;
  watts: number | null;
  joulesPerTerahash: number | null;
  hashesPerWatt: number | null;
  qualityScore: number | null;
  score: number;
  summary: string;
  nextStep: string;
}

export interface HashDensityHeadroom {
  status: HashDensityHeadroomStatus;
  laneId: HashDensityLaneId | null;
  extraHashrate: number | null;
  extraWatts: number | null;
  hashGainRatio: number | null;
  wattIncreaseRatio: number | null;
  summary: string;
  nextStep: string;
}

export interface HashDensityMarginalDecision {
  status: HashDensityMarginalDecisionStatus;
  fromLaneId: HashDensityLaneId | null;
  targetLaneId: HashDensityLaneId | null;
  extraHashrate: number | null;
  extraWatts: number | null;
  baselineHashesPerWatt: number | null;
  marginalHashesPerWatt: number | null;
  densityRetentionRatio: number | null;
  summary: string;
  nextStep: string;
}

export interface HashDensityPlanInput {
  tuningAnalysis: TuningAnalysis;
  externalHistory: ExternalHashHistorySummary;
  externalSnapshot: ExternalHashSnapshot;
  externalWorkAdapterPlan: ExternalHashWorkAdapterPlan;
  hardwareCandidate: HashHardwareCandidateAssessment;
  powerBudgetWatts?: number | null;
}

export interface HashDensityPlan {
  strategy: HashDensityPlanStrategy;
  selectedLane: HashDensityLane;
  lanes: HashDensityLane[];
  powerBudgetWatts: number | null;
  powerBudgetSource: HashDensityPowerBudgetSource;
  powerBudgetSummary: string;
  hashrateHeadroom: HashDensityHeadroom;
  marginalDecision: HashDensityMarginalDecision;
  externalIsEfficiencyReference: boolean;
  externalDryRunOnly: boolean;
  miningStartAllowed: false;
  evidenceGates: HashDensityEvidenceGate[];
  readinessScore: number;
  readyForLongRun: boolean;
  primaryMissingGate: HashDensityEvidenceGate | null;
  summary: string;
  nextStep: string;
  riskFlags: string[];
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function hashesPerWatt(hashrate: number | null, watts: number | null) {
  return finitePositive(hashrate) && finitePositive(watts)
    ? Number(hashrate) / Number(watts)
    : null;
}

function joulesPerTerahashFrom(hashrate: number | null, watts: number | null | undefined) {
  return finitePositive(hashrate) && finitePositive(watts)
    ? Number(watts) * HASHES_PER_TH / Number(hashrate)
    : null;
}

function clampUtilizationRatio(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.max(0, Math.min(1, value))
    : null;
}

function effectiveExternalHashrate(hashrate: number | null, plan: ExternalHashWorkAdapterPlan) {
  if (!finitePositive(hashrate)) {
    return null;
  }
  const utilizationRatio = clampUtilizationRatio(plan.workLeaseUtilizationRatio);
  return utilizationRatio === null ? Number(hashrate) : Number(hashrate) * utilizationRatio;
}

interface HashDensityPowerBudgetTarget {
  watts: number | null;
  source: HashDensityPowerBudgetSource;
  result: TuningObservationResult | null;
  summary: string;
}

function measuredFrontierCandidates(input: HashDensityPlanInput) {
  const source = input.tuningAnalysis.paretoFrontier.length > 0
    ? input.tuningAnalysis.paretoFrontier
    : input.tuningAnalysis.results;

  return source
    .filter((result) => (
      finitePositive(result.watts) &&
      finitePositive(result.qualityAdjustedHashrate) &&
      result.powerEvidenceStatus === "measured" &&
      result.longRunRisk !== "avoid"
    ))
    .slice()
    .sort((left, right) => Number(left.watts) - Number(right.watts) ||
      right.qualityAdjustedHashrate - left.qualityAdjustedHashrate);
}

function derivePowerBudgetTarget(input: HashDensityPlanInput): HashDensityPowerBudgetTarget {
  if (finitePositive(input.powerBudgetWatts)) {
    const watts = Number(input.powerBudgetWatts);
    return {
      watts,
      source: "explicit",
      result: null,
      summary: `Explicit power budget ${watts.toFixed(watts < 100 ? 1 : 0)} W.`,
    };
  }

  const knee = input.tuningAnalysis.powerDensityKnee ?? selectPowerDensityTuningResult(measuredFrontierCandidates(input));
  if (knee && finitePositive(knee.watts)) {
    const watts = Number(knee.watts);
    return {
      watts,
      source: "frontier_knee",
      result: knee,
      summary: input.tuningAnalysis.powerDensityKneeSummary ||
        `Measured frontier knee selects ${knee.step.summary} at ${watts.toFixed(watts < 100 ? 1 : 0)} W.`,
    };
  }

  const lowestWatts = input.tuningAnalysis.lowestPower?.watts ?? null;
  const bestHashWatts = input.tuningAnalysis.bestHashrate?.watts ?? null;
  if (!finitePositive(lowestWatts)) {
    return {
      watts: null,
      source: "unknown",
      result: null,
      summary: "Power budget is waiting for a measured local power sample.",
    };
  }

  if (!finitePositive(bestHashWatts)) {
    const watts = Number(lowestWatts);
    return {
      watts,
      source: "lowest_power",
      result: input.tuningAnalysis.lowestPower,
      summary: `Only the lowest-power local profile has watt evidence, so the budget stays at ${watts.toFixed(watts < 100 ? 1 : 0)} W.`,
    };
  }

  const ecoBoostBudget = Number(lowestWatts) * 2;
  const watts = Math.min(Number(bestHashWatts), ecoBoostBudget);
  return {
    watts,
    source: "eco_boost",
    result: null,
    summary: `Fallback eco-boost budget caps local power at ${watts.toFixed(watts < 100 ? 1 : 0)} W.`,
  };
}

function localLaneEvidenceReady(result: TuningObservationResult) {
  return result.powerEvidenceStatus === "measured" &&
    result.shareEvidenceStatus === "proven" &&
    result.stabilityWindowStatus === "stable" &&
    result.thermalStatus !== "hot" &&
    result.thermalStatus !== "critical" &&
    result.thermalStatus !== "paused" &&
    (result.longRunRisk === "excellent" || result.longRunRisk === "good");
}

function localLaneEvidenceBlocked(result: TuningObservationResult) {
  return result.longRunRisk === "avoid" ||
    result.stabilityWindowStatus === "unsafe" ||
    result.stabilityWindowStatus === "unstable" ||
    result.thermalStatus === "hot" ||
    result.thermalStatus === "critical" ||
    result.thermalStatus === "paused";
}
function localLane(
  id: HashDensityLaneId,
  label: string,
  result: TuningObservationResult | null,
): HashDensityLane {
  if (!result) {
    return {
      id,
      source: "local",
      status: "waiting",
      label,
      hashrate: null,
      watts: null,
      joulesPerTerahash: null,
      hashesPerWatt: null,
      qualityScore: null,
      score: 0,
      summary: `${label} is waiting for a measured local tuning sample.`,
      nextStep: "Capture hashrate, share counters, thermal state, and measured or estimated watts.",
    };
  }

  const hasPower = finitePositive(result.watts);
  const status: HashDensityLaneStatus = localLaneEvidenceReady(result)
    ? "ready"
    : localLaneEvidenceBlocked(result)
      ? "blocked"
      : "waiting";
  const hpw = hashesPerWatt(result.qualityAdjustedHashrate, result.watts);
  const quality = result.qualityScore ?? 0;
  const score = Math.round(Math.max(0, Math.min(100,
    quality * 65 +
    (result.longRunScore ?? 0) * 0.25 +
    (result.powerEvidenceStatus === "measured" ? 10 : 3),
  )));

  return {
    id,
    source: "local",
    status,
    label: result.step.summary,
    hashrate: result.qualityAdjustedHashrate,
    watts: result.watts,
    joulesPerTerahash: result.qualityAdjustedJoulesPerTerahash,
    hashesPerWatt: hpw,
    qualityScore: quality,
    score,
    summary: `${label}: ${Math.round(result.qualityAdjustedHashrate).toLocaleString("en-US")} quality H/s at ${hasPower ? `${Number(result.watts).toFixed(Number(result.watts) < 100 ? 1 : 0)} W` : "unknown watts"}.`,
    nextStep: status === "ready"
      ? "Eligible for the local power-density envelope."
      : status === "blocked"
        ? "Lower intensity, improve cooling, or wait for a safer stable sample before using this lane."
        : "Add measured watts, proven share evidence, safe thermals, and a stable window before trusting this lane.",
  };
}

function externalLaneFromHistory(input: HashDensityPlanInput): HashDensityLane {
  const rawHashrate = input.externalSnapshot.hashrate || input.externalHistory.averageHashrate || null;
  const utilizationRatio = clampUtilizationRatio(input.externalWorkAdapterPlan.workLeaseUtilizationRatio);
  const hashrate = effectiveExternalHashrate(rawHashrate, input.externalWorkAdapterPlan);
  const watts = input.externalSnapshot.watts ?? input.externalHistory.averageWatts;
  const rawJoules = input.externalSnapshot.joulesPerTerahash ??
    input.externalHistory.averageJoulesPerTerahash ??
    input.externalHistory.bestJoulesPerTerahash;
  const routeJoules = utilizationRatio === null ? null : joulesPerTerahashFrom(hashrate, watts);
  const joules = routeJoules ?? rawJoules;
  const canCompare = input.externalHistory.evidenceReady && input.externalHistory.trend !== "degrading" && finitePositive(joules);
  const canDryRun = input.externalWorkAdapterPlan.canAssignWork;
  const status: HashDensityLaneStatus = canDryRun ? "dry-run" : canCompare ? "blocked" : "waiting";
  const hpw = hashesPerWatt(hashrate, watts);
  const efficiencyScore = finitePositive(joules)
    ? Math.max(0, Math.min(100, 100 - Math.log10(Number(joules) + 1) * 22))
    : 0;

  return {
    id: "external_reference",
    source: "external",
    status,
    label: input.externalSnapshot.label || "External Reference",
    hashrate,
    watts,
    joulesPerTerahash: joules,
    hashesPerWatt: hpw,
    qualityScore: canCompare ? 0.82 : null,
    score: Math.round(Math.max(0, Math.min(100, efficiencyScore + (canDryRun ? 12 : canCompare ? 4 : 0)))),
    summary: canDryRun
      ? "External reference is dry-run assignable, but real mining start remains blocked."
      : canCompare
        ? "External reference has usable efficiency evidence, but work assignment remains blocked."
        : "External reference is waiting for stable hashrate, watts, and J/TH history.",
    nextStep: canDryRun
      ? input.externalWorkAdapterPlan.nextStep
      : canCompare
        ? "Keep local mining active and use external telemetry as the efficiency benchmark until job control and share submission are proven."
        : "Collect at least three usable cool/warm external efficiency samples before comparing density.",
  };
}

function externalHardwareLane(input: HashDensityPlanInput): HashDensityLane {
  const candidate = input.hardwareCandidate;
  const status: HashDensityLaneStatus = candidate.status === "qualified"
    ? "dry-run"
    : candidate.status === "reserved"
      ? "reserved"
      : candidate.status === "blocked"
        ? "blocked"
        : candidate.status === "telemetry-only" || candidate.status === "provisional"
          ? "blocked"
          : "waiting";
  const candidateHashrate = candidate.effectiveHashrate || candidate.hashrate || null;
  const hpw = hashesPerWatt(candidateHashrate, candidate.watts);

  return {
    id: "external_hardware",
    source: "external",
    status,
    label: candidate.label,
    hashrate: candidateHashrate,
    watts: candidate.watts,
    joulesPerTerahash: candidate.joulesPerTerahash,
    hashesPerWatt: hpw,
    qualityScore: null,
    score: candidate.score,
    summary: candidate.summary,
    nextStep: candidate.nextStep,
  };
}

function laneRank(lane: HashDensityLane) {
  if (lane.status === "reserved" || lane.status === "blocked") {
    return -1;
  }
  if (!finitePositive(lane.hashrate)) {
    return 0;
  }
  const efficiency = finitePositive(lane.joulesPerTerahash)
    ? Math.max(0, 120 - Number(lane.joulesPerTerahash))
    : 15;
  const hashScale = Math.log10(Number(lane.hashrate) / HASHES_PER_TH + 1) * 20;
  const statusBonus = lane.status === "ready" ? 16 : lane.status === "dry-run" ? 10 : 0;
  return lane.score + efficiency + hashScale + statusBonus;
}

function bestLane(lanes: HashDensityLane[]) {
  return lanes
    .slice()
    .sort((left, right) => laneRank(right) - laneRank(left) || right.score - left.score)[0] ?? lanes[0];
}

function defaultWaitingLane(): HashDensityLane {
  return {
    id: "local_power_budget",
    source: "local",
    status: "waiting",
    label: "Power-density plan",
    hashrate: null,
    watts: null,
    joulesPerTerahash: null,
    hashesPerWatt: null,
    qualityScore: null,
    score: 0,
    summary: "Power-density plan is waiting for local tuning or external telemetry evidence.",
    nextStep: "Capture at least one local tuning sample with hashrate and power evidence.",
  };
}

function evidenceGate(args: HashDensityEvidenceGate): HashDensityEvidenceGate {
  return args;
}

function evidenceGatePassed(status: HashDensityEvidenceGateStatus) {
  return status === "passed";
}

function selectedLocalResult(
  input: HashDensityPlanInput,
  budgetResult: TuningObservationResult | null,
  laneId: HashDensityLaneId,
) {
  switch (laneId) {
    case "local_lowest_power":
      return input.tuningAnalysis.lowestPower;
    case "local_power_budget":
      return budgetResult;
    case "local_best_efficiency":
      return input.tuningAnalysis.bestEfficiency;
    case "local_max_hashrate":
      return input.tuningAnalysis.bestHashrate;
    default:
      return null;
  }
}
function formatHashrateText(hashrate: number | null) {
  return finitePositive(hashrate)
    ? `${Math.round(Number(hashrate)).toLocaleString("en-US")} H/s`
    : "unknown H/s";
}

function deriveHashrateHeadroom(args: {
  selectedLane: HashDensityLane;
  maxHashLane: HashDensityLane;
  maxHashResult: TuningObservationResult | null;
}): HashDensityHeadroom {
  const { selectedLane, maxHashLane, maxHashResult } = args;
  if (selectedLane.source !== "local") {
    return {
      status: "none",
      laneId: null,
      extraHashrate: null,
      extraWatts: null,
      hashGainRatio: null,
      wattIncreaseRatio: null,
      summary: "Local hashrate headroom is not selected while external or Direct evidence is active.",
      nextStep: "Resolve the external evidence gate before comparing local surge headroom.",
    };
  }

  if (!maxHashResult || !finitePositive(selectedLane.hashrate) || !finitePositive(selectedLane.watts) || !finitePositive(maxHashLane.hashrate) || !finitePositive(maxHashLane.watts)) {
    return {
      status: "waiting",
      laneId: maxHashLane.id,
      extraHashrate: null,
      extraWatts: null,
      hashGainRatio: null,
      wattIncreaseRatio: null,
      summary: "Local hashrate headroom is waiting for measured budget and max-hash samples.",
      nextStep: "Capture measured watts, share quality, thermals, and a stable window for the max-hash profile.",
    };
  }

  const extraHashrate = Number(maxHashLane.hashrate) - Number(selectedLane.hashrate);
  const extraWatts = Number(maxHashLane.watts) - Number(selectedLane.watts);
  if (extraHashrate <= 0 || extraWatts <= 0) {
    return {
      status: "none",
      laneId: maxHashLane.id,
      extraHashrate: Math.max(0, extraHashrate),
      extraWatts: Math.max(0, extraWatts),
      hashGainRatio: null,
      wattIncreaseRatio: null,
      summary: "Max-hash profile does not add useful local headroom above the selected power-budget lane.",
      nextStep: "Keep the current density lane until new measured samples change the frontier.",
    };
  }

  const hashGainRatio = extraHashrate / Number(selectedLane.hashrate);
  const wattIncreaseRatio = extraWatts / Number(selectedLane.watts);
  const thermalUnsafe = maxHashResult.thermalStatus === "hot" || maxHashResult.thermalStatus === "critical" || maxHashResult.thermalStatus === "paused";
  const evidenceReady = maxHashResult.powerEvidenceStatus === "measured" &&
    maxHashResult.shareEvidenceStatus === "proven" &&
    maxHashResult.stabilityWindowStatus === "stable";

  if (thermalUnsafe || maxHashResult.longRunRisk === "avoid") {
    return {
      status: "unsafe",
      laneId: maxHashLane.id,
      extraHashrate,
      extraWatts,
      hashGainRatio,
      wattIncreaseRatio,
      summary: `Max-hash headroom would add ${formatHashrateText(extraHashrate)} for +${extraWatts.toFixed(extraWatts < 100 ? 1 : 0)} W, but the profile is not safe for long-run use.`,
      nextStep: "Lower intensity, improve cooling, or collect a safer max-hash sample before using surge headroom.",
    };
  }

  if (!evidenceReady) {
    return {
      status: "waiting",
      laneId: maxHashLane.id,
      extraHashrate,
      extraWatts,
      hashGainRatio,
      wattIncreaseRatio,
      summary: `Max-hash headroom may add ${formatHashrateText(extraHashrate)} for +${extraWatts.toFixed(extraWatts < 100 ? 1 : 0)} W, but evidence is not complete.`,
      nextStep: "Prove measured watts, useful share quality, and a stable window before treating headroom as usable.",
    };
  }

  return {
    status: "available",
    laneId: maxHashLane.id,
    extraHashrate,
    extraWatts,
    hashGainRatio,
    wattIncreaseRatio,
    summary: `Max-hash headroom can add ${formatHashrateText(extraHashrate)} for +${extraWatts.toFixed(extraWatts < 100 ? 1 : 0)} W above the selected power-budget lane.`,
    nextStep: "Keep the budget lane for low-power running; use max-hash headroom only when the extra watts are intentional.",
  };
}
function deriveMarginalHashrateDecision(args: {
  selectedLane: HashDensityLane;
  maxHashLane: HashDensityLane;
  maxHashResult: TuningObservationResult | null;
}): HashDensityMarginalDecision {
  const { selectedLane, maxHashLane, maxHashResult } = args;
  const target = maxHashLane.id;
  if (selectedLane.source !== "local") {
    return {
      status: "none",
      fromLaneId: selectedLane.id,
      targetLaneId: null,
      extraHashrate: null,
      extraWatts: null,
      baselineHashesPerWatt: null,
      marginalHashesPerWatt: null,
      densityRetentionRatio: null,
      summary: "Marginal local hash decision is paused while external or Direct evidence is active.",
      nextStep: "Resolve the external interface gates before comparing local power-density upgrades.",
    };
  }

  if (!maxHashResult || !finitePositive(selectedLane.hashrate) || !finitePositive(selectedLane.watts) || !finitePositive(maxHashLane.hashrate) || !finitePositive(maxHashLane.watts)) {
    return {
      status: "measure",
      fromLaneId: selectedLane.id,
      targetLaneId: target,
      extraHashrate: null,
      extraWatts: null,
      baselineHashesPerWatt: null,
      marginalHashesPerWatt: null,
      densityRetentionRatio: null,
      summary: "Marginal hash-density decision needs measured selected-lane and max-hash samples.",
      nextStep: "Capture measured watts, useful share quality, thermals, and a stable max-hash window before raising the power envelope.",
    };
  }

  const extraHashrate = Number(maxHashLane.hashrate) - Number(selectedLane.hashrate);
  const extraWatts = Number(maxHashLane.watts) - Number(selectedLane.watts);
  const baselineHashesPerWatt = selectedLane.hashesPerWatt ?? hashesPerWatt(selectedLane.hashrate, selectedLane.watts);
  if (extraHashrate <= 0 || extraWatts <= 0) {
    return {
      status: "none",
      fromLaneId: selectedLane.id,
      targetLaneId: target,
      extraHashrate: Math.max(0, extraHashrate),
      extraWatts: Math.max(0, extraWatts),
      baselineHashesPerWatt,
      marginalHashesPerWatt: null,
      densityRetentionRatio: null,
      summary: "No higher local hash-density target is available above the selected lane.",
      nextStep: "Keep collecting measured frontier samples before changing the density envelope.",
    };
  }

  const marginalHashesPerWatt = extraHashrate / extraWatts;
  const densityRetentionRatio = finitePositive(baselineHashesPerWatt)
    ? marginalHashesPerWatt / Number(baselineHashesPerWatt)
    : null;
  const densityRetentionText = densityRetentionRatio === null
    ? "unknown retention"
    : `${Math.round(densityRetentionRatio * 100)}% density retention`;
  const deltaText = `${formatHashrateText(extraHashrate)} for +${extraWatts.toFixed(extraWatts < 100 ? 1 : 0)} W`;
  const thermalUnsafe = maxHashResult.thermalStatus === "hot" || maxHashResult.thermalStatus === "critical" || maxHashResult.thermalStatus === "paused";
  const evidenceReady = maxHashResult.powerEvidenceStatus === "measured" &&
    maxHashResult.shareEvidenceStatus === "proven" &&
    maxHashResult.stabilityWindowStatus === "stable";

  if (thermalUnsafe || maxHashResult.longRunRisk === "avoid" || maxHashLane.status === "blocked") {
    return {
      status: "cooldown",
      fromLaneId: selectedLane.id,
      targetLaneId: target,
      extraHashrate,
      extraWatts,
      baselineHashesPerWatt,
      marginalHashesPerWatt,
      densityRetentionRatio,
      summary: `Hold max-hash upgrade: ${deltaText} is blocked by thermal or long-run risk.`,
      nextStep: "Improve cooling, lower intensity, or collect a safer max-hash profile before increasing watts.",
    };
  }

  if (!evidenceReady || densityRetentionRatio === null) {
    return {
      status: "measure",
      fromLaneId: selectedLane.id,
      targetLaneId: target,
      extraHashrate,
      extraWatts,
      baselineHashesPerWatt,
      marginalHashesPerWatt,
      densityRetentionRatio,
      summary: `Measure before upgrading: max-hash may add ${deltaText}, but its evidence is incomplete.`,
      nextStep: "Prove measured watts, accepted-share quality, and a stable runtime window before spending more power.",
    };
  }

  if (densityRetentionRatio >= 0.55) {
    return {
      status: "advance",
      fromLaneId: selectedLane.id,
      targetLaneId: target,
      extraHashrate,
      extraWatts,
      baselineHashesPerWatt,
      marginalHashesPerWatt,
      densityRetentionRatio,
      summary: `Advance is efficient enough: ${deltaText} keeps ${densityRetentionText} versus the selected lane.`,
      nextStep: "Treat this as an intentional high-output profile; keep the low-power lane as the unattended default until the higher watt envelope is approved.",
    };
  }

  return {
    status: "hold",
    fromLaneId: selectedLane.id,
    targetLaneId: target,
    extraHashrate,
    extraWatts,
    baselineHashesPerWatt,
    marginalHashesPerWatt,
    densityRetentionRatio,
    summary: `Hold the upgrade: ${deltaText} keeps only ${densityRetentionText} versus the selected lane.`,
    nextStep: "Stay on the selected density lane and look for a better frontier sample before raising the power envelope.",
  };
}
function deriveEvidenceGates(args: {
  input: HashDensityPlanInput;
  selectedLane: HashDensityLane;
  budgetResult: TuningObservationResult | null;
  powerBudgetWatts: number | null;
  strategy: HashDensityPlanStrategy;
  externalIsEfficiencyReference: boolean;
}): HashDensityEvidenceGate[] {
  const { input, selectedLane, budgetResult, powerBudgetWatts, strategy, externalIsEfficiencyReference } = args;
  const localRequired = selectedLane.source === "local";
  const externalRequired = selectedLane.id === "external_reference" || strategy === "external_dry_run" || strategy === "external_telemetry_reference";
  const directRequired = strategy === "direct_reserved" || input.externalSnapshot.interfaceKind === "direct";
  const localResult = selectedLocalResult(input, budgetResult, selectedLane.id);
  const localWithinBudget = finitePositive(powerBudgetWatts) && finitePositive(selectedLane.watts) && Number(selectedLane.watts) <= Number(powerBudgetWatts);
  const thermalUnsafe = localResult?.thermalStatus === "critical" || localResult?.thermalStatus === "paused" || localResult?.thermalStatus === "hot";
  const stabilityBlocked = localResult?.stabilityWindowStatus === "unsafe" || localResult?.stabilityWindowStatus === "unstable";

  return [
    evidenceGate({
      id: "power_budget",
      status: !localRequired ? "waiting" : localWithinBudget ? "passed" : finitePositive(powerBudgetWatts) ? "blocked" : "waiting",
      requiredForLongRun: localRequired,
      summary: localRequired
        ? `Selected local lane must fit the ${finitePositive(powerBudgetWatts) ? `${Number(powerBudgetWatts).toFixed(Number(powerBudgetWatts) < 100 ? 1 : 0)} W` : "unknown"} power budget.`
        : "Power budget applies when the selected density lane is local.",
      nextStep: localWithinBudget
        ? "Keep this watt cap as the local operating envelope."
        : "Capture measured watts and choose a lane that fits the budget before unattended running.",
    }),
    evidenceGate({
      id: "measured_power",
      status: !localRequired ? "waiting" : localResult?.powerEvidenceStatus === "measured" ? "passed" : "waiting",
      requiredForLongRun: localRequired,
      summary: localRequired ? "Selected local lane needs measured watt evidence." : "Measured local power is not required for an external-only reference.",
      nextStep: localResult?.powerEvidenceStatus === "measured"
        ? "Measured power can be used for J/TH routing."
        : "Use wall power, GPU telemetry, or device telemetry to replace estimated watts.",
    }),
    evidenceGate({
      id: "share_quality",
      status: !localRequired ? "waiting" : localResult?.shareEvidenceStatus === "proven" ? "passed" : "waiting",
      requiredForLongRun: localRequired,
      summary: localRequired ? "Selected local lane needs accepted/rejected/stale/drop share evidence." : "Share quality is checked on the active mining engine.",
      nextStep: localResult?.shareEvidenceStatus === "proven"
        ? "Keep reject, stale, and local drop ratios low."
        : "Run long enough to collect accepted shares and prove useful pool work.",
    }),
    evidenceGate({
      id: "stability_window",
      status: !localRequired ? "waiting" : localResult?.stabilityWindowStatus === "stable" ? "passed" : stabilityBlocked ? "blocked" : "waiting",
      requiredForLongRun: localRequired,
      summary: localRequired ? "Selected local lane needs a stable long-run window." : "Stability window is checked on the active local lane.",
      nextStep: localResult?.stabilityWindowStatus === "stable"
        ? "Stable window is sufficient for unattended local operation."
        : localResult?.stabilityWindowSummary ?? "Run the selected lane longer before trusting unattended density.",
    }),
    evidenceGate({
      id: "thermal_safety",
      status: !localRequired ? "waiting" : thermalUnsafe ? "blocked" : localResult ? "passed" : "waiting",
      requiredForLongRun: localRequired,
      summary: localRequired ? "Selected local lane must stay below hot/critical/paused thermal states." : "Thermal safety is checked on the active compute lane.",
      nextStep: thermalUnsafe
        ? "Lower intensity, reduce threads, or improve cooling before long-run use."
        : localResult ? localResult.thermalSummary : "Capture thermal telemetry during the selected lane.",
    }),
    evidenceGate({
      id: "external_efficiency_history",
      status: !externalRequired ? "waiting" : input.externalHistory.evidenceReady && input.externalHistory.trend !== "degrading" ? "passed" : input.externalHistory.trend === "degrading" ? "blocked" : "waiting",
      requiredForLongRun: externalRequired,
      summary: externalRequired ? "External reference needs stable non-degrading efficiency history." : "External efficiency history is optional while using a local lane.",
      nextStep: input.externalHistory.evidenceReady && input.externalHistory.trend !== "degrading"
        ? "Keep sampling to detect efficiency drift."
        : `Collect ${input.externalHistory.evidenceGap} more usable external sample${input.externalHistory.evidenceGap === 1 ? "" : "s"} before trusting external density.`,
    }),
    evidenceGate({
      id: "external_work_assignment",
      status: !externalRequired ? "waiting" : input.externalWorkAdapterPlan.canAssignWork ? "passed" : externalIsEfficiencyReference ? "blocked" : "waiting",
      requiredForLongRun: externalRequired,
      summary: "External devices need proven job control, share submission, and unique work leases before work routing.",
      nextStep: input.externalWorkAdapterPlan.canAssignWork
        ? input.externalWorkAdapterPlan.nextStep
        : "Keep external hardware as telemetry/reference until work assignment is proven.",
    }),
    evidenceGate({
      id: "direct_protocol",
      status: directRequired ? "reserved" : "waiting",
      requiredForLongRun: directRequired,
      summary: "Direct hardware needs a physical endpoint protocol before telemetry or work routing.",
      nextStep: input.externalSnapshot.endpoint
        ? "Run read-only endpoint discovery before any telemetry, job control, or share submission."
        : "Choose the real serial, USB, HID, or vendor path endpoint after hardware exists.",
    }),
  ];
}

export function deriveHashDensityPlan(input: HashDensityPlanInput): HashDensityPlan {
  const powerBudgetTarget = derivePowerBudgetTarget(input);
  const powerBudgetWatts = powerBudgetTarget.watts;
  const budgetResult = powerBudgetTarget.result ?? selectPowerBudgetTuningResult(input.tuningAnalysis, powerBudgetWatts);
  const lanes = [
    localLane("local_lowest_power", "Lowest local watts", input.tuningAnalysis.lowestPower),
    localLane("local_power_budget", powerBudgetWatts ? `Best local hash under ${powerBudgetWatts.toFixed(powerBudgetWatts < 100 ? 1 : 0)} W` : "Best local hash under budget", budgetResult),
    localLane("local_best_efficiency", "Best local J/TH", input.tuningAnalysis.bestEfficiency),
    localLane("local_max_hashrate", "Max local effective hash", input.tuningAnalysis.bestHashrate),
    externalLaneFromHistory(input),
    externalHardwareLane(input),
  ];

  const budgetLane = lanes.find((lane) => lane.id === "local_power_budget") ?? defaultWaitingLane();
  const evidenceBestLane = bestLane(lanes) ?? budgetLane;
  const externalReference = lanes.find((lane) => lane.id === "external_reference") ?? externalLaneFromHistory(input);
  const hardwareLane = lanes.find((lane) => lane.id === "external_hardware") ?? externalHardwareLane(input);
  const maxHashLane = lanes.find((lane) => lane.id === "local_max_hashrate") ?? localLane("local_max_hashrate", "Max local effective hash", input.tuningAnalysis.bestHashrate);
  const hasLocalEvidence = input.tuningAnalysis.results.length > 0;
  const externalIsEfficiencyReference = externalReference.status === "blocked" || externalReference.status === "dry-run";
  const externalDryRunAvailable = hardwareLane.status === "dry-run" || externalReference.status === "dry-run";
  const localDensityComparisonReady = budgetResult?.powerEvidenceStatus === "measured";
  const externalReferenceBeatsLocal = localDensityComparisonReady && externalIsEfficiencyReference && finitePositive(externalReference.joulesPerTerahash) && (
    !finitePositive(budgetLane.joulesPerTerahash) ||
    Number(externalReference.joulesPerTerahash) <= Number(budgetLane.joulesPerTerahash) * 0.9 ||
    (finitePositive(externalReference.hashrate) && finitePositive(budgetLane.hashrate) && Number(externalReference.hashrate) >= Number(budgetLane.hashrate) * 10)
  );

  let strategy: HashDensityPlanStrategy = "collect_evidence";
  if (input.externalSnapshot.interfaceKind === "direct") {
    strategy = "direct_reserved";
  } else if (externalDryRunAvailable && localDensityComparisonReady) {
    strategy = "external_dry_run";
  } else if (externalReferenceBeatsLocal) {
    strategy = "external_telemetry_reference";
  } else if (hasLocalEvidence || laneRank(evidenceBestLane) > 0) {
    strategy = "local_power_budget";
  }

  const selectedLane = (() => {
    switch (strategy) {
      case "external_dry_run":
      case "external_telemetry_reference":
        return externalReference;
      case "direct_reserved":
        return hardwareLane;
      case "local_power_budget":
        return budgetLane;
      case "collect_evidence":
        return hasLocalEvidence ? budgetLane : defaultWaitingLane();
    }
  })();
  const hashrateHeadroom = deriveHashrateHeadroom({
    selectedLane,
    maxHashLane,
    maxHashResult: input.tuningAnalysis.bestHashrate,
  });
  const marginalDecision = deriveMarginalHashrateDecision({
    selectedLane,
    maxHashLane,
    maxHashResult: input.tuningAnalysis.bestHashrate,
  });
  const riskFlags = [
    ...(!powerBudgetWatts ? ["Power budget is unknown; capture measured watts before trusting density routing."] : []),
    ...(input.tuningAnalysis.results.length === 0 ? ["Local tuning evidence is missing."] : []),
    ...(externalIsEfficiencyReference && !input.externalWorkAdapterPlan.canAssignWork ? ["External efficiency is reference-only; real work assignment remains local."] : []),
    ...(externalDryRunAvailable && !localDensityComparisonReady ? ["External dry-run hash is available, but local power-density baseline is not ready for comparison."] : []),
    ...(input.hardwareCandidate.riskFlags.slice(0, 2)),
  ];

  const summary = (() => {
    switch (strategy) {
      case "collect_evidence":
        return "Density plan is collecting evidence before choosing a low-power high-hash operating lane.";
      case "local_power_budget":
        return `Density plan selects ${selectedLane.label} for the current power budget.`;
      case "external_telemetry_reference":
        return "Density plan uses external ASIC telemetry as the efficiency benchmark while local mining remains the real engine.";
      case "external_dry_run":
        return "Density plan allows external dry-run validation only; real external mining start remains blocked.";
      case "direct_reserved":
        return "Density plan keeps Direct hardware reserved until the physical protocol is proven.";
    }
  })();

  const nextStep = (() => {
    if (strategy === "external_dry_run" || strategy === "external_telemetry_reference") {
      return externalReference.nextStep;
    }
    if (strategy === "direct_reserved") {
      return hardwareLane.nextStep;
    }
    return selectedLane.nextStep;
  })();
  const evidenceGates = deriveEvidenceGates({
    input,
    selectedLane,
    budgetResult,
    powerBudgetWatts,
    strategy,
    externalIsEfficiencyReference,
  });
  const requiredGates = evidenceGates.filter((gate) => gate.requiredForLongRun);
  const requiredPassed = requiredGates.filter((gate) => evidenceGatePassed(gate.status)).length;
  const readinessScore = requiredGates.length > 0 ? Math.round(requiredPassed * 100 / requiredGates.length) : 0;
  const primaryMissingGate = requiredGates.find((gate) => !evidenceGatePassed(gate.status)) ?? null;
  const readyForLongRun = requiredGates.length > 0 && primaryMissingGate === null && strategy !== "direct_reserved";

  return {
    strategy,
    selectedLane,
    lanes,
    powerBudgetWatts,
    powerBudgetSource: powerBudgetTarget.source,
    powerBudgetSummary: powerBudgetTarget.summary,
    hashrateHeadroom,
    marginalDecision,
    externalIsEfficiencyReference,
    externalDryRunOnly: strategy === "external_dry_run",
    miningStartAllowed: false,
    evidenceGates,
    readinessScore,
    readyForLongRun,
    primaryMissingGate,
    summary,
    nextStep,
    riskFlags: Array.from(new Set(riskFlags)),
  };
}

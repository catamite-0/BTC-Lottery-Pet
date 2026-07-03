import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmRuntimeRecommendationSnapshot } from "./algorithmRuntimeRecommendation.js";
import type { HashOperatingPolicySnapshot } from "./hashOperatingPolicy.js";

export type AlgorithmPowerHashEnvelopeMode =
  | "evidence_wait"
  | "density_only"
  | "dominant_high_hash_density"
  | "budgeted_burst"
  | "manual_burst_window"
  | "external_dry_run"
  | "runtime_guard";

export type AlgorithmPowerHashEnvelopeStatus = "blocked" | "waiting" | "ready" | "manual";

export interface AlgorithmPowerHashEnvelopeSnapshot {
  schemaVersion: 1;
  mode: AlgorithmPowerHashEnvelopeMode;
  status: AlgorithmPowerHashEnvelopeStatus;
  averagePowerBudgetWatts: number | null;
  defaultHashrate: number | null;
  defaultWatts: number | null;
  defaultJoulesPerTerahash: number | null;
  burstHashrate: number | null;
  burstWatts: number | null;
  burstJoulesPerTerahash: number | null;
  defaultDutyPercent: number | null;
  burstDutyPercent: number | null;
  projectedAverageHashrate: number | null;
  projectedAverageWatts: number | null;
  projectedJoulesPerTerahash: number | null;
  incrementalHashrate: number | null;
  incrementalWatts: number | null;
  marginalHashratePerWatt: number | null;
  hashrateGainVsDefaultPercent: number | null;
  powerSavedVsAlwaysBurstPercent: number | null;
  canUseBurst: boolean;
  manualApprovalRequired: boolean;
  protectsLowPowerLane: boolean;
  externalMiningAllowed: false;
  guardrails: string[];
  summary: string;
  nextStep: string;
}

export interface AlgorithmPowerHashEnvelopeInput {
  objectiveCertificate: AlgorithmObjectiveCertificate;
  operatingPolicy: HashOperatingPolicySnapshot;
  runtimeRecommendation: AlgorithmRuntimeRecommendationSnapshot;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function roundNullable(value: number | null, digits = 2) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratioPercent(numerator: number | null, denominator: number | null) {
  if (!finitePositive(numerator) || !finitePositive(denominator)) {
    return null;
  }
  return roundNullable(Number(numerator) * 100 / Number(denominator), 1);
}

function joulesPerTerahash(hashrate: number | null, watts: number | null) {
  if (!finitePositive(hashrate) || !finitePositive(watts)) {
    return null;
  }
  return Number(watts) * 1_000_000_000_000 / Number(hashrate);
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function dutyForBudget(defaultWatts: number, burstWatts: number, budgetWatts: number) {
  if (budgetWatts <= defaultWatts) {
    return 0;
  }
  if (budgetWatts >= burstWatts) {
    return 1;
  }
  return clampRatio((budgetWatts - defaultWatts) / Math.max(1e-9, burstWatts - defaultWatts));
}

function baseSnapshot(
  input: AlgorithmPowerHashEnvelopeInput,
  mode: AlgorithmPowerHashEnvelopeMode,
  status: AlgorithmPowerHashEnvelopeStatus,
  summary: string,
  nextStep: string,
  guardrails: string[],
): AlgorithmPowerHashEnvelopeSnapshot {
  const defaultHashrate = input.objectiveCertificate.sustainableHashrate ?? input.operatingPolicy.defaultPointHashrate;
  const defaultWatts = input.objectiveCertificate.sustainableWatts ?? input.operatingPolicy.defaultPointWatts;
  const defaultJoulesPerTerahash = input.objectiveCertificate.sustainableJoulesPerTerahash ?? joulesPerTerahash(defaultHashrate, defaultWatts);
  const burstHashrate = input.objectiveCertificate.burstHashrate ?? input.operatingPolicy.burstHashrate;
  const burstWatts = input.objectiveCertificate.burstWatts ?? input.operatingPolicy.burstWatts;
  return {
    schemaVersion: 1,
    mode,
    status,
    averagePowerBudgetWatts: input.objectiveCertificate.powerBudgetWatts,
    defaultHashrate,
    defaultWatts,
    defaultJoulesPerTerahash,
    burstHashrate,
    burstWatts,
    burstJoulesPerTerahash: joulesPerTerahash(burstHashrate, burstWatts),
    defaultDutyPercent: null,
    burstDutyPercent: null,
    projectedAverageHashrate: null,
    projectedAverageWatts: null,
    projectedJoulesPerTerahash: null,
    incrementalHashrate: null,
    incrementalWatts: null,
    marginalHashratePerWatt: null,
    hashrateGainVsDefaultPercent: null,
    powerSavedVsAlwaysBurstPercent: null,
    canUseBurst: false,
    manualApprovalRequired: false,
    protectsLowPowerLane: true,
    externalMiningAllowed: false,
    guardrails,
    summary,
    nextStep,
  };
}

function densityOnly(
  input: AlgorithmPowerHashEnvelopeInput,
  summary: string,
  nextStep: string,
  status: AlgorithmPowerHashEnvelopeStatus = "ready",
): AlgorithmPowerHashEnvelopeSnapshot {
  const base = baseSnapshot(input, "density_only", status, summary, nextStep, [
    "Use the measured density lane as the default operating point.",
    "Do not spend extra watts unless marginal hash-density evidence improves.",
  ]);
  return {
    ...base,
    defaultDutyPercent: 100,
    burstDutyPercent: 0,
    projectedAverageHashrate: base.defaultHashrate,
    projectedAverageWatts: base.defaultWatts,
    projectedJoulesPerTerahash: base.defaultJoulesPerTerahash,
    incrementalHashrate: 0,
    incrementalWatts: 0,
  };
}

function dominantHighHashDensity(input: AlgorithmPowerHashEnvelopeInput): AlgorithmPowerHashEnvelopeSnapshot {
  const base = baseSnapshot(input, "dominant_high_hash_density", input.runtimeRecommendation.manualApprovalRequired ? "manual" : "ready", "", "", [
    "Promote the measured high-hash point only because it dominates the previous density lane on watts and hashrate.",
    "Keep runtime apply gates in control; no automatic max-hash promotion is allowed by the envelope alone.",
    "Fall back if measured watts, share quality, thermals, or GPU duty regress.",
  ]);
  const previousDefaultHashrate = Number(base.defaultHashrate);
  const previousDefaultWatts = Number(base.defaultWatts);
  const dominantHashrate = Number(base.burstHashrate);
  const dominantWatts = Number(base.burstWatts);
  const incrementalHashrate = dominantHashrate - previousDefaultHashrate;
  const incrementalWatts = dominantWatts - previousDefaultWatts;

  return {
    ...base,
    defaultHashrate: dominantHashrate,
    defaultWatts: dominantWatts,
    defaultJoulesPerTerahash: joulesPerTerahash(dominantHashrate, dominantWatts),
    burstHashrate: null,
    burstWatts: null,
    burstJoulesPerTerahash: null,
    defaultDutyPercent: 100,
    burstDutyPercent: 0,
    projectedAverageHashrate: Math.round(dominantHashrate),
    projectedAverageWatts: roundNullable(dominantWatts, 2),
    projectedJoulesPerTerahash: roundNullable(joulesPerTerahash(dominantHashrate, dominantWatts), 2),
    incrementalHashrate: Math.round(incrementalHashrate),
    incrementalWatts: roundNullable(incrementalWatts, 2),
    marginalHashratePerWatt: incrementalWatts > 0 ? roundNullable(incrementalHashrate / incrementalWatts, 2) : null,
    hashrateGainVsDefaultPercent: roundNullable((dominantHashrate / previousDefaultHashrate - 1) * 100, 1),
    powerSavedVsAlwaysBurstPercent: 0,
    canUseBurst: false,
    manualApprovalRequired: input.runtimeRecommendation.manualApprovalRequired,
    protectsLowPowerLane: true,
    summary: "Power-hash envelope: the measured high-hash point dominates the old density lane, so treat it as the new density default candidate.",
    nextStep: input.runtimeRecommendation.manualApprovalRequired
      ? "Apply the dominant profile only through the runtime gate, then verify it as the new density lane."
      : "Run the dominant profile as the density default and keep refreshing measured power, share, thermal, and duty evidence.",
  };
}
function budgetedBurst(
  input: AlgorithmPowerHashEnvelopeInput,
  duty: number,
): AlgorithmPowerHashEnvelopeSnapshot {
  const base = baseSnapshot(input, "budgeted_burst", "manual", "", "", [
    "Keep the density lane as the fallback for the full runtime.",
    "Burst remains manual; stop burst on thermal, reject, stale, queued-drop, or GPU-throttle degradation.",
    "Average burst duty is bounded by measured watts, not by raw hashrate desire.",
  ]);
  const defaultHashrate = Number(base.defaultHashrate);
  const defaultWatts = Number(base.defaultWatts);
  const burstHashrate = Number(base.burstHashrate);
  const burstWatts = Number(base.burstWatts);
  const projectedAverageHashrate = defaultHashrate * (1 - duty) + burstHashrate * duty;
  const projectedAverageWatts = defaultWatts * (1 - duty) + burstWatts * duty;
  const incrementalHashrate = projectedAverageHashrate - defaultHashrate;
  const incrementalWatts = projectedAverageWatts - defaultWatts;
  const powerSavedVsAlwaysBurstPercent = burstWatts > projectedAverageWatts
    ? (1 - projectedAverageWatts / burstWatts) * 100
    : 0;
  const burstDutyPercent = roundNullable(duty * 100, 1);
  const summary = duty >= 1
    ? "Power-hash envelope: budget can cover a full measured burst, but it still requires manual approval."
    : `Power-hash envelope: budget allows about ${burstDutyPercent}% manual burst while preserving the density fallback.`;
  const nextStep = duty >= 1
    ? "Use burst only intentionally; return to density default after the high-output window."
    : "Run the density lane by default and keep any high-output burst inside the measured average-watt envelope.";

  return {
    ...base,
    mode: duty >= 1 ? "manual_burst_window" : "budgeted_burst",
    averagePowerBudgetWatts: base.averagePowerBudgetWatts,
    defaultDutyPercent: roundNullable((1 - duty) * 100, 1),
    burstDutyPercent,
    projectedAverageHashrate: Math.round(projectedAverageHashrate),
    projectedAverageWatts: roundNullable(projectedAverageWatts, 2),
    projectedJoulesPerTerahash: roundNullable(joulesPerTerahash(projectedAverageHashrate, projectedAverageWatts), 2),
    incrementalHashrate: Math.round(incrementalHashrate),
    incrementalWatts: roundNullable(incrementalWatts, 2),
    marginalHashratePerWatt: incrementalWatts > 0 ? roundNullable(incrementalHashrate / incrementalWatts, 2) : null,
    hashrateGainVsDefaultPercent: roundNullable((projectedAverageHashrate / defaultHashrate - 1) * 100, 1),
    powerSavedVsAlwaysBurstPercent: roundNullable(powerSavedVsAlwaysBurstPercent, 1),
    canUseBurst: true,
    manualApprovalRequired: true,
    protectsLowPowerLane: true,
    summary,
    nextStep,
  };
}

export function deriveAlgorithmPowerHashEnvelope(
  input: AlgorithmPowerHashEnvelopeInput,
): AlgorithmPowerHashEnvelopeSnapshot {
  if (input.operatingPolicy.externalDryRunOnly || input.objectiveCertificate.status === "dry_run") {
    return baseSnapshot(
      input,
      "external_dry_run",
      "waiting",
      "Power-hash envelope: external high-hash capacity remains dry-run/reference only.",
      "Finish external work routing, share accounting, thermal, and release gates before assigning real work.",
      ["External mining remains disabled in this envelope."],
    );
  }

  if (input.operatingPolicy.runtimeGuard === "block" || input.runtimeRecommendation.mode === "runtime_guard") {
    return baseSnapshot(
      input,
      "runtime_guard",
      "blocked",
      "Power-hash envelope: live runtime guard blocks power or hashrate promotion.",
      input.operatingPolicy.nextStep,
      ["Lower or hold load until useful share quality and GPU duty recover."],
    );
  }

  if (!input.objectiveCertificate.lowPowerReady || !finitePositive(input.objectiveCertificate.sustainableHashrate) || !finitePositive(input.objectiveCertificate.sustainableWatts)) {
    return baseSnapshot(
      input,
      "evidence_wait",
      "waiting",
      "Power-hash envelope: waiting for a measured low-power density lane.",
      input.objectiveCertificate.nextStep,
      ["Capture measured watts, hashrate, share quality, thermals, and a stability window before planning burst duty."],
    );
  }

  const highHashProfileOpen = input.runtimeRecommendation.opensHighHashBurst ||
    (input.runtimeRecommendation.mode === "run_density_default" &&
      input.runtimeRecommendation.selectedIntent === "best_hashrate" &&
      input.runtimeRecommendation.canApplyProfile);
  if (!input.objectiveCertificate.maxHashBurstAvailable || !highHashProfileOpen || !finitePositive(input.objectiveCertificate.burstHashrate) || !finitePositive(input.objectiveCertificate.burstWatts)) {
    return densityOnly(
      input,
      "Power-hash envelope: run the certified density lane only; high-hash burst is not open.",
      input.runtimeRecommendation.nextStep || input.objectiveCertificate.nextStep,
      input.objectiveCertificate.highHashPath === "marginal_hold" ? "manual" : "ready",
    );
  }

  const defaultWatts = Number(input.objectiveCertificate.sustainableWatts);
  const burstWatts = Number(input.objectiveCertificate.burstWatts);
  const defaultHashrate = Number(input.objectiveCertificate.sustainableHashrate);
  const burstHashrate = Number(input.objectiveCertificate.burstHashrate);
  if (burstWatts <= defaultWatts && burstHashrate > defaultHashrate) {
    return dominantHighHashDensity(input);
  }

  if (burstWatts <= defaultWatts) {
    return budgetedBurst(input, 1);
  }

  const budgetWatts = input.objectiveCertificate.powerBudgetWatts;
  if (!finitePositive(budgetWatts)) {
    const base = densityOnly(
      input,
      "Power-hash envelope: manual burst is verified, but no average power budget is set.",
      "Set or measure a power budget before calculating burst duty; until then, keep density as the default.",
      "manual",
    );
    return {
      ...base,
      mode: "manual_burst_window",
      canUseBurst: true,
      manualApprovalRequired: true,
      burstHashrate: input.objectiveCertificate.burstHashrate,
      burstWatts: input.objectiveCertificate.burstWatts,
      burstJoulesPerTerahash: joulesPerTerahash(input.objectiveCertificate.burstHashrate, input.objectiveCertificate.burstWatts),
      guardrails: [
        "Manual burst is available, but average duty is unknown without a watt budget.",
        "Keep the density lane as the unattended default.",
      ],
    };
  }

  const duty = dutyForBudget(defaultWatts, burstWatts, Number(budgetWatts));
  if (duty <= 0) {
    return densityOnly(
      input,
      "Power-hash envelope: the measured power budget fits only the density lane.",
      "Raise the budget or improve marginal hash-density evidence before using burst.",
      "ready",
    );
  }

  return budgetedBurst(input, duty);
}
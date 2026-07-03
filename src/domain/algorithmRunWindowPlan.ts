import type { AlgorithmObjectiveExperimentPlan } from "./algorithmObjectiveExperiment.js";
import type { AlgorithmPowerHashEnvelopeSnapshot } from "./algorithmPowerHashEnvelope.js";
import type { AlgorithmRuntimeRecommendationSnapshot } from "./algorithmRuntimeRecommendation.js";

export type AlgorithmRunWindowMode =
  | "blocked"
  | "capture_window"
  | "density_sustain"
  | "budgeted_burst_cycle"
  | "manual_burst_window"
  | "external_dry_run"
  | "monitor";

export type AlgorithmRunWindowStatus = "blocked" | "waiting" | "ready" | "manual";

export interface AlgorithmRunWindowPlanSnapshot {
  schemaVersion: 1;
  mode: AlgorithmRunWindowMode;
  status: AlgorithmRunWindowStatus;
  cycleSeconds: number | null;
  densitySeconds: number | null;
  burstSeconds: number | null;
  cooldownSeconds: number | null;
  captureSeconds: number | null;
  refreshSeconds: number | null;
  burstDutyPercent: number | null;
  projectedAverageHashrate: number | null;
  projectedAverageWatts: number | null;
  canRunDensity: boolean;
  canRunBurst: boolean;
  canAutoApplyDensity: boolean;
  manualApprovalRequired: boolean;
  externalMiningAllowed: false;
  requiredStepId: string | null;
  stopConditions: string[];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

export interface AlgorithmRunWindowPlanInput {
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot;
  runtimeRecommendation: AlgorithmRuntimeRecommendationSnapshot;
  objectiveExperiment: AlgorithmObjectiveExperimentPlan;
}

const DEFAULT_CYCLE_SECONDS = 900;
const DEFAULT_CAPTURE_SECONDS = 300;
const MIN_COOLDOWN_SECONDS = 60;
const COOLDOWN_FRACTION = 0.25;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampPercent(value: number | null | undefined) {
  if (!finitePositive(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value)));
}

function captureSeconds(experiment: AlgorithmObjectiveExperimentPlan) {
  return experiment.capturePolicy.minCaptureSeconds ?? experiment.requiredSeconds ?? DEFAULT_CAPTURE_SECONDS;
}

function refreshSeconds(experiment: AlgorithmObjectiveExperimentPlan) {
  return experiment.capturePolicy.refreshSeconds ?? experiment.capturePolicy.minCaptureSeconds ?? experiment.requiredSeconds ?? null;
}

function cooldownSeconds(burstSeconds: number, densitySeconds: number) {
  if (burstSeconds <= 0 || densitySeconds <= 0) {
    return 0;
  }
  return Math.min(densitySeconds, Math.max(MIN_COOLDOWN_SECONDS, Math.round(burstSeconds * COOLDOWN_FRACTION)));
}

function baseSnapshot(
  input: AlgorithmRunWindowPlanInput,
  mode: AlgorithmRunWindowMode,
  status: AlgorithmRunWindowStatus,
  summary: string,
  nextStep: string,
  guardrails: string[],
): AlgorithmRunWindowPlanSnapshot {
  return {
    schemaVersion: 1,
    mode,
    status,
    cycleSeconds: null,
    densitySeconds: null,
    burstSeconds: null,
    cooldownSeconds: null,
    captureSeconds: input.objectiveExperiment.capturePolicy.enabled ? captureSeconds(input.objectiveExperiment) : null,
    refreshSeconds: refreshSeconds(input.objectiveExperiment),
    burstDutyPercent: input.powerHashEnvelope.burstDutyPercent,
    projectedAverageHashrate: input.powerHashEnvelope.projectedAverageHashrate,
    projectedAverageWatts: input.powerHashEnvelope.projectedAverageWatts,
    canRunDensity: false,
    canRunBurst: false,
    canAutoApplyDensity: false,
    manualApprovalRequired: false,
    externalMiningAllowed: false,
    requiredStepId: input.objectiveExperiment.capturePolicy.requiredStepId,
    stopConditions: input.objectiveExperiment.stopConditions,
    guardrails,
    summary,
    nextStep,
  };
}

function densityWindow(
  input: AlgorithmRunWindowPlanInput,
  status: AlgorithmRunWindowStatus,
  summary: string,
  nextStep: string,
): AlgorithmRunWindowPlanSnapshot {
  const cycleSeconds = Math.max(DEFAULT_CYCLE_SECONDS, captureSeconds(input.objectiveExperiment));
  const canRunDensity = input.runtimeRecommendation.canApplyProfile || input.runtimeRecommendation.autoApplyAllowed;
  const resolvedStatus = canRunDensity ? status : "waiting";
  const resolvedSummary = canRunDensity
    ? summary
    : "Run-window plan: density lane is waiting for the runtime profile gate before scheduling.";
  const resolvedNextStep = canRunDensity ? nextStep : input.runtimeRecommendation.nextStep;
  return {
    ...baseSnapshot(input, "density_sustain", resolvedStatus, resolvedSummary, resolvedNextStep, [
      "Run the measured density lane for the full verification window.",
      "Keep max-hash separated from unattended operation.",
    ]),
    cycleSeconds,
    densitySeconds: cycleSeconds,
    burstSeconds: 0,
    cooldownSeconds: 0,
    burstDutyPercent: 0,
    projectedAverageHashrate: input.powerHashEnvelope.projectedAverageHashrate ?? input.powerHashEnvelope.defaultHashrate,
    projectedAverageWatts: input.powerHashEnvelope.projectedAverageWatts ?? input.powerHashEnvelope.defaultWatts,
    canRunDensity,
    canAutoApplyDensity: input.runtimeRecommendation.autoApplyAllowed && canRunDensity,
    manualApprovalRequired: false,
  };
}

function budgetedBurstWindow(input: AlgorithmRunWindowPlanInput): AlgorithmRunWindowPlanSnapshot {
  const dutyPercent = clampPercent(input.powerHashEnvelope.burstDutyPercent);
  const cycleSeconds = Math.max(DEFAULT_CYCLE_SECONDS, captureSeconds(input.objectiveExperiment));
  const burstSeconds = Math.round(cycleSeconds * dutyPercent / 100);
  const densitySeconds = Math.max(0, cycleSeconds - burstSeconds);
  const cooldown = cooldownSeconds(burstSeconds, densitySeconds);
  return {
    ...baseSnapshot(input, "budgeted_burst_cycle", "manual", "", "", [
      "Start every cycle on the density lane and enter burst only by manual approval.",
      "Count cooldown or fallback time inside the density portion of the cycle.",
      "Abort burst on reject, stale, queued-drop, thermal, or GPU-throttle degradation.",
    ]),
    cycleSeconds,
    densitySeconds,
    burstSeconds,
    cooldownSeconds: cooldown,
    canRunDensity: true,
    canRunBurst: input.powerHashEnvelope.canUseBurst && input.runtimeRecommendation.opensHighHashBurst,
    canAutoApplyDensity: false,
    manualApprovalRequired: true,
    summary: `Run-window plan: ${burstSeconds} seconds manual burst inside each ${cycleSeconds} second power-budget cycle; density lane owns the remaining ${densitySeconds} seconds.`,
    nextStep: "Run density by default; use burst only for the planned manual window, then fall back and capture the next evidence sample.",
  };
}

function manualBurstWindow(input: AlgorithmRunWindowPlanInput): AlgorithmRunWindowPlanSnapshot {
  const dutyPercent = input.powerHashEnvelope.burstDutyPercent;
  if (!finitePositive(dutyPercent)) {
    return {
      ...baseSnapshot(input, "manual_burst_window", "manual", "Run-window plan: manual burst is verified, but no bounded duty cycle exists yet.", "Set or measure an average power budget before scheduling a repeatable burst window.", [
        "Manual burst is available only as an operator-triggered high-output window.",
        "Keep the density lane as the unattended default until a watt budget defines duty cycle.",
      ]),
      cycleSeconds: null,
      densitySeconds: null,
      burstSeconds: null,
      cooldownSeconds: null,
      canRunDensity: true,
      canRunBurst: input.powerHashEnvelope.canUseBurst,
      canAutoApplyDensity: false,
      manualApprovalRequired: true,
    };
  }

  const cycleSeconds = Math.max(DEFAULT_CYCLE_SECONDS, captureSeconds(input.objectiveExperiment));
  const burstSeconds = Math.round(cycleSeconds * clampPercent(dutyPercent) / 100);
  const densitySeconds = Math.max(0, cycleSeconds - burstSeconds);
  return {
    ...baseSnapshot(input, "manual_burst_window", "manual", "", "", [
      "Even when the budget covers full burst watts, burst remains an explicit manual window.",
      "Return to the density lane after the high-output validation window.",
    ]),
    cycleSeconds,
    densitySeconds,
    burstSeconds,
    cooldownSeconds: cooldownSeconds(burstSeconds, densitySeconds || cycleSeconds),
    canRunDensity: true,
    canRunBurst: input.powerHashEnvelope.canUseBurst,
    canAutoApplyDensity: false,
    manualApprovalRequired: true,
    summary: `Run-window plan: allow up to ${burstSeconds} seconds of manually approved burst in a ${cycleSeconds} second validation window.`,
    nextStep: "Use this as a manual validation window and return to density if useful hash per watt degrades.",
  };
}

export function deriveAlgorithmRunWindowPlan(input: AlgorithmRunWindowPlanInput): AlgorithmRunWindowPlanSnapshot {
  const { powerHashEnvelope, runtimeRecommendation, objectiveExperiment } = input;

  if (powerHashEnvelope.mode === "runtime_guard" || runtimeRecommendation.mode === "runtime_guard") {
    return baseSnapshot(
      input,
      "blocked",
      "blocked",
      "Run-window plan: runtime guard blocks any higher-load window.",
      powerHashEnvelope.nextStep || runtimeRecommendation.nextStep,
      ["Lower or hold load before scheduling another optimization window."],
    );
  }

  if (powerHashEnvelope.mode === "external_dry_run" || runtimeRecommendation.mode === "external_dry_run") {
    return baseSnapshot(
      input,
      "external_dry_run",
      "waiting",
      "Run-window plan: external work stays in dry-run validation; no real external mining window is scheduled.",
      powerHashEnvelope.nextStep || runtimeRecommendation.nextStep,
      ["Real external mining remains disabled until release gates approve job control and work routing."],
    );
  }

  if (runtimeRecommendation.mode === "monitor") {
    return baseSnapshot(
      input,
      "monitor",
      runtimeRecommendation.priority === "blocked" ? "blocked" : "waiting",
      "Run-window plan: runtime recommendation is monitor-only; no density or burst window is scheduled.",
      runtimeRecommendation.nextStep || objectiveExperiment.nextStep,
      [
        ...runtimeRecommendation.guardrails,
        "Do not schedule density or burst windows until runtime recommendation leaves monitor mode.",
      ],
    );
  }
  if (runtimeRecommendation.mode === "capture_evidence" || runtimeRecommendation.mode === "retest_profile" || powerHashEnvelope.mode === "evidence_wait") {
    const seconds = captureSeconds(objectiveExperiment);
    return {
      ...baseSnapshot(
        input,
        "capture_window",
        runtimeRecommendation.canApplyProfile ? "ready" : "waiting",
        `Run-window plan: capture a ${seconds} second objective evidence window before changing the power envelope.`,
        runtimeRecommendation.nextStep || objectiveExperiment.nextStep,
        ["Record measured watts, share quality, thermals, and stability before profile promotion."],
      ),
      cycleSeconds: seconds,
      densitySeconds: objectiveExperiment.route === "local" ? seconds : null,
      burstSeconds: 0,
      cooldownSeconds: 0,
      canRunDensity: runtimeRecommendation.canApplyProfile,
      canAutoApplyDensity: false,
      manualApprovalRequired: false,
    };
  }

  if (powerHashEnvelope.mode === "budgeted_burst") {
    return budgetedBurstWindow(input);
  }

  if (powerHashEnvelope.mode === "manual_burst_window") {
    return manualBurstWindow(input);
  }

  if (powerHashEnvelope.mode === "dominant_high_hash_density" || powerHashEnvelope.mode === "density_only" || runtimeRecommendation.mode === "run_density_default" || runtimeRecommendation.mode === "hold_high_hash") {
    return densityWindow(
      input,
      powerHashEnvelope.status === "manual" || runtimeRecommendation.manualApprovalRequired ? "manual" : "ready",
      powerHashEnvelope.mode === "dominant_high_hash_density"
        ? "Run-window plan: sustain the dominant high-hash density lane for the full verification cycle."
        : "Run-window plan: sustain the low-power density lane for the full verification cycle.",
      powerHashEnvelope.nextStep || runtimeRecommendation.nextStep,
    );
  }

  return baseSnapshot(
    input,
    "monitor",
    "waiting",
    "Run-window plan: monitor current evidence before scheduling another local optimization window.",
    runtimeRecommendation.nextStep || objectiveExperiment.nextStep,
    ["Do not change runtime profile until the next objective recommendation is ready."],
  );
}
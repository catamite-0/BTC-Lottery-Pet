import type { AlgorithmSamplingPlan, AlgorithmSamplingTask, AlgorithmSamplingTaskId, AlgorithmSamplingTaskRoute, AlgorithmSamplingTaskStatus } from "./algorithmSamplingPlan.js";
import type { TuningAnalysis, TuningObservationResult, TuningSweepPlan, TuningSweepStep } from "./efficiencyTuning.js";
import type { HashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";
import { deriveHashRuntimeGuard, targetRaisesHashLoad } from "./hashRuntimeGuard.js";

export type AlgorithmTuningDirectiveKind =
  | "local_profile"
  | "network_telemetry"
  | "external_dry_run"
  | "direct_reserved"
  | "research_review";

export interface AlgorithmTuningApplyTarget {
  stepId: string;
  computeMode: TuningSweepStep["computeMode"];
  cpuThreads: number;
  gpuIntensityPercent: number;
}

export interface AlgorithmTuningDirectiveInput {
  samplingPlan: AlgorithmSamplingPlan;
  tuningSweepPlan: TuningSweepPlan;
  tuningAnalysis: TuningAnalysis;
  runtimeEfficiency?: HashRuntimeEfficiencySnapshot | null;
  currentStep?: TuningSweepStep | null;
}

export interface AlgorithmTuningDirective {
  kind: AlgorithmTuningDirectiveKind;
  route: AlgorithmSamplingTaskRoute;
  status: AlgorithmSamplingTaskStatus;
  primaryTaskId: AlgorithmSamplingTaskId;
  step: TuningSweepStep | null;
  applyTarget: AlgorithmTuningApplyTarget | null;
  canApplyLocalProfile: boolean;
  requireMeasuredPower: boolean;
  requireCoolOrWarmThermals: boolean;
  requiredSeconds: number | null;
  requiredSamples: number | null;
  requiredShareEvents: number | null;
  summary: string;
  nextStep: string;
}

function baselineStep(plan: TuningSweepPlan) {
  return plan.steps.find((step) => step.priority === "baseline") ?? plan.steps[0] ?? null;
}

function fallbackResult(analysis: TuningAnalysis) {
  return analysis.powerDensityKnee ?? analysis.paretoRecommendation ?? analysis.bestEfficiency ?? analysis.lowestPower ?? analysis.bestHashrate ?? analysis.results[0] ?? null;
}

function fallbackStep(plan: TuningSweepPlan, analysis: TuningAnalysis) {
  return fallbackResult(analysis)?.step ?? baselineStep(plan);
}

function resultHasRequiredProbeEvidence(result: TuningObservationResult, task: AlgorithmSamplingTask) {
  const requiredSeconds = task.requiredSeconds;
  const requiredShareEvents = task.requiredShareEvents;
  const sampleReady = requiredSeconds === null ||
    (typeof result.sampleSeconds === "number" && result.sampleSeconds >= requiredSeconds);
  const sharesReady = requiredShareEvents === null || result.shareEvidenceStatus === "proven";
  const powerReady = !task.requiresMeasuredPower || result.powerEvidenceStatus === "measured";
  const thermalReady = !task.requiresCoolOrWarmThermals || (
    result.thermalStatus !== "hot" &&
    result.thermalStatus !== "critical" &&
    result.thermalStatus !== "paused"
  );

  return sampleReady && sharesReady && powerReady && thermalReady;
}

function maxHashrateProbeStep(task: AlgorithmSamplingTask, plan: TuningSweepPlan, analysis: TuningAnalysis) {
  const targetStep = plan.steps
    .slice()
    .sort((left, right) => right.estimatedHashrate - left.estimatedHashrate || right.order - left.order)[0] ?? null;
  if (!targetStep) {
    return null;
  }

  const targetResult = analysis.results.find((result) => result.step.id === targetStep.id) ?? null;
  return targetResult && resultHasRequiredProbeEvidence(targetResult, task) ? null : targetStep;
}

function powerDensityProbeStep(task: AlgorithmSamplingTask, plan: TuningSweepPlan, analysis: TuningAnalysis) {
  if (task.targetProfile === "max_hashrate") {
    return maxHashrateProbeStep(task, plan, analysis);
  }

  const knee = analysis.powerDensityKnee?.step;
  if (!knee) {
    return fallbackStep(plan, analysis);
  }

  const measuredStepIds = new Set(
    analysis.results
      .filter((result) => resultHasRequiredProbeEvidence(result, task))
      .map((result) => result.step.id),
  );
  const laterSteps = plan.steps
    .slice()
    .sort((left, right) => left.order - right.order)
    .filter((step) => step.order > knee.order);

  return laterSteps.find((step) => !measuredStepIds.has(step.id)) ?? null;
}

function localStepForTask(task: AlgorithmSamplingTask, plan: TuningSweepPlan, analysis: TuningAnalysis) {
  switch (task.id) {
    case "local_measured_power":
      return analysis.results.find((result) => result.powerEvidenceStatus !== "measured")?.step ?? fallbackStep(plan, analysis);
    case "local_share_quality":
      return analysis.results.find((result) => result.shareEvidenceStatus !== "proven")?.step ?? fallbackStep(plan, analysis);
    case "local_stability_window":
      return analysis.results.find((result) => !localResultHasStableWindow(result))?.step ?? fallbackStep(plan, analysis);
    case "local_power_density_probe":
      return powerDensityProbeStep(task, plan, analysis);
    case "local_baseline":
    default:
      return baselineStep(plan);
  }
}

function localResultHasStableWindow(result: TuningObservationResult) {
  return result.stabilityWindowStatus === "stable" &&
    result.thermalStatus !== "hot" &&
    result.thermalStatus !== "critical" &&
    result.thermalStatus !== "paused";
}

function directiveKind(route: AlgorithmSamplingTaskRoute): AlgorithmTuningDirectiveKind {
  switch (route) {
    case "local":
      return "local_profile";
    case "network":
      return "network_telemetry";
    case "external":
      return "external_dry_run";
    case "direct":
      return "direct_reserved";
    case "research":
      return "research_review";
  }
}

function applyTarget(step: TuningSweepStep | null): AlgorithmTuningApplyTarget | null {
  if (!step) {
    return null;
  }

  return {
    stepId: step.id,
    computeMode: step.computeMode,
    cpuThreads: step.cpuThreads,
    gpuIntensityPercent: step.gpuIntensityPercent,
  };
}

function secondsText(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return "the required window";
  }

  if (seconds >= 60 && seconds % 60 === 0) {
    return `${Math.trunc(seconds / 60)} minute${seconds === 60 ? "" : "s"}`;
  }

  return `${Math.trunc(seconds)} seconds`;
}

function localSummary(task: AlgorithmSamplingTask, step: TuningSweepStep | null) {
  if (!step) {
    if (task.id === "local_power_density_probe" && task.targetProfile === "max_hashrate") {
      return "Max-hash headroom already has required evidence or no max-hash tuning step is available.";
    }
    return task.id === "local_power_density_probe"
      ? "Power-density probe needs a higher local tuning step before it can continue."
      : "No local tuning step is available yet.";
  }

  const qualifiers = [
    task.requiresMeasuredPower ? "measured watts" : "estimated watts acceptable",
    task.requiresCoolOrWarmThermals ? "cool/warm thermals" : "thermal monitor attached",
    task.requiredShareEvents ? `${task.requiredShareEvents} share events` : "share counters tracked",
  ];

  const action = task.id === "local_power_density_probe" ? "Probe" : "Run";
  return `${action} ${step.summary} for ${secondsText(task.requiredSeconds ?? step.sampleSeconds)} with ${qualifiers.join(", ")}.`;
}

function nonLocalSummary(task: AlgorithmSamplingTask, kind: AlgorithmTuningDirectiveKind) {
  switch (kind) {
    case "network_telemetry":
      return "Sample Network external telemetry only; it remains an efficiency reference, not a mining engine.";
    case "external_dry_run":
      return "Run external work validation as dry-run only; real external mining start stays disabled.";
    case "direct_reserved":
      return "Keep Direct external hash reserved until the physical endpoint and protocol are known.";
    case "research_review":
      return "Review the algorithm claim before it can affect runtime routing.";
    case "local_profile":
      return localSummary(task, null);
  }
}


function runtimeBlocksDirectiveApply(
  runtime: HashRuntimeEfficiencySnapshot | null | undefined,
  currentStep: TuningSweepStep | null | undefined,
  targetStep: TuningSweepStep | null,
) {
  return deriveHashRuntimeGuard(runtime).level !== "clear" && targetRaisesHashLoad(targetStep, currentStep);
}
function canApplyLocal(status: AlgorithmSamplingTaskStatus, step: TuningSweepStep | null) {
  return Boolean(step) && status !== "blocked" && status !== "reserved" && status !== "done";
}

export function deriveAlgorithmTuningDirective(input: AlgorithmTuningDirectiveInput): AlgorithmTuningDirective {
  const task = input.samplingPlan.primaryTask;
  const kind = directiveKind(task.route);
  const step = task.route === "local" ? localStepForTask(task, input.tuningSweepPlan, input.tuningAnalysis) : null;
  const target = applyTarget(step);
  const runtimeBlocked = task.route === "local" && runtimeBlocksDirectiveApply(input.runtimeEfficiency, input.currentStep, step);

  return {
    kind,
    route: task.route,
    status: task.status,
    primaryTaskId: task.id,
    step,
    applyTarget: target,
    canApplyLocalProfile: task.route === "local" && canApplyLocal(task.status, step) && !runtimeBlocked,
    requireMeasuredPower: task.requiresMeasuredPower,
    requireCoolOrWarmThermals: task.requiresCoolOrWarmThermals,
    requiredSeconds: task.requiredSeconds,
    requiredSamples: task.requiredSamples,
    requiredShareEvents: task.requiredShareEvents,
    summary: task.route === "local" ? localSummary(task, step) : nonLocalSummary(task, kind),
    nextStep: task.route === "local" && step
      ? `${task.nextStep} Target profile: ${step.reason}`
      : task.id === "local_power_density_probe" && task.targetProfile === "max_hashrate"
        ? "Max-hash headroom is already classified; keep the low-power lane unless the evidence roadmap asks for another profile."
        : task.id === "local_power_density_probe"
          ? "Expand the local tuning sweep or add external telemetry before probing above the current knee."
          : task.nextStep,
  };
}

import type { EfficiencyGoal } from "./efficiencyEngine.js";
import type { TuningAnalysis, TuningObservationResult, TuningSweepPlan, TuningSweepStep } from "./efficiencyTuning.js";
import type { HashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";
import {
  MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS,
  MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS,
} from "./hashRuntimeEfficiency.js";
import type { HashRuntimeGuardLevel, HashRuntimeGuardSnapshot, HashRuntimeRecoveryAction } from "./hashRuntimeGuard.js";
import { deriveHashRuntimeGuard } from "./hashRuntimeGuard.js";

export type HashBatchOptimizationStatus = "waiting" | "ready" | "holding" | "blocked";
export type HashBatchOptimizationAction = "collect_evidence" | "increase_intensity" | "decrease_intensity" | "hold";
export type HashBatchOptimizationPressure = "unknown" | "underfilled" | "balanced" | "throttled" | "wasteful";
export type HashBatchOptimizationConfidence = "waiting" | "low" | "medium" | "high";
export type HashBatchRuntimeGuardLevel = HashRuntimeGuardLevel;

export interface HashBatchOptimizationInput {
  tuningSweepPlan: TuningSweepPlan;
  tuningAnalysis: TuningAnalysis;
  currentComputeMode?: TuningSweepStep["computeMode"] | null;
  currentCpuThreads?: number | null;
  currentGpuIntensityPercent?: number | null;
  objective?: EfficiencyGoal | null;
  runtimeEfficiency?: HashRuntimeEfficiencySnapshot | null;
}

export interface HashBatchOptimizationSnapshot {
  status: HashBatchOptimizationStatus;
  action: HashBatchOptimizationAction;
  pressure: HashBatchOptimizationPressure;
  confidence: HashBatchOptimizationConfidence;
  runtimeGuard: HashBatchRuntimeGuardLevel;
  runtimeEfficiencyStatus: HashRuntimeEfficiencySnapshot["status"] | "not_observed";
  runtimePromotionAllowed: boolean;
  runtimeRecoveryAction: HashRuntimeRecoveryAction;
  runtimeQualityLossHashrate: number | null;
  runtimeThrottleHashrateAtRisk: number | null;
  requiredSampleSeconds: number;
  currentStep: TuningSweepStep | null;
  currentResult: TuningObservationResult | null;
  targetStep: TuningSweepStep | null;
  targetGpuIntensityPercent: number | null;
  dispatchLatencyMs: number | null;
  gpuThrottleRatio: number | null;
  shareWasteRatio: number | null;
  canApply: boolean;
  guardrails: string[];
  summary: string;
  nextStep: string;
}

const LOW_DISPATCH_MS = 150;
const HIGH_DISPATCH_MS = 650;
const HIGH_THROTTLE_RATIO = 0.42;
const HIGH_SHARE_WASTE_RATIO = 0.1;
export const MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS = 300;
export const MIN_HASH_BATCH_RUNTIME_SHARE_EVENTS = MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS;
export const MIN_HASH_BATCH_SPARSE_RUNTIME_SECONDS = MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS;
function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function activeGpuMode(mode: TuningSweepStep["computeMode"] | null | undefined) {
  return mode === "gpu" || mode === "hybrid";
}

function sameRuntime(step: TuningSweepStep, input: HashBatchOptimizationInput) {
  if (!activeGpuMode(input.currentComputeMode) || step.computeMode !== input.currentComputeMode) {
    return false;
  }
  if (finiteNonNegative(input.currentGpuIntensityPercent) && step.gpuIntensityPercent !== Number(input.currentGpuIntensityPercent)) {
    return false;
  }
  if (finiteNonNegative(input.currentCpuThreads) && step.computeMode === "hybrid" && step.cpuThreads !== Number(input.currentCpuThreads)) {
    return false;
  }
  return true;
}

function currentStep(input: HashBatchOptimizationInput) {
  return input.tuningSweepPlan.steps.find((step) => sameRuntime(step, input)) ?? null;
}

function currentResult(input: HashBatchOptimizationInput, step: TuningSweepStep | null) {
  if (step) {
    return input.tuningAnalysis.results.find((result) => result.step.id === step.id) ?? null;
  }

  if (!activeGpuMode(input.currentComputeMode) || !finiteNonNegative(input.currentGpuIntensityPercent)) {
    return null;
  }

  return input.tuningAnalysis.results.find((result) => (
    result.step.computeMode === input.currentComputeMode &&
    result.step.gpuIntensityPercent === Number(input.currentGpuIntensityPercent)
  )) ?? null;
}

function comparableGpuSteps(input: HashBatchOptimizationInput) {
  const mode = input.currentComputeMode;
  const cpuThreads = input.currentCpuThreads;
  return input.tuningSweepPlan.steps
    .filter((step) => activeGpuMode(step.computeMode))
    .filter((step) => !activeGpuMode(mode) || step.computeMode === mode)
    .filter((step) => step.computeMode !== "hybrid" || !finiteNonNegative(cpuThreads) || step.cpuThreads === Number(cpuThreads))
    .sort((left, right) => left.gpuIntensityPercent - right.gpuIntensityPercent || left.order - right.order);
}

function adjacentStep(input: HashBatchOptimizationInput, step: TuningSweepStep, direction: "higher" | "lower") {
  const candidates = comparableGpuSteps(input).filter((candidate) => (
    direction === "higher"
      ? candidate.gpuIntensityPercent > step.gpuIntensityPercent
      : candidate.gpuIntensityPercent < step.gpuIntensityPercent
  ));

  return direction === "higher"
    ? candidates[0] ?? null
    : candidates[candidates.length - 1] ?? null;
}

function classifyPressure(result: TuningObservationResult): HashBatchOptimizationPressure {
  const shareWaste = result.shareWasteRatio ?? 0;
  const throttle = result.gpuThrottleRatio ?? 0;
  const dispatchMs = result.gpuDispatchMs;

  if (shareWaste > HIGH_SHARE_WASTE_RATIO) {
    return "wasteful";
  }
  if (result.runtimeDutyStatus === "throttled" || throttle > HIGH_THROTTLE_RATIO || dispatchMs > HIGH_DISPATCH_MS) {
    return "throttled";
  }
  if (dispatchMs > 0 && dispatchMs < LOW_DISPATCH_MS && throttle <= 0.15 && shareWaste <= 0.02) {
    return "underfilled";
  }
  return "balanced";
}

function evidenceConfidence(result: TuningObservationResult): HashBatchOptimizationConfidence {
  const sampleSeconds = result.sampleSeconds ?? 0;
  if (result.thermalStatus === "critical" || result.thermalStatus === "paused") {
    return "low";
  }
  if (sampleSeconds >= 900 && result.shareEvidenceStatus === "proven" && result.powerEvidenceStatus === "measured") {
    return "high";
  }
  if (sampleSeconds >= MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS && result.shareEvidenceStatus === "proven") {
    return "medium";
  }
  return "low";
}

function canApplyDecision(
  status: HashBatchOptimizationStatus,
  action: HashBatchOptimizationAction,
  confidence: HashBatchOptimizationConfidence,
  result: TuningObservationResult,
  targetStep: TuningSweepStep | null,
  objective: EfficiencyGoal,
  runtimeGuard: HashBatchRuntimeGuardLevel,
) {
  if (status !== "ready" || targetStep === null || confidence === "low") {
    return false;
  }

  if (action === "increase_intensity") {
    if (runtimeGuard !== "clear") {
      return false;
    }
    if ((result.sampleSeconds ?? 0) < MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS) {
      return false;
    }
    if (result.shareEvidenceStatus !== "proven") {
      return false;
    }
    if ((objective === "lowest_power" || objective === "max_efficiency") && result.powerEvidenceStatus !== "measured") {
      return false;
    }
    if (!raiseEvidenceReady(result)) {
      return false;
    }
  }

  return true;
}

function waitingSnapshot(
  input: HashBatchOptimizationInput,
  step: TuningSweepStep | null,
  result: TuningObservationResult | null,
  summary: string,
  nextStep: string,
): HashBatchOptimizationSnapshot {
  const runtime = deriveHashRuntimeGuard(input.runtimeEfficiency);
  return {
    status: "waiting",
    action: "collect_evidence",
    pressure: "unknown",
    confidence: result ? evidenceConfidence(result) : "waiting",
    runtimeGuard: runtime.level,
    runtimeEfficiencyStatus: runtime.status,
    runtimePromotionAllowed: runtime.promotionAllowed,
    runtimeRecoveryAction: runtime.recoveryAction,
    runtimeQualityLossHashrate: runtime.qualityLossHashrate,
    runtimeThrottleHashrateAtRisk: runtime.throttleHashrateAtRisk,
    requiredSampleSeconds: MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS,
    currentStep: step,
    currentResult: result,
    targetStep: step,
    targetGpuIntensityPercent: step?.gpuIntensityPercent ?? null,
    dispatchLatencyMs: result?.gpuDispatchMs ?? null,
    gpuThrottleRatio: result?.gpuThrottleRatio ?? null,
    shareWasteRatio: result?.shareWasteRatio ?? null,
    canApply: false,
    guardrails: [
      "keep double SHA-256 and midstate reuse unchanged",
      "record dispatch, throttle, share, thermal, and measured-power evidence before trusting a batch change",
    ],
    summary,
    nextStep,
  };
}

function decisionSnapshot(
  status: HashBatchOptimizationStatus,
  action: HashBatchOptimizationAction,
  pressure: HashBatchOptimizationPressure,
  confidence: HashBatchOptimizationConfidence,
  step: TuningSweepStep,
  result: TuningObservationResult,
  targetStep: TuningSweepStep | null,
  objective: EfficiencyGoal,
  summary: string,
  nextStep: string,
  runtime: HashRuntimeGuardSnapshot = deriveHashRuntimeGuard(null),
): HashBatchOptimizationSnapshot {
  return {
    status,
    action,
    pressure,
    confidence,
    runtimeGuard: runtime.level,
    runtimeEfficiencyStatus: runtime.status,
    runtimePromotionAllowed: runtime.promotionAllowed,
    runtimeRecoveryAction: runtime.recoveryAction,
    runtimeQualityLossHashrate: runtime.qualityLossHashrate,
    runtimeThrottleHashrateAtRisk: runtime.throttleHashrateAtRisk,
    requiredSampleSeconds: MIN_HASH_BATCH_APPLY_SAMPLE_SECONDS,
    currentStep: step,
    currentResult: result,
    targetStep,
    targetGpuIntensityPercent: targetStep?.gpuIntensityPercent ?? null,
    dispatchLatencyMs: result.gpuDispatchMs || null,
    gpuThrottleRatio: result.gpuThrottleRatio,
    shareWasteRatio: result.shareWasteRatio,
    canApply: canApplyDecision(status, action, confidence, result, targetStep, objective, runtime.level),
    guardrails: [
      "do not change the consensus hash path",
      "do not raise intensity when thermal state is hot or critical",
      "require at least 5 minutes of measured batch evidence before raising intensity",
      "require proven share evidence before claiming higher effective hashrate",
      "raise intensity only from stable good/excellent long-run evidence",
      "do not raise intensity while live runtime evidence is watch, wasteful, or throttled",
      "keep pool share waste below 10% before claiming higher effective hashrate",
    ],
    summary,
    nextStep,
  };
}
function objectiveName(objective: EfficiencyGoal) {
  switch (objective) {
    case "lowest_power":
      return "lowest-power";
    case "max_efficiency":
      return "efficiency";
    case "max_hashrate":
      return "max-hash";
    case "balanced":
    default:
      return "balanced";
  }
}

function raiseEvidenceReady(result: TuningObservationResult) {
  return result.stabilityWindowStatus === "stable" &&
    (result.longRunRisk === "excellent" || result.longRunRisk === "good");
}

function runtimeEvidenceReadyForPromotion(runtime: HashRuntimeEfficiencySnapshot | null | undefined) {
  return runtime?.promotionEvidenceReady === true;
}

export function deriveHashBatchOptimization(input: HashBatchOptimizationInput): HashBatchOptimizationSnapshot {
  const objective = input.objective ?? input.tuningSweepPlan.goal;
  const step = currentStep(input);
  const result = currentResult(input, step);

  if (!activeGpuMode(input.currentComputeMode)) {
    return waitingSnapshot(
      input,
      step,
      result,
      "Batch optimizer is waiting for an active GPU or hybrid profile.",
      "Run a GPU profile before tuning dispatch density; CPU throughput is controlled by thread count.",
    );
  }

  if (!step) {
    return waitingSnapshot(
      input,
      null,
      result,
      "Batch optimizer cannot match the active GPU profile to the tuning sweep.",
      "Add the current GPU intensity to the tuning sweep before changing batch density.",
    );
  }

  if (!result) {
    return waitingSnapshot(
      input,
      step,
      null,
      `Batch optimizer is waiting for evidence from ${step.summary}.`,
      "Capture a tuning sample with dispatch latency, throttle time, share counters, thermals, and power evidence.",
    );
  }

  const pressure = classifyPressure(result);
  const confidence = evidenceConfidence(result);
  const lowerStep = adjacentStep(input, step, "lower");
  const higherStep = adjacentStep(input, step, "higher");
  const runtime = deriveHashRuntimeGuard(input.runtimeEfficiency);
  const makeDecision = (
    status: HashBatchOptimizationStatus,
    action: HashBatchOptimizationAction,
    pressure: HashBatchOptimizationPressure,
    confidence: HashBatchOptimizationConfidence,
    step: TuningSweepStep,
    result: TuningObservationResult,
    targetStep: TuningSweepStep | null,
    objective: EfficiencyGoal,
    summary: string,
    nextStep: string,
  ) => decisionSnapshot(
    status,
    action,
    pressure,
    confidence,
    step,
    result,
    targetStep,
    objective,
    summary,
    nextStep,
    runtime,
  );
  if (confidence === "low") {
    return waitingSnapshot(
      input,
      step,
      result,
      `Batch optimizer needs stronger evidence for ${step.summary}.`,
      "Keep the current intensity and capture a longer measured sample before changing dispatch density.",
    );
  }

  if (result.thermalStatus === "hot" || result.thermalStatus === "critical" || result.thermalStatus === "paused") {
    return makeDecision(
      lowerStep ? "ready" : "blocked",
      lowerStep ? "decrease_intensity" : "hold",
      "throttled",
      confidence,
      step,
      result,
      lowerStep,
      objective,
      lowerStep
        ? `Thermals are ${result.thermalStatus}; lower GPU intensity before trusting this hash lane.`
        : `Thermals are ${result.thermalStatus}, but no lower GPU tuning step is available.`,
      lowerStep
        ? `Apply ${lowerStep.summary} and repeat the measured sample.`
        : "Add a lower GPU intensity profile or switch to CPU/eco mode before unattended running.",
    );
  }

  if (pressure === "wasteful" || pressure === "throttled") {
    return makeDecision(
      lowerStep ? "ready" : "holding",
      lowerStep ? "decrease_intensity" : "hold",
      pressure,
      confidence,
      step,
      result,
      lowerStep,
      objective,
      lowerStep
        ? `Batch density is ${pressure}; reduce intensity to protect effective hashrate per watt.`
        : `Batch density is ${pressure}, but this is already the lowest GPU tuning step.`,
      lowerStep
        ? `Apply ${lowerStep.summary}, then confirm share waste and thermals improve.`
        : "Hold this profile and collect another sample before increasing intensity.",
    );
  }

  if (runtime.level !== "clear" && higherStep && (pressure === "underfilled" || objective === "max_hashrate")) {
    return makeDecision(
      "holding",
      "hold",
      pressure,
      confidence,
      step,
      result,
      null,
      objective,
      `Batch promotion is held because ${runtime.summary}.`,
      runtime.nextStep,
    );
  }

  if (pressure === "underfilled") {
    if (objective === "lowest_power") {
      return makeDecision(
        "holding",
        "hold",
        pressure,
        confidence,
        step,
        result,
        null,
        objective,
        `Batch density has headroom, but the ${objectiveName(objective)} objective keeps this low-power lane selected.`,
        "Only increase intensity if the goal changes to efficiency, balanced, or max-hash and thermals remain cool/warm.",
      );
    }
    if (!raiseEvidenceReady(result)) {
      return makeDecision(
        "holding",
        "hold",
        pressure,
        confidence,
        step,
        result,
        null,
        objective,
        `Batch density has headroom, but long-run evidence is ${result.longRunRisk} with a ${result.stabilityWindowStatus} stability window.`,
        "Hold this profile until the stability window is stable and long-run risk is good or excellent before increasing intensity.",
      );
    }
    if (!runtimeEvidenceReadyForPromotion(input.runtimeEfficiency)) {
      return makeDecision(
        "holding",
        "hold",
        pressure,
        confidence,
        step,
        result,
        null,
        objective,
        "Batch density has headroom, but live runtime evidence is not clean enough to raise GPU intensity.",
        "Run the current profile until live hashrate, share quality, and GPU duty are efficient before probing higher intensity.",
      );
    }
    return makeDecision(
      higherStep ? "ready" : "holding",
      higherStep ? "increase_intensity" : "hold",
      pressure,
      confidence,
      step,
      result,
      higherStep,
      objective,
      higherStep
        ? "Dispatches are short with low waste; a higher intensity sample can improve compute density."
        : "Dispatches are short with low waste, but no higher GPU tuning step is available.",
      higherStep
        ? `Apply ${higherStep.summary} and re-measure watts, dispatch latency, share waste, and thermals.`
        : "Expand the GPU tuning sweep with a higher intensity profile before chasing more hashrate.",
    );
  }

  if (objective === "max_hashrate" && higherStep && (result.shareWasteRatio ?? 0) <= 0.05 && !raiseEvidenceReady(result)) {
    return makeDecision(
      "holding",
      "hold",
      pressure,
      confidence,
      step,
      result,
      null,
      objective,
      `Max-hash has headroom, but long-run evidence is ${result.longRunRisk} with a ${result.stabilityWindowStatus} stability window.`,
      "Hold this profile until the stability window is stable and long-run risk is good or excellent before probing higher intensity.",
    );
  }
  if (objective === "max_hashrate" && higherStep && raiseEvidenceReady(result) && (result.shareWasteRatio ?? 0) <= 0.05) {
    if (!runtimeEvidenceReadyForPromotion(input.runtimeEfficiency)) {
      return makeDecision(
        "holding",
        "hold",
        pressure,
        confidence,
        step,
        result,
        null,
        objective,
        "Max-hash has headroom, but live runtime evidence is not clean enough to raise GPU intensity.",
        "Run the current profile until live hashrate, share quality, and GPU duty are efficient before probing higher intensity.",
      );
    }
    return makeDecision(
      "ready",
      "increase_intensity",
      pressure,
      confidence,
      step,
      result,
      higherStep,
      objective,
      "Current batch evidence is stable; max-hash mode can probe the next intensity lane.",
      `Apply ${higherStep.summary} as a measured burst, then compare effective hashrate and watts.`,
    );
  }

  return makeDecision(
    "holding",
    "hold",
    pressure,
    confidence,
    step,
    result,
    null,
    objective,
    `Batch density is balanced for the ${objectiveName(objective)} objective.`,
    "Hold this profile until the sampling plan asks for the next local power-density or headroom probe.",
  );
}
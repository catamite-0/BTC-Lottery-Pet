import type { AlgorithmObjectiveActionPlan } from "./algorithmObjectiveActionPlan.js";
import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmSamplingPlan, AlgorithmSamplingTaskId, AlgorithmSamplingTaskRoute } from "./algorithmSamplingPlan.js";
import type { AlgorithmTuningDirective } from "./algorithmTuningDirective.js";

export type AlgorithmObjectiveExperimentStage =
  | "collect_low_power_evidence"
  | "measure_high_hash_headroom"
  | "run_density_lane"
  | "hold_high_hash"
  | "verify_kernel_benchmark"
  | "repair_kernel_proof"
  | "recover_runtime"
  | "validate_external_dry_run"
  | "research_review"
  | "monitor";

export type AlgorithmObjectiveExperimentCaptureMode = "local_sample" | "external_dry_run" | "monitor_only";

export interface AlgorithmObjectiveExperimentCapturePolicy {
  enabled: boolean;
  mode: AlgorithmObjectiveExperimentCaptureMode;
  requiredStepId: string | null;
  minCaptureSeconds: number | null;
  refreshSeconds: number | null;
  requireMeasuredPower: boolean;
  requireCoolOrWarmThermals: boolean;
  requiredShareEvents: number | null;
  applyBeforeCapture: boolean;
  summary: string;
}

export interface AlgorithmObjectiveExperimentPlan {
  schemaVersion: 1;
  stage: AlgorithmObjectiveExperimentStage;
  route: AlgorithmSamplingTaskRoute;
  primaryTaskId: AlgorithmSamplingTaskId;
  objectiveGap: AlgorithmObjectiveCertificate["primaryEvidenceGap"];
  targetProfileStepId: string | null;
  targetProfileSummary: string | null;
  targetComputeMode: string | null;
  targetCpuThreads: number | null;
  targetGpuIntensityPercent: number | null;
  requiredSeconds: number | null;
  remainingSeconds: number | null;
  requiredSamples: number | null;
  remainingSamples: number | null;
  requiredShareEvents: number | null;
  remainingShareEvents: number | null;
  requiresMeasuredPower: boolean;
  requiresCoolOrWarmThermals: boolean;
  canApplyLocalProfile: boolean;
  capturePolicy: AlgorithmObjectiveExperimentCapturePolicy;
  miningStartAllowed: false;
  externalMiningAllowed: false;
  successCriteria: string[];
  evidenceChecklist: string[];
  stopConditions: string[];
  summary: string;
  nextStep: string;
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function stageFor(action: AlgorithmObjectiveActionPlan["action"], directive: AlgorithmTuningDirective): AlgorithmObjectiveExperimentStage {
  switch (action) {
    case "capture_local_evidence":
      return "collect_low_power_evidence";
    case "measure_burst_headroom":
      return "measure_high_hash_headroom";
    case "run_density_lane":
    case "keep_manual_burst_available":
      return "run_density_lane";
    case "hold_max_hash":
      return "hold_high_hash";
    case "verify_kernel_benchmark":
      return "verify_kernel_benchmark";
    case "repair_kernel_proof":
      return "repair_kernel_proof";
    case "recover_runtime_guard":
      return "recover_runtime";
    case "validate_external_dry_run":
      return "validate_external_dry_run";
    case "monitor":
      return directive.kind === "research_review" ? "research_review" : "monitor";
  }
}

function secondsText(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = Math.trunc(seconds / 60);
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.trunc(seconds)} seconds`;
}

function summaryFor(stage: AlgorithmObjectiveExperimentStage, directive: AlgorithmTuningDirective) {
  switch (stage) {
    case "collect_low_power_evidence":
      return `Objective experiment: collect low-power evidence via ${directive.route}.`;
    case "measure_high_hash_headroom":
      return "Objective experiment: measure max-hash headroom without promoting it to unattended use.";
    case "run_density_lane":
      return "Objective experiment: keep the measured density lane as default and monitor for regression.";
    case "hold_high_hash":
      return "Objective experiment: hold max-hash and preserve the lower-watt density lane.";
    case "verify_kernel_benchmark":
      return "Objective experiment: run or import the fixed-window midstate benchmark before runtime promotion.";
    case "repair_kernel_proof":
      return "Objective experiment: repair kernel proof or fall back before high-hash promotion.";
    case "recover_runtime":
      return "Objective experiment: recover useful hash density before any profile promotion.";
    case "validate_external_dry_run":
      return "Objective experiment: validate external work routing in dry-run only.";
    case "research_review":
      return "Objective experiment: review the algorithm claim before runtime routing can change.";
    case "monitor":
      return "Objective experiment: monitor the current operating point until a stronger evidence task appears.";
  }
}

function targetSummary(directive: AlgorithmTuningDirective) {
  if (!directive.step) {
    return null;
  }
  return directive.step.reason || directive.step.summary;
}

function capturePolicyFor(
  stage: AlgorithmObjectiveExperimentStage,
  primaryTask: AlgorithmSamplingPlan["primaryTask"],
  directive: AlgorithmTuningDirective,
  actionPlan: AlgorithmObjectiveActionPlan,
): AlgorithmObjectiveExperimentCapturePolicy {
  const localCaptureStage = stage === "collect_low_power_evidence" ||
    stage === "measure_high_hash_headroom" ||
    stage === "run_density_lane" ||
    stage === "recover_runtime";
  const localCapture = primaryTask.route === "local" && localCaptureStage;
  const externalDryRun = primaryTask.route === "external" || stage === "validate_external_dry_run";
  const requiredStepId = directive.applyTarget?.stepId ?? null;
  const minCaptureSeconds = primaryTask.requiredSeconds ?? directive.requiredSeconds ?? directive.step?.sampleSeconds ?? null;
  const mode: AlgorithmObjectiveExperimentCaptureMode = localCapture
    ? "local_sample"
    : externalDryRun ? "external_dry_run" : "monitor_only";
  const enabled = mode === "local_sample" || mode === "external_dry_run";
  const applyBeforeCapture = mode === "local_sample" && actionPlan.localProfileApplyAllowed && Boolean(requiredStepId);
  const localSummary = applyBeforeCapture
    ? `Apply ${requiredStepId} before capture, then record the objective sample.`
    : requiredStepId
      ? `Capture only after the active profile matches ${requiredStepId}.`
      : "Capture the current local density lane when the evidence window is ready.";

  return {
    enabled,
    mode,
    requiredStepId: mode === "local_sample" ? requiredStepId : null,
    minCaptureSeconds: mode === "local_sample" ? minCaptureSeconds : null,
    refreshSeconds: mode === "local_sample" ? minCaptureSeconds : null,
    requireMeasuredPower: mode === "local_sample" && primaryTask.requiresMeasuredPower,
    requireCoolOrWarmThermals: mode === "local_sample" && primaryTask.requiresCoolOrWarmThermals,
    requiredShareEvents: mode === "local_sample" ? primaryTask.requiredShareEvents : null,
    applyBeforeCapture,
    summary: mode === "local_sample"
      ? localSummary
      : mode === "external_dry_run"
        ? "Use external dry-run/proof controls; real external mining start remains disabled."
        : "Monitor only; no new objective sample is required yet.",
  };
}

function evidenceChecklistFor(directive: AlgorithmTuningDirective, actionPlan: AlgorithmObjectiveActionPlan) {
  const seconds = secondsText(directive.requiredSeconds);
  return unique([
    seconds ? `${seconds} stable runtime window` : "",
    directive.requireMeasuredPower ? "measured wall or device watts" : "",
    directive.requireCoolOrWarmThermals ? "cool or warm thermal state" : "",
    directive.requiredShareEvents ? `${directive.requiredShareEvents} accepted/rejected/stale/drop share events` : "",
    ...actionPlan.evidenceToRecord,
  ]);
}

function successCriteriaFor(
  certificate: AlgorithmObjectiveCertificate,
  samplingPlan: AlgorithmSamplingPlan,
  actionPlan: AlgorithmObjectiveActionPlan,
) {
  return unique([
    samplingPlan.primaryTask.successCriteria,
    certificate.lowPowerReady ? "low-power density lane remains ready" : "low-power evidence gap is closed",
    certificate.highHashReady ? "max-hash burst remains manual and verified" : "high-hash evidence gap is classified without bypassing consensus rules",
    certificate.primaryEvidenceGap === "kernel_evidence_wait" ? "fixed-window midstate benchmark is captured before high-hash promotion" : "",
    certificate.primaryEvidenceGap === "kernel_blocked" ? "midstate proof is repaired or full-header baseline remains active" : "",
    actionPlan.localProfileApplyAllowed ? "profile apply gate stays open until the sample is captured" : "no automatic mining profile change is required",
  ]);
}

function stopConditionsFor(actionPlan: AlgorithmObjectiveActionPlan, certificate: AlgorithmObjectiveCertificate) {
  return unique([
    ...actionPlan.stopConditions,
    "accepted share rate collapses or rejected/stale/drop share waste rises",
    "GPU throttle or thermal state becomes hot, critical, or paused",
    certificate.primaryEvidenceGap === "kernel_evidence_wait" ? "benchmark is missing, malformed, or not fixed-window" : "",
    certificate.primaryEvidenceGap === "kernel_blocked" ? "midstate equivalence proof fails or checksum mismatch remains" : "",
    certificate.primaryEvidenceGap === "kernel_regression" ? "midstate benchmark regresses or checksum fails" : "",
    certificate.primaryEvidenceGap === "runtime_guard" ? "runtime guard remains blocked after lowering load" : "",
  ]);
}

export function deriveAlgorithmObjectiveExperimentPlan(args: {
  certificate: AlgorithmObjectiveCertificate;
  samplingPlan: AlgorithmSamplingPlan;
  tuningDirective: AlgorithmTuningDirective;
  actionPlan: AlgorithmObjectiveActionPlan;
}): AlgorithmObjectiveExperimentPlan {
  const { certificate, samplingPlan, tuningDirective, actionPlan } = args;
  const primaryTask = samplingPlan.primaryTask;
  const stage = stageFor(actionPlan.action, tuningDirective);

  return {
    schemaVersion: 1,
    stage,
    route: primaryTask.route,
    primaryTaskId: primaryTask.id,
    objectiveGap: certificate.primaryEvidenceGap,
    targetProfileStepId: tuningDirective.applyTarget?.stepId ?? null,
    targetProfileSummary: targetSummary(tuningDirective),
    targetComputeMode: tuningDirective.applyTarget?.computeMode ?? null,
    targetCpuThreads: tuningDirective.applyTarget?.cpuThreads ?? null,
    targetGpuIntensityPercent: tuningDirective.applyTarget?.gpuIntensityPercent ?? null,
    requiredSeconds: primaryTask.requiredSeconds,
    remainingSeconds: primaryTask.remainingSeconds,
    requiredSamples: primaryTask.requiredSamples,
    remainingSamples: primaryTask.remainingSamples,
    requiredShareEvents: primaryTask.requiredShareEvents,
    remainingShareEvents: primaryTask.remainingShareEvents,
    requiresMeasuredPower: primaryTask.requiresMeasuredPower,
    requiresCoolOrWarmThermals: primaryTask.requiresCoolOrWarmThermals,
    canApplyLocalProfile: actionPlan.localProfileApplyAllowed && tuningDirective.canApplyLocalProfile,
    capturePolicy: capturePolicyFor(stage, primaryTask, tuningDirective, actionPlan),
    miningStartAllowed: false,
    externalMiningAllowed: false,
    successCriteria: successCriteriaFor(certificate, samplingPlan, actionPlan),
    evidenceChecklist: evidenceChecklistFor(tuningDirective, actionPlan),
    stopConditions: stopConditionsFor(actionPlan, certificate),
    summary: summaryFor(stage, tuningDirective),
    nextStep: actionPlan.nextStep || tuningDirective.nextStep || samplingPlan.nextStep,
  };
}
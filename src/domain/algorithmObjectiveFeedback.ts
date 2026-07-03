import type { AlgorithmObjectiveExperimentPlan } from "./algorithmObjectiveExperiment.js";
import type { TuningAnalysis, TuningObservationResult, TuningSweepPlan, TuningSweepStep } from "./efficiencyTuning.js";

export type AlgorithmObjectiveFeedbackStatus =
  | "waiting_capture"
  | "captured_ready"
  | "needs_retest"
  | "advance_profile"
  | "hold_profile"
  | "external_dry_run"
  | "verify_kernel_benchmark"
  | "repair_kernel_proof"
  | "monitor";

export type AlgorithmObjectiveFeedbackRecommendation =
  | "capture_target"
  | "retest_target"
  | "adopt_density"
  | "probe_next_profile"
  | "manual_burst_ready"
  | "hold_high_hash"
  | "external_dry_run"
  | "verify_kernel_benchmark"
  | "repair_kernel_proof"
  | "monitor";

export interface AlgorithmObjectiveFeedbackSnapshot {
  schemaVersion: 1;
  status: AlgorithmObjectiveFeedbackStatus;
  recommendation: AlgorithmObjectiveFeedbackRecommendation;
  targetStepId: string | null;
  capturedStepId: string | null;
  capturedStepSummary: string | null;
  capturedHashrate: number | null;
  capturedWatts: number | null;
  capturedQualityScore: number | null;
  capturedLongRunRisk: TuningObservationResult["longRunRisk"] | null;
  capturedStabilityWindowStatus: TuningObservationResult["stabilityWindowStatus"] | null;
  capturedShareEvidenceStatus: TuningObservationResult["shareEvidenceStatus"] | null;
  nextProfileStepId: string | null;
  nextProfileSummary: string | null;
  nextProfileComputeMode: TuningSweepStep["computeMode"] | null;
  nextProfileCpuThreads: number | null;
  nextProfileGpuIntensityPercent: number | null;
  missingEvidence: string[];
  canPromote: boolean;
  summary: string;
  nextStep: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function totalShareEvents(result: TuningObservationResult) {
  return result.acceptedShares + result.rejectedShares + result.staleSharesDropped + result.queuedSharesDropped;
}

function targetStepId(experiment: AlgorithmObjectiveExperimentPlan) {
  return experiment.capturePolicy.requiredStepId ?? experiment.targetProfileStepId;
}

function resultForTarget(analysis: TuningAnalysis, stepId: string | null) {
  if (!stepId) {
    return null;
  }
  return analysis.results.find((result) => result.step.id === stepId) ?? null;
}

function evidenceGaps(experiment: AlgorithmObjectiveExperimentPlan, result: TuningObservationResult | null) {
  if (experiment.capturePolicy.mode === "monitor_only") {
    if (experiment.stage === "verify_kernel_benchmark") {
      return ["fixed-window kernel benchmark"];
    }
    if (experiment.stage === "repair_kernel_proof") {
      return ["midstate equivalence and performance proof"];
    }
    return [];
  }
  if (experiment.capturePolicy.mode === "external_dry_run" && !targetStepId(experiment)) {
    return experiment.evidenceChecklist.length > 0 ? experiment.evidenceChecklist : ["external dry-run proof evidence"];
  }

  if (!result) {
    return ["target profile sample missing"];
  }

  const gaps: string[] = [];
  const requiredSeconds = experiment.capturePolicy.minCaptureSeconds ?? experiment.requiredSeconds;
  if (finitePositive(requiredSeconds) && (!finitePositive(result.sampleSeconds) || Number(result.sampleSeconds) < Number(requiredSeconds))) {
    gaps.push(`needs ${Math.round(Number(requiredSeconds) / 60)} minute sample window`);
  }
  if (experiment.capturePolicy.requireMeasuredPower && result.powerEvidenceStatus !== "measured") {
    gaps.push("measured watts missing");
  }
  if (finitePositive(experiment.capturePolicy.requiredShareEvents) && totalShareEvents(result) < Number(experiment.capturePolicy.requiredShareEvents)) {
    gaps.push(`needs ${experiment.capturePolicy.requiredShareEvents} share events`);
  }
  if (experiment.capturePolicy.requireCoolOrWarmThermals && (result.thermalStatus === "hot" || result.thermalStatus === "critical" || result.thermalStatus === "paused")) {
    gaps.push("thermal state is not cool or warm");
  }
  if (result.stabilityWindowStatus === "probing" || result.stabilityWindowStatus === "unknown") {
    gaps.push("stability window incomplete");
  }
  if (result.stabilityWindowStatus === "unstable" || result.stabilityWindowStatus === "unsafe") {
    gaps.push("stability window unsafe");
  }
  if (result.shareEvidenceStatus === "none") {
    gaps.push("share evidence missing");
  }
  if (result.longRunRisk === "avoid") {
    gaps.push("long-run risk is avoid");
  }
  return Array.from(new Set(gaps));
}

function nextHigherStep(plan: TuningSweepPlan, analysis: TuningAnalysis, result: TuningObservationResult | null) {
  if (!result) {
    return null;
  }
  const observedStepIds = new Set(analysis.results.map((candidate) => candidate.step.id));
  const laterSteps = plan.steps
    .slice()
    .sort((left, right) => left.order - right.order)
    .filter((step) => step.order > result.step.order);
  return laterSteps.find((step) => !observedStepIds.has(step.id)) ?? null;
}

function profileFields(step: TuningSweepStep | null) {
  return {
    nextProfileStepId: step?.id ?? null,
    nextProfileSummary: step?.summary ?? null,
    nextProfileComputeMode: step?.computeMode ?? null,
    nextProfileCpuThreads: step?.cpuThreads ?? null,
    nextProfileGpuIntensityPercent: step?.gpuIntensityPercent ?? null,
  };
}

function resultFields(result: TuningObservationResult | null) {
  return {
    capturedStepId: result?.step.id ?? null,
    capturedStepSummary: result?.step.summary ?? null,
    capturedHashrate: result?.effectiveHashrate ?? null,
    capturedWatts: result?.watts ?? null,
    capturedQualityScore: result ? Math.round(result.qualityScore * 100) : null,
    capturedLongRunRisk: result?.longRunRisk ?? null,
    capturedStabilityWindowStatus: result?.stabilityWindowStatus ?? null,
    capturedShareEvidenceStatus: result?.shareEvidenceStatus ?? null,
  };
}

function readyForPromotion(result: TuningObservationResult) {
  return result.longRunRisk === "excellent" || result.longRunRisk === "good";
}

function densityBaselineForHighHash(analysis: TuningAnalysis, result: TuningObservationResult) {
  const candidates = new Map<string, TuningObservationResult>();
  const add = (candidate: TuningObservationResult | null) => {
    if (!candidate || candidate.step.id === result.step.id) {
      return;
    }
    if (
      candidate.powerEvidenceStatus !== "measured" ||
      candidate.longRunRisk === "avoid" ||
      !finitePositive(candidate.watts) ||
      !finitePositive(candidate.qualityAdjustedHashrate)
    ) {
      return;
    }
    candidates.set(candidate.step.id, candidate);
  };

  add(analysis.powerDensityKnee);
  add(analysis.bestEfficiency);
  add(analysis.lowestPower);
  analysis.results
    .filter((candidate) => candidate.step.order < result.step.order)
    .filter((candidate) => finitePositive(candidate.watts) && finitePositive(candidate.qualityAdjustedHashrate))
    .slice()
    .sort((left, right) => Number(left.watts) - Number(right.watts) || left.step.order - right.step.order)
    .forEach(add);

  return Array.from(candidates.values())[0] ?? null;
}

function highHashFitsDensityBaseline(result: TuningObservationResult, analysis: TuningAnalysis) {
  if (
    result.powerEvidenceStatus !== "measured" ||
    !finitePositive(result.watts) ||
    !finitePositive(result.qualityAdjustedHashrate)
  ) {
    return false;
  }

  const baseline = densityBaselineForHighHash(analysis, result);
  if (!baseline || !finitePositive(baseline.watts) || !finitePositive(baseline.qualityAdjustedHashrate)) {
    return false;
  }

  return result.qualityAdjustedHashrate > baseline.qualityAdjustedHashrate &&
    Number(result.watts) <= Number(baseline.watts) * 1.1;
}

export function deriveAlgorithmObjectiveFeedback(args: {
  experiment: AlgorithmObjectiveExperimentPlan;
  tuningSweepPlan: TuningSweepPlan;
  tuningAnalysis: TuningAnalysis;
}): AlgorithmObjectiveFeedbackSnapshot {
  const { experiment, tuningSweepPlan, tuningAnalysis } = args;
  const targetId = targetStepId(experiment);
  const result = resultForTarget(tuningAnalysis, targetId);
  const missingEvidence = evidenceGaps(experiment, result);
  const nextStep = nextHigherStep(tuningSweepPlan, tuningAnalysis, result);
  const base = {
    schemaVersion: 1 as const,
    targetStepId: targetId,
    ...resultFields(result),
    ...profileFields(nextStep),
    missingEvidence,
    canPromote: false,
  };

  if (experiment.capturePolicy.mode === "external_dry_run") {
    return {
      ...base,
      status: "external_dry_run",
      recommendation: "external_dry_run",
      summary: "Objective feedback: external route remains in dry-run proof mode.",
      nextStep: experiment.nextStep,
    };
  }

  if (experiment.capturePolicy.mode === "monitor_only") {
    if (experiment.stage === "verify_kernel_benchmark") {
      return {
        ...base,
        status: "verify_kernel_benchmark",
        recommendation: "verify_kernel_benchmark",
        summary: "Objective feedback: fixed-window midstate benchmark is required before runtime kernel promotion.",
        nextStep: experiment.nextStep,
      };
    }
    if (experiment.stage === "repair_kernel_proof") {
      return {
        ...base,
        status: "repair_kernel_proof",
        recommendation: "repair_kernel_proof",
        summary: "Objective feedback: repair or rerun midstate proof before high-hash promotion.",
        nextStep: experiment.nextStep,
      };
    }
    const hold = experiment.stage === "hold_high_hash";
    return {
      ...base,
      status: hold ? "hold_profile" : "monitor",
      recommendation: hold ? "hold_high_hash" : "monitor",
      summary: hold
        ? "Objective feedback: high-hash profile is intentionally held; preserve the density lane."
        : "Objective feedback: monitor current evidence until another objective sample is required.",
      nextStep: experiment.nextStep,
    };
  }

  if (!result) {
    return {
      ...base,
      status: "waiting_capture",
      recommendation: "capture_target",
      summary: "Objective feedback: waiting for the target local profile sample.",
      nextStep: experiment.capturePolicy.summary,
    };
  }

  if (missingEvidence.length > 0) {
    return {
      ...base,
      status: "needs_retest",
      recommendation: "retest_target",
      summary: `Objective feedback: ${result.step.summary} needs retest evidence: ${missingEvidence.slice(0, 3).join(", ")}.`,
      nextStep: "Retest the same objective profile before changing the power envelope.",
    };
  }

  if (experiment.stage === "measure_high_hash_headroom") {
    const promote = readyForPromotion(result);
    const densityCandidate = promote && highHashFitsDensityBaseline(result, tuningAnalysis);
    return {
      ...base,
      status: promote ? "advance_profile" : "hold_profile",
      recommendation: promote
        ? densityCandidate ? "adopt_density" : "manual_burst_ready"
        : "hold_high_hash",
      canPromote: promote,
      summary: promote
        ? densityCandidate
          ? `Objective feedback: ${result.step.summary} is verified as a higher-hash density lane within the current watt envelope.`
          : `Objective feedback: ${result.step.summary} is verified as a manual max-hash burst candidate.`
        : `Objective feedback: ${result.step.summary} should stay held because long-run risk is ${result.longRunRisk}.`,
      nextStep: promote
        ? densityCandidate
          ? "Use the verified high-hash density lane as the default while measured watts, shares, and thermals stay clean."
          : "Keep the density lane as default and expose max-hash only as a manual burst."
        : "Stay on the lower-watt density lane and retest only if thermal/share conditions improve.",
    };
  }

  if (nextStep) {
    return {
      ...base,
      status: "captured_ready",
      recommendation: "probe_next_profile",
      summary: `Objective feedback: ${result.step.summary} is captured; the next unmeasured profile is ${nextStep.summary}.`,
      nextStep: "Probe the next profile only if the objective action remains local and runtime guard stays clear.",
    };
  }

  return {
    ...base,
    status: "captured_ready",
    recommendation: "adopt_density",
    canPromote: true,
    summary: `Objective feedback: ${result.step.summary} is the best captured density point for this objective pass.`,
    nextStep: "Use this density lane as the default until new evidence opens a better route.",
  };
}
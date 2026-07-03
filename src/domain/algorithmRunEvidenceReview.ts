import type { AlgorithmPowerHashEnvelopeSnapshot } from "./algorithmPowerHashEnvelope.js";
import type { AlgorithmRunWindowPlanSnapshot } from "./algorithmRunWindowPlan.js";
import type { TuningAnalysis, TuningObservationResult } from "./efficiencyTuning.js";

export type AlgorithmRunEvidenceReviewStatus =
  | "waiting_sample"
  | "window_incomplete"
  | "within_plan"
  | "underperforming"
  | "unsafe"
  | "external_dry_run"
  | "runtime_blocked"
  | "monitor";

export type AlgorithmRunEvidenceReviewAction =
  | "capture_window"
  | "extend_window"
  | "keep_plan"
  | "lower_load"
  | "hold_burst"
  | "validate_external"
  | "recover_runtime"
  | "monitor";

export interface AlgorithmRunEvidenceReviewSnapshot {
  schemaVersion: 1;
  status: AlgorithmRunEvidenceReviewStatus;
  action: AlgorithmRunEvidenceReviewAction;
  runWindowMode: AlgorithmRunWindowPlanSnapshot["mode"];
  envelopeMode: AlgorithmPowerHashEnvelopeSnapshot["mode"];
  targetStepId: string | null;
  reviewedStepId: string | null;
  requiredSampleSeconds: number | null;
  observedSampleSeconds: number | null;
  captureProgress: number;
  plannedHashrate: number | null;
  observedHashrate: number | null;
  hashrateDeltaPercent: number | null;
  plannedWatts: number | null;
  observedWatts: number | null;
  wattsDeltaPercent: number | null;
  acceptedShares: number | null;
  rejectedShares: number | null;
  staleSharesDropped: number | null;
  queuedSharesDropped: number | null;
  shareWasteRatio: number | null;
  shareEvidenceStatus: TuningObservationResult["shareEvidenceStatus"] | null;
  powerEvidenceStatus: TuningObservationResult["powerEvidenceStatus"] | null;
  stabilityWindowStatus: TuningObservationResult["stabilityWindowStatus"] | null;
  thermalStatus: TuningObservationResult["thermalStatus"] | null;
  longRunRisk: TuningObservationResult["longRunRisk"] | null;
  longRunScore: number | null;
  missingEvidence: string[];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

export interface AlgorithmRunEvidenceReviewInput {
  runWindowPlan: AlgorithmRunWindowPlanSnapshot;
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot;
  tuningAnalysis: TuningAnalysis;
}

const DEFAULT_REVIEW_SECONDS = 300;
const HASHRATE_UNDERPERFORM_DELTA_PERCENT = -10;
const WATTS_OVER_PLAN_DELTA_PERCENT = 10;
const SHARE_WASTE_UNDERPERFORM_RATIO = 0.05;
const SHARE_WASTE_UNSAFE_RATIO = 0.12;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? Number(value) : null;
}

function roundNullable(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clampRatio(value: number) {
  return Math.max(0, Math.min(1, value));
}

function percentDelta(observed: number | null, planned: number | null) {
  if (!finitePositive(observed) || !finitePositive(planned)) {
    return null;
  }
  return roundNullable((Number(observed) - Number(planned)) * 100 / Number(planned), 1);
}

function resultPreferenceScore(result: TuningObservationResult) {
  const sampleScore = finitePositive(result.sampleSeconds) ? Number(result.sampleSeconds) : 0;
  const powerScore = result.powerEvidenceStatus === "measured" ? 10_000 : 0;
  const shareScore = result.shareEvidenceStatus === "proven"
    ? 6_000
    : result.shareEvidenceStatus === "thin"
      ? 3_000
      : 0;
  const stabilityScore = result.stabilityWindowStatus === "stable"
    ? 4_000
    : result.stabilityWindowStatus === "noisy"
      ? 2_000
      : 0;
  return sampleScore + powerScore + shareScore + stabilityScore + result.qualityScore * 100;
}

function selectReviewResult(analysis: TuningAnalysis, targetStepId: string | null) {
  if (targetStepId) {
    const exact = analysis.results.find((result) => result.step.id === targetStepId);
    if (exact) {
      return exact;
    }
  }

  return analysis.results
    .slice()
    .sort((left, right) => resultPreferenceScore(right) - resultPreferenceScore(left))
    [0] ?? null;
}

function reviewSeconds(
  runWindowPlan: AlgorithmRunWindowPlanSnapshot,
  result: TuningObservationResult | null,
) {
  return [
    runWindowPlan.captureSeconds,
    runWindowPlan.cycleSeconds,
    result?.step.sampleSeconds,
    DEFAULT_REVIEW_SECONDS,
  ].find((value) => finitePositive(value)) ?? DEFAULT_REVIEW_SECONDS;
}

function plannedHashrate(
  runWindowPlan: AlgorithmRunWindowPlanSnapshot,
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot,
) {
  return finiteNumber(runWindowPlan.projectedAverageHashrate) ??
    finiteNumber(powerHashEnvelope.projectedAverageHashrate) ??
    finiteNumber(powerHashEnvelope.defaultHashrate);
}

function plannedWatts(
  runWindowPlan: AlgorithmRunWindowPlanSnapshot,
  powerHashEnvelope: AlgorithmPowerHashEnvelopeSnapshot,
) {
  return finiteNumber(runWindowPlan.projectedAverageWatts) ??
    finiteNumber(powerHashEnvelope.projectedAverageWatts) ??
    finiteNumber(powerHashEnvelope.defaultWatts);
}

function shareCount(result: TuningObservationResult | null, key: "acceptedShares" | "rejectedShares" | "staleSharesDropped" | "queuedSharesDropped") {
  return result ? result[key] : null;
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter((item) => item.trim().length > 0)));
}

function baseGuardrails(input: AlgorithmRunEvidenceReviewInput, extra: string[]) {
  return unique([
    ...extra,
    ...input.runWindowPlan.guardrails,
    ...input.powerHashEnvelope.guardrails,
  ]).slice(0, 6);
}

function signedPercent(value: number | null) {
  if (value === null) {
    return "waiting";
  }
  return `${value > 0 ? "+" : ""}${value}%`;
}

function snapshot(
  input: AlgorithmRunEvidenceReviewInput,
  status: AlgorithmRunEvidenceReviewStatus,
  action: AlgorithmRunEvidenceReviewAction,
  result: TuningObservationResult | null,
  missingEvidence: string[],
  summary: string,
  nextStep: string,
  guardrails: string[],
): AlgorithmRunEvidenceReviewSnapshot {
  const requiredSampleSeconds = status === "monitor"
    ? null
    : result === null && status === "waiting_sample"
      ? reviewSeconds(input.runWindowPlan, null)
      : reviewSeconds(input.runWindowPlan, result);
  const observedSampleSeconds = finiteNumber(result?.sampleSeconds);
  const plannedHash = plannedHashrate(input.runWindowPlan, input.powerHashEnvelope);
  const observedHashrate = finiteNumber(result?.effectiveHashrate);
  const plannedPower = plannedWatts(input.runWindowPlan, input.powerHashEnvelope);
  const observedPower = finiteNumber(result?.watts);
  const progress = finitePositive(observedSampleSeconds) && finitePositive(requiredSampleSeconds)
    ? clampRatio(Number(observedSampleSeconds) / Number(requiredSampleSeconds))
    : 0;

  return {
    schemaVersion: 1,
    status,
    action,
    runWindowMode: input.runWindowPlan.mode,
    envelopeMode: input.powerHashEnvelope.mode,
    targetStepId: input.runWindowPlan.requiredStepId,
    reviewedStepId: result?.step.id ?? null,
    requiredSampleSeconds,
    observedSampleSeconds,
    captureProgress: roundNullable(progress, 2) ?? 0,
    plannedHashrate: plannedHash,
    observedHashrate,
    hashrateDeltaPercent: percentDelta(observedHashrate, plannedHash),
    plannedWatts: plannedPower,
    observedWatts: observedPower,
    wattsDeltaPercent: percentDelta(observedPower, plannedPower),
    acceptedShares: shareCount(result, "acceptedShares"),
    rejectedShares: shareCount(result, "rejectedShares"),
    staleSharesDropped: shareCount(result, "staleSharesDropped"),
    queuedSharesDropped: shareCount(result, "queuedSharesDropped"),
    shareWasteRatio: finiteNumber(result?.shareWasteRatio),
    shareEvidenceStatus: result?.shareEvidenceStatus ?? null,
    powerEvidenceStatus: result?.powerEvidenceStatus ?? null,
    stabilityWindowStatus: result?.stabilityWindowStatus ?? null,
    thermalStatus: result?.thermalStatus ?? null,
    longRunRisk: result?.longRunRisk ?? null,
    longRunScore: finiteNumber(result?.longRunScore),
    missingEvidence,
    guardrails,
    summary,
    nextStep,
  };
}

function missingEvidence(result: TuningObservationResult, requiredSampleSeconds: number) {
  const missing: string[] = [];
  if (!finitePositive(result.sampleSeconds)) {
    missing.push("timed sample");
  } else if (Number(result.sampleSeconds) < requiredSampleSeconds) {
    missing.push("full run window");
  }
  if (result.powerEvidenceStatus !== "measured" || !finitePositive(result.watts)) {
    missing.push("measured watts");
  }
  if (result.shareEvidenceStatus === "none") {
    missing.push("share counters");
  }
  if (result.stabilityWindowStatus === "unknown" || result.stabilityWindowStatus === "probing") {
    missing.push("stability window");
  }
  if (result.thermalStatus === "unknown") {
    missing.push("temperature telemetry");
  }
  return missing;
}

function unsafeReasons(result: TuningObservationResult) {
  const reasons: string[] = [];
  if (result.longRunRisk === "avoid") {
    reasons.push("long-run risk is avoid");
  }
  if (result.stabilityWindowStatus === "unsafe" || result.stabilityWindowStatus === "unstable") {
    reasons.push(`stability window is ${result.stabilityWindowStatus}`);
  }
  if (result.thermalStatus === "hot" || result.thermalStatus === "critical" || result.thermalStatus === "paused") {
    reasons.push(`thermal state is ${result.thermalStatus}`);
  }
  if (result.shareWasteRatio !== null && result.shareWasteRatio > SHARE_WASTE_UNSAFE_RATIO) {
    reasons.push(`share waste is ${Math.round(result.shareWasteRatio * 100)}%`);
  }
  return reasons;
}

function underperformingReasons(
  result: TuningObservationResult,
  hashrateDeltaPercent: number | null,
  wattsDeltaPercent: number | null,
) {
  const reasons: string[] = [];
  if (hashrateDeltaPercent !== null && hashrateDeltaPercent <= HASHRATE_UNDERPERFORM_DELTA_PERCENT) {
    reasons.push(`effective hashrate is ${signedPercent(hashrateDeltaPercent)} vs plan`);
  }
  if (wattsDeltaPercent !== null && wattsDeltaPercent > WATTS_OVER_PLAN_DELTA_PERCENT) {
    reasons.push(`power is ${signedPercent(wattsDeltaPercent)} vs plan`);
  }
  if (result.shareWasteRatio !== null && result.shareWasteRatio > SHARE_WASTE_UNDERPERFORM_RATIO) {
    reasons.push(`share waste is ${Math.round(result.shareWasteRatio * 100)}%`);
  }
  if (result.longRunRisk === "watch") {
    reasons.push("long-run risk is watch");
  }
  if (result.stabilityWindowStatus === "noisy") {
    reasons.push("stability window is noisy");
  }
  return reasons;
}

export function deriveAlgorithmRunEvidenceReview(
  input: AlgorithmRunEvidenceReviewInput,
): AlgorithmRunEvidenceReviewSnapshot {
  const { runWindowPlan, powerHashEnvelope, tuningAnalysis } = input;

  if (runWindowPlan.mode === "external_dry_run" || powerHashEnvelope.mode === "external_dry_run") {
    return snapshot(
      input,
      "external_dry_run",
      "validate_external",
      null,
      [],
      "Evidence review: external high-hash work remains dry-run only; no live work window is approved.",
      "Validate adapter routing, share accounting, telemetry, and release gates before assigning external work.",
      baseGuardrails(input, ["Keep external mining disabled until dry-run evidence passes."]),
    );
  }

  if (runWindowPlan.mode === "blocked" || powerHashEnvelope.mode === "runtime_guard") {
    return snapshot(
      input,
      "runtime_blocked",
      "recover_runtime",
      null,
      [],
      "Evidence review: runtime guard blocks another optimization or burst window.",
      runWindowPlan.nextStep || powerHashEnvelope.nextStep,
      baseGuardrails(input, ["Recover share quality, temperature, and GPU duty before scheduling evidence capture."]),
    );
  }

  if (runWindowPlan.mode === "monitor") {
    return snapshot(
      input,
      "monitor",
      "monitor",
      null,
      [],
      "Evidence review: run window is monitor-only; no local tuning sample is required.",
      runWindowPlan.nextStep || powerHashEnvelope.nextStep,
      baseGuardrails(input, ["Keep runtime in monitor mode until the algorithm proof gate opens a real run window."]),
    );
  }
  const result = selectReviewResult(tuningAnalysis, runWindowPlan.requiredStepId);
  if (!result) {
    const target = runWindowPlan.requiredStepId ? ` for ${runWindowPlan.requiredStepId}` : "";
    return snapshot(
      input,
      "waiting_sample",
      "capture_window",
      null,
      ["local tuning result"],
      `Evidence review: waiting for a local tuning capture${target}.`,
      "Run the planned profile long enough to capture timed hash, watts, shares, thermals, and stability evidence.",
      baseGuardrails(input, ["Do not promote the plan before a local evidence sample exists."]),
    );
  }

  const requiredSampleSeconds = reviewSeconds(runWindowPlan, result);
  const plannedHash = plannedHashrate(runWindowPlan, powerHashEnvelope);
  const plannedPower = plannedWatts(runWindowPlan, powerHashEnvelope);
  const hashDelta = percentDelta(finiteNumber(result.effectiveHashrate), plannedHash);
  const wattDelta = percentDelta(finiteNumber(result.watts), plannedPower);
  const unsafe = unsafeReasons(result);
  if (unsafe.length > 0) {
    return snapshot(
      input,
      "unsafe",
      "lower_load",
      result,
      [],
      `Evidence review: sample violates safety guardrails (${unsafe.join("; ")}).`,
      "Lower load to the density lane, cool down if needed, and capture a fresh stability window before promotion.",
      baseGuardrails(input, ["Do not repeat burst or promote this profile while unsafe evidence is present."]),
    );
  }

  const missing = missingEvidence(result, requiredSampleSeconds);
  if (missing.length > 0) {
    return snapshot(
      input,
      "window_incomplete",
      "extend_window",
      result,
      missing,
      `Evidence review: captured evidence is incomplete (${missing.join(", ")}).`,
      "Keep the same settings running until the planned capture window, measured watts, share counters, thermals, and stability are present.",
      baseGuardrails(input, ["Extend the same profile instead of switching lanes mid-sample."]),
    );
  }

  const underperforming = underperformingReasons(result, hashDelta, wattDelta);
  if (underperforming.length > 0) {
    return snapshot(
      input,
      "underperforming",
      "hold_burst",
      result,
      [],
      `Evidence review: sample underperforms the planned envelope (${underperforming.join("; ")}).`,
      "Hold burst or profile promotion; retest the density lane and check power, share quality, and throttle evidence.",
      baseGuardrails(input, ["Do not spend more watts until effective hash per watt recovers."]),
    );
  }

  return snapshot(
    input,
    "within_plan",
    "keep_plan",
    result,
    [],
    `Evidence review: sample is within the planned envelope (${signedPercent(hashDelta)} hash, ${signedPercent(wattDelta)} watts).`,
    "Keep the current run-window plan and refresh evidence on the next scheduled capture window.",
    baseGuardrails(input, ["Keep using measured evidence before changing density or burst windows."]),
  );
}

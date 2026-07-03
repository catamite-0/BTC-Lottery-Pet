import { diffTuningShareCounters } from "./efficiencyTuning.js";
import type { TuningObservation, TuningShareCounters, TuningSweepStep } from "./efficiencyTuning.js";

export type TuningAutoSampleStatus = "inactive" | "waiting_hashrate" | "waiting_profile" | "waiting_power" | "warming_up" | "ready" | "recorded";

export interface TuningAutoSampleGateInput {
  enabled?: boolean | null;
  activeStep: TuningSweepStep | null;
  observedHashrate?: number | null;
  elapsedSeconds?: number | null;
  existingObservation?: TuningObservation | null;
  requiredStepId?: string | null;
  hasMeasuredPower?: boolean | null;
  requireMeasuredPower?: boolean | null;
  minCaptureSeconds?: number | null;
  refreshSeconds?: number | null;
}

export interface TuningAutoSampleGate {
  status: TuningAutoSampleStatus;
  canCapture: boolean;
  elapsedSeconds: number | null;
  requiredSeconds: number;
  nextCaptureInSeconds: number | null;
  summary: string;
}

export type TuningAutoSampleCaptureReason =
  | "ready"
  | "gate_blocked"
  | "missing_step"
  | "missing_hashrate"
  | "waiting_power"
  | "duplicate";

export interface TuningAutoSampleCaptureInput {
  gate: TuningAutoSampleGate;
  activeStep: TuningSweepStep | null;
  observedHashrate?: number | null;
  elapsedSeconds?: number | null;
  currentShareCounters: TuningShareCounters;
  baselineShareCounters?: TuningShareCounters | null;
  gpuDispatchMs?: number | null;
  gpuThrottleMs?: number | null;
  requireMeasuredPower?: boolean | null;
  measuredWatts?: number | null;
  lastCaptureKey?: string | null;
}

export interface TuningAutoSampleCaptureDecision {
  reason: TuningAutoSampleCaptureReason;
  captureKey: string | null;
  observation: TuningObservation | null;
  nextShareBaseline: TuningShareCounters | null;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function sanitizeSeconds(value: number | null | undefined, fallback: number) {
  return Math.max(1, Math.trunc(finitePositive(value) ? Number(value) : fallback));
}

function sanitizeElapsedSeconds(value: number | null | undefined) {
  const numericValue = Number(value);
  return Math.max(0, Math.trunc(Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : 0));
}

export function calculateTuningWindowElapsedSeconds(
  currentSeconds: number | null | undefined,
  baselineSeconds: number | null | undefined,
) {
  const current = Number(currentSeconds);
  if (!Number.isFinite(current) || current <= 0) {
    return null;
  }

  const baseline = Number(baselineSeconds);
  const normalizedBaseline = Number.isFinite(baseline) && baseline > 0 ? Math.trunc(baseline) : 0;
  const elapsed = Math.trunc(current) - normalizedBaseline;
  return elapsed > 0 ? elapsed : null;
}

export function hasTuningWindowCounterReset(
  currentSeconds: number | null | undefined,
  baselineSeconds: number | null | undefined,
) {
  const current = Number(currentSeconds);
  const baseline = Number(baselineSeconds);
  return Number.isFinite(current) && current >= 0 && Number.isFinite(baseline) && baseline > 0 && current < baseline;
}

export function evaluateTuningAutoSampleGate(input: TuningAutoSampleGateInput): TuningAutoSampleGate {
  const requiredSeconds = sanitizeSeconds(input.minCaptureSeconds, input.activeStep?.sampleSeconds ?? 30);

  if (input.enabled === false) {
    return {
      status: "inactive",
      canCapture: false,
      elapsedSeconds: null,
      requiredSeconds,
      nextCaptureInSeconds: null,
      summary: "Auto sample: current objective experiment does not require local capture.",
    };
  }

  if (!input.activeStep) {
    return {
      status: "inactive",
      canCapture: false,
      elapsedSeconds: null,
      requiredSeconds,
      nextCaptureInSeconds: null,
      summary: "Auto sample: waiting for an active tuning step.",
    };
  }

  if (!finitePositive(input.observedHashrate)) {
    return {
      status: "waiting_hashrate",
      canCapture: false,
      elapsedSeconds: null,
      requiredSeconds,
      nextCaptureInSeconds: null,
      summary: "Auto sample: waiting for live hashrate.",
    };
  }

  if (input.requiredStepId && input.activeStep.id !== input.requiredStepId) {
    return {
      status: "waiting_profile",
      canCapture: false,
      elapsedSeconds: sanitizeElapsedSeconds(input.elapsedSeconds),
      requiredSeconds,
      nextCaptureInSeconds: null,
      summary: "Auto sample: waiting for the active profile to match the tuning target.",
    };
  }

  const elapsedSeconds = sanitizeElapsedSeconds(input.elapsedSeconds);
  if (input.requireMeasuredPower === true && input.hasMeasuredPower !== true) {
    return {
      status: "waiting_power",
      canCapture: false,
      elapsedSeconds,
      requiredSeconds,
      nextCaptureInSeconds: null,
      summary: "Auto sample: waiting for measured watts before recording long-run evidence.",
    };
  }

  if (elapsedSeconds < requiredSeconds) {
    return {
      status: "warming_up",
      canCapture: false,
      elapsedSeconds,
      requiredSeconds,
      nextCaptureInSeconds: requiredSeconds - elapsedSeconds,
      summary: `Auto sample: ${requiredSeconds - elapsedSeconds}s until this profile can be captured.`,
    };
  }

  const refreshSeconds = sanitizeSeconds(input.refreshSeconds, requiredSeconds);
  const capturedSeconds = input.existingObservation?.stepId === input.activeStep.id && finitePositive(input.existingObservation.sampleSeconds)
    ? Number(input.existingObservation.sampleSeconds)
    : null;
  if (capturedSeconds !== null && elapsedSeconds < capturedSeconds + refreshSeconds) {
    return {
      status: "recorded",
      canCapture: false,
      elapsedSeconds,
      requiredSeconds,
      nextCaptureInSeconds: capturedSeconds + refreshSeconds - elapsedSeconds,
      summary: "Auto sample: current profile already has a recent sample.",
    };
  }

  return {
    status: "ready",
    canCapture: true,
    elapsedSeconds,
    requiredSeconds,
    nextCaptureInSeconds: null,
    summary: "Auto sample: profile is ready to record; it will not change the active profile.",
  };
}

function sanitizeCounter(value: number | null | undefined) {
  return Math.max(0, Math.trunc(Number.isFinite(Number(value)) ? Number(value) : 0));
}

function sanitizeShareCounters(counters: TuningShareCounters): TuningShareCounters {
  return {
    acceptedShares: sanitizeCounter(counters.acceptedShares),
    rejectedShares: sanitizeCounter(counters.rejectedShares),
    staleSharesDropped: sanitizeCounter(counters.staleSharesDropped),
    queuedSharesDropped: sanitizeCounter(counters.queuedSharesDropped),
  };
}

function emptyCaptureDecision(reason: TuningAutoSampleCaptureReason, captureKey: string | null = null): TuningAutoSampleCaptureDecision {
  return {
    reason,
    captureKey,
    observation: null,
    nextShareBaseline: null,
  };
}

export function createTuningAutoSampleCapture(input: TuningAutoSampleCaptureInput): TuningAutoSampleCaptureDecision {
  if (!input.gate.canCapture) {
    return emptyCaptureDecision("gate_blocked");
  }
  if (!input.activeStep) {
    return emptyCaptureDecision("missing_step");
  }
  if (!finitePositive(input.observedHashrate)) {
    return emptyCaptureDecision("missing_hashrate");
  }

  const measuredWatts = finitePositive(input.measuredWatts) ? Number(input.measuredWatts) : null;
  if (input.requireMeasuredPower === true && measuredWatts === null) {
    return emptyCaptureDecision("waiting_power");
  }

  const sampleSeconds = sanitizeSeconds(input.elapsedSeconds, input.activeStep.sampleSeconds);
  const currentShareCounters = sanitizeShareCounters(input.currentShareCounters);
  const powerEvidenceStatus = measuredWatts !== null ? "measured" : "estimated";
  const captureKey = [
    input.activeStep.id,
    sampleSeconds,
    powerEvidenceStatus,
    measuredWatts ?? input.activeStep.estimatedWatts,
    currentShareCounters.acceptedShares,
    currentShareCounters.rejectedShares,
    currentShareCounters.staleSharesDropped,
    currentShareCounters.queuedSharesDropped,
  ].join(":");

  if (input.lastCaptureKey === captureKey) {
    return emptyCaptureDecision("duplicate", captureKey);
  }

  const shareDeltas = diffTuningShareCounters(currentShareCounters, input.baselineShareCounters ?? null);
  return {
    reason: "ready",
    captureKey,
    nextShareBaseline: currentShareCounters,
    observation: {
      stepId: input.activeStep.id,
      hashrate: Number(input.observedHashrate),
      watts: measuredWatts ?? input.activeStep.estimatedWatts,
      powerEvidenceStatus,
      acceptedShares: shareDeltas.acceptedShares,
      rejectedShares: shareDeltas.rejectedShares,
      staleSharesDropped: shareDeltas.staleSharesDropped,
      queuedSharesDropped: shareDeltas.queuedSharesDropped,
      gpuDispatchMs: sanitizeCounter(input.gpuDispatchMs),
      gpuThrottleMs: sanitizeCounter(input.gpuThrottleMs),
      sampleSeconds,
    },
  };
}
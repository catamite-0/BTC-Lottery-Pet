import type { ThermalGuardStatus } from "./thermalGuard.js";

export type StabilityWindowStatus = "unknown" | "probing" | "stable" | "noisy" | "unstable" | "unsafe";

export interface StabilityWindowInput {
  sampleSeconds?: number | null;
  rejectedShareRatio?: number | null;
  thermalStatus?: ThermalGuardStatus | null;
  requiredSeconds?: number | null;
}

export interface StabilityWindowSnapshot {
  status: StabilityWindowStatus;
  qualityWeight: number;
  observedSeconds: number | null;
  requiredSeconds: number;
  progress: number;
  summary: string;
}

const DEFAULT_STABILITY_WINDOW_SECONDS = 180;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function numericRatio(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function calculateStabilityWindow(input: StabilityWindowInput): StabilityWindowSnapshot {
  const requiredSeconds = finitePositive(input.requiredSeconds)
    ? Math.max(30, Number(input.requiredSeconds))
    : DEFAULT_STABILITY_WINDOW_SECONDS;
  const observedSeconds = finitePositive(input.sampleSeconds) ? Number(input.sampleSeconds) : null;
  const progress = observedSeconds === null ? 0 : clampRatio(observedSeconds / requiredSeconds);
  const rejectedShareRatio = numericRatio(input.rejectedShareRatio);
  const thermalStatus = input.thermalStatus ?? "unknown";

  if (thermalStatus === "critical" || thermalStatus === "paused") {
    return {
      status: "unsafe",
      qualityWeight: 0.35,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: "Stability window: unsafe thermal state needs a lower profile.",
    };
  }

  if (rejectedShareRatio !== null && rejectedShareRatio > 0.1) {
    return {
      status: "unstable",
      qualityWeight: 0.4,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: "Stability window: share waste is too high for long-run use.",
    };
  }

  if (observedSeconds === null) {
    return {
      status: "unknown",
      qualityWeight: 1,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: "Stability window: waiting for a timed sample.",
    };
  }

  if (progress < 1) {
    return {
      status: "probing",
      qualityWeight: 0.5 + progress * 0.35,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: `Stability window: ${Math.round(progress * 100)}% of long-run sample captured.`,
    };
  }

  if (rejectedShareRatio !== null && rejectedShareRatio > 0.02) {
    return {
      status: "noisy",
      qualityWeight: 0.75,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: "Stability window: long enough, but share quality is noisy.",
    };
  }

  if (thermalStatus === "hot") {
    return {
      status: "noisy",
      qualityWeight: 0.78,
      observedSeconds,
      requiredSeconds,
      progress,
      summary: "Stability window: long enough, but thermal headroom is tight.",
    };
  }

  return {
    status: "stable",
    qualityWeight: 1,
    observedSeconds,
    requiredSeconds,
    progress,
    summary: "Stability window: long-run sample is stable.",
  };
}
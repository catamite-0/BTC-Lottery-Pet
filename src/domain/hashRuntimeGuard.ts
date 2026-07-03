import type { HashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";

export type HashRuntimeGuardLevel = "clear" | "observe" | "block";
export type HashRuntimeRecoveryAction = "collect_evidence" | "hold_load" | "lower_load" | "allow_promotion";

export interface HashRuntimeGuardSnapshot {
  level: HashRuntimeGuardLevel;
  status: HashRuntimeEfficiencySnapshot["status"] | "not_observed";
  qualityLossHashrate: number | null;
  throttleHashrateAtRisk: number | null;
  promotionAllowed: boolean;
  recoveryAction: HashRuntimeRecoveryAction;
  summary: string;
  nextStep: string;
}

export interface HashLoadProfileLike {
  computeMode?: string | null;
  gpuIntensityPercent?: number | null;
  estimatedWatts?: number | null;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function activeGpuMode(mode: string | null | undefined) {
  return mode === "gpu" || mode === "hybrid";
}

function percent(value: number | null) {
  return value === null ? "unknown" : `${Math.round(value * 100)}%`;
}

function formatHashrate(value: number | null) {
  if (!finitePositive(value)) {
    return "0 H/s";
  }
  const hashrate = Number(value);
  if (hashrate >= 1_000_000_000_000) {
    return `${(hashrate / 1_000_000_000_000).toFixed(2)} TH/s`;
  }
  if (hashrate >= 1_000_000_000) {
    return `${(hashrate / 1_000_000_000).toFixed(2)} GH/s`;
  }
  if (hashrate >= 1_000_000) {
    return `${(hashrate / 1_000_000).toFixed(2)} MH/s`;
  }
  if (hashrate >= 1_000) {
    return `${(hashrate / 1_000).toFixed(2)} KH/s`;
  }
  return `${Math.round(hashrate)} H/s`;
}

function runtimeQualityLossText(runtime: HashRuntimeEfficiencySnapshot) {
  return runtime.provenWastedHashrate === null
    ? "share evidence is still waiting"
    : `current quality loss is ${formatHashrate(runtime.provenWastedHashrate)}`;
}

function guardSnapshot(args: {
  level: HashRuntimeGuardLevel;
  status: HashRuntimeGuardSnapshot["status"];
  runtime?: HashRuntimeEfficiencySnapshot | null;
  recoveryAction: HashRuntimeRecoveryAction;
  summary: string;
  nextStep: string;
  promotionAllowed?: boolean;
}): HashRuntimeGuardSnapshot {
  return {
    level: args.level,
    status: args.status,
    qualityLossHashrate: args.runtime && args.runtime.rawHashrate > 0 ? args.runtime.provenWastedHashrate : null,
    throttleHashrateAtRisk: args.runtime && args.runtime.rawHashrate > 0 ? args.runtime.gpuThrottleHashrateAtRisk : null,
    promotionAllowed: args.promotionAllowed ?? args.level === "clear",
    recoveryAction: args.recoveryAction,
    summary: args.summary,
    nextStep: args.nextStep,
  };
}

export function deriveHashRuntimeGuard(
  runtime: HashRuntimeEfficiencySnapshot | null | undefined,
): HashRuntimeGuardSnapshot {
  if (!runtime || runtime.rawHashrate <= 0 || runtime.status === "waiting") {
    return guardSnapshot({
      level: "clear",
      status: runtime?.status ?? "not_observed",
      runtime,
      recoveryAction: "collect_evidence",
      summary: "live runtime evidence is waiting",
      nextStep: "Keep collecting live hashrate, share quality, and GPU duty evidence.",
    });
  }

  if (runtime.status === "wasteful") {
    return guardSnapshot({
      level: "block",
      status: runtime.status,
      runtime,
      recoveryAction: "lower_load",
      summary: `live runtime evidence is wasteful with ${percent(runtime.shareWasteRatio)} share waste and ${formatHashrate(runtime.provenWastedHashrate)} quality loss`,
      nextStep: "Restore share quality or apply a lower-load profile before chasing more hashrate.",
    });
  }

  if (runtime.status === "throttled") {
    return guardSnapshot({
      level: "block",
      status: runtime.status,
      runtime,
      recoveryAction: "lower_load",
      summary: `live runtime evidence is throttled by ${percent(runtime.gpuThrottleRatio)} GPU throttle with ${formatHashrate(runtime.gpuThrottleHashrateAtRisk)} hash at risk`,
      nextStep: "Reduce GPU intensity, improve cooling, or wait for low-throttle evidence before applying a higher-load profile.",
    });
  }

  if (runtime.status === "watch") {
    return guardSnapshot({
      level: "observe",
      status: runtime.status,
      runtime,
      recoveryAction: "hold_load",
      summary: `live runtime evidence needs observation: ${runtime.summary}`,
      nextStep: `Hold higher-load promotions until live share quality and GPU duty are clean; ${runtimeQualityLossText(runtime)}.`,
    });
  }

  if (!runtime.promotionEvidenceReady) {
    return guardSnapshot({
      level: "observe",
      status: runtime.status,
      runtime,
      recoveryAction: "hold_load",
      promotionAllowed: false,
      summary: `live runtime evidence is clean but too thin for promotion: ${runtime.summary}`,
      nextStep: "Hold higher-load promotions until at least 3 live share events, or 900 seconds of clean sparse runtime, confirm the current profile.",
    });
  }

  return guardSnapshot({
    level: "clear",
    status: runtime.status,
    runtime,
    recoveryAction: "allow_promotion",
    summary: `live runtime evidence is clear: ${runtime.summary}`,
    nextStep: "Live runtime evidence supports profile promotion if stored evidence also qualifies.",
  });
}

export function targetRaisesHashLoad(
  target: HashLoadProfileLike | null | undefined,
  current: HashLoadProfileLike | null | undefined,
) {
  if (!target || !current) {
    return false;
  }

  const targetGpu = activeGpuMode(target.computeMode);
  const currentGpu = activeGpuMode(current.computeMode);
  if (targetGpu && !currentGpu) {
    return true;
  }

  if (targetGpu && currentGpu &&
    finitePositive(target.gpuIntensityPercent) &&
    finitePositive(current.gpuIntensityPercent) &&
    Number(target.gpuIntensityPercent) > Number(current.gpuIntensityPercent)) {
    return true;
  }

  return finitePositive(target.estimatedWatts) &&
    finitePositive(current.estimatedWatts) &&
    Number(target.estimatedWatts) > Number(current.estimatedWatts) * 1.1;
}
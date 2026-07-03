export type HashRuntimeEfficiencyStatus = "waiting" | "efficient" | "watch" | "wasteful" | "throttled";

export const MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS = 3;
export const MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS = 900;
export const MAX_HASH_RUNTIME_PROMOTION_GPU_THROTTLE_RATIO = 0.15;

export interface HashRuntimeEfficiencyInput {
  hashrate?: number | null;
  acceptedShares?: number | null;
  rejectedShares?: number | null;
  staleSharesDropped?: number | null;
  queuedSharesDropped?: number | null;
  gpuDispatchMs?: number | null;
  gpuThrottleMs?: number | null;
  sampleSeconds?: number | null;
}

export interface HashRuntimeEfficiencySnapshot {
  status: HashRuntimeEfficiencyStatus;
  rawHashrate: number;
  effectiveHashrate: number;
  wastedHashrate: number;
  provenEffectiveHashrate: number | null;
  provenWastedHashrate: number | null;
  shareEvidenceReady: boolean;
  promotionEvidenceReady: boolean;
  gpuThrottleHashrateAtRisk: number | null;
  effectiveRatio: number | null;
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
  totalShareEvents: number;
  wastedShareEvents: number;
  shareWasteRatio: number | null;
  gpuDispatchMs: number;
  gpuThrottleMs: number;
  sampleSeconds: number | null;
  gpuDutyCycle: number | null;
  gpuThrottleRatio: number | null;
  summary: string;
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function shareCounter(value: number | null | undefined) {
  return Math.max(0, Math.trunc(finiteNonNegative(value)));
}

function sampleSeconds(value: number | null | undefined) {
  const seconds = finiteNonNegative(value);
  return seconds > 0 ? Math.trunc(seconds) : null;
}

function ratio(numerator: number, denominator: number) {
  return denominator > 0 ? Math.max(0, Math.min(1, numerator / denominator)) : null;
}

function percent(value: number | null) {
  return value === null ? "waiting" : `${Math.round(value * 100)}%`;
}

function formatHashrate(value: number) {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)} TH/s`;
  }
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} GH/s`;
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} MH/s`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(2)} KH/s`;
  }
  return `${Math.round(value)} H/s`;
}

export function deriveHashRuntimeEfficiencySnapshot(
  input: HashRuntimeEfficiencyInput,
): HashRuntimeEfficiencySnapshot {
  const rawHashrate = finiteNonNegative(input.hashrate);
  const acceptedShares = shareCounter(input.acceptedShares);
  const rejectedShares = shareCounter(input.rejectedShares);
  const staleSharesDropped = shareCounter(input.staleSharesDropped);
  const queuedSharesDropped = shareCounter(input.queuedSharesDropped);
  const totalShareEvents = acceptedShares + rejectedShares + staleSharesDropped + queuedSharesDropped;
  const wastedShareEvents = rejectedShares + staleSharesDropped + queuedSharesDropped;
  const shareWasteRatio = ratio(wastedShareEvents, totalShareEvents);
  const shareEvidenceReady = shareWasteRatio !== null;
  const effectiveRatio = shareEvidenceReady ? 1 - Number(shareWasteRatio) : null;
  const effectiveHashrate = rawHashrate * (effectiveRatio ?? 1);
  const wastedHashrate = Math.max(0, rawHashrate - effectiveHashrate);
  const provenEffectiveHashrate = shareEvidenceReady ? effectiveHashrate : null;
  const provenWastedHashrate = shareEvidenceReady ? wastedHashrate : null;
  const gpuDispatchMs = shareCounter(input.gpuDispatchMs);
  const gpuThrottleMs = shareCounter(input.gpuThrottleMs);
  const runtimeSampleSeconds = sampleSeconds(input.sampleSeconds);
  const gpuTotalMs = gpuDispatchMs + gpuThrottleMs;
  const gpuDutyCycle = ratio(gpuDispatchMs, gpuTotalMs);
  const gpuThrottleRatio = ratio(gpuThrottleMs, gpuTotalMs);
  const gpuThrottleHashrateAtRisk = gpuThrottleRatio === null ? null : rawHashrate * gpuThrottleRatio;

  let status: HashRuntimeEfficiencyStatus = "efficient";
  if (rawHashrate <= 0) {
    status = "waiting";
  } else if ((shareWasteRatio ?? 0) > 0.2) {
    status = "wasteful";
  } else if ((gpuThrottleRatio ?? 0) > 0.5) {
    status = "throttled";
  } else if ((shareWasteRatio ?? 0) > 0.05 || (gpuThrottleRatio ?? 0) > 0.25 || shareWasteRatio === null) {
    status = "watch";
  }

  const gpuPromotionSafe = gpuThrottleRatio === null || gpuThrottleRatio <= MAX_HASH_RUNTIME_PROMOTION_GPU_THROTTLE_RATIO;
  const denseShareEvidenceReady = totalShareEvents >= MIN_HASH_RUNTIME_PROMOTION_SHARE_EVENTS;
  const sparseShareEvidenceReady = runtimeSampleSeconds !== null &&
    runtimeSampleSeconds >= MIN_HASH_RUNTIME_SPARSE_PROMOTION_SECONDS &&
    acceptedShares > 0 &&
    wastedShareEvents === 0;
  const promotionEvidenceReady = rawHashrate > 0 &&
    status === "efficient" &&
    shareEvidenceReady &&
    gpuPromotionSafe &&
    (denseShareEvidenceReady || sparseShareEvidenceReady);

  const evidence = shareWasteRatio === null
    ? "share evidence waiting"
    : `${percent(effectiveRatio)} useful shares; ${formatHashrate(wastedHashrate)} quality loss`;
  const gpu = gpuDutyCycle === null ? "GPU duty waiting" : `${percent(gpuDutyCycle)} GPU duty`;
  const summary = rawHashrate <= 0
    ? "Waiting for live hashrate."
    : `${evidence}; ${gpu}.`;

  return {
    status,
    rawHashrate,
    effectiveHashrate,
    wastedHashrate,
    provenEffectiveHashrate,
    provenWastedHashrate,
    shareEvidenceReady,
    promotionEvidenceReady,
    gpuThrottleHashrateAtRisk,
    effectiveRatio,
    acceptedShares,
    rejectedShares,
    staleSharesDropped,
    queuedSharesDropped,
    totalShareEvents,
    wastedShareEvents,
    shareWasteRatio,
    gpuDispatchMs,
    gpuThrottleMs,
    sampleSeconds: runtimeSampleSeconds,
    gpuDutyCycle,
    gpuThrottleRatio,
    summary,
  };
}
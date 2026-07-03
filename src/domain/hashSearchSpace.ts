export type HashSearchSpaceControlKind = "nonce" | "versionRolling" | "ntimeRolling" | "extranonce";
export type HashSearchSpaceStatus = "waiting" | "sufficient" | "tight" | "insufficient";

export interface HashSearchSpaceControl {
  kind: HashSearchSpaceControlKind;
  bits: number;
  summary: string;
}

export interface HashSearchSpacePlanInput {
  hashrate?: number | null;
  targetJobSeconds?: number | null;
  versionRollingBits?: number | null;
  ntimeRollingSeconds?: number | null;
  extranonceBytes?: number | null;
}

export interface HashSearchSpacePlan {
  hashrate: number;
  targetJobSeconds: number;
  totalBits: number;
  totalSearchSpace: number | null;
  nonceOnlySeconds: number | null;
  estimatedJobSeconds: number | null;
  missingBits: number;
  status: HashSearchSpaceStatus;
  requiresVersionRolling: boolean;
  requiresExtranonce: boolean;
  controls: HashSearchSpaceControl[];
  summary: string;
}

const NONCE_BITS = 32;
const MAX_VERSION_ROLLING_BITS = 24;
const MAX_NTIME_ROLLING_SECONDS = 7_200;
const MAX_EXTRANONCE_BYTES = 32;
const DEFAULT_TARGET_JOB_SECONDS = 1;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampInteger(value: number | null | undefined, min: number, max: number) {
  const numeric = Number(value);
  return Math.min(max, Math.max(min, Math.trunc(Number.isFinite(numeric) ? numeric : min)));
}

function clampTargetSeconds(value: number | null | undefined) {
  if (!finitePositive(value)) {
    return DEFAULT_TARGET_JOB_SECONDS;
  }
  return Math.min(3_600, Math.max(0.1, Number(value)));
}

function secondsFromBits(bits: number, hashrate: number) {
  if (!finitePositive(hashrate)) {
    return null;
  }

  const log2Seconds = bits - Math.log2(hashrate);
  if (log2Seconds > 1_023) {
    return Number.POSITIVE_INFINITY;
  }
  return 2 ** log2Seconds;
}

function searchSpaceFromBits(bits: number) {
  if (bits > 1_023) {
    return null;
  }
  return 2 ** bits;
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) {
    return seconds === Number.POSITIVE_INFINITY ? "effectively unlimited" : "waiting";
  }
  if (seconds < 0.01) {
    return `${(seconds * 1_000).toFixed(2)} ms`;
  }
  if (seconds < 1) {
    return `${(seconds * 1_000).toFixed(0)} ms`;
  }
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  }
  if (seconds < 3_600) {
    return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} min`;
  }
  return `${(seconds / 3_600).toFixed(1)} h`;
}

function summarizeStatus(
  status: HashSearchSpaceStatus,
  requiresVersionRolling: boolean,
  requiresExtranonce: boolean,
) {
  if (status === "waiting") {
    return "waiting for hashrate";
  }
  if (requiresVersionRolling) {
    return "version rolling needed";
  }
  if (requiresExtranonce) {
    return "more extranonce/search-space partitioning needed";
  }
  if (status === "tight") {
    return "job lifetime is tight";
  }
  return "search space is sufficient";
}

export function estimateHashSearchSpacePlan(input: HashSearchSpacePlanInput): HashSearchSpacePlan {
  const hashrate = finitePositive(input.hashrate) ? Number(input.hashrate) : 0;
  const targetJobSeconds = clampTargetSeconds(input.targetJobSeconds);
  const versionRollingBits = clampInteger(input.versionRollingBits, 0, MAX_VERSION_ROLLING_BITS);
  const extranonceBytes = clampInteger(input.extranonceBytes, 0, MAX_EXTRANONCE_BYTES);
  const ntimeRollingSeconds = clampInteger(input.ntimeRollingSeconds, 0, MAX_NTIME_ROLLING_SECONDS);
  const ntimeBits = ntimeRollingSeconds > 0 ? Math.ceil(Math.log2(ntimeRollingSeconds + 1)) : 0;
  const extranonceBits = extranonceBytes * 8;
  const controls: HashSearchSpaceControl[] = [
    { kind: "nonce", bits: NONCE_BITS, summary: "32-bit nonce field" },
  ];

  if (versionRollingBits > 0) {
    controls.push({
      kind: "versionRolling",
      bits: versionRollingBits,
      summary: `${versionRollingBits} BIP320/BIP323 version-rolling bit${versionRollingBits === 1 ? "" : "s"}`,
    });
  }
  if (ntimeBits > 0) {
    controls.push({
      kind: "ntimeRolling",
      bits: ntimeBits,
      summary: `${ntimeRollingSeconds}s nTime rolling window`,
    });
  }
  if (extranonceBits > 0) {
    controls.push({
      kind: "extranonce",
      bits: extranonceBits,
      summary: `${extranonceBytes} extranonce byte${extranonceBytes === 1 ? "" : "s"}`,
    });
  }

  const totalBits = controls.reduce((total, control) => total + control.bits, 0);
  const nonceOnlySeconds = secondsFromBits(NONCE_BITS, hashrate);
  const estimatedJobSeconds = secondsFromBits(totalBits, hashrate);
  const requiredBits = hashrate > 0 ? Math.ceil(Math.log2(hashrate * targetJobSeconds)) : 0;
  const missingBits = Math.max(0, requiredBits - totalBits);
  const requiresVersionRolling = hashrate > 0 &&
    versionRollingBits === 0 &&
    Number(nonceOnlySeconds) < targetJobSeconds;
  const requiresExtranonce = hashrate > 0 &&
    !requiresVersionRolling &&
    Number(estimatedJobSeconds) < targetJobSeconds;
  let status: HashSearchSpaceStatus = "waiting";
  if (hashrate > 0 && estimatedJobSeconds !== null) {
    if (estimatedJobSeconds >= targetJobSeconds) {
      status = "sufficient";
    } else if (estimatedJobSeconds >= targetJobSeconds * 0.25) {
      status = "tight";
    } else {
      status = "insufficient";
    }
  }

  const summary = `Search space ${summarizeStatus(status, requiresVersionRolling, requiresExtranonce)}: ${totalBits} bits gives ${formatDuration(estimatedJobSeconds)} at current hashrate; nonce-only ${formatDuration(nonceOnlySeconds)}.`;

  return {
    hashrate,
    targetJobSeconds,
    totalBits,
    totalSearchSpace: searchSpaceFromBits(totalBits),
    nonceOnlySeconds,
    estimatedJobSeconds,
    missingBits,
    status,
    requiresVersionRolling,
    requiresExtranonce,
    controls,
    summary,
  };
}
export type HashWorkLeaseStatus = "waiting" | "ready" | "tight" | "insufficient" | "overlap-risk";
export type HashWorkLeaseOverlapRisk = "none" | "low" | "high";
export type HashWorkLeaseWasteRisk = "unknown" | "none" | "medium" | "high";

export interface HashWorkLeasePlanInput extends HashSearchSpacePlanInput {
  parallelWorkers?: number | null;
  allowNonceRangePartition?: boolean | null;
}

export interface HashWorkLeasePlan {
  searchSpace: HashSearchSpacePlan;
  parallelWorkers: number;
  partitionBits: number;
  partitionSlots: number | null;
  perWorkerBits: number;
  perWorkerSearchSpace: number | null;
  leaseSeconds: number | null;
  leaseUtilizationRatio: number | null;
  uniquePartitionRatio: number | null;
  routeUtilizationRatio: number | null;
  hashWasteRisk: HashWorkLeaseWasteRisk;
  requiredBits: number;
  status: HashWorkLeaseStatus;
  overlapRisk: HashWorkLeaseOverlapRisk;
  requiresWorkPartitioning: boolean;
  summary: string;
}

function clampWorkerCount(value: number | null | undefined) {
  return clampInteger(value, 1, 65_536);
}

function partitionBitsForLease(plan: HashSearchSpacePlan, allowNonceRangePartition: boolean) {
  return plan.controls
    .filter((control) => allowNonceRangePartition || control.kind !== "nonce")
    .reduce((total, control) => total + control.bits, 0);
}

function summarizeLeaseStatus(
  status: HashWorkLeaseStatus,
  leaseSeconds: number | null,
  overlapRisk: HashWorkLeaseOverlapRisk,
) {
  if (status === "waiting") {
    return "waiting for hashrate";
  }
  if (status === "overlap-risk") {
    return "work assignments can overlap";
  }
  if (status === "insufficient") {
    return "lease is too short";
  }
  if (status === "tight") {
    return "lease is tight";
  }
  return overlapRisk === "low"
    ? `unique lease is ready for ${formatDuration(leaseSeconds)}`
    : `lease is ready for ${formatDuration(leaseSeconds)}`;
}

function calculateLeaseUtilizationRatio(leaseSeconds: number | null, targetJobSeconds: number) {
  if (leaseSeconds === null || !Number.isFinite(leaseSeconds) || !finitePositive(targetJobSeconds)) {
    return null;
  }
  return Math.max(0, Math.min(1, leaseSeconds / targetJobSeconds));
}

function calculateUniquePartitionRatio(
  parallelWorkers: number,
  partitionSlots: number | null,
  uniqueAssignmentReady: boolean,
) {
  if (parallelWorkers <= 1 || uniqueAssignmentReady || partitionSlots === null) {
    return 1;
  }
  return Math.max(0, Math.min(1, partitionSlots / parallelWorkers));
}

function calculateRouteUtilizationRatio(
  leaseUtilizationRatio: number | null,
  uniquePartitionRatio: number | null,
) {
  if (leaseUtilizationRatio === null || uniquePartitionRatio === null) {
    return null;
  }
  return Math.max(0, Math.min(1, leaseUtilizationRatio * uniquePartitionRatio));
}

function classifyHashWasteRisk(
  status: HashWorkLeaseStatus,
  overlapRisk: HashWorkLeaseOverlapRisk,
  utilizationRatio: number | null,
): HashWorkLeaseWasteRisk {
  if (status === "waiting" || utilizationRatio === null) {
    return "unknown";
  }
  if (overlapRisk === "high" || status === "overlap-risk" || status === "insufficient") {
    return "high";
  }
  if (status === "tight" || utilizationRatio < 1) {
    return "medium";
  }
  return "none";
}

function formatRatioPercent(ratio: number | null) {
  return ratio === null ? "utilization waiting" : `${Math.round(ratio * 100)}% lease utilization`;
}

function formatRouteRatioPercent(ratio: number | null) {
  return ratio === null ? "route utilization waiting" : `${Math.round(ratio * 100)}% route utilization`;
}

export function estimateHashWorkLeasePlan(input: HashWorkLeasePlanInput): HashWorkLeasePlan {
  const searchSpace = estimateHashSearchSpacePlan(input);
  const parallelWorkers = clampWorkerCount(input.parallelWorkers);
  const allowNonceRangePartition = input.allowNonceRangePartition === true;
  const partitionBits = partitionBitsForLease(searchSpace, allowNonceRangePartition);
  const partitionSlots = searchSpaceFromBits(partitionBits);
  const workerBits = Math.ceil(Math.log2(parallelWorkers));
  const uniqueAssignmentReady = parallelWorkers <= 1 ||
    allowNonceRangePartition ||
    partitionSlots === null ||
    partitionSlots >= parallelWorkers;
  const perWorkerBits = Math.max(0, searchSpace.totalBits - (uniqueAssignmentReady ? workerBits : 0));
  const leaseSeconds = secondsFromBits(perWorkerBits, searchSpace.hashrate);
  const perWorkerSearchSpace = searchSpaceFromBits(perWorkerBits);
  const requiredBits = searchSpace.hashrate > 0
    ? Math.ceil(Math.log2(searchSpace.hashrate * searchSpace.targetJobSeconds))
    : 0;
  const overlapRisk: HashWorkLeaseOverlapRisk = parallelWorkers <= 1
    ? "none"
    : uniqueAssignmentReady
      ? "low"
      : "high";
  const requiresWorkPartitioning = parallelWorkers > 1 && !uniqueAssignmentReady;

  let status: HashWorkLeaseStatus = "waiting";
  if (searchSpace.hashrate > 0 && leaseSeconds !== null) {
    if (overlapRisk === "high") {
      status = "overlap-risk";
    } else if (leaseSeconds >= searchSpace.targetJobSeconds) {
      status = "ready";
    } else if (leaseSeconds >= searchSpace.targetJobSeconds * 0.5) {
      status = "tight";
    } else {
      status = "insufficient";
    }
  }

  const leaseUtilizationRatio = calculateLeaseUtilizationRatio(leaseSeconds, searchSpace.targetJobSeconds);
  const uniquePartitionRatio = calculateUniquePartitionRatio(parallelWorkers, partitionSlots, uniqueAssignmentReady);
  const routeUtilizationRatio = calculateRouteUtilizationRatio(leaseUtilizationRatio, uniquePartitionRatio);
  const hashWasteRisk = classifyHashWasteRisk(status, overlapRisk, routeUtilizationRatio);
  const summary = `Work lease ${summarizeLeaseStatus(status, leaseSeconds, overlapRisk)}: ${parallelWorkers} worker${parallelWorkers === 1 ? "" : "s"}, ${perWorkerBits} bits each, overlap risk ${overlapRisk}, ${formatRatioPercent(leaseUtilizationRatio)}, ${formatRouteRatioPercent(routeUtilizationRatio)}, waste risk ${hashWasteRisk}.`;

  return {
    searchSpace,
    parallelWorkers,
    partitionBits,
    partitionSlots,
    perWorkerBits,
    perWorkerSearchSpace,
    leaseSeconds,
    leaseUtilizationRatio,
    uniquePartitionRatio,
    routeUtilizationRatio,
    hashWasteRisk,
    requiredBits,
    status,
    overlapRisk,
    requiresWorkPartitioning,
    summary,
  };
}

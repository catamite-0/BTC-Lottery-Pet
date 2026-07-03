export type HashKernelBenchmarkStatus = "passed" | "waiting" | "blocked";
export type HashKernelBenchmarkPerformance = "faster" | "neutral" | "regression" | "unknown";

export interface HashKernelBenchmarkLike {
  status?: string | null;
  nonceCount?: number | null;
  nonce_count?: number | null;
  fullHeaderHashrate?: number | null;
  full_header_hashrate?: number | null;
  midstateHashrate?: number | null;
  midstate_hashrate?: number | null;
  speedupRatio?: number | null;
  speedup_ratio?: number | null;
  checksumHex?: string | null;
  checksum_hex?: string | null;
  note?: string | null;
}

export interface HashKernelBenchmarkEvidence {
  status: HashKernelBenchmarkStatus;
  performance: HashKernelBenchmarkPerformance;
  midstateReady: boolean;
  nonceCount: number | null;
  fullHeaderHashrate: number | null;
  midstateHashrate: number | null;
  speedupRatio: number | null;
  hashDensityGainPercent: number | null;
  fullHeaderCompressionBlocksPerHash: number | null;
  midstateCompressionBlocksPerHash: number | null;
  compressionWorkSavedPercent: number | null;
  checksumHex: string | null;
  summary: string;
  nextStep: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveInteger(value: number | null | undefined) {
  const finite = finitePositive(value);
  return finite === null ? null : Math.trunc(finite);
}

function stringValue(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : null;
}

function statusValue(value: string | null | undefined) {
  return stringValue(value)?.toLowerCase() ?? null;
}

function performanceFor(speedupRatio: number | null): HashKernelBenchmarkPerformance {
  if (speedupRatio === null) {
    return "unknown";
  }
  if (speedupRatio >= 1.05) {
    return "faster";
  }
  if (speedupRatio >= 0.95) {
    return "neutral";
  }
  return "regression";
}

function roundNullable(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function hashDensityGainPercent(speedupRatio: number | null) {
  return speedupRatio === null ? null : roundNullable((speedupRatio - 1) * 100, 1);
}

function midstateCompressionBlocksPerHash(nonceCount: number | null) {
  if (nonceCount === null || nonceCount <= 0) {
    return null;
  }
  return roundNullable((nonceCount * 2 + 1) / nonceCount, 4);
}

function compressionWorkSavedPercent(nonceCount: number | null) {
  const fullHeaderBlocks = 3;
  const midstateBlocks = midstateCompressionBlocksPerHash(nonceCount);
  return midstateBlocks === null
    ? null
    : roundNullable((1 - midstateBlocks / fullHeaderBlocks) * 100, 1);
}

function kernelDensityFields(nonceCount: number | null, speedupRatio: number | null) {
  return {
    hashDensityGainPercent: hashDensityGainPercent(speedupRatio),
    fullHeaderCompressionBlocksPerHash: nonceCount === null ? null : 3,
    midstateCompressionBlocksPerHash: midstateCompressionBlocksPerHash(nonceCount),
    compressionWorkSavedPercent: compressionWorkSavedPercent(nonceCount),
  };
}

function compactRate(value: number | null) {
  if (value === null) {
    return "waiting";
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} MH/s`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)} KH/s`;
  }
  return `${Math.round(value)} H/s`;
}

export function deriveHashKernelBenchmarkEvidence(
  benchmark: HashKernelBenchmarkLike | null | undefined,
): HashKernelBenchmarkEvidence {
  if (!benchmark) {
    return {
      status: "waiting",
      performance: "unknown",
      midstateReady: false,
      nonceCount: null,
      fullHeaderHashrate: null,
      midstateHashrate: null,
      speedupRatio: null,
      ...kernelDensityFields(null, null),
      checksumHex: null,
      summary: "Kernel benchmark evidence is waiting.",
      nextStep: "Run or import a fixed-window full-header vs midstate benchmark before treating local midstate optimization as proven on this machine.",
    };
  }

  const nonceCount = positiveInteger(benchmark.nonceCount ?? benchmark.nonce_count);
  const fullHeaderHashrate = finitePositive(benchmark.fullHeaderHashrate ?? benchmark.full_header_hashrate);
  const midstateHashrate = finitePositive(benchmark.midstateHashrate ?? benchmark.midstate_hashrate);
  const speedupRatio = finitePositive(benchmark.speedupRatio ?? benchmark.speedup_ratio);
  const checksumHex = stringValue(benchmark.checksumHex ?? benchmark.checksum_hex);
  const normalizedStatus = statusValue(benchmark.status);
  const performance = performanceFor(speedupRatio);

  if (normalizedStatus === "error" || normalizedStatus === "blocked" || normalizedStatus === "failed") {
    return {
      status: "blocked",
      performance,
      midstateReady: false,
      nonceCount,
      fullHeaderHashrate,
      midstateHashrate,
      speedupRatio,
      ...kernelDensityFields(nonceCount, speedupRatio),
      checksumHex,
      summary: "Kernel benchmark failed; midstate reuse is not proven on this machine.",
      nextStep: stringValue(benchmark.note) ?? "Fix the full-header vs midstate benchmark before relying on local hash-density claims.",
    };
  }

  const hasEnoughWindow = nonceCount !== null && nonceCount >= 1024;
  const hasRates = fullHeaderHashrate !== null && midstateHashrate !== null && speedupRatio !== null;
  const hasChecksum = checksumHex !== null && /^[0-9a-f]+$/i.test(checksumHex) && checksumHex.length >= 8;
  if (!hasEnoughWindow || !hasRates || !hasChecksum || normalizedStatus !== "ok") {
    return {
      status: "waiting",
      performance,
      midstateReady: false,
      nonceCount,
      fullHeaderHashrate,
      midstateHashrate,
      speedupRatio,
      ...kernelDensityFields(nonceCount, speedupRatio),
      checksumHex,
      summary: "Kernel benchmark is incomplete; local midstate readiness is still waiting.",
      nextStep: "Collect an ok fixed-window benchmark with at least 1024 nonces, positive H/s for both paths, and a checksum.",
    };
  }

  const density = kernelDensityFields(nonceCount, speedupRatio);
  const speedupText = `${speedupRatio.toFixed(2)}x`;
  const savedText = density.compressionWorkSavedPercent === null
    ? "compression saving waiting"
    : `${density.compressionWorkSavedPercent}% compression work saved`;
  return {
    status: "passed",
    performance,
    midstateReady: true,
    nonceCount,
    fullHeaderHashrate,
    midstateHashrate,
    speedupRatio,
    ...density,
    checksumHex,
    summary: `Kernel benchmark passed over ${nonceCount} nonces: midstate ${compactRate(midstateHashrate)} vs full-header ${compactRate(fullHeaderHashrate)} (${speedupText}, ${savedText}).`,
    nextStep: performance === "regression"
      ? "Keep equivalence evidence, but investigate why midstate is slower before claiming a local speed gain."
      : "Keep this benchmark in diagnostics and regression checks while tuning power and useful hash density.",
  };
}

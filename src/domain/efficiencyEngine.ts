export interface EfficiencySample {
  mode: "cpu" | "gpu" | "hybrid" | "asic";
  hashrate: number;
  watts: number | null;
  cpuThreads?: number;
  gpuIntensityPercent?: number;
  deviceName?: string;
  source?: string;
}

export interface EfficiencySnapshot {
  hashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  hashesPerJoule: number | null;
  efficiencyLabel: "waiting" | "unknown-power" | "pc-class" | "home-asic" | "industrial-asic";
}

export type EfficiencyGoal = "lowest_power" | "max_efficiency" | "balanced" | "max_hashrate";
export type EfficiencyComputeMode = "cpu" | "gpu" | "hybrid";
export type EfficiencyPerformancePreset = "eco" | "normal" | "turbo" | "custom";
export type EfficiencyRecommendationConfidence = "observed-hashrate" | "benchmark" | "estimated";

export interface EfficiencySchedulerInput {
  goal: EfficiencyGoal;
  availableCpuThreads: number;
  recommendedCpuThreads: number;
  hardwareGpuAvailable: boolean;
  observedHashrate?: number | null;
  observedComputeMode?: EfficiencyComputeMode | null;
  observedCpuThreads?: number | null;
  observedGpuIntensityPercent?: number | null;
  benchmarkHashrate?: number | null;
  benchmarkGpuIntensityPercent?: number | null;
  cpuHashratePerThread?: number | null;
  gpuHashrateAt100Percent?: number | null;
}

export interface EfficiencyCandidate {
  id: string;
  computeMode: EfficiencyComputeMode;
  performancePreset: EfficiencyPerformancePreset;
  cpuThreads: number;
  gpuIntensityPercent: number;
  estimatedHashrate: number;
  estimatedWatts: number;
  joulesPerTerahash: number | null;
  hashesPerJoule: number | null;
  summary: string;
  reasons: string[];
}

export interface EfficiencyRecommendation extends EfficiencyCandidate {
  goal: EfficiencyGoal;
  confidence: EfficiencyRecommendationConfidence;
}

const HASHES_PER_TH = 1_000_000_000_000;
const DEFAULT_CPU_HASHRATE_PER_THREAD = 650_000;
const DEFAULT_GPU_HASHRATE_AT_100_PERCENT = 120_000_000;
const CPU_BASE_WATTS = 4;
const CPU_WATTS_PER_THREAD = 6;
const GPU_IDLE_WATTS = 10;
const GPU_ACTIVE_WATTS_AT_100_PERCENT = 65;
const GPU_INTENSITY_OPTIONS = [10, 25, 50, 75, 100] as const;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finitePositiveOr(value: number | null | undefined, fallback: number) {
  return finitePositive(value) ? Number(value) : fallback;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
}

function cpuPresetForThreads(threads: number, recommendedThreads: number, availableThreads: number) {
  if (threads <= 1) {
    return "eco" as const;
  }

  if (threads === availableThreads) {
    return "turbo" as const;
  }

  if (threads === recommendedThreads) {
    return "normal" as const;
  }

  return "custom" as const;
}

function cpuScalingFactor(threads: number, recommendedThreads: number) {
  if (threads <= recommendedThreads) {
    return 1;
  }

  const oversubscription = threads - recommendedThreads;
  return Math.max(0.72, 1 - oversubscription * 0.04);
}

function gpuStressPenalty(intensityPercent: number) {
  if (intensityPercent <= 75) {
    return 1;
  }

  return 1 + (intensityPercent - 75) / 80;
}

function cpuStressPenalty(threads: number, recommendedThreads: number) {
  if (threads <= recommendedThreads) {
    return 1;
  }

  return 1 + (threads - recommendedThreads) * 0.05;
}

function estimateGpuWatts(intensityPercent: number) {
  return GPU_IDLE_WATTS + GPU_ACTIVE_WATTS_AT_100_PERCENT * (intensityPercent / 100);
}

function estimateCpuWatts(threads: number) {
  return CPU_BASE_WATTS + CPU_WATTS_PER_THREAD * threads;
}

function buildCandidate(args: {
  computeMode: EfficiencyComputeMode;
  performancePreset: EfficiencyPerformancePreset;
  cpuThreads: number;
  gpuIntensityPercent: number;
  estimatedHashrate: number;
  estimatedWatts: number;
  reasons: string[];
}): EfficiencyCandidate {
  const snapshot = calculateEfficiencySnapshot({
    mode: args.computeMode,
    hashrate: args.estimatedHashrate,
    watts: args.estimatedWatts,
  });
  const gpuSuffix = args.gpuIntensityPercent > 0 ? ` GPU ${args.gpuIntensityPercent}%` : "";
  const cpuSuffix = args.cpuThreads > 0
    ? ` ${args.cpuThreads} CPU thread${args.cpuThreads === 1 ? "" : "s"}`
    : "";

  return {
    id: `${args.computeMode}:${args.cpuThreads}:${args.gpuIntensityPercent}`,
    computeMode: args.computeMode,
    performancePreset: args.performancePreset,
    cpuThreads: args.cpuThreads,
    gpuIntensityPercent: args.gpuIntensityPercent,
    estimatedHashrate: snapshot.hashrate,
    estimatedWatts: args.estimatedWatts,
    joulesPerTerahash: snapshot.joulesPerTerahash,
    hashesPerJoule: snapshot.hashesPerJoule,
    summary: `${args.computeMode.toUpperCase()}${gpuSuffix}${cpuSuffix}`.trim(),
    reasons: args.reasons,
  };
}

function resolveHashrateModels(input: EfficiencySchedulerInput) {
  let cpuHashratePerThread = finitePositiveOr(
    input.cpuHashratePerThread,
    DEFAULT_CPU_HASHRATE_PER_THREAD,
  );
  let gpuHashrateAt100Percent = finitePositiveOr(
    input.gpuHashrateAt100Percent,
    DEFAULT_GPU_HASHRATE_AT_100_PERCENT,
  );
  let confidence: EfficiencyRecommendationConfidence = "estimated";

  const benchmarkIntensity = clampInteger(Number(input.benchmarkGpuIntensityPercent) || 0, 0, 100);
  if (finitePositive(input.benchmarkHashrate) && benchmarkIntensity > 0) {
    gpuHashrateAt100Percent = Number(input.benchmarkHashrate) * 100 / benchmarkIntensity;
    confidence = "benchmark";
  }

  const observedMode = input.observedComputeMode;
  const observedHashrate = finitePositive(input.observedHashrate)
    ? Number(input.observedHashrate)
    : 0;
  if (observedHashrate > 0) {
    if (observedMode === "cpu") {
      const observedThreads = clampInteger(Number(input.observedCpuThreads) || 0, 1, 256);
      cpuHashratePerThread = observedHashrate / observedThreads;
      confidence = "observed-hashrate";
    } else if (observedMode === "gpu") {
      const observedIntensity = clampInteger(Number(input.observedGpuIntensityPercent) || 0, 1, 100);
      gpuHashrateAt100Percent = observedHashrate * 100 / observedIntensity;
      confidence = "observed-hashrate";
    } else if (observedMode === "hybrid") {
      const observedThreads = clampInteger(Number(input.observedCpuThreads) || 0, 0, 256);
      const observedIntensity = clampInteger(Number(input.observedGpuIntensityPercent) || 0, 0, 100);
      const recommendedThreads = clampInteger(Number(input.recommendedCpuThreads) || 1, 1, 256);
      const cpuScaling = observedThreads > 0
        ? cpuScalingFactor(observedThreads, recommendedThreads)
        : 1;
      const estimatedCpuHashrate = observedThreads > 0
        ? cpuHashratePerThread * observedThreads * cpuScaling
        : 0;
      const estimatedGpuHashrate = observedIntensity > 0
        ? gpuHashrateAt100Percent * (observedIntensity / 100)
        : 0;

      if (observedIntensity > 0 && observedHashrate > estimatedCpuHashrate) {
        gpuHashrateAt100Percent = (observedHashrate - estimatedCpuHashrate) * 100 / observedIntensity;
      }

      if (observedThreads > 0 && observedHashrate > estimatedGpuHashrate) {
        cpuHashratePerThread = (observedHashrate - estimatedGpuHashrate) / (observedThreads * cpuScaling);
      }

      confidence = "observed-hashrate";
    }
  }

  return {
    cpuHashratePerThread,
    gpuHashrateAt100Percent,
    confidence,
  };
}

export function createEfficiencyCandidates(input: EfficiencySchedulerInput): EfficiencyCandidate[] {
  const availableThreads = clampInteger(Number(input.availableCpuThreads) || 1, 1, 256);
  const recommendedThreads = clampInteger(
    Number(input.recommendedCpuThreads) || 1,
    1,
    availableThreads,
  );
  const { cpuHashratePerThread, gpuHashrateAt100Percent } = resolveHashrateModels(input);
  const candidates: EfficiencyCandidate[] = [];

  const cpuThreadOptions = uniqueSorted([1, recommendedThreads, availableThreads]);
  for (const threads of cpuThreadOptions) {
    const scalingFactor = cpuScalingFactor(threads, recommendedThreads);
    candidates.push(buildCandidate({
      computeMode: "cpu",
      performancePreset: cpuPresetForThreads(threads, recommendedThreads, availableThreads),
      cpuThreads: threads,
      gpuIntensityPercent: 0,
      estimatedHashrate: cpuHashratePerThread * threads * scalingFactor,
      estimatedWatts: estimateCpuWatts(threads) * cpuStressPenalty(threads, recommendedThreads),
      reasons: [
        threads === 1
          ? "Lowest CPU power draw."
          : "Uses local CPU capacity without requiring GPU support.",
      ],
    }));
  }

  if (!input.hardwareGpuAvailable) {
    return candidates;
  }

  for (const intensity of GPU_INTENSITY_OPTIONS) {
    candidates.push(buildCandidate({
      computeMode: "gpu",
      performancePreset: "eco",
      cpuThreads: 0,
      gpuIntensityPercent: intensity,
      estimatedHashrate: gpuHashrateAt100Percent * (intensity / 100),
      estimatedWatts: estimateGpuWatts(intensity),
      reasons: [
        intensity <= 50
          ? "GPU duty-cycle limit keeps heat and fan noise down."
          : "GPU hashing avoids inefficient CPU work.",
      ],
    }));
  }

  for (const threads of uniqueSorted([recommendedThreads, availableThreads])) {
    for (const intensity of [75, 100] as const) {
      const scalingFactor = cpuScalingFactor(threads, recommendedThreads);
      candidates.push(buildCandidate({
        computeMode: "hybrid",
        performancePreset: cpuPresetForThreads(threads, recommendedThreads, availableThreads),
        cpuThreads: threads,
        gpuIntensityPercent: intensity,
        estimatedHashrate:
          gpuHashrateAt100Percent * (intensity / 100) +
          cpuHashratePerThread * threads * scalingFactor,
        estimatedWatts:
          estimateGpuWatts(intensity) +
          estimateCpuWatts(threads) * cpuStressPenalty(threads, recommendedThreads),
        reasons: [
          "Adds CPU workers only when absolute hashrate matters more than watts.",
        ],
      }));
    }
  }

  return candidates;
}

function rankCandidate(
  candidate: EfficiencyCandidate,
  goal: EfficiencyGoal,
  recommendedThreads: number,
) {
  const joulesPerTerahash = candidate.joulesPerTerahash ?? Number.POSITIVE_INFINITY;
  const stress =
    gpuStressPenalty(candidate.gpuIntensityPercent) *
    cpuStressPenalty(candidate.cpuThreads, recommendedThreads);

  switch (goal) {
    case "lowest_power":
      return candidate.estimatedWatts * stress - Math.log10(candidate.estimatedHashrate + 1) * 0.02;
    case "max_efficiency":
      return joulesPerTerahash * stress + candidate.estimatedWatts * 0.04;
    case "balanced":
      return -(
        Math.log10(candidate.estimatedHashrate + 1) * 8 -
        joulesPerTerahash * 0.015 -
        candidate.estimatedWatts * 0.08 -
        (stress - 1) * 6
      );
    case "max_hashrate":
      return -(candidate.estimatedHashrate - candidate.estimatedWatts * 50_000);
  }
}

function recommendationReasons(goal: EfficiencyGoal, candidate: EfficiencyCandidate) {
  const goalReason = {
    lowest_power: "Optimized for the lowest estimated watt draw.",
    max_efficiency: "Optimized for the best estimated hashes per joule.",
    balanced: "Keeps power moderate while preserving most of the GPU-side hashrate.",
    max_hashrate: "Optimized for the highest absolute estimated hashrate.",
  } satisfies Record<EfficiencyGoal, string>;

  return [goalReason[goal], ...candidate.reasons];
}

export function recommendEfficiencyProfile(input: EfficiencySchedulerInput): EfficiencyRecommendation {
  const candidates = createEfficiencyCandidates(input);
  const recommendedThreads = clampInteger(
    Number(input.recommendedCpuThreads) || 1,
    1,
    clampInteger(Number(input.availableCpuThreads) || 1, 1, 256),
  );
  const best = candidates
    .slice()
    .sort((left, right) => (
      rankCandidate(left, input.goal, recommendedThreads) -
      rankCandidate(right, input.goal, recommendedThreads)
    ))[0];
  const { confidence } = resolveHashrateModels(input);

  return {
    ...best,
    goal: input.goal,
    confidence,
    reasons: recommendationReasons(input.goal, best),
  };
}

export function efficiencyGoalLabel(goal: EfficiencyGoal) {
  switch (goal) {
    case "lowest_power":
      return "Lowest Power";
    case "max_efficiency":
      return "Max Efficiency";
    case "balanced":
      return "Balanced";
    case "max_hashrate":
      return "Max Hashrate";
  }
}

export function formatJoulesPerTerahash(value: number | null) {
  const safeValue = finitePositive(value) ? value : null;
  if (safeValue === null) {
    return "Waiting";
  }

  if (safeValue < 1_000) {
    return `${safeValue.toFixed(1)} J/TH`;
  }

  return `${(safeValue / 1_000).toFixed(1)} kJ/TH`;
}

export function calculateEfficiencySnapshot(sample: EfficiencySample): EfficiencySnapshot {
  const hashrate = finitePositive(sample.hashrate) ? sample.hashrate : 0;
  const watts = finitePositive(sample.watts) ? sample.watts : null;
  const hashesPerJoule = hashrate > 0 && watts ? hashrate / watts : null;
  const joulesPerTerahash = hashesPerJoule ? HASHES_PER_TH / hashesPerJoule : null;

  let efficiencyLabel: EfficiencySnapshot["efficiencyLabel"] = "waiting";
  if (hashrate > 0 && !watts) {
    efficiencyLabel = "unknown-power";
  } else if (joulesPerTerahash !== null) {
    if (joulesPerTerahash <= 20) {
      efficiencyLabel = "industrial-asic";
    } else if (joulesPerTerahash <= 80) {
      efficiencyLabel = "home-asic";
    } else {
      efficiencyLabel = "pc-class";
    }
  }

  return {
    hashrate,
    watts,
    joulesPerTerahash,
    hashesPerJoule,
    efficiencyLabel,
  };
}
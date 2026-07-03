import type { MiningAlgorithmPlan, MiningAlgorithmOperatingPoint } from "./algorithmPlanner.js";
import type { AlgorithmResearchSourceId } from "./algorithmResearchReview.js";
import type { HashKernelBenchmarkEvidence, HashKernelBenchmarkPerformance, HashKernelBenchmarkStatus } from "./hashKernelBenchmark.js";
import type { HashRuntimeEfficiencySnapshot } from "./hashRuntimeEfficiency.js";
import type { HashRuntimeGuardLevel, HashRuntimeGuardSnapshot, HashRuntimeRecoveryAction } from "./hashRuntimeGuard.js";
import { deriveHashRuntimeGuard } from "./hashRuntimeGuard.js";
import type { HashDensityMarginalDecisionStatus } from "./hashDensityPlanner.js";

export type HashOperatingPolicyMode =
  | "collect_evidence"
  | "eco_density"
  | "balanced_density"
  | "hashrate_burst"
  | "runtime_guard"
  | "external_dry_run"
  | "monitor_only";

export type HashOperatingPolicyAction =
  | "capture_evidence"
  | "run_local_density"
  | "probe_hashrate_headroom"
  | "reduce_runtime_waste"
  | "validate_external_work"
  | "hold_current";

export type HashOperatingRuntimeGuardLevel = HashRuntimeGuardLevel;
export type HashKernelOptimizationMode =
  | "midstate_density"
  | "full_header_baseline"
  | "midstate_regression_watch"
  | "midstate_evidence_wait";

export interface HashOperatingPolicyInput {
  runtimeEfficiency?: HashRuntimeEfficiencySnapshot | null;
  kernelBenchmark?: HashKernelBenchmarkEvidence | null;
}

export interface HashKernelOptimizationSnapshot {
  mode: HashKernelOptimizationMode;
  benchmarkStatus: HashKernelBenchmarkStatus;
  benchmarkPerformance: HashKernelBenchmarkPerformance;
  midstatePreferred: boolean;
  speedupRatio: number | null;
  hashDensityGainPercent: number | null;
  compressionWorkSavedPercent: number | null;
  summary: string;
  nextStep: string;
}

export interface HashOperatingPolicySnapshot {
  schemaVersion: 1;
  mode: HashOperatingPolicyMode;
  action: HashOperatingPolicyAction;
  autoApplyAllowed: boolean;
  unattendedLocalAllowed: boolean;
  externalMiningAllowed: false;
  externalDryRunOnly: boolean;
  defaultPointRole: MiningAlgorithmOperatingPoint["role"];
  defaultPointStatus: MiningAlgorithmOperatingPoint["status"];
  defaultPointHashrate: number | null;
  defaultPointWatts: number | null;
  defaultPointJoulesPerTerahash: number | null;
  burstPointRole: MiningAlgorithmOperatingPoint["role"];
  burstAllowed: boolean;
  burstDecisionStatus: HashDensityMarginalDecisionStatus;
  burstDensityRetentionRatio: number | null;
  burstHashrate: number | null;
  burstWatts: number | null;
  runtimeGuard: HashOperatingRuntimeGuardLevel;
  runtimeEfficiencyStatus: HashRuntimeEfficiencySnapshot["status"] | "not_observed";
  runtimePromotionAllowed: boolean;
  runtimeRecoveryAction: HashRuntimeRecoveryAction;
  runtimeQualityLossHashrate: number | null;
  runtimeThrottleHashrateAtRisk: number | null;
  runtimeEffectiveHashrate: number | null;
  runtimeWastedHashrate: number | null;
  runtimeGpuThrottleHashrateAtRisk: number | null;
  runtimeEffectiveRatio: number | null;
  runtimeShareWasteRatio: number | null;
  runtimeGpuThrottleRatio: number | null;
  kernelOptimization: HashKernelOptimizationSnapshot;
  kernelPromotionAllowed: boolean;
  sourceIds: AlgorithmResearchSourceId[];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

function sourceIds(plan: MiningAlgorithmPlan): AlgorithmResearchSourceId[] {
  const preferred: AlgorithmResearchSourceId[] = [
    "bitcoin_consensus_pow",
    "local_midstate_regression",
    "measured_power_telemetry",
    "sha256_uniform_search",
    "bip320_version_bits",
    "bip323_version_bits",
    "stratum_v2_mining_protocol",
    "hashprice_demand_response_2026",
  ];
  const available = new Set(plan.researchReview.sourceIds);
  return preferred.filter((id) => available.has(id));
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function deriveKernelOptimization(
  benchmark: HashKernelBenchmarkEvidence | null | undefined,
): HashKernelOptimizationSnapshot {
  if (!benchmark) {
    return {
      mode: "midstate_evidence_wait",
      benchmarkStatus: "waiting",
      benchmarkPerformance: "unknown",
      midstatePreferred: false,
      speedupRatio: null,
      hashDensityGainPercent: null,
      compressionWorkSavedPercent: null,
      summary: "Kernel policy is waiting for a full-header vs midstate benchmark.",
      nextStep: "Run or import the fixed-window kernel benchmark before treating midstate reuse as the preferred local hash-density path.",
    };
  }

  if (benchmark.status === "blocked") {
    return {
      mode: "full_header_baseline",
      benchmarkStatus: benchmark.status,
      benchmarkPerformance: benchmark.performance,
      midstatePreferred: false,
      speedupRatio: benchmark.speedupRatio,
      hashDensityGainPercent: benchmark.hashDensityGainPercent ?? null,
      compressionWorkSavedPercent: benchmark.compressionWorkSavedPercent ?? null,
      summary: "Kernel policy falls back to the full-header baseline because midstate equivalence is blocked.",
      nextStep: benchmark.nextStep,
    };
  }

  if (benchmark.status === "waiting") {
    return {
      mode: "midstate_evidence_wait",
      benchmarkStatus: benchmark.status,
      benchmarkPerformance: benchmark.performance,
      midstatePreferred: false,
      speedupRatio: benchmark.speedupRatio,
      hashDensityGainPercent: benchmark.hashDensityGainPercent ?? null,
      compressionWorkSavedPercent: benchmark.compressionWorkSavedPercent ?? null,
      summary: "Kernel policy is waiting for complete midstate benchmark evidence.",
      nextStep: benchmark.nextStep,
    };
  }

  if (benchmark.performance === "regression") {
    return {
      mode: "midstate_regression_watch",
      benchmarkStatus: benchmark.status,
      benchmarkPerformance: benchmark.performance,
      midstatePreferred: false,
      speedupRatio: benchmark.speedupRatio,
      hashDensityGainPercent: benchmark.hashDensityGainPercent ?? null,
      compressionWorkSavedPercent: benchmark.compressionWorkSavedPercent ?? null,
      summary: "Kernel policy keeps midstate equivalence evidence but does not prefer it while local speed is regressing.",
      nextStep: benchmark.nextStep,
    };
  }

  const densityGainText = benchmark.hashDensityGainPercent == null
    ? "measured gain waiting"
    : `${benchmark.hashDensityGainPercent >= 0 ? "+" : ""}${benchmark.hashDensityGainPercent}% measured H/s`;
  const compressionText = benchmark.compressionWorkSavedPercent == null
    ? "compression saving waiting"
    : `${benchmark.compressionWorkSavedPercent}% compression work saved`;
  return {
    mode: "midstate_density",
    benchmarkStatus: benchmark.status,
    benchmarkPerformance: benchmark.performance,
    midstatePreferred: true,
    speedupRatio: benchmark.speedupRatio,
    hashDensityGainPercent: benchmark.hashDensityGainPercent ?? null,
    compressionWorkSavedPercent: benchmark.compressionWorkSavedPercent ?? null,
    summary: benchmark.performance === "neutral"
      ? `Kernel policy accepts midstate reuse as consensus-equivalent, with neutral local speed and ${compressionText}.`
      : `Kernel policy prefers midstate reuse for local useful-hash density (${densityGainText}, ${compressionText}).`,
    nextStep: benchmark.nextStep,
  };
}
function localReady(plan: MiningAlgorithmPlan) {
  return plan.readinessCertificate.readyForUnattendedLocal && plan.densityPlan.readyForLongRun;
}

function burstAllowed(plan: MiningAlgorithmPlan) {
  return localReady(plan) &&
    plan.densityPlan.hashrateHeadroom.status === "available" &&
    plan.densityPlan.marginalDecision.status === "advance" &&
    plan.operatingEnvelope.maxHashrate.status === "ready" &&
    finitePositive(plan.operatingEnvelope.maxHashrate.hashrate);
}

function marginalNextStep(plan: MiningAlgorithmPlan) {
  const decision = plan.densityPlan.marginalDecision;
  switch (decision.status) {
    case "advance":
      return "Use the measured density lane by default and keep the max-hash profile as a manual high-output option.";
    case "hold":
      return "Stay on the selected density lane; the max-hash profile spends too many extra watts for the useful hash it adds.";
    case "measure":
      return decision.nextStep;
    case "cooldown":
      return "Keep the high-output profile blocked until cooling, intensity, or long-run stability evidence improves.";
    case "none":
      return "Classify max-hash headroom before chasing more throughput.";
  }
}

function marginalSummary(plan: MiningAlgorithmPlan) {
  const decision = plan.densityPlan.marginalDecision;
  if (decision.status === "none") {
    return "highest-hash mode gated by headroom evidence";
  }
  return decision.summary;
}

function externalDryRunRouteActive(plan: MiningAlgorithmPlan) {
  return plan.strategy === "external_work_dry_run" ||
    (plan.recommendedRoute === "external" && plan.densityPlan.externalDryRunOnly);
}

function deriveMode(
  plan: MiningAlgorithmPlan,
  canBurst: boolean,
  guardLevel: HashOperatingRuntimeGuardLevel,
): HashOperatingPolicyMode {
  if (externalDryRunRouteActive(plan)) {
    return "external_dry_run";
  }
  if (guardLevel === "block" && localReady(plan)) {
    return "runtime_guard";
  }
  if (!localReady(plan)) {
    return "collect_evidence";
  }
  if (canBurst && plan.operatingEnvelope.recommendedPoint.role === "max_hashrate") {
    return "hashrate_burst";
  }
  if (plan.densityPlan.selectedLane.id === "local_lowest_power" ||
    plan.operatingEnvelope.recommendedPoint.role === "lowest_power") {
    return "eco_density";
  }
  if (plan.recommendedRoute === "monitor") {
    return "monitor_only";
  }
  return "balanced_density";
}

function actionForMode(mode: HashOperatingPolicyMode): HashOperatingPolicyAction {
  switch (mode) {
    case "collect_evidence":
      return "capture_evidence";
    case "external_dry_run":
      return "validate_external_work";
    case "hashrate_burst":
      return "probe_hashrate_headroom";
    case "runtime_guard":
      return "reduce_runtime_waste";
    case "eco_density":
    case "balanced_density":
      return "run_local_density";
    case "monitor_only":
      return "hold_current";
  }
}

function nextStepForMode(
  plan: MiningAlgorithmPlan,
  mode: HashOperatingPolicyMode,
  canBurst: boolean,
  guard: HashRuntimeGuardSnapshot,
) {
  switch (mode) {
    case "collect_evidence":
      return plan.samplingPlan.nextStep;
    case "external_dry_run":
      return "Validate external work leases, stale-result rejection, thermal limits, and share accounting; keep real external mining disabled.";
    case "hashrate_burst":
      return "Treat max-hashrate as a measured burst profile; fall back to the density lane if thermals, rejects, or share waste degrade.";
    case "runtime_guard":
      return guard.nextStep;
    case "eco_density":
      return "Use the lowest-power stable density lane as the default operating point.";
    case "balanced_density":
      return canBurst
        ? "Use the measured density lane by default and keep the max-hash profile as a manual burst option."
        : marginalNextStep(plan);
    case "monitor_only":
      return plan.routeAction?.detail ?? "Hold the current route and monitor for new evidence.";
  }
}

function summaryForMode(
  plan: MiningAlgorithmPlan,
  mode: HashOperatingPolicyMode,
  canBurst: boolean,
  guard: HashRuntimeGuardSnapshot,
) {
  const selected = plan.operatingEnvelope.recommendedPoint;
  switch (mode) {
    case "collect_evidence":
      return `Operating policy is collecting evidence before auto-applying a profile: ${plan.samplingPlan.summary}`;
    case "external_dry_run":
      return "Operating policy keeps external high-hash work in dry-run validation; real external mining start remains forbidden.";
    case "hashrate_burst": {
      const retention = plan.densityPlan.marginalDecision.densityRetentionRatio;
      const retentionText = typeof retention === "number" && Number.isFinite(retention)
        ? ` at ${Math.round(retention * 100)}% marginal density retention`
        : "";
      return `Operating policy allows measured max-hash burst from ${Math.round(selected.hashrate ?? 0).toLocaleString("en-US")} H/s${retentionText} while preserving density fallback.`;
    }
    case "runtime_guard":
      return guard.summary;
    case "eco_density":
      return "Operating policy defaults to the lowest-power stable density lane.";
    case "balanced_density":
      return canBurst
        ? "Operating policy defaults to measured useful-hash density and keeps verified max-hash headroom available as manual burst."
        : `Operating policy defaults to measured useful-hash density and keeps ${marginalSummary(plan)}.`;
    case "monitor_only":
      return "Operating policy is monitor-only until route evidence changes.";
  }
}

export function deriveHashOperatingPolicy(
  plan: MiningAlgorithmPlan,
  input: HashOperatingPolicyInput = {},
): HashOperatingPolicySnapshot {
  const defaultPoint = plan.operatingEnvelope.recommendedPoint;
  const burstPoint = plan.operatingEnvelope.maxHashrate;
  const guard = deriveHashRuntimeGuard(input.runtimeEfficiency);
  const kernelOptimization = deriveKernelOptimization(input.kernelBenchmark);
  const kernelPromotionAllowed = kernelOptimization.mode === "midstate_density";
  const canBurst = guard.level === "clear" && kernelPromotionAllowed && burstAllowed(plan);
  const mode = deriveMode(plan, canBurst, guard.level);
  const autoApplyAllowed = localReady(plan) &&
    (mode === "eco_density" || mode === "balanced_density") &&
    defaultPoint.role !== "max_hashrate" &&
    guard.level === "clear" &&
    kernelPromotionAllowed;
  const runtimeEfficiency = input.runtimeEfficiency ?? null;

  return {
    schemaVersion: 1,
    mode,
    action: actionForMode(mode),
    autoApplyAllowed,
    unattendedLocalAllowed: localReady(plan) && guard.level !== "block",
    externalMiningAllowed: false,
    externalDryRunOnly: externalDryRunRouteActive(plan),
    defaultPointRole: defaultPoint.role,
    defaultPointStatus: defaultPoint.status,
    defaultPointHashrate: defaultPoint.hashrate,
    defaultPointWatts: defaultPoint.watts,
    defaultPointJoulesPerTerahash: defaultPoint.joulesPerTerahash,
    burstPointRole: burstPoint.role,
    burstAllowed: canBurst,
    burstDecisionStatus: plan.densityPlan.marginalDecision.status,
    burstDensityRetentionRatio: plan.densityPlan.marginalDecision.densityRetentionRatio,
    burstHashrate: canBurst ? burstPoint.hashrate : null,
    burstWatts: canBurst ? burstPoint.watts : null,
    runtimeGuard: guard.level,
    runtimeEfficiencyStatus: runtimeEfficiency?.status ?? "not_observed",
    runtimePromotionAllowed: guard.promotionAllowed,
    runtimeRecoveryAction: guard.recoveryAction,
    runtimeQualityLossHashrate: guard.qualityLossHashrate,
    runtimeThrottleHashrateAtRisk: guard.throttleHashrateAtRisk,
    runtimeEffectiveHashrate: runtimeEfficiency && runtimeEfficiency.rawHashrate > 0
      ? runtimeEfficiency.provenEffectiveHashrate
      : null,
    runtimeWastedHashrate: runtimeEfficiency && runtimeEfficiency.rawHashrate > 0
      ? runtimeEfficiency.provenWastedHashrate
      : null,
    runtimeGpuThrottleHashrateAtRisk: runtimeEfficiency && runtimeEfficiency.rawHashrate > 0
      ? runtimeEfficiency.gpuThrottleHashrateAtRisk
      : null,
    runtimeEffectiveRatio: runtimeEfficiency?.effectiveRatio ?? null,
    runtimeShareWasteRatio: runtimeEfficiency?.shareWasteRatio ?? null,
    runtimeGpuThrottleRatio: runtimeEfficiency?.gpuThrottleRatio ?? null,
    kernelOptimization,
    kernelPromotionAllowed,
    sourceIds: sourceIds(plan),
    guardrails: [
      "Keep Bitcoin proof-of-work as consensus double SHA-256.",
      "Do not use nonce prediction or proof-of-work compression for submitted work.",
      "Prefer midstate reuse only when fixed-window diagnostics prove equivalence and do not show a local regression.",
      "Require measured watts, safe thermals, and share-quality evidence before unattended local auto-apply.",
      "Block profile promotion when live share waste or GPU throttle reduces useful hash density.",
      "Allow max-hash burst only when marginal hash-density decision is advance.",
      "Keep external ASIC routing dry-run or telemetry-only until release gates approve real start().",
      "Treat hashprice and market signals as operating-cost context, not as hashrate improvement.",
    ],
    summary: summaryForMode(plan, mode, canBurst, guard),
    nextStep: nextStepForMode(plan, mode, canBurst, guard),
  };
}
import type { TuningAnalysis, TuningLongRunRisk, TuningObservationResult } from "./efficiencyTuning.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import {
  OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
  OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
} from "./optimizationThresholds.js";

const HASHES_PER_TH = 1_000_000_000_000;

export type HashRouteRecommendationTarget = "waiting" | "local" | "external" | "monitor";
export type HashRouteExternalMode = "candidate" | "reference_only" | "local_only";
export type HashRouteStrategyGoal = "lowest_power" | "max_efficiency" | "balanced" | "max_hashrate";
export type HashRouteExternalHashrateBasis = "effective" | "lease_adjusted" | "raw_average" | "unknown";
export type HashRouteRecommendationReason =
  | "need_samples"
  | "need_local_samples"
  | "need_external_samples"
  | "need_external_stability"
  | "external_power"
  | "local_power"
  | "external_efficiency"
  | "external_throughput"
  | "local_efficiency"
  | "local_throughput"
  | "local_share_waste"
  | "local_long_run_risk"
  | "external_search_space"
  | "external_work_adapter"
  | "external_reference_only"
  | "external_sealed"
  | "similar_efficiency";

export interface HashRouteRecommendation {
  goal: HashRouteStrategyGoal;
  target: HashRouteRecommendationTarget;
  reason: HashRouteRecommendationReason;
  localProfile: TuningObservationResult | null;
  externalWatts: number | null;
  localWatts: number | null;
  externalJoulesPerTerahash: number | null;
  localJoulesPerTerahash: number | null;
  externalHashrate: number | null;
  externalRawHashrate: number | null;
  externalHashrateBasis: HashRouteExternalHashrateBasis;
  localHashrate: number | null;
  efficiencyRatio: number | null;
  hashrateRatio: number | null;
  localShareWasteRatio: number | null;
  localLongRunScore: number | null;
  localLongRunRisk: TuningLongRunRisk | null;
  confidence: "waiting" | "low" | "medium" | "high";
  externalSearchSpaceReady: boolean;
  externalSearchSpaceSummary: string | null;
  externalWorkLeaseUtilizationRatio: number | null;
  externalHashWasteRisk: string | null;
  externalWorkAdapterReady: boolean;
  externalWorkAdapterStatus: HashRouteExternalWorkAdapterStatus;
  externalWorkAdapterSummary: string | null;
  externalEvidenceReady: boolean;
  externalEvidenceStatus: ExternalHashHistorySummary["evidenceStatus"];
  externalEvidenceGap: number;
  externalEvidenceSummary: string;
  summary: string;
  detail: string;
}

export interface HashRouteScoreBreakdown {
  totalScore: number;
  powerScore: number;
  efficiencyScore: number;
  throughputScore: number;
  riskScore: number;
  readinessScore: number;
  confidenceScore: number;
  summary: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function hashRouteStrategyLabel(goal: HashRouteStrategyGoal) {
  switch (goal) {
    case "lowest_power":
      return "Lowest Power";
    case "max_efficiency":
      return "Max Efficiency";
    case "max_hashrate":
      return "Max Hashrate";
    case "balanced":
      return "Balanced";
  }
}

function selectLocalProfile(analysis: TuningAnalysis, goal: HashRouteStrategyGoal): TuningObservationResult | null {
  switch (goal) {
    case "lowest_power":
      return analysis.lowestPower ?? analysis.bestEfficiency ?? analysis.paretoRecommendation ?? analysis.bestHashrate ?? null;
    case "max_efficiency":
      return analysis.bestEfficiency ?? analysis.lowestPower ?? analysis.paretoRecommendation ?? analysis.bestHashrate ?? null;
    case "max_hashrate":
      return analysis.bestHashrate ?? analysis.paretoRecommendation ?? analysis.bestEfficiency ?? analysis.lowestPower ?? null;
    case "balanced":
      return analysis.powerDensityKnee ?? analysis.paretoRecommendation ?? analysis.bestEfficiency ?? analysis.lowestPower ?? analysis.bestHashrate ?? null;
  }
}

function ratio(numerator: number | null, denominator: number | null) {
  if (!finitePositive(numerator) || !finitePositive(denominator)) {
    return null;
  }
  return Number(numerator) / Number(denominator);
}

function joulesPerTerahashFrom(hashrate: number | null, watts: number | null) {
  return finitePositive(hashrate) && finitePositive(watts)
    ? Number(watts) * HASHES_PER_TH / Number(hashrate)
    : null;
}

function measuredLocalShareWaste(profile: TuningObservationResult | null) {
  return typeof profile?.shareWasteRatio === "number" && Number.isFinite(profile.shareWasteRatio) && profile.shareWasteRatio >= 0
    ? profile.shareWasteRatio
    : null;
}

function measuredLocalLongRunScore(profile: TuningObservationResult | null) {
  return typeof profile?.longRunScore === "number" && Number.isFinite(profile.longRunScore) && profile.longRunScore >= 0
    ? profile.longRunScore
    : null;
}

function measuredLocalLongRunRisk(profile: TuningObservationResult | null): TuningLongRunRisk | null {
  const risk = profile?.longRunRisk;
  return risk === "excellent" || risk === "good" || risk === "watch" || risk === "avoid" || risk === "unknown"
    ? risk
    : null;
}

function hasMeasuredLocalPower(profile: TuningObservationResult | null) {
  return profile?.powerEvidenceStatus === "measured";
}

export type HashRouteExternalWorkAdapterStatus =
  | "unknown"
  | "disabled"
  | "reserved"
  | "missing-endpoint"
  | "telemetry-only"
  | "blocked"
  | "assignable";

export interface HashRouteExternalReadiness {
  externalMode?: HashRouteExternalMode | null;
  searchSpaceReady?: boolean | null;
  searchSpaceSummary?: string | null;
  workLeaseUtilizationRatio?: number | null;
  hashWasteRisk?: "unknown" | "none" | "medium" | "high" | string | null;
  effectiveHashrate?: number | null;
  workAdapterReady?: boolean | null;
  workAdapterStatus?: HashRouteExternalWorkAdapterStatus | string | null;
  workAdapterSummary?: string | null;
}

const knownExternalWorkAdapterStatuses = new Set<string>([
  "disabled",
  "reserved",
  "missing-endpoint",
  "telemetry-only",
  "blocked",
  "assignable",
]);

function normalizeExternalWorkAdapterStatus(value: string | null | undefined): HashRouteExternalWorkAdapterStatus {
  const normalized = String(value ?? "").trim();
  return knownExternalWorkAdapterStatuses.has(normalized)
    ? normalized as HashRouteExternalWorkAdapterStatus
    : "unknown";
}

function workAdapterReadyFrom(
  readiness: HashRouteExternalReadiness | null | undefined,
  status: HashRouteExternalWorkAdapterStatus,
) {
  if (typeof readiness?.workAdapterReady === "boolean") {
    return readiness.workAdapterReady;
  }
  return status === "unknown" || status === "assignable";
}

function normalizeWorkLeaseUtilizationRatio(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.max(0, Math.min(1, numeric)) : null;
}

function normalizeHashWasteRisk(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeEffectiveExternalHashrate(value: number | null | undefined) {
  return finitePositive(value) ? Number(value) : null;
}

function normalizeExternalReadiness(readiness?: HashRouteExternalReadiness | null) {
  const workAdapterStatus = normalizeExternalWorkAdapterStatus(readiness?.workAdapterStatus);
  const externalMode = readiness?.externalMode === "local_only"
    ? "local_only"
    : readiness?.externalMode === "reference_only"
      ? "reference_only"
      : "candidate";
  return {
    externalMode,
    searchSpaceReady: readiness?.searchSpaceReady !== false,
    searchSpaceSummary: readiness?.searchSpaceSummary?.trim() || null,
    workLeaseUtilizationRatio: normalizeWorkLeaseUtilizationRatio(readiness?.workLeaseUtilizationRatio),
    hashWasteRisk: normalizeHashWasteRisk(readiness?.hashWasteRisk),
    effectiveHashrate: normalizeEffectiveExternalHashrate(readiness?.effectiveHashrate),
    workAdapterReady: workAdapterReadyFrom(readiness, workAdapterStatus),
    workAdapterStatus,
    workAdapterSummary: readiness?.workAdapterSummary?.trim() || null,
  };
}

function externalSearchSpaceDetail(summary: string | null) {
  return summary
    ? `External telemetry is promising, but search-space readiness is not proven: ${summary}`
    : "External telemetry is promising, but search-space readiness is not proven for high-hash routing.";
}

function externalWorkAdapterDetail(status: HashRouteExternalWorkAdapterStatus, summary: string | null) {
  const statusDetail = (() => {
    switch (status) {
      case "reserved":
        return "Direct external hash is reserved until the physical protocol and endpoint are selected.";
      case "telemetry-only":
        return "Network external hash is telemetry-only; it can report efficiency but cannot receive jobs or submit shares.";
      case "missing-endpoint":
        return "Network external hash needs a host before work leases can be tested.";
      case "blocked":
        return "External hash adapter capabilities are incomplete for safe work leases.";
      case "disabled":
        return "External hash interface is disabled.";
      case "assignable":
        return "External hash adapter can receive dry-run work leases, but real external mining is still not enabled.";
      case "unknown":
        return "External hash work-adapter readiness is not proven.";
    }
  })();
  return summary ? `${statusDetail} ${summary}` : statusDetail;
}

function externalUsableEfficiencySampleCount(externalHistory: ExternalHashHistorySummary) {
  return typeof externalHistory.usableEfficiencySampleCount === "number" &&
    Number.isFinite(externalHistory.usableEfficiencySampleCount)
    ? Math.max(0, Math.trunc(externalHistory.usableEfficiencySampleCount))
    : externalHistory.efficiencySampleCount;
}

function confidenceForSamples(localProfile: TuningObservationResult | null, external: ExternalHashHistorySummary) {
  if (!localProfile || external.efficiencySampleCount === 0) {
    return "waiting" as const;
  }
  const usableEfficiencySampleCount = externalUsableEfficiencySampleCount(external);
  if (!externalEvidenceReady(external)) {
    return usableEfficiencySampleCount > 0 ? "low" as const : "waiting" as const;
  }
  if (external.trend === "degrading") {
    return "low" as const;
  }
  if (!hasMeasuredLocalPower(localProfile)) {
    return "low" as const;
  }
  if ((measuredLocalShareWaste(localProfile) ?? 0) > 0.1) {
    return "low" as const;
  }
  const localLongRunRisk = measuredLocalLongRunRisk(localProfile);
  if (localLongRunRisk === "avoid" || localLongRunRisk === "watch") {
    return "low" as const;
  }
  if (localProfile.stabilityWindowStatus === "stable" && usableEfficiencySampleCount >= OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "high" as const;
  }
  if (usableEfficiencySampleCount >= OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "medium" as const;
  }
  return "low" as const;
}

function measuredLocalJoules(profile: TuningObservationResult | null) {
  if (!hasMeasuredLocalPower(profile)) {
    return null;
  }

  return finitePositive(profile?.qualityAdjustedJoulesPerTerahash)
    ? Number(profile?.qualityAdjustedJoulesPerTerahash)
    : finitePositive(profile?.effectiveJoulesPerTerahash)
      ? Number(profile?.effectiveJoulesPerTerahash)
      : finitePositive(profile?.joulesPerTerahash)
        ? Number(profile?.joulesPerTerahash)
        : null;
}

function measuredLocalWatts(profile: TuningObservationResult | null) {
  if (!hasMeasuredLocalPower(profile)) {
    return null;
  }

  return finitePositive(profile?.watts)
    ? Number(profile?.watts)
    : null;
}

function measuredLocalHashrate(profile: TuningObservationResult | null) {
  return finitePositive(profile?.qualityAdjustedHashrate)
    ? Number(profile?.qualityAdjustedHashrate)
    : finitePositive(profile?.effectiveHashrate)
      ? Number(profile?.effectiveHashrate)
      : finitePositive(profile?.hashrate)
        ? Number(profile?.hashrate)
        : null;
}

function externalAverageJoules(externalHistory: ExternalHashHistorySummary) {
  return finitePositive(externalHistory.averageJoulesPerTerahash)
    ? Number(externalHistory.averageJoulesPerTerahash)
    : finitePositive(externalHistory.bestJoulesPerTerahash)
      ? Number(externalHistory.bestJoulesPerTerahash)
      : null;
}

function externalAverageWatts(externalHistory: ExternalHashHistorySummary) {
  return finitePositive(externalHistory.averageWatts)
    ? Number(externalHistory.averageWatts)
    : null;
}

function externalAverageHashrate(externalHistory: ExternalHashHistorySummary) {
  return finitePositive(externalHistory.averageHashrate)
    ? Number(externalHistory.averageHashrate)
    : null;
}

function externalRouteHashrate(
  externalHistory: ExternalHashHistorySummary,
  readiness: ReturnType<typeof normalizeExternalReadiness>,
) {
  const rawHashrate = externalAverageHashrate(externalHistory);
  if (readiness.effectiveHashrate !== null) {
    return rawHashrate === null ? readiness.effectiveHashrate : Math.min(rawHashrate, readiness.effectiveHashrate);
  }
  if (rawHashrate !== null && readiness.workLeaseUtilizationRatio !== null) {
    return rawHashrate * readiness.workLeaseUtilizationRatio;
  }
  return rawHashrate;
}

function externalRouteHashrateBasis(
  externalHistory: ExternalHashHistorySummary,
  readiness: ReturnType<typeof normalizeExternalReadiness>,
): HashRouteExternalHashrateBasis {
  const rawHashrate = externalAverageHashrate(externalHistory);
  if (readiness.effectiveHashrate !== null) {
    return "effective";
  }
  if (rawHashrate !== null && readiness.workLeaseUtilizationRatio !== null) {
    return "lease_adjusted";
  }
  return rawHashrate !== null ? "raw_average" : "unknown";
}

function externalHashrateBasisLabel(basis: HashRouteExternalHashrateBasis) {
  return basis.replace(/_/g, " ");
}

function externalEvidenceReady(externalHistory: ExternalHashHistorySummary) {
  if (externalHistory.trend === "degrading") {
    return false;
  }
  return typeof externalHistory.evidenceReady === "boolean"
    ? externalHistory.evidenceReady
    : externalUsableEfficiencySampleCount(externalHistory) >= OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES;
}

function externalEvidenceStatus(externalHistory: ExternalHashHistorySummary): ExternalHashHistorySummary["evidenceStatus"] {
  if (externalHistory.evidenceStatus) {
    return externalHistory.evidenceStatus;
  }
  const usableEfficiencySampleCount = externalUsableEfficiencySampleCount(externalHistory);
  if (usableEfficiencySampleCount >= OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "stable";
  }
  if (usableEfficiencySampleCount >= OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES) {
    return "ready";
  }
  return usableEfficiencySampleCount > 0 ? "probing" : "waiting";
}

function externalEvidenceGap(externalHistory: ExternalHashHistorySummary) {
  if (typeof externalHistory.evidenceGap === "number" && Number.isFinite(externalHistory.evidenceGap)) {
    return Math.max(0, Math.trunc(externalHistory.evidenceGap));
  }
  return Math.max(0, OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES - externalUsableEfficiencySampleCount(externalHistory));
}

function externalEvidenceDetail(externalHistory: ExternalHashHistorySummary) {
  const gap = externalEvidenceGap(externalHistory);
  const sampleWord = gap === 1 ? "sample" : "samples";
  if (externalHistory.trend === "degrading") {
    return `External telemetry is degrading; keep sampling until efficiency stabilizes before it can guide long-run routing. ${externalHistory.summary}`;
  }
  return gap > 0
    ? `External telemetry needs ${gap} more usable efficiency ${sampleWord} before it can guide long-run routing. ${externalHistory.summary}`
    : `External telemetry is still probing; keep sampling until evidence status is ready. ${externalHistory.summary}`;
}

function ratioText(numerator: number, denominator: number) {
  return (numerator / denominator).toFixed(1);
}

function percentText(ratioValue: number) {
  return `${Math.round(ratioValue * 100)}%`;
}

export type HashRouteManualActionKind =
  | "capture_local_sample"
  | "test_external_telemetry"
  | "apply_local_profile"
  | "monitor_route";

export interface HashRouteManualAction {
  goal: HashRouteStrategyGoal;
  kind: HashRouteManualActionKind;
  target: HashRouteRecommendationTarget;
  label: string;
  detail: string;
  safetyNote: string;
  enabledByRecommendation: boolean;
  requiresExternalTelemetry: boolean;
  localProfile: TuningObservationResult | null;
}

export function planHashRouteManualAction(recommendation: HashRouteRecommendation): HashRouteManualAction {
  const strategyName = hashRouteStrategyLabel(recommendation.goal);
  const base = {
    goal: recommendation.goal,
    target: recommendation.target,
    localProfile: recommendation.localProfile,
  };

  if (recommendation.reason === "need_samples" || recommendation.reason === "need_local_samples") {
    return {
      ...base,
      kind: "capture_local_sample",
      label: `Capture ${strategyName}`,
      detail: "Capture the current local tuning profile with comparable power, share, and hashrate evidence before routing against external telemetry.",
      safetyNote: "Records a local sample only; it does not change mining mode, power, pool, or external hardware.",
      enabledByRecommendation: true,
      requiresExternalTelemetry: false,
    };
  }

  if (recommendation.reason === "need_external_samples" || recommendation.reason === "need_external_stability") {
    const needsStability = recommendation.reason === "need_external_stability";
    return {
      ...base,
      kind: "test_external_telemetry",
      label: needsStability ? "Sample External" : "Test External",
      detail: needsStability
        ? "Collect another network telemetry sample before trusting external J/TH or hashrate for long-run routing."
        : "Read network telemetry so the advisor can compare J/TH and hashrate against local samples.",
      safetyNote: "Telemetry check only; it does not route jobs or submit shares through external hardware.",
      enabledByRecommendation: true,
      requiresExternalTelemetry: true,
    };
  }
  if (recommendation.reason === "external_search_space" || recommendation.reason === "external_work_adapter") {
    const isAdapterBlock = recommendation.reason === "external_work_adapter";
    return {
      ...base,
      kind: "monitor_route",
      label: isAdapterBlock ? "Check Adapter" : "Check Search Space",
      detail: recommendation.detail,
      safetyNote: isAdapterBlock
        ? "External network adapters stay telemetry-only and direct adapters stay reserved until protocol, work-lease, and share-submission evidence are proven."
        : "External direct and network adapters are reserved until version rolling, extranonce, and job partitioning are proven.",
      enabledByRecommendation: false,
      requiresExternalTelemetry: false,
    };
  }

  if (recommendation.target === "local" && recommendation.localProfile) {
    return {
      ...base,
      kind: "apply_local_profile",
      label: `Apply ${strategyName}`,
      detail: `Apply measured local profile ${recommendation.localProfile.step.summary} to the draft settings.`,
      safetyNote: "Updates draft local settings only; mining still starts only after the user saves and starts manually.",
      enabledByRecommendation: true,
      requiresExternalTelemetry: false,
    };
  }

  if (recommendation.target === "external") {
    const adapterAssignable = recommendation.externalWorkAdapterStatus === "assignable";
    return {
      ...base,
      kind: "test_external_telemetry",
      label: "Verify External",
      detail: adapterAssignable
        ? `Verify external telemetry and mock lease evidence before relying on it. ${recommendation.externalWorkAdapterSummary ?? ""}`.trim()
        : "Verify the external device still reports the winning efficiency or throughput before relying on it.",
      safetyNote: adapterAssignable
        ? "Dry-run lease verification only; real external start() and share submission stay disabled until hardware validation is complete."
        : "External route remains advisory; this app does not hand Stratum jobs to the device yet.",
      enabledByRecommendation: true,
      requiresExternalTelemetry: true,
    };
  }

  return {
    ...base,
    kind: "monitor_route",
    label: `Monitor ${strategyName}`,
    detail: recommendation.detail,
    safetyNote: "No route is strong enough to act on yet; keep collecting comparable samples.",
    enabledByRecommendation: false,
    requiresExternalTelemetry: false,
  };
}

export function planHashRouteManualActions(
  recommendations: HashRouteRecommendation[],
): HashRouteManualAction[] {
  return recommendations.map((recommendation) => planHashRouteManualAction(recommendation));
}

export type HashRouteDecisionStatus = "waiting" | "apply_local" | "verify_external" | "monitor" | "risk";

export interface HashRouteDecision {
  status: HashRouteDecisionStatus;
  score: number;
  primaryGoal: HashRouteStrategyGoal;
  primaryRecommendation: HashRouteRecommendation;
  primaryAction: HashRouteManualAction;
  target: HashRouteRecommendationTarget;
  summary: string;
  detail: string;
  safetyNote: string;
}

function confidenceScore(confidence: HashRouteRecommendation["confidence"]) {
  switch (confidence) {
    case "high":
      return 90;
    case "medium":
      return 68;
    case "low":
      return 42;
    case "waiting":
      return 18;
  }
}

function routeReadinessScore(target: HashRouteRecommendationTarget) {
  switch (target) {
    case "local":
    case "external":
      return 82;
    case "monitor":
      return 46;
    case "waiting":
      return 18;
  }
}

function longRunDecisionScore(recommendation: HashRouteRecommendation) {
  if (finitePositive(recommendation.localLongRunScore)) {
    return Number(recommendation.localLongRunScore);
  }
  if (recommendation.localProfile) {
    return 62;
  }
  return 38;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function relativeLowerScore(selected: number | null, alternative: number | null) {
  if (!finitePositive(selected)) {
    return 20;
  }
  if (!finitePositive(alternative)) {
    return 68;
  }

  return clampScore(50 + Math.log2(Number(alternative) / Number(selected)) * 24);
}

function relativeHigherScore(selected: number | null, alternative: number | null) {
  if (!finitePositive(selected)) {
    return 20;
  }
  if (!finitePositive(alternative)) {
    return 68;
  }

  return clampScore(50 + Math.log2(Number(selected) / Number(alternative)) * 24);
}

function recommendationTargetSide(recommendation: HashRouteRecommendation): "local" | "external" | "undecided" {
  if (recommendation.target === "local" || recommendation.reason.startsWith("local_")) {
    return "local";
  }
  if (recommendation.target === "external" || recommendation.reason.startsWith("external_")) {
    return "external";
  }
  return "undecided";
}

function goalScoreWeights(goal: HashRouteStrategyGoal) {
  switch (goal) {
    case "lowest_power":
      return { power: 0.36, efficiency: 0.12, throughput: 0.12, risk: 0.22, readiness: 0.12, confidence: 0.06 };
    case "max_efficiency":
      return { power: 0.14, efficiency: 0.36, throughput: 0.12, risk: 0.22, readiness: 0.10, confidence: 0.06 };
    case "balanced":
      return { power: 0.18, efficiency: 0.22, throughput: 0.22, risk: 0.20, readiness: 0.12, confidence: 0.06 };
    case "max_hashrate":
      return { power: 0.10, efficiency: 0.14, throughput: 0.40, risk: 0.20, readiness: 0.10, confidence: 0.06 };
  }
}

function selectedRouteValues(recommendation: HashRouteRecommendation) {
  const side = recommendationTargetSide(recommendation);
  if (side === "external") {
    return {
      selectedWatts: recommendation.externalWatts,
      alternativeWatts: recommendation.localWatts,
      selectedJoules: recommendation.externalJoulesPerTerahash,
      alternativeJoules: recommendation.localJoulesPerTerahash,
      selectedHashrate: recommendation.externalHashrate,
      alternativeHashrate: recommendation.localHashrate,
    };
  }
  if (side === "local") {
    return {
      selectedWatts: recommendation.localWatts,
      alternativeWatts: recommendation.externalWatts,
      selectedJoules: recommendation.localJoulesPerTerahash,
      alternativeJoules: recommendation.externalJoulesPerTerahash,
      selectedHashrate: recommendation.localHashrate,
      alternativeHashrate: recommendation.externalHashrate,
    };
  }

  return {
    selectedWatts: null,
    alternativeWatts: null,
    selectedJoules: null,
    alternativeJoules: null,
    selectedHashrate: null,
    alternativeHashrate: null,
  };
}

function routeRiskScore(recommendation: HashRouteRecommendation) {
  if (recommendation.reason === "external_search_space" || recommendation.reason === "external_work_adapter") {
    return 36;
  }
  if (recommendation.reason === "need_external_stability") {
    return 34;
  }
  if (recommendation.target === "waiting") {
    return 24;
  }
  if (recommendation.target === "external") {
    return recommendation.localLongRunRisk === "avoid" || recommendation.localShareWasteRatio !== null && recommendation.localShareWasteRatio > 0.1
      ? 78
      : 68;
  }
  if (recommendation.target === "local") {
    return finitePositive(recommendation.localLongRunScore)
      ? Number(recommendation.localLongRunScore)
      : 62;
  }
  return recommendation.localLongRunRisk === "avoid" ? 30 : 48;
}

export function scoreHashRouteRecommendation(recommendation: HashRouteRecommendation): HashRouteScoreBreakdown {
  const values = selectedRouteValues(recommendation);
  const powerScore = relativeLowerScore(values.selectedWatts, values.alternativeWatts);
  const efficiencyScore = relativeLowerScore(values.selectedJoules, values.alternativeJoules);
  const throughputScore = relativeHigherScore(values.selectedHashrate, values.alternativeHashrate);
  const riskScore = routeRiskScore(recommendation);
  const readinessScore = recommendation.reason === "external_search_space" || recommendation.reason === "external_work_adapter"
    ? 30
    : recommendation.reason === "need_external_stability"
      ? 34
      : routeReadinessScore(recommendation.target);
  const recommendationConfidenceScore = confidenceScore(recommendation.confidence);
  const weights = goalScoreWeights(recommendation.goal);
  const totalScore = clampScore(
    powerScore * weights.power +
    efficiencyScore * weights.efficiency +
    throughputScore * weights.throughput +
    riskScore * weights.risk +
    readinessScore * weights.readiness +
    recommendationConfidenceScore * weights.confidence,
  );

  return {
    totalScore,
    powerScore,
    efficiencyScore,
    throughputScore,
    riskScore: clampScore(riskScore),
    readinessScore: clampScore(readinessScore),
    confidenceScore: clampScore(recommendationConfidenceScore),
    summary: `Score ${totalScore}/100: power ${powerScore}, efficiency ${efficiencyScore}, hash ${throughputScore}, risk ${clampScore(riskScore)}.`,
  };
}

function decisionStatusFor(
  recommendation: HashRouteRecommendation,
  action: HashRouteManualAction,
): HashRouteDecisionStatus {
  if (recommendation.target === "waiting" || recommendation.reason === "need_samples" || action.kind === "capture_local_sample") {
    return "waiting";
  }
  if (recommendation.reason === "local_long_run_risk" || recommendation.reason === "local_share_waste") {
    return action.kind === "test_external_telemetry" ? "verify_external" : "risk";
  }
  if (action.kind === "apply_local_profile") {
    return "apply_local";
  }
  if (action.kind === "test_external_telemetry") {
    return "verify_external";
  }
  return "monitor";
}

function decisionScoreFor(
  recommendation: HashRouteRecommendation,
  action: HashRouteManualAction,
) {
  const status = decisionStatusFor(recommendation, action);
  const objectiveScore = scoreHashRouteRecommendation(recommendation).totalScore;
  const rawScore = routeReadinessScore(recommendation.target) * 0.28 +
    confidenceScore(recommendation.confidence) * 0.20 +
    longRunDecisionScore(recommendation) * 0.20 +
    objectiveScore * 0.32;

  if (status === "risk") {
    return Math.min(45, clampScore(rawScore));
  }
  if (status === "waiting") {
    return Math.min(35, clampScore(rawScore));
  }
  return clampScore(rawScore);
}

function goalPriority(goal: HashRouteStrategyGoal) {
  switch (goal) {
    case "lowest_power":
      return 4;
    case "balanced":
      return 3;
    case "max_efficiency":
      return 2;
    case "max_hashrate":
      return 1;
  }
}

function reasonPriority(reason: HashRouteRecommendationReason) {
  switch (reason) {
    case "local_long_run_risk":
      return 60;
    case "local_share_waste":
      return 54;
    case "external_work_adapter":
      return 50;
    case "external_search_space":
      return 48;
    case "external_power":
    case "local_power":
      return 45;
    case "external_efficiency":
    case "local_efficiency":
      return 42;
    case "external_throughput":
    case "local_throughput":
      return 36;
    case "need_external_stability":
      return 34;
    case "need_samples":
    case "need_local_samples":
    case "need_external_samples":
      return 28;
    case "external_sealed":
      return 26;
    case "external_reference_only":
      return 24;
    case "similar_efficiency":
      return 12;
  }
}

function actionPriority(action: HashRouteManualAction) {
  if (!action.enabledByRecommendation) {
    return 0;
  }
  switch (action.kind) {
    case "test_external_telemetry":
      return 18;
    case "apply_local_profile":
      return 16;
    case "capture_local_sample":
      return 14;
    case "monitor_route":
      return 0;
  }
}

function recommendationDecisionPriority(
  recommendation: HashRouteRecommendation,
  action: HashRouteManualAction,
) {
  return reasonPriority(recommendation.reason) +
    actionPriority(action) +
    confidenceScore(recommendation.confidence) * 0.18 +
    scoreHashRouteRecommendation(recommendation).totalScore * 0.22 +
    goalPriority(recommendation.goal) * 3;
}

function decisionSummary(
  recommendation: HashRouteRecommendation,
  action: HashRouteManualAction,
  status: HashRouteDecisionStatus,
  score: number,
) {
  const strategyName = hashRouteStrategyLabel(recommendation.goal);
  switch (status) {
    case "waiting":
      return `${strategyName}: collect route samples (${score}/100).`;
    case "apply_local":
      return `${strategyName}: apply measured local profile (${score}/100).`;
    case "verify_external":
      return `${strategyName}: verify external route (${score}/100).`;
    case "risk":
      return `${strategyName}: hold route until risk clears (${score}/100).`;
    case "monitor":
      return `${strategyName}: monitor before changing route (${score}/100).`;
  }
}

export function summarizeHashRouteDecision(
  recommendations: HashRouteRecommendation[],
  actions: HashRouteManualAction[] = planHashRouteManualActions(recommendations),
): HashRouteDecision | null {
  const ranked = recommendations
    .map((recommendation) => {
      const action = actions.find((candidate) => candidate.goal === recommendation.goal) ?? planHashRouteManualAction(recommendation);
      return { recommendation, action };
    })
    .sort((left, right) => recommendationDecisionPriority(right.recommendation, right.action) -
      recommendationDecisionPriority(left.recommendation, left.action) ||
      goalPriority(right.recommendation.goal) - goalPriority(left.recommendation.goal));

  const primary = ranked[0];
  if (!primary) {
    return null;
  }

  const status = decisionStatusFor(primary.recommendation, primary.action);
  const score = decisionScoreFor(primary.recommendation, primary.action);
  return {
    status,
    score,
    primaryGoal: primary.recommendation.goal,
    primaryRecommendation: primary.recommendation,
    primaryAction: primary.action,
    target: primary.recommendation.target,
    summary: decisionSummary(primary.recommendation, primary.action, status, score),
    detail: `${primary.recommendation.summary} ${primary.action.detail}`,
    safetyNote: primary.action.safetyNote,
  };
}

export function recommendHashRoute(
  localAnalysis: TuningAnalysis,
  externalHistory: ExternalHashHistorySummary,
  externalReadiness?: HashRouteExternalReadiness | null,
): HashRouteRecommendation {
  return recommendHashRouteForGoal(localAnalysis, externalHistory, "balanced", externalReadiness);
}

export function recommendHashRouteStrategies(
  localAnalysis: TuningAnalysis,
  externalHistory: ExternalHashHistorySummary,
  externalReadiness?: HashRouteExternalReadiness | null,
): HashRouteRecommendation[] {
  return [
    recommendHashRouteForGoal(localAnalysis, externalHistory, "lowest_power", externalReadiness),
    recommendHashRouteForGoal(localAnalysis, externalHistory, "max_efficiency", externalReadiness),
    recommendHashRouteForGoal(localAnalysis, externalHistory, "balanced", externalReadiness),
    recommendHashRouteForGoal(localAnalysis, externalHistory, "max_hashrate", externalReadiness),
  ];
}

export function recommendHashRouteForGoal(
  localAnalysis: TuningAnalysis,
  externalHistory: ExternalHashHistorySummary,
  goal: HashRouteStrategyGoal,
  externalReadiness?: HashRouteExternalReadiness | null,
): HashRouteRecommendation {
  const localProfile = selectLocalProfile(localAnalysis, goal);
  const localWatts = measuredLocalWatts(localProfile);
  const localJoules = measuredLocalJoules(localProfile);
  const localHashrate = measuredLocalHashrate(localProfile);
  const externalWatts = externalAverageWatts(externalHistory);
  const externalRawJoules = externalAverageJoules(externalHistory);
  const externalRouteReadiness = normalizeExternalReadiness(externalReadiness);
  const externalRawHashrate = externalAverageHashrate(externalHistory);
  const externalHashrate = externalRouteHashrate(externalHistory, externalRouteReadiness);
  const externalHashrateBasis = externalRouteHashrateBasis(externalHistory, externalRouteReadiness);
  const routeJoules = externalHashrateBasis === "lease_adjusted"
    ? joulesPerTerahashFrom(externalHashrate, externalWatts)
    : null;
  const externalJoules = routeJoules ?? externalRawJoules;
  const efficiencyRatio = ratio(localJoules, externalJoules);
  const hashrateRatio = ratio(externalHashrate, localHashrate);
  const localShareWasteRatio = measuredLocalShareWaste(localProfile);
  const localLongRunScore = measuredLocalLongRunScore(localProfile);
  const localLongRunRisk = measuredLocalLongRunRisk(localProfile);
  const confidence = confidenceForSamples(localProfile, externalHistory);
  const externalEvidenceReadyForRoute = externalEvidenceReady(externalHistory);
  const externalEvidenceStatusForRoute = externalEvidenceStatus(externalHistory);
  const externalEvidenceGapForRoute = externalEvidenceGap(externalHistory);
  const strategyName = hashRouteStrategyLabel(goal);

  const base = {
    goal,
    localProfile,
    externalWatts,
    localWatts,
    externalJoulesPerTerahash: externalJoules,
    localJoulesPerTerahash: localJoules,
    externalHashrate,
    externalRawHashrate,
    externalHashrateBasis,
    localHashrate,
    efficiencyRatio,
    hashrateRatio,
    localShareWasteRatio,
    localLongRunScore,
    localLongRunRisk,
    confidence,
    externalSearchSpaceReady: externalRouteReadiness.searchSpaceReady,
    externalSearchSpaceSummary: externalRouteReadiness.searchSpaceSummary,
    externalWorkLeaseUtilizationRatio: externalRouteReadiness.workLeaseUtilizationRatio,
    externalHashWasteRisk: externalRouteReadiness.hashWasteRisk,
    externalWorkAdapterReady: externalRouteReadiness.workAdapterReady,
    externalWorkAdapterStatus: externalRouteReadiness.workAdapterStatus,
    externalWorkAdapterSummary: externalRouteReadiness.workAdapterSummary,
    externalEvidenceReady: externalEvidenceReadyForRoute,
    externalEvidenceStatus: externalEvidenceStatusForRoute,
    externalEvidenceGap: externalEvidenceGapForRoute,
    externalEvidenceSummary: externalHistory.summary,
  };
  const localLongRunAvoid = localLongRunRisk === "avoid";
  const externalTrendRisk = externalHistory.trend === "degrading";
  const localShareWasteHigh = localShareWasteRatio !== null && localShareWasteRatio > 0.1;
  const canReportLocalRouteRiskAgainstDegradingExternal = externalTrendRisk &&
    (localLongRunAvoid || localShareWasteHigh) &&
    finitePositive(localJoules) &&
    finitePositive(localHashrate);
  const externalSearchSpaceBlock = (): HashRouteRecommendation => ({
    ...base,
    target: "monitor",
    reason: "external_search_space",
    summary: "External hash route needs search-space readiness before it can be trusted.",
    detail: externalSearchSpaceDetail(externalRouteReadiness.searchSpaceSummary),
  });
  const externalWorkAdapterBlock = (): HashRouteRecommendation => ({
    ...base,
    target: "monitor",
    reason: "external_work_adapter",
    summary: "External hash route needs work-adapter readiness before it can be trusted.",
    detail: externalWorkAdapterDetail(externalRouteReadiness.workAdapterStatus, externalRouteReadiness.workAdapterSummary),
  });
  const externalRouteBlock = (): HashRouteRecommendation | null => {
    if (!externalRouteReadiness.searchSpaceReady) {
      return externalSearchSpaceBlock();
    }
    if (!externalRouteReadiness.workAdapterReady) {
      return externalWorkAdapterBlock();
    }
    return null;
  };
  const externalRouteProofBlock = (): HashRouteRecommendation | null => {
    if (externalHashrateBasis === "effective" || externalHashrateBasis === "lease_adjusted") {
      return null;
    }
    return {
      ...base,
      target: "monitor",
      reason: "external_work_adapter",
      summary: "External hash route needs effective assigned-work throughput.",
      detail: `External ${externalHashrateBasisLabel(externalHashrateBasis)} telemetry is observation-only; record effective work-assigned hashrate or lease-adjusted throughput before using it for ${strategyName}.`,
    };
  };
  const externalActionBlock = (): HashRouteRecommendation | null => externalRouteBlock() ?? externalRouteProofBlock();
  const externalSealed = externalRouteReadiness.externalMode === "local_only";
  const externalReferenceOnly = externalRouteReadiness.externalMode === "reference_only";
  const externalSealedRoute = (target: "local" | "monitor", summary: string, detail: string): HashRouteRecommendation => ({
    ...base,
    target,
    reason: "external_sealed",
    summary,
    detail,
  });
  const externalReferenceOnlyRoute = (target: "local" | "monitor", summary: string, detail: string): HashRouteRecommendation => ({
    ...base,
    target,
    reason: "external_reference_only",
    summary,
    detail,
  });

  if (!localProfile && externalHistory.efficiencySampleCount === 0) {
    return {
      ...base,
      target: "waiting",
      reason: "need_samples",
      summary: `${strategyName} route advisor is waiting for local and external efficiency samples.`,
      detail: "Capture at least one local tuning sample and one external telemetry sample before comparing routes.",
    };
  }

  if (!localProfile && externalSealed) {
    return {
      ...base,
      target: "waiting",
      reason: "need_local_samples",
      summary: `${strategyName} local-only advisor is waiting for local tuning samples.`,
      detail: "External hash telemetry is sealed off from this algorithm pass, so route selection waits for measured local CPU/GPU evidence.",
    };
  }

  if (!localProfile) {
    return {
      ...base,
      target: "monitor",
      reason: "need_local_samples",
      summary: `External telemetry is ready; capture local tuning samples for ${strategyName}.`,
      detail: "The advisor needs a measured local CPU/GPU profile to avoid comparing external data against guesses.",
    };
  }

  if (externalSealed) {
    if (localLongRunAvoid || localShareWasteHigh) {
      return externalSealedRoute(
        "monitor",
        "External hash is sealed off; repair the local profile before changing the current algorithm route.",
        `Local profile risk is ${localLongRunRisk ?? "unknown"}; external telemetry remains outside this local-only algorithm pass.`,
      );
    }
    return externalSealedRoute(
      "local",
      `Keep local profile ${localProfile.step.summary}; external hash is sealed off for the current algorithm pass.`,
      "External telemetry, dry-run, and Direct data are retained for a separate future hardware workflow, but current lowest-power/highest-hash optimization uses local CPU/GPU evidence only.",
    );
  }

  if (externalReferenceOnly) {
    if (localLongRunAvoid || localShareWasteHigh) {
      return externalReferenceOnlyRoute(
        "monitor",
        "External hash is reference-only; repair the local profile before changing the current algorithm route.",
        `Local profile risk is ${localLongRunRisk ?? "unknown"}; external telemetry remains visible for future hardware validation but is not a current algorithm candidate.`,
      );
    }
    return externalReferenceOnlyRoute(
      "local",
      `Keep local profile ${localProfile.step.summary}; external hash is reference-only for the current algorithm pass.`,
      "External telemetry and dry-run data remain recorded for future hardware work, but the active lowest-power/highest-hash algorithm is local-only for now.",
    );
  }

  if (!finitePositive(externalJoules) || !finitePositive(externalHashrate)) {
    if (localLongRunAvoid) {
      return {
        ...base,
        target: "monitor",
        reason: "local_long_run_risk",
        summary: "Local profile is marked avoid; collect safer local or external samples before routing.",
        detail: `Local profile long-run score is ${localLongRunScore ?? "unknown"}/100 (${localLongRunRisk}); external telemetry needs hashrate and power/J/TH before it can offer a safer route.`,
      };
    }

    return {
      ...base,
      target: "local",
      reason: "need_external_samples",
      summary: `Keep local profile ${localProfile.step.summary} while external efficiency is unknown.`,
      detail: `External telemetry needs hashrate and power/J/TH before it can beat a measured local ${strategyName} profile.`,
    };
  }

  if (!externalEvidenceReadyForRoute && !canReportLocalRouteRiskAgainstDegradingExternal) {
    return {
      ...base,
      target: "monitor",
      reason: "need_external_stability",
      summary: "External telemetry needs more usable samples before it can guide long-run routing.",
      detail: externalEvidenceDetail(externalHistory),
    };
  }

  if (!finitePositive(localJoules) || !finitePositive(localHashrate)) {
    return {
      ...base,
      target: "external",
      reason: "need_local_samples",
      summary: "External device has measured efficiency; local profile still needs power-quality samples.",
      detail: "Use external telemetry as the reference until the local tuning sweep has comparable efficiency data.",
    };
  }

  const externalIsMuchMoreEfficient = Number(externalJoules) <= Number(localJoules) * 0.85;
  const localIsMuchMoreEfficient = Number(localJoules) <= Number(externalJoules) * 0.85;
  const externalIsMuchFaster = Number(externalHashrate) >= Number(localHashrate) * 2;
  const localIsMuchFaster = Number(localHashrate) >= Number(externalHashrate) * 2;
  const externalWithinWasteGuard = Number(externalJoules) <= Number(localJoules) * 1.25 ||
    Number(externalHashrate) >= Number(localHashrate);

  if (localLongRunAvoid) {
    if (!externalTrendRisk && externalWithinWasteGuard) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "local_long_run_risk",
        summary: "Prefer external telemetry while the local profile is marked avoid for long-run use.",
        detail: `Local profile long-run score is ${localLongRunScore ?? "unknown"}/100 (${localLongRunRisk}); verify external telemetry before relying on this local profile.`,
      };
    }

    return {
      ...base,
      target: "monitor",
      reason: "local_long_run_risk",
      summary: "Local long-run risk is too high; keep monitoring before applying this route.",
      detail: externalTrendRisk
        ? `Local profile is marked ${localLongRunRisk} for long-run use, but external efficiency is degrading, so neither route is ready.`
        : `Local profile is marked ${localLongRunRisk} for long-run use, and external telemetry has not cleared the efficiency or throughput guard yet.`,
    };
  }

  if (localShareWasteHigh) {
    if (!externalTrendRisk && externalWithinWasteGuard) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "local_share_waste",
        summary: "Prefer external telemetry while the local profile is wasting shares.",
        detail: `Local profile is wasting ${percentText(localShareWasteRatio)} of share work through rejects or stale drops; verify external telemetry before relying on this local profile.`,
      };
    }

    return {
      ...base,
      target: "monitor",
      reason: "local_share_waste",
      summary: "Local share waste is high; keep monitoring before applying this route.",
      detail: externalTrendRisk
        ? `Local profile is wasting ${percentText(localShareWasteRatio)} of share work, but external efficiency is degrading, so neither route is ready.`
        : `Local profile is wasting ${percentText(localShareWasteRatio)} of share work, and external telemetry has not cleared the efficiency or throughput guard yet.`,
    };
  }

  if (goal === "lowest_power") {
    if (!finitePositive(localWatts)) {
      return {
        ...base,
        target: "external",
        reason: "need_local_samples",
        summary: "External device has measured power; local profile still needs measured watts.",
        detail: "Use external telemetry as the low-power reference until the local tuning sweep has measured wall power or device telemetry.",
      };
    }

    if (!finitePositive(externalWatts)) {
      return {
        ...base,
        target: "local",
        reason: "need_external_samples",
        summary: `Keep local profile ${localProfile.step.summary} while external watts are unknown.`,
        detail: "External telemetry needs measured watts before it can beat a measured local lowest-power profile.",
      };
    }

    const externalPowerEdge = Number(externalWatts) <= Number(localWatts) * 0.9;
    const localPowerEdge = Number(localWatts) <= Number(externalWatts) * 0.9;
    const externalThroughputWithoutPowerPenalty = externalIsMuchFaster && Number(externalWatts) <= Number(localWatts) * 1.05;
    const localThroughputWithoutPowerPenalty = localIsMuchFaster && Number(localWatts) <= Number(externalWatts) * 1.05;

    if (externalPowerEdge && !externalTrendRisk) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_power",
        summary: "Prefer external hash for the lowest measured watt draw.",
        detail: `External average watts are ${ratioText(Number(localWatts), Number(externalWatts))}x lower than the lowest-power local profile.`,
      };
    }

    if (localPowerEdge) {
      return {
        ...base,
        target: "local",
        reason: "local_power",
        summary: `Keep local profile ${localProfile.step.summary} for the lowest measured watt draw.`,
        detail: `Measured local watts are ${ratioText(Number(externalWatts), Number(localWatts))}x lower than external telemetry.`,
      };
    }

    if (externalThroughputWithoutPowerPenalty && !externalTrendRisk) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_throughput",
        summary: "Prefer external hash because it adds throughput without a visible power penalty.",
        detail: `External average hashrate is ${ratioText(Number(externalHashrate), Number(localHashrate))}x the lowest-power local profile at comparable watts.`,
      };
    }

    if (localThroughputWithoutPowerPenalty) {
      return {
        ...base,
        target: "local",
        reason: "local_throughput",
        summary: `Keep local profile ${localProfile.step.summary}; it is faster without a power penalty.`,
        detail: `Local quality-adjusted hashrate is ${ratioText(Number(localHashrate), Number(externalHashrate))}x external telemetry at comparable watts.`,
      };
    }

    return {
      ...base,
      target: "monitor",
      reason: "similar_efficiency",
      summary: "Lowest-power route is too close to call; keep collecting samples.",
      detail: externalTrendRisk
        ? "External efficiency is currently degrading, so the advisor is waiting before trusting it for lowest-power routing."
        : "No route has a clear 10% watt edge or a no-penalty 2x throughput edge yet.",
    };
  }

  if (goal === "max_efficiency") {
    const externalEfficiencyEdge = Number(externalJoules) <= Number(localJoules) * 0.9;
    const localEfficiencyEdge = Number(localJoules) <= Number(externalJoules) * 0.9;
    const externalThroughputWithoutPenalty = externalIsMuchFaster && Number(externalJoules) <= Number(localJoules) * 1.05;
    const localThroughputWithoutPenalty = localIsMuchFaster && Number(localJoules) <= Number(externalJoules) * 1.05;

    if (externalEfficiencyEdge && !externalTrendRisk) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_efficiency",
        summary: "Prefer external hash for the lowest measured J/TH.",
        detail: `External average J/TH is ${ratioText(Number(localJoules), Number(externalJoules))}x better than the most efficient local profile.`,
      };
    }

    if (localEfficiencyEdge) {
      return {
        ...base,
        target: "local",
        reason: "local_efficiency",
        summary: `Keep local profile ${localProfile.step.summary} for minimum power draw.`,
        detail: `Measured local J/TH is ${ratioText(Number(externalJoules), Number(localJoules))}x better than external telemetry.`,
      };
    }

    if (externalThroughputWithoutPenalty) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_throughput",
        summary: "Prefer external hash because it is faster without a visible efficiency penalty.",
        detail: `External average hashrate is ${ratioText(Number(externalHashrate), Number(localHashrate))}x the most efficient local profile.`,
      };
    }

    if (localThroughputWithoutPenalty) {
      return {
        ...base,
        target: "local",
        reason: "local_throughput",
        summary: `Keep local profile ${localProfile.step.summary}; it is faster without an efficiency penalty.`,
        detail: `Local quality-adjusted hashrate is ${ratioText(Number(localHashrate), Number(externalHashrate))}x external telemetry.`,
      };
    }

    return {
      ...base,
      target: "monitor",
      reason: "similar_efficiency",
      summary: "Lowest-power route is too close to call; keep collecting samples.",
      detail: externalTrendRisk
        ? "External efficiency is currently degrading, so the advisor is waiting before trusting it for minimum-power routing."
        : "No route has a clear 10% J/TH edge or a no-penalty 2x throughput edge yet.",
    };
  }

  if (goal === "max_hashrate") {
    const externalThroughputEdge = Number(externalHashrate) >= Number(localHashrate) * 1.5;
    const localThroughputEdge = Number(localHashrate) >= Number(externalHashrate) * 1.5;
    const externalEfficiencyAcceptable = Number(externalJoules) <= Number(localJoules) * 1.25;
    const localEfficiencyAcceptable = Number(localJoules) <= Number(externalJoules) * 1.25;
    const externalOverwhelmingEfficiency = Number(externalJoules) <= Number(localJoules) * 0.75;
    const localOverwhelmingEfficiency = Number(localJoules) <= Number(externalJoules) * 0.75;
    if (externalThroughputEdge && externalEfficiencyAcceptable) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_throughput",
        summary: "Prefer external hash for maximum measured throughput.",
        detail: `External route hashrate is ${ratioText(Number(externalHashrate), Number(localHashrate))}x the fastest local profile while staying within the efficiency guard.`,
      };
    }

    if (localThroughputEdge && localEfficiencyAcceptable) {
      return {
        ...base,
        target: "local",
        reason: "local_throughput",
        summary: `Keep local profile ${localProfile.step.summary} for maximum measured throughput.`,
        detail: `Local quality-adjusted hashrate is ${ratioText(Number(localHashrate), Number(externalHashrate))}x external telemetry while staying within the efficiency guard.`,
      };
    }

    if (externalOverwhelmingEfficiency && (!externalTrendRisk || Number(externalHashrate) >= Number(localHashrate))) {
      const externalBlock = externalActionBlock();
      if (externalBlock) {
        return externalBlock;
      }
      return {
        ...base,
        target: "external",
        reason: "external_efficiency",
        summary: "Prefer external hash because the efficiency gap is too large to ignore.",
        detail: `External average J/TH is ${ratioText(Number(localJoules), Number(externalJoules))}x better than the fastest local profile.`,
      };
    }

    if (localOverwhelmingEfficiency && Number(localHashrate) >= Number(externalHashrate) * 0.75) {
      return {
        ...base,
        target: "local",
        reason: "local_efficiency",
        summary: `Keep local profile ${localProfile.step.summary}; external speed does not offset its power cost.`,
        detail: `Measured local J/TH is ${ratioText(Number(externalJoules), Number(localJoules))}x better than external telemetry.`,
      };
    }

    return {
      ...base,
      target: "monitor",
      reason: "similar_efficiency",
      summary: "Maximum-hashrate route is close; keep monitoring before changing route.",
      detail: "No route has a 1.5x throughput edge inside the 25% efficiency guard yet.",
    };
  }

  if (externalIsMuchMoreEfficient && (!externalTrendRisk || externalIsMuchFaster)) {
    const externalBlock = externalActionBlock();
    if (externalBlock) {
      return externalBlock;
    }
    return {
      ...base,
      target: "external",
      reason: "external_efficiency",
      summary: "Prefer external hash for lowest power per terahash.",
      detail: `External average J/TH is ${ratioText(Number(localJoules), Number(externalJoules))}x better than the selected local profile.`,
    };
  }

  if (externalIsMuchFaster && Number(externalJoules) <= Number(localJoules) * 1.15) {
    const externalBlock = externalActionBlock();
    if (externalBlock) {
      return externalBlock;
    }
    return {
      ...base,
      target: "external",
      reason: "external_throughput",
      summary: "Prefer external hash for higher measured throughput without a major efficiency penalty.",
      detail: `External average hashrate is ${ratioText(Number(externalHashrate), Number(localHashrate))}x the selected local profile.`,
    };
  }

  if (localIsMuchMoreEfficient) {
    return {
      ...base,
      target: "local",
      reason: "local_efficiency",
      summary: `Keep local profile ${localProfile.step.summary} for efficiency.`,
      detail: `Measured local J/TH is ${ratioText(Number(externalJoules), Number(localJoules))}x better than external telemetry.`,
    };
  }

  if (localIsMuchFaster && Number(localJoules) <= Number(externalJoules) * 1.15) {
    return {
      ...base,
      target: "local",
      reason: "local_throughput",
      summary: `Keep local profile ${localProfile.step.summary} for higher measured throughput.`,
      detail: `Local quality-adjusted hashrate is ${ratioText(Number(localHashrate), Number(externalHashrate))}x external telemetry.`,
    };
  }

  return {
    ...base,
    target: "monitor",
    reason: "similar_efficiency",
    summary: "Local and external efficiency are close; keep monitoring before changing route.",
    detail: externalTrendRisk
      ? "External efficiency is currently degrading, so the advisor is waiting for more stable telemetry."
      : "No route has a clear 15% efficiency edge or 2x throughput edge yet.",
  };
}

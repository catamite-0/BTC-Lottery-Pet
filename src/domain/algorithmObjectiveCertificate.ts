import type { MiningAlgorithmPlan, MiningAlgorithmOperatingPointRole } from "./algorithmPlanner.js";
import type { HashOperatingPolicySnapshot } from "./hashOperatingPolicy.js";

export type AlgorithmObjectiveStatus = "ready" | "partial" | "waiting" | "blocked" | "dry_run";
export type AlgorithmObjectiveRuntimeMode =
  | "collect_evidence"
  | "density_default"
  | "density_with_manual_burst"
  | "external_reference_only"
  | "external_dry_run"
  | "runtime_guard";
export type AlgorithmObjectiveHighHashPath =
  | "manual_burst"
  | "marginal_hold"
  | "kernel_evidence_wait"
  | "kernel_blocked"
  | "kernel_regression"
  | "needs_measurement"
  | "cooldown"
  | "external_dry_run"
  | "none";
export type AlgorithmObjectiveEvidenceGap =
  | "none"
  | "low_power_evidence"
  | "high_hash_measurement"
  | "max_hash_marginal_hold"
  | "kernel_evidence_wait"
  | "kernel_blocked"
  | "kernel_regression"
  | "high_hash_cooldown"
  | "runtime_guard"
  | "external_dry_run";

export interface AlgorithmObjectiveCertificate {
  schemaVersion: 1;
  objective: "lowest_power_high_hashrate";
  status: AlgorithmObjectiveStatus;
  runtimeMode: AlgorithmObjectiveRuntimeMode;
  objectiveProgressScore: number;
  lowPowerProgressScore: number;
  highHashProgressScore: number;
  primaryEvidenceGap: AlgorithmObjectiveEvidenceGap;
  consensusSafe: true;
  lowPowerReady: boolean;
  highHashReady: boolean;
  unattendedLocalAllowed: boolean;
  autoApplyAllowed: boolean;
  externalMiningAllowed: false;
  defaultProfileRole: MiningAlgorithmOperatingPointRole;
  defaultProfileStatus: string;
  selectedLaneId: string;
  selectedLaneStatus: string;
  sustainableHashrate: number | null;
  sustainableWatts: number | null;
  sustainableJoulesPerTerahash: number | null;
  powerBudgetWatts: number | null;
  maxHashBurstAvailable: boolean;
  highHashPath: AlgorithmObjectiveHighHashPath;
  burstHashrate: number | null;
  burstWatts: number | null;
  marginalDensityRetentionRatio: number | null;
  marginalDensityRetentionThreshold: number;
  primaryBlockerId: string | null;
  primaryBlockerSummary: string | null;
  sourceIds: HashOperatingPolicySnapshot["sourceIds"];
  guardrails: string[];
  summary: string;
  nextStep: string;
}

const MARGINAL_DENSITY_RETENTION_THRESHOLD = 0.55;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function lowPowerProgressScore(
  plan: MiningAlgorithmPlan,
  lowPowerReady: boolean,
) {
  const selectedLane = plan.densityPlan.selectedLane;
  if (lowPowerReady) {
    return 100;
  }
  if (selectedLane.source === "local" && finitePositive(selectedLane.hashrate) && finitePositive(selectedLane.watts)) {
    return 70;
  }
  if (plan.densityPlan.readyForLongRun && selectedLane.source === "local") {
    return 55;
  }
  if (selectedLane.source === "local") {
    return 35;
  }
  return 0;
}

function highHashProgressScore(
  plan: MiningAlgorithmPlan,
  path: AlgorithmObjectiveHighHashPath,
  highHashReady: boolean,
) {
  if (highHashReady || path === "manual_burst") {
    return 100;
  }
  if (path === "needs_measurement") {
    return plan.densityPlan.marginalDecision.status === "advance" ? 65 : 50;
  }
  if (path === "marginal_hold") {
    return 45;
  }
  if (path === "kernel_evidence_wait") {
    return 35;
  }
  if (path === "kernel_blocked" || path === "kernel_regression" || path === "cooldown") {
    return 30;
  }
  if (path === "external_dry_run") {
    return 25;
  }
  return 20;
}

function primaryEvidenceGap(
  plan: MiningAlgorithmPlan,
  policy: HashOperatingPolicySnapshot,
  lowPowerReady: boolean,
  highHashReady: boolean,
  path: AlgorithmObjectiveHighHashPath,
): AlgorithmObjectiveEvidenceGap {
  if (policy.externalDryRunOnly || plan.dryRunOnly) {
    return "external_dry_run";
  }
  if (policy.runtimeGuard === "block") {
    return "runtime_guard";
  }
  if (!lowPowerReady) {
    return "low_power_evidence";
  }
  if (highHashReady) {
    return "none";
  }
  switch (path) {
    case "marginal_hold":
      return "max_hash_marginal_hold";
    case "kernel_evidence_wait":
      return "kernel_evidence_wait";
    case "kernel_blocked":
      return "kernel_blocked";
    case "kernel_regression":
      return "kernel_regression";
    case "cooldown":
      return "high_hash_cooldown";
    case "needs_measurement":
    case "none":
      return "high_hash_measurement";
    case "external_dry_run":
      return "external_dry_run";
    case "manual_burst":
      return "none";
  }
}

function objectiveProgressScore(
  status: AlgorithmObjectiveStatus,
  lowPowerScore: number,
  highHashScore: number,
) {
  const raw = clampScore(lowPowerScore * 0.6 + highHashScore * 0.4);
  if (status === "blocked") {
    return Math.min(raw, 40);
  }
  if (status === "dry_run") {
    return Math.min(raw, 30);
  }
  return raw;
}

function highHashPath(plan: MiningAlgorithmPlan, policy: HashOperatingPolicySnapshot): AlgorithmObjectiveHighHashPath {
  if (policy.externalDryRunOnly || plan.dryRunOnly) {
    return "external_dry_run";
  }
  if (policy.burstAllowed) {
    return "manual_burst";
  }
  if (!policy.kernelPromotionAllowed) {
    if (policy.kernelOptimization.mode === "midstate_evidence_wait") {
      return "kernel_evidence_wait";
    }
    if (policy.kernelOptimization.mode === "full_header_baseline") {
      return "kernel_blocked";
    }
    return "kernel_regression";
  }
  switch (plan.densityPlan.marginalDecision.status) {
    case "advance":
    case "measure":
      return "needs_measurement";
    case "hold":
      return "marginal_hold";
    case "cooldown":
      return "cooldown";
    case "none":
      return "none";
  }
}

function primaryBlocker(plan: MiningAlgorithmPlan, policy: HashOperatingPolicySnapshot) {
  if (policy.runtimeGuard === "block") {
    return {
      id: "runtime_guard",
      summary: "Live runtime evidence shows waste or throttling high enough to block profile promotion.",
      nextStep: policy.nextStep,
      blocked: true,
    };
  }
  const densityGate = plan.densityPlan.primaryMissingGate;
  if (densityGate) {
    return {
      id: densityGate.id,
      summary: densityGate.summary,
      nextStep: densityGate.nextStep,
      blocked: densityGate.status === "blocked" || densityGate.status === "reserved",
    };
  }
  const readinessGate = plan.readinessCertificate.primaryMissingGate;
  if (readinessGate) {
    return {
      id: readinessGate.id,
      summary: readinessGate.summary,
      nextStep: readinessGate.nextStep,
      blocked: readinessGate.status === "blocked" || readinessGate.status === "reserved",
    };
  }
  return null;
}

function runtimeMode(
  plan: MiningAlgorithmPlan,
  policy: HashOperatingPolicySnapshot,
  lowPowerReady: boolean,
  highHashReady: boolean,
): AlgorithmObjectiveRuntimeMode {
  if (policy.externalDryRunOnly || plan.dryRunOnly) {
    return "external_dry_run";
  }
  if (policy.runtimeGuard === "block") {
    return "runtime_guard";
  }
  if (!lowPowerReady) {
    return "collect_evidence";
  }
  if (highHashReady) {
    return "density_with_manual_burst";
  }
  if (plan.densityPlan.externalIsEfficiencyReference) {
    return "external_reference_only";
  }
  return "density_default";
}

function objectiveStatus(args: {
  plan: MiningAlgorithmPlan;
  policy: HashOperatingPolicySnapshot;
  lowPowerReady: boolean;
  highHashReady: boolean;
  blocker: ReturnType<typeof primaryBlocker>;
}): AlgorithmObjectiveStatus {
  const { plan, policy, lowPowerReady, highHashReady, blocker } = args;
  if (policy.externalDryRunOnly || plan.dryRunOnly) {
    return "dry_run";
  }
  if (blocker?.blocked || policy.runtimeGuard === "block") {
    return "blocked";
  }
  if (lowPowerReady && highHashReady) {
    return "ready";
  }
  if (lowPowerReady) {
    return "partial";
  }
  return "waiting";
}

function summaryFor(status: AlgorithmObjectiveStatus, path: AlgorithmObjectiveHighHashPath) {
  switch (status) {
    case "ready":
      return "Objective certificate is ready: run the measured low-power density lane by default and keep verified max-hash headroom as a manual burst.";
    case "partial":
      return path === "marginal_hold"
        ? "Objective certificate is partial: low-power density is ready, but the max-hash profile spends too many extra watts for the useful hash it adds."
        : path === "kernel_evidence_wait"
          ? "Objective certificate is partial: low-power density is ready, but fixed-window midstate benchmark evidence is still required before high-hash promotion."
          : path === "kernel_blocked"
            ? "Objective certificate is partial: low-power density is ready, but midstate equivalence is blocked, so high-hash promotion falls back to the full-header baseline."
            : path === "kernel_regression"
              ? "Objective certificate is partial: low-power density is ready, but this machine's midstate benchmark regresses, so high-hash promotion stays manual and blocked."
              : "Objective certificate is partial: low-power density is ready, but high-hash headroom still needs evidence or approval.";
    case "blocked":
      return "Objective certificate is blocked by a safety, stability, thermal, or runtime-waste gate.";
    case "dry_run":
      return "Objective certificate keeps external high-hash capability in dry-run/reference mode; real external mining remains disabled.";
    case "waiting":
      return "Objective certificate is waiting for measured watts, share quality, stability, or thermal evidence.";
  }
}

function nextStepFor(
  status: AlgorithmObjectiveStatus,
  path: AlgorithmObjectiveHighHashPath,
  blocker: ReturnType<typeof primaryBlocker>,
  plan: MiningAlgorithmPlan,
  policy: HashOperatingPolicySnapshot,
) {
  if (status === "ready") {
    return "Use the density lane as the unattended default; run max-hash only as an intentional manual burst and fall back on any thermal, reject, or throttle degradation.";
  }
  if (status === "dry_run") {
    return "Complete external work leases, stale-result rejection, share accounting, and release review before allowing real external start().";
  }
  if (blocker) {
    return blocker.nextStep;
  }
  if (path === "marginal_hold" || path === "needs_measurement" || path === "cooldown") {
    return plan.densityPlan.marginalDecision.nextStep;
  }
  if (path === "kernel_evidence_wait" || path === "kernel_blocked" || path === "kernel_regression") {
    return policy.kernelOptimization.nextStep;
  }
  return policy.nextStep;
}

export function deriveAlgorithmObjectiveCertificate(
  plan: MiningAlgorithmPlan,
  policy: HashOperatingPolicySnapshot,
): AlgorithmObjectiveCertificate {
  const selectedLane = plan.densityPlan.selectedLane;
  const lowPowerReady = policy.unattendedLocalAllowed &&
    plan.densityPlan.readyForLongRun &&
    selectedLane.source === "local" &&
    selectedLane.status === "ready" &&
    finitePositive(selectedLane.watts);
  const highHashReady = policy.burstAllowed && finitePositive(policy.burstHashrate) && finitePositive(policy.burstWatts);
  const blocker = primaryBlocker(plan, policy);
  const path = highHashPath(plan, policy);
  const status = objectiveStatus({ plan, policy, lowPowerReady, highHashReady, blocker });
  const lowPowerScore = lowPowerProgressScore(plan, lowPowerReady);
  const highHashScore = highHashProgressScore(plan, path, highHashReady);

  return {
    schemaVersion: 1,
    objective: "lowest_power_high_hashrate",
    status,
    runtimeMode: runtimeMode(plan, policy, lowPowerReady, highHashReady),
    objectiveProgressScore: objectiveProgressScore(status, lowPowerScore, highHashScore),
    lowPowerProgressScore: lowPowerScore,
    highHashProgressScore: highHashScore,
    primaryEvidenceGap: primaryEvidenceGap(plan, policy, lowPowerReady, highHashReady, path),
    consensusSafe: true,
    lowPowerReady,
    highHashReady,
    unattendedLocalAllowed: policy.unattendedLocalAllowed,
    autoApplyAllowed: policy.autoApplyAllowed,
    externalMiningAllowed: false,
    defaultProfileRole: policy.defaultPointRole,
    defaultProfileStatus: policy.defaultPointStatus,
    selectedLaneId: selectedLane.id,
    selectedLaneStatus: selectedLane.status,
    sustainableHashrate: selectedLane.hashrate,
    sustainableWatts: selectedLane.watts,
    sustainableJoulesPerTerahash: selectedLane.joulesPerTerahash,
    powerBudgetWatts: plan.densityPlan.powerBudgetWatts,
    maxHashBurstAvailable: highHashReady,
    highHashPath: path,
    burstHashrate: highHashReady ? policy.burstHashrate : null,
    burstWatts: highHashReady ? policy.burstWatts : null,
    marginalDensityRetentionRatio: plan.densityPlan.marginalDecision.densityRetentionRatio,
    marginalDensityRetentionThreshold: MARGINAL_DENSITY_RETENTION_THRESHOLD,
    primaryBlockerId: blocker?.id ?? null,
    primaryBlockerSummary: blocker?.summary ?? null,
    sourceIds: policy.sourceIds,
    guardrails: [
      "Default to the lowest sustainable useful-hash density lane, not the raw highest-watt profile.",
      "Expose max-hashrate only as a manual burst after marginal density, thermals, shares, stability, and kernel promotion gates pass.",
      "Never trade consensus correctness for prediction, pruning, or proof-of-work compression.",
      "Keep external devices dry-run or reference-only until work assignment and share submission are proven.",
    ],
    summary: summaryFor(status, path),
    nextStep: nextStepFor(status, path, blocker, plan, policy),
  };
}

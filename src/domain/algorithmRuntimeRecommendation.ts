import type { AlgorithmObjectiveFeedbackSnapshot } from "./algorithmObjectiveFeedback.js";
import type { AlgorithmProfileApplyGate, AlgorithmProfileApplyIntent } from "./algorithmProfileApplyGate.js";
import type { HashOperatingPolicySnapshot } from "./hashOperatingPolicy.js";

export type AlgorithmRuntimeRecommendationMode =
  | "capture_evidence"
  | "retest_profile"
  | "probe_next_profile"
  | "run_density_default"
  | "manual_burst"
  | "hold_high_hash"
  | "external_dry_run"
  | "runtime_guard"
  | "monitor";

export type AlgorithmRuntimeRecommendationPriority =
  | "blocked"
  | "evidence"
  | "optimize"
  | "run"
  | "manual"
  | "monitor";

export interface AlgorithmRuntimeRecommendationSnapshot {
  schemaVersion: 1;
  mode: AlgorithmRuntimeRecommendationMode;
  priority: AlgorithmRuntimeRecommendationPriority;
  selectedIntent: AlgorithmProfileApplyIntent | null;
  canApplyProfile: boolean;
  manualApprovalRequired: boolean;
  autoApplyAllowed: boolean;
  protectsLowPowerLane: boolean;
  opensHighHashBurst: boolean;
  externalMiningAllowed: false;
  targetStepId: string | null;
  targetStepSummary: string | null;
  targetComputeMode: string | null;
  targetCpuThreads: number | null;
  targetGpuIntensityPercent: number | null;
  defaultPointRole: HashOperatingPolicySnapshot["defaultPointRole"];
  defaultPointHashrate: number | null;
  defaultPointWatts: number | null;
  burstAllowed: boolean;
  burstHashrate: number | null;
  burstWatts: number | null;
  recoveryCooldownSeconds: number | null;
  recoveryObservedSeconds: number | null;
  recoveryCooldownRemainingSeconds: number | null;
  recoveryResumeAllowed: boolean;
  recoveryResumeCondition: string | null;
  recoveryQualityLossHashrate: number | null;
  recoveryThrottleHashrateAtRisk: number | null;
  guardrails: string[];
  summary: string;
  nextStep: string;
}

export interface AlgorithmRuntimeRecommendationInput {
  operatingPolicy: HashOperatingPolicySnapshot;
  objectiveFeedback: AlgorithmObjectiveFeedbackSnapshot;
  profileApplyGates: Record<AlgorithmProfileApplyIntent, AlgorithmProfileApplyGate>;
  runtimeSampleSeconds?: number | null;
}

interface RecommendationDraft {
  mode: AlgorithmRuntimeRecommendationMode;
  priority: AlgorithmRuntimeRecommendationPriority;
  selectedIntent?: AlgorithmProfileApplyIntent | null;
  targetKind?: "target" | "captured" | "next";
  canApplyProfile?: boolean;
  manualApprovalRequired?: boolean;
  autoApplyAllowed?: boolean;
  protectsLowPowerLane?: boolean;
  opensHighHashBurst?: boolean;
  recoveryCooldownSeconds?: number | null;
  recoveryResumeCondition?: string | null;
  summary: string;
  nextStep: string;
  guardrails?: string[];
}

function gateFor(input: AlgorithmRuntimeRecommendationInput, intent: AlgorithmProfileApplyIntent | null | undefined) {
  return intent ? input.profileApplyGates[intent] : null;
}

function targetFields(feedback: AlgorithmObjectiveFeedbackSnapshot, targetKind: RecommendationDraft["targetKind"]) {
  if (targetKind === "next") {
    return {
      targetStepId: feedback.nextProfileStepId,
      targetStepSummary: feedback.nextProfileSummary,
      targetComputeMode: feedback.nextProfileComputeMode,
      targetCpuThreads: feedback.nextProfileCpuThreads,
      targetGpuIntensityPercent: feedback.nextProfileGpuIntensityPercent,
    };
  }

  if (targetKind === "captured") {
    return {
      targetStepId: feedback.capturedStepId,
      targetStepSummary: feedback.capturedStepSummary,
      targetComputeMode: null,
      targetCpuThreads: null,
      targetGpuIntensityPercent: null,
    };
  }

  return {
    targetStepId: feedback.targetStepId,
    targetStepSummary: feedback.capturedStepSummary ?? feedback.nextProfileSummary,
    targetComputeMode: null,
    targetCpuThreads: null,
    targetGpuIntensityPercent: null,
  };
}

function finiteNonNegativeSeconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function burstDominatesDefaultDensity(policy: HashOperatingPolicySnapshot) {
  return policy.burstAllowed &&
    finitePositive(policy.defaultPointHashrate) &&
    finitePositive(policy.defaultPointWatts) &&
    finitePositive(policy.burstHashrate) &&
    finitePositive(policy.burstWatts) &&
    Number(policy.burstHashrate) > Number(policy.defaultPointHashrate) &&
    Number(policy.burstWatts) <= Number(policy.defaultPointWatts);
}
function runtimeCleanForRecovery(policy: HashOperatingPolicySnapshot) {
  return policy.runtimePromotionAllowed &&
    policy.runtimeGuard === "clear" &&
    (policy.runtimeShareWasteRatio ?? 0) <= 0.05 &&
    (policy.runtimeGpuThrottleRatio ?? 0) <= 0.25;
}

function snapshot(
  input: AlgorithmRuntimeRecommendationInput,
  draft: RecommendationDraft,
): AlgorithmRuntimeRecommendationSnapshot {
  const gate = gateFor(input, draft.selectedIntent);
  const target = targetFields(input.objectiveFeedback, draft.targetKind ?? "target");
  const resolvedTarget = {
    targetStepId: target.targetStepId ?? gate?.targetStepId ?? null,
    targetStepSummary: target.targetStepSummary ?? gate?.targetStepSummary ?? null,
    targetComputeMode: target.targetComputeMode ?? gate?.targetComputeMode ?? null,
    targetCpuThreads: target.targetCpuThreads ?? gate?.targetCpuThreads ?? null,
    targetGpuIntensityPercent: target.targetGpuIntensityPercent ?? gate?.targetGpuIntensityPercent ?? null,
  };
  const recoveryCooldownSeconds = draft.recoveryCooldownSeconds ?? null;
  const recoveryObservedSeconds = recoveryCooldownSeconds === null ? null : finiteNonNegativeSeconds(input.runtimeSampleSeconds);
  const recoveryCooldownRemainingSeconds = recoveryCooldownSeconds === null
    ? null
    : Math.max(0, recoveryCooldownSeconds - (recoveryObservedSeconds ?? 0));
  const recoveryResumeAllowed = recoveryCooldownSeconds !== null &&
    recoveryCooldownRemainingSeconds === 0 &&
    runtimeCleanForRecovery(input.operatingPolicy);
  return {
    schemaVersion: 1,
    mode: draft.mode,
    priority: draft.priority,
    selectedIntent: draft.selectedIntent ?? null,
    canApplyProfile: draft.canApplyProfile ?? Boolean(gate?.canApply),
    manualApprovalRequired: draft.manualApprovalRequired ?? Boolean(gate?.manualApprovalRequired),
    autoApplyAllowed: draft.autoApplyAllowed ?? false,
    protectsLowPowerLane: draft.protectsLowPowerLane ?? false,
    opensHighHashBurst: draft.opensHighHashBurst ?? false,
    externalMiningAllowed: false,
    ...resolvedTarget,
    defaultPointRole: input.operatingPolicy.defaultPointRole,
    defaultPointHashrate: input.operatingPolicy.defaultPointHashrate,
    defaultPointWatts: input.operatingPolicy.defaultPointWatts,
    burstAllowed: input.operatingPolicy.burstAllowed,
    burstHashrate: input.operatingPolicy.burstHashrate,
    burstWatts: input.operatingPolicy.burstWatts,
    recoveryCooldownSeconds,
    recoveryObservedSeconds,
    recoveryCooldownRemainingSeconds,
    recoveryResumeAllowed,
    recoveryResumeCondition: draft.recoveryResumeCondition ?? null,
    recoveryQualityLossHashrate: input.operatingPolicy.runtimeQualityLossHashrate ?? null,
    recoveryThrottleHashrateAtRisk: input.operatingPolicy.runtimeThrottleHashrateAtRisk ?? null,
    guardrails: draft.guardrails ?? [],
    summary: draft.summary,
    nextStep: draft.nextStep,
  };
}

function defaultDensityGate(input: AlgorithmRuntimeRecommendationInput) {
  const efficiency = input.profileApplyGates.best_efficiency;
  return efficiency.canApply ? efficiency : input.profileApplyGates.lowest_power;
}

function runtimeRecoveryGate(input: AlgorithmRuntimeRecommendationInput) {
  const lowest = input.profileApplyGates.lowest_power;
  if (lowest.canApply && !lowest.raisesLoad) {
    return lowest;
  }

  const efficiency = input.profileApplyGates.best_efficiency;
  if (efficiency.canApply && !efficiency.raisesLoad) {
    return efficiency;
  }

  const batch = input.profileApplyGates.batch_optimize;
  return batch.canApply && !batch.raisesLoad ? batch : null;
}

function densityAutoApplyAllowed(
  operatingPolicy: HashOperatingPolicySnapshot,
  gate: AlgorithmProfileApplyGate,
) {
  return operatingPolicy.autoApplyAllowed && gate.canApply && !gate.manualApprovalRequired;
}

export function deriveAlgorithmRuntimeRecommendation(
  input: AlgorithmRuntimeRecommendationInput,
): AlgorithmRuntimeRecommendationSnapshot {
  const { objectiveFeedback, operatingPolicy } = input;

  if (operatingPolicy.mode === "runtime_guard" || operatingPolicy.runtimeGuard === "block") {
    const recoveryGate = operatingPolicy.runtimeRecoveryAction === "lower_load" ? runtimeRecoveryGate(input) : null;
    return snapshot(input, {
      mode: "runtime_guard",
      priority: "blocked",
      selectedIntent: recoveryGate?.intent ?? null,
      canApplyProfile: Boolean(recoveryGate?.canApply),
      manualApprovalRequired: Boolean(recoveryGate?.manualApprovalRequired),
      protectsLowPowerLane: true,
      recoveryCooldownSeconds: recoveryGate ? 300 : 120,
      recoveryResumeCondition: recoveryGate
        ? "Hold the recovery profile until runtime guard is clear for one full sample window with share waste below 5% and GPU throttle below 25%."
        : "Hold current load until runtime guard is clear for one full sample window before any profile promotion.",
      summary: recoveryGate
        ? `Runtime recommendation: recover by applying ${recoveryGate.intent.replace(/_/g, " ")} while ${operatingPolicy.summary}`
        : `Runtime recommendation: ${operatingPolicy.summary}`,
      nextStep: recoveryGate?.nextStep ?? operatingPolicy.nextStep,
      guardrails: [
        "Do not raise hash load while the runtime guard is blocking.",
        "Only apply recovery profiles that do not raise local hash load.",
        "Use a cooldown window before restoring any higher-load profile.",
      ],
    });
  }

  if (operatingPolicy.externalDryRunOnly || objectiveFeedback.recommendation === "external_dry_run") {
    return snapshot(input, {
      mode: "external_dry_run",
      priority: "evidence",
      selectedIntent: null,
      canApplyProfile: false,
      manualApprovalRequired: false,
      summary: "Runtime recommendation: keep external hash work in dry-run validation only.",
      nextStep: objectiveFeedback.nextStep || operatingPolicy.nextStep,
      guardrails: ["External mining start remains disabled until release gates approve real work routing."],
    });
  }

  if (objectiveFeedback.recommendation === "verify_kernel_benchmark" || objectiveFeedback.recommendation === "repair_kernel_proof") {
    const repair = objectiveFeedback.recommendation === "repair_kernel_proof";
    return snapshot(input, {
      mode: "monitor",
      priority: repair ? "blocked" : "evidence",
      selectedIntent: null,
      canApplyProfile: false,
      manualApprovalRequired: false,
      autoApplyAllowed: false,
      protectsLowPowerLane: true,
      summary: repair
        ? "Runtime recommendation: keep full-header mining active while midstate kernel proof is repaired."
        : "Runtime recommendation: verify fixed-window midstate benchmark evidence before runtime kernel promotion.",
      nextStep: objectiveFeedback.nextStep || operatingPolicy.nextStep,
      guardrails: [
        "Keep the full-header baseline active until kernel evidence passes.",
        "Do not promote midstate or high-hash profiles from missing kernel proof.",
      ],
    });
  }
  if (objectiveFeedback.recommendation === "capture_target") {
    return snapshot(input, {
      mode: "capture_evidence",
      priority: "evidence",
      selectedIntent: "objective_tune",
      summary: "Runtime recommendation: run the target objective profile long enough to capture evidence.",
      nextStep: objectiveFeedback.nextStep,
      guardrails: ["Capture measured watts, share events, thermals, and a complete stability window before promotion."],
    });
  }

  if (objectiveFeedback.recommendation === "retest_target") {
    return snapshot(input, {
      mode: "retest_profile",
      priority: "evidence",
      selectedIntent: "objective_tune",
      summary: `Runtime recommendation: retest the objective profile before raising load; ${objectiveFeedback.missingEvidence.slice(0, 3).join(", ") || "evidence is incomplete"}.`,
      nextStep: objectiveFeedback.nextStep,
      guardrails: ["Do not widen the power envelope while objective evidence is incomplete."],
    });
  }

  if (objectiveFeedback.recommendation === "probe_next_profile") {
    const gate = input.profileApplyGates.objective_tune;
    return snapshot(input, {
      mode: "probe_next_profile",
      priority: "optimize",
      selectedIntent: "objective_tune",
      targetKind: "next",
      canApplyProfile: gate.canApply,
      manualApprovalRequired: gate.manualApprovalRequired,
      summary: objectiveFeedback.nextProfileSummary
        ? `Runtime recommendation: probe ${objectiveFeedback.nextProfileSummary} as the next measured density point.`
        : "Runtime recommendation: probe the next measured density point when the objective gate selects it.",
      nextStep: gate.canApply ? objectiveFeedback.nextStep : gate.nextStep,
      guardrails: ["Probe only one higher profile at a time and fall back if share waste, thermals, or throttling worsens."],
    });
  }

  if (objectiveFeedback.recommendation === "manual_burst_ready") {
    const gate = input.profileApplyGates.best_hashrate;
    const canBurst = operatingPolicy.burstAllowed && gate.canApply;
    if (canBurst && burstDominatesDefaultDensity(operatingPolicy)) {
      return snapshot(input, {
        mode: "run_density_default",
        priority: "run",
        selectedIntent: "best_hashrate",
        targetKind: "captured",
        canApplyProfile: true,
        manualApprovalRequired: gate.manualApprovalRequired,
        autoApplyAllowed: operatingPolicy.autoApplyAllowed && !gate.manualApprovalRequired,
        protectsLowPowerLane: true,
        opensHighHashBurst: false,
        summary: "Runtime recommendation: the verified high-hash profile dominates the current density lane without raising watts, so promote it as the density default candidate.",
        nextStep: gate.manualApprovalRequired
          ? "Apply the dominant profile through the manual gate, then verify it as the new density lane."
          : gate.nextStep,
        guardrails: ["Treat the profile as density only while measured watts stay at or below the previous default and share quality remains clean."],
      });
    }
    return snapshot(input, {
      mode: canBurst ? "manual_burst" : "hold_high_hash",
      priority: canBurst ? "manual" : "monitor",
      selectedIntent: "best_hashrate",
      targetKind: "captured",
      canApplyProfile: canBurst,
      manualApprovalRequired: true,
      autoApplyAllowed: false,
      protectsLowPowerLane: true,
      opensHighHashBurst: canBurst,
      summary: canBurst
        ? "Runtime recommendation: max-hash is available only as an explicit manual burst; keep the density lane as default."
        : "Runtime recommendation: high-hash evidence is promising, but the operating policy still holds burst start.",
      nextStep: canBurst ? gate.nextStep : operatingPolicy.nextStep,
      guardrails: ["Never auto-apply max-hash; return to the density lane if useful hash per watt degrades."],
    });
  }

  if (objectiveFeedback.recommendation === "hold_high_hash") {
    const gate = input.profileApplyGates.lowest_power;
    return snapshot(input, {
      mode: "hold_high_hash",
      priority: "run",
      selectedIntent: "lowest_power",
      targetKind: "captured",
      canApplyProfile: gate.canApply,
      manualApprovalRequired: gate.manualApprovalRequired,
      protectsLowPowerLane: true,
      summary: "Runtime recommendation: hold the high-hash profile and protect the lower-watt density lane.",
      nextStep: objectiveFeedback.nextStep || gate.nextStep,
      guardrails: ["Do not raise watts until marginal hash-density evidence improves."],
    });
  }

  if (objectiveFeedback.recommendation === "adopt_density") {
    const gate = defaultDensityGate(input);
    const autoApplyAllowed = densityAutoApplyAllowed(operatingPolicy, gate);
    return snapshot(input, {
      mode: "run_density_default",
      priority: "run",
      selectedIntent: gate.intent,
      targetKind: "captured",
      canApplyProfile: gate.canApply,
      manualApprovalRequired: gate.manualApprovalRequired,
      autoApplyAllowed,
      protectsLowPowerLane: true,
      summary: "Runtime recommendation: adopt the captured density lane as the default useful-hash operating point.",
      nextStep: gate.canApply ? operatingPolicy.nextStep || objectiveFeedback.nextStep : gate.nextStep,
      guardrails: ["Keep the captured density lane only while measured watts, share quality, thermals, and throttle evidence remain clean."],
    });
  }

  if (operatingPolicy.action === "run_local_density") {
    const gate = defaultDensityGate(input);
    const autoApplyAllowed = densityAutoApplyAllowed(operatingPolicy, gate);
    return snapshot(input, {
      mode: "run_density_default",
      priority: "run",
      selectedIntent: gate.intent,
      canApplyProfile: gate.canApply,
      manualApprovalRequired: gate.manualApprovalRequired,
      autoApplyAllowed,
      protectsLowPowerLane: true,
      summary: `Runtime recommendation: ${operatingPolicy.summary}`,
      nextStep: gate.canApply ? operatingPolicy.nextStep : gate.nextStep,
      guardrails: ["Use useful hash per watt, not raw hashrate, as the default optimization target."],
    });
  }

  return snapshot(input, {
    mode: "monitor",
    priority: "monitor",
    selectedIntent: null,
    canApplyProfile: false,
    manualApprovalRequired: false,
    summary: `Runtime recommendation: ${objectiveFeedback.summary}`,
    nextStep: objectiveFeedback.nextStep || operatingPolicy.nextStep,
    guardrails: ["Continue collecting evidence before changing runtime profile."],
  });
}
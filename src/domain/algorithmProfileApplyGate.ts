import type { TuningSweepStep } from "./efficiencyTuning.js";
import { targetRaisesHashLoad } from "./hashRuntimeGuard.js";
import type { AlgorithmObjectiveActionPlan } from "./algorithmObjectiveActionPlan.js";
import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";

export type AlgorithmProfileApplyIntent =
  | "objective_tune"
  | "batch_optimize"
  | "lowest_power"
  | "best_efficiency"
  | "best_hashrate";

export interface AlgorithmProfileApplyGateInput {
  certificate: AlgorithmObjectiveCertificate;
  actionPlan: AlgorithmObjectiveActionPlan;
  intent: AlgorithmProfileApplyIntent;
  baseCanApply: boolean;
  baseSummary: string;
  baseNextStep: string;
  targetStep: TuningSweepStep | null;
  currentStep?: TuningSweepStep | null;
}

export interface AlgorithmProfileApplyGate {
  intent: AlgorithmProfileApplyIntent;
  canApply: boolean;
  manualApprovalRequired: boolean;
  raisesLoad: boolean;
  targetStepId: string | null;
  targetStepSummary: string | null;
  targetComputeMode: TuningSweepStep["computeMode"] | null;
  targetCpuThreads: number | null;
  targetGpuIntensityPercent: number | null;
  summary: string;
  nextStep: string;
}

function intentLabel(intent: AlgorithmProfileApplyIntent) {
  switch (intent) {
    case "objective_tune":
      return "Objective tune";
    case "batch_optimize":
      return "Batch optimize";
    case "lowest_power":
      return "Lowest power";
    case "best_efficiency":
      return "Best efficiency";
    case "best_hashrate":
      return "Best hashrate";
  }
}

function gate(
  input: AlgorithmProfileApplyGateInput,
  canApply: boolean,
  manualApprovalRequired: boolean,
  raisesLoad: boolean,
  summary: string,
  nextStep: string,
): AlgorithmProfileApplyGate {
  return {
    intent: input.intent,
    canApply,
    manualApprovalRequired,
    raisesLoad,
    targetStepId: input.targetStep?.id ?? null,
    targetStepSummary: input.targetStep?.summary ?? null,
    targetComputeMode: input.targetStep?.computeMode ?? null,
    targetCpuThreads: input.targetStep?.cpuThreads ?? null,
    targetGpuIntensityPercent: input.targetStep?.gpuIntensityPercent ?? null,
    summary,
    nextStep,
  };
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function targetDoesNotRaisePower(target: TuningSweepStep | null | undefined, current: TuningSweepStep | null | undefined) {
  if (!target || !current || !finitePositive(target.estimatedWatts) || !finitePositive(current.estimatedWatts)) {
    return false;
  }
  return Number(target.estimatedWatts) <= Number(current.estimatedWatts) * 1.1;
}
function targetMatchesObjective(input: AlgorithmProfileApplyGateInput) {
  if (!input.actionPlan.localProfileApplyAllowed) {
    return false;
  }
  if (!input.actionPlan.applyTargetStepId || !input.targetStep) {
    return false;
  }
  return input.actionPlan.applyTargetStepId === input.targetStep.id;
}

export function deriveAlgorithmProfileApplyGate(
  input: AlgorithmProfileApplyGateInput,
): AlgorithmProfileApplyGate {
  const label = intentLabel(input.intent);
  const raisesLoad = targetRaisesHashLoad(input.targetStep, input.currentStep);

  if (!input.baseCanApply || !input.targetStep) {
    return gate(
      input,
      false,
      false,
      raisesLoad,
      `${label} is waiting on its local evidence gate.`,
      input.baseNextStep,
    );
  }

  if (input.certificate.status === "blocked" || input.actionPlan.action === "recover_runtime_guard") {
    if (!raisesLoad) {
      return gate(
        input,
        true,
        false,
        raisesLoad,
        `${label} may apply because it does not raise load while the runtime guard recovers.`,
        "Apply only as a recovery or fallback profile, then re-check share waste, thermals, and throttling.",
      );
    }
    return gate(
      input,
      false,
      false,
      raisesLoad,
      `${label} is blocked by the objective runtime guard.`,
      input.actionPlan.nextStep,
    );
  }

  if (input.intent === "best_hashrate") {
    if (
      input.certificate.highHashPath === "manual_burst" &&
      input.certificate.highHashReady &&
      input.certificate.maxHashBurstAvailable
    ) {
      if (targetDoesNotRaisePower(input.targetStep, input.currentStep)) {
        return gate(
          input,
          true,
          false,
          raisesLoad,
          "Best hashrate may become the density default because verified headroom does not raise measured or estimated watts.",
          "Apply the verified high-hash density point and keep refreshing power, share, thermal, and duty evidence.",
        );
      }
      return gate(
        input,
        true,
        true,
        raisesLoad,
        "Best hashrate is allowed only as an explicit manual burst.",
        "After the burst, return to the certified low-power density lane if thermals, rejects, or throttling worsen.",
      );
    }
    return gate(
      input,
      false,
      true,
      raisesLoad,
      "Best hashrate is blocked until the objective certificate proves manual burst headroom.",
      input.actionPlan.nextStep,
    );
  }

  if (input.intent === "objective_tune") {
    const allowed = input.actionPlan.localProfileApplyAllowed && targetMatchesObjective(input);
    return gate(
      input,
      allowed,
      false,
      raisesLoad,
      allowed
        ? `${label} matches the current objective action.`
        : `${label} is blocked by the objective action gate.`,
      allowed ? input.actionPlan.nextStep : input.actionPlan.reason,
    );
  }

  if (input.intent === "batch_optimize") {
    if (!raisesLoad) {
      return gate(
        input,
        true,
        false,
        raisesLoad,
        "Batch optimization may lower or hold load to protect useful hash per watt.",
        input.baseNextStep,
      );
    }
    const allowed = input.actionPlan.localProfileApplyAllowed && targetMatchesObjective(input);
    return gate(
      input,
      allowed,
      false,
      raisesLoad,
      allowed
        ? "Batch optimization matches the current objective action."
        : "Batch optimization cannot raise load outside the objective action gate.",
      allowed ? input.baseNextStep : input.actionPlan.nextStep,
    );
  }

  if (!raisesLoad) {
    return gate(
      input,
      true,
      false,
      raisesLoad,
      `${label} may apply because it does not raise local hash load.`,
      input.baseNextStep,
    );
  }

  if (input.intent === "lowest_power") {
    return gate(
      input,
      input.certificate.lowPowerReady,
      false,
      raisesLoad,
      input.certificate.lowPowerReady
        ? "Lowest power may apply because the low-power lane is certified."
        : "Lowest power is waiting for the low-power objective certificate.",
      input.certificate.lowPowerReady ? input.baseNextStep : input.actionPlan.nextStep,
    );
  }

  const allowed = input.actionPlan.localProfileApplyAllowed && targetMatchesObjective(input);
  return gate(
    input,
    allowed,
    false,
    raisesLoad,
    allowed
      ? `${label} may apply because it matches the objective tuning action.`
      : `${label} is blocked from raising load outside the objective action gate.`,
    allowed ? input.baseNextStep : input.actionPlan.nextStep,
  );
}

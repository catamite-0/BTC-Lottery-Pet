import type { AlgorithmExperimentAdvisorSnapshot } from "./algorithmExperimentAdvisor.js";
import type { AlgorithmObjectiveCertificate } from "./algorithmObjectiveCertificate.js";
import type { AlgorithmTuningDirective } from "./algorithmTuningDirective.js";

export type AlgorithmObjectiveActionKind =
  | "run_density_lane"
  | "keep_manual_burst_available"
  | "capture_local_evidence"
  | "measure_burst_headroom"
  | "hold_max_hash"
  | "verify_kernel_benchmark"
  | "repair_kernel_proof"
  | "recover_runtime_guard"
  | "validate_external_dry_run"
  | "monitor";

export interface AlgorithmObjectiveActionPlan {
  schemaVersion: 1;
  action: AlgorithmObjectiveActionKind;
  priority: AlgorithmExperimentAdvisorSnapshot["priority"];
  localProfileApplyAllowed: boolean;
  applyTargetStepId: string | null;
  miningStartAllowed: false;
  externalMiningAllowed: false;
  reason: string;
  evidenceToRecord: string[];
  stopConditions: string[];
  summary: string;
  nextStep: string;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function burstFitsCurrentPowerEnvelope(certificate: AlgorithmObjectiveCertificate) {
  if (
    !certificate.maxHashBurstAvailable ||
    !certificate.highHashReady ||
    certificate.highHashPath !== "manual_burst" ||
    !finitePositive(certificate.sustainableHashrate) ||
    !finitePositive(certificate.sustainableWatts) ||
    !finitePositive(certificate.burstHashrate) ||
    !finitePositive(certificate.burstWatts)
  ) {
    return false;
  }

  return (
    Number(certificate.burstHashrate) > Number(certificate.sustainableHashrate) &&
    Number(certificate.burstWatts) <= Number(certificate.sustainableWatts)
  );
}

function actionFor(certificate: AlgorithmObjectiveCertificate): AlgorithmObjectiveActionKind {
  if (certificate.status === "dry_run") {
    return "validate_external_dry_run";
  }
  if (certificate.highHashPath === "kernel_evidence_wait") {
    return "verify_kernel_benchmark";
  }
  if (certificate.highHashPath === "kernel_blocked" || certificate.highHashPath === "kernel_regression") {
    return "repair_kernel_proof";
  }
  if (certificate.status === "blocked" || certificate.runtimeMode === "runtime_guard") {
    return "recover_runtime_guard";
  }
  if (certificate.status === "ready") {
    if (burstFitsCurrentPowerEnvelope(certificate)) {
      return "run_density_lane";
    }
    return certificate.maxHashBurstAvailable ? "keep_manual_burst_available" : "run_density_lane";
  }
  if (certificate.status === "waiting") {
    return "capture_local_evidence";
  }
  if (certificate.highHashPath === "marginal_hold") {
    return "hold_max_hash";
  }
  if (certificate.highHashPath === "needs_measurement" || certificate.highHashPath === "cooldown") {
    return "measure_burst_headroom";
  }
  return "monitor";
}

function localProfileApplyAllowed(
  action: AlgorithmObjectiveActionKind,
  certificate: AlgorithmObjectiveCertificate,
  advisor: AlgorithmExperimentAdvisorSnapshot,
  directive: AlgorithmTuningDirective,
) {
  if (action === "run_density_lane") {
    return certificate.autoApplyAllowed && certificate.lowPowerReady;
  }
  if (action === "capture_local_evidence" || action === "measure_burst_headroom") {
    return advisor.canApplyLocalProfile && directive.canApplyLocalProfile;
  }
  return false;
}

function reasonFor(
  action: AlgorithmObjectiveActionKind,
  certificate: AlgorithmObjectiveCertificate,
  advisor: AlgorithmExperimentAdvisorSnapshot,
): string {
  switch (action) {
    case "run_density_lane":
      if (burstFitsCurrentPowerEnvelope(certificate)) {
        return "Verified high-hash headroom fits the current watt envelope, so it can run as the density lane.";
      }
      return "Low-power density lane is ready and remains the unattended default.";
    case "keep_manual_burst_available":
      return "Low-power density is ready and max-hash headroom is verified as a manual burst only.";
    case "capture_local_evidence":
      return certificate.primaryBlockerSummary ?? advisor.summary;
    case "measure_burst_headroom":
      return "High-hash path needs marginal density, thermal, share, and stability evidence before use.";
    case "hold_max_hash":
      return "Max-hash profile is intentionally held because the extra watts do not pay for enough useful hash.";
    case "verify_kernel_benchmark":
      return "Fixed-window midstate benchmark is required before runtime kernel promotion.";
    case "repair_kernel_proof":
      return "Midstate kernel proof is blocked or regressed, so full-header mining remains the active baseline.";
    case "recover_runtime_guard":
      return certificate.primaryBlockerSummary ?? "Runtime guard blocks promotion until waste, throttling, or instability clears.";
    case "validate_external_dry_run":
      return "External high-hash capability must stay in dry-run validation before any real mining start.";
    case "monitor":
      return certificate.summary || advisor.summary;
  }
}

function nextStepFor(
  action: AlgorithmObjectiveActionKind,
  certificate: AlgorithmObjectiveCertificate,
  advisor: AlgorithmExperimentAdvisorSnapshot,
  directive: AlgorithmTuningDirective,
): string {
  switch (action) {
    case "run_density_lane":
      if (burstFitsCurrentPowerEnvelope(certificate)) {
        return "Run the verified high-hash density lane and keep capturing stable share and watt evidence.";
      }
      return "Keep the density lane running; capture another stable sample before changing the power envelope.";
    case "keep_manual_burst_available":
      return certificate.nextStep || "Keep max-hash as a manual burst while the density lane remains default.";
    case "capture_local_evidence":
      return directive.nextStep || advisor.nextStep || certificate.nextStep || "Capture objective evidence before changing profiles.";
    case "measure_burst_headroom":
      return advisor.nextStep || certificate.nextStep || "Capture high-hash headroom evidence before promotion.";
    case "hold_max_hash":
      return certificate.nextStep || "Keep max-hash held until evidence improves.";
    case "verify_kernel_benchmark":
    case "repair_kernel_proof":
      return certificate.nextStep || advisor.nextStep || "Verify kernel evidence before changing profiles.";
    case "recover_runtime_guard":
      return certificate.nextStep || "Recover runtime evidence before profile promotion.";
    case "validate_external_dry_run":
      return advisor.nextStep || certificate.nextStep || "Validate external work in dry-run before real routing.";
    case "monitor":
      return certificate.nextStep || advisor.nextStep || "Monitor objective evidence before changing profiles.";
  }
}

function summaryFor(action: AlgorithmObjectiveActionKind, certificate: AlgorithmObjectiveCertificate): string {
  const objective = certificate.objective.replace(/_/g, " ");
  switch (action) {
    case "run_density_lane":
      if (burstFitsCurrentPowerEnvelope(certificate)) {
        return `Objective action: run the verified high-hash density lane for ${objective}.`;
      }
      return `Objective action: run the selected density lane for ${objective}.`;
    case "keep_manual_burst_available":
      return `Objective action: keep max-hash as a manual burst while the density lane remains default.`;
    case "capture_local_evidence":
      return `Objective action: capture missing local evidence before claiming ${objective}.`;
    case "measure_burst_headroom":
      return "Objective action: measure max-hash headroom without promoting it to unattended operation.";
    case "hold_max_hash":
      return "Objective action: hold max-hash and preserve the low-power lane.";
    case "verify_kernel_benchmark":
      return "Objective action: verify the fixed-window midstate benchmark before profile promotion.";
    case "repair_kernel_proof":
      return "Objective action: repair or rerun kernel proof before high-hash promotion.";
    case "recover_runtime_guard":
      return "Objective action: recover useful hash density before any profile promotion.";
    case "validate_external_dry_run":
      return "Objective action: validate external high-hash work in dry-run only.";
    case "monitor":
      return "Objective action: monitor current evidence before changing profiles.";
  }
}

export function deriveAlgorithmObjectiveActionPlan(
  certificate: AlgorithmObjectiveCertificate,
  advisor: AlgorithmExperimentAdvisorSnapshot,
  directive: AlgorithmTuningDirective,
): AlgorithmObjectiveActionPlan {
  const action = actionFor(certificate);
  const profileApplyAllowed = localProfileApplyAllowed(action, certificate, advisor, directive);

  return {
    schemaVersion: 1,
    action,
    priority: action === "recover_runtime_guard" || action === "validate_external_dry_run" || action === "repair_kernel_proof"
      ? "critical"
      : advisor.priority,
    localProfileApplyAllowed: profileApplyAllowed,
    applyTargetStepId: profileApplyAllowed
      ? directive.applyTarget?.stepId ?? advisor.applyTargetStepId
      : null,
    miningStartAllowed: false,
    externalMiningAllowed: false,
    reason: reasonFor(action, certificate, advisor),
    evidenceToRecord: unique([
      ...advisor.evidenceToRecord,
      certificate.lowPowerReady ? "" : "low-power lane readiness",
      action === "verify_kernel_benchmark" ? "fixed-window kernel benchmark" : "",
      action === "repair_kernel_proof" ? "midstate equivalence and performance proof" : "",
      certificate.highHashReady ? "" : "max-hash burst readiness",
    ]),
    stopConditions: unique([
      ...advisor.stopConditions,
      "runtime guard blocks profile promotion",
      "objective certificate status regresses",
    ]),
    summary: summaryFor(action, certificate),
    nextStep: nextStepFor(action, certificate, advisor, directive),
  };
}

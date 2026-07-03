import type { AlgorithmTuningDirective } from "./algorithmTuningDirective.js";
import type { AlgorithmSamplingTask, AlgorithmSamplingTaskId, AlgorithmSamplingTaskRoute } from "./algorithmSamplingPlan.js";
import type { MiningAlgorithmPlan } from "./algorithmPlanner.js";
import type { HashDensityMarginalDecisionStatus } from "./hashDensityPlanner.js";

export type AlgorithmExperimentPriority = "critical" | "high" | "medium" | "low" | "blocked";
export type AlgorithmExperimentFocus =
  | "power_baseline"
  | "share_quality"
  | "stability_window"
  | "power_density_knee"
  | "hashrate_headroom"
  | "external_telemetry"
  | "external_work_validation"
  | "direct_protocol"
  | "research_boundary"
  | "monitor";
export type AlgorithmExperimentAction =
  | "run_local_profile"
  | "sample_network_telemetry"
  | "run_external_dry_run"
  | "hold_direct"
  | "review_research"
  | "monitor";
export type AlgorithmExperimentPowerImpact = "proves_low_power" | "improves_efficiency" | "guards_power" | "none";
export type AlgorithmExperimentHashrateImpact = "classifies_burst" | "expands_useful_hash" | "guards_external_hash" | "none";

export interface AlgorithmExperimentAdvisorSnapshot {
  schemaVersion: 1;
  priority: AlgorithmExperimentPriority;
  focus: AlgorithmExperimentFocus;
  action: AlgorithmExperimentAction;
  primaryTaskId: AlgorithmSamplingTaskId;
  route: AlgorithmSamplingTaskRoute;
  applyTargetStepId: string | null;
  canApplyLocalProfile: boolean;
  miningStartAllowed: false;
  powerImpact: AlgorithmExperimentPowerImpact;
  hashrateImpact: AlgorithmExperimentHashrateImpact;
  marginalDecisionStatus: HashDensityMarginalDecisionStatus;
  marginalDensityRetentionRatio: number | null;
  requiredSeconds: number | null;
  requiredSamples: number | null;
  requiredShareEvents: number | null;
  evidenceToRecord: string[];
  stopConditions: string[];
  blockedBy: string[];
  summary: string;
  nextStep: string;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function focusForTask(task: AlgorithmSamplingTask): AlgorithmExperimentFocus {
  switch (task.id) {
    case "local_baseline":
    case "local_measured_power":
      return "power_baseline";
    case "local_share_quality":
      return "share_quality";
    case "local_stability_window":
      return "stability_window";
    case "local_power_density_probe":
      return task.targetProfile === "max_hashrate" ? "hashrate_headroom" : "power_density_knee";
    case "external_telemetry_history":
    case "external_stability_history":
      return "external_telemetry";
    case "external_work_dry_run":
      return "external_work_validation";
    case "direct_read_only_probe":
      return "direct_protocol";
    case "research_review":
      return "research_boundary";
  }
}

function actionForFocus(focus: AlgorithmExperimentFocus): AlgorithmExperimentAction {
  switch (focus) {
    case "power_baseline":
    case "share_quality":
    case "stability_window":
    case "power_density_knee":
    case "hashrate_headroom":
      return "run_local_profile";
    case "external_telemetry":
      return "sample_network_telemetry";
    case "external_work_validation":
      return "run_external_dry_run";
    case "direct_protocol":
      return "hold_direct";
    case "research_boundary":
      return "review_research";
    case "monitor":
      return "monitor";
  }
}

function powerImpactForFocus(focus: AlgorithmExperimentFocus): AlgorithmExperimentPowerImpact {
  switch (focus) {
    case "power_baseline":
      return "proves_low_power";
    case "power_density_knee":
    case "external_telemetry":
      return "improves_efficiency";
    case "stability_window":
    case "external_work_validation":
    case "direct_protocol":
      return "guards_power";
    case "share_quality":
    case "hashrate_headroom":
    case "research_boundary":
    case "monitor":
      return "none";
  }
}

function hashrateImpactForFocus(focus: AlgorithmExperimentFocus): AlgorithmExperimentHashrateImpact {
  switch (focus) {
    case "hashrate_headroom":
      return "classifies_burst";
    case "power_density_knee":
    case "share_quality":
      return "expands_useful_hash";
    case "external_telemetry":
    case "external_work_validation":
    case "direct_protocol":
      return "guards_external_hash";
    case "power_baseline":
    case "stability_window":
    case "research_boundary":
    case "monitor":
      return "none";
  }
}

function priorityFor(
  plan: MiningAlgorithmPlan,
  directive: AlgorithmTuningDirective,
  focus: AlgorithmExperimentFocus,
): AlgorithmExperimentPriority {
  if (directive.status === "blocked" || directive.status === "reserved") {
    return "blocked";
  }
  if (focus === "hashrate_headroom") {
    const marginalStatus = plan.densityPlan.marginalDecision?.status ?? "measure";
    if (marginalStatus === "hold" || marginalStatus === "cooldown") {
      return "blocked";
    }
    if (marginalStatus === "advance") {
      return "low";
    }
  }
  if (directive.status === "done") {
    return "low";
  }

  switch (focus) {
    case "power_baseline":
      return plan.readinessCertificate.readinessScore < 40 ? "critical" : "high";
    case "external_work_validation":
      return plan.canAssignExternalWork || plan.strategy === "external_work_dry_run" ? "critical" : "high";
    case "hashrate_headroom":
    case "power_density_knee":
      return "high";
    case "external_telemetry":
      return plan.recommendedRoute === "external" ? "high" : "medium";
    case "share_quality":
    case "stability_window":
      return "high";
    case "direct_protocol":
      return "blocked";
    case "research_boundary":
      return "medium";
    case "monitor":
      return "low";
  }
}

function localEvidence(task: AlgorithmSamplingTask) {
  const evidence = ["hashrate", "pool share counters", "sample duration"];
  if (task.requiresMeasuredPower) {
    evidence.push("measured watts");
  }
  if (task.requiresCoolOrWarmThermals) {
    evidence.push("temperature and thermal state");
  }
  if (task.requiredShareEvents !== null) {
    evidence.push(`${task.requiredShareEvents} useful share events`);
  }
  return evidence;
}

function evidenceFor(plan: MiningAlgorithmPlan, focus: AlgorithmExperimentFocus, task: AlgorithmSamplingTask) {
  switch (focus) {
    case "power_baseline":
    case "share_quality":
    case "stability_window":
    case "power_density_knee":
      return localEvidence(task);
    case "hashrate_headroom":
      return unique([
        ...localEvidence(task),
        "marginal hashes per watt",
        "density retention versus selected lane",
        plan.densityPlan.marginalDecision?.status === "measure" ? "missing marginal evidence" : "marginal decision status",
      ]);
    case "external_telemetry":
      return [
        "external hashrate",
        "external watts or J/TH",
        "external temperature/fan/paused state",
        "timestamped telemetry sample",
      ];
    case "external_work_validation":
      return [
        "dry-run job lifecycle",
        "unique work lease",
        "stale-result rejection",
        "mock accepted/rejected share accounting",
        "thermal-limit handling",
      ];
    case "direct_protocol":
      return [
        "physical endpoint kind",
        "read-only endpoint identity",
        "protocol framing notes",
      ];
    case "research_boundary":
      return [
        "source title and URL",
        "consensus impact",
        "deployment lane",
      ];
    case "monitor":
      return ["current route evidence"];
  }
}

function stopConditionsFor(plan: MiningAlgorithmPlan, focus: AlgorithmExperimentFocus, task: AlgorithmSamplingTask) {
  const stop = ["configured sample target is reached"];

  if (focus === "external_telemetry") {
    stop.push("external telemetry reports hot, critical, or paused state");
    stop.push("telemetry lacks hashrate or power/J/TH");
    return stop;
  }

  if (focus === "external_work_validation") {
    stop.push("dry-run leases overlap or stale results are accepted");
    stop.push("any path would submit real external shares");
    return stop;
  }

  if (focus === "direct_protocol") {
    stop.push("endpoint probing would require writes or job control");
    return stop;
  }

  if (focus === "research_boundary") {
    stop.push("claim implies nonce prediction, proof-of-work compression, or search pruning");
    return stop;
  }

  if (task.requiresCoolOrWarmThermals) {
    stop.push("profile becomes hot, critical, or paused");
  }
  if (focus === "hashrate_headroom") {
    stop.push("marginal density retention falls below the upgrade threshold");
    if (plan.densityPlan.marginalDecision?.status === "cooldown") {
      stop.push("current marginal decision is cooldown");
    }
  }
  if (task.requiredShareEvents !== null) {
    stop.push("share waste exceeds the route threshold");
  }
  stop.push("active profile no longer matches the target profile");
  return stop;
}

function blockedByFor(plan: MiningAlgorithmPlan, directive: AlgorithmTuningDirective) {
  const blocked = plan.riskFlags.slice(0, 3);
  if (directive.status === "blocked" || directive.status === "reserved") {
    blocked.unshift(directive.nextStep);
  }
  return unique(blocked);
}

function summaryFor(
  plan: MiningAlgorithmPlan,
  priority: AlgorithmExperimentPriority,
  focus: AlgorithmExperimentFocus,
  action: AlgorithmExperimentAction,
  directive: AlgorithmTuningDirective,
) {
  const target = directive.applyTarget
    ? ` target ${directive.applyTarget.stepId}`
    : "";
  const marginal = focus === "hashrate_headroom"
    ? ` / marginal ${plan.densityPlan.marginalDecision?.status ?? "measure"}`
    : "";
  return `Experiment ${priority}: ${focus.replace(/_/g, " ")} via ${action.replace(/_/g, " ")}${target}${marginal}.`;
}

function nextStepFor(
  plan: MiningAlgorithmPlan,
  focus: AlgorithmExperimentFocus,
  directive: AlgorithmTuningDirective,
  canApplyLocalProfile: boolean,
) {
  if (focus === "external_telemetry") {
    return `${directive.nextStep} Record the sample, but do not hand pool jobs to the device.`;
  }
  if (focus === "external_work_validation") {
    return `${directive.nextStep} Keep validation dry-run only and keep real external mining start disabled.`;
  }
  if (focus === "direct_protocol") {
    return `${directive.nextStep} Direct remains read-only until real hardware proves the protocol.`;
  }
  if (focus === "research_boundary") {
    return `${directive.nextStep} Keep frontier claims out of runtime routing until they preserve consensus search coverage.`;
  }
  if (focus === "hashrate_headroom") {
    const decision = plan.densityPlan.marginalDecision;
    if (decision?.status === "hold") {
      return `${decision.nextStep} Do not apply the high-output profile from the experiment advisor.`;
    }
    if (decision?.status === "cooldown") {
      return `${decision.nextStep} Do not run the high-output profile until cooling or stability evidence improves.`;
    }
    if (decision?.status === "advance") {
      return `${decision.nextStep} Treat this as a manual burst option, not an automatic low-power setting.`;
    }
  }
  return canApplyLocalProfile
    ? `${directive.nextStep} Apply the target profile manually, then capture the required evidence.`
    : directive.nextStep;
}

export function deriveAlgorithmExperimentAdvisor(
  plan: MiningAlgorithmPlan,
  directive: AlgorithmTuningDirective,
): AlgorithmExperimentAdvisorSnapshot {
  const task = plan.samplingPlan.primaryTask;
  const focus = focusForTask(task);
  const action = actionForFocus(focus);
  const priority = priorityFor(plan, directive, focus);

  const marginalDecisionStatus = plan.densityPlan.marginalDecision?.status ?? "measure";
  const marginalDensityRetentionRatio = plan.densityPlan.marginalDecision?.densityRetentionRatio ?? null;
  const canApplyLocalProfile = directive.canApplyLocalProfile && !(
    focus === "hashrate_headroom" &&
    (marginalDecisionStatus === "hold" || marginalDecisionStatus === "cooldown" || marginalDecisionStatus === "advance")
  );

  return {
    schemaVersion: 1,
    priority,
    focus,
    action,
    primaryTaskId: task.id,
    route: task.route,
    applyTargetStepId: directive.applyTarget?.stepId ?? null,
    canApplyLocalProfile,
    miningStartAllowed: false,
    powerImpact: powerImpactForFocus(focus),
    hashrateImpact: hashrateImpactForFocus(focus),
    marginalDecisionStatus,
    marginalDensityRetentionRatio,
    requiredSeconds: directive.requiredSeconds,
    requiredSamples: directive.requiredSamples,
    requiredShareEvents: directive.requiredShareEvents,
    evidenceToRecord: unique(evidenceFor(plan, focus, task)),
    stopConditions: unique(stopConditionsFor(plan, focus, task)),
    blockedBy: blockedByFor(plan, directive),
    summary: summaryFor(plan, priority, focus, action, directive),
    nextStep: nextStepFor(plan, focus, directive, canApplyLocalProfile),
  };
}

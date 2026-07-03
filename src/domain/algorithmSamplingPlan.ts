import type { AlgorithmEvidenceRoadmap } from "./algorithmEvidenceRoadmap.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import type { HashDensityPlan } from "./hashDensityPlanner.js";
import {
  OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
  OPTIMIZATION_MIN_SHARE_EVENTS,
  OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
  OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
} from "./optimizationThresholds.js";
import type { MiningAlgorithmExperimentQueue, MiningAlgorithmReadinessCertificate } from "./algorithmPlanner.js";

export type AlgorithmSamplingTaskId =
  | "local_baseline"
  | "local_measured_power"
  | "local_share_quality"
  | "local_stability_window"
  | "local_power_density_probe"
  | "external_telemetry_history"
  | "external_stability_history"
  | "external_work_dry_run"
  | "direct_read_only_probe"
  | "research_review";

export type AlgorithmSamplingTaskRoute = "local" | "network" | "external" | "direct" | "research";
export type AlgorithmSamplingTaskStatus = "ready" | "waiting" | "blocked" | "reserved" | "done";
export type AlgorithmSamplingTargetProfile = "next_power_density" | "max_hashrate";

export interface AlgorithmSamplingTask {
  id: AlgorithmSamplingTaskId;
  route: AlgorithmSamplingTaskRoute;
  status: AlgorithmSamplingTaskStatus;
  requiredSeconds: number | null;
  remainingSeconds: number | null;
  requiredSamples: number | null;
  remainingSamples: number | null;
  requiredShareEvents: number | null;
  remainingShareEvents: number | null;
  requiresMeasuredPower: boolean;
  requiresCoolOrWarmThermals: boolean;
  objective: string;
  successCriteria: string;
  nextStep: string;
  targetProfile?: AlgorithmSamplingTargetProfile | null;
}

export interface AlgorithmSamplingPlanInput {
  evidenceRoadmap: AlgorithmEvidenceRoadmap;
  readinessCertificate: MiningAlgorithmReadinessCertificate;
  experimentQueue: MiningAlgorithmExperimentQueue;
  densityPlan: HashDensityPlan;
  externalHistory: ExternalHashHistorySummary;
}

export interface AlgorithmSamplingPlan {
  tasks: AlgorithmSamplingTask[];
  primaryTask: AlgorithmSamplingTask;
  readyTaskIds: AlgorithmSamplingTaskId[];
  blockedTaskIds: AlgorithmSamplingTaskId[];
  totalEstimatedSeconds: number;
  localRequiredSeconds: number;
  externalRequiredSamples: number;
  externalStableSampleTarget: number;
  summary: string;
  nextStep: string;
}

function gate(input: AlgorithmSamplingPlanInput, id: string) {
  return input.readinessCertificate.gates.find((candidate) => candidate.id === id) ?? null;
}

function gateDone(input: AlgorithmSamplingPlanInput, id: string) {
  return gate(input, id)?.status === "passed";
}

function statusFromGate(input: AlgorithmSamplingPlanInput, id: string): AlgorithmSamplingTaskStatus {
  const status = gate(input, id)?.status ?? "waiting";
  switch (status) {
    case "passed":
      return "done";
    case "blocked":
      return "blocked";
    case "reserved":
      return "reserved";
    case "waiting":
      return "waiting";
  }
}

function task(args: AlgorithmSamplingTask): AlgorithmSamplingTask {
  return args;
}

function taskRank(status: AlgorithmSamplingTaskStatus) {
  switch (status) {
    case "ready":
      return 0;
    case "blocked":
      return 1;
    case "waiting":
      return 2;
    case "reserved":
      return 3;
    case "done":
      return 4;
  }
}

function experiment(input: AlgorithmSamplingPlanInput, id: string) {
  return input.experimentQueue.experiments.find((candidate) => candidate.id === id) ??
    (input.experimentQueue.primaryExperiment.id === id ? input.experimentQueue.primaryExperiment : null);
}

function experimentTaskStatus(input: AlgorithmSamplingPlanInput, id: string): AlgorithmSamplingTaskStatus {
  return experiment(input, id)?.status ?? "waiting";
}

function headroomNeedsProbe(input: AlgorithmSamplingPlanInput) {
  const marginalStatus = input.densityPlan.marginalDecision?.status;
  if (marginalStatus) {
    return marginalStatus === "measure";
  }
  return input.densityPlan.hashrateHeadroom?.status === "waiting";
}

function primaryTaskId(input: AlgorithmSamplingPlanInput): AlgorithmSamplingTaskId {
  const primaryExperiment = input.experimentQueue.primaryExperiment;
  if (primaryExperiment.id === "probe_power_density_knee" && primaryExperiment.status !== "done") {
    return "local_power_density_probe";
  }

  switch (input.evidenceRoadmap.primaryPhase.id) {
    case "consensus_guardrail":
      return "research_review";
    case "local_power_baseline":
      return gateDone(input, "measured_power") ? "local_share_quality" : "local_measured_power";
    case "useful_hash_density":
      if (headroomNeedsProbe(input)) {
        return "local_power_density_probe";
      }
      return input.densityPlan.primaryMissingGate?.id === "share_quality"
        ? "local_share_quality"
        : input.densityPlan.primaryMissingGate?.id === "stability_window"
          ? "local_stability_window"
          : "local_measured_power";
    case "network_telemetry_history":
      return "external_telemetry_history";
    case "search_space_work_leases":
    case "external_work_validation":
      return "external_work_dry_run";
    case "direct_protocol_selection":
      return "direct_read_only_probe";
    case "research_frontier_filter":
      return "research_review";
  }
}

function readyIfPrimary(input: AlgorithmSamplingPlanInput, id: AlgorithmSamplingTaskId, fallback: AlgorithmSamplingTaskStatus) {
  return primaryTaskId(input) === id && fallback === "waiting" ? "ready" : fallback;
}

export function deriveAlgorithmSamplingPlan(input: AlgorithmSamplingPlanInput): AlgorithmSamplingPlan {
  const externalReadyGap = Math.max(0, OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES - input.externalHistory.usableEfficiencySampleCount);
  const externalStableGap = Math.max(0, OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES - input.externalHistory.usableEfficiencySampleCount);
  const localDone = input.readinessCertificate.readyForUnattendedLocal && input.densityPlan.readyForLongRun;
  const localStatus: AlgorithmSamplingTaskStatus = localDone ? "done" : primaryTaskId(input) === "local_baseline" ? "ready" : "waiting";
  const measuredPowerStatus = statusFromGate(input, "measured_power");
  const shareStatus = statusFromGate(input, "share_quality");
  const stabilityStatus = statusFromGate(input, "stability_window");
  const thermalStatus = statusFromGate(input, "thermal_safety");
  const externalHistoryStatus = statusFromGate(input, "external_efficiency_history");
  const externalWorkStatus = statusFromGate(input, "external_work_validation");
  const primaryId = primaryTaskId(input);
  const powerDensityProbe = experiment(input, "probe_power_density_knee");
  const headroomProbe = headroomNeedsProbe(input);
  const powerDensityProbeStatus = headroomProbe ? "ready" : experimentTaskStatus(input, "probe_power_density_knee");
  const powerDensityProbeDone = !headroomProbe && powerDensityProbeStatus === "done";
  const tasks = [
    task({
      id: "local_baseline",
      route: "local",
      status: localStatus,
      requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      remainingSeconds: localDone ? 0 : OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      requiredSamples: 1,
      remainingSamples: localDone ? 0 : 1,
      requiredShareEvents: OPTIMIZATION_MIN_SHARE_EVENTS,
      remainingShareEvents: gateDone(input, "share_quality") ? 0 : OPTIMIZATION_MIN_SHARE_EVENTS,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: "Capture one local long-run profile that can fairly represent power, useful shares, and thermals.",
      successCriteria: `${Math.round(OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS / 60)} minute sample with measured watts, at least ${OPTIMIZATION_MIN_SHARE_EVENTS} share events, low waste, and safe thermals.`,
      nextStep: input.evidenceRoadmap.phases.find((phase) => phase.id === "local_power_baseline")?.nextStep ?? "Run a local profile long enough to capture measured watts and share quality.",
    }),
    task({
      id: "local_measured_power",
      route: "local",
      status: readyIfPrimary(input, "local_measured_power", measuredPowerStatus === "done" ? "done" : measuredPowerStatus),
      requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      remainingSeconds: gateDone(input, "measured_power") ? 0 : OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      requiredSamples: 1,
      remainingSamples: gateDone(input, "measured_power") ? 0 : 1,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: false,
      objective: "Replace estimated watts with measured local power evidence.",
      successCriteria: "The selected local profile reports measured watts from wall power, GPU telemetry, or equivalent device telemetry.",
      nextStep: gate(input, "measured_power")?.nextStep ?? "Capture measured watts for the active local profile.",
    }),
    task({
      id: "local_share_quality",
      route: "local",
      status: readyIfPrimary(input, "local_share_quality", shareStatus === "done" ? "done" : shareStatus),
      requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      remainingSeconds: gateDone(input, "share_quality") ? 0 : OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      requiredSamples: 1,
      remainingSamples: gateDone(input, "share_quality") ? 0 : 1,
      requiredShareEvents: OPTIMIZATION_MIN_SHARE_EVENTS,
      remainingShareEvents: gateDone(input, "share_quality") ? 0 : OPTIMIZATION_MIN_SHARE_EVENTS,
      requiresMeasuredPower: false,
      requiresCoolOrWarmThermals: false,
      objective: "Prove that local hashes are useful pool work, not rejected, stale, or locally dropped work.",
      successCriteria: `At least ${OPTIMIZATION_MIN_SHARE_EVENTS} accepted/rejected/stale/drop share events with waste below the route threshold.`,
      nextStep: gate(input, "share_quality")?.nextStep ?? "Run long enough to collect accepted shares and reject/drop counters.",
    }),
    task({
      id: "local_stability_window",
      route: "local",
      status: readyIfPrimary(input, "local_stability_window", stabilityStatus === "done" && thermalStatus === "done" ? "done" : stabilityStatus === "blocked" || thermalStatus === "blocked" ? "blocked" : "waiting"),
      requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      remainingSeconds: gateDone(input, "stability_window") ? 0 : OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      requiredSamples: 1,
      remainingSamples: gateDone(input, "stability_window") && gateDone(input, "thermal_safety") ? 0 : 1,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: false,
      requiresCoolOrWarmThermals: true,
      objective: "Prove the selected local lane stays stable and thermally safe for unattended operation.",
      successCriteria: `${Math.round(OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS / 60)} minute stable window without hot, critical, or paused thermal states.`,
      nextStep: gate(input, "stability_window")?.status === "passed"
        ? gate(input, "thermal_safety")?.nextStep ?? "Keep thermal telemetry attached to the selected lane."
        : gate(input, "stability_window")?.nextStep ?? "Extend the selected local profile sample window.",
    }),
    task({
      id: "local_power_density_probe",
      route: "local",
      status: readyIfPrimary(input, "local_power_density_probe", powerDensityProbeStatus),
      requiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      remainingSeconds: powerDensityProbeDone ? 0 : OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
      requiredSamples: 1,
      remainingSamples: powerDensityProbeDone ? 0 : 1,
      requiredShareEvents: OPTIMIZATION_MIN_SHARE_EVENTS,
      remainingShareEvents: powerDensityProbeDone ? 0 : OPTIMIZATION_MIN_SHARE_EVENTS,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: headroomProbe
        ? "Classify max-hash headroom above the low-power density lane before treating highest-hash mode as known."
        : "Probe the next local profile above the power-density knee before expanding the operating envelope.",
      successCriteria: headroomProbe
        ? "Measured watts, useful shares, and cool/warm thermals classify whether extra local hashrate is available, unsafe, or not worth the watts."
        : powerDensityProbe?.successCriteria ?? "Measured marginal H/s/W confirms where the next watt stops paying for useful hash.",
      nextStep: headroomProbe
        ? input.densityPlan.hashrateHeadroom?.nextStep ?? "Measure the max-hash headroom profile with watts, thermals, and share counters."
        : powerDensityProbe?.nextStep ?? "Measure the next higher local tuning profile with watts, thermals, and share counters.",
      targetProfile: headroomProbe ? "max_hashrate" : "next_power_density",
    }),
    task({
      id: "external_telemetry_history",
      route: "network",
      status: readyIfPrimary(input, "external_telemetry_history", externalHistoryStatus === "done" ? "done" : externalHistoryStatus),
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
      remainingSamples: externalReadyGap,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: "Collect enough network ASIC telemetry to compare watts, J/TH, thermals, and hashrate.",
      successCriteria: `${OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES} usable cool/warm external efficiency samples and a non-degrading trend.`,
      nextStep: gate(input, "external_efficiency_history")?.nextStep ?? "External hash telemetry is sealed on this branch; use the archive branch for future hardware validation.",
    }),
    task({
      id: "external_stability_history",
      route: "network",
      status: input.externalHistory.evidenceStatus === "stable" ? "done" : externalStableGap > 0 ? "waiting" : "ready",
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
      remainingSamples: externalStableGap,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: "Promote external telemetry from route-ready to stable before treating it as a long-run reference.",
      successCriteria: `${OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES} usable cool/warm external efficiency samples without degradation.`,
      nextStep: externalStableGap > 0
        ? `Collect ${externalStableGap} more usable external sample${externalStableGap === 1 ? "" : "s"} for stable hardware comparison.`
        : input.externalHistory.summary,
    }),
    task({
      id: "external_work_dry_run",
      route: "external",
      status: primaryId === "external_work_dry_run" && externalWorkStatus !== "done" ? "ready" : externalWorkStatus === "done" ? "done" : input.evidenceRoadmap.externalDryRunReady ? "ready" : externalWorkStatus,
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: 1,
      remainingSamples: gateDone(input, "external_work_validation") ? 0 : 1,
      requiredShareEvents: OPTIMIZATION_MIN_SHARE_EVENTS,
      remainingShareEvents: gateDone(input, "external_work_validation") ? 0 : OPTIMIZATION_MIN_SHARE_EVENTS,
      requiresMeasuredPower: true,
      requiresCoolOrWarmThermals: true,
      objective: "Validate external job lifecycle and work leases without enabling real external mining.",
      successCriteria: "Dry-run leases are unique, stale results are rejected, thermal limits are enforced, and mock share accounting is reviewed.",
      nextStep: gate(input, "external_work_validation")?.nextStep ?? input.experimentQueue.primaryExperiment.nextStep,
    }),
    task({
      id: "direct_read_only_probe",
      route: "direct",
      status: statusFromGate(input, "direct_protocol"),
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: 1,
      remainingSamples: gateDone(input, "direct_protocol") ? 0 : 1,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: false,
      requiresCoolOrWarmThermals: false,
      objective: "Identify the physical Direct endpoint protocol before any telemetry or work routing.",
      successCriteria: "Serial, USB, HID, or vendor path endpoint can be discovered read-only on real hardware.",
      nextStep: gate(input, "direct_protocol")?.nextStep ?? "Wait until Direct hardware exists.",
    }),
    task({
      id: "research_review",
      route: "research",
      status: input.evidenceRoadmap.phases.find((phase) => phase.id === "research_frontier_filter")?.status === "done" ? "done" : "waiting",
      requiredSeconds: null,
      remainingSeconds: null,
      requiredSamples: null,
      remainingSamples: null,
      requiredShareEvents: null,
      remainingShareEvents: null,
      requiresMeasuredPower: false,
      requiresCoolOrWarmThermals: false,
      objective: "Keep new algorithm claims classified before they can influence mining routes.",
      successCriteria: "Production, experiment, decision-only, and rejected lanes are explicit before runtime behavior changes.",
      nextStep: input.evidenceRoadmap.phases.find((phase) => phase.id === "research_frontier_filter")?.nextStep ?? "Review the next research claim against the consensus boundary.",
    }),
  ];
  const sorted = tasks.slice().sort((left, right) => taskRank(left.status) - taskRank(right.status));
  const primaryTask = tasks.find((candidate) => candidate.id === primaryId && candidate.status !== "done") ?? sorted[0] ?? tasks[0];
  const readyTaskIds = tasks.filter((candidate) => candidate.status === "ready").map((candidate) => candidate.id);
  const blockedTaskIds = tasks.filter((candidate) => candidate.status === "blocked" || candidate.status === "reserved").map((candidate) => candidate.id);
  const totalEstimatedSeconds = tasks.reduce((total, item) => total + (item.remainingSeconds ?? 0), 0);

  return {
    tasks,
    primaryTask,
    readyTaskIds,
    blockedTaskIds,
    totalEstimatedSeconds,
    localRequiredSeconds: OPTIMIZATION_UNATTENDED_SAMPLE_SECONDS,
    externalRequiredSamples: OPTIMIZATION_MIN_EXTERNAL_EFFICIENCY_SAMPLES,
    externalStableSampleTarget: OPTIMIZATION_STABLE_EXTERNAL_EFFICIENCY_SAMPLES,
    summary: `Sampling plan: primary ${primaryTask.id.replace(/_/g, " ")} is ${primaryTask.status}; ${readyTaskIds.length} ready, ${blockedTaskIds.length} blocked/reserved.`,
    nextStep: primaryTask.nextStep,
  };
}
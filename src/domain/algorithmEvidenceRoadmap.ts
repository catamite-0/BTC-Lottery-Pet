export type AlgorithmEvidenceRoadmapPhaseId =
  | "consensus_guardrail"
  | "local_power_baseline"
  | "useful_hash_density"
  | "network_telemetry_history"
  | "search_space_work_leases"
  | "external_work_validation"
  | "direct_protocol_selection"
  | "research_frontier_filter";

export type AlgorithmEvidenceRoadmapStatus = "done" | "ready" | "waiting" | "blocked" | "reserved";
export type AlgorithmEvidenceRoadmapImpact = "safety" | "power" | "efficiency" | "hashrate" | "hardware";

export interface AlgorithmEvidenceRoadmapGateLike {
  id: string;
  status: "passed" | "waiting" | "blocked" | "reserved";
  summary: string;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapExperimentLike {
  id: string;
  status: "ready" | "waiting" | "blocked" | "reserved" | "done";
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapResearchLike {
  productionIdeaIds: string[];
  experimentIdeaIds: string[];
  decisionOnlyIdeaIds?: string[];
  rejectedIdeaIds: string[];
  runtimeIdeaIds?: string[];
  dryRunIdeaIds?: string[];
  telemetryIdeaIds?: string[];
  offlineIdeaIds?: string[];
  primaryExperimentIdea: { id: string; routeable: boolean; nextStep: string } | null;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapResearchPromotionGateLike {
  status: "clear" | "review_required";
  frontierPromotionAllowed: boolean;
  blockedSourceIds: string[];
  summary: string;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapDensityHeadroomLike {
  status: string;
  summary: string;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapDensityMarginalLike {
  status: string;
  summary: string;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapDensityLike {
  readinessScore: number;
  readyForLongRun: boolean;
  primaryMissingGate: { id: string; status: string; summary: string; nextStep: string } | null;
  hashrateHeadroom?: AlgorithmEvidenceRoadmapDensityHeadroomLike | null;
  marginalDecision?: AlgorithmEvidenceRoadmapDensityMarginalLike | null;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmapInput {
  researchReview: AlgorithmEvidenceRoadmapResearchLike;
  primaryExperiment: AlgorithmEvidenceRoadmapExperimentLike;
  readinessScore: number;
  readyForUnattendedLocal: boolean;
  readyForExternalDryRun: boolean;
  readyForExternalMining: boolean;
  readinessGates: AlgorithmEvidenceRoadmapGateLike[];
  densityPlan: AlgorithmEvidenceRoadmapDensityLike;
  researchPromotionGate?: AlgorithmEvidenceRoadmapResearchPromotionGateLike | null;
}

export interface AlgorithmEvidenceRoadmapPhase {
  id: AlgorithmEvidenceRoadmapPhaseId;
  status: AlgorithmEvidenceRoadmapStatus;
  impact: AlgorithmEvidenceRoadmapImpact;
  objective: string;
  evidence: string;
  unlocks: string;
  nextStep: string;
}

export interface AlgorithmEvidenceRoadmap {
  phases: AlgorithmEvidenceRoadmapPhase[];
  primaryPhase: AlgorithmEvidenceRoadmapPhase;
  readyPhaseIds: AlgorithmEvidenceRoadmapPhaseId[];
  blockedPhaseIds: AlgorithmEvidenceRoadmapPhaseId[];
  completionScore: number;
  localLongRunReady: boolean;
  externalDryRunReady: boolean;
  externalMiningAllowed: false;
  summary: string;
  nextStep: string;
}

function gate(input: AlgorithmEvidenceRoadmapInput, id: string) {
  return input.readinessGates.find((candidate) => candidate.id === id) ?? null;
}

function gateStatus(input: AlgorithmEvidenceRoadmapInput, id: string): AlgorithmEvidenceRoadmapStatus {
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

function experimentStatus(status: AlgorithmEvidenceRoadmapExperimentLike["status"]): AlgorithmEvidenceRoadmapStatus {
  switch (status) {
    case "done":
      return "done";
    case "ready":
      return "ready";
    case "blocked":
      return "blocked";
    case "reserved":
      return "reserved";
    case "waiting":
      return "waiting";
  }
}

function phase(args: AlgorithmEvidenceRoadmapPhase): AlgorithmEvidenceRoadmapPhase {
  return args;
}

function firstGateEvidence(input: AlgorithmEvidenceRoadmapInput, ids: string[]) {
  for (const id of ids) {
    const candidate = gate(input, id);
    if (candidate && candidate.status !== "passed") {
      return candidate;
    }
  }
  return ids.map((id) => gate(input, id)?.summary).filter(Boolean).join(" ") || "Evidence is complete.";
}

function firstGateNextStep(input: AlgorithmEvidenceRoadmapInput, ids: string[]) {
  const evidence = firstGateEvidence(input, ids);
  if (typeof evidence === "string") {
    return "Keep this gate covered by regression and runtime diagnostics.";
  }
  return evidence.nextStep;
}

function localBaselineStatus(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmapStatus {
  if (input.readyForUnattendedLocal) {
    return "done";
  }
  const ids = ["measured_power", "share_quality", "stability_window", "thermal_safety"];
  if (ids.some((id) => gateStatus(input, id) === "blocked")) {
    return "blocked";
  }
  return input.primaryExperiment.id === "capture_local_baseline" || input.primaryExperiment.id === "measure_local_power"
    ? experimentStatus(input.primaryExperiment.status)
    : "waiting";
}

function searchLeaseStatus(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmapStatus {
  const search = gateStatus(input, "search_space_lease");
  if (search !== "done") {
    return search;
  }
  return input.readyForExternalDryRun ? "done" : "ready";
}

function externalWorkStatus(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmapStatus {
  if (input.readyForExternalMining) {
    return "done";
  }
  const status = gateStatus(input, "external_work_validation");
  if (status === "waiting" && input.readyForExternalDryRun) {
    return "ready";
  }
  return status;
}

function phaseRank(status: AlgorithmEvidenceRoadmapStatus) {
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

function completionValue(status: AlgorithmEvidenceRoadmapStatus) {
  switch (status) {
    case "done":
      return 1;
    case "ready":
      return 0.75;
    case "waiting":
      return 0.35;
    case "reserved":
      return 0.2;
    case "blocked":
      return 0.1;
  }
}

function densityNeedsMarginalMeasure(input: AlgorithmEvidenceRoadmapInput) {
  const marginalStatus = input.densityPlan.marginalDecision?.status;
  if (marginalStatus) {
    return marginalStatus === "measure";
  }
  return input.densityPlan.hashrateHeadroom?.status === "waiting";
}

function usefulHashDensityStatus(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmapStatus {
  if (input.densityPlan.primaryMissingGate?.status === "blocked") {
    return "blocked";
  }
  if (!input.densityPlan.readyForLongRun || densityNeedsMarginalMeasure(input)) {
    return "waiting";
  }
  return "done";
}

function usefulHashDensityEvidence(input: AlgorithmEvidenceRoadmapInput) {
  if (input.densityPlan.primaryMissingGate) {
    return input.densityPlan.primaryMissingGate.summary;
  }
  if (densityNeedsMarginalMeasure(input)) {
    return input.densityPlan.marginalDecision?.summary ?? input.densityPlan.hashrateHeadroom?.summary ?? "Marginal hash-density decision needs measurement.";
  }
  if (input.densityPlan.marginalDecision && input.densityPlan.marginalDecision.status !== "none") {
    return input.densityPlan.marginalDecision.summary;
  }
  return `Density readiness ${input.densityPlan.readinessScore}%.`;
}

function usefulHashDensityNextStep(input: AlgorithmEvidenceRoadmapInput) {
  if (input.densityPlan.primaryMissingGate) {
    return input.densityPlan.primaryMissingGate.nextStep;
  }
  if (densityNeedsMarginalMeasure(input)) {
    return input.densityPlan.marginalDecision?.nextStep ?? input.densityPlan.hashrateHeadroom?.nextStep ?? "Measure marginal hashes per watt before raising the power envelope.";
  }
  if (input.densityPlan.marginalDecision && input.densityPlan.marginalDecision.status !== "none") {
    return input.densityPlan.marginalDecision.nextStep;
  }
  return input.densityPlan.nextStep;
}

function researchDeploymentEvidence(input: AlgorithmEvidenceRoadmapInput) {
  const runtime = input.researchReview.runtimeIdeaIds?.length ?? 0;
  const dryRun = input.researchReview.dryRunIdeaIds?.length ?? 0;
  const telemetry = input.researchReview.telemetryIdeaIds?.length ?? 0;
  const offline = input.researchReview.offlineIdeaIds?.length ?? 0;
  if (runtime + dryRun + telemetry + offline > 0) {
    return `${runtime} runtime ideas, ${dryRun} dry-run ideas, ${telemetry} telemetry ideas, ${offline} offline ideas, ${input.researchReview.decisionOnlyIdeaIds?.length ?? 0} decision-only ideas, ${input.researchReview.rejectedIdeaIds.length} rejected ideas.`;
  }
  return `${input.researchReview.productionIdeaIds.length} production ideas, ${input.researchReview.experimentIdeaIds.length} experiment ideas, ${input.researchReview.decisionOnlyIdeaIds?.length ?? 0} decision-only ideas, ${input.researchReview.rejectedIdeaIds.length} rejected ideas.`;
}


function researchFrontierStatus(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmapStatus {
  if (input.researchPromotionGate?.frontierPromotionAllowed === false) {
    return "blocked";
  }
  return input.researchReview.rejectedIdeaIds.length >= 2 ? "done" : "waiting";
}

function researchFrontierEvidence(input: AlgorithmEvidenceRoadmapInput) {
  if (input.researchPromotionGate?.frontierPromotionAllowed === false) {
    const blocked = input.researchPromotionGate.blockedSourceIds.length > 0
      ? ` Blocked sources: ${input.researchPromotionGate.blockedSourceIds.join(", ")}.`
      : "";
    return `${input.researchPromotionGate.summary}${blocked}`;
  }
  return researchDeploymentEvidence(input);
}

function researchFrontierNextStep(input: AlgorithmEvidenceRoadmapInput) {
  if (input.researchPromotionGate?.frontierPromotionAllowed === false) {
    return input.researchPromotionGate.nextStep;
  }
  return input.researchReview.nextStep;
}

export function deriveAlgorithmEvidenceRoadmap(input: AlgorithmEvidenceRoadmapInput): AlgorithmEvidenceRoadmap {
  const localEvidence = firstGateEvidence(input, ["measured_power", "share_quality", "stability_window", "thermal_safety"]);
  const localNextStep = typeof localEvidence === "string" ? input.primaryExperiment.nextStep : localEvidence.nextStep;
  const searchEvidence = firstGateEvidence(input, ["search_space_lease"]);
  const externalEvidence = firstGateEvidence(input, ["external_efficiency_history", "search_space_lease", "external_work_validation"]);
  const direct = gate(input, "direct_protocol");
  const phases = [
    phase({
      id: "consensus_guardrail",
      status: gateStatus(input, "consensus_midstate"),
      impact: "safety",
      objective: "Keep Bitcoin consensus hashing unchanged while optimizing preparation and routing.",
      evidence: gate(input, "consensus_midstate")?.summary ?? "Consensus guardrail is waiting for evidence.",
      unlocks: "All later optimization remains valid only if this gate stays green.",
      nextStep: gate(input, "consensus_midstate")?.nextStep ?? "Verify midstate/full-header equivalence.",
    }),
    phase({
      id: "local_power_baseline",
      status: localBaselineStatus(input),
      impact: "power",
      objective: "Capture a local profile with measured watts, useful shares, stability, and thermal safety.",
      evidence: typeof localEvidence === "string" ? localEvidence : localEvidence.summary,
      unlocks: "Local unattended mode and fair J/TH comparison against external hardware.",
      nextStep: localNextStep,
    }),
    phase({
      id: "useful_hash_density",
      status: usefulHashDensityStatus(input),
      impact: "efficiency",
      objective: "Select the highest useful hashrate that fits the measured power and quality envelope.",
      evidence: usefulHashDensityEvidence(input),
      unlocks: "A stable operating point for lowest watts, best J/TH, balanced, or max hashrate profiles.",
      nextStep: usefulHashDensityNextStep(input),
    }),
    phase({
      id: "network_telemetry_history",
      status: gateStatus(input, "external_efficiency_history"),
      impact: "hardware",
      objective: "Build a cool or warm external ASIC telemetry history before trusting external efficiency.",
      evidence: gate(input, "external_efficiency_history")?.summary ?? "External telemetry history is waiting.",
      unlocks: "External J/TH comparison without enabling external work submission.",
      nextStep: gate(input, "external_efficiency_history")?.nextStep ?? "Collect network hashrate, watts, and thermal telemetry.",
    }),
    phase({
      id: "search_space_work_leases",
      status: searchLeaseStatus(input),
      impact: "hashrate",
      objective: "Prove version rolling, nTime/extranonce partitioning, or equivalent unique work leases for high-hash devices.",
      evidence: typeof searchEvidence === "string" ? searchEvidence : searchEvidence.summary,
      unlocks: "External high-hash dry-run validation without duplicate or exhausted work.",
      nextStep: typeof searchEvidence === "string" ? input.researchReview.nextStep : searchEvidence.nextStep,
    }),
    phase({
      id: "external_work_validation",
      status: externalWorkStatus(input),
      impact: "hardware",
      objective: "Validate job lifecycle, stale-job rejection, thermal limits, and share accounting before any external start().",
      evidence: typeof externalEvidence === "string" ? externalEvidence : externalEvidence.summary,
      unlocks: "Future external mining engine eligibility; real mining start still remains release-gated.",
      nextStep: typeof externalEvidence === "string" ? input.primaryExperiment.nextStep : externalEvidence.nextStep,
    }),
    phase({
      id: "direct_protocol_selection",
      status: direct?.status === "passed" ? "done" : direct?.status ?? "waiting",
      impact: "hardware",
      objective: "Keep Direct hardware reserved until a serial, USB, HID, or vendor protocol exists.",
      evidence: direct?.summary ?? "Direct protocol is not selected.",
      unlocks: "Read-only Direct telemetry probing after hardware exists.",
      nextStep: direct?.nextStep ?? "Choose the Direct endpoint only after a physical device is available.",
    }),
    phase({
      id: "research_frontier_filter",
      status: researchFrontierStatus(input),
      impact: "safety",
      objective: "Keep production routes separated from lab-only hypotheses, stale frontier claims, and rejected shortcuts.",
      evidence: researchFrontierEvidence(input),
      unlocks: "New papers can be evaluated without changing pool-submitted proof-of-work semantics.",
      nextStep: researchFrontierNextStep(input),
    }),
  ];
  const primaryPhase = phases.slice().sort((left, right) => phaseRank(left.status) - phaseRank(right.status))[0] ?? phases[0];
  const readyPhaseIds = phases.filter((item) => item.status === "ready").map((item) => item.id);
  const blockedPhaseIds = phases.filter((item) => item.status === "blocked" || item.status === "reserved").map((item) => item.id);
  const completionScore = Math.round(phases.reduce((total, item) => total + completionValue(item.status), 0) * 100 / phases.length);

  return {
    phases,
    primaryPhase,
    readyPhaseIds,
    blockedPhaseIds,
    completionScore,
    localLongRunReady: input.readyForUnattendedLocal && input.densityPlan.readyForLongRun,
    externalDryRunReady: input.readyForExternalDryRun,
    externalMiningAllowed: false,
    summary: `Evidence roadmap ${completionScore}%: primary ${primaryPhase.id.replace(/_/g, " ")} is ${primaryPhase.status}; external mining remains release-gated.`,
    nextStep: primaryPhase.nextStep,
  };
}

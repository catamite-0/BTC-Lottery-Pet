export type HashHardwareAcquisitionInterface = "network" | "direct" | "unknown";
export type HashHardwareAcquisitionGoal = "lowest_power" | "max_efficiency" | "max_hashrate" | "balanced";
export type HashHardwareAcquisitionDecision =
  | "reject"
  | "watch"
  | "telemetry_candidate"
  | "dry_run_candidate"
  | "release_candidate";
export type HashHardwareAcquisitionEfficiencyClass = "unknown" | "weak" | "acceptable" | "strong" | "excellent";
export type HashHardwareAcquisitionInterfaceStage =
  | "missing"
  | "direct_reserved"
  | "network_telemetry"
  | "dry_run"
  | "release_review";
export type HashHardwareDirectEndpointKind = "serial" | "usb" | "hid" | "path" | "unknown";

export interface HashHardwareAcquisitionCandidate {
  label?: string | null;
  interfaceKind: HashHardwareAcquisitionInterface;
  directEndpointKind?: HashHardwareDirectEndpointKind | null;
  hashrate?: number | null;
  watts?: number | null;
  joulesPerTerahash?: number | null;
  canReadTelemetry?: boolean | null;
  canReadPowerTelemetry?: boolean | null;
  canControlJobs?: boolean | null;
  canSubmitShares?: boolean | null;
  supportsVersionRolling?: boolean | null;
  supportsWorkPartitioning?: boolean | null;
  noiseDba?: number | null;
  purchaseCostUsd?: number | null;
}

export interface HashHardwareAcquisitionInput {
  candidate: HashHardwareAcquisitionCandidate;
  goal?: HashHardwareAcquisitionGoal | null;
  maxWatts?: number | null;
  maxNoiseDba?: number | null;
  referenceJoulesPerTerahash?: number | null;
}

export interface HashHardwareAcquisitionAssessment {
  schemaVersion: 1;
  decision: HashHardwareAcquisitionDecision;
  goal: HashHardwareAcquisitionGoal;
  score: number;
  efficiencyClass: HashHardwareAcquisitionEfficiencyClass;
  interfaceStage: HashHardwareAcquisitionInterfaceStage;
  releaseReady: boolean;
  miningStartAllowed: false;
  hashrate: number | null;
  watts: number | null;
  joulesPerTerahash: number | null;
  wattsPerTerahash: number | null;
  costPerTerahash: number | null;
  riskFlags: string[];
  requiredEvidence: string[];
  summary: string;
  nextStep: string;
}

const HASHES_PER_TH = 1_000_000_000_000;

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeGoal(goal: HashHardwareAcquisitionGoal | null | undefined): HashHardwareAcquisitionGoal {
  return goal === "lowest_power" || goal === "max_efficiency" || goal === "max_hashrate" ? goal : "balanced";
}

function normalizeHashrate(candidate: HashHardwareAcquisitionCandidate) {
  return finitePositive(candidate.hashrate) ? Number(candidate.hashrate) : null;
}

function normalizeWatts(candidate: HashHardwareAcquisitionCandidate, hashrate: number | null) {
  if (finitePositive(candidate.watts)) {
    return Number(candidate.watts);
  }
  if (finitePositive(candidate.joulesPerTerahash) && finitePositive(hashrate)) {
    return Number(candidate.joulesPerTerahash) * (Number(hashrate) / HASHES_PER_TH);
  }
  return null;
}

function normalizeJoulesPerTerahash(
  candidate: HashHardwareAcquisitionCandidate,
  hashrate: number | null,
  watts: number | null,
) {
  if (finitePositive(candidate.joulesPerTerahash)) {
    return Number(candidate.joulesPerTerahash);
  }
  if (finitePositive(hashrate) && finitePositive(watts)) {
    return Number(watts) * HASHES_PER_TH / Number(hashrate);
  }
  return null;
}

function wattsPerTerahash(watts: number | null, hashrate: number | null) {
  if (!finitePositive(watts) || !finitePositive(hashrate)) {
    return null;
  }
  return Number(watts) / (Number(hashrate) / HASHES_PER_TH);
}

function costPerTerahash(cost: number | null | undefined, hashrate: number | null) {
  if (!finitePositive(cost) || !finitePositive(hashrate)) {
    return null;
  }
  return Number(cost) / (Number(hashrate) / HASHES_PER_TH);
}

function classifyEfficiency(
  joulesPerTerahash: number | null,
  referenceJoulesPerTerahash: number | null | undefined,
): HashHardwareAcquisitionEfficiencyClass {
  if (!finitePositive(joulesPerTerahash)) {
    return "unknown";
  }

  const value = Number(joulesPerTerahash);
  if (finitePositive(referenceJoulesPerTerahash)) {
    const reference = Number(referenceJoulesPerTerahash);
    if (value <= reference * 0.75) {
      return "excellent";
    }
    if (value <= reference) {
      return "strong";
    }
    if (value <= reference * 1.5) {
      return "acceptable";
    }
    return "weak";
  }

  if (value <= 18) {
    return "excellent";
  }
  if (value <= 30) {
    return "strong";
  }
  if (value <= 60) {
    return "acceptable";
  }
  return "weak";
}

function deriveInterfaceStage(candidate: HashHardwareAcquisitionCandidate): HashHardwareAcquisitionInterfaceStage {
  if (candidate.interfaceKind === "direct") {
    return "direct_reserved";
  }
  if (candidate.interfaceKind !== "network" || candidate.canReadTelemetry !== true) {
    return "missing";
  }
  if (
    candidate.canControlJobs === true &&
    candidate.supportsVersionRolling === true &&
    candidate.supportsWorkPartitioning === true &&
    candidate.canSubmitShares === true
  ) {
    return "release_review";
  }
  if (
    candidate.canControlJobs === true &&
    candidate.supportsVersionRolling === true &&
    candidate.supportsWorkPartitioning === true
  ) {
    return "dry_run";
  }
  return "network_telemetry";
}

function efficiencyScore(efficiencyClass: HashHardwareAcquisitionEfficiencyClass) {
  switch (efficiencyClass) {
    case "excellent":
      return 100;
    case "strong":
      return 84;
    case "acceptable":
      return 62;
    case "weak":
      return 20;
    case "unknown":
      return 35;
  }
}

function interfaceScore(stage: HashHardwareAcquisitionInterfaceStage) {
  switch (stage) {
    case "release_review":
      return 92;
    case "dry_run":
      return 76;
    case "network_telemetry":
      return 58;
    case "direct_reserved":
      return 38;
    case "missing":
      return 20;
  }
}

function powerScore(watts: number | null) {
  if (!finitePositive(watts)) {
    return 35;
  }
  const value = Number(watts);
  if (value <= 25) {
    return 100;
  }
  if (value <= 250) {
    return 86 - ((value - 25) / 225) * 24;
  }
  if (value <= 1_500) {
    return 62 - ((value - 250) / 1_250) * 34;
  }
  return Math.max(8, 28 - Math.log10(value / 1_500 + 1) * 14);
}

function hashrateScore(hashrate: number | null) {
  if (!finitePositive(hashrate)) {
    return 15;
  }
  const terahash = Number(hashrate) / HASHES_PER_TH;
  return clampScore(Math.log10(terahash + 1) / Math.log10(500 + 1) * 100);
}

function scoreFor(
  goal: HashHardwareAcquisitionGoal,
  scores: { efficiency: number; power: number; hashrate: number; interfaceReadiness: number },
) {
  switch (goal) {
    case "lowest_power":
      return scores.power * 0.36 + scores.efficiency * 0.32 + scores.interfaceReadiness * 0.22 + scores.hashrate * 0.10;
    case "max_efficiency":
      return scores.efficiency * 0.42 + scores.interfaceReadiness * 0.24 + scores.power * 0.20 + scores.hashrate * 0.14;
    case "max_hashrate":
      return scores.hashrate * 0.42 + scores.interfaceReadiness * 0.26 + scores.efficiency * 0.20 + scores.power * 0.12;
    case "balanced":
      return scores.efficiency * 0.30 + scores.interfaceReadiness * 0.28 + scores.power * 0.22 + scores.hashrate * 0.20;
  }
}

function riskFlagsFor(args: {
  candidate: HashHardwareAcquisitionCandidate;
  hashrate: number | null;
  watts: number | null;
  joulesPerTerahash: number | null;
  efficiencyClass: HashHardwareAcquisitionEfficiencyClass;
  maxWatts: number | null | undefined;
  maxNoiseDba: number | null | undefined;
}) {
  const { candidate } = args;
  const risks: string[] = [];

  if (!finitePositive(args.hashrate)) {
    risks.push("Hashrate is missing; the device cannot be compared for SHA-256 work.");
  }
  if (!finitePositive(args.watts) || !finitePositive(args.joulesPerTerahash)) {
    risks.push("Power or J/TH evidence is missing; low-power claims are only provisional.");
  }
  if (args.efficiencyClass === "weak") {
    risks.push("Efficiency is weak for the selected reference and should not be treated as a low-power route.");
  }
  if (candidate.interfaceKind === "unknown") {
    risks.push("Interface is unknown; choose Network telemetry or reserved Direct before integration.");
  }
  if (candidate.interfaceKind === "direct") {
    risks.push("Direct interface is reserved until the physical port, framing, and read-only protocol are proven.");
  }
  if (candidate.interfaceKind === "network" && candidate.canReadTelemetry !== true) {
    risks.push("Network telemetry is not proven; start with read-only endpoint access.");
  }
  if (candidate.canReadPowerTelemetry !== true) {
    risks.push("Power telemetry is missing; use measured wall power before ranking efficiency.");
  }
  if (candidate.canControlJobs !== true) {
    risks.push("Job control is missing; the device can only be a telemetry reference.");
  }
  if (candidate.supportsVersionRolling !== true) {
    risks.push("Version rolling is not proven; high-hash search space may be too small.");
  }
  if (candidate.supportsWorkPartitioning !== true) {
    risks.push("Work partitioning is not proven; external workers could duplicate work.");
  }
  if (candidate.canSubmitShares !== true) {
    risks.push("Share submission is not proven; real pool work must stay blocked.");
  }
  if (finitePositive(args.maxWatts) && finitePositive(args.watts) && Number(args.watts) > Number(args.maxWatts)) {
    risks.push("Power draw exceeds the configured hardware budget.");
  }
  if (finitePositive(args.maxNoiseDba) && finitePositive(candidate.noiseDba) && Number(candidate.noiseDba) > Number(args.maxNoiseDba)) {
    risks.push("Noise exceeds the configured hardware budget.");
  }
  if (!finitePositive(candidate.purchaseCostUsd)) {
    risks.push("Purchase cost is missing; cost per TH cannot be compared.");
  }

  return risks;
}

function requiredEvidenceFor(candidate: HashHardwareAcquisitionCandidate, stage: HashHardwareAcquisitionInterfaceStage) {
  const evidence = new Set<string>([
    "device_identity",
    "wall_power_sample",
    "thermal_noise_sample",
  ]);

  if (candidate.interfaceKind === "network") {
    evidence.add("network_endpoint_access");
    evidence.add("telemetry_schema");
  }

  if (candidate.interfaceKind === "direct") {
    evidence.add("direct_read_only_probe");
    evidence.add("direct_protocol_contract");
  }

  if (stage === "dry_run" || stage === "release_review") {
    evidence.add("job_lifecycle_dry_run");
    evidence.add("unique_search_space_assignment");
    evidence.add("stale_job_rejection");
  }

  if (candidate.canSubmitShares !== true) {
    evidence.add("share_submission_dry_run");
  }

  evidence.add("manual_release_review");
  return Array.from(evidence);
}

function hasHardConstraintFailure(riskFlags: string[]) {
  return riskFlags.some((risk) => /exceeds the configured hardware budget|Efficiency is weak/i.test(risk));
}

function decisionFor(args: {
  stage: HashHardwareAcquisitionInterfaceStage;
  efficiencyClass: HashHardwareAcquisitionEfficiencyClass;
  releaseReady: boolean;
  riskFlags: string[];
}) {
  if (hasHardConstraintFailure(args.riskFlags)) {
    return "reject";
  }
  if (args.efficiencyClass === "unknown") {
    return "watch";
  }
  if (args.stage === "release_review" && args.releaseReady) {
    return "release_candidate";
  }
  if (args.stage === "dry_run") {
    return "dry_run_candidate";
  }
  if (args.stage === "network_telemetry") {
    return "telemetry_candidate";
  }
  return "watch";
}

function summaryFor(args: {
  label: string;
  decision: HashHardwareAcquisitionDecision;
  stage: HashHardwareAcquisitionInterfaceStage;
  efficiencyClass: HashHardwareAcquisitionEfficiencyClass;
  joulesPerTerahash: number | null;
  watts: number | null;
}) {
  const efficiency = finitePositive(args.joulesPerTerahash)
    ? `${Number(args.joulesPerTerahash).toFixed(Number(args.joulesPerTerahash) < 100 ? 1 : 0)} J/TH`
    : "unknown J/TH";
  const watts = finitePositive(args.watts)
    ? `${Number(args.watts).toFixed(Number(args.watts) < 100 ? 1 : 0)} W`
    : "unknown watts";

  return `${args.label}: ${args.decision.replace(/_/g, " ")} on ${args.stage.replace(/_/g, " ")}; ${args.efficiencyClass} efficiency at ${efficiency}, ${watts}.`;
}

function nextStepFor(
  decision: HashHardwareAcquisitionDecision,
  stage: HashHardwareAcquisitionInterfaceStage,
  riskFlags: string[],
) {
  if (decision === "reject") {
    return "Do not integrate this device until power, noise, or efficiency constraints improve.";
  }
  if (stage === "direct_reserved") {
    return "Wait for real hardware, then choose serial, USB, HID, or vendor path and run read-only endpoint discovery first.";
  }
  if (stage === "missing") {
    return "Choose Network telemetry first, or record a Direct endpoint only after the physical device and driver are known.";
  }
  if (riskFlags.some((risk) => /Power or J\/TH/i.test(risk))) {
    return "Collect measured wall power or trusted power telemetry before comparing lowest-power routes.";
  }
  if (riskFlags.some((risk) => /Job control/i.test(risk))) {
    return "Keep this device as a telemetry reference until job lifecycle dry-runs exist.";
  }
  if (riskFlags.some((risk) => /Version rolling|Work partitioning/i.test(risk))) {
    return "Prove unique search-space assignment with version rolling, extranonce, or an equivalent protocol before dry-run work.";
  }
  if (riskFlags.some((risk) => /Share submission/i.test(risk))) {
    return "Validate share submission in dry-run evidence before any release review.";
  }
  if (decision === "release_candidate") {
    return "Prepare a manual release review; real external mining start remains disabled until a future explicit engine release flag.";
  }
  return "Keep collecting telemetry and compare it against local measured profiles.";
}

export function assessHashHardwareAcquisition(
  input: HashHardwareAcquisitionInput,
): HashHardwareAcquisitionAssessment {
  const goal = normalizeGoal(input.goal);
  const candidate = input.candidate;
  const hashrate = normalizeHashrate(candidate);
  const watts = normalizeWatts(candidate, hashrate);
  const joulesPerTerahash = normalizeJoulesPerTerahash(candidate, hashrate, watts);
  const efficiencyClass = classifyEfficiency(joulesPerTerahash, input.referenceJoulesPerTerahash);
  const interfaceStage = deriveInterfaceStage(candidate);
  const releaseReady = interfaceStage === "release_review" &&
    candidate.interfaceKind === "network" &&
    candidate.canReadTelemetry === true &&
    candidate.canReadPowerTelemetry === true &&
    candidate.canControlJobs === true &&
    candidate.canSubmitShares === true &&
    candidate.supportsVersionRolling === true &&
    candidate.supportsWorkPartitioning === true &&
    efficiencyClass !== "weak" &&
    efficiencyClass !== "unknown";
  const riskFlags = riskFlagsFor({
    candidate,
    hashrate,
    watts,
    joulesPerTerahash,
    efficiencyClass,
    maxWatts: input.maxWatts,
    maxNoiseDba: input.maxNoiseDba,
  });
  const decision = decisionFor({
    stage: interfaceStage,
    efficiencyClass,
    releaseReady,
    riskFlags,
  });
  const score = clampScore(scoreFor(goal, {
    efficiency: efficiencyScore(efficiencyClass),
    power: powerScore(watts),
    hashrate: hashrateScore(hashrate),
    interfaceReadiness: interfaceScore(interfaceStage),
  }));
  const label = candidate.label || `${candidate.interfaceKind} external hash`;

  return {
    schemaVersion: 1,
    decision,
    goal,
    score,
    efficiencyClass,
    interfaceStage,
    releaseReady,
    miningStartAllowed: false,
    hashrate,
    watts,
    joulesPerTerahash,
    wattsPerTerahash: wattsPerTerahash(watts, hashrate),
    costPerTerahash: costPerTerahash(candidate.purchaseCostUsd, hashrate),
    riskFlags,
    requiredEvidence: requiredEvidenceFor(candidate, interfaceStage),
    summary: summaryFor({
      label,
      decision,
      stage: interfaceStage,
      efficiencyClass,
      joulesPerTerahash,
      watts,
    }),
    nextStep: nextStepFor(decision, interfaceStage, riskFlags),
  };
}

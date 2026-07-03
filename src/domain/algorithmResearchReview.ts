export type AlgorithmResearchIdeaId =
  | "consensus_sha256"
  | "midstate_reuse"
  | "version_rolling_asicboost"
  | "stratum_v2_extended_jobs"
  | "telemetry_power_tuning"
  | "external_asic_autotune"
  | "thermodynamic_asic_prediction"
  | "quantum_sha256_mining"
  | "market_roi_prediction"
  | "predictive_nonce_pruning"
  | "proof_of_work_compression";

export type AlgorithmResearchIdeaStatus = "production" | "experiment" | "dry-run" | "decision-only" | "rejected";
export type AlgorithmResearchIdeaCategory = "consensus" | "hashrate" | "power" | "hardware" | "economics";
export type AlgorithmResearchDeploymentLane = "runtime" | "dry_run" | "telemetry" | "offline" | "decision" | "rejected";
export type AlgorithmResearchSourceId =
  | "bitcoin_consensus_pow"
  | "local_midstate_regression"
  | "bip320_version_bits"
  | "bip323_version_bits"
  | "stratum_v2_mining_protocol"
  | "measured_power_telemetry"
  | "thermodynamic_sha256_asic_2026"
  | "neural_asic_tpf_2026"
  | "hashprice_demand_response_2026"
  | "quantum_sha256_resource_estimates"
  | "sha256_uniform_search";
export type AlgorithmResearchSourceKind = "protocol" | "implementation" | "paper" | "measurement" | "assumption";
export type AlgorithmResearchEvidenceLevel =
  | "consensus"
  | "implementation-tested"
  | "protocol"
  | "measurement"
  | "hypothesis"
  | "economic-model"
  | "resource-estimate"
  | "assumption";
export type AlgorithmResearchFreshnessStatus =
  | "canonical"
  | "fresh"
  | "current"
  | "refresh_required"
  | "future_dated"
  | "undated";

export interface AlgorithmResearchSourceFreshness {
  sourceId: AlgorithmResearchSourceId;
  reviewedAt: string;
  publishedAt: string | null;
  ageDays: number | null;
  status: AlgorithmResearchFreshnessStatus;
  nextReviewAt: string | null;
  reason: string;
}

export interface AlgorithmResearchSource {
  id: AlgorithmResearchSourceId;
  kind: AlgorithmResearchSourceKind;
  title: string;
  publishedAt: string | null;
  url: string | null;
  evidenceLevel: AlgorithmResearchEvidenceLevel;
  productionAllowed: boolean;
  validationGate: string;
  deploymentLane: AlgorithmResearchDeploymentLane;
  summary: string;
  policy: string;
}

export interface AlgorithmResearchReviewInput {
  midstateReady: boolean;
  hasMeasuredLocalPower: boolean;
  networkTelemetryReady: boolean;
  externalEfficiencyReady: boolean;
  searchSpaceReady: boolean;
  externalWorkAssignable: boolean;
  directProtocolSelected: boolean;
  researchReviewedAt?: string | null;
}

export interface AlgorithmResearchIdeaReview {
  id: AlgorithmResearchIdeaId;
  status: AlgorithmResearchIdeaStatus;
  category: AlgorithmResearchIdeaCategory;
  routeable: boolean;
  deploymentLane: AlgorithmResearchDeploymentLane;
  sourceIds: AlgorithmResearchSourceId[];
  confidence: "high" | "medium" | "low";
  summary: string;
  evidence: string;
  nextStep: string;
}

export interface AlgorithmResearchSafetyEnvelope {
  runtimeAllowedSourceIds: AlgorithmResearchSourceId[];
  dryRunOnlySourceIds: AlgorithmResearchSourceId[];
  telemetryOnlySourceIds: AlgorithmResearchSourceId[];
  offlineOnlySourceIds: AlgorithmResearchSourceId[];
  decisionOnlySourceIds: AlgorithmResearchSourceId[];
  speculativeSourceIds: AlgorithmResearchSourceId[];
  sourceFreshness: AlgorithmResearchSourceFreshness[];
  staleFrontierSourceIds: AlgorithmResearchSourceId[];
  undatedDecisionSourceIds: AlgorithmResearchSourceId[];
  promotionBlockingSourceIds: AlgorithmResearchSourceId[];
  frontierReviewRequired: boolean;
  reviewedAt: string;
  summary: string;
}

export interface AlgorithmResearchReview {
  ideas: AlgorithmResearchIdeaReview[];
  sources: AlgorithmResearchSource[];
  sourceIds: AlgorithmResearchSourceId[];
  productionIdeaIds: AlgorithmResearchIdeaId[];
  experimentIdeaIds: AlgorithmResearchIdeaId[];
  decisionOnlyIdeaIds: AlgorithmResearchIdeaId[];
  rejectedIdeaIds: AlgorithmResearchIdeaId[];
  runtimeIdeaIds: AlgorithmResearchIdeaId[];
  dryRunIdeaIds: AlgorithmResearchIdeaId[];
  telemetryIdeaIds: AlgorithmResearchIdeaId[];
  offlineIdeaIds: AlgorithmResearchIdeaId[];
  primaryProductionIdea: AlgorithmResearchIdeaReview;
  primaryExperimentIdea: AlgorithmResearchIdeaReview | null;
  safetyEnvelope: AlgorithmResearchSafetyEnvelope;
  nextStep: string;
  summary: string;
}

export const ALGORITHM_RESEARCH_SOURCES: AlgorithmResearchSource[] = [
  {
    id: "bitcoin_consensus_pow",
    kind: "protocol",
    title: "Bitcoin consensus double SHA-256 proof-of-work",
    publishedAt: null,
    url: null,
    evidenceLevel: "consensus",
    productionAllowed: true,
    validationGate: "Full-node block-header, nBits target, and nonce semantics stay unchanged.",
    deploymentLane: "runtime",
    summary: "Consensus work stays double SHA-256 over valid block headers and target checks.",
    policy: "Never change the proof-of-work function, target semantics, or submitted header validity.",
  },
  {
    id: "local_midstate_regression",
    kind: "implementation",
    title: "HeaderWork midstate/full-header regression evidence",
    publishedAt: null,
    url: null,
    evidenceLevel: "implementation-tested",
    productionAllowed: true,
    validationGate: "Full-header and midstate-equivalent hashing tests must stay green.",
    deploymentLane: "runtime",
    summary: "Local optimization may reuse invariant SHA-256 header chunks only when equivalence tests stay green.",
    policy: "Keep midstate reuse as an implementation optimization, not as a consensus change.",
  },
  {
    id: "bip320_version_bits",
    kind: "protocol",
    title: "BIP320 nVersion bits for general purpose miner use",
    publishedAt: "2018-03-01",
    url: "https://bips.dev/320/",
    evidenceLevel: "protocol",
    productionAllowed: false,
    validationGate: "Pool/device version-rolling negotiation and unique search-space assignment must be proven.",
    deploymentLane: "dry_run",
    summary: "BIP320 reserves version bits that can extend miner search space and support version-rolling AsicBoost negotiation.",
    policy: "Use version rolling only after pool/device negotiation and unique search-space assignment are proven.",
  },
  {
    id: "bip323_version_bits",
    kind: "protocol",
    title: "BIP323 24 nVersion bits for miner nonce space",
    publishedAt: "2026-04-22",
    url: "https://bips.dev/323/",
    evidenceLevel: "protocol",
    productionAllowed: false,
    validationGate: "BIP323-style 24-bit version rolling must be negotiated, partitioned, and checked against stale or overlapping work before external mining.",
    deploymentLane: "dry_run",
    summary: "BIP323 is the draft replacement for BIP320 and expands miner nVersion nonce space from 16 to 24 bits for header-only mining.",
    policy: "Treat BIP323 as the preferred future search-space anchor for external dry-run adapters, never as nonce prediction or a consensus shortcut.",
  },
  {
    id: "stratum_v2_mining_protocol",
    kind: "protocol",
    title: "Stratum V2 Mining Protocol",
    publishedAt: null,
    url: "https://github.com/stratum-mining/sv2-spec/blob/main/05-Mining-Protocol.md",
    evidenceLevel: "protocol",
    productionAllowed: false,
    validationGate: "Dry-run job lifecycle, unique leases, stale-result rejection, and share accounting must pass.",
    deploymentLane: "dry_run",
    summary: "SV2 defines unique search-space assignment through nonce, version, nTime, standard jobs, extended jobs, and extended extranonce.",
    policy: "Treat SV2-style work control as dry-run until job lifecycle, stale rejection, and share submission are validated.",
  },
  {
    id: "measured_power_telemetry",
    kind: "measurement",
    title: "Measured local and external power telemetry",
    publishedAt: null,
    url: null,
    evidenceLevel: "measurement",
    productionAllowed: true,
    validationGate: "Measured watts or trusted device telemetry must be paired with share quality and thermals.",
    deploymentLane: "runtime",
    summary: "Lowest-power and max-efficiency claims require measured watts, hashrate, thermal state, and share quality.",
    policy: "Prefer stable measured J/TH over estimated watts for unattended local operation.",
  },
  {
    id: "thermodynamic_sha256_asic_2026",
    kind: "paper",
    title: "Toward Thermodynamic Reservoir Computing: Exploring SHA-256 ASICs as Potential Physical Substrates",
    publishedAt: "2026-01-05",
    url: "https://arxiv.org/abs/2601.01916",
    evidenceLevel: "hypothesis",
    productionAllowed: false,
    validationGate: "Independent offline replication must prove mining-work relevance before any runtime claim.",
    deploymentLane: "offline",
    summary: "The paper reports preliminary thermodynamic/timing observations and frames the idea as requiring experimental validation.",
    policy: "Use only for offline telemetry experiments; never prune nonce ranges or claim production speedups from it.",
  },
  {
    id: "neural_asic_tpf_2026",
    kind: "paper",
    title: "Speaking to Silicon: Neural Communication with Bitcoin Mining ASICs",
    publishedAt: "2026-01-17",
    url: "https://arxiv.org/abs/2601.12032",
    evidenceLevel: "hypothesis",
    productionAllowed: false,
    validationGate: "Claimed TPF/VBM gains need independent accepted-share validation without nonce pruning.",
    deploymentLane: "offline",
    summary: "The paper reports theoretical Thermodynamic Probability Filter and Virtual Block Manager claims that need independent mining-work validation.",
    policy: "Treat TPF/VBM as offline lab hypotheses; never use them to prune nonce ranges, inflate effective hashrate, or route pool-submitted work.",
  },
  {
    id: "hashprice_demand_response_2026",
    kind: "paper",
    title: "Hashprice moderates the electricity demand response of Bitcoin miners",
    publishedAt: "2026-05-30",
    url: "https://arxiv.org/abs/2606.00587",
    evidenceLevel: "economic-model",
    productionAllowed: false,
    validationGate: "Use only for operator cost/curtailment decisions, not hashrate or correctness claims.",
    deploymentLane: "decision",
    summary: "Hashprice and electricity costs influence when miners curtail load, but this is an operating economics signal rather than a hash algorithm improvement.",
    policy: "Keep revenue and energy-price policy separate from correctness, share validity, and hashrate claims.",
  },
  {
    id: "quantum_sha256_resource_estimates",
    kind: "paper",
    title: "Quantum Horizon: An evaluation of quantum computing as a threat to Bitcoin and Ethereum",
    publishedAt: "2026-06-12",
    url: "https://arxiv.org/abs/2606.14484",
    evidenceLevel: "resource-estimate",
    productionAllowed: false,
    validationGate: "Decision-only risk context; Grover mining is not a deployable proof-of-work speed path for this app.",
    deploymentLane: "decision",
    summary: "Current quantum reviews keep SHA-256 mining in strategic risk tracking, not deployable low-power mining.",
    policy: "Track for context only; never route local or external work through a quantum assumption.",
  },
  {
    id: "sha256_uniform_search",
    kind: "assumption",
    title: "SHA-256 practical uniform-search boundary",
    publishedAt: null,
    url: null,
    evidenceLevel: "assumption",
    productionAllowed: true,
    validationGate: "Submitted work must preserve full valid search coverage; pruning lowers expected hits.",
    deploymentLane: "runtime",
    summary: "Valid Bitcoin mining treats hash outputs as uniformly distributed; narrowing nonce ranges reduces coverage.",
    policy: "Reject prediction, compression, or pruning claims for pool-submitted work unless they preserve full consensus search coverage.",
  },
];

function idea(args: AlgorithmResearchIdeaReview): AlgorithmResearchIdeaReview {
  return args;
}

function measuredPowerSummary(input: AlgorithmResearchReviewInput) {
  if (input.hasMeasuredLocalPower && input.networkTelemetryReady) {
    return "Local measured power and network telemetry are both available for J/TH comparison.";
  }
  if (input.hasMeasuredLocalPower) {
    return "Local measured power is available; external telemetry is still optional evidence.";
  }
  if (input.networkTelemetryReady) {
    return "Network telemetry is available, but local measured power is still needed for fair routing.";
  }
  return "Power optimization is waiting for measured local watts or external telemetry.";
}

function productionPrimary(ideas: AlgorithmResearchIdeaReview[]) {
  return ideas.find((candidate) => candidate.id === "midstate_reuse" && candidate.status === "production" && candidate.deploymentLane === "runtime") ??
    ideas.find((candidate) => candidate.status === "production" && candidate.deploymentLane === "runtime") ??
    ideas.find((candidate) => candidate.status === "production") ??
    ideas[0];
}

function experimentPrimary(ideas: AlgorithmResearchIdeaReview[]) {
  return ideas.find((candidate) => candidate.id === "stratum_v2_extended_jobs" && candidate.routeable) ??
    ideas.find((candidate) => candidate.status === "experiment" && candidate.routeable) ??
    ideas.find((candidate) => candidate.status === "dry-run" && candidate.routeable) ??
    ideas.find((candidate) => candidate.status === "experiment") ??
    ideas.find((candidate) => candidate.status === "dry-run") ??
    null;
}

function sourceIdsByLane(sources: AlgorithmResearchSource[], lane: AlgorithmResearchDeploymentLane) {
  return sources.filter((source) => source.deploymentLane === lane).map((source) => source.id);
}

const FRONTIER_FRESH_DAYS = 45;
const FRONTIER_REVIEW_DAYS = 90;

function validDateParts(value: string | null | undefined): [number, number, number] | null {
  if (!value) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return [year, month, day];
}

function normalizeReviewDate(value: string | null | undefined): string {
  const parts = validDateParts(value);
  if (parts) {
    const [year, month, day] = parts;
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  }
  return new Date().toISOString().slice(0, 10);
}

function dateToUtcMillis(value: string): number {
  const parts = validDateParts(value);
  if (!parts) {
    return Number.NaN;
  }
  const [year, month, day] = parts;
  return Date.UTC(year, month - 1, day);
}

function addDays(value: string, days: number): string {
  const millis = dateToUtcMillis(value);
  if (!Number.isFinite(millis)) {
    return value;
  }
  return new Date(millis + days * 86_400_000).toISOString().slice(0, 10);
}

function sourceNeedsFreshnessReview(source: AlgorithmResearchSource): boolean {
  return source.evidenceLevel === "hypothesis" ||
    source.evidenceLevel === "economic-model" ||
    source.evidenceLevel === "resource-estimate";
}

function deriveSourceFreshness(
  source: AlgorithmResearchSource,
  reviewedAt: string,
): AlgorithmResearchSourceFreshness {
  if (!sourceNeedsFreshnessReview(source)) {
    return {
      sourceId: source.id,
      reviewedAt,
      publishedAt: source.publishedAt,
      ageDays: null,
      status: "canonical",
      nextReviewAt: null,
      reason: "Protocol, implementation, measurement, or consensus-boundary sources are treated as stable until their validation gate changes.",
    };
  }

  if (!source.publishedAt) {
    return {
      sourceId: source.id,
      reviewedAt,
      publishedAt: null,
      ageDays: null,
      status: "undated",
      nextReviewAt: null,
      reason: "Speculative or decision-only source has no reviewable publication date; keep it out of runtime routing.",
    };
  }

  const reviewedMillis = dateToUtcMillis(reviewedAt);
  const publishedMillis = dateToUtcMillis(source.publishedAt);
  if (!Number.isFinite(reviewedMillis) || !Number.isFinite(publishedMillis)) {
    return {
      sourceId: source.id,
      reviewedAt,
      publishedAt: source.publishedAt,
      ageDays: null,
      status: "undated",
      nextReviewAt: null,
      reason: "Speculative or decision-only source has an invalid reviewable publication date; keep it out of runtime routing.",
    };
  }
  if (publishedMillis > reviewedMillis) {
    return {
      sourceId: source.id,
      reviewedAt,
      publishedAt: source.publishedAt,
      ageDays: null,
      status: "future_dated",
      nextReviewAt: null,
      reason: "Frontier source is dated after the review snapshot; refresh with a current review before using it for planning claims.",
    };
  }

  const ageDays = Math.floor((reviewedMillis - publishedMillis) / 86_400_000);
  const nextReviewAt = addDays(source.publishedAt, FRONTIER_REVIEW_DAYS);
  if (ageDays > FRONTIER_REVIEW_DAYS) {
    return {
      sourceId: source.id,
      reviewedAt,
      publishedAt: source.publishedAt,
      ageDays,
      status: "refresh_required",
      nextReviewAt,
      reason: "Frontier source is outside the review window; refresh before using it for planning claims.",
    };
  }
  return {
    sourceId: source.id,
    reviewedAt,
    publishedAt: source.publishedAt,
    ageDays,
    status: ageDays <= FRONTIER_FRESH_DAYS ? "fresh" : "current",
    nextReviewAt,
    reason: "Frontier source is recent enough for planning context, but still cannot bypass consensus or release gates.",
  };
}

function sourceBlocksPromotion(source: AlgorithmResearchSource) {
  return source.evidenceLevel === "hypothesis" && source.deploymentLane !== "decision";
}

function deriveResearchSafetyEnvelope(
  sources: AlgorithmResearchSource[],
  reviewedAt: string,
): AlgorithmResearchSafetyEnvelope {
  const runtimeAllowedSourceIds = sources
    .filter((source) => source.productionAllowed && source.deploymentLane === "runtime")
    .map((source) => source.id);
  const dryRunOnlySourceIds = sourceIdsByLane(sources, "dry_run");
  const telemetryOnlySourceIds = sourceIdsByLane(sources, "telemetry");
  const offlineOnlySourceIds = sourceIdsByLane(sources, "offline");
  const decisionOnlySourceIds = sourceIdsByLane(sources, "decision");
  const speculativeSourceIds = sources
    .filter((source) => (
      source.evidenceLevel === "hypothesis" ||
      source.evidenceLevel === "economic-model" ||
      source.evidenceLevel === "resource-estimate"
    ))
    .map((source) => source.id);
  const sourceFreshness = sources.map((source) => deriveSourceFreshness(source, reviewedAt));
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const staleFrontierSourceIds = sourceFreshness
    .filter((source) => source.status === "refresh_required" || source.status === "future_dated")
    .map((source) => source.sourceId);
  const undatedDecisionSourceIds = sourceFreshness
    .filter((source) => source.status === "undated")
    .map((source) => source.sourceId);
  const promotionBlockingSourceIds = sourceFreshness
    .filter((source) => source.status === "refresh_required" || source.status === "future_dated" || source.status === "undated")
    .filter((freshness) => {
      const source = sourceById.get(freshness.sourceId);
      return source ? sourceBlocksPromotion(source) : false;
    })
    .map((source) => source.sourceId);
  const frontierReviewRequired = staleFrontierSourceIds.length > 0 || undatedDecisionSourceIds.length > 0;

  return {
    runtimeAllowedSourceIds,
    dryRunOnlySourceIds,
    telemetryOnlySourceIds,
    offlineOnlySourceIds,
    decisionOnlySourceIds,
    speculativeSourceIds,
    sourceFreshness,
    staleFrontierSourceIds,
    undatedDecisionSourceIds,
    promotionBlockingSourceIds,
    frontierReviewRequired,
    reviewedAt,
    summary: `Research safety envelope: runtime ${runtimeAllowedSourceIds.length}, dry-run ${dryRunOnlySourceIds.length}, telemetry ${telemetryOnlySourceIds.length}, offline ${offlineOnlySourceIds.length}, decision ${decisionOnlySourceIds.length}; speculative ${speculativeSourceIds.length}; promotion-blocking ${promotionBlockingSourceIds.length}; frontier review ${frontierReviewRequired ? "required" : "clear"}.`,
  };
}

export function deriveAlgorithmResearchReview(input: AlgorithmResearchReviewInput): AlgorithmResearchReview {
  const ideas = [
    idea({
      id: "consensus_sha256",
      status: "production",
      category: "consensus",
      routeable: true,
      deploymentLane: "runtime",
      sourceIds: ["bitcoin_consensus_pow", "sha256_uniform_search"],
      confidence: "high",
      summary: "Keep Bitcoin proof-of-work as consensus double SHA-256 over the block header.",
      evidence: "Consensus-valid shares and blocks require the unchanged header hash target check.",
      nextStep: "Reject any idea that changes the proof-of-work function or target semantics.",
    }),
    idea({
      id: "midstate_reuse",
      status: input.midstateReady ? "production" : "experiment",
      category: "hashrate",
      routeable: input.midstateReady,
      deploymentLane: input.midstateReady ? "runtime" : "offline",
      sourceIds: ["bitcoin_consensus_pow", "local_midstate_regression", "sha256_uniform_search"],
      confidence: input.midstateReady ? "high" : "medium",
      summary: "Reuse the first SHA-256 chunk midstate and only vary the nonce/tail work.",
      evidence: input.midstateReady
        ? "HeaderWork midstate checks are available for local CPU/GPU mining."
        : "Midstate reuse needs regression proof against full-header hashing.",
      nextStep: input.midstateReady
        ? "Keep midstate/full-header equivalence in regression tests."
        : "Restore full-header comparison before trusting local optimization.",
    }),
    idea({
      id: "version_rolling_asicboost",
      status: input.searchSpaceReady ? "dry-run" : "experiment",
      category: "hashrate",
      routeable: input.searchSpaceReady,
      deploymentLane: input.searchSpaceReady ? "dry_run" : "offline",
      sourceIds: ["bip320_version_bits", "bip323_version_bits", "stratum_v2_mining_protocol", "sha256_uniform_search"],
      confidence: input.searchSpaceReady ? "high" : "medium",
      summary: "Use BIP320/BIP323 version rolling and AsicBoost-style message-schedule reuse only when the pool/device exposes safe controls.",
      evidence: input.searchSpaceReady
        ? "Search-space and work-lease readiness are proven."
        : "Nonce-only search space can be exhausted too quickly by high-hash devices.",
      nextStep: input.searchSpaceReady
        ? "Keep lease uniqueness checks before any external high-hash route."
        : "Prove BIP320/BIP323 version rolling or equivalent partitioning before chasing external throughput.",
    }),
    idea({
      id: "stratum_v2_extended_jobs",
      status: input.externalWorkAssignable ? "dry-run" : "experiment",
      category: "hardware",
      routeable: input.externalWorkAssignable,
      deploymentLane: input.externalWorkAssignable ? "dry_run" : "offline",
      sourceIds: ["stratum_v2_mining_protocol"],
      confidence: input.externalWorkAssignable ? "medium" : "low",
      summary: "Use Stratum V2-style extended jobs or equivalent leases as the future external ASIC work-control path.",
      evidence: input.externalWorkAssignable
        ? "The adapter can assign dry-run work leases, but real mining start remains release-gated."
        : "Job control, share submission, and unique work leases are not proven yet.",
      nextStep: input.externalWorkAssignable
        ? "Validate stale-job rejection and accepted/rejected mock share accounting before real hardware control."
        : "Keep network hardware in telemetry mode until job lifecycle and share submission are proven.",
    }),
    idea({
      id: "telemetry_power_tuning",
      status: input.hasMeasuredLocalPower || input.networkTelemetryReady ? "production" : "experiment",
      category: "power",
      routeable: input.hasMeasuredLocalPower || input.networkTelemetryReady,
      deploymentLane: input.hasMeasuredLocalPower ? "runtime" : input.networkTelemetryReady ? "telemetry" : "offline",
      sourceIds: ["measured_power_telemetry", "hashprice_demand_response_2026"],
      confidence: input.hasMeasuredLocalPower ? "high" : input.networkTelemetryReady ? "medium" : "low",
      summary: "Optimize useful hash density with measured watts, J/TH, temperature, rejects, stales, and drops.",
      evidence: measuredPowerSummary(input),
      nextStep: input.externalEfficiencyReady
        ? "Compare non-degrading external J/TH against measured local profiles."
        : "Collect cool/warm, non-degrading efficiency samples before route changes.",
    }),
    idea({
      id: "external_asic_autotune",
      status: "experiment",
      category: "hardware",
      routeable: input.networkTelemetryReady,
      deploymentLane: input.networkTelemetryReady ? "telemetry" : "offline",
      sourceIds: ["measured_power_telemetry", "stratum_v2_mining_protocol"],
      confidence: input.networkTelemetryReady ? "medium" : "low",
      summary: "External ASIC firmware autotuning is the realistic path to much lower watts per hash.",
      evidence: input.networkTelemetryReady
        ? "Network telemetry can expose hashrate, watts, temperature, and J/TH for comparison."
        : "No external device telemetry is available on this machine yet.",
      nextStep: input.networkTelemetryReady
        ? "Build a bounded telemetry history before recommending external hardware routes."
        : input.directProtocolSelected
          ? "Choose the physical Direct protocol after hardware exists, then start read-only probing."
          : "Leave Direct reserved and use Network telemetry only when a device exists.",
    }),
    idea({
      id: "thermodynamic_asic_prediction",
      status: "experiment",
      category: "hardware",
      routeable: false,
      deploymentLane: "offline",
      sourceIds: ["thermodynamic_sha256_asic_2026", "neural_asic_tpf_2026", "sha256_uniform_search"],
      confidence: "low",
      summary: "Thermodynamic or timing-noise ASIC prediction remains lab-only research, not a mining route.",
      evidence: "Recent papers frame this as hypothesis/preliminary observation requiring validation.",
      nextStep: "Record telemetry for offline analysis only; never prune nonce ranges from this signal.",
    }),
    idea({
      id: "quantum_sha256_mining",
      status: "decision-only",
      category: "hardware",
      routeable: false,
      deploymentLane: "decision",
      sourceIds: ["quantum_sha256_resource_estimates"],
      confidence: "high",
      summary: "Fault-tolerant quantum SHA-256 mining is a research risk model, not a deployable low-power miner.",
      evidence: "Current quantum reviews separate signature risk from proof-of-work mining and keep Grover-based mining outside practical deployment.",
      nextStep: "Track quantum mining papers for risk context only; do not alter local CPU/GPU or external ASIC routing.",
    }),
    idea({
      id: "market_roi_prediction",
      status: "decision-only",
      category: "economics",
      routeable: false,
      deploymentLane: "decision",
      sourceIds: ["hashprice_demand_response_2026"],
      confidence: "medium",
      summary: "Market, price, and ROI models can guide hardware purchase timing but cannot improve SHA-256 hit rate.",
      evidence: "These models act outside the proof-of-work loop.",
      nextStep: "Keep purchase/operating-cost forecasts separate from mining correctness and hashrate claims.",
    }),
    idea({
      id: "predictive_nonce_pruning",
      status: "rejected",
      category: "consensus",
      routeable: false,
      deploymentLane: "rejected",
      sourceIds: ["sha256_uniform_search", "bitcoin_consensus_pow"],
      confidence: "high",
      summary: "Do not predict winning nonces or narrow the nonce range for real mining.",
      evidence: "SHA-256 output is treated as uniformly distributed for practical mining; pruning reduces coverage.",
      nextStep: "Use prediction only for UI simulation, never for pool-submitted work.",
    }),
    idea({
      id: "proof_of_work_compression",
      status: "rejected",
      category: "consensus",
      routeable: false,
      deploymentLane: "rejected",
      sourceIds: ["sha256_uniform_search", "bitcoin_consensus_pow"],
      confidence: "high",
      summary: "Do not claim data compression can reduce consensus SHA-256 work.",
      evidence: "Compression helps logs, telemetry, and transport payloads, not the number of valid hashes required.",
      nextStep: "Keep compression work scoped to diagnostics and telemetry storage.",
    }),
  ];
  const deploymentIdeaIds = (lane: AlgorithmResearchDeploymentLane) => ideas
    .filter((candidate) => candidate.deploymentLane === lane)
    .map((candidate) => candidate.id);
  const productionIdeaIds = ideas.filter((candidate) => candidate.status === "production").map((candidate) => candidate.id);
  const experimentIdeaIds = ideas.filter((candidate) => candidate.status === "experiment").map((candidate) => candidate.id);
  const decisionOnlyIdeaIds = ideas.filter((candidate) => candidate.status === "decision-only").map((candidate) => candidate.id);
  const rejectedIdeaIds = ideas.filter((candidate) => candidate.status === "rejected").map((candidate) => candidate.id);
  const sourceIds = Array.from(new Set(ideas.flatMap((candidate) => candidate.sourceIds)));
  const sources = ALGORITHM_RESEARCH_SOURCES.filter((source) => sourceIds.includes(source.id));
  const safetyEnvelope = deriveResearchSafetyEnvelope(sources, normalizeReviewDate(input.researchReviewedAt));
  const runtimeIdeaIds = deploymentIdeaIds("runtime");
  const dryRunIdeaIds = deploymentIdeaIds("dry_run");
  const telemetryIdeaIds = deploymentIdeaIds("telemetry");
  const offlineIdeaIds = deploymentIdeaIds("offline");
  const primaryProductionIdea = productionPrimary(ideas);
  const primaryExperimentIdea = experimentPrimary(ideas);
  const nextStep = primaryExperimentIdea?.nextStep ?? primaryProductionIdea.nextStep;

  return {
    ideas,
    sources,
    sourceIds,
    productionIdeaIds,
    experimentIdeaIds,
    decisionOnlyIdeaIds,
    rejectedIdeaIds,
    runtimeIdeaIds,
    dryRunIdeaIds,
    telemetryIdeaIds,
    offlineIdeaIds,
    primaryProductionIdea,
    primaryExperimentIdea,
    safetyEnvelope,
    nextStep,
    summary: `Research review: production ${primaryProductionIdea.id.replace(/_/g, " ")}; frontier ${primaryExperimentIdea ? primaryExperimentIdea.id.replace(/_/g, " ") : "none"}; runtime ${runtimeIdeaIds.length}, dry-run ${dryRunIdeaIds.length}, telemetry ${telemetryIdeaIds.length}; rejected ${rejectedIdeaIds.length}; sources ${sourceIds.length}. ${safetyEnvelope.summary}`,
  };
}

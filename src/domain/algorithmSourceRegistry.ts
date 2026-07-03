import {
  ALGORITHM_RESEARCH_SOURCES,
  type AlgorithmResearchDeploymentLane,
  type AlgorithmResearchEvidenceLevel,
  type AlgorithmResearchSourceId,
  type AlgorithmResearchSourceKind,
} from "./algorithmResearchReview.js";

export interface AlgorithmSourceReference {
  id: AlgorithmResearchSourceId;
  title: string;
  kind: AlgorithmResearchSourceKind;
  publishedAt: string | null;
  evidenceLevel: AlgorithmResearchEvidenceLevel;
  productionAllowed: boolean;
  deploymentLane: AlgorithmResearchDeploymentLane;
  referenceUrl: string | null;
  validationGate: string;
  sourcePolicy: string;
  consensusBoundary: string;
  algorithmImplication: string;
}

const BITCOIN_BLOCK_HEADER_REFERENCE = "https://developer.bitcoin.org/reference/block_chain.html#block-headers";

const SOURCE_BOUNDARIES: Record<
  AlgorithmResearchSourceId,
  Pick<AlgorithmSourceReference, "referenceUrl" | "consensusBoundary" | "algorithmImplication">
> = {
  bitcoin_consensus_pow: {
    referenceUrl: BITCOIN_BLOCK_HEADER_REFERENCE,
    consensusBoundary: "Submitted pool/block work remains the standard Bitcoin block-header target check.",
    algorithmImplication: "Keep production mining on full consensus-compatible double SHA-256 work.",
  },
  local_midstate_regression: {
    referenceUrl: BITCOIN_BLOCK_HEADER_REFERENCE,
    consensusBoundary: "Midstate reuse may cache invariant header work, but the submitted header hash must be unchanged.",
    algorithmImplication: "Use midstate reuse only when local equivalence and speed regression gates pass.",
  },
  bip320_version_bits: {
    referenceUrl: "https://bips.dev/320/",
    consensusBoundary: "Version rolling can extend search space only inside negotiated miner-reserved nVersion bits.",
    algorithmImplication: "Keep BIP320/AsicBoost-style search-space changes dry-run until pool/device leases are proven.",
  },
  bip323_version_bits: {
    referenceUrl: "https://bips.dev/323/",
    consensusBoundary: "BIP323-style 24-bit version rolling can expand miner nonce space only inside negotiated, non-overlapping nVersion bits.",
    algorithmImplication: "Prefer BIP323 as the future external-hash search-space anchor, but keep it dry-run until leases, stale rejection, and share accounting pass.",
  },
  stratum_v2_mining_protocol: {
    referenceUrl: "https://github.com/stratum-mining/sv2-spec/blob/main/05-Mining-Protocol.md",
    consensusBoundary: "Protocol-level work assignment must still produce valid consensus work and accepted shares.",
    algorithmImplication: "Use SV2-style work partitioning as an external adapter contract, not as an algorithm shortcut.",
  },
  measured_power_telemetry: {
    referenceUrl: null,
    consensusBoundary: "Power telemetry can tune operating policy but cannot change submitted proof-of-work.",
    algorithmImplication: "Use measured watts for lowest-power routing and release gates.",
  },
  thermodynamic_sha256_asic_2026: {
    referenceUrl: "https://arxiv.org/abs/2601.01916",
    consensusBoundary: "Thermodynamic observations cannot prune or rank real nonces for submitted mining work.",
    algorithmImplication: "Keep thermodynamic prediction research offline until independently validated against accepted shares.",
  },
  neural_asic_tpf_2026: {
    referenceUrl: "https://arxiv.org/abs/2601.12032",
    consensusBoundary: "TPF/VBM claims cannot narrow consensus SHA-256 search space for production mining.",
    algorithmImplication: "Treat neural ASIC communication claims as lab-only until independent mining-work proof exists.",
  },
  hashprice_demand_response_2026: {
    referenceUrl: "https://arxiv.org/abs/2606.00587",
    consensusBoundary: "Market timing can decide when to mine but cannot alter hash validity or expected work.",
    algorithmImplication: "Use hashprice signals for operator decisions, not hashrate or correctness claims.",
  },
  quantum_sha256_resource_estimates: {
    referenceUrl: null,
    consensusBoundary: "Quantum risk estimates separate signature migration from proof-of-work mining; they do not change local CPU/GPU/ASIC execution.",
    algorithmImplication: "Keep quantum mining as decision-only risk context; never route work through Grover or post-quantum assumptions.",
  },
  sha256_uniform_search: {
    referenceUrl: BITCOIN_BLOCK_HEADER_REFERENCE,
    consensusBoundary: "Practical mining assumes SHA-256 outputs are uniformly distributed against the target.",
    algorithmImplication: "Reject prediction, compression, and nonce-pruning shortcuts for pool-submitted work.",
  },
};

export function algorithmSourceReference(id: AlgorithmResearchSourceId): AlgorithmSourceReference {
  const source = ALGORITHM_RESEARCH_SOURCES.find((candidate) => candidate.id === id);
  if (!source) {
    throw new Error(`Unknown algorithm research source: ${id}`);
  }
  const boundary = SOURCE_BOUNDARIES[id];
  return {
    id: source.id,
    title: source.title,
    kind: source.kind,
    publishedAt: source.publishedAt,
    evidenceLevel: source.evidenceLevel,
    productionAllowed: source.productionAllowed,
    deploymentLane: source.deploymentLane,
    referenceUrl: boundary.referenceUrl ?? source.url,
    validationGate: source.validationGate,
    sourcePolicy: source.policy,
    consensusBoundary: boundary.consensusBoundary,
    algorithmImplication: boundary.algorithmImplication,
  };
}

export function algorithmSourceReferences(ids: AlgorithmResearchSourceId[]): AlgorithmSourceReference[] {
  const seen = new Set<AlgorithmResearchSourceId>();
  return ids.flatMap((id) => {
    if (seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [algorithmSourceReference(id)];
  });
}

export function allAlgorithmSourceReferences(): AlgorithmSourceReference[] {
  return ALGORITHM_RESEARCH_SOURCES.map((source) => algorithmSourceReference(source.id));
}

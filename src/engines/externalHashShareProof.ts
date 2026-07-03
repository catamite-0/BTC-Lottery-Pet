import type { ExternalHashEngineValidationInput } from "./externalHashEngineValidation.js";
import type { ExternalHashWorkLeaseAssignment } from "./externalHashWorkAdapter.js";

export type ExternalHashShareSubmissionProofSource = "external_adapter" | "mock" | "local_proxy";
export type ExternalHashShareSubmissionProofResult = "accepted" | "rejected" | "pending";

export interface ExternalHashShareSubmissionProof {
  source: ExternalHashShareSubmissionProofSource;
  result: ExternalHashShareSubmissionProofResult;
  leaseId: string;
  jobId: string;
  generation: number;
  submittedAtMs: number;
  acceptedAtMs?: number | null;
  poolDifficulty?: number | null;
  shareDifficulty?: number | null;
  summary?: string | null;
}

function finiteNonNegative(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function proofMatchesAssignment(
  assignment: ExternalHashWorkLeaseAssignment,
  proof: ExternalHashShareSubmissionProof,
) {
  return proof.leaseId === assignment.leaseId &&
    proof.jobId === assignment.jobId &&
    Math.trunc(Number(proof.generation)) === assignment.generation;
}

function proofHasAcceptedTiming(proof: ExternalHashShareSubmissionProof) {
  return finiteNonNegative(proof.submittedAtMs) &&
    finiteNonNegative(proof.acceptedAtMs) &&
    Number(proof.acceptedAtMs) >= proof.submittedAtMs;
}

function proofHasDifficulty(proof: ExternalHashShareSubmissionProof) {
  return finitePositive(proof.poolDifficulty) || finitePositive(proof.shareDifficulty);
}

function passedSummary(proof: ExternalHashShareSubmissionProof) {
  const difficulty = finitePositive(proof.shareDifficulty)
    ? `share difficulty ${Number(proof.shareDifficulty).toLocaleString("en-US")}`
    : `pool difficulty ${Number(proof.poolDifficulty).toLocaleString("en-US")}`;
  return proof.summary?.trim() ||
    `External adapter produced an accepted pool share for job ${proof.jobId} at ${difficulty}.`;
}

export function deriveExternalHashShareSubmissionValidationInputs(
  assignment: ExternalHashWorkLeaseAssignment,
  proofs: ExternalHashShareSubmissionProof[] = [],
): ExternalHashEngineValidationInput[] {
  if (!assignment.canHash || proofs.length === 0) {
    return [];
  }

  const matchingProofs = proofs.filter((proof) => proofMatchesAssignment(assignment, proof));
  const acceptedExternalProof = matchingProofs.find((proof) => (
    proof.source === "external_adapter" &&
    proof.result === "accepted" &&
    proofHasAcceptedTiming(proof) &&
    proofHasDifficulty(proof)
  ));

  if (acceptedExternalProof) {
    return [{
      kind: "share_submission",
      status: "passed",
      summary: passedSummary(acceptedExternalProof),
    }];
  }

  const rejectedExternalProof = matchingProofs.find((proof) => (
    proof.source === "external_adapter" &&
    proof.result === "rejected"
  ));
  if (rejectedExternalProof) {
    return [{
      kind: "share_submission",
      status: "failed",
      summary: rejectedExternalProof.summary?.trim() ||
        `External adapter reached pool share submission for job ${assignment.jobId}, but the pool rejected it.`,
    }];
  }

  const ignoredProof = matchingProofs[0] ?? proofs[0];
  return [{
    kind: "share_submission",
    status: "warning",
    summary: ignoredProof.source !== "external_adapter"
      ? "Share proof came from a mock or local proxy path; require an accepted external_adapter pool share."
      : "External share proof is incomplete; require matching lease, accepted result, accepted timing, and pool/share difficulty.",
  }];
}

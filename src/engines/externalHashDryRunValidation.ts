import { deriveExternalHashCapabilityMatrix } from "../domain/externalHashInterface.js";
import type { ExternalHashCapabilityMatrix, ExternalHashSnapshot } from "../domain/externalHashInterface.js";
import type { ExternalHashEngineValidationInput } from "./externalHashEngineValidation.js";
import type { ExternalHashShareSubmissionProof } from "./externalHashShareProof.js";
import { deriveExternalHashShareSubmissionValidationInputs } from "./externalHashShareProof.js";
import {
  deriveExternalHashWorkLeaseAssignment,
  evaluateExternalHashWorkResult,
} from "./externalHashWorkAdapter.js";

export interface ExternalHashDryRunValidationOptions {
  jobId?: string | null;
  generation?: number | null;
  issuedAtMs?: number | null;
  shareProofs?: ExternalHashShareSubmissionProof[] | null;
}

export function deriveExternalHashDryRunValidationInputs(
  snapshot: ExternalHashSnapshot,
  matrix: ExternalHashCapabilityMatrix = deriveExternalHashCapabilityMatrix(snapshot),
  options: ExternalHashDryRunValidationOptions = {},
): ExternalHashEngineValidationInput[] {
  const generation = Number.isFinite(Number(options.generation))
    ? Math.max(0, Math.trunc(Number(options.generation)))
    : 1;
  const issuedAtMs = Number.isFinite(Number(options.issuedAtMs))
    ? Math.max(0, Math.trunc(Number(options.issuedAtMs)))
    : 0;
  const assignment = deriveExternalHashWorkLeaseAssignment(snapshot, {
    jobId: options.jobId ?? "dry-run-validation",
    generation,
    workerIndex: 0,
    issuedAtMs,
  }, matrix);

  if (!assignment.canHash) {
    return [];
  }

  const staleResult = evaluateExternalHashWorkResult(assignment, {
    leaseId: assignment.leaseId,
    jobId: assignment.jobId,
    generation: assignment.generation + 1,
    submittedAtMs: issuedAtMs + 1_000,
    shareAccepted: true,
  });

  return [
    ...assignment.validationInputs,
    ...staleResult.validationInputs,
    ...deriveExternalHashShareSubmissionValidationInputs(assignment, options.shareProofs ?? []),
  ];
}

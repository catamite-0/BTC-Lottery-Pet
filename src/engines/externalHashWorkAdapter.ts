import { deriveExternalHashCapabilityMatrix } from "../domain/externalHashInterface.js";
import type {
  ExternalHashCapability,
  ExternalHashCapabilityMatrix,
  ExternalHashInterfaceKind,
  ExternalHashSnapshot,
} from "../domain/externalHashInterface.js";
import type { HashSearchSpaceControlKind } from "../domain/hashSearchSpace.js";
import type { ExternalHashEngineValidationInput } from "./externalHashEngineValidation.js";

export type ExternalHashWorkAdapterPlanStatus =
  | "disabled"
  | "reserved"
  | "missing-endpoint"
  | "telemetry-only"
  | "blocked"
  | "assignable";

export type ExternalHashWorkLeaseAssignmentStatus = ExternalHashWorkAdapterPlanStatus | "ready";

export type ExternalHashWorkResultStatus =
  | "blocked"
  | "unknown-lease"
  | "stale"
  | "expired"
  | "submit-allowed"
  | "share-accepted"
  | "share-rejected";

export interface ExternalHashWorkAdapterPlan {
  status: ExternalHashWorkAdapterPlanStatus;
  canAssignWork: boolean;
  interfaceKind: ExternalHashInterfaceKind;
  endpoint: string;
  requiredCapabilities: ExternalHashCapability[];
  missingCapabilities: ExternalHashCapability[];
  missingPerformanceCapabilities: ExternalHashCapability[];
  searchSpaceReady: boolean;
  workLeaseReady: boolean;
  workLeaseUtilizationRatio: number | null;
  workLeaseUniquePartitionRatio: number | null;
  workLeaseRouteUtilizationRatio: number | null;
  workLeaseWasteRisk: ExternalHashCapabilityMatrix["workLeaseWasteRisk"];
  summary: string;
  nextStep: string;
}

export interface ExternalHashWorkLeaseRequest {
  jobId?: string | null;
  generation?: number | null;
  workerIndex?: number | null;
  issuedAtMs?: number | null;
}

export interface ExternalHashWorkControlAssignment {
  kind: HashSearchSpaceControlKind;
  bits: number;
  assignment: "full-range" | "partition-prefix";
  slot: number | null;
  prefixHex: string;
  summary: string;
}

export interface ExternalHashWorkLeaseAssignment {
  status: ExternalHashWorkLeaseAssignmentStatus;
  canHash: boolean;
  leaseId: string;
  interfaceKind: ExternalHashInterfaceKind;
  endpoint: string;
  jobId: string;
  generation: number;
  workerIndex: number;
  parallelWorkers: number;
  partitionSlot: number | null;
  partitionBits: number;
  partitionPrefixHex: string;
  perWorkerBits: number;
  leaseSeconds: number | null;
  expiresAtMs: number | null;
  controls: ExternalHashWorkControlAssignment[];
  validationInputs: ExternalHashEngineValidationInput[];
  summary: string;
  nextStep: string;
}

export interface ExternalHashWorkResult {
  leaseId: string;
  jobId: string;
  generation: number;
  submittedAtMs?: number | null;
  shareAccepted?: boolean | null;
}

export interface ExternalHashWorkResultDecision {
  status: ExternalHashWorkResultStatus;
  submitAllowed: boolean;
  validationInputs: ExternalHashEngineValidationInput[];
  summary: string;
  nextStep: string;
}

const REQUIRED_WORK_CAPABILITIES: ExternalHashCapability[] = ["telemetry", "jobControl", "shareSubmission"];

function sanitizeJobId(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "external-job";
}

function sanitizeGeneration(value: number | null | undefined) {
  const numeric = Number(value);
  return Math.max(0, Math.trunc(Number.isFinite(numeric) ? numeric : 0));
}

function sanitizeIssuedAtMs(value: number | null | undefined) {
  const numeric = Number(value);
  return Math.max(0, Math.trunc(Number.isFinite(numeric) ? numeric : 0));
}

function sanitizeWorkerIndex(value: number | null | undefined, parallelWorkers: number) {
  const workerCount = Math.max(1, Math.trunc(Number(parallelWorkers) || 1));
  const numeric = Math.max(0, Math.trunc(Number(value) || 0));
  return numeric % workerCount;
}

function prefixHex(slot: number | null, bits: number) {
  if (slot === null || bits <= 0) {
    return "";
  }

  const digits = Math.max(1, Math.ceil(bits / 4));
  return Math.max(0, Math.trunc(slot)).toString(16).padStart(digits, "0").slice(-digits);
}

function stableLeaseId(parts: string[]) {
  return parts
    .join(":")
    .replace(/[^a-zA-Z0-9:_-]+/g, "-")
    .replace(/-+/g, "-");
}

function thermalValidation(snapshot: ExternalHashSnapshot): ExternalHashEngineValidationInput {
  const unsafe = snapshot.thermalStatus === "critical" || snapshot.thermalStatus === "paused";
  return {
    kind: "thermal_limits",
    status: unsafe ? "failed" : "passed",
    summary: unsafe
      ? `External adapter thermal guard is unsafe: ${snapshot.thermalSummary}`
      : `External adapter thermal guard is acceptable: ${snapshot.thermalSummary}`,
  };
}

function controlAssignments(
  matrix: ExternalHashCapabilityMatrix,
  partitionSlot: number | null,
): ExternalHashWorkControlAssignment[] {
  let remainingSlot = Math.max(0, Math.trunc(partitionSlot ?? 0));

  return matrix.workLease.searchSpace.controls.map((control) => {
    if (control.kind === "nonce" || matrix.workLease.partitionBits <= 0) {
      return {
        kind: control.kind,
        bits: control.bits,
        assignment: "full-range" as const,
        slot: null,
        prefixHex: "",
        summary: `${control.summary}; full range assigned to this worker.`,
      };
    }

    const capacity = 2 ** Math.min(control.bits, 30);
    const slot = capacity > 0 ? remainingSlot % capacity : 0;
    remainingSlot = capacity > 0 ? Math.floor(remainingSlot / capacity) : 0;
    const hex = prefixHex(slot, control.bits);

    return {
      kind: control.kind,
      bits: control.bits,
      assignment: "partition-prefix" as const,
      slot,
      prefixHex: hex,
      summary: `${control.summary}; partition prefix ${hex}.`,
    };
  });
}

export function deriveExternalHashWorkAdapterPlan(
  snapshot: ExternalHashSnapshot,
  matrix: ExternalHashCapabilityMatrix = deriveExternalHashCapabilityMatrix(snapshot),
): ExternalHashWorkAdapterPlan {
  const missingCapabilities = REQUIRED_WORK_CAPABILITIES.filter((capability) => !snapshot.capabilities.includes(capability));
  const missingPerformanceCapabilities = matrix.missingPerformanceCapabilities;
  const searchSpaceReady = matrix.searchSpaceReady;
  const workLeaseReady = matrix.workLeaseReady;
  const workLeaseWasteAcceptable = matrix.workLeaseWasteRisk !== "high";
  const base = {
    interfaceKind: snapshot.interfaceKind,
    endpoint: snapshot.endpoint,
    requiredCapabilities: REQUIRED_WORK_CAPABILITIES,
    missingCapabilities,
    missingPerformanceCapabilities,
    searchSpaceReady,
    workLeaseReady,
    workLeaseUtilizationRatio: matrix.workLeaseUtilizationRatio,
    workLeaseUniquePartitionRatio: matrix.workLeaseUniquePartitionRatio,
    workLeaseRouteUtilizationRatio: matrix.workLeaseRouteUtilizationRatio,
    workLeaseWasteRisk: matrix.workLeaseWasteRisk,
  };

  if (snapshot.interfaceKind === "none") {
    return {
      ...base,
      status: "disabled",
      canAssignWork: false,
      summary: "External work adapter is disabled.",
      nextStep: "Select Network or Direct before preparing external work leases.",
    };
  }

  if (snapshot.interfaceKind === "direct") {
    return {
      ...base,
      status: "reserved",
      canAssignWork: false,
      summary: "Direct external work adapter is reserved until the physical protocol is selected.",
      nextStep: "Keep Direct as a recorded endpoint only; define the serial, USB, or HID protocol before assigning hash work.",
    };
  }

  if (!snapshot.endpoint) {
    return {
      ...base,
      status: "missing-endpoint",
      canAssignWork: false,
      summary: "External work adapter needs a network endpoint.",
      nextStep: "Add a network host, then verify telemetry before preparing work leases.",
    };
  }

  if (!snapshot.adapter.engineEligible || missingCapabilities.length > 0) {
    return {
      ...base,
      status: snapshot.canReadTelemetry ? "telemetry-only" : "blocked",
      canAssignWork: false,
      summary: "External adapter is telemetry-only; hash work stays on the selected local or pool engine.",
      nextStep: missingCapabilities.length > 0
        ? `Prove ${missingCapabilities.join(", ")} before assigning external hash work.`
        : "Promote the adapter to hash-engine only after job control and share submission are proven.",
    };
  }

  if (missingPerformanceCapabilities.length > 0 || !searchSpaceReady || !workLeaseReady || !workLeaseWasteAcceptable) {
    return {
      ...base,
      status: "blocked",
      canAssignWork: false,
      summary: "External adapter has engine capabilities but cannot receive unique safe work leases yet.",
      nextStep: missingPerformanceCapabilities.length > 0
        ? `Prove ${missingPerformanceCapabilities.join(", ")} so workers do not overlap or exhaust their search space.`
        : matrix.workLease.summary,
    };
  }

  return {
    ...base,
    status: "assignable",
    canAssignWork: true,
    summary: "External adapter can receive mock work leases with unique partitioning.",
    nextStep: "Use mock leases to validate job lifecycle, stale-result rejection, thermal limits, and pool share submission before real hardware start().",
  };
}

export function deriveExternalHashWorkLeaseAssignment(
  snapshot: ExternalHashSnapshot,
  request: ExternalHashWorkLeaseRequest = {},
  matrix: ExternalHashCapabilityMatrix = deriveExternalHashCapabilityMatrix(snapshot),
): ExternalHashWorkLeaseAssignment {
  const plan = deriveExternalHashWorkAdapterPlan(snapshot, matrix);
  const jobId = sanitizeJobId(request.jobId);
  const generation = sanitizeGeneration(request.generation);
  const issuedAtMs = sanitizeIssuedAtMs(request.issuedAtMs);
  const parallelWorkers = Math.max(1, matrix.workLease.parallelWorkers);
  const workerIndex = sanitizeWorkerIndex(request.workerIndex, parallelWorkers);
  const partitionSlot = plan.canAssignWork && parallelWorkers > 1 ? workerIndex : null;
  const partitionBits = plan.canAssignWork ? matrix.workLease.partitionBits : 0;
  const partitionPrefix = prefixHex(partitionSlot, partitionBits);
  const leaseSeconds = plan.canAssignWork ? matrix.workLease.leaseSeconds : null;
  const expiresAtMs = leaseSeconds !== null && Number.isFinite(leaseSeconds)
    ? issuedAtMs + Math.ceil(leaseSeconds * 1_000)
    : null;
  const leaseId = plan.canAssignWork
    ? stableLeaseId([snapshot.adapter.adapterId, snapshot.endpoint || "none", jobId, `${generation}`, `${workerIndex}`, partitionPrefix || "full"])
    : "";
  const controls = plan.canAssignWork ? controlAssignments(matrix, partitionSlot) : [];
  const validationInputs: ExternalHashEngineValidationInput[] = plan.canAssignWork
    ? [
      {
        kind: "job_lifecycle",
        status: "passed",
        summary: `Mock adapter accepted job ${jobId} generation ${generation} for worker ${workerIndex + 1}/${parallelWorkers}.`,
      },
      {
        kind: "search_space_assignment",
        status: matrix.workLease.overlapRisk === "high" ? "failed" : "passed",
        summary: matrix.workLease.summary,
      },
      thermalValidation(snapshot),
    ]
    : [];

  return {
    status: plan.canAssignWork ? "ready" : plan.status,
    canHash: plan.canAssignWork,
    leaseId,
    interfaceKind: snapshot.interfaceKind,
    endpoint: snapshot.endpoint,
    jobId,
    generation,
    workerIndex,
    parallelWorkers,
    partitionSlot,
    partitionBits,
    partitionPrefixHex: partitionPrefix,
    perWorkerBits: plan.canAssignWork ? matrix.workLease.perWorkerBits : 0,
    leaseSeconds,
    expiresAtMs,
    controls,
    validationInputs,
    summary: plan.canAssignWork
      ? `Mock external lease ${partitionPrefix || "full"} gives worker ${workerIndex + 1}/${parallelWorkers} ${matrix.workLease.perWorkerBits} search bits.`
      : plan.summary,
    nextStep: plan.canAssignWork
      ? "Feed only matching job generation results back through evaluateExternalHashWorkResult()."
      : plan.nextStep,
  };
}

export function evaluateExternalHashWorkResult(
  assignment: ExternalHashWorkLeaseAssignment,
  result: ExternalHashWorkResult,
): ExternalHashWorkResultDecision {
  if (!assignment.canHash) {
    return {
      status: "blocked",
      submitAllowed: false,
      validationInputs: [],
      summary: "External result rejected because no hash lease is active.",
      nextStep: assignment.nextStep,
    };
  }

  if (result.leaseId !== assignment.leaseId) {
    return {
      status: "unknown-lease",
      submitAllowed: false,
      validationInputs: [{
        kind: "stale_job_rejection",
        status: "passed",
        summary: "Mock adapter rejected a result from an unknown lease before share submission.",
      }],
      summary: "External result rejected because the lease id does not match the active assignment.",
      nextStep: "Drop unknown external results and request fresh work from the current job generation.",
    };
  }

  if (result.jobId !== assignment.jobId || sanitizeGeneration(result.generation) !== assignment.generation) {
    return {
      status: "stale",
      submitAllowed: false,
      validationInputs: [{
        kind: "stale_job_rejection",
        status: "passed",
        summary: "Mock adapter dropped a stale job-generation result before share submission.",
      }],
      summary: "External result rejected as stale before share submission.",
      nextStep: "Request a new external work lease for the current job generation.",
    };
  }

  const submittedAtMs = sanitizeIssuedAtMs(result.submittedAtMs);
  if (assignment.expiresAtMs !== null && submittedAtMs > assignment.expiresAtMs) {
    return {
      status: "expired",
      submitAllowed: false,
      validationInputs: [{
        kind: "stale_job_rejection",
        status: "passed",
        summary: "Mock adapter dropped an expired lease result before share submission.",
      }],
      summary: "External result rejected because its work lease expired.",
      nextStep: "Use shorter polling or larger partitioned search space before routing real hardware work.",
    };
  }

  if (result.shareAccepted === true) {
    return {
      status: "share-accepted",
      submitAllowed: true,
      validationInputs: [{
        kind: "share_submission",
        status: "passed",
        summary: "Mock adapter result represents an accepted pool share on the active lease.",
      }],
      summary: "External result is current and accepted by the pool.",
      nextStep: "Keep collecting accepted-share evidence before enabling real external start().",
    };
  }

  if (result.shareAccepted === false) {
    return {
      status: "share-rejected",
      submitAllowed: true,
      validationInputs: [{
        kind: "share_submission",
        status: "failed",
        summary: "Mock adapter result reached share submission but the pool rejected it.",
      }],
      summary: "External result was current but rejected by the pool.",
      nextStep: "Inspect target, extranonce, and pool-difficulty handling before retrying external work.",
    };
  }

  return {
    status: "submit-allowed",
    submitAllowed: true,
    validationInputs: [{
      kind: "share_submission",
      status: "warning",
      summary: "Mock adapter result is current, but accepted pool submission is not proven yet.",
    }],
    summary: "External result is current and may be submitted by the owning engine.",
    nextStep: "Complete pool share-submission validation before real external mining is enabled.",
  };
}
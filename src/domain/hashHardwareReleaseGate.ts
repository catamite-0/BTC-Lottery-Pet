import type { ExternalHashEngineValidationChecklist } from "../engines/externalHashEngineValidation.js";
import type { ExternalHashHistorySummary } from "./externalHashHistory.js";
import type { ExternalHashProtocolContract } from "./externalHashInterface.js";
import type { HashHardwareOperatingEvidenceSnapshot } from "./hashHardwareOperatingEvidence.js";
import type { HashClaimCertificate } from "./hashClaimCertificate.js";

export type HashHardwareReleaseGateStatus = "blocked" | "waiting" | "release_candidate";
export type HashHardwareReleaseCheckId =
  | "protocol_contract"
  | "external_stability_history"
  | "hardware_operating_evidence"
  | "external_work_validation"
  | "claim_evidence"
  | "release_review"
  | "engine_release_flag";
export type HashHardwareReleaseCheckStatus = "passed" | "waiting" | "blocked";

export interface HashHardwareReleaseCheck {
  id: HashHardwareReleaseCheckId;
  status: HashHardwareReleaseCheckStatus;
  required: boolean;
  summary: string;
  nextStep: string;
}

export interface HashHardwareReleaseGateInput {
  protocolContract: ExternalHashProtocolContract;
  externalHistory: ExternalHashHistorySummary;
  operatingEvidence?: HashHardwareOperatingEvidenceSnapshot | null;
  validationChecklist: ExternalHashEngineValidationChecklist;
  claimCertificate: HashClaimCertificate;
  releaseReviewApproved?: boolean | null;
  engineReleaseFlagEnabled?: boolean | null;
}

export interface HashHardwareReleaseGate {
  schemaVersion: 1;
  status: HashHardwareReleaseGateStatus;
  readinessScore: number;
  releaseCandidateReady: boolean;
  miningStartAllowed: false;
  checks: HashHardwareReleaseCheck[];
  missingCheckIds: HashHardwareReleaseCheckId[];
  primaryBlockingCheck: HashHardwareReleaseCheck | null;
  summary: string;
  nextStep: string;
}
export interface HashHardwareReleaseEvidenceItem {
  id: HashHardwareReleaseCheckId;
  status: HashHardwareReleaseCheckStatus;
  required: boolean;
  evidence: string;
  missingEvidence: string | null;
  nextStep: string;
}

export interface HashHardwareReleaseEvidenceDossier {
  schemaVersion: 1;
  gateStatus: HashHardwareReleaseGateStatus;
  readinessScore: number;
  releaseCandidateReady: boolean;
  miningStartAllowed: false;
  evidenceItems: HashHardwareReleaseEvidenceItem[];
  missingEvidenceIds: HashHardwareReleaseCheckId[];
  requiredActions: string[];
  forbiddenOperations: string[];
  summary: string;
  nextStep: string;
}

function protocolCheck(contract: ExternalHashProtocolContract): HashHardwareReleaseCheck {
  if (contract.stage === "dry-run-only" && contract.allowedOperations.includes("partition_work")) {
    return {
      id: "protocol_contract",
      status: "passed",
      required: true,
      summary: "External protocol has proven enough structure for dry-run partitioned work.",
      nextStep: "Keep real mining disabled until release review and share validation evidence are complete.",
    };
  }

  if (contract.directReserved) {
    return {
      id: "protocol_contract",
      status: "blocked",
      required: true,
      summary: "Direct external hash is still a reserved physical interface.",
      nextStep: "Choose the physical Direct protocol and prove endpoint access, telemetry schema, job lifecycle, search-space assignment, stale-job rejection, thermal limits, and share submission.",
    };
  }

  if (contract.networkTelemetryOnly) {
    return {
      id: "protocol_contract",
      status: "waiting",
      required: true,
      summary: "Network external hash is telemetry-only and cannot receive app-controlled work.",
      nextStep: "Promote the adapter only after job control, unique work partitioning, stale-result rejection, thermal limits, and share submission are proven in dry-run.",
    };
  }

  return {
    id: "protocol_contract",
    status: "waiting",
    required: true,
    summary: "No release-capable external hash protocol is active.",
    nextStep: "Select Network for telemetry or keep Direct reserved until real hardware is available.",
  };
}

function externalStabilityCheck(summary: ExternalHashHistorySummary): HashHardwareReleaseCheck {
  if (summary.evidenceStatus === "stable") {
    return {
      id: "external_stability_history",
      status: "passed",
      required: true,
      summary: `${summary.usableEfficiencySampleCount} usable external efficiency samples are stable enough for release review.`,
      nextStep: "Keep sampling during dry-run validation to catch thermal or efficiency regression.",
    };
  }

  return {
    id: "external_stability_history",
    status: summary.usableEfficiencySampleCount > 0 ? "waiting" : "blocked",
    required: true,
    summary: summary.summary,
    nextStep: "Collect six cool/warm external telemetry samples with hashrate, watts, J/TH, thermals, and share counters before release review.",
  };
}
function operatingEvidenceCheck(
  evidence: HashHardwareOperatingEvidenceSnapshot | null | undefined,
): HashHardwareReleaseCheck {
  if (evidence?.releaseReady) {
    return {
      id: "hardware_operating_evidence",
      status: "passed",
      required: true,
      summary: evidence.summary,
      nextStep: evidence.nextStep,
    };
  }

  if (evidence?.status === "failed") {
    return {
      id: "hardware_operating_evidence",
      status: "blocked",
      required: true,
      summary: evidence.summary,
      nextStep: evidence.nextStep,
    };
  }

  return {
    id: "hardware_operating_evidence",
    status: "waiting",
    required: true,
    summary: evidence?.summary ?? "Hardware operating evidence is missing; wall power, thermals, noise, runtime, and share quality are not proven.",
    nextStep: evidence?.nextStep ?? "Collect a 900 second external hardware sample with wall power, cool/warm thermals, noise, and share counters.",
  };
}

function workValidationCheck(checklist: ExternalHashEngineValidationChecklist): HashHardwareReleaseCheck {
  if (checklist.integrationReady) {
    return {
      id: "external_work_validation",
      status: "passed",
      required: true,
      summary: "External work validation passed all dry-run checks.",
      nextStep: "Keep validation artifacts attached to the hardware release review.",
    };
  }

  return {
    id: "external_work_validation",
    status: checklist.status === "failed" || checklist.status === "warning" ? "blocked" : "waiting",
    required: true,
    summary: checklist.summary,
    nextStep: checklist.nextStep,
  };
}

function claimEvidenceCheck(certificate: HashClaimCertificate): HashHardwareReleaseCheck {
  const externalClaims = [certificate.lowestPower, certificate.highestHash]
    .filter((claim) => claim.scope === "external_reference");
  const hasExternalClaim = externalClaims.length > 0;
  const blockedExternalClaim = externalClaims.find((claim) => claim.status === "blocked") ?? null;
  const externalEvidenceReady = certificate.externalEvidenceReady && hasExternalClaim && !blockedExternalClaim;

  if (blockedExternalClaim) {
    return {
      id: "claim_evidence",
      status: "blocked",
      required: true,
      summary: blockedExternalClaim.summary,
      nextStep: blockedExternalClaim.nextStep,
    };
  }

  if (externalEvidenceReady) {
    return {
      id: "claim_evidence",
      status: "passed",
      required: true,
      summary: "External hash evidence is present in the low-power or high-hash claim certificate.",
      nextStep: "Do not mark the external claim allowed until release review approves real app-controlled mining.",
    };
  }

  return {
    id: "claim_evidence",
    status: hasExternalClaim ? "waiting" : "blocked",
    required: true,
    summary: certificate.summary,
    nextStep: certificate.nextStep,
  };
}

function releaseReviewCheck(priorChecksPassed: boolean, releaseReviewApproved: boolean): HashHardwareReleaseCheck {
  if (priorChecksPassed && releaseReviewApproved) {
    return {
      id: "release_review",
      status: "passed",
      required: true,
      summary: "Manual release review approved the external hardware candidate.",
      nextStep: "Wire the approved adapter through an explicit mining-engine release flag before enabling start().",
    };
  }

  return {
    id: "release_review",
    status: priorChecksPassed ? "waiting" : "blocked",
    required: true,
    summary: "Manual release review has not approved real external mining start.",
    nextStep: priorChecksPassed
      ? "Review hardware identity, wall power, thermals, work leases, stale rejection, pool share submission, and rollback behavior before enabling any real external start()."
      : "Complete the protocol, stability, operating-evidence, work-validation, and claim-evidence gates before release review.",
  };
}

function engineReleaseFlagCheck(releaseReviewPassed: boolean, engineReleaseFlagEnabled: boolean): HashHardwareReleaseCheck {
  if (!releaseReviewPassed) {
    return {
      id: "engine_release_flag",
      status: "blocked",
      required: true,
      summary: "Engine release flag cannot be wired until manual release review passes.",
      nextStep: "Complete release review before adding a device-specific external mining engine flag.",
    };
  }

  if (engineReleaseFlagEnabled) {
    return {
      id: "engine_release_flag",
      status: "passed",
      required: true,
      summary: "Explicit engine release flag is present for the reviewed external hardware candidate.",
      nextStep: "Keep runtime start behind operator controls, rollback evidence, and normal mining-engine lifecycle wiring.",
    };
  }

  return {
    id: "engine_release_flag",
    status: "waiting",
    required: true,
    summary: "Explicit engine release flag has not been wired for app-controlled external mining.",
    nextStep: "Wire a reviewed, device-specific engine release flag before considering any external start().",
  };
}

export function deriveHashHardwareReleaseGate(input: HashHardwareReleaseGateInput): HashHardwareReleaseGate {
  const coreChecks = [
    protocolCheck(input.protocolContract),
    externalStabilityCheck(input.externalHistory),
    operatingEvidenceCheck(input.operatingEvidence),
    workValidationCheck(input.validationChecklist),
    claimEvidenceCheck(input.claimCertificate),
  ];
  const corePassed = coreChecks.every((check) => check.status === "passed");
  const releaseReview = releaseReviewCheck(corePassed, input.releaseReviewApproved === true);
  const checks = [
    ...coreChecks,
    releaseReview,
    engineReleaseFlagCheck(releaseReview.status === "passed", input.engineReleaseFlagEnabled === true),
  ];
  const requiredChecks = checks.filter((check) => check.required);
  const passedCount = requiredChecks.filter((check) => check.status === "passed").length;
  const readinessScore = requiredChecks.length > 0 ? Math.round(passedCount * 100 / requiredChecks.length) : 0;
  const missingCheckIds = requiredChecks
    .filter((check) => check.status !== "passed")
    .map((check) => check.id);
  const primaryBlockingCheck = requiredChecks.find((check) => check.status !== "passed") ?? null;
  const releaseCandidateReady = corePassed;
  const status: HashHardwareReleaseGateStatus = releaseCandidateReady
    ? "release_candidate"
    : checks.some((check) => check.status === "blocked")
      ? "blocked"
      : "waiting";

  return {
    schemaVersion: 1,
    status,
    readinessScore,
    releaseCandidateReady,
    miningStartAllowed: false,
    checks,
    missingCheckIds,
    primaryBlockingCheck,
    summary: releaseCandidateReady
      ? "External hardware is a release candidate, but real mining start remains disabled until an explicit engine release flag is wired."
      : `External hardware release gate is ${status}; ${missingCheckIds.length} required check${missingCheckIds.length === 1 ? "" : "s"} still need evidence.`,
    nextStep: primaryBlockingCheck?.nextStep ?? "Keep real external start() disabled until the release flag is explicitly wired after review.",
  };
}
const RELEASE_FORBIDDEN_OPERATIONS = [
  "external_start_mining",
  "app_controlled_external_job_routing",
  "external_pool_share_submission",
  "automatic_release_approval",
  "external_engine_release_flag_without_review",
];

export function createHashHardwareReleaseEvidenceDossier(
  gate: HashHardwareReleaseGate,
): HashHardwareReleaseEvidenceDossier {
  const evidenceItems = gate.checks.map((check) => ({
    id: check.id,
    status: check.status,
    required: check.required,
    evidence: check.status === "passed" ? check.summary : "",
    missingEvidence: check.status === "passed" ? null : check.summary,
    nextStep: check.nextStep,
  }));
  const requiredActions = evidenceItems
    .filter((item) => item.required && item.status !== "passed")
    .map((item) => `${item.id}: ${item.nextStep}`);

  return {
    schemaVersion: 1,
    gateStatus: gate.status,
    readinessScore: gate.readinessScore,
    releaseCandidateReady: gate.releaseCandidateReady,
    miningStartAllowed: false,
    evidenceItems,
    missingEvidenceIds: gate.missingCheckIds,
    requiredActions,
    forbiddenOperations: RELEASE_FORBIDDEN_OPERATIONS,
    summary: gate.releaseCandidateReady
      ? "Release evidence dossier is ready for manual review or engine-flag wiring; real external mining start is still forbidden."
      : `Release evidence dossier is incomplete: ${gate.missingCheckIds.length} evidence gate${gate.missingCheckIds.length === 1 ? "" : "s"} still missing.`,
    nextStep: gate.nextStep,
  };
}

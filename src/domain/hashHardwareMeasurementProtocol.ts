import type { HashHardwareReleaseCheckId, HashHardwareReleaseEvidenceDossier } from "./hashHardwareReleaseGate.js";

export type HashHardwareMeasurementStepId =
  | "select_interface"
  | "collect_external_telemetry"
  | "prove_operating_evidence"
  | "prove_work_lease"
  | "verify_share_submission"
  | "review_release"
  | "wire_engine_release_flag";

export type HashHardwareMeasurementStepStatus = "done" | "ready" | "blocked";

export interface HashHardwareMeasurementStep {
  id: HashHardwareMeasurementStepId;
  status: HashHardwareMeasurementStepStatus;
  evidenceGateId: HashHardwareReleaseCheckId | null;
  objective: string;
  successCriteria: string;
  nextStep: string;
}

export interface HashHardwareMeasurementProtocol {
  schemaVersion: 1;
  primaryStep: HashHardwareMeasurementStep;
  steps: HashHardwareMeasurementStep[];
  readyStepIds: HashHardwareMeasurementStepId[];
  blockedStepIds: HashHardwareMeasurementStepId[];
  forbiddenOperations: string[];
  summary: string;
}

interface MeasurementTemplate {
  id: HashHardwareMeasurementStepId;
  evidenceGateId: HashHardwareReleaseCheckId | null;
  objective: string;
  successCriteria: string;
  nextStep: string;
}

const MEASUREMENT_TEMPLATES: MeasurementTemplate[] = [
  {
    id: "select_interface",
    evidenceGateId: "protocol_contract",
    objective: "Choose and prove the external hash interface as Network dry-run or reserved Direct hardware.",
    successCriteria: "Protocol contract reaches dry-run-only with endpoint access, telemetry schema, job lifecycle, unique work partitioning, stale-result rejection, thermal limits, and share-submission proof.",
    nextStep: "Keep Direct ports reserved until hardware exists; use Network telemetry only until dry-run partitioned work is proven.",
  },
  {
    id: "collect_external_telemetry",
    evidenceGateId: "external_stability_history",
    objective: "Collect cool and warm external hardware samples without app-controlled mining start.",
    successCriteria: "Six usable samples include hashrate, wall watts, J/TH, thermal state, fan/VR telemetry when available, accepted shares, rejected shares, and pause state.",
    nextStep: "Record enough telemetry to compare the external device against the local lowest-power and highest-hash profiles.",
  },
  {
    id: "prove_operating_evidence",
    evidenceGateId: "hardware_operating_evidence",
    objective: "Prove the external hardware operating envelope for long unattended low-power use.",
    successCriteria: "At least one 900 second sample has trusted wall power, positive hashrate, cool/warm thermals, noise below the configured limit, at least three share events, and low share waste.",
    nextStep: "Capture wall-meter or trusted device-power evidence before release review; telemetry-only power is not enough for lowest-power claims.",
  },
  {
    id: "prove_work_lease",
    evidenceGateId: "external_work_validation",
    objective: "Dry-run the external work lease before routing any real pool work.",
    successCriteria: "Job lifecycle, unique search-space assignment, stale-job rejection, thermal-limit handling, and share-submission checks all pass in validation artifacts.",
    nextStep: "Attach validation artifacts to the release dossier; do not enable real share submission from the app.",
  },
  {
    id: "verify_share_submission",
    evidenceGateId: "claim_evidence",
    objective: "Bind external evidence to the low-power or high-hash claim certificate.",
    successCriteria: "Claim certificate references stable external evidence while external mining remains not allowed until release review.",
    nextStep: "Keep the claim as external reference evidence, not as permission to start mining.",
  },
  {
    id: "review_release",
    evidenceGateId: "release_review",
    objective: "Run manual hardware release review after all protocol and evidence gates pass.",
    successCriteria: "Review approves hardware identity, measured wall power, thermals, work leases, stale rejection, pool share submission, and rollback behavior.",
    nextStep: "Only after review should a future engine release flag be considered; automatic external start remains forbidden.",
  },
  {
    id: "wire_engine_release_flag",
    evidenceGateId: "engine_release_flag",
    objective: "Wire the reviewed external adapter behind an explicit engine release flag.",
    successCriteria: "A device-specific flag exists, is off by default, is tied to the reviewed adapter identity, and still keeps operator start/stop controls explicit.",
    nextStep: "Keep the flag disabled until real hardware validation, rollback behavior, and packaging review are complete.",
  },
];

function missing(dossier: HashHardwareReleaseEvidenceDossier, gateId: HashHardwareReleaseCheckId | null) {
  return gateId === null ? false : dossier.missingEvidenceIds.includes(gateId);
}

function statusForTemplate(
  template: MeasurementTemplate,
  dossier: HashHardwareReleaseEvidenceDossier,
  firstMissingGateId: HashHardwareReleaseCheckId | null,
): HashHardwareMeasurementStepStatus {
  if (!missing(dossier, template.evidenceGateId)) {
    return "done";
  }
  return template.evidenceGateId === firstMissingGateId ? "ready" : "blocked";
}

export function deriveHashHardwareMeasurementProtocol(
  dossier: HashHardwareReleaseEvidenceDossier,
): HashHardwareMeasurementProtocol {
  const firstMissingGateId = dossier.missingEvidenceIds[0] ?? null;
  const steps = MEASUREMENT_TEMPLATES.map((template) => ({
    ...template,
    status: statusForTemplate(template, dossier, firstMissingGateId),
  }));
  const primaryStep = steps.find((step) => step.status === "ready")
    ?? steps.find((step) => step.id === "review_release")
    ?? steps[steps.length - 1];
  const readyStepIds = steps.filter((step) => step.status === "ready").map((step) => step.id);
  const blockedStepIds = steps.filter((step) => step.status === "blocked").map((step) => step.id);
  const doneCount = steps.filter((step) => step.status === "done").length;

  return {
    schemaVersion: 1,
    primaryStep,
    steps,
    readyStepIds,
    blockedStepIds,
    forbiddenOperations: dossier.forbiddenOperations,
    summary: dossier.releaseCandidateReady
      ? "Hardware measurement protocol is ready for manual release review or engine-flag wiring; real external mining start remains forbidden."
      : `Hardware measurement protocol has ${doneCount}/${steps.length} steps complete; next measurement is ${primaryStep.id.replace(/_/g, " ")}.`,
  };
}

export type ExternalHashEngineValidationCheckKind =
  | "job_lifecycle"
  | "search_space_assignment"
  | "stale_job_rejection"
  | "thermal_limits"
  | "share_submission";

export type ExternalHashEngineValidationCheckStatus = "untested" | "passed" | "failed" | "warning";
export type ExternalHashEngineValidationStatus = "untested" | "failed" | "warning" | "passed";

export interface ExternalHashEngineValidationInput {
  kind: ExternalHashEngineValidationCheckKind;
  status: ExternalHashEngineValidationCheckStatus;
  summary?: string | null;
}

export interface ExternalHashEngineValidationCheck {
  kind: ExternalHashEngineValidationCheckKind;
  label: string;
  status: ExternalHashEngineValidationCheckStatus;
  blocking: boolean;
  summary: string;
  nextStep: string;
}

export interface ExternalHashEngineValidationChecklist {
  status: ExternalHashEngineValidationStatus;
  integrationReady: boolean;
  startAllowed: boolean;
  checks: ExternalHashEngineValidationCheck[];
  missingChecks: ExternalHashEngineValidationCheckKind[];
  failedChecks: ExternalHashEngineValidationCheckKind[];
  warningChecks: ExternalHashEngineValidationCheckKind[];
  passedChecks: ExternalHashEngineValidationCheckKind[];
  summary: string;
  nextStep: string;
}

const CHECK_ORDER: ExternalHashEngineValidationCheckKind[] = [
  "job_lifecycle",
  "search_space_assignment",
  "stale_job_rejection",
  "thermal_limits",
  "share_submission",
];

function checkLabel(kind: ExternalHashEngineValidationCheckKind) {
  switch (kind) {
    case "job_lifecycle":
      return "Job Lifecycle";
    case "search_space_assignment":
      return "Search Space";
    case "stale_job_rejection":
      return "Stale Jobs";
    case "thermal_limits":
      return "Thermal Limits";
    case "share_submission":
      return "Share Submit";
  }
}

function defaultSummary(kind: ExternalHashEngineValidationCheckKind, status: ExternalHashEngineValidationCheckStatus) {
  if (status === "passed") {
    switch (kind) {
      case "job_lifecycle":
        return "Adapter proved subscribe, authorize, job update, and stop lifecycle handling.";
      case "search_space_assignment":
        return "Adapter proved unique nonce, version, nTime, or extranonce work assignment without overlap.";
      case "stale_job_rejection":
        return "Adapter proved stale jobs are rejected before share submission.";
      case "thermal_limits":
        return "Adapter proved safe thermal limits or pause behavior.";
      case "share_submission":
        return "Adapter proved accepted share submission against the selected pool.";
    }
  }

  if (status === "failed") {
    return `${checkLabel(kind)} validation failed.`;
  }

  if (status === "warning") {
    return `${checkLabel(kind)} validation has warnings that must be reviewed.`;
  }

  return `${checkLabel(kind)} validation has not been run.`;
}

function nextStepFor(kind: ExternalHashEngineValidationCheckKind, status: ExternalHashEngineValidationCheckStatus) {
  if (status === "passed") {
    return "No action needed for this check.";
  }

  switch (kind) {
    case "job_lifecycle":
      return "Run a controlled job lifecycle test: subscribe, authorize, receive job, stop, and reconnect.";
    case "search_space_assignment":
      return "Prove the adapter assigns enough unique nonce, version, nTime, or extranonce work for the device hashrate without overlap.";
    case "stale_job_rejection":
      return "Prove the adapter tags job generations and drops stale shares after job changes.";
    case "thermal_limits":
      return "Prove the adapter reports thermal state and pauses or derates before unsafe temperatures.";
    case "share_submission":
      return "Prove a share can be submitted and accepted against the selected pool without local proxy fallback.";
  }
}

export function deriveExternalHashEngineValidationChecklist(
  inputs: ExternalHashEngineValidationInput[] = [],
): ExternalHashEngineValidationChecklist {
  const inputByKind = new Map(inputs.map((input) => [input.kind, input]));
  const checks = CHECK_ORDER.map((kind) => {
    const input = inputByKind.get(kind);
    const status = input?.status ?? "untested";

    return {
      kind,
      label: checkLabel(kind),
      status,
      blocking: status !== "passed",
      summary: input?.summary?.trim() || defaultSummary(kind, status),
      nextStep: nextStepFor(kind, status),
    };
  });
  const missingChecks = checks
    .filter((check) => check.status === "untested")
    .map((check) => check.kind);
  const failedChecks = checks
    .filter((check) => check.status === "failed")
    .map((check) => check.kind);
  const warningChecks = checks
    .filter((check) => check.status === "warning")
    .map((check) => check.kind);
  const passedChecks = checks
    .filter((check) => check.status === "passed")
    .map((check) => check.kind);

  let status: ExternalHashEngineValidationStatus = "passed";
  if (failedChecks.length > 0) {
    status = "failed";
  } else if (warningChecks.length > 0) {
    status = "warning";
  } else if (missingChecks.length > 0) {
    status = "untested";
  }

  const integrationReady = status === "passed" && passedChecks.length === CHECK_ORDER.length;
  const summary = integrationReady
    ? "External hash engine validation passed; external mining start remains reserved for a hardware release review."
    : status === "failed"
      ? "External hash engine validation failed; external mining start remains disabled."
      : status === "warning"
        ? "External hash engine validation has warnings; external mining start remains disabled."
        : "External hash engine validation is incomplete; external mining start remains disabled.";
  const firstBlocking = checks.find((check) => check.blocking);

  return {
    status,
    integrationReady,
    startAllowed: false,
    checks,
    missingChecks,
    failedChecks,
    warningChecks,
    passedChecks,
    summary,
    nextStep: firstBlocking?.nextStep ?? "Keep ExternalHashEngine start() reserved until a real hardware protocol is selected and release-reviewed.",
  };
}

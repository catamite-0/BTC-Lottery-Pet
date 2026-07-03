import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveExternalHashEngineValidationChecklist,
} from "../.test-dist/engines/externalHashEngineValidation.js";

const allValidationPassed = [
  { kind: "job_lifecycle", status: "passed" },
  { kind: "search_space_assignment", status: "passed" },
  { kind: "stale_job_rejection", status: "passed" },
  { kind: "thermal_limits", status: "passed" },
  { kind: "share_submission", status: "passed" },
];

test("external hash validation defaults to untested and keeps start reserved", () => {
  const checklist = deriveExternalHashEngineValidationChecklist();

  assert.equal(checklist.status, "untested");
  assert.equal(checklist.integrationReady, false);
  assert.equal(checklist.startAllowed, false);
  assert.deepEqual(checklist.missingChecks, [
    "job_lifecycle",
    "search_space_assignment",
    "stale_job_rejection",
    "thermal_limits",
    "share_submission",
  ]);
  assert.match(checklist.summary, /incomplete/i);
  assert.match(checklist.checks.find((check) => check.kind === "search_space_assignment")?.nextStep ?? "", /unique nonce/i);
});

test("external hash validation can become integration-ready while start stays reserved", () => {
  const checklist = deriveExternalHashEngineValidationChecklist(allValidationPassed);

  assert.equal(checklist.status, "passed");
  assert.equal(checklist.integrationReady, true);
  assert.equal(checklist.startAllowed, false);
  assert.deepEqual(checklist.passedChecks, [
    "job_lifecycle",
    "search_space_assignment",
    "stale_job_rejection",
    "thermal_limits",
    "share_submission",
  ]);
  assert.match(checklist.nextStep, /reserved/i);
});

test("external hash validation reports failed blocking checks", () => {
  const checklist = deriveExternalHashEngineValidationChecklist([
    { kind: "job_lifecycle", status: "passed" },
    { kind: "stale_job_rejection", status: "failed", summary: "stale generation was submitted" },
  ]);

  assert.equal(checklist.status, "failed");
  assert.equal(checklist.integrationReady, false);
  assert.equal(checklist.startAllowed, false);
  assert.deepEqual(checklist.failedChecks, ["stale_job_rejection"]);
  assert.equal(checklist.checks.find((check) => check.kind === "stale_job_rejection")?.summary, "stale generation was submitted");
});

test("external hash validation keeps warnings blocking", () => {
  const checklist = deriveExternalHashEngineValidationChecklist([
    { kind: "job_lifecycle", status: "passed" },
    { kind: "search_space_assignment", status: "passed" },
    { kind: "stale_job_rejection", status: "passed" },
    { kind: "thermal_limits", status: "warning" },
    { kind: "share_submission", status: "passed" },
  ]);

  assert.equal(checklist.status, "warning");
  assert.equal(checklist.integrationReady, false);
  assert.equal(checklist.startAllowed, false);
  assert.deepEqual(checklist.warningChecks, ["thermal_limits"]);
  assert.match(checklist.summary, /warnings/i);
});

test("external hash validation requires unique search-space assignment", () => {
  const checklist = deriveExternalHashEngineValidationChecklist([
    { kind: "job_lifecycle", status: "passed" },
    { kind: "stale_job_rejection", status: "passed" },
    { kind: "thermal_limits", status: "passed" },
    { kind: "share_submission", status: "passed" },
  ]);

  assert.equal(checklist.integrationReady, false);
  assert.deepEqual(checklist.missingChecks, ["search_space_assignment"]);
  assert.match(checklist.nextStep, /without overlap/i);
});
import test from "node:test";
import assert from "node:assert/strict";

import {
  appendFrontendDevLogSection,
  withParsedFrontendDiagnosticBodyJson,
} from "../.test-dist/contracts/diagnostics.js";
import {
  miningLogMessageForActiveSession,
} from "../.test-dist/contracts/mining.js";

test("mining log payloads are scoped to the active session", () => {
  assert.equal(miningLogMessageForActiveSession("legacy log line", 7), "legacy log line");
  assert.equal(
    miningLogMessageForActiveSession({ session_id: null, message: "system log line" }, 7),
    "system log line",
  );
  assert.equal(
    miningLogMessageForActiveSession({ session_id: 7, message: "current session" }, 7),
    "current session",
  );
  assert.equal(
    miningLogMessageForActiveSession({ session_id: 6, message: "old session" }, 7),
    null,
  );
  assert.equal(
    miningLogMessageForActiveSession({ session_id: 7, message: "pending start" }, null),
    null,
  );
});

test("frontend diagnostic sections preserve structured JSON and saved dev logs", () => {
  const sections = appendFrontendDevLogSection(
    [
      {
        title: "Frontend CPU Runtime",
        body: JSON.stringify({ mode: "cpu", configuredCpuThreads: 2 }),
      },
    ],
    "[2026-07-05T00:00:00.000Z] stratum: current session only",
  ).map(withParsedFrontendDiagnosticBodyJson);

  assert.equal(sections.length, 2);
  assert.equal(sections[0].bodyJson.mode, "cpu");
  assert.equal(sections[0].bodyJson.configuredCpuThreads, 2);
  assert.equal(sections[1].title, "Frontend DEV LOG");
  assert.equal(
    sections[1].body,
    "[2026-07-05T00:00:00.000Z] stratum: current session only",
  );
  assert.equal(Object.hasOwn(sections[1], "bodyJson"), false);
});

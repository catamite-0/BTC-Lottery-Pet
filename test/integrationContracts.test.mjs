import test from "node:test";
import assert from "node:assert/strict";

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

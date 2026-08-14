import test from "node:test";
import assert from "node:assert/strict";

import { effectsFromRuntimePayload } from "../.test-dist/domain/miningRuntimeEffects.js";

const baseStats = {
  session_id: 7,
  hashrate: 1,
  accepted_shares: 0,
  rejected_shares: 0,
  stale_shares_dropped: 0,
  queued_shares_dropped: 0,
  best_difficulty: 0,
  share_difficulty: 0,
  current_job_id: "job-0",
  connection_status: "Mining",
};

const blockCandidate = {
  job_id: "job-1",
  nonce: "00000001",
  ntime: "abcdef01",
  extranonce2: "00000000",
  hash: "0000000000000000000000000000000000000000000000000000000000000001",
  difficulty: 1,
  timestamp: "2026-07-05T00:00:00Z",
  submission_status: "unknown",
  submission_message: "No pool confirmation was received before the response deadline.",
  pool: "public-pool.io:3333",
  record_saved: true,
  record_file: "block-candidate-job-1.json",
};

test("runtime effects map connection payloads to pet copy and status", () => {
  const effects = effectsFromRuntimePayload(
    {
      session_id: 7,
      type: "connection_status_changed",
      status: "Authorized",
      message: "Worker authorized successfully",
    },
    { wasMining: true, stats: baseStats },
  );

  assert.equal(effects.connectionStatus, "Authorized");
  assert.deepEqual(effects.petLogMessages, ["The pool knows my name."]);
  assert.equal(effects.uiEvents.length, 0);
});

test("runtime effects ignore non-block payloads while idle", () => {
  const effects = effectsFromRuntimePayload(
    {
      session_id: 7,
      type: "share_accepted",
      message: "Share accepted: diff=1",
    },
    { wasMining: false, stats: baseStats },
  );

  assert.equal(effects.lastShare, null);
  assert.equal(effects.uiEvents.length, 0);
  assert.deepEqual(effects.petLogMessages, []);
});

test("runtime effects unify share attention and pet copy", () => {
  const effects = effectsFromRuntimePayload(
    {
      session_id: 7,
      type: "share_accepted",
      message: "[12:00:00] Share accepted: diff=1",
    },
    { wasMining: true, stats: baseStats },
  );

  assert.equal(effects.lastShare, "[12:00:00] Share accepted: diff=1");
  assert.equal(effects.notifyShareAccepted, true);
  assert.equal(effects.uiEvents.length, 1);
  assert.equal(effects.uiEvents[0].type, "share_accepted");
  assert.equal(effects.uiEvents[0].payload.message, "Share accepted: diff=1");
  assert.deepEqual(effects.petLogMessages, ["I feel lucky..."]);
});

test("runtime effects emit block candidate and jackpot through one patch", () => {
  const effects = effectsFromRuntimePayload(
    {
      session_id: 7,
      type: "block_candidate",
      block: blockCandidate,
    },
    { wasMining: true, stats: baseStats },
  );

  assert.equal(effects.notifyJackpot, true);
  assert.equal(effects.connectionStatus, "Mining");
  assert.deepEqual(effects.blockCandidate, blockCandidate);
  assert.equal(effects.uiEvents.map((event) => event.type).join(","), "block_candidate,jackpot");
  assert.deepEqual(effects.petLogMessages, [
    "Something is happening...",
    "I found a strange pattern...",
  ]);
  assert.match(effects.devLogMessage, /Block candidate found/);
});

test("runtime effects keep an idle block candidate visual-only", () => {
  const effects = effectsFromRuntimePayload(
    {
      session_id: 7,
      type: "block_candidate",
      block: blockCandidate,
    },
    { wasMining: false, stats: { ...baseStats, connection_status: "Stopped" } },
  );

  assert.equal(effects.notifyJackpot, true);
  assert.equal(effects.connectionStatus, "Stopped");
  assert.equal(effects.uiEvents.length, 2);
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  cleanMiningLogMessage,
  createStructuredMiningEventState,
  reduceStructuredMiningEvents,
  structuredMiningEventFromBlockCandidate,
  structuredMiningEventFromRuntimePayload,
} from "../.test-dist/domain/structuredMiningEvents.js";

const baseStats = {
  session_id: 7,
  hashrate: 0,
  accepted_shares: 0,
  rejected_shares: 0,
  stale_shares_dropped: 0,
  queued_shares_dropped: 0,
  best_difficulty: 0,
  share_difficulty: 0,
  current_job_id: "",
  connection_status: "Stopped",
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

test("structured mining events derive connection state from runtime payloads", () => {
  const event = structuredMiningEventFromRuntimePayload({
    session_id: 7,
    type: "connection_status_changed",
    status: "Authorized",
    message: "Worker authorized successfully",
  });
  const state = reduceStructuredMiningEvents(createStructuredMiningEventState(baseStats), [event]);

  assert.equal(event.type, "connection_status_changed");
  assert.equal(state.connectionStatus, "Authorized");
  assert.equal(state.petLogMessage, "The pool knows my name.");
});

test("structured mining events extract job id and mining status", () => {
  const event = structuredMiningEventFromRuntimePayload({
    session_id: 7,
    type: "job_received",
    job_id: "abc123",
    message: "Job received: id=abc123, diff=1000",
  });
  const state = reduceStructuredMiningEvents(createStructuredMiningEventState(baseStats), [event]);

  assert.equal(event.type, "job_received");
  assert.equal(state.currentJobId, "abc123");
  assert.equal(state.connectionStatus, "Mining");
  assert.equal(state.petLogMessage, "A fresh puzzle arrived.");
});

test("structured mining events derive share UI state without log parsing", () => {
  const submitted = reduceStructuredMiningEvents(
    createStructuredMiningEventState(baseStats),
    [structuredMiningEventFromRuntimePayload({
      session_id: 7,
      type: "share_submitted",
      message: "Share submitted: nonce=01",
    })],
  );
  assert.equal(submitted.lastShare, "Share submitted: nonce=01");
  assert.equal(submitted.shareEventType, null);

  const accepted = reduceStructuredMiningEvents(
    createStructuredMiningEventState(baseStats),
    [structuredMiningEventFromRuntimePayload({
      session_id: 7,
      type: "share_accepted",
      message: "Share accepted: diff=1",
    })],
  );
  assert.equal(accepted.lastShare, "Share accepted: diff=1");
  assert.equal(accepted.shareEventType, "share_accepted");

  const rejected = reduceStructuredMiningEvents(
    createStructuredMiningEventState(baseStats),
    [structuredMiningEventFromRuntimePayload({
      session_id: 7,
      type: "share_rejected",
      message: "Share rejected: stale",
    })],
  );
  assert.equal(rejected.lastShare, "Share rejected: stale");
  assert.equal(rejected.shareEventType, "share_rejected");
});

test("structured mining events expose connection error notification status", () => {
  const state = reduceStructuredMiningEvents(
    createStructuredMiningEventState(baseStats),
    [structuredMiningEventFromRuntimePayload({
      session_id: 7,
      type: "connection_status_changed",
      status: "Connection Error",
      message: "Connection error: socket closed",
    })],
  );

  assert.equal(state.connectionStatus, "Connection Error");
  assert.equal(state.connectionErrorStatus, "Connection error: socket closed");
  assert.equal(state.petLogMessage, "I lost the pool signal.");
});

test("structured mining events keep mining running for block candidates", () => {
  const state = reduceStructuredMiningEvents(
    createStructuredMiningEventState({ ...baseStats, connection_status: "Mining" }),
    [structuredMiningEventFromBlockCandidate(blockCandidate)],
  );

  assert.equal(state.connectionStatus, "Mining");
  assert.deepEqual(state.blockCandidate, blockCandidate);
});

test("structured mining events clean timestamp prefixes", () => {
  assert.equal(cleanMiningLogMessage("[12:00:00] Share accepted"), "Share accepted");
});

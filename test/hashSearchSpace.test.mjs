import test from "node:test";
import assert from "node:assert/strict";

import {
  estimateHashSearchSpacePlan,
  estimateHashWorkLeasePlan,
} from "../.test-dist/domain/hashSearchSpace.js";

test("hash search-space planner waits until hashrate is known", () => {
  const plan = estimateHashSearchSpacePlan({ hashrate: 0 });

  assert.equal(plan.status, "waiting");
  assert.equal(plan.estimatedJobSeconds, null);
  assert.equal(plan.requiresVersionRolling, false);
  assert.match(plan.summary, /waiting/);
});

test("hash search-space planner flags nonce-only ASIC search as insufficient", () => {
  const plan = estimateHashSearchSpacePlan({
    hashrate: 1_000_000_000_000,
    targetJobSeconds: 1,
  });

  assert.equal(plan.status, "insufficient");
  assert.equal(plan.totalBits, 32);
  assert.equal(plan.requiresVersionRolling, true);
  assert.equal(plan.requiresExtranonce, false);
  assert.ok(plan.nonceOnlySeconds && plan.nonceOnlySeconds < 0.01);
});

test("hash search-space planner accepts BIP320 version rolling for home ASIC rates", () => {
  const plan = estimateHashSearchSpacePlan({
    hashrate: 200_000_000_000_000,
    targetJobSeconds: 1,
    versionRollingBits: 16,
  });

  assert.equal(plan.status, "sufficient");
  assert.equal(plan.totalBits, 48);
  assert.equal(plan.requiresVersionRolling, false);
  assert.equal(plan.requiresExtranonce, false);
  assert.ok(plan.estimatedJobSeconds && plan.estimatedJobSeconds > 1);
});

test("hash search-space planner accepts BIP323 24-bit version rolling for dry-run planning", () => {
  const plan = estimateHashSearchSpacePlan({
    hashrate: 4_000_000_000_000_000,
    targetJobSeconds: 1,
    versionRollingBits: 24,
  });

  assert.equal(plan.status, "sufficient");
  assert.equal(plan.totalBits, 56);
  assert.match(plan.controls.find((control) => control.kind === "versionRolling")?.summary ?? "", /BIP320\/BIP323/);
  assert.equal(plan.requiresExtranonce, false);
});

test("hash search-space planner asks for deeper partitioning beyond version rolling", () => {
  const plan = estimateHashSearchSpacePlan({
    hashrate: 500_000_000_000_000,
    targetJobSeconds: 1,
    versionRollingBits: 16,
  });

  assert.equal(plan.status, "tight");
  assert.equal(plan.requiresVersionRolling, false);
  assert.equal(plan.requiresExtranonce, true);
  assert.equal(plan.missingBits, 1);
});

test("hash search-space planner uses extranonce bytes to expand assigned work", () => {
  const plan = estimateHashSearchSpacePlan({
    hashrate: 500_000_000_000_000,
    targetJobSeconds: 30,
    versionRollingBits: 16,
    extranonceBytes: 2,
  });

  assert.equal(plan.status, "sufficient");
  assert.equal(plan.controls.some((control) => control.kind === "extranonce"), true);
  assert.equal(plan.totalBits, 64);
  assert.equal(plan.requiresExtranonce, false);
});
test("hash work lease planner waits until hashrate is known", () => {
  const lease = estimateHashWorkLeasePlan({ hashrate: 0, parallelWorkers: 4 });

  assert.equal(lease.status, "waiting");
  assert.equal(lease.leaseSeconds, null);
  assert.equal(lease.leaseUtilizationRatio, null);
  assert.equal(lease.routeUtilizationRatio, null);
  assert.equal(lease.hashWasteRisk, "unknown");
  assert.equal(lease.overlapRisk, "high");
  assert.match(lease.summary, /waiting/);
});

test("hash work lease planner flags overlapping external workers", () => {
  const lease = estimateHashWorkLeasePlan({
    hashrate: 1_000_000_000_000,
    targetJobSeconds: 1,
    parallelWorkers: 2,
  });

  assert.equal(lease.status, "overlap-risk");
  assert.equal(lease.partitionBits, 0);
  assert.equal(lease.overlapRisk, "high");
  assert.equal(lease.requiresWorkPartitioning, true);
  assert.equal(lease.hashWasteRisk, "high");
  assert.equal(lease.uniquePartitionRatio, 0.5);
  assert.ok(lease.leaseUtilizationRatio !== null && lease.leaseUtilizationRatio < 0.01);
  assert.ok(lease.routeUtilizationRatio !== null && lease.routeUtilizationRatio < Number(lease.leaseUtilizationRatio));
  assert.match(lease.summary, /overlap risk high/);
  assert.match(lease.summary, /waste risk high/);
});

test("hash work lease planner accepts unique version and extranonce partitions", () => {
  const lease = estimateHashWorkLeasePlan({
    hashrate: 500_000_000_000_000,
    targetJobSeconds: 30,
    versionRollingBits: 16,
    extranonceBytes: 2,
    parallelWorkers: 4,
  });

  assert.equal(lease.status, "ready");
  assert.equal(lease.partitionBits, 32);
  assert.equal(lease.parallelWorkers, 4);
  assert.equal(lease.perWorkerBits, 62);
  assert.equal(lease.overlapRisk, "low");
  assert.equal(lease.requiresWorkPartitioning, false);
  assert.equal(lease.leaseUtilizationRatio, 1);
  assert.equal(lease.uniquePartitionRatio, 1);
  assert.equal(lease.routeUtilizationRatio, 1);
  assert.equal(lease.hashWasteRisk, "none");
  assert.match(lease.summary, /100% lease utilization/);
  assert.ok(lease.leaseSeconds && lease.leaseSeconds > 30);
});

test("hash work lease planner shows nonce-range splits can be unique but too short", () => {
  const lease = estimateHashWorkLeasePlan({
    hashrate: 1_000_000_000_000,
    targetJobSeconds: 1,
    parallelWorkers: 16,
    allowNonceRangePartition: true,
  });

  assert.equal(lease.status, "insufficient");
  assert.equal(lease.overlapRisk, "low");
  assert.equal(lease.requiresWorkPartitioning, false);
  assert.equal(lease.perWorkerBits, 28);
  assert.equal(lease.hashWasteRisk, "high");
  assert.equal(lease.uniquePartitionRatio, 1);
  assert.equal(lease.routeUtilizationRatio, lease.leaseUtilizationRatio);
  assert.ok(lease.leaseUtilizationRatio !== null && lease.leaseUtilizationRatio < 0.001);
  assert.match(lease.summary, /waste risk high/);
  assert.ok(lease.leaseSeconds && lease.leaseSeconds < 1);
});

test("hash work lease discounts routes when worker partition slots overlap", () => {
  const lease = estimateHashWorkLeasePlan({
    hashrate: 1_000,
    targetJobSeconds: 1,
    parallelWorkers: 4,
  });

  assert.equal(lease.status, "overlap-risk");
  assert.equal(lease.leaseUtilizationRatio, 1);
  assert.equal(lease.uniquePartitionRatio, 0.25);
  assert.equal(lease.routeUtilizationRatio, 0.25);
  assert.equal(lease.hashWasteRisk, "high");
  assert.match(lease.summary, /25% route utilization/);
});

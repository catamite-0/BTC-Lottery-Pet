import test from "node:test";
import assert from "node:assert/strict";

import { createMiningDashboardViewModel } from "../.test-dist/app/miningDashboardViewModel.js";
import { DEFAULT_PET_PROFILE_ID, getPetProfile } from "../.test-dist/pets/profiles.js";

const systemInfo = {
  available_parallelism: 8,
  default_cpu_threads: 1,
  recommended_cpu_threads: 2,
};

const idleRealStats = {
  session_id: 0,
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

function validConfig(overrides = {}) {
  return {
    btc_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
    pool_host: "public-pool.io",
    pool_port: 3333,
    pool_password: "x",
    worker_name: "desk_1",
    cpu_threads: 1,
    performance_preset: "eco",
    enable_notifications: true,
    notify_on_jackpot: true,
    notify_on_share_accepted: false,
    notify_on_connection_error: true,
    pet_profile_id: DEFAULT_PET_PROFILE_ID,
    ...overrides,
  };
}

function metricValue(metrics, label) {
  return metrics.find(([metricLabel]) => metricLabel === label)?.[1];
}

function detailSection(viewModel, title) {
  return viewModel.detailSections.find((section) => section.title === title)?.metrics ?? [];
}

test("mining dashboard view model keeps idle CPU display values compact", () => {
  const config = validConfig();
  const viewModel = createMiningDashboardViewModel({
    config,
    systemInfo,
    activePetProfile: getPetProfile(DEFAULT_PET_PROFILE_ID),
    miningEngineStatus: {
      kind: "cpu",
      petState: "IDLE",
      running: false,
      label: "IDLE",
    },
    realStats: idleRealStats,
    petState: "IDLE",
    petStatus: "Sleeping",
    lastMiningEvent: null,
    lastShare: "None",
    effectiveCpuThreads: 1,
    miningUptime: 0,
  });

  assert.equal(viewModel.displayedHashrate, "0 H/s");
  assert.equal(viewModel.modeDescription, "Local CPU mining");
  assert.equal(metricValue(viewModel.summaryMetrics, "SHARES A / R"), "0 / 0");
  assert.equal(metricValue(viewModel.summaryMetrics, "CONNECTION"), "Stopped");
  assert.equal(metricValue(detailSection(viewModel, "Session"), "STALE DROPS"), "0");
  assert.equal(metricValue(detailSection(viewModel, "System"), "CPU THREADS"), "1");
  assert.equal(metricValue(detailSection(viewModel, "Session"), "LAST EVENT"), "Waiting");

  const allLabels = [
    ...viewModel.summaryMetrics,
    ...viewModel.detailSections.flatMap((section) => section.metrics),
  ].map(([label]) => label);
  for (const removedLabel of ["LUCK", "STREAK", "NET DIFF", "ETA BLOCK", "BLOCK HEIGHT"]) {
    assert.equal(allLabels.includes(removedLabel), false);
  }
});

test("mining dashboard view model exposes CPU real mining resource status", () => {
  const config = validConfig({
    performance_preset: "custom",
    cpu_threads: 4,
  });
  const realStats = {
    ...idleRealStats,
    hashrate: 120_000_000,
    accepted_shares: 3,
    rejected_shares: 1,
    stale_shares_dropped: 2,
    queued_shares_dropped: 1,
    best_difficulty: 4096,
    share_difficulty: 1024,
    current_job_id: "job-1",
    connection_status: "Mining",
  };

  const viewModel = createMiningDashboardViewModel({
    config,
    systemInfo,
    activePetProfile: getPetProfile(DEFAULT_PET_PROFILE_ID),
    miningEngineStatus: {
      kind: "cpu",
      petState: "MINING_CPU",
      running: true,
      label: "CPU mining",
    },
    realStats,
    petState: "MINING_CPU",
    petStatus: "Mining",
    lastMiningEvent: null,
    lastShare: "Share accepted: diff=1024",
    effectiveCpuThreads: 4,
    miningUptime: 60,
  });

  assert.equal(viewModel.modeDescription, "Local CPU mining");
  assert.equal(viewModel.poolStatus, "public-pool.io:3333");
  assert.equal(viewModel.authStatus, "Authorized");
  assert.equal(viewModel.jobStatus, "job-1");
  assert.equal(metricValue(viewModel.summaryMetrics, "SHARES A / R"), "3 / 1");
  assert.equal(metricValue(viewModel.summaryMetrics, "BEST DIFF"), "4,096");
  assert.equal(metricValue(detailSection(viewModel, "Session"), "STALE DROPS"), "2");
  assert.equal(metricValue(detailSection(viewModel, "Session"), "LAST SHARE"), "Share accepted: diff=1024");
  assert.equal(metricValue(detailSection(viewModel, "System"), "CPU THREADS"), "4");
  assert.equal(metricValue(detailSection(viewModel, "System"), "ENGINE"), "CPU");
  assert.equal(metricValue(detailSection(viewModel, "Connection"), "POOL DIFF"), "1,024");
});

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

function metricValue(metrics, id) {
  return metrics.find((row) => row.id === id)?.value;
}

test("mining dashboard view model keeps idle CPU display values compact", () => {
  const config = validConfig();
  const viewModel = createMiningDashboardViewModel({
    config,
    systemInfo,
    activePetProfile: getPetProfile(DEFAULT_PET_PROFILE_ID),
    miningSessionStatus: {
      petState: "IDLE",
      running: false,
      label: "IDLE",
    },
    realStats: idleRealStats,
    isMining: false,
    petState: "IDLE",
    petStatus: "Sleeping",
    latestLog: "Ready for CPU mining.",
    lastMiningEvent: null,
    acceptedShares: 0,
    rejectedShares: 0,
    activeBestDiff: 0,
    effectiveCpuThreads: 1,
    miningUptime: 0,
    appUptime: 300,
    petLogsCount: 0,
    devLogsCount: 0,
  });

  assert.equal(viewModel.displayedHashrate, "0 H/s");
  assert.equal(viewModel.compactRuntimeLabel, "CPU");
  assert.equal(viewModel.modeDescription, "Local CPU mining");
  assert.equal(metricValue(viewModel.metrics, "sharesAR"), "0 / 0");
  assert.equal(metricValue(viewModel.metrics, "staleDrops"), "0");
  assert.equal(metricValue(viewModel.resourceMetrics, "cpuThreads"), "1");
  assert.equal(metricValue(viewModel.resourceMetrics, "event"), "Waiting");
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
    miningSessionStatus: {
      petState: "MINING_CPU",
      running: true,
      label: "CPU mining",
    },
    realStats,
    isMining: true,
    petState: "MINING_CPU",
    petStatus: "Mining",
    latestLog: "Job received",
    lastMiningEvent: null,
    acceptedShares: realStats.accepted_shares,
    rejectedShares: realStats.rejected_shares,
    activeBestDiff: realStats.best_difficulty,
    effectiveCpuThreads: 4,
    miningUptime: 60,
    appUptime: 600,
    petLogsCount: 1,
    devLogsCount: 2,
  });

  assert.equal(viewModel.compactRuntimeLabel, "CPU");
  assert.equal(viewModel.modeLabel, "CPU");
  assert.equal(viewModel.modeDescription, "Local CPU mining");
  assert.equal(viewModel.poolStatus, "public-pool.io:3333");
  assert.equal(viewModel.authStatus, "Authorized");
  assert.equal(viewModel.jobStatus, "job-1");
  assert.equal(metricValue(viewModel.metrics, "sharesAR"), "3 / 1");
  assert.equal(metricValue(viewModel.metrics, "staleDrops"), "2");
  assert.equal(metricValue(viewModel.resourceMetrics, "cpuThreads"), "4");
  assert.equal(metricValue(viewModel.resourceMetrics, "engine"), "CPU");
});

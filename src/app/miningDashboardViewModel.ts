import { miningEventLabel, type MiningEvent } from "../domain/miningEvents.js";
import {
  calculateProbabilitySnapshot,
  formatProbabilityTime,
  type ProbabilitySnapshot,
} from "../domain/probabilityEngine.js";
import { isAnimatedMiningState, type PetState, type PetStatus } from "../domain/petState.js";
import type { MiningSessionStatus } from "../domain/miningSession.js";
import type { AppConfig, SystemInfo } from "../contracts/config.js";
import type { RealMiningStats } from "../contracts/mining.js";
import { formatUptime } from "../domain/formatting.js";
import {
  expectedSharesPerHour,
  formatDifficulty,
  formatHashrate,
  formatShareRate,
} from "../domain/miningFormatters.js";
import { derivePetCompanionSnapshot, type PetCompanionSnapshot } from "../pets/companion.js";
import type { PetProfile } from "../pets/profiles.js";

export type MetricRow = [string, string];

export interface MiningDashboardViewModelInput {
  config: AppConfig;
  systemInfo: SystemInfo;
  activePetProfile: PetProfile;
  miningSessionStatus: MiningSessionStatus;
  realStats: RealMiningStats;
  isMining: boolean;
  petState: PetState;
  petStatus: PetStatus;
  latestLog: string;
  lastMiningEvent: MiningEvent | null;
  acceptedShares: number;
  rejectedShares: number;
  activeBestDiff: number;
  effectiveCpuThreads: number;
  miningUptime: number;
  appUptime: number;
  blockHeight: string;
  petLogsCount: number;
  devLogsCount: number;
}

export interface MiningDashboardViewModel {
  activeHashrate: number;
  displayedHashrate: string;
  probabilitySnapshot: ProbabilitySnapshot;
  petCompanion: PetCompanionSnapshot;
  compactRuntimeLabel: string;
  statusClassName: string;
  isMiningAnimation: boolean;
  displayStatus: string;
  poolStatus: string;
  authStatus: string;
  jobStatus: string;
  selectedModeLabel: string;
  modeLabel: string;
  modeDescription: string;
  metrics: MetricRow[];
  resourceMetrics: MetricRow[];
}

function performancePresetLabel(preset: AppConfig["performance_preset"]) {
  switch (preset) {
    case "eco":
      return "Eco";
    case "normal":
      return "Normal";
    case "turbo":
      return "Turbo";
    case "custom":
      return "Custom";
  }
}

export function createMiningDashboardViewModel(input: MiningDashboardViewModelInput): MiningDashboardViewModel {
  const activeHashrate = input.realStats.hashrate;
  const displayedHashrate = formatHashrate(input.realStats.hashrate);
  const probabilitySnapshot = calculateProbabilitySnapshot({
    currentDifficulty: null,
    hashrate: activeHashrate,
    bestDifficulty: input.activeBestDiff,
    acceptedShares: input.acceptedShares,
    rejectedShares: input.rejectedShares,
    miningUptimeSeconds: input.miningUptime,
  });
  const petCompanion = derivePetCompanionSnapshot({
    profile: input.activePetProfile,
    petState: input.petState,
    petStatus: input.petStatus,
    isMining: input.isMining,
    connectionStatus: input.realStats.connection_status,
    latestLog: input.latestLog,
    lastEvent: input.lastMiningEvent,
    acceptedShares: input.acceptedShares,
    rejectedShares: input.rejectedShares,
    bestDifficulty: input.activeBestDiff,
    hashrate: activeHashrate,
    luckMeter: probabilitySnapshot.luckMeter,
    miningUptimeSeconds: input.miningUptime,
    appUptimeSeconds: input.appUptime,
  });
  const compactRuntimeLabel = "CPU";
  const displayStatus = input.petStatus === "Jackpot" ? "JACKPOT" : input.petStatus;
  const poolStatus = `${input.config.pool_host}:${input.config.pool_port}`;
  const authStatus =
    input.realStats.connection_status === "Authorized" || input.realStats.connection_status === "Mining"
      ? "Authorized"
      : input.realStats.connection_status;
  const jobStatus = input.realStats.current_job_id || "Waiting";
  const shareDifficultyValue = input.realStats.share_difficulty > 0
    ? formatDifficulty(input.realStats.share_difficulty)
    : "Waiting";
  const shareRateValue = formatShareRate(expectedSharesPerHour(input.realStats.hashrate, input.realStats.share_difficulty));
  const currentDifficultyValue = probabilitySnapshot.currentDifficulty
    ? formatDifficulty(probabilitySnapshot.currentDifficulty)
    : "Waiting";
  const currentModeLabel = "CPU";

  const resourceMetrics: MetricRow[] = [
    ["ENGINE", "CPU"],
    ["PET", petCompanion.name],
    ["MOOD", petCompanion.moodLabel],
    ["PET STATE", input.miningSessionStatus.label],
    ["BOND", `${petCompanion.care.bond.value}%`],
    ["EVENT", miningEventLabel(input.lastMiningEvent)],
    ["PET LOGS", `${input.petLogsCount}`],
    ["DEV LOGS", `${input.devLogsCount}`],
    ["PRESET", performancePresetLabel(input.config.performance_preset)],
    ["CPU THREADS", `${input.effectiveCpuThreads}`],
    ["RECOMMENDED", `${input.systemInfo.recommended_cpu_threads}`],
    ["MODE", currentModeLabel],
  ];
  const metrics: MetricRow[] = [
    ["HASHRATE", displayedHashrate],
    [
      "BEST DIFF",
      formatDifficulty(input.realStats.best_difficulty),
    ],
    ["LUCK", `${probabilitySnapshot.luckMeter}%`],
    ["STREAK", `${probabilitySnapshot.streakCounter}`],
    ["NET DIFF", currentDifficultyValue],
    ["ETA BLOCK", formatProbabilityTime(probabilitySnapshot.estimatedTimeToBlockSeconds)],
    ["POOL DIFF", shareDifficultyValue],
    ["SHARES/H", shareRateValue],
    ["BLOCK HEIGHT", input.blockHeight],
    ["SHARES A / R", `${input.acceptedShares} / ${input.rejectedShares}`],
    ["STALE DROPS", `${input.realStats.stale_shares_dropped}`],
    ["QUEUE DROPS", `${input.realStats.queued_shares_dropped}`],
    ["APP UPTIME", formatUptime(input.appUptime)],
    ["MINING UPTIME", formatUptime(input.miningUptime)],
  ];

  return {
    activeHashrate,
    displayedHashrate,
    probabilitySnapshot,
    petCompanion,
    compactRuntimeLabel,
    statusClassName: input.petState === "LUCKY_EVENT" ? "flash" : "",
    isMiningAnimation: isAnimatedMiningState(input.petState),
    displayStatus,
    poolStatus,
    authStatus,
    jobStatus,
    selectedModeLabel: "CPU Mining",
    modeLabel: currentModeLabel,
    modeDescription: "Local CPU mining",
    metrics,
    resourceMetrics,
  };
}

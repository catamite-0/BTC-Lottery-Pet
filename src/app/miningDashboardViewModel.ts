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

export type MetricId =
  | "hashrate"
  | "bestDiff"
  | "luck"
  | "streak"
  | "netDiff"
  | "etaBlock"
  | "poolDiff"
  | "sharesPerHour"
  | "sharesAR"
  | "staleDrops"
  | "queueDrops"
  | "appUptime"
  | "miningUptime"
  | "engine"
  | "pet"
  | "mood"
  | "petState"
  | "bond"
  | "event"
  | "petLogs"
  | "devLogs"
  | "preset"
  | "cpuThreads"
  | "recommended"
  | "mode";

export type MetricGroup = "summary" | "primary" | "network" | "session" | "system";

export interface MetricRow {
  id: MetricId;
  label: string;
  value: string;
  group: MetricGroup;
}

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

function metric(
  id: MetricId,
  label: string,
  value: string,
  group: MetricGroup,
): MetricRow {
  return { id, label, value, group };
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
    metric("engine", "ENGINE", "CPU", "system"),
    metric("pet", "PET", petCompanion.name, "system"),
    metric("mood", "MOOD", petCompanion.moodLabel, "system"),
    metric("petState", "PET STATE", input.miningSessionStatus.label, "system"),
    metric("bond", "BOND", `${petCompanion.care.bond.value}%`, "system"),
    metric("event", "EVENT", miningEventLabel(input.lastMiningEvent), "system"),
    metric("petLogs", "PET LOGS", `${input.petLogsCount}`, "system"),
    metric("devLogs", "DEV LOGS", `${input.devLogsCount}`, "system"),
    metric("preset", "PRESET", performancePresetLabel(input.config.performance_preset), "system"),
    metric("cpuThreads", "CPU THREADS", `${input.effectiveCpuThreads}`, "system"),
    metric("recommended", "RECOMMENDED", `${input.systemInfo.recommended_cpu_threads}`, "system"),
    metric("mode", "MODE", currentModeLabel, "system"),
  ];
  const metrics: MetricRow[] = [
    metric("hashrate", "HASHRATE", displayedHashrate, "summary"),
    metric("bestDiff", "BEST DIFF", formatDifficulty(input.realStats.best_difficulty), "primary"),
    metric("luck", "LUCK", `${probabilitySnapshot.luckMeter}%`, "primary"),
    metric("streak", "STREAK", `${probabilitySnapshot.streakCounter}`, "primary"),
    metric("netDiff", "NET DIFF", currentDifficultyValue, "network"),
    metric("etaBlock", "ETA BLOCK", formatProbabilityTime(probabilitySnapshot.estimatedTimeToBlockSeconds), "network"),
    metric("poolDiff", "POOL DIFF", shareDifficultyValue, "network"),
    metric("sharesPerHour", "SHARES/H", shareRateValue, "network"),
    metric("sharesAR", "SHARES A / R", `${input.acceptedShares} / ${input.rejectedShares}`, "session"),
    metric("staleDrops", "STALE DROPS", `${input.realStats.stale_shares_dropped}`, "session"),
    metric("queueDrops", "QUEUE DROPS", `${input.realStats.queued_shares_dropped}`, "session"),
    metric("appUptime", "APP UPTIME", formatUptime(input.appUptime), "session"),
    metric("miningUptime", "MINING UPTIME", formatUptime(input.miningUptime), "session"),
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

import { miningEventLabel, type MiningEvent } from "../domain/miningEvents.js";
import { isAnimatedMiningState, type PetState, type PetStatus } from "../domain/petState.js";
import type { MiningEngineStatus } from "../engines/miningEngine.js";
import { formatUptime } from "../formatting.js";
import {
  expectedSharesPerHour,
  formatDifficulty,
  formatHashrate,
  formatShareRate,
  type AppConfig,
  type RealMiningStats,
  type SystemInfo,
} from "../miningLogic.js";
import { derivePetCompanionSnapshot, type PetCompanionSnapshot } from "../pets/companion.js";
import type { PetProfile } from "../pets/profiles.js";

export type MetricRow = [string, string];

export interface MetricSection {
  title: string;
  metrics: MetricRow[];
}

export interface MiningDashboardViewModelInput {
  config: AppConfig;
  systemInfo: SystemInfo;
  activePetProfile: PetProfile;
  miningEngineStatus: MiningEngineStatus;
  realStats: RealMiningStats;
  petState: PetState;
  petStatus: PetStatus;
  lastMiningEvent: MiningEvent | null;
  lastShare: string;
  effectiveCpuThreads: number;
  miningUptime: number;
}

export interface MiningDashboardViewModel {
  displayedHashrate: string;
  petCompanion: PetCompanionSnapshot;
  statusClassName: string;
  isMiningAnimation: boolean;
  displayStatus: string;
  connectionStatus: string;
  poolStatus: string;
  authStatus: string;
  jobStatus: string;
  summaryMetrics: MetricRow[];
  detailSections: MetricSection[];
  modeDescription: string;
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
  const displayedHashrate = formatHashrate(input.realStats.hashrate);
  const petCompanion = derivePetCompanionSnapshot({
    profile: input.activePetProfile,
    petState: input.petState,
    petStatus: input.petStatus,
    lastEvent: input.lastMiningEvent,
  });
  const displayStatus = input.petStatus === "Jackpot" ? "JACKPOT" : input.petStatus;
  const connectionStatus = input.realStats.connection_status || "Stopped";
  const poolStatus = `${input.config.pool_host}:${input.config.pool_port}`;
  const authStatus = connectionStatus === "Authorized" || connectionStatus === "Mining"
    ? "Authorized"
    : connectionStatus;
  const jobStatus = input.realStats.current_job_id || "Waiting";
  const shareDifficultyValue = input.realStats.share_difficulty > 0
    ? formatDifficulty(input.realStats.share_difficulty)
    : "Waiting";
  const shareRateValue = formatShareRate(
    expectedSharesPerHour(input.realStats.hashrate, input.realStats.share_difficulty),
  );

  const summaryMetrics: MetricRow[] = [
    ["BEST DIFF", formatDifficulty(input.realStats.best_difficulty)],
    ["CONNECTION", connectionStatus],
    ["SHARES A / R", `${input.realStats.accepted_shares} / ${input.realStats.rejected_shares}`],
    ["MINING TIME", formatUptime(input.miningUptime)],
  ];
  const detailSections: MetricSection[] = [
    {
      title: "Connection",
      metrics: [
        ["POOL", poolStatus],
        ["AUTH", authStatus],
        ["JOB", jobStatus],
        ["POOL DIFF", shareDifficultyValue],
        ["SHARES/H", shareRateValue],
      ],
    },
    {
      title: "Session",
      metrics: [
        ["LAST EVENT", miningEventLabel(input.lastMiningEvent)],
        ["LAST SHARE", input.lastShare],
        ["STALE DROPS", `${input.realStats.stale_shares_dropped}`],
        ["QUEUE DROPS", `${input.realStats.queued_shares_dropped}`],
      ],
    },
    {
      title: "System",
      metrics: [
        ["ENGINE", input.miningEngineStatus.kind.toUpperCase()],
        ["PRESET", performancePresetLabel(input.config.performance_preset)],
        ["CPU THREADS", `${input.effectiveCpuThreads}`],
        ["RECOMMENDED", `${input.systemInfo.recommended_cpu_threads}`],
      ],
    },
  ];

  return {
    displayedHashrate,
    petCompanion,
    statusClassName: input.petState === "LUCKY_EVENT" ? "flash" : "",
    isMiningAnimation: isAnimatedMiningState(input.petState),
    displayStatus,
    connectionStatus,
    poolStatus,
    authStatus,
    jobStatus,
    summaryMetrics,
    detailSections,
    modeDescription: "Local CPU mining",
  };
}

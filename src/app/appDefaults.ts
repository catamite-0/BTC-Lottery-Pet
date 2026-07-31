import type {
  AppConfig,
  RealMiningStats,
  SystemInfo,
} from "../miningLogic";
import { isDesktopRuntime } from "../platform/tauri/runtimeClient";

export const fallbackConfig: AppConfig = {
  btc_address: "",
  pool_host: "public-pool.io",
  pool_port: 3333,
  pool_password: "x",
  worker_name: "btc-lottery-pet",
  cpu_threads: 1,
  performance_preset: "eco",
  enable_notifications: true,
  notify_on_jackpot: true,
  notify_on_share_accepted: false,
  notify_on_connection_error: true,
  pet_profile_id: "classic-slot",
};

export const fallbackSystemInfo: SystemInfo = {
  available_parallelism: Math.max(1, navigator.hardwareConcurrency || 1),
  default_cpu_threads: 1,
  recommended_cpu_threads: Math.min(4, Math.max(1, Math.floor((navigator.hardwareConcurrency || 1) / 2))),
};

export const idleRealStats: RealMiningStats = {
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

export const runningInTauri = isDesktopRuntime();

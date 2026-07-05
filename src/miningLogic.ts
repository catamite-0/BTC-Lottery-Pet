import type { PetStatus } from "./domain/petState";
import { normalizePetProfileId } from "./pets/profiles.js";

export type { PetStatus } from "./domain/petState";
export type PerformancePreset = "eco" | "normal" | "turbo" | "custom";
export type HeartbeatInterval = "off" | "30min" | "1h" | "6h";
export type NotificationChannel = "local_windows_toast" | "webhook";

export interface CpuRuntimeRecommendation {
  canApplyProfile?: boolean | null;
  autoApplyAllowed?: boolean | null;
  manualApprovalRequired?: boolean | null;
  opensHighHashBurst?: boolean | null;
  targetCpuThreads?: number | null;
  targetStepSummary?: string | null;
  summary?: string | null;
}

export interface CpuRuntimeAlgorithmDiagnostic {
  runtimeRecommendation: CpuRuntimeRecommendation | null;
}
export interface AppConfig {
  btc_address: string;
  pool_host: string;
  pool_port: number;
  pool_password: string;
  worker_name: string;
  cpu_threads: number;
  performance_preset: PerformancePreset;
  enable_notifications: boolean;
  notify_on_jackpot: boolean;
  notify_on_share_accepted: boolean;
  notify_on_connection_error: boolean;
  heartbeat_interval: HeartbeatInterval;
  notification_channel: NotificationChannel;
  webhook_url: string;
  pet_profile_id: string;
}

export type AppConfigInput = AppConfig;

export interface SystemInfo {
  available_parallelism: number;
  default_cpu_threads: number;
  recommended_cpu_threads: number;
}

export interface RuntimeCapabilities {
  availableCpuThreads: number;
  recommendedCpuThreads: number;
  signature: string;
}

export interface HardwareAdaptationResult {
  config: AppConfig;
  capabilities: RuntimeCapabilities;
  changed: boolean;
  messages: string[];
}

export type PoolDiagnosticStatus = "ok" | "failed" | "skipped";

export interface PoolDiagnosticStep {
  name: string;
  status: PoolDiagnosticStatus;
  message: string;
  duration_ms: number;
}

export interface PoolDiagnosticReport {
  generated_at: string;
  pool: string;
  steps: PoolDiagnosticStep[];
  summary: string;
}

export interface RealMiningStats {
  session_id: number;
  hashrate: number;
  accepted_shares: number;
  rejected_shares: number;
  stale_shares_dropped: number;
  queued_shares_dropped: number;
  best_difficulty: number;
  share_difficulty: number;
  current_job_id: string;
  connection_status: string;
}

export interface BlockFoundEvent {
  job_id: string;
  nonce: string;
  ntime: string;
  extranonce2: string;
  hash: string;
  difficulty: number;
  timestamp: string;
  pool: string;
}

export type MiningRuntimeEventPayload =
  | {
      session_id: number;
      type: "connection_status_changed";
      status: string;
      message: string;
    }
  | {
      session_id: number;
      type: "job_received";
      job_id: string;
      message: string;
    }
  | {
      session_id: number;
      type: "share_submitted" | "share_accepted" | "share_rejected";
      message: string;
    }
  | {
      session_id: number;
      type: "block_candidate";
      block: BlockFoundEvent;
    };

export interface MiningLogPayload {
  session_id: number | null;
  message: string;
}

export interface MiningBlockFoundPayload {
  session_id: number;
  block: BlockFoundEvent;
}

export function presetPort(poolHost: string, currentPort: number) {
  if (isKnownPoolHost(poolHost)) {
    return 3333;
  }

  return currentPort;
}

function isKnownPoolHost(poolHost: string) {
  const normalizedHost = poolHost.trim().toLowerCase();
  return (
    normalizedHost === "public-pool.io" ||
    normalizedHost === "pool.nerdminer.io" ||
    normalizedHost === "pool.nerdminers.org"
  );
}

function normalizePoolPort(poolHost: string, poolPort: number) {
  const port = Number.isFinite(poolPort) ? Math.trunc(poolPort) : 0;
  if (isKnownPoolHost(poolHost) && (port === 0 || port === 21496)) {
    return 3333;
  }

  if (port < 1 || port > 65535) {
    return 3333;
  }

  return port;
}

function normalizePoolPassword(poolPassword: string | null | undefined) {
  const trimmed = (poolPassword || "").trim();
  return trimmed || "x";
}

function appConfigEquals(left: AppConfig, right: AppConfig) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pushUnique(messages: string[], message: string) {
  if (!messages.includes(message)) {
    messages.push(message);
  }
}

export function createRuntimeCapabilities(
  systemInfo: SystemInfo,
): RuntimeCapabilities {
  const availableCpuThreads = Math.max(1, Math.trunc(Number(systemInfo.available_parallelism) || 1));
  const recommendedCpuThreads = Math.min(
    availableCpuThreads,
    Math.max(1, Math.trunc(Number(systemInfo.recommended_cpu_threads) || 1)),
  );
  return {
    availableCpuThreads,
    recommendedCpuThreads,
    signature: [
      `cpu:${availableCpuThreads}`,
      `rec:${recommendedCpuThreads}`,
    ].join("|"),
  };
}

export function normalizeAppConfig(
  config: AppConfigInput,
  systemInfo: SystemInfo,
): AppConfig {
  const poolHost = config.pool_host.trim() || "public-pool.io";
  const workerName = config.worker_name.trim() || "btc-lottery-pet";

  return {
    btc_address: config.btc_address.trim(),
    pool_host: poolHost,
    pool_port: normalizePoolPort(poolHost, Number(config.pool_port)),
    pool_password: normalizePoolPassword(config.pool_password),
    worker_name: workerName,
    performance_preset: config.performance_preset,
    enable_notifications: config.enable_notifications,
    notify_on_jackpot: config.notify_on_jackpot,
    notify_on_share_accepted: config.notify_on_share_accepted,
    notify_on_connection_error: config.notify_on_connection_error,
    heartbeat_interval: config.heartbeat_interval,
    notification_channel: config.notification_channel,
    webhook_url: config.webhook_url.trim(),
    pet_profile_id: normalizePetProfileId(config.pet_profile_id),
    cpu_threads: threadsForPreset(
      config.performance_preset,
      systemInfo,
      Number(config.cpu_threads),
    ),
  };
}

export function adaptConfigForHardware(
  config: AppConfig,
  systemInfo: SystemInfo,
): HardwareAdaptationResult {
  const capabilities = createRuntimeCapabilities(systemInfo);
  const messages: string[] = [];
  const next = normalizeAppConfig(config, systemInfo);

  const originalCpuThreads = Math.trunc(Number(config.cpu_threads) || 0);
  if (originalCpuThreads > 0 && next.cpu_threads !== originalCpuThreads) {
    pushUnique(messages, `CPU threads adjusted to ${next.cpu_threads} for this device.`);
  }

  return {
    config: next,
    capabilities,
    changed: !appConfigEquals(config, next),
    messages,
  };
}

export function realMiningStartError(
  config: AppConfig,
) {
  const poolHost = config.pool_host.trim();
  const poolPort = Number(config.pool_port);
  const workerName = config.worker_name.trim();

  if (!config.btc_address.trim()) {
    return "Add a BTC address before starting real mining.";
  }

  if (
    !poolHost ||
    /\s/.test(poolHost) ||
    poolHost.includes("://") ||
    poolHost.includes("/")
  ) {
    return "Pool host must be a hostname without spaces, URL scheme, or path.";
  }

  if (!Number.isInteger(poolPort) || poolPort < 1 || poolPort > 65535) {
    return "Pool port must be between 1 and 65535.";
  }

  const poolPassword = normalizePoolPassword(config.pool_password);
  if (poolPassword.length > 128 || /[\u0000-\u001F\u007F]/.test(poolPassword)) {
    return "Pool password must be 128 characters or fewer and cannot contain control characters.";
  }

  if (!workerName || !/^[A-Za-z0-9_-]+$/.test(workerName)) {
    return "Worker name may contain only letters, numbers, dashes, and underscores.";
  }

  return null;
}

export function formatDifficulty(value: number) {
  return value < 1_000
    ? value.toFixed(4)
    : Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export function formatHashrate(hashrate: number) {
  if (hashrate >= 1_000_000) {
    return `${(hashrate / 1_000_000).toFixed(2)} MH/s`;
  }

  if (hashrate >= 1_000) {
    return `${(hashrate / 1_000).toFixed(2)} KH/s`;
  }

  return `${hashrate.toFixed(0)} H/s`;
}

export function expectedSharesPerHour(hashrate: number, shareDifficulty: number) {
  if (!Number.isFinite(hashrate) || !Number.isFinite(shareDifficulty)) {
    return 0;
  }
  if (hashrate <= 0 || shareDifficulty <= 0) {
    return 0;
  }

  return hashrate * 3600 / (shareDifficulty * 2 ** 32);
}

export function formatShareRate(sharesPerHour: number) {
  if (!Number.isFinite(sharesPerHour) || sharesPerHour <= 0) {
    return "Waiting";
  }

  if (sharesPerHour < 0.001) {
    return "<0.001/h";
  }

  if (sharesPerHour < 1) {
    return `${sharesPerHour.toFixed(3)}/h`;
  }

  if (sharesPerHour < 100) {
    return `${sharesPerHour.toFixed(2)}/h`;
  }

  return `${Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(sharesPerHour)}/h`;
}

export function threadsForPreset(
  preset: PerformancePreset,
  systemInfo: SystemInfo,
  customThreads: number,
) {
  const availableThreads = Math.max(1, systemInfo.available_parallelism);
  const recommendedThreads = Math.min(
    availableThreads,
    Math.max(1, systemInfo.recommended_cpu_threads),
  );

  switch (preset) {
    case "eco":
      return 1;
    case "normal":
      return recommendedThreads;
    case "turbo":
      return availableThreads;
    case "custom":
      return Math.min(Math.max(1, customThreads), availableThreads);
  }
}
export interface RuntimeMiningProfile {
  cpuThreads: number;
  appliedRecommendation: boolean;
  source: "config" | "runtime_recommendation";
  reason: string;
}

function clampRuntimeCpuThreads(value: number | null | undefined, systemInfo: SystemInfo) {
  const availableThreads = Math.max(1, systemInfo.available_parallelism);
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Math.min(availableThreads, Math.max(1, normalized));
}

function recommendationCanAutoApply(recommendation: CpuRuntimeRecommendation | null | undefined) {
  return Boolean(
    recommendation?.canApplyProfile &&
    recommendation.autoApplyAllowed &&
    !recommendation.manualApprovalRequired &&
    !recommendation.opensHighHashBurst,
  );
}

export function resolveRuntimeMiningProfile(
  config: AppConfig,
  systemInfo: SystemInfo,
  recommendation?: CpuRuntimeRecommendation | null,
): RuntimeMiningProfile {
  const configCpuThreads = threadsForPreset(
    config.performance_preset,
    systemInfo,
    Number(config.cpu_threads),
  );
  const fallback: RuntimeMiningProfile = {
    cpuThreads: configCpuThreads,
    appliedRecommendation: false,
    source: "config",
    reason: "Using saved runtime settings.",
  };

  if (!recommendationCanAutoApply(recommendation)) {
    return fallback;
  }

  const nextCpuThreads = clampRuntimeCpuThreads(
    recommendation?.targetCpuThreads,
    systemInfo,
  ) ?? configCpuThreads;

  if (nextCpuThreads === configCpuThreads) {
    return fallback;
  }

  return {
    cpuThreads: nextCpuThreads,
    appliedRecommendation: true,
    source: "runtime_recommendation",
    reason: recommendation?.targetStepSummary
      ? `Applied runtime recommendation: ${recommendation.targetStepSummary}.`
      : recommendation?.summary ?? "Applied runtime recommendation.",
  };
}

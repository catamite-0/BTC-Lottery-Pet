import type { AlgorithmRouteDefaultAlgorithm } from "./domain/algorithmRouteCertificate.js";
import type { AlgorithmRuntimeRecommendationSnapshot } from "./domain/algorithmRuntimeRecommendation.js";
import type { PetStatus } from "./domain/petState";
import { normalizePetProfileId } from "./pets/profiles.js";

export type { PetStatus } from "./domain/petState";
export type ComputeMode = "cpu" | "gpu" | "hybrid";
export type PerformancePreset = "eco" | "normal" | "turbo" | "custom";
export type HeartbeatInterval = "off" | "30min" | "1h" | "6h";
export type NotificationChannel = "local_windows_toast" | "webhook";
export type ExternalHashInterface = "none" | "network" | "direct";

export type CpuKernelMode = "full_header" | "midstate";

export function cpuKernelModeForRouteAlgorithm(defaultAlgorithm: AlgorithmRouteDefaultAlgorithm): CpuKernelMode {
  return defaultAlgorithm === "double_sha256_midstate" ? "midstate" : "full_header";
}
export interface AppConfig {
  btc_address: string;
  pool_host: string;
  pool_port: number;
  pool_password: string;
  worker_name: string;
  cpu_threads: number;
  performance_preset: PerformancePreset;
  real_mining_enabled: boolean;
  enable_notifications: boolean;
  notify_on_jackpot: boolean;
  notify_on_share_accepted: boolean;
  notify_on_connection_error: boolean;
  heartbeat_interval: HeartbeatInterval;
  notification_channel: NotificationChannel;
  webhook_url: string;
  external_hash_interface: ExternalHashInterface;
  external_hash_network_host: string;
  external_hash_direct_port: string;
  external_hash_direct_endpoint?: string;
  external_hash_polling_enabled: boolean;
  external_hash_poll_interval_seconds: number;
  compute_mode: ComputeMode;
  gpu_enabled: boolean;
  gpu_device_id: string | null;
  gpu_intensity_percent: number;
  pet_profile_id: string;
}

export type AppConfigInput = AppConfig & {
  external_hash_direct_endpoint?: string | null;
};

export interface SystemInfo {
  available_parallelism: number;
  default_cpu_threads: number;
  recommended_cpu_threads: number;
}

export interface GpuDevice {
  id: string;
  name: string;
  simulated: boolean;
  diagnostic?: string | null;
}

export interface RuntimeCapabilities {
  availableCpuThreads: number;
  recommendedCpuThreads: number;
  hardwareGpuAvailable: boolean;
  softwareGpuAvailable: boolean;
  hardwareGpuIds: string[];
  softwareGpuIds: string[];
  signature: string;
}

export interface HardwareAdaptationResult {
  config: AppConfig;
  capabilities: RuntimeCapabilities;
  changed: boolean;
  messages: string[];
}

export interface GpuBenchmarkResult {
  device_id: string;
  device_name: string;
  simulated: boolean;
  gpu_intensity_percent: number;
  hashrate: number;
  duration_ms: number;
  note: string;
  generated_at: string;
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

export interface AsicTelemetryReport {
  generated_at: string;
  base_url: string;
  status: "ok" | "waiting" | "paused" | "failed" | string;
  summary: string;
  duration_ms: number;
  device_name: string;
  hostname: string;
  asic_model: string;
  board_version: string;
  firmware_version: string;
  axe_os_version: string;
  hash_rate_ghs: number;
  hash_rate_hs: number;
  expected_hashrate_ghs: number | null;
  power_watts: number | null;
  joules_per_terahash: number | null;
  temp_c: number | null;
  vr_temp_c: number | null;
  frequency_mhz: number | null;
  voltage: number | null;
  fan_rpm: number | null;
  shares_accepted: number | null;
  shares_rejected: number | null;
  pool_difficulty: number | null;
  best_difficulty: number | null;
  mining_paused: boolean | null;
  wifi_rssi: number | null;
  integration_stage?: string | null;
  capabilities?: string[] | null;
  engine_eligible?: boolean | null;
  can_control_mining?: boolean | null;
  can_submit_shares?: boolean | null;
  can_roll_version?: boolean | null;
  can_partition_work?: boolean | null;
}

export interface SimulationStats {
  status: PetStatus;
  hashrate: number;
  bestDifficulty: number;
}

export interface RealMiningStats {
  hashrate: number;
  accepted_shares: number;
  rejected_shares: number;
  stale_shares_dropped: number;
  queued_shares_dropped: number;
  best_difficulty: number;
  share_difficulty: number;
  current_job_id: string;
  connection_status: string;
  gpu_backend: string;
  gpu_device_name: string;
  gpu_dispatch_size: number;
  gpu_dispatch_ms: number;
  gpu_throttle_ms: number;
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
  devices: GpuDevice[],
): RuntimeCapabilities {
  const availableCpuThreads = Math.max(1, Math.trunc(Number(systemInfo.available_parallelism) || 1));
  const recommendedCpuThreads = Math.min(
    availableCpuThreads,
    Math.max(1, Math.trunc(Number(systemInfo.recommended_cpu_threads) || 1)),
  );
  const hardwareGpuIds = devices
    .filter((device) => device.id !== "auto" && !device.simulated)
    .map((device) => device.id)
    .sort();
  const softwareGpuIds = devices
    .filter((device) => device.id !== "auto" && device.simulated)
    .map((device) => device.id)
    .sort();

  return {
    availableCpuThreads,
    recommendedCpuThreads,
    hardwareGpuAvailable: hardwareGpuIds.length > 0,
    softwareGpuAvailable: softwareGpuIds.length > 0,
    hardwareGpuIds,
    softwareGpuIds,
    signature: [
      `cpu:${availableCpuThreads}`,
      `rec:${recommendedCpuThreads}`,
      `gpu:${hardwareGpuIds.join(",") || "none"}`,
      `soft:${softwareGpuIds.join(",") || "none"}`,
    ].join("|"),
  };
}

export function normalizeAppConfig(
  config: AppConfigInput,
  systemInfo: SystemInfo,
  devices: GpuDevice[],
): AppConfig {
  const poolHost = config.pool_host.trim() || "public-pool.io";
  const workerName = config.worker_name.trim() || "btc-lottery-pet";
  const computeMode = config.compute_mode;
  const isGpuMode = isGpuComputeMode(computeMode);
  const isGpuOnly = computeMode === "gpu";
  const {
    external_hash_direct_endpoint: _directEndpointAlias,
    ...configWithoutAliases
  } = config;

  return {
    ...configWithoutAliases,
    btc_address: config.btc_address.trim(),
    pool_host: poolHost,
    pool_port: normalizePoolPort(poolHost, Number(config.pool_port)),
    pool_password: normalizePoolPassword(config.pool_password),
    worker_name: workerName,
    webhook_url: config.webhook_url.trim(),
    external_hash_interface: "none",
    external_hash_network_host: "",
    external_hash_direct_port: "",
    external_hash_direct_endpoint: "",
    external_hash_polling_enabled: false,
    external_hash_poll_interval_seconds: 60,
    real_mining_enabled: false,
    cpu_threads: threadsForPreset(
      config.performance_preset,
      systemInfo,
      Number(config.cpu_threads),
      isGpuOnly,
    ),
    gpu_enabled: isGpuMode,
    gpu_device_id: isGpuMode ? sanitizeGpuDeviceId(config.gpu_device_id, devices) : null,
    gpu_intensity_percent: Math.min(
      100,
      Math.max(1, Math.trunc(Number(config.gpu_intensity_percent) || 10)),
    ),
    pet_profile_id: normalizePetProfileId(config.pet_profile_id),
  };
}

export function adaptConfigForHardware(
  config: AppConfig,
  systemInfo: SystemInfo,
  devices: GpuDevice[],
): HardwareAdaptationResult {
  const capabilities = createRuntimeCapabilities(systemInfo, devices);
  const messages: string[] = [];
  const requestedGpuDeviceId = config.gpu_device_id && config.gpu_device_id !== "auto"
    ? config.gpu_device_id
    : null;
  let next = normalizeAppConfig(config, systemInfo, devices);

  if (
    requestedGpuDeviceId &&
    isGpuComputeMode(config.compute_mode) &&
    next.gpu_device_id !== requestedGpuDeviceId
  ) {
    pushUnique(messages, "Selected GPU was not available on this device; using Auto GPU.");
  }

  if (!capabilities.hardwareGpuAvailable && isGpuComputeMode(next.compute_mode)) {
    next = {
      ...next,
      compute_mode: "cpu",
      gpu_enabled: false,
      gpu_device_id: null,
      cpu_threads: threadsForPreset(
        next.performance_preset,
        systemInfo,
        Number(config.cpu_threads),
        false,
      ),
    };
    pushUnique(messages, "No hardware GPU detected; switched compute mode to CPU.");
  }

  const originalCpuThreads = Math.trunc(Number(config.cpu_threads) || 0);
  if (next.compute_mode !== "gpu" && originalCpuThreads > 0 && next.cpu_threads !== originalCpuThreads) {
    pushUnique(messages, `CPU threads adjusted to ${next.cpu_threads} for this device.`);
  }

  const originalIntensity = Math.trunc(Number(config.gpu_intensity_percent) || 0);
  if (originalIntensity > 0 && next.gpu_intensity_percent !== originalIntensity) {
    pushUnique(messages, `GPU limit adjusted to ${next.gpu_intensity_percent}%.`);
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
  devices: GpuDevice[],
  runningInTauri: boolean,
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

  if (isGpuComputeMode(config.compute_mode) && runningInTauri && !hasHardwareGpuDevice(devices)) {
    return "No hardware GPU detected. Switch to CPU mode, or update GPU drivers.";
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
  gpuOnly = false,
) {
  if (gpuOnly) {
    return 0;
  }

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
  gpuIntensityPercent: number;
  appliedRecommendation: boolean;
  source: "config" | "runtime_recommendation";
  reason: string;
}

function clampGpuIntensity(value: number | null | undefined, fallback: number) {
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }
  return Math.min(100, Math.max(1, normalized));
}

function clampRuntimeCpuThreads(value: number | null | undefined, systemInfo: SystemInfo, gpuOnly: boolean) {
  if (gpuOnly) {
    return 0;
  }
  const availableThreads = Math.max(1, systemInfo.available_parallelism);
  const normalized = Math.trunc(Number(value));
  if (!Number.isFinite(normalized)) {
    return null;
  }
  return Math.min(availableThreads, Math.max(1, normalized));
}

function recommendationCanAutoApply(recommendation: AlgorithmRuntimeRecommendationSnapshot | null | undefined) {
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
  recommendation?: AlgorithmRuntimeRecommendationSnapshot | null,
): RuntimeMiningProfile {
  const configCpuThreads = threadsForPreset(
    config.performance_preset,
    systemInfo,
    Number(config.cpu_threads),
    config.compute_mode === "gpu",
  );
  const configGpuIntensity = clampGpuIntensity(config.gpu_intensity_percent, 10);
  const fallback: RuntimeMiningProfile = {
    cpuThreads: configCpuThreads,
    gpuIntensityPercent: configGpuIntensity,
    appliedRecommendation: false,
    source: "config",
    reason: "Using saved runtime settings.",
  };

  if (!recommendationCanAutoApply(recommendation)) {
    return fallback;
  }

  if (recommendation?.targetComputeMode && recommendation.targetComputeMode !== config.compute_mode) {
    return {
      ...fallback,
      reason: `Runtime recommendation targets ${recommendation.targetComputeMode}, while current mode is ${config.compute_mode}.`,
    };
  }

  const nextCpuThreads = clampRuntimeCpuThreads(
    recommendation?.targetCpuThreads,
    systemInfo,
    config.compute_mode === "gpu",
  ) ?? configCpuThreads;
  const nextGpuIntensity = isGpuComputeMode(config.compute_mode)
    ? clampGpuIntensity(recommendation?.targetGpuIntensityPercent, configGpuIntensity)
    : configGpuIntensity;

  if (nextCpuThreads === configCpuThreads && nextGpuIntensity === configGpuIntensity) {
    return fallback;
  }

  return {
    cpuThreads: nextCpuThreads,
    gpuIntensityPercent: nextGpuIntensity,
    appliedRecommendation: true,
    source: "runtime_recommendation",
    reason: recommendation?.targetStepSummary
      ? `Applied runtime recommendation: ${recommendation.targetStepSummary}.`
      : recommendation?.summary ?? "Applied runtime recommendation.",
  };
}

export function isGpuComputeMode(mode: ComputeMode) {
  return mode === "gpu" || mode === "hybrid";
}

export function hasHardwareGpuDevice(devices: GpuDevice[]) {
  return devices.some((device) => device.id !== "auto" && !device.simulated);
}

export function hasSoftwareGpuDevice(devices: GpuDevice[]) {
  return devices.some((device) => device.id !== "auto" && device.simulated);
}

export function sanitizeGpuDeviceId(deviceId: string | null, devices: GpuDevice[]) {
  if (!deviceId || deviceId === "auto") {
    return null;
  }

  const device = devices.find((candidate) => candidate.id === deviceId);
  return device && !device.simulated ? deviceId : null;
}

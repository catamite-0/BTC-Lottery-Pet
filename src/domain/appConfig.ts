import type {
  AppConfig,
  AppConfigInput,
  HardwareAdaptationResult,
  PerformancePreset,
  RuntimeCapabilities,
  SystemInfo,
} from "../contracts/config";
import type { RuntimeMiningProfile } from "../contracts/mining";
import { normalizePetProfileId } from "../pets/profiles.js";

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
  const poolPasswordBytes = new TextEncoder().encode(poolPassword).length;
  if (poolPasswordBytes > 128 || /[\u0000-\u001F\u007F-\u009F]/.test(poolPassword)) {
    return "Pool password must be 128 UTF-8 bytes or fewer and cannot contain control characters.";
  }

  if (!workerName || !/^[A-Za-z0-9_-]+$/.test(workerName)) {
    return "Worker name may contain only letters, numbers, dashes, and underscores.";
  }

  return null;
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
      return Math.max(1, availableThreads - 1);
    case "custom":
      return Math.min(Math.max(1, customThreads), availableThreads);
  }
}

export function resolveRuntimeMiningProfile(
  config: AppConfig,
  systemInfo: SystemInfo,
): RuntimeMiningProfile {
  return {
    cpuThreads: threadsForPreset(
      config.performance_preset,
      systemInfo,
      Number(config.cpu_threads),
    ),
  };
}

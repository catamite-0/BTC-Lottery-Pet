export type PerformancePreset = "eco" | "normal" | "turbo" | "custom";

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

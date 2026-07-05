export type {
  BlockFoundEvent,
  MiningBlockFoundPayload,
  MiningLogPayload,
  MiningRuntimeEventPayload,
  PoolDiagnosticReport,
  PoolDiagnosticStep,
  PoolDiagnosticStatus,
  RealMiningStats,
  RuntimeMiningProfile,
} from "../miningLogic";

export interface StartRealMiningSettings {
  poolHost: string;
  poolPort: number;
  poolPassword: string;
  btcAddress: string;
  workerName: string;
  cpuThreads: number;
  confirmedCpuUse: boolean;
}

export interface PoolDiagnosticSettingsPayload {
  poolHost: string;
  poolPort: number;
  poolPassword: string;
  btcAddress: string;
  workerName: string;
}

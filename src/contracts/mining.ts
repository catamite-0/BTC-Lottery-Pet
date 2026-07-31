export type {
  BlockFoundEvent,
  MiningBlockFoundPayload,
  MiningLogPayload,
  MiningRuntimeEventPayload,
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

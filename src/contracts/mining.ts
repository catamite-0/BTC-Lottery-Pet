import type { MiningLogPayload } from "../miningLogic";

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

export function miningLogMessageForActiveSession(
  payload: string | MiningLogPayload,
  activeSessionId: number | null,
) {
  if (typeof payload === "string") {
    return payload;
  }

  if (payload.session_id === null) {
    return payload.message;
  }

  return payload.session_id === activeSessionId ? payload.message : null;
}

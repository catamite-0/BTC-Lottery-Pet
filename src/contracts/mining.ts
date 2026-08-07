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
  submission_status: "accepted" | "rejected" | "unknown";
  submission_message: string | null;
  pool: string;
  record_saved: boolean;
  record_file: string | null;
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

export interface RuntimeMiningProfile {
  cpuThreads: number;
}

export interface StartRealMiningSettings {
  poolHost: string;
  poolPort: number;
  poolPassword: string;
  btcAddress: string;
  workerName: string;
  cpuThreads: number;
  confirmedCpuUse: boolean;
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

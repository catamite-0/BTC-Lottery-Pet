import type {
  BlockFoundEvent,
  MiningRuntimeEventPayload,
  RealMiningStats,
} from "../miningLogic";

export type StructuredMiningEvent =
  | {
      type: "connection_status_changed";
      status: string;
      message: string;
    }
  | {
      type: "job_received";
      jobId: string | null;
      message: string;
    }
  | {
      type: "share_submitted" | "share_accepted" | "share_rejected";
      message: string;
    }
  | {
      type: "block_candidate";
      block: BlockFoundEvent;
    };

export interface StructuredMiningEventState {
  connectionStatus: string | null;
  currentJobId: string | null;
  lastShare: string | null;
  shareEventType: "share_accepted" | "share_rejected" | null;
  connectionErrorStatus: string | null;
  jackpotPauseRequested: boolean;
  blockCandidate: BlockFoundEvent | null;
  petLogMessage: string | null;
}

export function cleanMiningLogMessage(message: string) {
  return message.replace(/^\[[^\]]+\]\s*/, "");
}

export function createStructuredMiningEventState(
  stats: Partial<Pick<RealMiningStats, "connection_status" | "current_job_id">> = {},
): StructuredMiningEventState {
  return {
    connectionStatus: stats.connection_status ?? null,
    currentJobId: stats.current_job_id ?? null,
    lastShare: null,
    shareEventType: null,
    connectionErrorStatus: null,
    jackpotPauseRequested: false,
    blockCandidate: null,
    petLogMessage: null,
  };
}

export function structuredMiningEventsFromStats(stats: RealMiningStats): StructuredMiningEvent[] {
  void stats;
  return [];
}

export function structuredMiningEventFromRuntimePayload(
  payload: MiningRuntimeEventPayload,
): StructuredMiningEvent {
  switch (payload.type) {
    case "connection_status_changed":
      return {
        type: "connection_status_changed",
        status: payload.status,
        message: payload.message,
      };
    case "job_received":
      return {
        type: "job_received",
        jobId: payload.job_id,
        message: payload.message,
      };
    case "share_submitted":
      return {
        type: "share_submitted",
        message: payload.message,
      };
    case "share_accepted":
      return {
        type: "share_accepted",
        message: payload.message,
      };
    case "share_rejected":
      return {
        type: "share_rejected",
        message: payload.message,
      };
    case "block_candidate":
      return {
        type: "block_candidate",
        block: payload.block,
      };
  }
}

export function structuredMiningEventFromBlockCandidate(block: BlockFoundEvent): StructuredMiningEvent {
  return {
    type: "block_candidate",
    block,
  };
}

export function reduceStructuredMiningEvent(
  state: StructuredMiningEventState,
  event: StructuredMiningEvent,
): StructuredMiningEventState {
  switch (event.type) {
    case "connection_status_changed":
      return {
        ...state,
        connectionStatus: event.status,
        connectionErrorStatus: event.status === "Connection Error" ? event.message : state.connectionErrorStatus,
        petLogMessage: petLogMessageForConnectionStatus(event.status) ?? state.petLogMessage,
      };
    case "job_received":
      return {
        ...state,
        connectionStatus: "Mining",
        currentJobId: event.jobId ?? state.currentJobId,
        petLogMessage: "A fresh puzzle arrived.",
      };
    case "share_submitted":
      return {
        ...state,
        lastShare: event.message,
      };
    case "share_accepted":
      return {
        ...state,
        lastShare: event.message,
        shareEventType: "share_accepted",
      };
    case "share_rejected":
      return {
        ...state,
        lastShare: event.message,
        shareEventType: "share_rejected",
      };
    case "block_candidate":
      return {
        ...state,
        connectionStatus: "Jackpot pause",
        jackpotPauseRequested: true,
        blockCandidate: event.block,
      };
  }
}

export function reduceStructuredMiningEvents(
  state: StructuredMiningEventState,
  events: StructuredMiningEvent[],
): StructuredMiningEventState {
  return events.reduce(reduceStructuredMiningEvent, state);
}

function petLogMessageForConnectionStatus(status: string) {
  switch (status) {
    case "Connected":
      return "I found the pool signal.";
    case "Authorized":
      return "The pool knows my name.";
    case "Connection Error":
      return "I lost the pool signal.";
    default:
      return null;
  }
}

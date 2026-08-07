import type {
  BlockFoundEvent,
  MiningRuntimeEventPayload,
  RealMiningStats,
} from "../contracts/mining";
import {
  createBlockCandidateEvent,
  createJackpotEvent,
  createShareEvent,
  type MiningEvent,
} from "./miningEvents.js";
import {
  cleanMiningLogMessage,
  createStructuredMiningEventState,
  reduceStructuredMiningEvent,
  structuredMiningEventFromRuntimePayload,
  type StructuredMiningEventState,
} from "./structuredMiningEvents.js";

export interface MiningRuntimeEffects {
  connectionStatus: string | null;
  currentJobId: string | null;
  lastShare: string | null;
  petLogMessages: string[];
  uiEvents: MiningEvent[];
  jackpotPauseRequested: boolean;
  blockCandidate: BlockFoundEvent | null;
  notifyShareAccepted: boolean;
  notifyJackpot: boolean;
  connectionErrorMessage: string | null;
  devLogMessage: string | null;
}

export interface MiningRuntimeEffectsContext {
  wasMining: boolean;
  stats: Partial<Pick<RealMiningStats, "connection_status" | "current_job_id">>;
}

function emptyEffects(
  state: StructuredMiningEventState,
): MiningRuntimeEffects {
  return {
    connectionStatus: state.connectionStatus,
    currentJobId: state.currentJobId,
    lastShare: state.lastShare,
    petLogMessages: [],
    uiEvents: [],
    jackpotPauseRequested: state.jackpotPauseRequested,
    blockCandidate: state.blockCandidate,
    notifyShareAccepted: false,
    notifyJackpot: false,
    connectionErrorMessage: state.connectionErrorStatus,
    devLogMessage: null,
  };
}

function petLogMessageFromShareOrCandidate(
  type: "share_accepted" | "share_rejected" | "block_candidate" | "jackpot",
): string {
  switch (type) {
    case "share_accepted":
      return "I feel lucky...";
    case "share_rejected":
      return "That pattern slipped away.";
    case "block_candidate":
      return "Something is happening...";
    case "jackpot":
      return "I found a strange pattern...";
  }
}

/**
 * Single runtime → UI effects path. Callers apply the returned patch; they should
 * not re-derive pet logs or MiningEvent attention from a second parallel model.
 */
export function effectsFromRuntimePayload(
  payload: MiningRuntimeEventPayload,
  context: MiningRuntimeEffectsContext,
): MiningRuntimeEffects {
  const structuredEvent = structuredMiningEventFromRuntimePayload(payload);
  const state = reduceStructuredMiningEvent(
    createStructuredMiningEventState(context.stats),
    structuredEvent,
  );
  const effects = emptyEffects(state);

  if (state.petLogMessage) {
    effects.petLogMessages.push(state.petLogMessage);
  }

  if (payload.type === "block_candidate") {
    const block = payload.block;
    effects.uiEvents.push(
      createBlockCandidateEvent("cpu", block),
      createJackpotEvent(block),
    );
    effects.petLogMessages.push(
      petLogMessageFromShareOrCandidate("block_candidate"),
      petLogMessageFromShareOrCandidate("jackpot"),
    );
    effects.notifyJackpot = true;
    effects.devLogMessage = `Block candidate found: job=${block.job_id}, hash=${block.hash}`;
    effects.jackpotPauseRequested = context.wasMining && state.jackpotPauseRequested;
    return effects;
  }

  if (!context.wasMining) {
    return emptyEffects(createStructuredMiningEventState(context.stats));
  }

  if (state.shareEventType) {
    const cleanMessage =
      "message" in payload ? cleanMiningLogMessage(payload.message) : "";
    effects.uiEvents.push(createShareEvent(state.shareEventType, "cpu", cleanMessage));
    effects.petLogMessages.push(petLogMessageFromShareOrCandidate(state.shareEventType));
    effects.notifyShareAccepted = state.shareEventType === "share_accepted";
  }

  return effects;
}

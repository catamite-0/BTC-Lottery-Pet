import type { JackpotSequencePhase } from "./jackpotSequence";
import type { MiningEvent } from "./miningEvents";

export type PetState =
  | "IDLE"
  | "MINING_CPU"
  | "MINING_POOL"
  | "LUCKY_EVENT"
  | "DISCONNECTED"
  | "ERROR";

export type PetStatus =
  | "Sleeping"
  | "Connecting"
  | "Mining"
  | "Overdrive"
  | "Lucky Flash"
  | "Cooling Down"
  | "Connection Error"
  | "New Best Diff"
  | "Jackpot";

export interface PetStateContext {
  isMining: boolean;
  isCoolingDown: boolean;
  attentionEventType?: MiningEvent["type"] | null;
  jackpotPhase?: JackpotSequencePhase;
  connectionStatus: string;
  currentJobId: string;
}

export function isConnectionProblem(connectionStatus: string) {
  const normalized = connectionStatus.toLowerCase();
  return (
    connectionStatus.startsWith("Retrying") ||
    normalized.includes("error") ||
    normalized.includes("failed") ||
    normalized.includes("unavailable")
  );
}

export function isPoolHandshake(connectionStatus: string, currentJobId: string) {
  if (currentJobId) {
    return false;
  }

  const normalized = connectionStatus.toLowerCase();
  return ["starting", "connecting", "subscribing", "authorizing", "connected", "authorized"].some(
    (status) => normalized.startsWith(status),
  );
}

export function derivePetState(context: PetStateContext): PetState {
  if (
    context.jackpotPhase &&
    context.jackpotPhase !== "idle" &&
    context.jackpotPhase !== "complete"
  ) {
    return "LUCKY_EVENT";
  }

  if (
    context.attentionEventType === "share_accepted" ||
    context.attentionEventType === "block_candidate" ||
    context.attentionEventType === "jackpot"
  ) {
    return "LUCKY_EVENT";
  }

  if (!context.isMining && !context.isCoolingDown) {
    return "IDLE";
  }

  if (context.isCoolingDown) {
    return "DISCONNECTED";
  }

  if (isConnectionProblem(context.connectionStatus)) {
    return "ERROR";
  }

  if (isPoolHandshake(context.connectionStatus, context.currentJobId)) {
    return "MINING_POOL";
  }

  return "MINING_CPU";
}

export function petStatusFromState(state: PetState, context: PetStateContext): PetStatus {
  switch (state) {
    case "IDLE":
      return "Sleeping";
    case "MINING_CPU":
      return "Mining";
    case "MINING_POOL":
      return "Connecting";
    case "LUCKY_EVENT":
      if (
        context.attentionEventType === "jackpot" ||
        context.attentionEventType === "block_candidate" ||
        (context.jackpotPhase && context.jackpotPhase !== "idle" && context.jackpotPhase !== "complete")
      ) {
        return "Jackpot";
      }
      return "Lucky Flash";
    case "DISCONNECTED":
      return "Cooling Down";
    case "ERROR":
      return "Connection Error";
  }
}

export function isAnimatedMiningState(state: PetState) {
  return state === "MINING_CPU";
}

export function petStateLabel(state: PetState) {
  return state.replace(/_/g, " ");
}

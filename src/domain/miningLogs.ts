import type { MiningEvent } from "./miningEvents";

export function petLogMessageFromMiningEvent(event: MiningEvent) {
  switch (event.type) {
    case "hash_attempt":
      return null;
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

import type { MiningEvent } from "../domain/miningEvents";
import type { PetState, PetStatus } from "../domain/petState";
import type { PetProfile } from "./profiles.js";

export type PetMood =
  | "resting"
  | "curious"
  | "focused"
  | "hyped"
  | "proud"
  | "stressed"
  | "recovering";

export interface PetCompanionSnapshot {
  name: string;
  species: string;
  mood: PetMood;
  moodLabel: string;
  reaction: string;
  ariaLabel: string;
}

export interface PetCompanionContext {
  profile: PetProfile;
  petState: PetState;
  petStatus: PetStatus;
  lastEvent: MiningEvent | null;
}

const moodLabels: Record<PetMood, string> = {
  resting: "Resting",
  curious: "Curious",
  focused: "Focused",
  hyped: "Hyped",
  proud: "Proud",
  stressed: "Needs help",
  recovering: "Cooling",
};

export function petMoodFromStatus(status: PetStatus): PetMood {
  switch (status) {
    case "Sleeping":
      return "resting";
    case "Connecting":
      return "curious";
    case "Mining":
      return "focused";
    case "Overdrive":
      return "hyped";
    case "Lucky Flash":
    case "New Best Diff":
    case "Jackpot":
      return "proud";
    case "Cooling Down":
      return "recovering";
    case "Connection Error":
      return "stressed";
  }
}

function reactionForStatus(profile: PetProfile, status: PetStatus, lastEvent: MiningEvent | null) {
  const voice = profile.personality.voice;

  if (lastEvent?.type === "share_rejected") {
    return voice.rejected;
  }

  switch (status) {
    case "Sleeping":
      return voice.idle;
    case "Connecting":
      return voice.connecting;
    case "Mining":
      return voice.mining;
    case "Overdrive":
      return voice.overdrive;
    case "Lucky Flash":
    case "New Best Diff":
      return voice.lucky;
    case "Jackpot":
      return voice.jackpot;
    case "Cooling Down":
      return voice.coolingDown;
    case "Connection Error":
      return voice.error;
  }
}

export function derivePetCompanionSnapshot(context: PetCompanionContext): PetCompanionSnapshot {
  const mood = petMoodFromStatus(context.petStatus);
  return {
    name: context.profile.personality.name,
    species: context.profile.personality.species,
    mood,
    moodLabel: moodLabels[mood],
    reaction: reactionForStatus(context.profile, context.petStatus, context.lastEvent),
    ariaLabel: `${context.profile.personality.name}, ${moodLabels[mood]} ${context.profile.personality.species}`,
  };
}

import type { PetState } from "./petState";

export interface MiningSessionStatus {
  petState: PetState;
  running: boolean;
  label: string;
}

export function createMiningSessionStatus(
  petState: PetState,
  running: boolean,
  label: string,
): MiningSessionStatus {
  return { petState, running, label };
}

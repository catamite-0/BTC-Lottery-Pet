import type { PetState } from "../domain/petState";

export type MiningEngineKind = "cpu";

export interface MiningEngineStatus {
  kind: MiningEngineKind;
  petState: PetState;
  running: boolean;
  label: string;
}

export interface MiningEngine {
  kind: MiningEngineKind;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  status: () => MiningEngineStatus;
}

export interface MiningEngineLifecycle {
  prepareStart: () => void;
  startReal: () => Promise<void>;
  stopReal: () => Promise<void>;
  status: (kind: MiningEngineKind) => MiningEngineStatus;
}

export function createCpuMiningEngine(args: MiningEngineLifecycle): MiningEngine {
  return {
    kind: "cpu",
    start: async () => {
      args.prepareStart();
      await args.startReal();
    },
    stop: async () => {
      await args.stopReal();
    },
    status: () => args.status("cpu"),
  };
}

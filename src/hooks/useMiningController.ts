import { useMemo } from "react";
import type { MiningMode } from "../domain/miningMode";
import { petStateLabel } from "../domain/petState";
import type { PetState } from "../domain/petState";
import type { MiningEngineKind, MiningEngineLifecycle } from "../engines/miningEngine";
import { useMiningEngineController } from "./useMiningEngineController";
import type { ComputeMode } from "../miningLogic";

interface UseMiningControllerArgs {
  realModeEnabled: boolean;
  selectedMiningMode: MiningMode | null;
  computeMode: ComputeMode;
  petState: PetState;
  isMining: boolean;
  prepareStart: () => void;
  startSimulation: () => void;
  startReal: (kind: Exclude<MiningEngineKind, "simulation">) => Promise<void>;
  stopSimulation: () => void;
  stopReal: () => Promise<void>;
}

export function useMiningController({
  realModeEnabled,
  selectedMiningMode,
  computeMode,
  petState,
  isMining,
  prepareStart,
  startSimulation,
  startReal,
  stopSimulation,
  stopReal,
}: UseMiningControllerArgs) {
  const lifecycle = useMemo<MiningEngineLifecycle>(() => ({
    prepareStart,
    startSimulation,
    startReal,
    stopSimulation,
    stopReal,
    status: (kind: MiningEngineKind) => ({
      kind,
      petState,
      running: isMining,
      label: petStateLabel(petState),
    }),
  }), [
    isMining,
    petState,
    prepareStart,
    startReal,
    startSimulation,
    stopReal,
    stopSimulation,
  ]);

  const miningEngine = useMiningEngineController({
    realModeEnabled,
    selectedMiningMode,
    computeMode,
    lifecycle,
  });

  return {
    miningEngine,
    miningEngineStatus: miningEngine.status(),
  };
}

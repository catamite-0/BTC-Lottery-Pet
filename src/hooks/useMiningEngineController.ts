import { useMemo } from "react";
import type { ComputeMode } from "../miningLogic";
import type { MiningMode } from "../domain/miningMode";
import {
  createCpuMiningEngine,
  createGpuMiningEngine,
  createSimulationEngine,
  createStratumMiningEngine,
} from "../engines/miningEngine";
import type { MiningEngine, MiningEngineLifecycle } from "../engines/miningEngine";

interface UseMiningEngineControllerArgs {
  realModeEnabled: boolean;
  selectedMiningMode: MiningMode | null;
  computeMode: ComputeMode;
  lifecycle: MiningEngineLifecycle;
}

export function useMiningEngineController({
  realModeEnabled,
  selectedMiningMode,
  computeMode,
  lifecycle,
}: UseMiningEngineControllerArgs): MiningEngine {
  return useMemo(() => {
    if (!realModeEnabled) {
      return createSimulationEngine(lifecycle);
    }
    if (selectedMiningMode === "solo") {
      return createStratumMiningEngine(lifecycle);
    }
    if (computeMode === "cpu") {
      return createCpuMiningEngine(lifecycle);
    }
    return createGpuMiningEngine(lifecycle);
  }, [computeMode, lifecycle, realModeEnabled, selectedMiningMode]);
}

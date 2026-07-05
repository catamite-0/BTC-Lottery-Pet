import { useMemo } from "react";
import { createCpuMiningEngine } from "../engines/miningEngine";
import type { MiningEngine, MiningEngineLifecycle } from "../engines/miningEngine";

interface UseMiningEngineControllerArgs {
  lifecycle: MiningEngineLifecycle;
}

export function useMiningEngineController({
  lifecycle,
}: UseMiningEngineControllerArgs): MiningEngine {
  return useMemo(() => createCpuMiningEngine(lifecycle), [lifecycle]);
}

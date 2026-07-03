export type ThermalGuardStatus = "unknown" | "cool" | "warm" | "hot" | "critical" | "paused";

export interface ThermalGuardInput {
  tempC?: number | null;
  vrTempC?: number | null;
  fanRpm?: number | null;
  miningPaused?: boolean | null;
}

export interface ThermalGuardSnapshot {
  status: ThermalGuardStatus;
  qualityWeight: number;
  maxObservedTempC: number | null;
  summary: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function thermalNumber(value: number | null | undefined) {
  return finitePositive(value) ? Number(value) : null;
}

export function calculateThermalGuard(input: ThermalGuardInput): ThermalGuardSnapshot {
  const tempC = thermalNumber(input.tempC);
  const vrTempC = thermalNumber(input.vrTempC);
  const fanRpm = thermalNumber(input.fanRpm);
  const maxObservedTempC = Math.max(tempC ?? Number.NEGATIVE_INFINITY, vrTempC ?? Number.NEGATIVE_INFINITY);
  const maxTemp = Number.isFinite(maxObservedTempC) ? maxObservedTempC : null;

  if (input.miningPaused === true) {
    return {
      status: "paused",
      qualityWeight: 0.35,
      maxObservedTempC: maxTemp,
      summary: "Thermal guard: device reports mining paused.",
    };
  }

  if (maxTemp === null) {
    return {
      status: "unknown",
      qualityWeight: 1,
      maxObservedTempC: null,
      summary: "Thermal guard: waiting for temperature telemetry.",
    };
  }

  if (tempC !== null && tempC >= 90 || vrTempC !== null && vrTempC >= 110) {
    return {
      status: "critical",
      qualityWeight: 0.2,
      maxObservedTempC: maxTemp,
      summary: `Thermal guard: critical temperature at ${maxTemp.toFixed(1)} C.`,
    };
  }

  if (tempC !== null && tempC >= 80 || vrTempC !== null && vrTempC >= 100 || fanRpm === null && maxTemp >= 70) {
    return {
      status: "hot",
      qualityWeight: 0.5,
      maxObservedTempC: maxTemp,
      summary: `Thermal guard: hot profile at ${maxTemp.toFixed(1)} C.`,
    };
  }

  if (maxTemp >= 65) {
    return {
      status: "warm",
      qualityWeight: 0.82,
      maxObservedTempC: maxTemp,
      summary: `Thermal guard: warm but usable at ${maxTemp.toFixed(1)} C.`,
    };
  }

  return {
    status: "cool",
    qualityWeight: 1,
    maxObservedTempC: maxTemp,
    summary: `Thermal guard: cool at ${maxTemp.toFixed(1)} C.`,
  };
}
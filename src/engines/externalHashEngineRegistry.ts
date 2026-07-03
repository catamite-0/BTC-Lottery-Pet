import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashEngineCandidateGate,
} from "../domain/externalHashInterface.js";
import type {
  ExternalHashCapability,
  ExternalHashCapabilityMatrix,
  ExternalHashEngineCandidateGate,
  ExternalHashSnapshot,
} from "../domain/externalHashInterface.js";
import { deriveExternalHashEngineValidationChecklist } from "./externalHashEngineValidation.js";
import type { ExternalHashEngineValidationChecklist } from "./externalHashEngineValidation.js";

export type ExternalHashEngineRegistryStatus = ExternalHashEngineCandidateGate["status"];
export type ExternalHashEngineKind = "external-hash";

export interface ExternalHashEngineRegistryEntry {
  kind: ExternalHashEngineKind;
  label: string;
  endpoint: string;
  efficiencyReady: boolean;
  performanceReady: boolean;
  integrationReady: boolean;
  startAllowed: boolean;
  validationRequired: boolean;
  validationStatus: ExternalHashEngineValidationChecklist["status"];
}

export interface ExternalHashEngineRegistryDecision {
  kind: ExternalHashEngineKind;
  status: ExternalHashEngineRegistryStatus;
  registerable: boolean;
  startAllowed: boolean;
  telemetryOnly: boolean;
  efficiencyReady: boolean;
  performanceReady: boolean;
  integrationReady: boolean;
  missingCapabilities: ExternalHashCapability[];
  advisoryMissingCapabilities: ExternalHashCapability[];
  validation: ExternalHashEngineValidationChecklist;
  entry: ExternalHashEngineRegistryEntry | null;
  summary: string;
  nextStep: string;
}

function registrySummary(
  gate: ExternalHashEngineCandidateGate,
  validation: ExternalHashEngineValidationChecklist,
) {
  switch (gate.status) {
    case "candidate":
      if (validation.integrationReady) {
        if (!gate.efficiencyReady) {
          return "ExternalHashEngine is integration-ready, but lowest-power routing still needs power telemetry and a hardware release review.";
        }
        return gate.performanceReady
          ? "ExternalHashEngine is integration-ready, but mining start remains reserved until a real hardware release review."
          : "ExternalHashEngine is integration-ready, but highest-hash routing still needs version rolling and a hardware release review.";
      }

      if (!gate.efficiencyReady) {
        return "ExternalHashEngine can be registered as a reserved candidate, but lowest-power routing still needs power telemetry.";
      }
      return gate.performanceReady
        ? "ExternalHashEngine can be registered as a reserved candidate after validation."
        : "ExternalHashEngine can be registered as a reserved candidate, but highest-hash routing still needs version rolling.";
    case "telemetry-only":
      return "External adapter is telemetry-only; registry will not expose it as a mining engine.";
    case "reserved":
      return "External adapter is reserved; registry is waiting for a proven direct hardware protocol.";
    case "missing-endpoint":
      return "External adapter needs an endpoint before registry evaluation can continue.";
    case "blocked":
      return "External adapter is blocked before registry evaluation.";
    case "disabled":
      return "ExternalHashEngine registry is disabled.";
  }
}

function registryNextStep(
  gate: ExternalHashEngineCandidateGate,
  registerable: boolean,
  validation: ExternalHashEngineValidationChecklist,
) {
  if (!registerable) {
    return gate.nextStep;
  }

  if (!validation.integrationReady) {
    return validation.nextStep;
  }

  return "Keep start() reserved until the actual external hardware protocol, direct endpoint shape, and release review are complete.";
}

export function resolveExternalHashEngineRegistry(
  snapshot: ExternalHashSnapshot,
  matrix: ExternalHashCapabilityMatrix = deriveExternalHashCapabilityMatrix(snapshot),
  gate: ExternalHashEngineCandidateGate = deriveExternalHashEngineCandidateGate(snapshot, matrix),
  validation: ExternalHashEngineValidationChecklist = deriveExternalHashEngineValidationChecklist(),
): ExternalHashEngineRegistryDecision {
  const registerable = gate.eligible;
  const entry = registerable
    ? {
        kind: "external-hash" as const,
        label: "External Hash Engine",
        endpoint: gate.endpoint,
        efficiencyReady: gate.efficiencyReady,
        performanceReady: gate.performanceReady,
        integrationReady: validation.integrationReady,
        startAllowed: false,
        validationRequired: !validation.integrationReady,
        validationStatus: validation.status,
      }
    : null;

  return {
    kind: "external-hash",
    status: gate.status,
    registerable,
    startAllowed: false,
    telemetryOnly: gate.status === "telemetry-only",
    efficiencyReady: gate.efficiencyReady,
    performanceReady: gate.performanceReady,
    integrationReady: registerable && validation.integrationReady,
    missingCapabilities: gate.missingCapabilities,
    advisoryMissingCapabilities: gate.advisoryMissingCapabilities,
    validation,
    entry,
    summary: registrySummary(gate, validation),
    nextStep: registryNextStep(gate, registerable, validation),
  };
}

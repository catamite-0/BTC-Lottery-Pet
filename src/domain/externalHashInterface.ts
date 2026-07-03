import { estimateHashSearchSpacePlan, estimateHashWorkLeasePlan } from "./hashSearchSpace.js";
import type { HashSearchSpacePlan, HashWorkLeasePlan } from "./hashSearchSpace.js";
import { calculateThermalGuard } from "./thermalGuard.js";
import type { ThermalGuardStatus } from "./thermalGuard.js";

export type ExternalHashInterfaceKind = "none" | "network" | "direct";
export type ExternalHashCapability = "telemetry" | "powerTelemetry" | "versionRolling" | "workPartitioning" | "jobControl" | "shareSubmission";
export type ExternalHashIntegrationStage = "disabled" | "reserved" | "telemetry-only" | "hash-engine";
export type ExternalHashEndpointKind = "none" | "http" | "serial" | "usb" | "hid" | "path" | "unknown";
export type ExternalHashAdapterStatus = "disabled" | "missing-endpoint" | "reserved" | "ready";
export type ExternalHashPollingStatus = "disabled" | "manual" | "missing-endpoint" | "reserved" | "ready";
export type ExternalHashTransportKind =
  | "none"
  | "network-http"
  | "direct-serial"
  | "direct-usb"
  | "direct-hid"
  | "direct-path"
  | "direct-unknown";
export type ExternalHashTransportStatus = "disabled" | "missing-endpoint" | "telemetry-ready" | "reserved";
export type ExternalHashTransportProof =
  | "endpoint_access"
  | "telemetry_schema"
  | "job_lifecycle"
  | "search_space_assignment"
  | "stale_job_rejection"
  | "thermal_limits"
  | "share_submission";
export type ExternalHashDirectProtocolStatus = "not-selected" | "waiting-for-endpoint" | "reserved";
export type ExternalHashDirectProbeTarget = "serial" | "usb" | "hid" | "path" | "unknown";

export const DEFAULT_EXTERNAL_HASH_POLL_INTERVAL_SECONDS = 60;
export const MIN_EXTERNAL_HASH_POLL_INTERVAL_SECONDS = 30;
export const MAX_EXTERNAL_HASH_POLL_INTERVAL_SECONDS = 3_600;

export interface ExternalHashConfigLike {
  external_hash_interface: ExternalHashInterfaceKind;
  external_hash_network_host?: string | null;
  external_hash_direct_port?: string | null;
  external_hash_direct_endpoint?: string | null;
  external_hash_polling_enabled?: boolean | null;
  external_hash_poll_interval_seconds?: number | null;
}

export interface ExternalHashTelemetryLike {
  status: string;
  base_url: string;
  device_name: string;
  hostname: string;
  hash_rate_hs: number;
  power_watts: number | null;
  joules_per_terahash: number | null;
  summary: string;
  temp_c?: number | null;
  vr_temp_c?: number | null;
  fan_rpm?: number | null;
  mining_paused?: boolean | null;
  parallel_workers?: number | null;
  worker_count?: number | null;
  integration_stage?: ExternalHashIntegrationStage | string | null;
  capabilities?: (ExternalHashCapability | string)[] | null;
  engine_eligible?: boolean | null;
  can_control_mining?: boolean | null;
  can_submit_shares?: boolean | null;
  can_roll_version?: boolean | null;
  can_partition_work?: boolean | null;
}

export interface ExternalHashAdapterContract {
  adapterId: "none" | "network-telemetry" | "direct-reserved";
  interfaceKind: ExternalHashInterfaceKind;
  endpoint: string;
  endpointKind: ExternalHashEndpointKind;
  status: ExternalHashAdapterStatus;
  integrationStage: ExternalHashIntegrationStage;
  capabilities: ExternalHashCapability[];
  engineEligible: boolean;
  nextIntegrationStep: string;
}

export interface ExternalHashPollingPlan {
  enabled: boolean;
  canPoll: boolean;
  intervalSeconds: number;
  status: ExternalHashPollingStatus;
  summary: string;
}

export interface ExternalHashTransportPlan {
  interfaceKind: ExternalHashInterfaceKind;
  transportKind: ExternalHashTransportKind;
  endpointKind: ExternalHashEndpointKind;
  endpoint: string;
  status: ExternalHashTransportStatus;
  canProbeTelemetry: boolean;
  canControlJobs: boolean;
  canSubmitShares: boolean;
  miningStartAllowed: boolean;
  requiredProof: ExternalHashTransportProof[];
  summary: string;
  nextStep: string;
}

export interface ExternalHashDirectProtocolPlan {
  status: ExternalHashDirectProtocolStatus;
  endpoint: string;
  endpointKind: ExternalHashEndpointKind;
  preferredProbe: ExternalHashDirectProbeTarget;
  canProbeEndpointAccess: boolean;
  canProbeTelemetry: boolean;
  canControlJobs: boolean;
  canSubmitShares: boolean;
  miningStartAllowed: boolean;
  requiredProof: ExternalHashTransportProof[];
  summary: string;
  nextStep: string;
}

export interface ExternalHashSnapshot {
  adapter: ExternalHashAdapterContract;
  polling: ExternalHashPollingPlan;
  transport: ExternalHashTransportPlan;
  interfaceKind: ExternalHashInterfaceKind;
  label: string;
  endpoint: string;
  integrationStage: ExternalHashIntegrationStage;
  capabilities: ExternalHashCapability[];
  parallelWorkers: number;
  canReadTelemetry: boolean;
  canControlMining: boolean;
  canSubmitShares: boolean;
  canRollVersion: boolean;
  telemetryOnline: boolean;
  hashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  thermalStatus: ThermalGuardStatus;
  thermalWeight: number;
  thermalSummary: string;
  maxObservedTempC: number | null;
  status: "disabled" | "reserved" | "ready" | "online" | "failed" | "waiting";
  summary: string;
  capabilitySummary: string;
}

export type ExternalHashCapabilityMatrixStatus =
  | "available"
  | "waiting"
  | "missing-endpoint"
  | "reserved"
  | "blocked"
  | "disabled";

export interface ExternalHashCapabilityMatrixRow {
  capability: ExternalHashCapability;
  label: string;
  status: ExternalHashCapabilityMatrixStatus;
  available: boolean;
  engineBlocking: boolean;
  efficiencyBlocking: boolean;
  summary: string;
}

export interface ExternalHashCapabilityMatrix {
  interfaceKind: ExternalHashInterfaceKind;
  integrationStage: ExternalHashIntegrationStage;
  engineEligible: boolean;
  canReadTelemetry: boolean;
  canCompareEfficiency: boolean;
  canControlMining: boolean;
  canSubmitShares: boolean;
  canRollVersion: boolean;
  canPartitionWork: boolean;
  rows: ExternalHashCapabilityMatrixRow[];
  missingEngineCapabilities: ExternalHashCapability[];
  missingEfficiencyCapabilities: ExternalHashCapability[];
  missingPerformanceCapabilities: ExternalHashCapability[];
  searchSpace: HashSearchSpacePlan;
  searchSpaceReady: boolean;
  workLease: HashWorkLeasePlan;
  workLeaseReady: boolean;
  workLeaseUtilizationRatio: number | null;
  workLeaseUniquePartitionRatio: number | null;
  workLeaseRouteUtilizationRatio: number | null;
  workLeaseWasteRisk: HashWorkLeasePlan["hashWasteRisk"];
  summary: string;
}

export type ExternalHashEngineCandidateStatus =
  | "disabled"
  | "reserved"
  | "missing-endpoint"
  | "telemetry-only"
  | "blocked"
  | "candidate";

export interface ExternalHashEngineCandidateGate {
  status: ExternalHashEngineCandidateStatus;
  eligible: boolean;
  efficiencyReady: boolean;
  performanceReady: boolean;
  interfaceKind: ExternalHashInterfaceKind;
  integrationStage: ExternalHashIntegrationStage;
  endpoint: string;
  requiredCapabilities: ExternalHashCapability[];
  missingCapabilities: ExternalHashCapability[];
  advisoryMissingCapabilities: ExternalHashCapability[];
  summary: string;
  nextStep: string;
}

export interface ExternalEfficiencyComparison {
  status: "unavailable" | "external-better" | "local-better" | "similar";
  ratio: number | null;
  summary: string;
}

export type ExternalHashInterfaceSpecStage =
  | "disabled"
  | "missing-endpoint"
  | "reserved"
  | "read-only-probe"
  | "telemetry-reference"
  | "dry-run-candidate";

export interface ExternalHashInterfaceSpec {
  interfaceKind: ExternalHashInterfaceKind;
  endpointKind: ExternalHashEndpointKind;
  transportKind: ExternalHashTransportKind;
  endpoint: string;
  stage: ExternalHashInterfaceSpecStage;
  physicalLayer: string;
  readOnlyProbeAllowed: boolean;
  telemetryReferenceAllowed: boolean;
  dryRunWorkAllowed: boolean;
  miningStartAllowed: boolean;
  validationOrder: ExternalHashTransportProof[];
  blockedBy: string[];
  summary: string;
  nextStep: string;
}

export type ExternalHashProtocolContractStage = "disabled" | "telemetry-only" | "reserved-direct" | "dry-run-only";
export type ExternalHashProtocolOperation =
  | "endpoint_access"
  | "read_telemetry"
  | "read_power"
  | "partition_work"
  | "control_jobs"
  | "submit_shares"
  | "start_mining";

export interface ExternalHashProtocolContract {
  interfaceKind: ExternalHashInterfaceKind;
  endpointKind: ExternalHashEndpointKind;
  transportKind: ExternalHashTransportKind;
  stage: ExternalHashProtocolContractStage;
  physicalLayer: string;
  allowedOperations: ExternalHashProtocolOperation[];
  blockedOperations: ExternalHashProtocolOperation[];
  requiredBeforeMining: ExternalHashTransportProof[];
  directProbeTarget: ExternalHashDirectProbeTarget | null;
  networkTelemetryOnly: boolean;
  directReserved: boolean;
  miningStartAllowed: false;
  summary: string;
  nextStep: string;
}

export interface ExternalHashDiagnosticCapability {
  capability: ExternalHashCapability;
  status: ExternalHashCapabilityMatrixStatus;
  available: boolean;
  engineBlocking: boolean;
  efficiencyBlocking: boolean;
}

export interface ExternalHashDiagnosticSnapshot {
  schemaVersion: 1;
  privacyNote: string;
  interfaceKind: ExternalHashInterfaceKind;
  endpointKind: ExternalHashEndpointKind;
  transportKind: ExternalHashTransportKind;
  integrationStage: ExternalHashIntegrationStage;
  interfaceStage: ExternalHashInterfaceSpecStage;
  pollingStatus: ExternalHashPollingStatus;
  pollingEnabled: boolean;
  pollingIntervalSeconds: number;
  telemetryOnline: boolean;
  hashrate: number;
  watts: number | null;
  joulesPerTerahash: number | null;
  thermalStatus: ThermalGuardStatus;
  engineGateStatus: ExternalHashEngineCandidateStatus;
  engineEligible: boolean;
  efficiencyReady: boolean;
  performanceReady: boolean;
  searchSpaceStatus: HashSearchSpacePlan["status"];
  workLeaseStatus: HashWorkLeasePlan["status"];
  workLeaseUtilizationRatio: number | null;
  workLeaseUniquePartitionRatio: number | null;
  workLeaseRouteUtilizationRatio: number | null;
  workLeaseWasteRisk: HashWorkLeasePlan["hashWasteRisk"];
  readOnlyProbeAllowed: boolean;
  telemetryReferenceAllowed: boolean;
  dryRunWorkAllowed: boolean;
  miningStartAllowed: false;
  protocolContract: ExternalHashProtocolContract;
  capabilities: ExternalHashDiagnosticCapability[];
  blockedBy: string[];
  summary: string;
  nextStep: string;
}

function finitePositive(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizeParallelWorkers(telemetry: ExternalHashTelemetryLike | null) {
  const rawWorkers = telemetry?.parallel_workers ?? telemetry?.worker_count;
  if (!finitePositive(rawWorkers)) {
    return 1;
  }

  return Math.min(65_536, Math.max(1, Math.trunc(Number(rawWorkers))));
}

function externalHashCapabilityRank(capability: ExternalHashCapability) {
  switch (capability) {
    case "telemetry":
      return 0;
    case "powerTelemetry":
      return 1;
    case "versionRolling":
      return 2;
    case "workPartitioning":
      return 3;
    case "jobControl":
      return 4;
    case "shareSubmission":
      return 5;
  }
}

function isExternalHashCapability(value: unknown): value is ExternalHashCapability {
  return value === "telemetry" ||
    value === "powerTelemetry" ||
    value === "versionRolling" ||
    value === "workPartitioning" ||
    value === "jobControl" ||
    value === "shareSubmission";
}

function normalizeTelemetryCapabilities(
  telemetry: ExternalHashTelemetryLike | null,
  baseCapabilities: ExternalHashCapability[],
) {
  const declared = Array.isArray(telemetry?.capabilities)
    ? telemetry.capabilities.filter(isExternalHashCapability)
    : [];
  const flagCapabilities: ExternalHashCapability[] = [
    telemetry?.can_roll_version === true ? "versionRolling" : null,
    telemetry?.can_partition_work === true ? "workPartitioning" : null,
    telemetry?.can_control_mining === true ? "jobControl" : null,
    telemetry?.can_submit_shares === true ? "shareSubmission" : null,
  ].filter(isExternalHashCapability);

  return Array.from(new Set([...baseCapabilities, ...declared, ...flagCapabilities]))
    .sort((left, right) => externalHashCapabilityRank(left) - externalHashCapabilityRank(right));
}

function telemetryDeclaresHashEngine(
  telemetry: ExternalHashTelemetryLike | null,
  capabilities: ExternalHashCapability[],
) {
  const declaresStage = telemetry?.integration_stage === "hash-engine" || telemetry?.engine_eligible === true;
  return declaresStage &&
    capabilities.includes("telemetry") &&
    capabilities.includes("jobControl") &&
    capabilities.includes("shareSubmission");
}

function idleThermalSummary(summary: string) {
  return {
    thermalStatus: "unknown" as const,
    thermalWeight: 1,
    thermalSummary: summary,
    maxObservedTempC: null,
  };
}

function normalizeEndpoint(endpoint: string | null | undefined) {
  return (endpoint || "").trim();
}

function normalizeNetworkEndpoint(endpoint: string | null | undefined) {
  const trimmed = normalizeEndpoint(endpoint);
  if (!trimmed) {
    return "";
  }
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function normalizeDirectEndpoint(config: ExternalHashConfigLike) {
  const futureEndpoint = normalizeEndpoint(config.external_hash_direct_endpoint);
  return futureEndpoint || normalizeEndpoint(config.external_hash_direct_port);
}

function detectDirectEndpointKind(endpoint: string): ExternalHashEndpointKind {
  const normalized = normalizeEndpoint(endpoint).toLowerCase();
  if (!normalized) {
    return "unknown";
  }
  if (/^com\d+$/i.test(normalized) || normalized.startsWith("serial://") || normalized.includes("serial")) {
    return "serial";
  }
  if (normalized.startsWith("hid://")) {
    return "hid";
  }
  if (normalized.startsWith("usb://")) {
    return "usb";
  }
  if (normalized.includes("\\") || normalized.includes("/") || normalized.includes(":")) {
    return "path";
  }
  if (normalized.includes("hid")) {
    return "hid";
  }
  if (normalized.includes("usb")) {
    return "usb";
  }
  return "unknown";
}

function directTransportKind(endpointKind: ExternalHashEndpointKind): ExternalHashTransportKind {
  switch (endpointKind) {
    case "serial":
      return "direct-serial";
    case "usb":
      return "direct-usb";
    case "hid":
      return "direct-hid";
    case "path":
      return "direct-path";
    default:
      return "direct-unknown";
  }
}

const NETWORK_TRANSPORT_REQUIRED_PROOF: ExternalHashTransportProof[] = [
  "telemetry_schema",
  "job_lifecycle",
  "search_space_assignment",
  "stale_job_rejection",
  "thermal_limits",
  "share_submission",
];

const DIRECT_TRANSPORT_REQUIRED_PROOF: ExternalHashTransportProof[] = [
  "endpoint_access",
  "telemetry_schema",
  "job_lifecycle",
  "search_space_assignment",
  "stale_job_rejection",
  "thermal_limits",
  "share_submission",
];

function directProbeTarget(endpointKind: ExternalHashEndpointKind): ExternalHashDirectProbeTarget {
  switch (endpointKind) {
    case "serial":
    case "usb":
    case "hid":
    case "path":
      return endpointKind;
    default:
      return "unknown";
  }
}

function directProtocolNextStep(endpointKind: ExternalHashEndpointKind, endpoint: string) {
  if (!endpoint) {
    return "When hardware arrives, record the vendor-documented COM, usb://, hid://, or device path endpoint before probing.";
  }

  switch (endpointKind) {
    case "serial":
      return "Start with a read-only serial identity handshake; do not enable telemetry, job control, or share submission until frame boundaries and checksums are proven.";
    case "usb":
      return "Start with USB descriptor and vendor-interface discovery; keep hash work disabled until control transfers and telemetry frames are documented.";
    case "hid":
      return "Start with HID report descriptor discovery; keep writes disabled until report IDs, telemetry schema, and safety limits are proven.";
    case "path":
      return "Treat this as a vendor/path endpoint; prove open/read permissions and protocol framing before any telemetry or job-control adapter is added.";
    default:
      return "Classify the endpoint as serial, USB, HID, or vendor path before probing hardware.";
  }
}

export function deriveExternalHashDirectProtocolPlan(config: ExternalHashConfigLike): ExternalHashDirectProtocolPlan {
  if (config.external_hash_interface !== "direct") {
    return {
      status: "not-selected",
      endpoint: "",
      endpointKind: "none",
      preferredProbe: "unknown",
      canProbeEndpointAccess: false,
      canProbeTelemetry: false,
      canControlJobs: false,
      canSubmitShares: false,
      miningStartAllowed: false,
      requiredProof: [],
      summary: "Direct protocol is not selected.",
      nextStep: "Use Network telemetry until a physical Direct device and protocol are chosen.",
    };
  }

  const endpoint = normalizeDirectEndpoint(config);
  const endpointKind = detectDirectEndpointKind(endpoint);
  const status: ExternalHashDirectProtocolStatus = endpoint ? "reserved" : "waiting-for-endpoint";
  const canProbeEndpointAccess = Boolean(endpoint) && endpointKind !== "unknown";

  return {
    status,
    endpoint,
    endpointKind,
    preferredProbe: directProbeTarget(endpointKind),
    canProbeEndpointAccess,
    canProbeTelemetry: false,
    canControlJobs: false,
    canSubmitShares: false,
    miningStartAllowed: false,
    requiredProof: DIRECT_TRANSPORT_REQUIRED_PROOF,
    summary: endpoint
      ? `Direct ${endpointKind} endpoint is reserved for read-only protocol discovery.`
      : "Direct protocol is waiting for a physical endpoint.",
    nextStep: directProtocolNextStep(endpointKind, endpoint),
  };
}

export function clampExternalHashPollInterval(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_EXTERNAL_HASH_POLL_INTERVAL_SECONDS;
  }

  return Math.min(
    MAX_EXTERNAL_HASH_POLL_INTERVAL_SECONDS,
    Math.max(MIN_EXTERNAL_HASH_POLL_INTERVAL_SECONDS, Math.trunc(value)),
  );
}

export function deriveExternalHashAdapterContract(config: ExternalHashConfigLike): ExternalHashAdapterContract {
  const interfaceKind = config.external_hash_interface;
  const networkEndpoint = normalizeNetworkEndpoint(config.external_hash_network_host);
  const directEndpoint = normalizeDirectEndpoint(config);

  if (interfaceKind === "network") {
    return {
      adapterId: "network-telemetry",
      interfaceKind,
      endpoint: networkEndpoint,
      endpointKind: "http",
      status: networkEndpoint ? "ready" : "missing-endpoint",
      integrationStage: "telemetry-only",
      capabilities: networkEndpoint ? ["telemetry"] : [],
      engineEligible: false,
      nextIntegrationStep: networkEndpoint
        ? "Read external telemetry first; job control and share submission remain local."
        : "Add a network host before reading external telemetry.",
    };
  }

  if (interfaceKind === "direct") {
    return {
      adapterId: "direct-reserved",
      interfaceKind,
      endpoint: directEndpoint,
      endpointKind: detectDirectEndpointKind(directEndpoint),
      status: "reserved",
      integrationStage: "reserved",
      capabilities: [],
      engineEligible: false,
      nextIntegrationStep: directEndpoint
        ? "Direct endpoint is recorded; choose and test the device protocol before enabling hash work."
        : "Choose the direct endpoint shape after hardware is available.",
    };
  }

  return {
    adapterId: "none",
    interfaceKind: "none",
    endpoint: "",
    endpointKind: "none",
    status: "disabled",
    integrationStage: "disabled",
    capabilities: [],
    engineEligible: false,
    nextIntegrationStep: "Select Network or Direct before attaching external hash telemetry.",
  };
}

export function deriveExternalHashTransportPlan(config: ExternalHashConfigLike): ExternalHashTransportPlan {
  const adapter = deriveExternalHashAdapterContract(config);

  if (adapter.interfaceKind === "none") {
    return {
      interfaceKind: "none",
      transportKind: "none",
      endpointKind: "none",
      endpoint: "",
      status: "disabled",
      canProbeTelemetry: false,
      canControlJobs: false,
      canSubmitShares: false,
      miningStartAllowed: false,
      requiredProof: [],
      summary: "External transport is disabled.",
      nextStep: "Select Network for telemetry or Direct after the physical device is available.",
    };
  }

  if (adapter.interfaceKind === "network") {
    if (!adapter.endpoint) {
      return {
        interfaceKind: "network",
        transportKind: "network-http",
        endpointKind: "http",
        endpoint: "",
        status: "missing-endpoint",
        canProbeTelemetry: false,
        canControlJobs: false,
        canSubmitShares: false,
        miningStartAllowed: false,
        requiredProof: NETWORK_TRANSPORT_REQUIRED_PROOF,
        summary: "Network transport needs an HTTP telemetry host.",
        nextStep: "Enter a Bitaxe/AxeOS host or IP before probing telemetry.",
      };
    }

    return {
      interfaceKind: "network",
      transportKind: "network-http",
      endpointKind: "http",
      endpoint: adapter.endpoint,
      status: "telemetry-ready",
      canProbeTelemetry: true,
      canControlJobs: false,
      canSubmitShares: false,
      miningStartAllowed: false,
      requiredProof: NETWORK_TRANSPORT_REQUIRED_PROOF,
      summary: "Network HTTP transport can probe external telemetry only.",
      nextStep: "Keep job control and share submission local until this transport proves the full hardware checklist.",
    };
  }

  const directProtocol = deriveExternalHashDirectProtocolPlan(config);
  return {
    interfaceKind: "direct",
    transportKind: directTransportKind(adapter.endpointKind),
    endpointKind: adapter.endpointKind,
    endpoint: adapter.endpoint,
    status: "reserved",
    canProbeTelemetry: false,
    canControlJobs: false,
    canSubmitShares: false,
    miningStartAllowed: false,
    requiredProof: DIRECT_TRANSPORT_REQUIRED_PROOF,
    summary: directProtocol.summary,
    nextStep: directProtocol.nextStep,
  };
}

export function deriveExternalHashPollingPlan(config: ExternalHashConfigLike): ExternalHashPollingPlan {
  const intervalSeconds = clampExternalHashPollInterval(config.external_hash_poll_interval_seconds);
  const pollingRequested = config.external_hash_polling_enabled === true;
  const interfaceKind = config.external_hash_interface;
  const networkEndpoint = normalizeEndpoint(config.external_hash_network_host);

  if (interfaceKind === "none") {
    return {
      enabled: false,
      canPoll: false,
      intervalSeconds,
      status: "disabled",
      summary: "External telemetry polling is off.",
    };
  }

  if (interfaceKind === "direct") {
    return {
      enabled: false,
      canPoll: false,
      intervalSeconds,
      status: "reserved",
      summary: "Direct telemetry polling is reserved until the device protocol is chosen.",
    };
  }

  if (!networkEndpoint) {
    return {
      enabled: pollingRequested,
      canPoll: false,
      intervalSeconds,
      status: "missing-endpoint",
      summary: "Add a network host before enabling telemetry polling.",
    };
  }

  if (!pollingRequested) {
    return {
      enabled: false,
      canPoll: false,
      intervalSeconds,
      status: "manual",
      summary: "Network telemetry is sealed on this branch; revive it from the archive branch when hardware work resumes.",
    };
  }

  return {
    enabled: true,
    canPoll: true,
    intervalSeconds,
    status: "ready",
    summary: `Network telemetry polling every ${intervalSeconds}s.`,
  };
}

export function deriveExternalHashSnapshot(
  config: ExternalHashConfigLike,
  telemetry: ExternalHashTelemetryLike | null,
): ExternalHashSnapshot {
  const interfaceKind = config.external_hash_interface;
  const adapter = deriveExternalHashAdapterContract(config);
  const polling = deriveExternalHashPollingPlan(config);
  const transport = deriveExternalHashTransportPlan(config);
  const networkHost = normalizeEndpoint(config.external_hash_network_host);
  const directEndpoint = normalizeDirectEndpoint(config);

  if (interfaceKind === "none") {
    return {
      adapter,
      polling,
      transport,
      interfaceKind,
      label: "None",
      endpoint: "",
      integrationStage: "disabled",
      capabilities: [],
      parallelWorkers: 1,
      canReadTelemetry: false,
      canControlMining: false,
      canSubmitShares: false,
      canRollVersion: false,
      telemetryOnline: false,
      hashrate: 0,
      watts: null,
      joulesPerTerahash: null,
      ...idleThermalSummary("Thermal guard: no external device selected."),
      status: "disabled",
      summary: "External hash interface is disabled.",
      capabilitySummary: "No external hash work is active.",
    };
  }

  if (interfaceKind === "direct") {
    return {
      adapter,
      polling,
      transport,
      interfaceKind,
      label: "Direct",
      endpoint: directEndpoint,
      integrationStage: "reserved",
      capabilities: [],
      parallelWorkers: 1,
      canReadTelemetry: false,
      canControlMining: false,
      canSubmitShares: false,
      canRollVersion: false,
      telemetryOnline: false,
      hashrate: 0,
      watts: null,
      joulesPerTerahash: null,
      ...idleThermalSummary("Thermal guard: direct telemetry is reserved until the device protocol is chosen."),
      status: "reserved",
      summary: directEndpoint
        ? `Direct interface reserved at ${directEndpoint}.`
        : "Direct interface is reserved until the device protocol is chosen.",
      capabilitySummary: "Direct hash routing is reserved; shares stay on the selected mining engine.",
    };
  }

  if (!networkHost) {
    return {
      adapter,
      polling,
      transport,
      interfaceKind,
      label: "Network",
      endpoint: "",
      integrationStage: "telemetry-only",
      capabilities: [],
      parallelWorkers: 1,
      canReadTelemetry: false,
      canControlMining: false,
      canSubmitShares: false,
      canRollVersion: false,
      telemetryOnline: false,
      hashrate: 0,
      watts: null,
      joulesPerTerahash: null,
      ...idleThermalSummary("Thermal guard: waiting for network telemetry."),
      status: "waiting",
      summary: "Add a network host to read external hash telemetry.",
      capabilitySummary: "Network telemetry needs a host before it can report external efficiency.",
    };
  }

  const telemetryOnline = Boolean(telemetry && telemetry.status !== "failed");
  const hashrate = finitePositive(telemetry?.hash_rate_hs) ? Number(telemetry?.hash_rate_hs) : 0;
  const watts = finitePositive(telemetry?.power_watts) ? Number(telemetry?.power_watts) : null;
  const joulesPerTerahash = finitePositive(telemetry?.joules_per_terahash)
    ? Number(telemetry?.joules_per_terahash)
    : null;
  const baseCapabilities: ExternalHashCapability[] = watts === null ? ["telemetry"] : ["telemetry", "powerTelemetry"];
  const capabilities = normalizeTelemetryCapabilities(telemetry, baseCapabilities);
  const engineEligible = telemetryDeclaresHashEngine(telemetry, capabilities);
  const integrationStage: ExternalHashIntegrationStage = engineEligible ? "hash-engine" : "telemetry-only";
  const canControlMining = capabilities.includes("jobControl");
  const canSubmitShares = capabilities.includes("shareSubmission");
  const canRollVersion = capabilities.includes("versionRolling");
  const parallelWorkers = normalizeParallelWorkers(telemetry);
  const thermalGuard = calculateThermalGuard({
    tempC: telemetry?.temp_c,
    vrTempC: telemetry?.vr_temp_c,
    fanRpm: telemetry?.fan_rpm,
    miningPaused: telemetry?.mining_paused,
  });

  return {
    adapter: {
      ...adapter,
      integrationStage,
      capabilities,
      engineEligible,
    },
    polling,
    transport,
    interfaceKind,
    label: "Network",
    endpoint: telemetry?.base_url || networkHost,
    integrationStage,
    capabilities,
    parallelWorkers,
    canReadTelemetry: true,
    canControlMining,
    canSubmitShares,
    canRollVersion,
    telemetryOnline,
    hashrate,
    watts,
    joulesPerTerahash,
    thermalStatus: thermalGuard.status,
    thermalWeight: thermalGuard.qualityWeight,
    thermalSummary: thermalGuard.summary,
    maxObservedTempC: thermalGuard.maxObservedTempC,
    status: telemetry
      ? telemetry.status === "failed"
        ? "failed"
        : hashrate > 0
          ? "online"
          : "waiting"
      : "ready",
    summary: telemetry?.summary || "Network interface ready for AxeOS/Bitaxe telemetry.",
    capabilitySummary: engineEligible
      ? "Hash-engine capabilities are declared for dry-run validation; real external mining start remains release-gated."
      : "Telemetry only; pool shares stay on the selected mining engine.",
  };
}

const EXTERNAL_HASH_CAPABILITY_ORDER: ExternalHashCapability[] = [
  "telemetry",
  "powerTelemetry",
  "versionRolling",
  "workPartitioning",
  "jobControl",
  "shareSubmission",
];

const EXTERNAL_HASH_ENGINE_REQUIRED_CAPABILITIES = new Set<ExternalHashCapability>([
  "telemetry",
  "jobControl",
  "shareSubmission",
]);

const EXTERNAL_HASH_EFFICIENCY_REQUIRED_CAPABILITIES = new Set<ExternalHashCapability>([
  "telemetry",
  "powerTelemetry",
]);

function externalHashCapabilityLabel(capability: ExternalHashCapability) {
  switch (capability) {
    case "telemetry":
      return "Telemetry";
    case "powerTelemetry":
      return "Power";
    case "versionRolling":
      return "Version Rolling";
    case "workPartitioning":
      return "Work Partitioning";
    case "jobControl":
      return "Job Control";
    case "shareSubmission":
      return "Share Submit";
  }
}

function externalHashCapabilityStatus(
  snapshot: ExternalHashSnapshot,
  capability: ExternalHashCapability,
): ExternalHashCapabilityMatrixStatus {
  if (snapshot.interfaceKind === "none") {
    return "disabled";
  }

  if (snapshot.interfaceKind === "direct") {
    return "reserved";
  }

  if (!snapshot.endpoint) {
    return "missing-endpoint";
  }

  if (snapshot.capabilities.includes(capability)) {
    return "available";
  }

  if (capability === "powerTelemetry" && snapshot.canReadTelemetry) {
    return "waiting";
  }

  return "blocked";
}

function externalHashCapabilitySummary(
  snapshot: ExternalHashSnapshot,
  capability: ExternalHashCapability,
  status: ExternalHashCapabilityMatrixStatus,
) {
  if (status === "available") {
    switch (capability) {
      case "telemetry":
        return snapshot.telemetryOnline
          ? "Telemetry has been read from the external device."
          : "Telemetry endpoint is configured and ready to read.";
      case "powerTelemetry":
        return "Power or J/TH telemetry is available for efficiency comparison.";
      case "versionRolling":
        return "BIP320/BIP323/SV2 version rolling is declared for larger header search-space assignment.";
      case "workPartitioning":
        return "Extended extranonce or equivalent job partitioning is declared for unique high-hash work assignment.";
      case "jobControl":
        return "External job control is available.";
      case "shareSubmission":
        return "External share submission is available.";
    }
  }

  if (status === "waiting") {
    return "Waiting for external telemetry with power or J/TH fields.";
  }

  if (status === "missing-endpoint") {
    return "Add a network host before this capability can be checked.";
  }

  if (status === "reserved") {
    return "Reserved until the direct hardware protocol is selected and tested.";
  }

  if (status === "disabled") {
    return "External hash interface is disabled.";
  }

  switch (capability) {
    case "jobControl":
      return "Blocked: telemetry adapters cannot own Stratum job lifecycle yet.";
    case "versionRolling":
      return "Blocked until the adapter negotiates BIP320/BIP323/SV2 version rolling with the pool and device.";
    case "workPartitioning":
      return "Blocked until the adapter proves extended extranonce, SV2 extended jobs, or equivalent unique job partitioning.";
    case "shareSubmission":
      return "Blocked: shares stay on the selected local or pool mining engine.";
    case "powerTelemetry":
      return "Blocked until the device reports power or J/TH telemetry.";
    case "telemetry":
      return "Blocked until a supported telemetry adapter is configured.";
  }
}

export function deriveExternalHashCapabilityMatrix(
  snapshot: ExternalHashSnapshot,
): ExternalHashCapabilityMatrix {
  const rows = EXTERNAL_HASH_CAPABILITY_ORDER.map((capability) => {
    const status = externalHashCapabilityStatus(snapshot, capability);
    const available = status === "available";
    const engineBlocking = EXTERNAL_HASH_ENGINE_REQUIRED_CAPABILITIES.has(capability) && !available;
    const efficiencyBlocking = EXTERNAL_HASH_EFFICIENCY_REQUIRED_CAPABILITIES.has(capability) && !available;

    return {
      capability,
      label: externalHashCapabilityLabel(capability),
      status,
      available,
      engineBlocking,
      efficiencyBlocking,
      summary: externalHashCapabilitySummary(snapshot, capability, status),
    };
  });
  const missingEngineCapabilities = rows
    .filter((row) => row.engineBlocking)
    .map((row) => row.capability);
  const missingEfficiencyCapabilities = rows
    .filter((row) => row.efficiencyBlocking)
    .map((row) => row.capability);
  const canReadTelemetry = rows.find((row) => row.capability === "telemetry")?.available === true;
  const canCompareEfficiency = missingEfficiencyCapabilities.length === 0;
  const canControlMining = rows.find((row) => row.capability === "jobControl")?.available === true;
  const canSubmitShares = rows.find((row) => row.capability === "shareSubmission")?.available === true;
  const canRollVersion = rows.find((row) => row.capability === "versionRolling")?.available === true;
  const canPartitionWork = rows.find((row) => row.capability === "workPartitioning")?.available === true;
  const versionRollingBits = canRollVersion ? 16 : 0;
  const extranonceBytes = canPartitionWork ? 2 : 0;
  const searchSpace = estimateHashSearchSpacePlan({
    hashrate: snapshot.hashrate,
    versionRollingBits,
    extranonceBytes,
    targetJobSeconds: 1,
  });
  const workLease = estimateHashWorkLeasePlan({
    hashrate: snapshot.hashrate,
    versionRollingBits,
    extranonceBytes,
    targetJobSeconds: 1,
    parallelWorkers: snapshot.parallelWorkers,
  });
  const searchSpaceReady = searchSpace.status === "sufficient" || searchSpace.status === "tight";
  const workLeaseReady = workLease.status === "ready" || workLease.status === "tight";
  const workLeaseWasteAcceptable = workLease.hashWasteRisk !== "high";
  const missingPerformanceCapabilities = Array.from(new Set<ExternalHashCapability>([
    ...(searchSpace.requiresVersionRolling && !canRollVersion ? ["versionRolling" as const] : []),
    ...(searchSpace.requiresExtranonce && !canPartitionWork ? ["workPartitioning" as const] : []),
    ...(workLease.requiresWorkPartitioning && !canPartitionWork ? ["workPartitioning" as const] : []),
  ]));
  const performanceReady = missingPerformanceCapabilities.length === 0 && searchSpaceReady && workLeaseReady && workLeaseWasteAcceptable;
  const engineEligible = snapshot.adapter.engineEligible && missingEngineCapabilities.length === 0;

  let summary = "External hash interface is disabled.";
  if (snapshot.interfaceKind === "direct") {
    summary = "Direct interface is reserved; no external hash engine can be enabled yet.";
  } else if (snapshot.interfaceKind === "network" && !snapshot.endpoint) {
    summary = "Network interface needs a host before capability checks can run.";
  } else if (engineEligible && performanceReady) {
    summary = "External hash engine capability gate is open with enough planned search space and a safe work lease.";
  } else if (engineEligible) {
    summary = workLease.hashWasteRisk === "high"
      ? `External hash engine capability gate is open, but current work lease would waste hash: ${workLease.summary}`
      : searchSpaceReady
        ? "External hash engine capability gate is open; search-space and work-lease planning should be reviewed before highest-hash routing."
        : "External hash engine capability gate is open, but search space is too small for highest-hash routing.";
  } else if (canCompareEfficiency) {
    summary = searchSpace.requiresVersionRolling
      ? "External efficiency can be compared, but high-hash search space needs version rolling before engine routing."
      : "External efficiency can be compared, but job control and share submission remain blocked.";
  } else if (canReadTelemetry) {
    summary = "External telemetry is available; power data is still needed for efficiency routing.";
  }

  return {
    interfaceKind: snapshot.interfaceKind,
    integrationStage: snapshot.integrationStage,
    engineEligible,
    canReadTelemetry,
    canCompareEfficiency,
    canControlMining,
    canSubmitShares,
    canRollVersion,
    canPartitionWork,
    rows,
    missingEngineCapabilities,
    missingEfficiencyCapabilities,
    missingPerformanceCapabilities,
    searchSpace,
    searchSpaceReady,
    workLease,
    workLeaseReady,
    workLeaseUtilizationRatio: workLease.routeUtilizationRatio,
    workLeaseUniquePartitionRatio: workLease.uniquePartitionRatio,
    workLeaseRouteUtilizationRatio: workLease.routeUtilizationRatio,
    workLeaseWasteRisk: workLease.hashWasteRisk,
    summary,
  };
}

export function deriveExternalHashEngineCandidateGate(
  snapshot: ExternalHashSnapshot,
  matrix = deriveExternalHashCapabilityMatrix(snapshot),
): ExternalHashEngineCandidateGate {
  const requiredCapabilities = Array.from(EXTERNAL_HASH_ENGINE_REQUIRED_CAPABILITIES);
  const missingCapabilities = matrix.missingEngineCapabilities;
  const advisoryMissingCapabilities = [
    ...matrix.missingEfficiencyCapabilities.filter((capability) => (
      !EXTERNAL_HASH_ENGINE_REQUIRED_CAPABILITIES.has(capability)
    )),
    ...matrix.missingPerformanceCapabilities.filter((capability) => (
      !EXTERNAL_HASH_ENGINE_REQUIRED_CAPABILITIES.has(capability) &&
      !matrix.missingEfficiencyCapabilities.includes(capability)
    )),
  ];
  const efficiencyReady = matrix.canCompareEfficiency;
  const performanceReady = matrix.missingPerformanceCapabilities.length === 0 && matrix.searchSpaceReady && matrix.workLeaseReady && matrix.workLeaseWasteRisk !== "high";

  if (snapshot.interfaceKind === "none") {
    return {
      status: "disabled",
      eligible: false,
      efficiencyReady,
      performanceReady,
      interfaceKind: snapshot.interfaceKind,
      integrationStage: snapshot.integrationStage,
      endpoint: snapshot.endpoint,
      requiredCapabilities,
      missingCapabilities,
      advisoryMissingCapabilities,
      summary: "External hash engine gate is disabled.",
      nextStep: "Select Network or Direct before evaluating external hash-engine candidacy.",
    };
  }

  if (snapshot.interfaceKind === "direct") {
    return {
      status: "reserved",
      eligible: false,
      efficiencyReady,
      performanceReady,
      interfaceKind: snapshot.interfaceKind,
      integrationStage: snapshot.integrationStage,
      endpoint: snapshot.endpoint,
      requiredCapabilities,
      missingCapabilities,
      advisoryMissingCapabilities,
      summary: "Direct external hash engine gate is reserved.",
      nextStep: "Choose the physical protocol and prove telemetry, job control, and share submission before enabling Direct as a candidate.",
    };
  }

  if (!snapshot.endpoint) {
    return {
      status: "missing-endpoint",
      eligible: false,
      efficiencyReady,
      performanceReady,
      interfaceKind: snapshot.interfaceKind,
      integrationStage: snapshot.integrationStage,
      endpoint: snapshot.endpoint,
      requiredCapabilities,
      missingCapabilities,
      advisoryMissingCapabilities,
      summary: "External hash engine gate needs a network endpoint.",
      nextStep: "Add a network host, then verify telemetry before evaluating job control.",
    };
  }

  if (matrix.engineEligible) {
    return {
      status: "candidate",
      eligible: true,
      efficiencyReady,
      performanceReady,
      interfaceKind: snapshot.interfaceKind,
      integrationStage: snapshot.integrationStage,
      endpoint: snapshot.endpoint,
      requiredCapabilities,
      missingCapabilities,
      advisoryMissingCapabilities,
      summary: efficiencyReady && performanceReady
        ? "External adapter satisfies the hash-engine candidate gate with efficiency telemetry, enough search space, and a safe work lease."
        : efficiencyReady
          ? `External adapter satisfies the hash-engine candidate gate, but ${matrix.workLeaseWasteRisk === "high" || !matrix.workLeaseReady ? matrix.workLease.summary : matrix.searchSpace.summary}${advisoryMissingCapabilities.length > 0 ? ` Missing ${advisoryMissingCapabilities.map(externalHashCapabilityLabel).join(", ")}.` : ""}`
          : "External adapter satisfies the hash-engine candidate gate, but power telemetry is still needed for lowest-power routing.",
      nextStep: performanceReady
        ? "Run job lifecycle, stale-job rejection, thermal, and pool share-submission validation before exposing this as a mining engine."
        : matrix.workLeaseWasteRisk === "high"
          ? "Expand version rolling, extranonce, or equivalent partitioned search space until lease utilization is safe."
          : matrix.searchSpace.requiresVersionRolling
            ? "Prove BIP320/BIP323/SV2 version rolling support before treating the adapter as a highest-hash route."
            : "Prove extended extranonce, SV2 extended jobs, or equivalent work partitioning before treating the adapter as a highest-hash route.",
    };
  }

  if (matrix.canReadTelemetry) {
    return {
      status: "telemetry-only",
      eligible: false,
      efficiencyReady,
      performanceReady,
      interfaceKind: snapshot.interfaceKind,
      integrationStage: snapshot.integrationStage,
      endpoint: snapshot.endpoint,
      requiredCapabilities,
      missingCapabilities,
      advisoryMissingCapabilities,
      summary: "External adapter is telemetry-only, not a hash-engine candidate.",
      nextStep: missingCapabilities.length > 0
        ? `Prove ${missingCapabilities.join(", ")} before external hash work can become engine-eligible.`
        : "Keep monitoring telemetry until an adapter declares job ownership and share submission.",
    };
  }

  return {
    status: "blocked",
    eligible: false,
    efficiencyReady,
    performanceReady,
    interfaceKind: snapshot.interfaceKind,
    integrationStage: snapshot.integrationStage,
    endpoint: snapshot.endpoint,
    requiredCapabilities,
    missingCapabilities,
    advisoryMissingCapabilities,
    summary: "External hash engine gate is blocked.",
    nextStep: "Configure a supported telemetry adapter before checking engine capabilities.",
  };
}

function externalHashPhysicalLayer(transportKind: ExternalHashTransportKind) {
  switch (transportKind) {
    case "network-http":
      return "Network HTTP";
    case "direct-serial":
      return "Direct serial endpoint";
    case "direct-usb":
      return "Direct USB";
    case "direct-hid":
      return "Direct HID";
    case "direct-path":
      return "Direct device path";
    case "direct-unknown":
      return "Direct unknown endpoint";
    case "none":
      return "None";
  }
}

function externalHashProofLabel(proof: ExternalHashTransportProof) {
  switch (proof) {
    case "endpoint_access":
      return "endpoint access";
    case "telemetry_schema":
      return "telemetry schema";
    case "job_lifecycle":
      return "job lifecycle";
    case "search_space_assignment":
      return "search-space assignment";
    case "stale_job_rejection":
      return "stale-job rejection";
    case "thermal_limits":
      return "thermal limits";
    case "share_submission":
      return "share submission";
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function allProtocolOperations(): ExternalHashProtocolOperation[] {
  return [
    "endpoint_access",
    "read_telemetry",
    "read_power",
    "partition_work",
    "control_jobs",
    "submit_shares",
    "start_mining",
  ];
}

function blockedProtocolOperations(allowedOperations: ExternalHashProtocolOperation[]) {
  const allowed = new Set(allowedOperations);
  return allProtocolOperations().filter((operation) => !allowed.has(operation));
}

export function deriveExternalHashProtocolContract(
  spec: ExternalHashInterfaceSpec,
  matrix?: ExternalHashCapabilityMatrix,
): ExternalHashProtocolContract {
  const allowedOperations: ExternalHashProtocolOperation[] = [];

  if (spec.readOnlyProbeAllowed) {
    allowedOperations.push("endpoint_access");
  }
  if (spec.telemetryReferenceAllowed) {
    allowedOperations.push("read_telemetry");
  }
  if (matrix?.canCompareEfficiency) {
    allowedOperations.push("read_power");
  }
  if (spec.dryRunWorkAllowed) {
    allowedOperations.push("partition_work");
  }

  const directReserved = spec.interfaceKind === "direct";
  const networkTelemetryOnly = spec.interfaceKind === "network" && !spec.dryRunWorkAllowed;
  const stage: ExternalHashProtocolContractStage = spec.interfaceKind === "none" || spec.stage === "missing-endpoint"
    ? "disabled"
    : directReserved
      ? "reserved-direct"
      : spec.dryRunWorkAllowed
        ? "dry-run-only"
        : "telemetry-only";

  return {
    interfaceKind: spec.interfaceKind,
    endpointKind: spec.endpointKind,
    transportKind: spec.transportKind,
    stage,
    physicalLayer: spec.physicalLayer,
    allowedOperations,
    blockedOperations: blockedProtocolOperations(allowedOperations),
    requiredBeforeMining: spec.validationOrder,
    directProbeTarget: directReserved ? directProbeTarget(spec.endpointKind) : null,
    networkTelemetryOnly,
    directReserved,
    miningStartAllowed: false,
    summary: directReserved
      ? "Direct external hash is a reserved physical interface; only read-only endpoint discovery is allowed before a device protocol is proven."
      : spec.dryRunWorkAllowed
        ? "Network external hash may receive dry-run partitioned work only; real mining start remains release-gated."
        : spec.interfaceKind === "network"
          ? "Network external hash is telemetry-only; it may inform efficiency decisions but cannot control jobs or submit shares."
          : "No external protocol contract is active.",
    nextStep: spec.nextStep,
  };
}

export function deriveExternalHashInterfaceSpec(
  snapshot: ExternalHashSnapshot,
  matrix = deriveExternalHashCapabilityMatrix(snapshot),
  gate = deriveExternalHashEngineCandidateGate(snapshot, matrix),
): ExternalHashInterfaceSpec {
  const physicalLayer = externalHashPhysicalLayer(snapshot.transport.transportKind);
  const validationOrder = snapshot.transport.requiredProof;
  const proofBlocks = validationOrder.map(externalHashProofLabel);
  const capabilityBlocks = uniqueStrings([
    ...gate.missingCapabilities,
    ...gate.advisoryMissingCapabilities,
  ].map(externalHashCapabilityLabel));

  if (snapshot.interfaceKind === "none") {
    return {
      interfaceKind: snapshot.interfaceKind,
      endpointKind: snapshot.transport.endpointKind,
      transportKind: snapshot.transport.transportKind,
      endpoint: snapshot.endpoint,
      stage: "disabled",
      physicalLayer,
      readOnlyProbeAllowed: false,
      telemetryReferenceAllowed: false,
      dryRunWorkAllowed: false,
      miningStartAllowed: false,
      validationOrder,
      blockedBy: [],
      summary: "No external hash interface is selected; local CPU/GPU engines remain the only mining route.",
      nextStep: "Select Network for telemetry reference or Direct after a physical device exists.",
    };
  }

  if (snapshot.interfaceKind === "direct") {
    const endpointKnown = Boolean(snapshot.endpoint);
    const endpointClassified = endpointKnown && snapshot.transport.endpointKind !== "unknown";
    return {
      interfaceKind: snapshot.interfaceKind,
      endpointKind: snapshot.transport.endpointKind,
      transportKind: snapshot.transport.transportKind,
      endpoint: snapshot.endpoint,
      stage: endpointKnown ? endpointClassified ? "read-only-probe" : "reserved" : "missing-endpoint",
      physicalLayer,
      readOnlyProbeAllowed: endpointClassified,
      telemetryReferenceAllowed: false,
      dryRunWorkAllowed: false,
      miningStartAllowed: false,
      validationOrder,
      blockedBy: proofBlocks,
      summary: endpointKnown
        ? `${physicalLayer} is reserved for read-only protocol discovery; telemetry, job control, and share submission stay blocked.`
        : "Direct external hash is reserved until the physical endpoint, USB interface, HID report, or vendor path is known.",
      nextStep: snapshot.transport.nextStep,
    };
  }

  if (!snapshot.endpoint) {
    return {
      interfaceKind: snapshot.interfaceKind,
      endpointKind: snapshot.transport.endpointKind,
      transportKind: snapshot.transport.transportKind,
      endpoint: snapshot.endpoint,
      stage: "missing-endpoint",
      physicalLayer,
      readOnlyProbeAllowed: false,
      telemetryReferenceAllowed: false,
      dryRunWorkAllowed: false,
      miningStartAllowed: false,
      validationOrder,
      blockedBy: proofBlocks,
      summary: "Network external hash needs a host before telemetry can be used as an efficiency reference.",
      nextStep: snapshot.transport.nextStep,
    };
  }

  const dryRunWorkAllowed = gate.eligible && gate.performanceReady;
  return {
    interfaceKind: snapshot.interfaceKind,
    endpointKind: snapshot.transport.endpointKind,
    transportKind: snapshot.transport.transportKind,
    endpoint: snapshot.endpoint,
    stage: dryRunWorkAllowed ? "dry-run-candidate" : "telemetry-reference",
    physicalLayer,
    readOnlyProbeAllowed: true,
    telemetryReferenceAllowed: matrix.canReadTelemetry,
    dryRunWorkAllowed,
    miningStartAllowed: false,
    validationOrder,
    blockedBy: uniqueStrings([...capabilityBlocks, ...proofBlocks]),
    summary: dryRunWorkAllowed
      ? "Network external hash is a dry-run candidate only; release review and share validation still block real mining start."
      : "Network external hash can be used as a telemetry and efficiency reference only; real work assignment stays local.",
    nextStep: gate.nextStep,
  };
}

export function createExternalHashDiagnosticSnapshot(
  config: ExternalHashConfigLike,
  telemetry: ExternalHashTelemetryLike | null,
): ExternalHashDiagnosticSnapshot {
  const snapshot = deriveExternalHashSnapshot(config, telemetry);
  const matrix = deriveExternalHashCapabilityMatrix(snapshot);
  const gate = deriveExternalHashEngineCandidateGate(snapshot, matrix);
  const spec = deriveExternalHashInterfaceSpec(snapshot, matrix, gate);
  const protocolContract = deriveExternalHashProtocolContract(spec, matrix);

  return {
    schemaVersion: 1,
    privacyNote: "External hash diagnostics omit raw endpoint host, direct port, BTC address, pool password, and Stratum messages.",
    interfaceKind: snapshot.interfaceKind,
    endpointKind: spec.endpointKind,
    transportKind: spec.transportKind,
    integrationStage: snapshot.integrationStage,
    interfaceStage: spec.stage,
    pollingStatus: snapshot.polling.status,
    pollingEnabled: snapshot.polling.enabled,
    pollingIntervalSeconds: snapshot.polling.intervalSeconds,
    telemetryOnline: snapshot.telemetryOnline,
    hashrate: snapshot.hashrate,
    watts: snapshot.watts,
    joulesPerTerahash: snapshot.joulesPerTerahash,
    thermalStatus: snapshot.thermalStatus,
    engineGateStatus: gate.status,
    engineEligible: gate.eligible,
    efficiencyReady: gate.efficiencyReady,
    performanceReady: gate.performanceReady,
    searchSpaceStatus: matrix.searchSpace.status,
    workLeaseStatus: matrix.workLease.status,
    workLeaseUtilizationRatio: matrix.workLeaseUtilizationRatio,
    workLeaseUniquePartitionRatio: matrix.workLeaseUniquePartitionRatio,
    workLeaseRouteUtilizationRatio: matrix.workLeaseRouteUtilizationRatio,
    workLeaseWasteRisk: matrix.workLeaseWasteRisk,
    readOnlyProbeAllowed: spec.readOnlyProbeAllowed,
    telemetryReferenceAllowed: spec.telemetryReferenceAllowed,
    dryRunWorkAllowed: spec.dryRunWorkAllowed,
    miningStartAllowed: false,
    protocolContract,
    capabilities: matrix.rows.map((row) => ({
      capability: row.capability,
      status: row.status,
      available: row.available,
      engineBlocking: row.engineBlocking,
      efficiencyBlocking: row.efficiencyBlocking,
    })),
    blockedBy: spec.blockedBy,
    summary: [spec.summary, matrix.summary, gate.summary].join(" "),
    nextStep: spec.nextStep || gate.nextStep,
  };
}

export function formatExternalHashDiagnosticSnapshot(snapshot: ExternalHashDiagnosticSnapshot) {
  return JSON.stringify(snapshot, null, 2);
}

export function compareExternalEfficiency(
  external: ExternalHashSnapshot,
  localJoulesPerTerahash: number | null,
): ExternalEfficiencyComparison {
  if (!finitePositive(external.joulesPerTerahash) || !finitePositive(localJoulesPerTerahash)) {
    return {
      status: "unavailable",
      ratio: null,
      summary: "Need both local and external power estimates to compare efficiency.",
    };
  }

  const ratio = Number(localJoulesPerTerahash) / Number(external.joulesPerTerahash);
  if (ratio >= 1.15) {
    return {
      status: "external-better",
      ratio,
      summary: `External hash is about ${ratio.toFixed(1)}x more efficient than this local profile.`,
    };
  }

  if (ratio <= 0.87) {
    const inverseRatio = 1 / ratio;
    return {
      status: "local-better",
      ratio,
      summary: `Local profile is about ${inverseRatio.toFixed(1)}x more efficient than external telemetry.`,
    };
  }

  return {
    status: "similar",
    ratio,
    summary: "External and local efficiency are in the same range.",
  };
}

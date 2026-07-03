import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import Header from "./components/Header";
import PetDisplay from "./components/PetDisplay";
import MetricsGrid from "./components/MetricsGrid";
import SettingsPanel from "./components/SettingsPanel";
import LogTicker from "./components/LogTicker";
import {
  idleJackpotSequence,
  isJackpotOverlayVisible,
  jackpotPhaseDurationMs,
  jackpotPhaseLabel,
  nextJackpotPhase,
  startJackpotSequence,
} from "./domain/jackpotSequence";
import type { JackpotSequenceSnapshot } from "./domain/jackpotSequence";
import {
  createDevLogEntry,
  createPetLogEntry,
  latestPetLogMessage,
  petLogMessageFromMiningEvent,
  petLogMessageFromRawLog,
} from "./domain/miningLogs";
import type { DevLogEntry, PetLogEntry } from "./domain/miningLogs";
import { miningModeForRuntime, miningModeLabel, miningModeOption, miningModeOptions } from "./domain/miningMode";
import type { MiningMode } from "./domain/miningMode";
import {
  createBlockCandidateEvent,
  createJackpotEvent,
  createShareEvent,
  miningEventLabel,
} from "./domain/miningEvents";
import type { MiningEvent } from "./domain/miningEvents";
import {
  derivePetState,
  isAnimatedMiningState,
  petStateLabel,
  petStatusFromState,
} from "./domain/petState";
import type { MiningEngineKind, MiningEngineLifecycle } from "./engines/miningEngine";
import {
  calculateProbabilitySnapshot,
  formatProbabilityTime,
} from "./domain/probabilityEngine";
import type { ProbabilitySnapshot } from "./domain/probabilityEngine";
import {
  TUNING_REPLICATION_HISTORY_STORAGE_KEY,
  TUNING_EVIDENCE_STORAGE_KEY,
  appendTuningObservationHistory,
  parseTuningReplicationHistoryStorageJson,
  parseTuningObservationsStorageJson,
  serializeTuningReplicationHistoryForStorage,
  serializeTuningObservationsForStorage,
} from "./domain/evidencePersistence";
import { createTuningSweepPlan, diffTuningShareCounters, findTuningSweepStepForRuntime, upsertTuningObservation } from "./domain/efficiencyTuning";
import type { TuningObservation, TuningShareCounters } from "./domain/efficiencyTuning";
import { calculateTuningWindowElapsedSeconds, createTuningAutoSampleCapture, evaluateTuningAutoSampleGate, hasTuningWindowCounterReset } from "./domain/tuningAutoSampler";
import {
  createOptimizationEvidenceSnapshot,
  formatOptimizationEvidenceSnapshot,
} from "./domain/optimizationEvidence";
import type { OptimizationOperatingGoal } from "./domain/optimizationEvidence";
import {
  createMiningAlgorithmDiagnosticSnapshot,
  formatMiningAlgorithmDiagnosticSnapshot,
} from "./domain/algorithmDiagnostics";
import { formatError, formatUptime } from "./formatting";
import { useBlockHeight } from "./hooks/useBlockHeight";
import { useDiagnosticsActions } from "./hooks/useDiagnosticsActions";
import { useMiningEngineController } from "./hooks/useMiningEngineController";
import { useHeartbeatNotifications } from "./hooks/useHeartbeatNotifications";
import { useSimulationMiningSession } from "./hooks/useSimulationMiningSession";
import { notificationSettingsFromConfig } from "./notificationSettings";
import { derivePetCompanionSnapshot } from "./pets/companion";
import { getPetProfile } from "./pets/profiles";
import {
  adaptConfigForHardware,
  cpuKernelModeForRouteAlgorithm,
  expectedSharesPerHour,
  formatDifficulty,
  formatHashrate,
  formatShareRate,
  hasHardwareGpuDevice,
  hasSoftwareGpuDevice,
  isGpuComputeMode,
  normalizeAppConfig,
  presetPort,
  realMiningStartError,
  resolveRuntimeMiningProfile,
  sanitizeGpuDeviceId,
  threadsForPreset,
} from "./miningLogic";
import type {
  AppConfig,
  BlockFoundEvent,
  GpuBenchmarkResult,
  GpuDevice,
  PetStatus,
  PerformancePreset,
  PoolDiagnosticReport,
  RealMiningStats,
  RuntimeMiningProfile,
  SimulationStats,
  SystemInfo,
} from "./miningLogic";

const fallbackConfig: AppConfig = {
  btc_address: "",
  pool_host: "public-pool.io",
  pool_port: 3333,
  pool_password: "x",
  worker_name: "btc-lottery-pet",
  cpu_threads: 1,
  performance_preset: "eco",
  real_mining_enabled: false,
  enable_notifications: true,
  notify_on_jackpot: true,
  notify_on_share_accepted: false,
  notify_on_connection_error: true,
  heartbeat_interval: "off",
  notification_channel: "local_windows_toast",
  webhook_url: "",
  external_hash_interface: "none",
  external_hash_network_host: "",
  external_hash_direct_port: "",
  external_hash_direct_endpoint: "",
  external_hash_polling_enabled: false,
  external_hash_poll_interval_seconds: 60,
  compute_mode: "cpu",
  gpu_enabled: false,
  gpu_device_id: null,
  gpu_intensity_percent: 10,
  pet_profile_id: "classic-slot",
};

const fallbackSystemInfo: SystemInfo = {
  available_parallelism: Math.max(1, navigator.hardwareConcurrency || 1),
  default_cpu_threads: 1,
  recommended_cpu_threads: Math.min(2, Math.max(1, navigator.hardwareConcurrency || 1)),
};

const fallbackGpuDevices: GpuDevice[] = [
  { id: "auto", name: "Auto", simulated: true },
  { id: "simulated-gpu", name: "Simulated GPU", simulated: true },
];

const idleRealStats: RealMiningStats = {
  hashrate: 0,
  accepted_shares: 0,
  rejected_shares: 0,
  stale_shares_dropped: 0,
  queued_shares_dropped: 0,
  best_difficulty: 0,
  share_difficulty: 0,
  current_job_id: "",
  connection_status: "Stopped",
  gpu_backend: "",
  gpu_device_name: "",
  gpu_dispatch_size: 0,
  gpu_dispatch_ms: 0,
  gpu_throttle_ms: 0,
};

const runningInTauri = isTauri();
const MIN_EFFICIENCY_OBSERVATION_SECONDS = 20;
const AUTO_TUNING_SAMPLE_WINDOW_SECONDS = 60;

function readTuningEvidenceFromStorage() {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    return parseTuningObservationsStorageJson(
      window.localStorage.getItem(TUNING_EVIDENCE_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function persistTuningEvidenceToStorage(observations: TuningObservation[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const payload = serializeTuningObservationsForStorage(observations);
    const storedObservations = parseTuningObservationsStorageJson(payload);
    if (storedObservations.length === 0) {
      window.localStorage.removeItem(TUNING_EVIDENCE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(TUNING_EVIDENCE_STORAGE_KEY, payload);
  } catch {
    // Local evidence is useful but must never block mining or diagnostics.
  }
}

function clearTuningEvidenceStorage() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(TUNING_EVIDENCE_STORAGE_KEY);
  } catch {
    // Ignore storage failures; runtime state is still cleared by React.
  }
}

function readTuningReplicationHistoryFromStorage(): TuningObservation[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    return parseTuningReplicationHistoryStorageJson(
      window.localStorage.getItem(TUNING_REPLICATION_HISTORY_STORAGE_KEY),
    );
  } catch {
    return [];
  }
}

function persistTuningReplicationHistoryToStorage(history: TuningObservation[]) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const payload = serializeTuningReplicationHistoryForStorage(history);
    const storedHistory = parseTuningReplicationHistoryStorageJson(payload);
    if (storedHistory.length === 0) {
      window.localStorage.removeItem(TUNING_REPLICATION_HISTORY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(TUNING_REPLICATION_HISTORY_STORAGE_KEY, payload);
  } catch {
    // Replication history is advisory and must not block mining.
  }
}

function clearTuningReplicationHistoryStorage() {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(TUNING_REPLICATION_HISTORY_STORAGE_KEY);
  } catch {
    // Ignore storage failures; runtime state is still cleared by React.
  }
}


function formatDispatchSize(dispatchSize: number) {
  if (!dispatchSize) {
    return "Waiting";
  }

  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dispatchSize);
}

function performancePresetLabel(preset: PerformancePreset) {
  switch (preset) {
    case "eco":
      return "Eco";
    case "normal":
      return "Normal";
    case "turbo":
      return "Turbo";
    case "custom":
      return "Custom";
  }
}

function optimizationGoalForPreset(preset: PerformancePreset): OptimizationOperatingGoal {
  switch (preset) {
    case "eco":
      return "lowest_power";
    case "turbo":
      return "max_hashrate";
    case "custom":
      return "max_efficiency";
    case "normal":
    default:
      return "balanced";
  }
}

function compactClaimStatus(claim: { status: string; scope: string; claimAllowed: boolean }) {
  if (claim.claimAllowed) {
    return `PROVEN ${claim.scope === "local" ? "LOCAL" : "EXT"}`;
  }
  const scope = claim.scope === "external_reference" ? "EXT" : claim.scope === "local" ? "LOCAL" : "WAIT";
  return `${claim.status.replace(/_/g, " ").toUpperCase()} ${scope}`;
}

function compactClaimNextAction(action: string) {
  switch (action) {
    case "measure_power":
      return "MEASURE POWER";
    case "collect_shares":
      return "COLLECT SHARES";
    case "run_stability_window":
      return "RUN 15M";
    case "cooling":
      return "COOLING";
    case "prove_external_work":
      return "PROVE WORK";
    case "collect_telemetry":
      return "TELEMETRY";
    case "release_gate":
      return "RELEASE GATE";
    case "monitor":
      return "MONITOR";
    default:
      return "OPEN SETTINGS";
  }
}
function compactObjectiveStatus(certificate: { status: string; lowPowerReady: boolean; highHashReady: boolean }) {
  if (certificate.status === "ready") {
    return "READY DENSITY+BURST";
  }
  if (certificate.status === "partial" && certificate.lowPowerReady) {
    return certificate.highHashReady ? "PARTIAL BURST" : "LOW READY";
  }
  if (certificate.status === "dry_run") {
    return "EXT DRY RUN";
  }
  if (certificate.status === "blocked") {
    return "BLOCKED";
  }
  return "COLLECTING";
}

function compactObjectiveScore(certificate: {
  objectiveProgressScore: number;
  lowPowerProgressScore: number;
  highHashProgressScore: number;
}) {
  return `${certificate.objectiveProgressScore}% / L${certificate.lowPowerProgressScore}% / H${certificate.highHashProgressScore}%`;
}

function compactObjectiveGap(gap: string) {
  switch (gap) {
    case "none":
      return "CLEAR";
    case "low_power_evidence":
      return "LOW EVIDENCE";
    case "high_hash_measurement":
      return "HASH MEASURE";
    case "max_hash_marginal_hold":
      return "MARGINAL HOLD";
    case "kernel_regression":
      return "KERNEL REGRESS";
    case "high_hash_cooldown":
      return "HASH COOLDOWN";
    case "runtime_guard":
      return "RUNTIME GUARD";
    case "external_dry_run":
      return "EXT DRY RUN";
    default:
      return gap.replace(/_/g, " ").toUpperCase();
  }
}
function compactHighHashPath(path: string) {
  switch (path) {
    case "manual_burst":
      return "MANUAL BURST";
    case "marginal_hold":
      return "HOLD WATTS";
    case "needs_measurement":
      return "MEASURE";
    case "cooldown":
      return "COOLDOWN";
    case "external_dry_run":
      return "EXT DRY RUN";
    case "none":
      return "NONE";
    default:
      return path.replace(/_/g, " ").toUpperCase();
  }
}

function compactObjectiveAction(action: string) {
  switch (action) {
    case "run_density_lane":
      return "RUN DENSITY";
    case "keep_manual_burst_available":
      return "BURST READY";
    case "capture_local_evidence":
      return "CAPTURE";
    case "measure_burst_headroom":
      return "MEASURE BURST";
    case "hold_max_hash":
      return "HOLD MAX";
    case "recover_runtime_guard":
      return "RECOVER";
    case "validate_external_dry_run":
      return "EXT DRY RUN";
    case "monitor":
      return "MONITOR";
    default:
      return action.replace(/_/g, " ").toUpperCase();
  }
}

function compactRouteAlgorithm(algorithm: string) {
  switch (algorithm) {
    case "double_sha256_midstate":
      return "MIDSTATE";
    case "double_sha256_full_header":
      return "FULL HEADER";
    case "double_sha256_pending_midstate":
      return "MIDSTATE PENDING";
    default:
      return algorithm.replace(/_/g, " ").toUpperCase();
  }
}

function compactObjectiveAuditStage(stage: string) {
  switch (stage) {
    case "local_density_manual_burst":
      return "DENSITY+BURST";
    case "local_density_default":
      return "DENSITY";
    case "external_dry_run_only":
      return "EXT DRY RUN";
    case "runtime_recovery":
      return "RECOVERY";
    case "evidence_wait":
      return "EVIDENCE WAIT";
    default:
      return stage.replace(/_/g, " ").toUpperCase();
  }
}

function compactObjectiveAuditClaims(audit: {
  lowPowerClaimAllowed: boolean;
  highHashClaimAllowed: boolean;
  fullObjectiveClaimAllowed: boolean;
  latestResearchClaimAllowed: boolean;
}) {
  const runtimeClaim = audit.fullObjectiveClaimAllowed
    ? "FULL"
    : [audit.lowPowerClaimAllowed ? "LOW" : "LOW WAIT", audit.highHashClaimAllowed ? "HASH" : "HASH WAIT"].join("+");
  return `${runtimeClaim} / ${audit.latestResearchClaimAllowed ? "FRESH" : "REVIEW"}`;
}

function compactObjectiveAuditEvidence(ids: string[]) {
  if (ids.length === 0) {
    return "CLEAR";
  }
  const labels = ids.slice(0, 2).map((id) => {
    switch (id) {
      case "frontier_research_refresh":
      case "refresh_frontier_sources":
        return "RESEARCH";
      case "research_frontier_filter":
        return "FRONTIER";
      case "low_power_evidence":
        return "LOW POWER";
      case "high_hash_measurement":
        return "HASH MEASURE";
      case "consensus_midstate":
      case "midstate_benchmark_evidence":
        return "MIDSTATE";
      case "runtime_power_hash_recovery":
      case "runtime_guard":
        return "RUNTIME";
      case "external_work_validation":
        return "EXT WORK";
      default:
        return id.replace(/_/g, " ").toUpperCase();
    }
  });
  return ids.length > labels.length ? `${labels.join("+")} +${ids.length - labels.length}` : labels.join("+");
}
function compactPowerLane(certificate: { sustainableWatts: number | null; sustainableHashrate: number | null; selectedLaneStatus: string }) {
  if (certificate.sustainableWatts && certificate.sustainableHashrate) {
    const watts = certificate.sustainableWatts.toFixed(certificate.sustainableWatts < 100 ? 1 : 0);
    return `${watts}W / ${formatHashrate(certificate.sustainableHashrate)}`;
  }
  return certificate.selectedLaneStatus.replace(/_/g, " ").toUpperCase();
}
function useLatestRef<T>(val: T) {
  const ref = useRef(val);
  ref.current = val;
  return ref;
}

function App() {
  const [isMining, setIsMining] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [appUptime, setAppUptime] = useState(0);
  const [miningUptime, setMiningUptime] = useState(0);
  const [config, setConfig] = useState<AppConfig>(fallbackConfig);
  const [draftConfig, setDraftConfig] = useState<AppConfig>(fallbackConfig);
  const [realModeEnabled, setRealModeEnabled] = useState(false);
  const [selectedMiningMode, setSelectedMiningMode] = useState<MiningMode | null>(null);
  const [showModeSelection, setShowModeSelection] = useState(true);
  const [showCpuWarning, setShowCpuWarning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [realStats, setRealStats] = useState<RealMiningStats>(idleRealStats);
  const [activeRuntimeProfile, setActiveRuntimeProfile] = useState<RuntimeMiningProfile | null>(null);
  const [simulationStats, setSimulationStats] = useState<SimulationStats>({
    status: "Sleeping",
    hashrate: 0,
    bestDifficulty: 0.01,
  });

  const [simAccepted, setSimAccepted] = useState(0);
  const [simRejected, setSimRejected] = useState(0);
  const blockHeight = useBlockHeight();
  const [latestLog, setLatestLog] = useState("Ready to dream.");
  const [petLogs, setPetLogs] = useState<PetLogEntry[]>([]);
  const [devLogs, setDevLogs] = useState<DevLogEntry[]>([]);
  const [lastMiningEvent, setLastMiningEvent] = useState<MiningEvent | null>(null);
  const [attentionEvent, setAttentionEvent] = useState<MiningEvent | null>(null);
  const [lastShare, setLastShare] = useState("None");
  const [jackpotSequence, setJackpotSequence] =
    useState<JackpotSequenceSnapshot>(idleJackpotSequence);

  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [displayMode, setDisplayMode] = useState<"compact" | "detail">("compact");
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(fallbackSystemInfo);
  const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>(fallbackGpuDevices);
  const [hardwareReady, setHardwareReady] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<GpuBenchmarkResult | null>(null);
  const [poolDiagnosticResult, setPoolDiagnosticResult] =
    useState<PoolDiagnosticReport | null>(null);
  const [tuningEvidence, setTuningEvidence] = useState<TuningObservation[]>(() => readTuningEvidenceFromStorage());
  const [tuningReplicationHistory, setTuningReplicationHistory] = useState<TuningObservation[]>(() => readTuningReplicationHistoryFromStorage());

  const coolingDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const simShareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tuningAutoShareBaselineRef = useRef<TuningShareCounters | null>(null);
  const tuningAutoSampleBaselineSecondsRef = useRef(0);
  const tuningAutoLastCaptureKeyRef = useRef<string | null>(null);
  const [tuningAutoSampleBaselineSeconds, setTuningAutoSampleBaselineSeconds] = useState(0);
  const [runtimeProfileWindowBaseline, setRuntimeProfileWindowBaseline] = useState<{
    key: string;
    shareCounters: TuningShareCounters | null;
    sampleSeconds: number;
  }>({ key: "", shareCounters: null, sampleSeconds: 0 });
  const configRef = useLatestRef(config);
  const realStatsRef = useLatestRef(realStats);
  const simulationStatsRef = useLatestRef(simulationStats);
  const appUptimeRef = useLatestRef(appUptime);
  const miningUptimeRef = useLatestRef(miningUptime);
  const simAcceptedRef = useLatestRef(simAccepted);
  const simRejectedRef = useLatestRef(simRejected);
  const realModeEnabledRef = useLatestRef(realModeEnabled);
  const isMiningRef = useLatestRef(isMining);
  const selectedMiningModeRef = useLatestRef(selectedMiningMode);
  const lastConnectionNotificationRef = useRef(0);

  useEffect(() => {
    persistTuningEvidenceToStorage(tuningEvidence);
  }, [tuningEvidence]);

  useEffect(() => {
    persistTuningReplicationHistoryToStorage(tuningReplicationHistory);
  }, [tuningReplicationHistory]);

  const appendPetLog = useCallback((message: string) => {
    const entry = createPetLogEntry(message);
    setPetLogs((current) => [entry, ...current].slice(0, 20));
    setLatestLog(latestPetLogMessage(entry));
  }, []);
  const appendDevLog = useCallback((source: DevLogEntry["source"], message: string) => {
    const entry = createDevLogEntry(source, message);
    setDevLogs((current) => [entry, ...current].slice(0, 80));
  }, []);
  const captureTuningObservation = useCallback((observation: TuningObservation) => {
    const capturedAt = new Date().toISOString();
    const capturedObservation: TuningObservation = {
      ...observation,
      capturedAt,
    };
    setTuningEvidence((current) => upsertTuningObservation(current, capturedObservation));
    setTuningReplicationHistory((current) => appendTuningObservationHistory(current, capturedObservation, capturedAt));
    appendDevLog("diagnostic", "Local tuning evidence sample captured.");
    appendPetLog("Local tuning sample captured.");
  }, [appendDevLog, appendPetLog]);
  const clearTuningEvidence = useCallback(() => {
    clearTuningEvidenceStorage();
    clearTuningReplicationHistoryStorage();
    setTuningEvidence([]);
    setTuningReplicationHistory([]);
    appendDevLog("diagnostic", "Local tuning evidence cleared.");
    appendPetLog("Local tuning memory cleared.");
  }, [appendDevLog, appendPetLog]);
  const emitMiningEvent = useCallback((event: MiningEvent) => {
    if (event.level !== "LOW_LEVEL") {
      setLastMiningEvent(event);
      if (event.type === "share_accepted" || event.type === "block_candidate" || event.type === "jackpot") {
        setAttentionEvent(event);
      }

      const petMessage = petLogMessageFromMiningEvent(event);
      if (petMessage) {
        appendPetLog(petMessage);
      }
    }
  }, [appendPetLog]);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      if (coolingDownTimerRef.current) clearTimeout(coolingDownTimerRef.current);
      if (simShareTimerRef.current) clearTimeout(simShareTimerRef.current);
    };
  }, []);

  // App Uptime Timer
  useEffect(() => {
    const timer = window.setInterval(() => {
      setAppUptime((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Mining Uptime Timer
  useEffect(() => {
    if (!isMining) return;
    const timer = window.setInterval(() => {
      setMiningUptime((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isMining]);

  // Browser preview uses conservative fallbacks; Tauri supplies the local values.
  useEffect(() => {
    let cancelled = false;

    const loadStartupState = async () => {
      const loadConfig = async () => {
        try {
          return await invoke<AppConfig>("get_config");
        } catch (error) {
          if (runningInTauri && !cancelled) {
            setErrorMessage(`Could not load settings: ${formatError(error)}`);
          }
          return fallbackConfig;
        }
      };

      const loadSystemInfo = async () => {
        try {
          return await invoke<SystemInfo>("get_system_info");
        } catch {
          return fallbackSystemInfo;
        }
      };

      const loadGpuDevices = async () => {
        try {
          return await invoke<GpuDevice[]>("get_gpu_devices");
        } catch (error) {
          appendDevLog("system", `GPU detection failed: ${formatError(error)}`);
          return fallbackGpuDevices;
        }
      };

      const [loadedConfig, detectedSystemInfo, detectedGpuDevices] = await Promise.all([
        loadConfig(),
        loadSystemInfo(),
        loadGpuDevices(),
      ]);
      if (cancelled) {
        return;
      }

      const gpuDiagnostics = detectedGpuDevices
        .map((device) => device.diagnostic)
        .filter((diagnostic): diagnostic is string => Boolean(diagnostic));
      if (gpuDiagnostics.length > 0) {
        appendDevLog("system", `GPU detection diagnostic: ${gpuDiagnostics.join(" ")}`);
      }

      const adaptation = adaptConfigForHardware(loadedConfig, detectedSystemInfo, detectedGpuDevices);
      if (adaptation.changed && adaptation.messages.length > 0) {
        appendDevLog("system", `Hardware adaptation: ${adaptation.messages.join(" ")}`);
        appendPetLog("Adjusted settings for this device.");
      }

      setSystemInfo(detectedSystemInfo);
      setGpuDevices(detectedGpuDevices);
      setConfig(adaptation.config);
      setDraftConfig(adaptation.config);
      setHardwareReady(true);
    };

    void loadStartupState();

    return () => {
      cancelled = true;
    };
  }, [appendDevLog, appendPetLog]);

  useEffect(() => {
    if (!selectedMiningMode) {
      return;
    }

    const runtimeMode = miningModeForRuntime(realModeEnabled, config.compute_mode, selectedMiningMode);
    if (runtimeMode !== selectedMiningMode) {
      setSelectedMiningMode(runtimeMode);
    }
  }, [config.compute_mode, realModeEnabled, selectedMiningMode]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listen<RealMiningStats>("mining-stats", (event) => {
      if (
        event.payload.connection_status === "GPU unavailable" &&
        isMiningRef.current &&
        realModeEnabledRef.current
      ) {
        isMiningRef.current = false;
        setIsMining(false);
        setErrorMessage("GPU mining unavailable. Check GPU drivers or switch Compute Mode.");
      }

      setRealStats((current) => {
        const activeRealMining = isMiningRef.current && realModeEnabledRef.current;
        if (!activeRealMining) {
          if (
            event.payload.connection_status === "Stopped" ||
            event.payload.connection_status === "GPU unavailable"
          ) {
            return { ...event.payload, hashrate: 0 };
          }

          return current;
        }

        if (event.payload.connection_status === "Stopped") {
          return current;
        }

        return {
          ...event.payload,
          accepted_shares: Math.max(current.accepted_shares, event.payload.accepted_shares),
          rejected_shares: Math.max(current.rejected_shares, event.payload.rejected_shares),
          stale_shares_dropped: Math.max(current.stale_shares_dropped, event.payload.stale_shares_dropped),
          queued_shares_dropped: Math.max(current.queued_shares_dropped, event.payload.queued_shares_dropped ?? 0),
        };
      });
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining stats: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, []);

  // Listen to Mining Logs
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listen<string>("mining-log", (event) => {
      const message = event.payload;
      const cleanMessage = message.replace(/^\[[^\]]+\]\s*/, "");
      appendDevLog("stratum", message);

      const lowerMessage = message.toLowerCase();
      const shouldSyncRealMining = isMiningRef.current && realModeEnabledRef.current;
      const petMessage = shouldSyncRealMining ? petLogMessageFromRawLog(message) : null;
      if (petMessage) {
        appendPetLog(petMessage);
      }

      if (
        shouldSyncRealMining &&
        (lowerMessage.includes("share submitted") ||
          lowerMessage.includes("share accepted") ||
          lowerMessage.includes("share rejected"))
      ) {
        setLastShare(cleanMessage);
      }

      if (shouldSyncRealMining && lowerMessage.includes("connected to pool")) {
        setRealStats((current) => ({ ...current, connection_status: "Connected" }));
      } else if (shouldSyncRealMining && lowerMessage.includes("worker authorized successfully")) {
        setRealStats((current) => ({ ...current, connection_status: "Authorized" }));
      } else if (shouldSyncRealMining && lowerMessage.includes("job received")) {
        const jobMatch = cleanMessage.match(/Job received: id=([^,]+)/);
        setRealStats((current) => ({
          ...current,
          current_job_id: jobMatch?.[1] ?? current.current_job_id,
          connection_status: "Mining",
        }));
      }

      if (shouldSyncRealMining && lowerMessage.includes("share accepted")) {
        emitMiningEvent(createShareEvent("share_accepted", "stratum", cleanMessage));
        // Share count is tracked by the backend via mining-stats events.
        // We only trigger the notification here.
        void invoke("notify_share_accepted", {
          settings: notificationSettingsFromConfig(configRef.current),
        }).catch(() => {});
      } else if (shouldSyncRealMining && lowerMessage.includes("share rejected")) {
        emitMiningEvent(createShareEvent("share_rejected", "stratum", cleanMessage));
      }

      if (shouldSyncRealMining && lowerMessage.includes("connection error")) {
        setRealStats((current) => ({ ...current, connection_status: "Connection Error" }));
        const now = Date.now();
        if (now - lastConnectionNotificationRef.current > 60_000) {
          lastConnectionNotificationRef.current = now;
          void invoke("notify_connection_error", {
            settings: notificationSettingsFromConfig(configRef.current),
            status: cleanMessage,
          }).catch(() => {});
        }
      }
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining logs: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [appendDevLog, appendPetLog, emitMiningEvent]);

  // Listen to Block Candidate Events
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listen<BlockFoundEvent>("block-found", (event) => {
      const wasMining = isMiningRef.current;
      const engineKind: MiningEngineKind = selectedMiningModeRef.current === "solo"
        ? "stratum"
        : !realModeEnabledRef.current
          ? "simulation"
          : isGpuComputeMode(configRef.current.compute_mode)
            ? "gpu"
            : "cpu";

      emitMiningEvent(createBlockCandidateEvent("stratum", event.payload));
      emitMiningEvent(createJackpotEvent(event.payload));
      appendDevLog("stratum", `Block candidate found: job=${event.payload.job_id}, hash=${event.payload.hash}`);
      setJackpotSequence(startJackpotSequence(event.payload, wasMining, engineKind));

      if (wasMining && realModeEnabledRef.current) {
        isMiningRef.current = false;
        setIsMining(false);
        setRealStats((current) => ({
          ...current,
          hashrate: 0,
          connection_status: "Jackpot pause",
        }));
        void invoke("stop_real_mining").catch((error) => {
          appendDevLog("stratum", `Jackpot pause failed: ${formatError(error)}`);
        });
      }

      void invoke("notify_jackpot", {
        settings: notificationSettingsFromConfig(configRef.current),
        event: {
          pool: event.payload.pool,
          jobId: event.payload.job_id,
          hash: event.payload.hash,
          difficulty: event.payload.difficulty,
          timestamp: event.payload.timestamp,
        },
      }).catch(() => {});
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for block candidate events: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [appendDevLog, emitMiningEvent, configRef, isMiningRef, realModeEnabledRef, selectedMiningModeRef]);

  useHeartbeatNotifications({
    config,
    configRef,
    realStatsRef,
    simulationStatsRef,
    appUptimeRef,
    miningUptimeRef,
    simAcceptedRef,
    simRejectedRef,
    realModeEnabledRef,
    isMiningRef,
  });

  const gpuEnabled = isGpuComputeMode(config.compute_mode);

  useSimulationMiningSession({
    isMining,
    realModeEnabled,
    restartKey: config.gpu_intensity_percent,
    simShareTimerRef,
    setLatestLog,
    setSimAccepted,
    setSimRejected,
    setSimulationStats,
    emitMiningEvent,
    appendDevLog,
  });

  // Track New Best Difficulty
  const activeBestDiff = realModeEnabled ? realStats.best_difficulty : simulationStats.bestDifficulty;
  const prevBestDiffRef = useRef(0);

  useEffect(() => {
    if (!isMining) {
      prevBestDiffRef.current = activeBestDiff;
      return;
    }
    if (activeBestDiff > prevBestDiffRef.current) {
      if (prevBestDiffRef.current > 0) {
        appendPetLog("I found a sharper pattern.");
        prevBestDiffRef.current = activeBestDiff;
        return;
      }
      prevBestDiffRef.current = activeBestDiff;
    }
  }, [activeBestDiff, appendPetLog, isMining]);

  const startRealMiningConfirmed = async (runtimeProfile: RuntimeMiningProfile) => {
    isMiningRef.current = true;
    setIsMining(true);
    setActiveRuntimeProfile(runtimeProfile);
    setRealStats((current) => ({
      ...current,
      hashrate: 0,
      accepted_shares: 0,
      rejected_shares: 0,
      share_difficulty: 0,
      current_job_id: "",
      connection_status: "Connecting",
      gpu_backend: "",
      gpu_device_name: "",
      gpu_dispatch_size: 0,
      gpu_dispatch_ms: 0,
      gpu_throttle_ms: 0,
    }));

    try {
      const cpuKernelMode = cpuKernelModeForRouteAlgorithm(runtimeAlgorithmDiagnostic.routeCertificate.defaultAlgorithm);
      if (runtimeProfile.appliedRecommendation) {
        appendDevLog("diagnostic", runtimeProfile.reason);
      }
      appendDevLog("stratum", `Starting real mining on ${config.pool_host}:${config.pool_port}`);
      await invoke("start_real_mining", {
        settings: {
          poolHost: config.pool_host,
          poolPort: config.pool_port,
          poolPassword: config.pool_password,
          btcAddress: config.btc_address,
          workerName: config.worker_name,
          cpuThreads: runtimeProfile.cpuThreads,
          confirmedCpuUse: true,
          gpuEnabled,
          gpuDeviceId: sanitizeGpuDeviceId(config.gpu_device_id, gpuDevices),
          gpuIntensityPercent: runtimeProfile.gpuIntensityPercent,
          cpuKernelMode,
        },
      });
    } catch (error) {
      isMiningRef.current = false;
      setIsMining(false);
      setActiveRuntimeProfile(null);
      setErrorMessage(String(error));
      appendDevLog("stratum", `Start real mining failed: ${formatError(error)}`);
      setRealStats((current) => ({ ...current, connection_status: "Connection Error" }));
    }
  };

  const prepareMiningStart = () => {
    setErrorMessage(null);
    setMiningUptime(0);
    setIsCoolingDown(false);
    setLastShare("None");
    setAttentionEvent(null);
    if (coolingDownTimerRef.current) {
      clearTimeout(coolingDownTimerRef.current);
      coolingDownTimerRef.current = null;
    }
  };

  const startSimulationSession = () => {
    setActiveRuntimeProfile(null);
    isMiningRef.current = true;
    setIsMining(true);
    setSimAccepted(0);
    setSimRejected(0);
    appendPetLog("I am dreaming of hashes.");
    setSimulationStats((current) => ({
      ...current,
      status: "Mining",
    }));
  };

  const runtimeMiningProfileForConfig = () => resolveRuntimeMiningProfile(
    config,
    systemInfo,
    runtimeAlgorithmDiagnostic.runtimeRecommendation,
  );

  const startRealMiningSession = async (kind: Exclude<MiningEngineKind, "simulation">) => {
    const startError = realMiningStartError(config, gpuDevices, runningInTauri);
    if (startError) {
      setErrorMessage(startError);
      setShowSettings(true);
      return;
    }

    const runtimeProfile = runtimeMiningProfileForConfig();
    const highCpuRequested =
      runtimeProfile.cpuThreads > 0 &&
      (config.performance_preset === "turbo" ||
        runtimeProfile.cpuThreads > systemInfo.recommended_cpu_threads);

    if (highCpuRequested) {
      setShowCpuWarning(true);
      return;
    }

    appendPetLog(kind === "gpu" ? "The GPU is warming up." : "I am listening for pool work.");
    await startRealMiningConfirmed(runtimeProfile);
  };

  const confirmCpuWarning = async () => {
    setShowCpuWarning(false);
    await startRealMiningConfirmed(runtimeMiningProfileForConfig());
  };

  const beginMiningCooldown = () => {
    isMiningRef.current = false;
    setIsMining(false);
    setActiveRuntimeProfile(null);
    setIsCoolingDown(true);

    // Clear simulation timers immediately to avoid late logs/flashes after STOP
    if (simShareTimerRef.current) {
      clearTimeout(simShareTimerRef.current);
      simShareTimerRef.current = null;
    }
    setAttentionEvent(null);

    if (coolingDownTimerRef.current) {
      clearTimeout(coolingDownTimerRef.current);
    }
    coolingDownTimerRef.current = setTimeout(() => {
      setIsCoolingDown(false);
      coolingDownTimerRef.current = null;
    }, 4000);
  };

  const stopSimulationSession = () => {
    beginMiningCooldown();
    appendPetLog("Dream mode is cooling down.");
    setSimulationStats((current) => ({
      ...current,
      status: "Sleeping",
      hashrate: 0,
    }));
  };

  const stopRealMiningSession = async () => {
    beginMiningCooldown();
    appendPetLog("I am stepping away from the pool.");
    setRealStats((current) => ({
      ...current,
      hashrate: 0,
      connection_status: "Stopped",
    }));

    try {
      appendDevLog("stratum", "Stopping real mining");
      await invoke("stop_real_mining");
    } catch (error) {
      appendDevLog("stratum", `Stop real mining failed: ${formatError(error)}`);
      if (runningInTauri) {
        setErrorMessage(`Could not stop mining: ${formatError(error)}`);
      }
    }
  };

  const openModeSelection = () => {
    if (isMining) {
      setErrorMessage("Stop mining before changing modes.");
      return;
    }

    setShowModeSelection(true);
  };

  const selectMiningMode = (mode: MiningMode) => {
    if (isMining) {
      setErrorMessage("Stop mining before changing modes.");
      return;
    }

    const option = miningModeOption(mode);
    setShowModeSelection(false);
    setRealModeEnabled(option.realModeEnabled);
    setErrorMessage(null);
    appendPetLog(`${option.title} selected.`);

    const requestedConfig: AppConfig = {
      ...config,
      compute_mode: option.computeMode,
      gpu_enabled: option.computeMode !== "cpu",
      real_mining_enabled: option.realModeEnabled,
    };
    const adaptation = adaptConfigForHardware(requestedConfig, systemInfo, gpuDevices);
    if (adaptation.messages.length > 0) {
      appendDevLog("system", `Mode adapted for this device: ${adaptation.messages.join(" ")}`);
      appendPetLog("Mode adjusted for this device.");
      if (option.computeMode === "gpu" && adaptation.config.compute_mode !== "gpu") {
        setErrorMessage("No hardware GPU detected. Using CPU mining mode on this device.");
      }
    }

    setConfig(adaptation.config);
    setDraftConfig(adaptation.config);
    setSelectedMiningMode(miningModeForRuntime(option.realModeEnabled, adaptation.config.compute_mode, mode));
  };

  const saveSettings = async () => {
    setErrorMessage(null);

    const adaptation = adaptConfigForHardware(draftConfig, systemInfo, gpuDevices);
    const settings = adaptation.config;
    if (adaptation.messages.length > 0) {
      appendDevLog("system", `Settings adapted for this device: ${adaptation.messages.join(" ")}`);
      appendPetLog("Settings adjusted for this device.");
    }

    try {
      const savedSettings = await invoke<AppConfig>("save_config", { config: settings });
      setConfig(savedSettings);
      setDraftConfig(savedSettings);
      setSelectedMiningMode((current) => (
        current ? miningModeForRuntime(realModeEnabled, savedSettings.compute_mode, current) : current
      ));
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not save settings: ${formatError(error)}`);
        return;
      }

      setConfig(settings);
      setDraftConfig(settings);
      setSelectedMiningMode((current) => (
        current ? miningModeForRuntime(realModeEnabled, settings.compute_mode, current) : current
      ));
    }

    setShowSettings(false);
  };

  const runGpuBenchmark = async () => {
    setErrorMessage(null);
    const gpuDeviceId = sanitizeGpuDeviceId(draftConfig.gpu_device_id, gpuDevices);

    try {
      const result = await invoke<GpuBenchmarkResult>("run_gpu_benchmark", {
        gpuDeviceId,
        gpuIntensityPercent: Number(draftConfig.gpu_intensity_percent),
      });
      setBenchmarkResult(result);
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not run GPU benchmark: ${formatError(error)}`);
        return;
      }

      const gpuIntensityPercent = Number(draftConfig.gpu_intensity_percent);
      setBenchmarkResult({
        device_id: gpuDeviceId || "auto",
        device_name:
          gpuDevices.find((device) => device.id === gpuDeviceId)?.name || "Auto",
        simulated: true,
        gpu_intensity_percent: gpuIntensityPercent,
        hashrate: 120_000_000 * gpuIntensityPercent / 10,
        duration_ms: 250,
        note: "Simulated benchmark only. No real GPU workload was started.",
        generated_at: new Date().toISOString(),
      });
    }
  };

  const runPoolDiagnostic = async () => {
    setErrorMessage(null);
    setPoolDiagnosticResult(null);

    const settings = normalizeAppConfig(draftConfig, systemInfo, gpuDevices);

    try {
      const result = await invoke<PoolDiagnosticReport>("diagnose_pool_connection", {
        settings: {
          poolHost: settings.pool_host,
          poolPort: settings.pool_port,
          poolPassword: settings.pool_password,
          btcAddress: settings.btc_address,
          workerName: settings.worker_name,
        },
      });
      setPoolDiagnosticResult(result);
      appendDevLog("diagnostic", `Pool diagnostic: ${result.summary}`);
      appendPetLog("Pool diagnostic finished.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not run pool diagnostic: ${formatError(error)}`);
        return;
      }

      const result: PoolDiagnosticReport = {
        generated_at: new Date().toISOString(),
        pool: `${settings.pool_host}:${settings.pool_port}`,
        steps: [
          {
            name: "DESKTOP",
            status: "skipped",
            message: "Pool diagnostics require the desktop runtime.",
            duration_ms: 0,
          },
        ],
        summary: "Desktop runtime required for pool diagnostics.",
      };
      setPoolDiagnosticResult(result);
      appendDevLog("diagnostic", `Pool diagnostic: ${result.summary}`);
      appendPetLog("Pool diagnostic needs the desktop app.");
    }
  };


  const {
    openLogs,
    copyLogPath,
    copyDiagnostics,
    saveDiagnostics,
  } = useDiagnosticsActions({
    runningInTauri,
    setErrorMessage,
    setPetLogMessage: appendPetLog,
    getDevLogSnapshot: () => devLogs
      .slice(0, 40)
      .map((entry) => `[${entry.timestamp}] ${entry.source}: ${entry.message}`)
      .join("\n"),
    getFrontendDiagnosticSections: ({ backendDiagnosticSnapshot }) => [
      {
        title: "Frontend Optimization Evidence",
        body: formatOptimizationEvidenceSnapshot(createOptimizationEvidenceSnapshot({
          tuningObservations: tuningEvidence,
          externalHashHistory: [],
          preferredGoal: optimizationGoalForPreset(config.performance_preset),
        })),
      },
      {
        title: "Frontend Mining Algorithm Plan",
        body: formatMiningAlgorithmDiagnosticSnapshot(createMiningAlgorithmDiagnosticSnapshot({
          config,
          telemetry: null,
          tuningObservations: tuningEvidence,
          tuningHistory: tuningReplicationHistory,
          externalHashHistory: [],
          externalOperatingEvidenceSamples: [],
          algorithmKernelBenchmark: backendDiagnosticSnapshot.algorithmKernelBenchmark,
          goal: optimizationGoalForPreset(config.performance_preset),
          availableCpuThreads: systemInfo.available_parallelism,
          recommendedCpuThreads: systemInfo.recommended_cpu_threads,
          hardwareGpuAvailable: hasHardwareGpuDevice(gpuDevices),
          observedHashrate: observedEfficiencyHashrate,
          observedComputeMode: observedEfficiencyHashrate ? config.compute_mode : null,
          observedCpuThreads,
          observedGpuIntensityPercent,
          observedSampleSeconds: runtimeDiagnosticElapsedSeconds,
          acceptedShares: runtimeDiagnosticShareCounters.acceptedShares,
          rejectedShares: runtimeDiagnosticShareCounters.rejectedShares,
          staleSharesDropped: runtimeDiagnosticShareCounters.staleSharesDropped,
          queuedSharesDropped: runtimeDiagnosticShareCounters.queuedSharesDropped,
          gpuDispatchMs: realModeEnabled ? realStats.gpu_dispatch_ms : 0,
          gpuThrottleMs: realModeEnabled ? realStats.gpu_throttle_ms : 0,
          benchmarkHashrate: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.hashrate : null,
          benchmarkGpuIntensityPercent: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.gpu_intensity_percent : null,
          currentComputeMode: config.compute_mode,
          currentCpuThreads: effectiveCpuThreads,
          currentGpuIntensityPercent,
        })),
      },
    ],
  });

  const toggleAlwaysOnTop = async () => {
    setErrorMessage(null);

    const nextValue = !alwaysOnTop;

    try {
      await invoke("set_window_always_on_top", { alwaysOnTop: nextValue });
      setAlwaysOnTop(nextValue);
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not update always-on-top: ${formatError(error)}`);
        return;
      }

      setAlwaysOnTop(nextValue);
    }
  };

  const petStateContext = {
    isMining,
    realModeEnabled,
    isCoolingDown,
    attentionEventType: attentionEvent?.type ?? null,
    jackpotPhase: jackpotSequence.phase,
    computeMode: config.compute_mode,
    connectionStatus: realStats.connection_status,
    currentJobId: realStats.current_job_id,
  };
  const petState = derivePetState(petStateContext);
  const petStatus: PetStatus = petStatusFromState(petState, petStateContext);
  const activePetProfile = getPetProfile(config.pet_profile_id);

  const engineLifecycle: MiningEngineLifecycle = {
    prepareStart: prepareMiningStart,
    startSimulation: startSimulationSession,
    startReal: startRealMiningSession,
    stopSimulation: stopSimulationSession,
    stopReal: stopRealMiningSession,
    status: (kind: MiningEngineKind) => ({
      kind,
      petState,
      running: isMining,
      label: petStateLabel(petState),
    }),
  };
  const miningEngine = useMiningEngineController({
    realModeEnabled,
    selectedMiningMode,
    computeMode: config.compute_mode,
    lifecycle: engineLifecycle,
  });
  const miningEngineStatus = miningEngine.status();

  useEffect(() => {
    if (!attentionEvent) {
      return;
    }

    const timer = window.setTimeout(() => setAttentionEvent(null), 3000);
    return () => window.clearTimeout(timer);
  }, [attentionEvent]);

  useEffect(() => {
    const duration = jackpotPhaseDurationMs(jackpotSequence.phase);
    if (duration === null) {
      return;
    }

    const sequenceId = jackpotSequence.id;
    const timer = window.setTimeout(() => {
      setJackpotSequence((current) => (
        current.id === sequenceId
          ? { ...current, phase: nextJackpotPhase(current.phase) }
          : current
      ));
    }, duration);

    return () => window.clearTimeout(timer);
  }, [jackpotSequence.id, jackpotSequence.phase]);

  useEffect(() => {
    if (jackpotSequence.phase !== "resume") {
      return;
    }

    let cancelled = false;
    const resumeMining = async () => {
      if (jackpotSequence.wasMining && jackpotSequence.engineKind) {
        if (jackpotSequence.engineKind === "simulation") {
          startSimulationSession();
        } else {
          await startRealMiningConfirmed(runtimeMiningProfileForConfig());
        }
      }

      if (!cancelled) {
        setJackpotSequence((current) => (
          current.id === jackpotSequence.id
            ? { ...current, phase: "complete" }
            : current
        ));
      }
    };

    void resumeMining();
    return () => {
      cancelled = true;
    };
  }, [
    jackpotSequence.engineKind,
    jackpotSequence.id,
    jackpotSequence.phase,
    jackpotSequence.wasMining,
  ]);

  const dismissJackpotSequence = () => {
    setJackpotSequence((current) => (
      current.phase === "idle" || current.phase === "complete"
        ? idleJackpotSequence
        : { ...current, phase: "resume" }
    ));
  };
  const jackpotVisible = isJackpotOverlayVisible(jackpotSequence);
  const jackpotBlock = jackpotSequence.block;

  const sharesValue = realModeEnabled
    ? `${realStats.accepted_shares} / ${realStats.rejected_shares}`
    : `${simAccepted} / ${simRejected}`;
  const staleDropsValue = realModeEnabled ? `${realStats.stale_shares_dropped}` : "SIM";
  const queueDropsValue = realModeEnabled ? `${realStats.queued_shares_dropped}` : "SIM";
  const acceptedShares = realModeEnabled ? realStats.accepted_shares : simAccepted;
  const rejectedShares = realModeEnabled ? realStats.rejected_shares : simRejected;
  const currentTuningShareCounters = useMemo<TuningShareCounters>(() => ({
    acceptedShares,
    rejectedShares,
    staleSharesDropped: realModeEnabled ? realStats.stale_shares_dropped : 0,
    queuedSharesDropped: realModeEnabled ? realStats.queued_shares_dropped : 0,
  }), [
    acceptedShares,
    realModeEnabled,
    realStats.queued_shares_dropped,
    realStats.stale_shares_dropped,
    rejectedShares,
  ]);
  const activeHashrate = realModeEnabled ? realStats.hashrate : simulationStats.hashrate * 1_000_000;

  const displayedHashrate = realModeEnabled
    ? formatHashrate(realStats.hashrate)
    : `${simulationStats.hashrate.toFixed(2)} MH/s`;
  const probabilitySnapshot: ProbabilitySnapshot = calculateProbabilitySnapshot({
    currentDifficulty: null,
    hashrate: activeHashrate,
    bestDifficulty: activeBestDiff,
    acceptedShares,
    rejectedShares,
    miningUptimeSeconds: miningUptime,
    realModeEnabled,
  });
  const petCompanion = derivePetCompanionSnapshot({
    profile: activePetProfile,
    petState,
    petStatus,
    isMining,
    realModeEnabled,
    computeMode: config.compute_mode,
    connectionStatus: realStats.connection_status,
    latestLog,
    lastEvent: lastMiningEvent,
    acceptedShares,
    rejectedShares,
    bestDifficulty: activeBestDiff,
    hashrate: activeHashrate,
    luckMeter: probabilitySnapshot.luckMeter,
    miningUptimeSeconds: miningUptime,
    appUptimeSeconds: appUptime,
  });
  const compactComputeMode = realModeEnabled
    ? gpuEnabled ? (config.compute_mode === "hybrid" ? "CPU+GPU" : "GPU") : "CPU"
    : "SIM";
  const statusClassName = petState === "LUCKY_EVENT" ? "flash" : "";
  const isMiningAnimation = isAnimatedMiningState(petState);
  const displayStatus = petStatus === "Jackpot" ? "JACKPOT" : petStatus;
  const poolStatus = `${config.pool_host}:${config.pool_port}`;
  const authStatus =
    realStats.connection_status === "Authorized" || realStats.connection_status === "Mining"
      ? "Authorized"
      : realStats.connection_status;
  const jobStatus = realStats.current_job_id || "Waiting";
  const shareDifficultyValue = realModeEnabled && realStats.share_difficulty > 0
    ? formatDifficulty(realStats.share_difficulty)
    : "Waiting";
  const shareRateValue = realModeEnabled
    ? formatShareRate(expectedSharesPerHour(realStats.hashrate, realStats.share_difficulty))
    : "SIM";
  const currentDifficultyValue = probabilitySnapshot.currentDifficulty
    ? formatDifficulty(probabilitySnapshot.currentDifficulty)
    : "Waiting";
  const configuredCpuThreads = threadsForPreset(
    config.performance_preset,
    systemInfo,
    config.cpu_threads,
    config.compute_mode === "gpu",
  );
  const effectiveCpuThreads = realModeEnabled && activeRuntimeProfile
    ? activeRuntimeProfile.cpuThreads
    : configuredCpuThreads;
  const effectiveGpuIntensityPercent = realModeEnabled && activeRuntimeProfile
    ? activeRuntimeProfile.gpuIntensityPercent
    : config.gpu_intensity_percent;
  const observedEfficiencyHashrate = realModeEnabled && isMining && miningUptime >= MIN_EFFICIENCY_OBSERVATION_SECONDS && realStats.hashrate > 0
    ? realStats.hashrate
    : null;
  const observedCpuThreads = observedEfficiencyHashrate ? effectiveCpuThreads : null;
  const observedGpuIntensityPercent = observedEfficiencyHashrate
    ? config.compute_mode === "cpu" ? 0 : effectiveGpuIntensityPercent
    : null;
  const currentGpuIntensityPercent = config.compute_mode === "cpu" ? 0 : effectiveGpuIntensityPercent;
  const runtimeTuningSweepPlan = useMemo(() => createTuningSweepPlan({
    goal: optimizationGoalForPreset(config.performance_preset),
    availableCpuThreads: systemInfo.available_parallelism,
    recommendedCpuThreads: systemInfo.recommended_cpu_threads,
    hardwareGpuAvailable: hasHardwareGpuDevice(gpuDevices),
    observedHashrate: observedEfficiencyHashrate,
    observedComputeMode: observedEfficiencyHashrate ? config.compute_mode : null,
    observedCpuThreads,
    observedGpuIntensityPercent,
    benchmarkHashrate: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.hashrate : null,
    benchmarkGpuIntensityPercent: benchmarkResult && !benchmarkResult.simulated
      ? benchmarkResult.gpu_intensity_percent
      : null,
    currentComputeMode: config.compute_mode,
    currentCpuThreads: effectiveCpuThreads,
    currentGpuIntensityPercent,
    maxSteps: 5,
    sampleSeconds: AUTO_TUNING_SAMPLE_WINDOW_SECONDS,
  }), [
    benchmarkResult?.gpu_intensity_percent,
    benchmarkResult?.hashrate,
    benchmarkResult?.simulated,
    config.compute_mode,
    config.performance_preset,
    currentGpuIntensityPercent,
    effectiveCpuThreads,
    gpuDevices,
    observedCpuThreads,
    observedEfficiencyHashrate,
    observedGpuIntensityPercent,
    systemInfo.available_parallelism,
    systemInfo.recommended_cpu_threads,
  ]);
  const runtimeActiveTuningStep = useMemo(() => {
    if (!observedEfficiencyHashrate) {
      return null;
    }
    return findTuningSweepStepForRuntime(runtimeTuningSweepPlan, {
      computeMode: config.compute_mode,
      cpuThreads: observedCpuThreads,
      gpuIntensityPercent: observedGpuIntensityPercent,
    });
  }, [config.compute_mode, observedCpuThreads, observedEfficiencyHashrate, observedGpuIntensityPercent, runtimeTuningSweepPlan.steps]);
  const runtimeProfileWindowKey = [
    isMining ? "mining" : "idle",
    realModeEnabled ? "real" : "sim",
    runtimeActiveTuningStep?.id ?? "none",
  ].join(":");
  const effectiveRuntimeProfileWindowBaseline = runtimeProfileWindowBaseline.key === runtimeProfileWindowKey && runtimeProfileWindowBaseline.shareCounters
    ? runtimeProfileWindowBaseline
    : { key: runtimeProfileWindowKey, shareCounters: currentTuningShareCounters, sampleSeconds: miningUptime };
  const runtimeDiagnosticElapsedSeconds = useMemo(() => (
    calculateTuningWindowElapsedSeconds(
      observedEfficiencyHashrate ? miningUptime : null,
      effectiveRuntimeProfileWindowBaseline.sampleSeconds,
    )
  ), [effectiveRuntimeProfileWindowBaseline.sampleSeconds, miningUptime, observedEfficiencyHashrate]);
  const runtimeDiagnosticShareCounters = useMemo(() => (
    diffTuningShareCounters(currentTuningShareCounters, effectiveRuntimeProfileWindowBaseline.shareCounters)
  ), [currentTuningShareCounters, effectiveRuntimeProfileWindowBaseline]);

  useEffect(() => {
    setRuntimeProfileWindowBaseline({
      key: runtimeProfileWindowKey,
      shareCounters: currentTuningShareCounters,
      sampleSeconds: miningUptime,
    });
  }, [runtimeProfileWindowKey]);

  useEffect(() => {
    if (!hasTuningWindowCounterReset(
      observedEfficiencyHashrate ? miningUptime : null,
      effectiveRuntimeProfileWindowBaseline.sampleSeconds,
    )) {
      return;
    }
    setRuntimeProfileWindowBaseline({
      key: runtimeProfileWindowKey,
      shareCounters: currentTuningShareCounters,
      sampleSeconds: miningUptime,
    });
  }, [currentTuningShareCounters, effectiveRuntimeProfileWindowBaseline.sampleSeconds, miningUptime, observedEfficiencyHashrate, runtimeProfileWindowKey]);

  const runtimeAlgorithmDiagnostic = useMemo(() => createMiningAlgorithmDiagnosticSnapshot({
    config,
    telemetry: null,
    tuningObservations: tuningEvidence,
    tuningHistory: tuningReplicationHistory,
    externalHashHistory: [],
    externalOperatingEvidenceSamples: [],
    goal: optimizationGoalForPreset(config.performance_preset),
    availableCpuThreads: systemInfo.available_parallelism,
    recommendedCpuThreads: systemInfo.recommended_cpu_threads,
    hardwareGpuAvailable: hasHardwareGpuDevice(gpuDevices),
    observedHashrate: observedEfficiencyHashrate,
    observedComputeMode: observedEfficiencyHashrate ? config.compute_mode : null,
    observedCpuThreads,
    observedGpuIntensityPercent,
    observedSampleSeconds: runtimeDiagnosticElapsedSeconds,
    acceptedShares: runtimeDiagnosticShareCounters.acceptedShares,
    rejectedShares: runtimeDiagnosticShareCounters.rejectedShares,
    staleSharesDropped: runtimeDiagnosticShareCounters.staleSharesDropped,
    queuedSharesDropped: runtimeDiagnosticShareCounters.queuedSharesDropped,
    gpuDispatchMs: realModeEnabled ? realStats.gpu_dispatch_ms : 0,
    gpuThrottleMs: realModeEnabled ? realStats.gpu_throttle_ms : 0,
    benchmarkHashrate: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.hashrate : null,
    benchmarkGpuIntensityPercent: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.gpu_intensity_percent : null,
    currentComputeMode: config.compute_mode,
    currentCpuThreads: effectiveCpuThreads,
    currentGpuIntensityPercent,
  }), [
    benchmarkResult,
    config,
    effectiveCpuThreads,
    effectiveGpuIntensityPercent,
    gpuDevices,
    observedEfficiencyHashrate,
    runtimeDiagnosticElapsedSeconds,
    runtimeDiagnosticShareCounters,
    realModeEnabled,
    realStats.gpu_dispatch_ms,
    realStats.gpu_throttle_ms,
    systemInfo.available_parallelism,
    systemInfo.recommended_cpu_threads,
    tuningEvidence,
    tuningReplicationHistory,
  ]);

  const runtimeExistingTuningObservation = runtimeActiveTuningStep
    ? tuningEvidence.find((observation) => observation.stepId === runtimeActiveTuningStep.id) ?? null
    : null;
  const runtimeObjectiveCapturePolicy = runtimeAlgorithmDiagnostic.objectiveExperiment.capturePolicy.mode === "local_sample" &&
    runtimeAlgorithmDiagnostic.objectiveExperiment.capturePolicy.enabled
    ? runtimeAlgorithmDiagnostic.objectiveExperiment.capturePolicy
    : null;
  const runtimeAutoElapsedSeconds = useMemo(() => (
    calculateTuningWindowElapsedSeconds(observedEfficiencyHashrate ? miningUptime : null, tuningAutoSampleBaselineSeconds)
  ), [miningUptime, observedEfficiencyHashrate, tuningAutoSampleBaselineSeconds]);
  const runtimeAutoSampleGate = useMemo(() => evaluateTuningAutoSampleGate({
    enabled: Boolean(runtimeObjectiveCapturePolicy),
    activeStep: runtimeActiveTuningStep,
    observedHashrate: observedEfficiencyHashrate,
    elapsedSeconds: runtimeAutoElapsedSeconds,
    existingObservation: runtimeExistingTuningObservation,
    requiredStepId: runtimeObjectiveCapturePolicy?.requiredStepId ?? null,
    hasMeasuredPower: false,
    requireMeasuredPower: runtimeObjectiveCapturePolicy?.requireMeasuredPower ?? false,
    minCaptureSeconds: runtimeObjectiveCapturePolicy?.minCaptureSeconds ?? runtimeActiveTuningStep?.sampleSeconds,
    refreshSeconds: runtimeObjectiveCapturePolicy?.refreshSeconds ?? runtimeObjectiveCapturePolicy?.minCaptureSeconds ?? runtimeActiveTuningStep?.sampleSeconds,
  }), [
    observedEfficiencyHashrate,
    runtimeAutoElapsedSeconds,
    runtimeActiveTuningStep,
    runtimeExistingTuningObservation,
    runtimeObjectiveCapturePolicy,
  ]);

  useEffect(() => {
    tuningAutoShareBaselineRef.current = currentTuningShareCounters;
    tuningAutoSampleBaselineSecondsRef.current = miningUptime;
    setTuningAutoSampleBaselineSeconds(miningUptime);
    tuningAutoLastCaptureKeyRef.current = null;
  }, [isMining, realModeEnabled, runtimeActiveTuningStep?.id]);

  useEffect(() => {
    if (!hasTuningWindowCounterReset(observedEfficiencyHashrate ? miningUptime : null, tuningAutoSampleBaselineSecondsRef.current)) {
      return;
    }
    tuningAutoShareBaselineRef.current = currentTuningShareCounters;
    tuningAutoSampleBaselineSecondsRef.current = miningUptime;
    setTuningAutoSampleBaselineSeconds(miningUptime);
    tuningAutoLastCaptureKeyRef.current = null;
  }, [currentTuningShareCounters, miningUptime, observedEfficiencyHashrate]);

  useEffect(() => {
    const captureElapsedSeconds = calculateTuningWindowElapsedSeconds(
      observedEfficiencyHashrate ? miningUptime : null,
      tuningAutoSampleBaselineSecondsRef.current,
    );
    const captureGate = evaluateTuningAutoSampleGate({
      enabled: Boolean(runtimeObjectiveCapturePolicy),
      activeStep: runtimeActiveTuningStep,
      observedHashrate: observedEfficiencyHashrate,
      elapsedSeconds: captureElapsedSeconds,
      existingObservation: runtimeExistingTuningObservation,
      requiredStepId: runtimeObjectiveCapturePolicy?.requiredStepId ?? null,
      hasMeasuredPower: false,
      requireMeasuredPower: runtimeObjectiveCapturePolicy?.requireMeasuredPower ?? false,
      minCaptureSeconds: runtimeObjectiveCapturePolicy?.minCaptureSeconds ?? runtimeActiveTuningStep?.sampleSeconds,
      refreshSeconds: runtimeObjectiveCapturePolicy?.refreshSeconds ?? runtimeObjectiveCapturePolicy?.minCaptureSeconds ?? runtimeActiveTuningStep?.sampleSeconds,
    });
    const captureDecision = createTuningAutoSampleCapture({
      gate: captureGate,
      activeStep: runtimeActiveTuningStep,
      observedHashrate: observedEfficiencyHashrate,
      elapsedSeconds: captureElapsedSeconds,
      currentShareCounters: currentTuningShareCounters,
      baselineShareCounters: tuningAutoShareBaselineRef.current,
      gpuDispatchMs: realModeEnabled ? realStats.gpu_dispatch_ms : 0,
      gpuThrottleMs: realModeEnabled ? realStats.gpu_throttle_ms : 0,
      requireMeasuredPower: runtimeObjectiveCapturePolicy?.requireMeasuredPower ?? false,
      lastCaptureKey: tuningAutoLastCaptureKeyRef.current,
    });
    if (!captureDecision.observation || !captureDecision.captureKey) {
      return;
    }

    tuningAutoLastCaptureKeyRef.current = captureDecision.captureKey;
    captureTuningObservation(captureDecision.observation);
    tuningAutoShareBaselineRef.current = captureDecision.nextShareBaseline ?? currentTuningShareCounters;
  }, [
    captureTuningObservation,
    currentTuningShareCounters,
    observedEfficiencyHashrate,
    runtimeAutoElapsedSeconds,
    realModeEnabled,
    realStats.gpu_dispatch_ms,
    realStats.gpu_throttle_ms,
    runtimeActiveTuningStep,
    runtimeExistingTuningObservation,
    runtimeObjectiveCapturePolicy,
  ]);

  const modeLabel = realModeEnabled
    ? config.compute_mode === "gpu"
      ? "GPU"
      : config.compute_mode === "hybrid"
        ? (effectiveCpuThreads > 0 ? "CPU + GPU" : "GPU")
        : "CPU"
    : "Simulation";

  const gpuConfigMetrics: [string, string][] =
    config.compute_mode !== "cpu" ? [["GPU LIMIT", `${effectiveGpuIntensityPercent}%`]] : [];
  const gpuRuntimeMetrics: [string, string][] = realModeEnabled && gpuEnabled
    ? [
        ["GPU BACKEND", realStats.gpu_backend || "Starting"],
        ["GPU DEVICE", realStats.gpu_device_name || "Detecting"],
        [
          "GPU DISPATCH",
          realStats.gpu_dispatch_size
            ? `${formatDispatchSize(realStats.gpu_dispatch_size)} / ${realStats.gpu_dispatch_ms}ms`
            : "Waiting",
        ],
        ["GPU THROTTLE", realStats.gpu_throttle_ms ? `${realStats.gpu_throttle_ms}ms` : "Off"],
      ]
    : [];

  const resourceMetrics: [string, string][] = [
    ["MODE SELECT", miningModeLabel(selectedMiningMode)],
    ["ENGINE", miningEngineStatus.kind.toUpperCase()],
    ["PET", petCompanion.name],
    ["MOOD", petCompanion.moodLabel],
    ["PET STATE", miningEngineStatus.label],
    ["BOND", `${petCompanion.care.bond.value}%`],
    ["EVENT", miningEventLabel(lastMiningEvent)],
    ["PET LOGS", `${petLogs.length}`],
    ["DEV LOGS", `${devLogs.length}`],
    ["PRESET", performancePresetLabel(config.performance_preset)],
    ["CPU THREADS", `${effectiveCpuThreads}`],
    ["RECOMMENDED", `${systemInfo.recommended_cpu_threads}`],
    ["ALGO CORE", compactRouteAlgorithm(runtimeAlgorithmDiagnostic.objectiveAudit.currentAlgorithm)],
    ["ALGO STAGE", compactObjectiveAuditStage(runtimeAlgorithmDiagnostic.objectiveAudit.stage)],
    ["ALGO CLAIM", compactObjectiveAuditClaims(runtimeAlgorithmDiagnostic.objectiveAudit)],
    ["ALGO NEED", compactObjectiveAuditEvidence(runtimeAlgorithmDiagnostic.objectiveAudit.requiredEvidenceIds)],
    ["OBJECTIVE", compactObjectiveStatus(runtimeAlgorithmDiagnostic.objectiveCertificate)],
    ["OBJ SCORE", compactObjectiveScore(runtimeAlgorithmDiagnostic.objectiveCertificate)],
    ["OBJ GAP", compactObjectiveGap(runtimeAlgorithmDiagnostic.objectiveCertificate.primaryEvidenceGap)],
    ["POWER LANE", compactPowerLane(runtimeAlgorithmDiagnostic.objectiveCertificate)],
    ["HASH PATH", compactHighHashPath(runtimeAlgorithmDiagnostic.objectiveCertificate.highHashPath)],
    ["OBJ ACTION", compactObjectiveAction(runtimeAlgorithmDiagnostic.objectiveActionPlan.action)],
    ["AUTO SAMPLE", runtimeAutoSampleGate.status.replace(/_/g, " ").toUpperCase()],
    ["LOW CLAIM", compactClaimStatus(runtimeAlgorithmDiagnostic.claimCertificate.lowestPower)],
    ["HASH CLAIM", compactClaimStatus(runtimeAlgorithmDiagnostic.claimCertificate.highestHash)],
    ["CLAIM NEXT", compactClaimNextAction(runtimeAlgorithmDiagnostic.claimCertificate.nextAction)],
    ["MODE", modeLabel],
    ...gpuConfigMetrics,
    ...gpuRuntimeMetrics,
  ];
  const metrics: [string, string][] = [
    ["HASHRATE", displayedHashrate],
    ["BEST DIFF", formatDifficulty(realModeEnabled ? realStats.best_difficulty : simulationStats.bestDifficulty)],
    ["LUCK", `${probabilitySnapshot.luckMeter}%`],
    ["STREAK", `${probabilitySnapshot.streakCounter}`],
    ["NET DIFF", currentDifficultyValue],
    ["ETA BLOCK", formatProbabilityTime(probabilitySnapshot.estimatedTimeToBlockSeconds)],
    ["POOL DIFF", shareDifficultyValue],
    ["SHARES/H", shareRateValue],
    ["BLOCK HEIGHT", blockHeight],
    ["SHARES A / R", sharesValue],
    ["STALE DROPS", staleDropsValue],
    ["QUEUE DROPS", queueDropsValue],
    ["APP UPTIME", formatUptime(appUptime)],
    ["MINING UPTIME", formatUptime(miningUptime)],
  ];

  return (
    <main className={`pet-shell ${displayMode} pet-profile-${activePetProfile.id} ${petState === "LUCKY_EVENT" ? "lucky" : ""} jackpot-${jackpotSequence.phase}`}>
      <Header
        realModeEnabled={realModeEnabled}
        computeMode={config.compute_mode}
        displayMode={displayMode}
        setDisplayMode={setDisplayMode}
        isMining={isMining}
        openModeSelection={openModeSelection}
        alwaysOnTop={alwaysOnTop}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
      />

      <section className="status-row">
        <PetDisplay
          petProfile={activePetProfile}
          companion={petCompanion}
          petStatus={petStatus}
          isMiningAnimation={isMiningAnimation}
          displayMode={displayMode}
          compactComputeMode={compactComputeMode}
          displayedHashrate={displayedHashrate}
          realModeEnabled={realModeEnabled}
          realStats={realStats}
          simulationStats={simulationStats}
          blockHeight={blockHeight}
          formatDifficulty={formatDifficulty}
        />

        <div className="status-copy">
          <p className="label">STATUS</p>
          <p className={`status ${statusClassName}`} title={petStatus}>
            {displayStatus}
          </p>
        </div>
        <div className="luck-meter" title="Display-only luck meter">
          <span>LUCK</span>
          <b>{probabilitySnapshot.luckMeter}%</b>
          <div>
            <i style={{ width: `${probabilitySnapshot.luckMeter}%` }} />
          </div>
        </div>
        <button
          className={isMining ? "control-button stop" : "control-button start"}
          disabled={!selectedMiningMode}
          onClick={isMining ? miningEngine.stop : miningEngine.start}
          type="button"
        >
          {isMining ? "STOP" : "START"}
        </button>
      </section>

      <MetricsGrid
        displayMode={displayMode}
        realModeEnabled={realModeEnabled}
        metrics={metrics}
        resourceMetrics={resourceMetrics}
        poolStatus={poolStatus}
        authStatus={authStatus}
        jobStatus={jobStatus}
        lastShare={lastShare}
      />

      <LogTicker
        displayMode={displayMode}
        latestLog={latestLog}
        openLogs={openLogs}
        copyLogPath={copyLogPath}
        copyDiagnostics={copyDiagnostics}
        saveDiagnostics={saveDiagnostics}
      />

      <footer>
        <span className={`dot ${realModeEnabled ? "armed" : ""}`} />
        {miningModeLabel(selectedMiningMode)} Â· {realModeEnabled
          ? config.compute_mode === "gpu"
            ? "GPU real mining"
            : config.compute_mode === "hybrid"
              ? (effectiveCpuThreads > 0 ? "CPU + GPU real mining" : "GPU real mining")
              : "CPU real mining"
          : "Simulation"}
        <button
          className="settings-button"
          disabled={isMining}
          onClick={() => setShowSettings(true)}
          type="button"
        >
          SETTINGS
        </button>
        <span className="cpu">{effectiveCpuThreads} thread{effectiveCpuThreads === 1 ? "" : "s"}</span>
      </footer>

      {errorMessage && (
        <p className="error-banner" onClick={() => setErrorMessage(null)} title="Click to dismiss">
          {errorMessage}
        </p>
      )}

      {showModeSelection && (
        <section className="overlay mode-selection-overlay" role="dialog" aria-modal="true" aria-label="Choose mining mode">
          <div className="warning-card mode-selection-card">
            <p className="eyebrow">ARCADE BOOT</p>
            <h2>Choose your run</h2>
            <div className="mode-selection-grid">
              {miningModeOptions.map((option) => (
                <button
                  className={`mode-choice mode-choice-${option.mode}`}
                  key={option.mode}
                  onClick={() => selectMiningMode(option.mode)}
                  type="button"
                >
                  <span>{option.title}</span>
                  <b>{option.label}</b>
                  <small>{option.description}</small>
                  <em>
                    {option.realModeEnabled
                      ? option.computeMode === "gpu"
                        ? "GPU pressure"
                        : "real pool"
                      : "safe simulation"}
                  </em>
                </button>
              ))}
            </div>
            {selectedMiningMode && (
              <div className="panel-actions mode-selection-actions">
                <button className="secondary-button" onClick={() => setShowModeSelection(false)} type="button">
                  KEEP CURRENT
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {showCpuWarning && (
        <section className="overlay" role="dialog" aria-modal="true" aria-label="High CPU warning">
          <div className="warning-card">
            <p className="eyebrow">CPU WARNING</p>
            <h2>High CPU usage</h2>
            <p>
              High CPU usage may heat your computer. Are you sure you want to continue?
            </p>
            <div className="panel-actions">
              <button className="secondary-button" onClick={() => setShowCpuWarning(false)} type="button">
                CANCEL
              </button>
              <button
                className="confirm-button"
                onClick={() => void confirmCpuWarning()}
                type="button"
              >
                CONTINUE
              </button>
            </div>
          </div>
        </section>
      )}

      {showSettings && (
        <SettingsPanel
          draftConfig={draftConfig}
          setDraftConfig={setDraftConfig}
          setShowSettings={setShowSettings}
          saveSettings={saveSettings}
          runGpuBenchmark={runGpuBenchmark}
          runPoolDiagnostic={runPoolDiagnostic}
          benchmarkResult={benchmarkResult}
          observedHashrate={observedEfficiencyHashrate}
          observedSampleSeconds={observedEfficiencyHashrate ? miningUptime : null}
          observedComputeMode={observedEfficiencyHashrate ? config.compute_mode : null}
          observedCpuThreads={observedCpuThreads}
          observedGpuIntensityPercent={observedGpuIntensityPercent}
          acceptedShares={acceptedShares}
          rejectedShares={rejectedShares}
          staleSharesDropped={realModeEnabled ? realStats.stale_shares_dropped : 0}
          queuedSharesDropped={realModeEnabled ? realStats.queued_shares_dropped : 0}
          gpuDispatchMs={realModeEnabled ? realStats.gpu_dispatch_ms : 0}
          gpuThrottleMs={realModeEnabled ? realStats.gpu_throttle_ms : 0}
          poolDiagnosticResult={poolDiagnosticResult}
          tuningEvidence={tuningEvidence}
          tuningReplicationHistory={tuningReplicationHistory}
          captureTuningObservation={captureTuningObservation}
          clearTuningEvidence={clearTuningEvidence}
          gpuDevices={gpuDevices}
          systemInfo={systemInfo}
          formatHashrate={formatHashrate}
          sanitizeGpuDeviceId={sanitizeGpuDeviceId}
          presetPort={presetPort}
          threadsForPreset={threadsForPreset}
          isGpuComputeMode={isGpuComputeMode}
          hasHardwareGpuDevice={hasHardwareGpuDevice}
          hasSoftwareGpuDevice={hasSoftwareGpuDevice}
          hardwareReady={hardwareReady}
        />
      )}

      {jackpotVisible && jackpotBlock && (
        <section className="overlay jackpot-overlay" role="dialog" aria-modal="true" aria-label="Block candidate found">
          <div className="jackpot-particles" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className="warning-card jackpot-card">
            <p className="eyebrow">{jackpotPhaseLabel(jackpotSequence.phase)}</p>
            <h2>JACKPOT</h2>
            <p>
              Network target met. The candidate was saved to a timestamped found_block_*.json file in the app log folder.
            </p>
            <dl>
              <div>
                <dt>Job</dt>
                <dd>{jackpotBlock.job_id}</dd>
              </div>
              <div>
                <dt>Nonce</dt>
                <dd>{jackpotBlock.nonce}</dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd>{jackpotBlock.pool}</dd>
              </div>
              <div>
                <dt>Difficulty</dt>
                <dd>{formatDifficulty(jackpotBlock.difficulty)}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd title={jackpotBlock.timestamp}>{jackpotBlock.timestamp}</dd>
              </div>
              <div>
                <dt>Hash</dt>
                <dd title={jackpotBlock.hash}>{jackpotBlock.hash}</dd>
              </div>
            </dl>
            <div className="panel-actions">
              <button className="secondary-button" onClick={() => void openLogs()} type="button">
                OPEN LOGS
              </button>
              <button className="confirm-button" onClick={dismissJackpotSequence} type="button">
                DISMISS
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;

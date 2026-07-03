import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  ComputeMode,
  GpuBenchmarkResult,
  GpuDevice,
  HeartbeatInterval,
  NotificationChannel,
  PerformancePreset,
  PoolDiagnosticReport,
  SystemInfo,
} from "../miningLogic";
import { builtinPetProfiles, getPetProfile } from "../pets/profiles";
import { efficiencyGoalLabel, formatJoulesPerTerahash } from "../domain/efficiencyEngine";
import type { EfficiencyGoal } from "../domain/efficiencyEngine";
import {
  analyzeTuningObservations,
  createTuningSweepPlan,
  diffTuningShareCounters,
  deriveTuningApplyOption,
  findTuningSweepStepForRuntime,
  upsertTuningObservation,
} from "../domain/efficiencyTuning";
import type { TuningApplyOption, TuningObservation, TuningShareCounters } from "../domain/efficiencyTuning";
import { calculateTuningWindowElapsedSeconds, evaluateTuningAutoSampleGate, hasTuningWindowCounterReset } from "../domain/tuningAutoSampler";
import { summarizeExternalHashHistory } from "../domain/externalHashHistory";
import {
  deriveExternalHashCapabilityMatrix,
  deriveExternalHashSnapshot,
} from "../domain/externalHashInterface";
import { deriveMiningAlgorithmPlan } from "../domain/algorithmPlanner";
import { deriveHashBatchOptimization } from "../domain/hashBatchOptimizer";
import { deriveAlgorithmTuningDirective } from "../domain/algorithmTuningDirective";
import { deriveAlgorithmExperimentAdvisor } from "../domain/algorithmExperimentAdvisor";
import { deriveAlgorithmExperimentConfidence } from "../domain/algorithmExperimentConfidence";
import { deriveAlgorithmObjectiveActionPlan } from "../domain/algorithmObjectiveActionPlan";
import { deriveAlgorithmObjectiveCertificate } from "../domain/algorithmObjectiveCertificate";
import { deriveAlgorithmObjectiveExperimentPlan } from "../domain/algorithmObjectiveExperiment";
import { deriveAlgorithmObjectiveFeedback } from "../domain/algorithmObjectiveFeedback";
import { deriveAlgorithmRuntimeRecommendation } from "../domain/algorithmRuntimeRecommendation";
import { deriveAlgorithmPowerHashEnvelope } from "../domain/algorithmPowerHashEnvelope";
import { deriveAlgorithmRouteCertificate } from "../domain/algorithmRouteCertificate";
import { deriveAlgorithmRunWindowPlan } from "../domain/algorithmRunWindowPlan";
import { deriveAlgorithmRunEvidenceReview } from "../domain/algorithmRunEvidenceReview";
import { deriveAlgorithmProfileApplyGate } from "../domain/algorithmProfileApplyGate";
import { createHashClaimCertificate } from "../domain/hashClaimCertificate";
import { deriveHashRuntimeEfficiencySnapshot } from "../domain/hashRuntimeEfficiency";
import { deriveHashOperatingPolicy } from "../domain/hashOperatingPolicy";
import { deriveExternalHashWorkAdapterPlan } from "../engines/externalHashWorkAdapter";

interface SettingsPanelProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setShowSettings: (show: boolean) => void;
  saveSettings: () => Promise<void>;
  runGpuBenchmark: () => Promise<void>;
  runPoolDiagnostic: () => Promise<void>;
  benchmarkResult: GpuBenchmarkResult | null;
  observedHashrate: number | null;
  observedSampleSeconds: number | null;
  observedComputeMode: ComputeMode | null;
  observedCpuThreads: number | null;
  observedGpuIntensityPercent: number | null;
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
  gpuDispatchMs: number;
  gpuThrottleMs: number;
  poolDiagnosticResult: PoolDiagnosticReport | null;
  tuningEvidence: TuningObservation[];
  tuningReplicationHistory: TuningObservation[];
  captureTuningObservation: (observation: TuningObservation) => void;
  clearTuningEvidence: () => void;
  gpuDevices: GpuDevice[];
  systemInfo: SystemInfo;
  formatHashrate: (hashrate: number) => string;
  sanitizeGpuDeviceId: (deviceId: string | null, devices: GpuDevice[]) => string | null;
  presetPort: (poolHost: string, currentPort: number) => number;
  threadsForPreset: (
    preset: PerformancePreset,
    systemInfo: SystemInfo,
    customThreads: number,
    gpuOnly?: boolean,
  ) => number;
  isGpuComputeMode: (mode: ComputeMode) => boolean;
  hasHardwareGpuDevice: (devices: GpuDevice[]) => boolean;
  hasSoftwareGpuDevice: (devices: GpuDevice[]) => boolean;
  hardwareReady: boolean;
}

type PetOptionStyle = CSSProperties & { [key: `--${string}`]: string };

const settingsSections = [
  { id: "settings-pet", label: "Pet" },
  { id: "settings-device", label: "Device" },
  { id: "settings-connection", label: "Pool" },
  { id: "settings-algorithm", label: "Algo" },
  { id: "settings-experimental", label: "Labs" },
  { id: "settings-diagnostics", label: "Tools" },
] as const;

function petOptionStyle(primary: string, secondary: string): PetOptionStyle {
  return {
    "--pet-option-primary": primary,
    "--pet-option-secondary": secondary,
    "--pet-option-glow": primary,
  } as PetOptionStyle;
}

function formatWatts(watts: number | null | undefined) {
  if (typeof watts !== "number" || !Number.isFinite(watts) || watts <= 0) {
    return "Waiting";
  }
  return `${watts >= 100 ? watts.toFixed(0) : watts.toFixed(1)} W`;
}

function formatRuntimePercent(value: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 100)) + "%" : "Waiting";
}

function positiveMetric(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function formatSignedPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "Waiting";
  }
  return `${value > 0 ? "+" : ""}${value}%`;
}

function formatDurationSeconds(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return "Waiting";
  }
  if (seconds === 0) {
    return "0s";
  }
  if (seconds >= 60 && seconds % 60 === 0) {
    return `${Math.trunc(seconds / 60)}m`;
  }
  return `${Math.round(seconds)}s`;
}

function positiveInput(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : null;
}

function nonNegativeInput(value: string) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : null;
}

function shortStatus(value: string) {
  return value.replace(/_/g, " ");
}

function objectiveGapLabel(value: string) {
  switch (value) {
    case "none":
      return "clear";
    case "low_power_evidence":
      return "low power evidence";
    case "high_hash_measurement":
      return "hash measurement";
    case "max_hash_marginal_hold":
      return "marginal hold";
    case "kernel_regression":
      return "kernel regression";
    case "high_hash_cooldown":
      return "hash cooldown";
    case "runtime_guard":
      return "runtime guard";
    case "external_dry_run":
      return "external dry run";
    default:
      return shortStatus(value);
  }
}

function claimHashrateValueText(value: number | null | undefined, formatHashrate: (hashrate: number) => string) {
  return positiveMetric(value) ? formatHashrate(Number(value)) : "waiting";
}

function claimHashrateText(
  claim: { rawHashrate: number | null; effectiveHashrate: number | null; hashrateBasis: string },
  formatHashrate: (hashrate: number) => string,
) {
  if (claim.hashrateBasis === "effective" && positiveMetric(claim.effectiveHashrate)) {
    return `EFFECTIVE ${formatHashrate(Number(claim.effectiveHashrate))}`;
  }
  if (positiveMetric(claim.rawHashrate)) {
    return `RAW ${formatHashrate(Number(claim.rawHashrate))}`;
  }
  return "HASH waiting";
}

function tuningGoalForPreset(preset: PerformancePreset): EfficiencyGoal {
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

export default function SettingsPanel({
  draftConfig,
  setDraftConfig,
  setShowSettings,
  saveSettings,
  runGpuBenchmark,
  runPoolDiagnostic,
  benchmarkResult,
  observedHashrate,
  observedSampleSeconds,
  observedComputeMode,
  observedCpuThreads,
  observedGpuIntensityPercent,
  acceptedShares,
  rejectedShares,
  staleSharesDropped,
  queuedSharesDropped,
  gpuDispatchMs,
  gpuThrottleMs,
  poolDiagnosticResult,
  tuningEvidence,
  tuningReplicationHistory,
  captureTuningObservation,
  clearTuningEvidence,
  gpuDevices,
  systemInfo,
  formatHashrate,
  sanitizeGpuDeviceId,
  presetPort,
  threadsForPreset,
  isGpuComputeMode,
  hasHardwareGpuDevice,
  hasSoftwareGpuDevice,
  hardwareReady,
}: SettingsPanelProps) {
  const isDraftGpuOnly = draftConfig.compute_mode === "gpu";
  const hardwareGpuAvailable = hasHardwareGpuDevice(gpuDevices);
  const softwareGpuAvailable = hasSoftwareGpuDevice(gpuDevices);
  const selectedPetProfile = getPetProfile(draftConfig.pet_profile_id);
  const externalHashHistorySummary = useMemo(() => summarizeExternalHashHistory([]), []);
  const [manualMeasuredWatts, setManualMeasuredWatts] = useState("");
  const currentShareCounters = useMemo<TuningShareCounters>(() => ({
    acceptedShares,
    rejectedShares,
    staleSharesDropped,
    queuedSharesDropped,
  }), [acceptedShares, queuedSharesDropped, rejectedShares, staleSharesDropped]);
  const [shareCounterBaseline, setShareCounterBaseline] = useState<TuningShareCounters>(currentShareCounters);
  const [runtimeShareCounterBaseline, setRuntimeShareCounterBaseline] = useState<TuningShareCounters>(currentShareCounters);
  const [runtimeSampleBaselineSeconds, setRuntimeSampleBaselineSeconds] = useState<number | null>(observedSampleSeconds);
  const runtimeShareCounters = useMemo(() => (
    diffTuningShareCounters(currentShareCounters, runtimeShareCounterBaseline)
  ), [currentShareCounters, runtimeShareCounterBaseline]);
  const runtimeWindowSampleSeconds = useMemo(() => (
    calculateTuningWindowElapsedSeconds(observedSampleSeconds, runtimeSampleBaselineSeconds)
  ), [observedSampleSeconds, runtimeSampleBaselineSeconds]);
  const runtimeEfficiencySnapshot = useMemo(() => deriveHashRuntimeEfficiencySnapshot({
    hashrate: observedHashrate,
    acceptedShares: runtimeShareCounters.acceptedShares,
    rejectedShares: runtimeShareCounters.rejectedShares,
    staleSharesDropped: runtimeShareCounters.staleSharesDropped,
    queuedSharesDropped: runtimeShareCounters.queuedSharesDropped,
    gpuDispatchMs,
    gpuThrottleMs,
    sampleSeconds: runtimeWindowSampleSeconds,
  }), [
    gpuDispatchMs,
    gpuThrottleMs,
    observedHashrate,
    runtimeShareCounters,
    runtimeWindowSampleSeconds,
  ]);
  const draftEffectiveCpuThreads = threadsForPreset(
    draftConfig.performance_preset,
    systemInfo,
    Number(draftConfig.cpu_threads),
    isDraftGpuOnly,
  );
  const cpuThreadOptions = useMemo(() => {
    const available = Math.max(1, systemInfo.available_parallelism);
    const rec = systemInfo.recommended_cpu_threads;
    const base = isDraftGpuOnly ? [0] : [1, 2, rec, draftEffectiveCpuThreads, 4, available];
    return Array.from(new Set(base))
      .filter((threads) => threads <= available && (isDraftGpuOnly ? threads === 0 : threads >= 1))
      .sort((left, right) => left - right);
  }, [draftEffectiveCpuThreads, isDraftGpuOnly, systemInfo.available_parallelism, systemInfo.recommended_cpu_threads]);

  const externalHashSnapshot = useMemo(() => (
    deriveExternalHashSnapshot(draftConfig, null)
  ), [
    draftConfig.external_hash_direct_port,
    draftConfig.external_hash_direct_endpoint,
    draftConfig.external_hash_interface,
    draftConfig.external_hash_network_host,
    draftConfig.external_hash_poll_interval_seconds,
    draftConfig.external_hash_polling_enabled,
  ]);
  const externalHashCapabilityMatrix = useMemo(() => (
    deriveExternalHashCapabilityMatrix(externalHashSnapshot)
  ), [externalHashSnapshot]);
  const externalHashWorkAdapterPlan = useMemo(() => (
    deriveExternalHashWorkAdapterPlan(externalHashSnapshot, externalHashCapabilityMatrix)
  ), [externalHashCapabilityMatrix, externalHashSnapshot]);
  const tuningGoal = tuningGoalForPreset(draftConfig.performance_preset);
  const tuningSweepPlan = useMemo(() => createTuningSweepPlan({
    goal: tuningGoal,
    availableCpuThreads: systemInfo.available_parallelism,
    recommendedCpuThreads: systemInfo.recommended_cpu_threads,
    hardwareGpuAvailable,
    observedHashrate,
    observedComputeMode,
    observedCpuThreads,
    observedGpuIntensityPercent,
    benchmarkHashrate: benchmarkResult && !benchmarkResult.simulated ? benchmarkResult.hashrate : null,
    benchmarkGpuIntensityPercent: benchmarkResult && !benchmarkResult.simulated
      ? benchmarkResult.gpu_intensity_percent
      : null,
    currentComputeMode: draftConfig.compute_mode,
    currentCpuThreads: draftEffectiveCpuThreads,
    currentGpuIntensityPercent: draftConfig.compute_mode === "cpu" ? 0 : draftConfig.gpu_intensity_percent,
    maxSteps: 3,
    sampleSeconds: 60,
  }), [
    benchmarkResult?.gpu_intensity_percent,
    benchmarkResult?.hashrate,
    benchmarkResult?.simulated,
    draftConfig.compute_mode,
    draftConfig.gpu_intensity_percent,
    draftEffectiveCpuThreads,
    hardwareGpuAvailable,
    observedComputeMode,
    observedCpuThreads,
    observedGpuIntensityPercent,
    observedHashrate,
    systemInfo.available_parallelism,
    systemInfo.recommended_cpu_threads,
    tuningGoal,
  ]);
  const activeTuningStep = useMemo(() => (
    findTuningSweepStepForRuntime(tuningSweepPlan, {
      computeMode: observedComputeMode,
      cpuThreads: observedCpuThreads,
      gpuIntensityPercent: observedGpuIntensityPercent,
    }) ?? tuningSweepPlan.steps[0] ?? null
  ), [observedComputeMode, observedCpuThreads, observedGpuIntensityPercent, tuningSweepPlan]);
  const runtimeWindowActive = Boolean(observedHashrate);

  useEffect(() => {
    setManualMeasuredWatts("");
    setShareCounterBaseline(currentShareCounters);
    setRuntimeShareCounterBaseline(currentShareCounters);
    setRuntimeSampleBaselineSeconds(observedSampleSeconds);
  }, [activeTuningStep?.id, runtimeWindowActive]);

  useEffect(() => {
    if (!hasTuningWindowCounterReset(observedSampleSeconds, runtimeSampleBaselineSeconds)) {
      return;
    }
    setShareCounterBaseline(currentShareCounters);
    setRuntimeShareCounterBaseline(currentShareCounters);
    setRuntimeSampleBaselineSeconds(observedSampleSeconds);
  }, [currentShareCounters, observedSampleSeconds, runtimeSampleBaselineSeconds]);

  const liveTuningObservation = useMemo<TuningObservation | null>(() => {
    if (!activeTuningStep || !observedHashrate || !Number.isFinite(observedHashrate) || observedHashrate <= 0) {
      return null;
    }
    return {
      stepId: activeTuningStep.id,
      hashrate: observedHashrate,
      watts: activeTuningStep.estimatedWatts,
      powerEvidenceStatus: "estimated",
      acceptedShares: runtimeShareCounters.acceptedShares,
      rejectedShares: runtimeShareCounters.rejectedShares,
      staleSharesDropped: runtimeShareCounters.staleSharesDropped,
      queuedSharesDropped: runtimeShareCounters.queuedSharesDropped,
      gpuDispatchMs,
      gpuThrottleMs,
      sampleSeconds: Math.max(1, Math.trunc(runtimeWindowSampleSeconds ?? activeTuningStep.sampleSeconds)),
    };
  }, [
    activeTuningStep,
    gpuDispatchMs,
    gpuThrottleMs,
    observedHashrate,
    runtimeShareCounters,
    runtimeWindowSampleSeconds,
  ]);
  const tuningObservations = useMemo<TuningObservation[]>(() => {
    if (!liveTuningObservation) {
      return tuningEvidence;
    }
    if (tuningEvidence.some((observation) => observation.stepId === liveTuningObservation.stepId)) {
      return tuningEvidence;
    }
    return upsertTuningObservation(tuningEvidence, liveTuningObservation);
  }, [liveTuningObservation, tuningEvidence]);
  const tuningAnalysis = useMemo(() => (
    analyzeTuningObservations(tuningSweepPlan, tuningObservations)
  ), [tuningObservations, tuningSweepPlan]);
  const storedTuningAnalysis = useMemo(() => (
    analyzeTuningObservations(tuningSweepPlan, tuningEvidence)
  ), [tuningEvidence, tuningSweepPlan]);
  const storedTuningSampleCount = tuningEvidence.length;
  const measuredTuningSampleCount = tuningEvidence.filter((observation) => observation.powerEvidenceStatus === "measured").length;
  const existingActiveObservation = activeTuningStep
    ? tuningEvidence.find((observation) => observation.stepId === activeTuningStep.id) ?? null
    : null;
  const measuredWattsValue = Number(manualMeasuredWatts);
  const hasManualMeasuredWatts = Number.isFinite(measuredWattsValue) && measuredWattsValue > 0;
  const algorithmPlan = useMemo(() => deriveMiningAlgorithmPlan({
    tuningAnalysis,
    externalHistory: externalHashHistorySummary,
    externalSnapshot: externalHashSnapshot,
    externalCapabilityMatrix: externalHashCapabilityMatrix,
    externalWorkAdapterPlan: externalHashWorkAdapterPlan,
    externalOperatingEvidence: null,
    externalAlgorithmMode: "local_only",
  }), [
    externalHashCapabilityMatrix,
    externalHashHistorySummary,
    externalHashSnapshot,
    externalHashWorkAdapterPlan,
    tuningAnalysis,
  ]);
  const hashOperatingPolicy = useMemo(() => (
    deriveHashOperatingPolicy(algorithmPlan, { runtimeEfficiency: runtimeEfficiencySnapshot })
  ), [algorithmPlan, runtimeEfficiencySnapshot]);
  const objectiveCertificate = useMemo(() => (
    deriveAlgorithmObjectiveCertificate(algorithmPlan, hashOperatingPolicy)
  ), [algorithmPlan, hashOperatingPolicy]);
  const algorithmTuningDirective = useMemo(() => deriveAlgorithmTuningDirective({
    samplingPlan: algorithmPlan.samplingPlan,
    tuningSweepPlan,
    tuningAnalysis,
    runtimeEfficiency: runtimeEfficiencySnapshot,
    currentStep: activeTuningStep,
  }), [activeTuningStep, algorithmPlan.samplingPlan, runtimeEfficiencySnapshot, tuningAnalysis, tuningSweepPlan]);
  const hashBatchOptimization = useMemo(() => deriveHashBatchOptimization({
    tuningSweepPlan,
    tuningAnalysis,
    currentComputeMode: observedComputeMode,
    currentCpuThreads: observedCpuThreads,
    currentGpuIntensityPercent: observedGpuIntensityPercent,
    objective: tuningGoal,
    runtimeEfficiency: runtimeEfficiencySnapshot,
  }), [observedComputeMode, observedCpuThreads, observedGpuIntensityPercent, runtimeEfficiencySnapshot, tuningAnalysis, tuningGoal, tuningSweepPlan]);
  const algorithmExperimentAdvisor = useMemo(() => (
    deriveAlgorithmExperimentAdvisor(algorithmPlan, algorithmTuningDirective)
  ), [algorithmPlan, algorithmTuningDirective]);
  const objectiveActionPlan = useMemo(() => (
    deriveAlgorithmObjectiveActionPlan(objectiveCertificate, algorithmExperimentAdvisor, algorithmTuningDirective)
  ), [algorithmExperimentAdvisor, algorithmTuningDirective, objectiveCertificate]);
  const objectiveExperiment = useMemo(() => deriveAlgorithmObjectiveExperimentPlan({
    certificate: objectiveCertificate,
    samplingPlan: algorithmPlan.samplingPlan,
    tuningDirective: algorithmTuningDirective,
    actionPlan: objectiveActionPlan,
  }), [algorithmPlan.samplingPlan, algorithmTuningDirective, objectiveActionPlan, objectiveCertificate]);
  const objectiveFeedback = useMemo(() => deriveAlgorithmObjectiveFeedback({
    experiment: objectiveExperiment,
    tuningSweepPlan,
    tuningAnalysis,
  }), [objectiveExperiment, tuningAnalysis, tuningSweepPlan]);
  const algorithmExperimentConfidence = useMemo(() => (
    deriveAlgorithmExperimentConfidence({
      advisor: algorithmExperimentAdvisor,
      tuningAnalysis,
      tuningHistory: tuningReplicationHistory,
      externalHistory: externalHashHistorySummary,
    })
  ), [algorithmExperimentAdvisor, externalHashHistorySummary, tuningAnalysis, tuningReplicationHistory]);
  const hashClaimCertificate = useMemo(() => createHashClaimCertificate({
    tuningObservations,
    tuningHistory: tuningReplicationHistory,
    externalHashHistory: [],
    externalEffectiveHashrate: null,
    preferredGoal: tuningGoal,
    externalWorkAssignable: false,
    externalMiningStartAllowed: false,
    marginalDecision: algorithmPlan.densityPlan.marginalDecision,
  }), [
    algorithmPlan.densityPlan.marginalDecision,
    tuningReplicationHistory,
    tuningGoal,
    tuningObservations,
  ]);
  const lowestPowerClaimText = hashClaimCertificate.lowestPower.claimAllowed
    ? "allowed"
    : hashClaimCertificate.lowestPower.missingEvidence.slice(0, 2).join(", ") || "waiting";
  const highestHashClaimMetricText = claimHashrateText(hashClaimCertificate.highestHash, formatHashrate);
  const highestHashClaimBasisText = shortStatus(hashClaimCertificate.highestHash.hashrateBasis);
  const highestHashClaimText = hashClaimCertificate.highestHash.claimAllowed
    ? `allowed / ${highestHashClaimMetricText}`
    : `${hashClaimCertificate.highestHash.missingEvidence.slice(0, 2).join(", ") || "waiting"} / ${highestHashClaimMetricText}`;
  const highestHashClaimTitle = `${hashClaimCertificate.highestHash.summary} ${hashClaimCertificate.highestHash.nextStep} Basis ${highestHashClaimBasisText}; effective ${claimHashrateValueText(hashClaimCertificate.highestHash.effectiveHashrate, formatHashrate)}; raw ${claimHashrateValueText(hashClaimCertificate.highestHash.rawHashrate, formatHashrate)}.`;
  const hardwareCandidateEffectiveText = algorithmPlan.hardwareCandidate.hashrate > 0
    ? formatHashrate(algorithmPlan.hardwareCandidate.effectiveHashrate)
    : "waiting";
  const hardwareCandidateLeaseText = formatRuntimePercent(algorithmPlan.hardwareCandidate.workLeaseUtilizationRatio);
  const hardwareCandidateTitle = `${algorithmPlan.hardwareCandidate.nextStep} Effective hashrate ${hardwareCandidateEffectiveText}; work lease ${hardwareCandidateLeaseText}; hash waste ${shortStatus(algorithmPlan.hardwareCandidate.hashWasteRisk)}.`;
  const objectiveGapText = objectiveGapLabel(objectiveCertificate.primaryEvidenceGap);
  const objectiveProgressTitle = `${objectiveCertificate.summary} Goal ${objectiveCertificate.objectiveProgressScore}%. Low power ${objectiveCertificate.lowPowerProgressScore}%. High hash ${objectiveCertificate.highHashProgressScore}%. Gap ${objectiveGapText}. ${objectiveCertificate.nextStep}`;
  const objectiveExperimentTitle = `${objectiveExperiment.nextStep} Evidence: ${objectiveExperiment.evidenceChecklist.slice(0, 5).join(", ")}. Stop: ${objectiveExperiment.stopConditions.slice(0, 4).join(", ")}.`;
  const objectiveFeedbackTitle = `${objectiveFeedback.nextStep} Missing: ${objectiveFeedback.missingEvidence.slice(0, 4).join(", ") || "none"}.`;
  const objectiveLocalCapturePolicy = objectiveExperiment.capturePolicy.mode === "local_sample" && objectiveExperiment.capturePolicy.enabled
    ? objectiveExperiment.capturePolicy
    : null;
  const activeTuningRequiresMeasuredPower = Boolean(objectiveLocalCapturePolicy?.requireMeasuredPower);
  const activeTuningBaseRequiredSeconds = objectiveLocalCapturePolicy?.minCaptureSeconds ?? activeTuningStep?.sampleSeconds;
  const activeBatchRequiredSeconds = hashBatchOptimization.currentStep?.id === activeTuningStep?.id
    ? hashBatchOptimization.requiredSampleSeconds
    : null;
  const activeTuningRequiredSeconds = Math.max(activeTuningBaseRequiredSeconds ?? 0, activeBatchRequiredSeconds ?? 0) || undefined;
  const activeTuningRequiredStepId = objectiveLocalCapturePolicy?.requiredStepId ?? null;
  const tuningAutoSampleGate = useMemo(() => evaluateTuningAutoSampleGate({
    enabled: Boolean(objectiveLocalCapturePolicy),
    activeStep: activeTuningStep,
    observedHashrate,
    elapsedSeconds: runtimeWindowSampleSeconds,
    existingObservation: existingActiveObservation,
    requiredStepId: activeTuningRequiredStepId,
    hasMeasuredPower: hasManualMeasuredWatts,
    requireMeasuredPower: activeTuningRequiresMeasuredPower,
    minCaptureSeconds: activeTuningRequiredSeconds,
    refreshSeconds: activeTuningRequiredSeconds,
  }), [activeTuningRequiredSeconds, activeTuningRequiredStepId, activeTuningRequiresMeasuredPower, activeTuningStep, existingActiveObservation, hasManualMeasuredWatts, objectiveLocalCapturePolicy, observedHashrate, runtimeWindowSampleSeconds]);
  const captureTuneTitle = `${tuningAutoSampleGate.summary} ${objectiveExperiment.capturePolicy.summary}`;
  const captureCurrentTuningSample = () => {
    if (!objectiveLocalCapturePolicy || !activeTuningStep || !observedHashrate || !Number.isFinite(observedHashrate) || observedHashrate <= 0) {
      return;
    }
    if (activeTuningRequiredStepId && activeTuningStep.id !== activeTuningRequiredStepId) {
      return;
    }
    if (activeTuningRequiresMeasuredPower && !hasManualMeasuredWatts) {
      return;
    }
    const shareDeltas = diffTuningShareCounters(currentShareCounters, shareCounterBaseline);
    captureTuningObservation({
      stepId: activeTuningStep.id,
      hashrate: observedHashrate,
      watts: hasManualMeasuredWatts ? measuredWattsValue : activeTuningStep.estimatedWatts,
      powerEvidenceStatus: hasManualMeasuredWatts ? "measured" : "estimated",
      acceptedShares: shareDeltas.acceptedShares,
      rejectedShares: shareDeltas.rejectedShares,
      staleSharesDropped: shareDeltas.staleSharesDropped,
      queuedSharesDropped: shareDeltas.queuedSharesDropped,
      gpuDispatchMs,
      gpuThrottleMs,
      sampleSeconds: Math.max(1, Math.trunc(runtimeWindowSampleSeconds ?? activeTuningStep.sampleSeconds)),
    });
    setShareCounterBaseline(currentShareCounters);
    setManualMeasuredWatts("");
  };
  const tuningApplyGuardInput = { runtimeEfficiency: runtimeEfficiencySnapshot, currentStep: activeTuningStep };
  const lowestPowerApplyOption = deriveTuningApplyOption(storedTuningAnalysis, "lowest_power", tuningApplyGuardInput);
  const bestEfficiencyApplyOption = deriveTuningApplyOption(storedTuningAnalysis, "best_efficiency", tuningApplyGuardInput);
  const bestHashrateApplyOption = deriveTuningApplyOption(storedTuningAnalysis, "best_hashrate", tuningApplyGuardInput);
  const profileApplyGateInput = (
    intent: Parameters<typeof deriveAlgorithmProfileApplyGate>[0]["intent"],
    baseCanApply: boolean,
    baseSummary: string,
    baseNextStep: string,
    targetStep: NonNullable<TuningApplyOption["result"]>["step"] | null,
  ) => deriveAlgorithmProfileApplyGate({
    certificate: objectiveCertificate,
    actionPlan: objectiveActionPlan,
    intent,
    baseCanApply,
    baseSummary,
    baseNextStep,
    targetStep,
    currentStep: activeTuningStep,
  });
  const objectiveTuneApplyGate = profileApplyGateInput(
    "objective_tune",
    algorithmTuningDirective.canApplyLocalProfile,
    algorithmTuningDirective.summary,
    algorithmTuningDirective.nextStep,
    algorithmTuningDirective.step,
  );
  const batchApplyGate = profileApplyGateInput(
    "batch_optimize",
    hashBatchOptimization.canApply,
    hashBatchOptimization.summary,
    hashBatchOptimization.nextStep,
    hashBatchOptimization.targetStep,
  );
  const lowestPowerApplyGate = profileApplyGateInput(
    "lowest_power",
    lowestPowerApplyOption.canApply,
    lowestPowerApplyOption.summary,
    lowestPowerApplyOption.nextStep,
    lowestPowerApplyOption.result?.step ?? null,
  );
  const bestEfficiencyApplyGate = profileApplyGateInput(
    "best_efficiency",
    bestEfficiencyApplyOption.canApply,
    bestEfficiencyApplyOption.summary,
    bestEfficiencyApplyOption.nextStep,
    bestEfficiencyApplyOption.result?.step ?? null,
  );
  const bestHashrateApplyGate = profileApplyGateInput(
    "best_hashrate",
    bestHashrateApplyOption.canApply,
    bestHashrateApplyOption.summary,
    bestHashrateApplyOption.nextStep,
    bestHashrateApplyOption.result?.step ?? null,
  );
  const profileApplyGates = useMemo(() => ({
    objective_tune: objectiveTuneApplyGate,
    batch_optimize: batchApplyGate,
    lowest_power: lowestPowerApplyGate,
    best_efficiency: bestEfficiencyApplyGate,
    best_hashrate: bestHashrateApplyGate,
  }), [batchApplyGate, bestEfficiencyApplyGate, bestHashrateApplyGate, lowestPowerApplyGate, objectiveTuneApplyGate]);
  const runtimeRecommendation = useMemo(() => deriveAlgorithmRuntimeRecommendation({
    operatingPolicy: hashOperatingPolicy,
    objectiveFeedback,
    profileApplyGates,
    runtimeSampleSeconds: runtimeWindowSampleSeconds,
  }), [hashOperatingPolicy, objectiveFeedback, profileApplyGates, runtimeWindowSampleSeconds]);
  const powerHashEnvelope = useMemo(() => deriveAlgorithmPowerHashEnvelope({
    objectiveCertificate,
    operatingPolicy: hashOperatingPolicy,
    runtimeRecommendation,
  }), [hashOperatingPolicy, objectiveCertificate, runtimeRecommendation]);
  const routeCertificate = useMemo(() => deriveAlgorithmRouteCertificate({
    plan: algorithmPlan,
    objectiveCertificate,
    objectiveActionPlan,
    powerHashEnvelope,
  }), [algorithmPlan, objectiveActionPlan, objectiveCertificate, powerHashEnvelope]);
  const runWindowPlan = useMemo(() => deriveAlgorithmRunWindowPlan({
    powerHashEnvelope,
    runtimeRecommendation,
    objectiveExperiment,
  }), [objectiveExperiment, powerHashEnvelope, runtimeRecommendation]);
  const runEvidenceReview = useMemo(() => deriveAlgorithmRunEvidenceReview({
    runWindowPlan,
    powerHashEnvelope,
    tuningAnalysis,
  }), [powerHashEnvelope, runWindowPlan, tuningAnalysis]);
  const runtimeRecoveryText = runtimeRecommendation.recoveryCooldownSeconds === null
    ? shortStatus(runtimeRecommendation.priority)
    : runtimeRecommendation.recoveryResumeAllowed
      ? `${shortStatus(runtimeRecommendation.priority)} / clear`
      : `${shortStatus(runtimeRecommendation.priority)} / ${formatDurationSeconds(runtimeRecommendation.recoveryCooldownRemainingSeconds)} left`;
  const runtimeRecommendationTitle = `${runtimeRecommendation.nextStep} ${runtimeRecommendation.recoveryResumeCondition ?? ""} Cooldown ${formatDurationSeconds(runtimeRecommendation.recoveryObservedSeconds)} / ${formatDurationSeconds(runtimeRecommendation.recoveryCooldownSeconds)}. Guardrails: ${runtimeRecommendation.guardrails.slice(0, 3).join(" ") || "none"}.`;
  const powerHashEnvelopeTitle = `${powerHashEnvelope.nextStep} Budget ${formatWatts(powerHashEnvelope.averagePowerBudgetWatts)}; projected ${powerHashEnvelope.projectedAverageHashrate ? formatHashrate(powerHashEnvelope.projectedAverageHashrate) : "waiting"} at ${formatWatts(powerHashEnvelope.projectedAverageWatts)}. Guardrails: ${powerHashEnvelope.guardrails.slice(0, 3).join(" ") || "none"}.`;
  const routeCertificateTitle = `${routeCertificate.summary} ${routeCertificate.nextStep} Missing: ${routeCertificate.missingEvidenceIds.slice(0, 5).join(", ") || "none"}. Guardrails: ${routeCertificate.guardrails.slice(0, 4).join(" ")}.`;
  const routeClaimText = routeCertificate.fullObjectiveClaimAllowed ? "full" : routeCertificate.runtimeProfileClaimAllowed ? "runtime" : "no";
  const localRouteSummary = `${shortStatus(algorithmPlan.strategy)} / ${shortStatus(routeCertificate.productionMode)}`;
  const localRuntimeSummary = `${shortStatus(runtimeRecommendation.mode)} / ${runtimeRecoveryText}`;
  const localTuningSummary = activeTuningStep ? activeTuningStep.summary : "Waiting for local run";
  const localRouteTitle = `${routeCertificate.summary} ${runtimeRecommendation.summary} ${algorithmTuningDirective.nextStep}`;
  const powerHashEnvelopeDutyText = powerHashEnvelope.burstDutyPercent === null ? "waiting" : `${powerHashEnvelope.burstDutyPercent}% burst`;
  const powerHashEnvelopeHashText = powerHashEnvelope.projectedAverageHashrate ? formatHashrate(powerHashEnvelope.projectedAverageHashrate) : "waiting";
  const powerHashEnvelopeWattsText = formatWatts(powerHashEnvelope.projectedAverageWatts);
  const kernelOptimization = hashOperatingPolicy.kernelOptimization;
  const kernelOptimizationTitle = kernelOptimization.nextStep;
  const kernelGainText = formatSignedPercent(kernelOptimization.hashDensityGainPercent);
  const kernelCompressionText = kernelOptimization.compressionWorkSavedPercent === null ? "Waiting" : `${kernelOptimization.compressionWorkSavedPercent}% saved`;
  const runWindowPlanTitle = `${runWindowPlan.nextStep} Stop: ${runWindowPlan.stopConditions.slice(0, 3).join(" ") || "none"}. Guardrails: ${runWindowPlan.guardrails.slice(0, 3).join(" ") || "none"}.`;
  const runEvidenceTitle = `${runEvidenceReview.nextStep} Missing: ${runEvidenceReview.missingEvidence.join(", ") || "none"}. Guardrails: ${runEvidenceReview.guardrails.slice(0, 3).join(" ") || "none"}.`;
  const runEvidenceWindowText = `${formatDurationSeconds(runEvidenceReview.observedSampleSeconds)} / ${formatDurationSeconds(runEvidenceReview.requiredSampleSeconds)}`;
  const runEvidenceDeltaText = `hash ${formatSignedPercent(runEvidenceReview.hashrateDeltaPercent)} / watts ${formatSignedPercent(runEvidenceReview.wattsDeltaPercent)}`;
  const runWindowCycleText = formatDurationSeconds(runWindowPlan.cycleSeconds);
  const runWindowDensityText = formatDurationSeconds(runWindowPlan.densitySeconds);
  const runWindowBurstText = formatDurationSeconds(runWindowPlan.burstSeconds);
  const runWindowCooldownText = formatDurationSeconds(runWindowPlan.cooldownSeconds);
  const applyTuningStep = (step: NonNullable<TuningApplyOption["result"]>["step"]) => {
    const isGpu = isGpuComputeMode(step.computeMode);
    setDraftConfig({
      ...draftConfig,
      compute_mode: step.computeMode as ComputeMode,
      performance_preset: step.performancePreset as PerformancePreset,
      cpu_threads: step.computeMode === "gpu" ? 0 : step.cpuThreads,
      gpu_enabled: isGpu,
      gpu_device_id: isGpu ? sanitizeGpuDeviceId(draftConfig.gpu_device_id, gpuDevices) : null,
      gpu_intensity_percent: step.computeMode === "cpu" ? draftConfig.gpu_intensity_percent : step.gpuIntensityPercent,
    });
  };
  const applyTuningResult = (
    option: TuningApplyOption,
    gateResult: ReturnType<typeof deriveAlgorithmProfileApplyGate>,
  ) => {
    if (!gateResult.canApply || !option.result) {
      return;
    }
    applyTuningStep(option.result.step);
  };
  const objectiveTuneCanApply = objectiveTuneApplyGate.canApply && objectiveExperiment.canApplyLocalProfile;
  const algorithmTuneTitle = `${objectiveTuneApplyGate.summary} ${objectiveTuneApplyGate.nextStep} Capture: ${objectiveExperiment.capturePolicy.summary}`;
  const applyAlgorithmTuningTarget = () => {
    if (!objectiveTuneCanApply || !algorithmTuningDirective.step) {
      return;
    }
    applyTuningStep(algorithmTuningDirective.step);
  };
  const batchTuneTitle = `${batchApplyGate.summary} ${batchApplyGate.nextStep}`;
  const applyHashBatchOptimizationTarget = () => {
    if (!batchApplyGate.canApply || !hashBatchOptimization.targetStep) {
      return;
    }
    applyTuningStep(hashBatchOptimization.targetStep);
  };
  const hardwareSummary = hardwareReady
    ? hardwareGpuAvailable
      ? "hardware GPU ready"
      : softwareGpuAvailable
        ? "software GPU only"
        : "no GPU detected"
    : "detecting hardware";

  return (
    <section className="overlay" role="dialog" aria-modal="true" aria-label="Mining settings">
      <div className="settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LOCAL CONFIG</p>
            <h2>Mining settings</h2>
          </div>
          <button className="close-button" onClick={() => setShowSettings(false)} type="button">
            X
          </button>
        </div>

        <nav className="settings-section-tabs" aria-label="Settings sections">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
        <section id="settings-pet" className="pet-settings-panel settings-section-card" aria-label="Pet profile">
          <div className="settings-section-heading">
            <p className="eyebrow">PET PROFILE</p>
            <strong>{selectedPetProfile.name}</strong>
          </div>
          <div className="pet-profile-summary">
            <span>{selectedPetProfile.personality.name}</span>
            <b>{selectedPetProfile.personality.species}</b>
            <small>{selectedPetProfile.personality.trait} / {selectedPetProfile.body.silhouette}</small>
          </div>
          <div className="pet-profile-picker">
            {builtinPetProfiles.map((profile) => (
              <button
                className={`pet-profile-option ${selectedPetProfile.id === profile.id ? "selected" : ""}`}
                key={profile.id}
                onClick={() => setDraftConfig({ ...draftConfig, pet_profile_id: profile.id })}
                style={petOptionStyle(profile.palette.primary, profile.palette.secondary)}
                type="button"
              >
                <span className="pet-swatch" aria-hidden="true" />
                <span>
                  <b>{profile.name}</b>
                  <small>{profile.personality.name} / {profile.body.silhouette}</small>
                </span>
              </button>
            ))}
          </div>
        </section>

        <div id="settings-device" className="device-settings-panel settings-section-card">
          <div className="settings-section-heading">
            <p className="eyebrow">DEVICE</p>
            <strong>{hardwareSummary}</strong>
          </div>
          <div className="device-summary-grid">
            <div><span>CPU</span><strong>{systemInfo.available_parallelism} logical</strong><small>{draftEffectiveCpuThreads} selected</small></div>
            <div><span>GPU</span><strong>{hardwareGpuAvailable ? "hardware" : softwareGpuAvailable ? "software" : "none"}</strong><small>{draftConfig.gpu_intensity_percent}% limit</small></div>
            <div><span>LIVE HASH</span><strong>{observedHashrate ? formatHashrate(observedHashrate) : "Waiting"}</strong><small>{observedComputeMode ?? draftConfig.compute_mode}</small></div>
            <div><span>EFFECTIVE</span><strong>{runtimeEfficiencySnapshot.rawHashrate > 0 ? formatHashrate(runtimeEfficiencySnapshot.effectiveHashrate) : "Waiting"}</strong><small title={runtimeEfficiencySnapshot.summary}>{shortStatus(runtimeEfficiencySnapshot.status)}</small></div>
            <div><span>WASTE</span><strong>{runtimeEfficiencySnapshot.rawHashrate > 0 ? formatHashrate(runtimeEfficiencySnapshot.wastedHashrate) : "Waiting"}</strong><small title={runtimeEfficiencySnapshot.summary}>{runtimeEfficiencySnapshot.effectiveRatio === null ? "share waiting" : formatRuntimePercent(runtimeEfficiencySnapshot.effectiveRatio) + " useful"}</small></div>
            <div><span>GPU DUTY</span><strong>{formatRuntimePercent(runtimeEfficiencySnapshot.gpuDutyCycle)}</strong><small title={runtimeEfficiencySnapshot.summary}>{runtimeEfficiencySnapshot.gpuThrottleRatio === null ? "throttle waiting" : formatRuntimePercent(runtimeEfficiencySnapshot.gpuThrottleRatio) + " throttle"}</small></div>
          </div>
        </div>

        <div id="settings-connection" className="settings-section-marker">
          <p className="eyebrow">POOL</p>
          <strong>Connection and runtime limits</strong>
        </div>
        <div className="form-grid">
          <label>
            BTC ADDRESS
            <input value={draftConfig.btc_address} onChange={(event) => setDraftConfig({ ...draftConfig, btc_address: event.target.value })} placeholder="bc1..." />
          </label>
          <label>
            POOL HOST
            <input
              list="pool-presets"
              value={draftConfig.pool_host}
              onChange={(event) => {
                const poolHost = event.target.value;
                setDraftConfig({ ...draftConfig, pool_host: poolHost, pool_port: presetPort(poolHost, draftConfig.pool_port) });
              }}
            />
            <datalist id="pool-presets">
              <option value="public-pool.io" />
              <option value="pool.nerdminer.io" />
              <option value="pool.nerdminers.org" />
            </datalist>
          </label>
          <label>
            PORT
            <input type="number" value={draftConfig.pool_port} onChange={(event) => setDraftConfig({ ...draftConfig, pool_port: Number(event.target.value) })} />
          </label>
          <label>
            WORKER
            <input value={draftConfig.worker_name} onChange={(event) => setDraftConfig({ ...draftConfig, worker_name: event.target.value })} />
          </label>
          <label className="full-width">
            POOL PASSWORD / HINT
            <input value={draftConfig.pool_password} onChange={(event) => setDraftConfig({ ...draftConfig, pool_password: event.target.value })} placeholder="x or d=1" />
          </label>

          <label>
            COMPUTE MODE
            <select
              value={draftConfig.compute_mode}
              onChange={(event) => {
                const computeMode = event.target.value as ComputeMode;
                const isGpu = isGpuComputeMode(computeMode);
                setDraftConfig({
                  ...draftConfig,
                  compute_mode: computeMode,
                  gpu_enabled: isGpu,
                  gpu_device_id: isGpu ? sanitizeGpuDeviceId(draftConfig.gpu_device_id, gpuDevices) : null,
                  cpu_threads: computeMode === "gpu" ? 0 : threadsForPreset(draftConfig.performance_preset, systemInfo, Number(draftConfig.cpu_threads), false),
                });
              }}
            >
              <option value="cpu">CPU Only</option>
              <option value="gpu">GPU Only</option>
              <option value="hybrid">CPU + GPU</option>
            </select>
          </label>
          <label>
            PERFORMANCE PRESET
            <select
              disabled={isDraftGpuOnly}
              value={draftConfig.performance_preset}
              onChange={(event) => {
                const performancePreset = event.target.value as PerformancePreset;
                setDraftConfig({
                  ...draftConfig,
                  performance_preset: performancePreset,
                  cpu_threads: threadsForPreset(performancePreset, systemInfo, Number(draftConfig.cpu_threads), false),
                });
              }}
            >
              <option value="eco">Eco</option>
              <option value="normal">Normal</option>
              <option value="turbo">Turbo</option>
              <option value="custom">Custom</option>
            </select>
          </label>
          <label>
            CPU THREADS
            <select
              disabled={isDraftGpuOnly || draftConfig.performance_preset !== "custom"}
              value={draftEffectiveCpuThreads}
              onChange={(event) => setDraftConfig({ ...draftConfig, performance_preset: "custom", cpu_threads: Number(event.target.value) })}
            >
              {cpuThreadOptions.map((threads) => (
                <option key={threads} value={threads}>{threads} thread{threads === 1 ? "" : "s"}</option>
              ))}
            </select>
          </label>
          <label>
            GPU DEVICE
            <select
              disabled={draftConfig.compute_mode === "cpu"}
              value={sanitizeGpuDeviceId(draftConfig.gpu_device_id, gpuDevices) || "auto"}
              onChange={(event) => setDraftConfig({
                ...draftConfig,
                gpu_device_id: sanitizeGpuDeviceId(event.target.value === "auto" ? null : event.target.value, gpuDevices),
              })}
            >
              {gpuDevices.map((device) => (
                <option key={device.id} value={device.id} disabled={device.simulated && device.id !== "auto"}>
                  {device.name}{device.simulated && device.id !== "auto" ? " (software)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            GPU LIMIT
            <select
              disabled={draftConfig.compute_mode === "cpu"}
              value={draftConfig.gpu_intensity_percent}
              onChange={(event) => setDraftConfig({ ...draftConfig, gpu_intensity_percent: Number(event.target.value) })}
            >
              {[10, 25, 50, 75, 100].map((intensity) => <option key={intensity} value={intensity}>{intensity}%</option>)}
            </select>
          </label>
          <div id="settings-experimental" className="settings-subsection-heading full-width">
            <p className="eyebrow">EXPERIMENTAL</p>
            <strong>External hash interfaces are sealed on this branch</strong>
          </div>

          <label>
            ENABLE NOTIFICATIONS
            <select value={draftConfig.enable_notifications ? "true" : "false"} onChange={(event) => setDraftConfig({ ...draftConfig, enable_notifications: event.target.value === "true" })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            NOTIFY JACKPOT
            <select value={draftConfig.notify_on_jackpot ? "true" : "false"} onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_jackpot: event.target.value === "true" })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            NOTIFY SHARE
            <select value={draftConfig.notify_on_share_accepted ? "true" : "false"} onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_share_accepted: event.target.value === "true" })}>
              <option value="false">Disabled</option>
              <option value="true">Enabled</option>
            </select>
          </label>
          <label>
            NOTIFY ERROR
            <select value={draftConfig.notify_on_connection_error ? "true" : "false"} onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_connection_error: event.target.value === "true" })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label>
            HEARTBEAT
            <select value={draftConfig.heartbeat_interval} onChange={(event) => setDraftConfig({ ...draftConfig, heartbeat_interval: event.target.value as HeartbeatInterval })}>
              <option value="off">Off</option>
              <option value="30min">30 min</option>
              <option value="1h">1 hour</option>
              <option value="6h">6 hours</option>
            </select>
          </label>
          <label>
            NOTIFICATION CHANNEL
            <select value={draftConfig.notification_channel} onChange={(event) => setDraftConfig({ ...draftConfig, notification_channel: event.target.value as NotificationChannel })}>
              <option value="local_windows_toast">Local Windows Toast</option>
              <option value="webhook">Webhook</option>
            </select>
          </label>
          <label className="full-width">
            WEBHOOK URL
            <input disabled={draftConfig.notification_channel !== "webhook"} value={draftConfig.webhook_url} onChange={(event) => setDraftConfig({ ...draftConfig, webhook_url: event.target.value })} placeholder="https://example.com/btc-lottery-pet" />
          </label>
        </div>

        <div id="settings-algorithm" className="settings-section-marker">
          <p className="eyebrow">LOCAL ALGORITHM</p>
          <strong>Local-only tuning and evidence</strong>
        </div>

        <div className="local-runtime-focus settings-section-card" aria-label="Local runtime focus" title={localRouteTitle}>
          <div className="local-runtime-heading">
            <span>Local Route</span>
            <b>CPU/GPU tuning is active</b>
            <em>{algorithmPlan.localSummary}</em>
          </div>
          <div className="local-runtime-chips" aria-label="Local route status">
            <small className={`local-runtime-chip route-${routeCertificate.status}`}>
              <span>Route</span>
              <b>{localRouteSummary}</b>
            </small>
            <small className={`local-runtime-chip runtime-${runtimeRecommendation.mode}`}>
              <span>Runtime</span>
              <b>{localRuntimeSummary}</b>
            </small>
            <small className={`local-runtime-chip tuning-${algorithmTuningDirective.kind}`}>
              <span>Tune</span>
              <b>{localTuningSummary}</b>
            </small>
          </div>
        </div>

        <div className="external-hash-summary settings-section-card sealed">
          <span>External Hash</span>
          <b>Archived for now</b>
          <small>compatibility only</small>
          <em>Local CPU/GPU profiles are the only active mining route in this build.</em>
          <em>Stored external settings remain for migration, but jobs and share submission stay sealed.</em>
        </div>

        <div className={`algorithm-plan-card settings-section-card strategy-${algorithmPlan.strategy}`} aria-label="Mining algorithm plan">
          <span>{shortStatus(algorithmPlan.strategy)} / {algorithmPlan.recommendedRoute} / {algorithmPlan.confidence}</span>
          <b>{algorithmPlan.summary}</b>
          <em>{algorithmPlan.localSummary}</em>
          <em>{algorithmPlan.externalSummary}</em>
          <small className="algorithm-envelope-line">{algorithmPlan.operatingEnvelope.summary}</small>
          <small className="algorithm-primary-line">PRIMARY {shortStatus(algorithmPlan.operatingEnvelope.recommendedPoint.role)}: {algorithmPlan.operatingEnvelope.recommendationReason}</small>
          {algorithmPlan.hardwareCandidate.status !== "blocked" && (
            <small className={`algorithm-hardware-line hardware-${algorithmPlan.hardwareCandidate.status}`} title={hardwareCandidateTitle}>
              HARDWARE {algorithmPlan.hardwareCandidate.status} / {algorithmPlan.hardwareCandidate.score}: {algorithmPlan.hardwareCandidate.summary} / EFFECTIVE {hardwareCandidateEffectiveText} / WASTE {shortStatus(algorithmPlan.hardwareCandidate.hashWasteRisk)}
            </small>
          )}
          <small className={`algorithm-density-line density-${algorithmPlan.densityPlan.strategy}`} title={`${algorithmPlan.densityPlan.powerBudgetSummary} ${algorithmPlan.densityPlan.nextStep}`}>
            DENSITY {shortStatus(algorithmPlan.densityPlan.strategy)} / {shortStatus(algorithmPlan.densityPlan.powerBudgetSource)}: {algorithmPlan.densityPlan.selectedLane.label} / {algorithmPlan.densityPlan.selectedLane.hashrate ? formatHashrate(algorithmPlan.densityPlan.selectedLane.hashrate) : "waiting"} / {formatWatts(algorithmPlan.densityPlan.selectedLane.watts)}
          </small>
          <small className="algorithm-density-line" title={algorithmPlan.densityPlan.primaryMissingGate?.nextStep ?? algorithmPlan.densityPlan.nextStep}>
            DENSITY READY {algorithmPlan.densityPlan.readinessScore}%: {algorithmPlan.densityPlan.primaryMissingGate ? algorithmPlan.densityPlan.primaryMissingGate.summary : "density lane clears long-run evidence gates"}
          </small>
          {algorithmPlan.densityPlan.hashrateHeadroom.status !== "none" && (
            <small className={`algorithm-density-line headroom-${algorithmPlan.densityPlan.hashrateHeadroom.status}`} title={algorithmPlan.densityPlan.hashrateHeadroom.nextStep}>
              HEADROOM {shortStatus(algorithmPlan.densityPlan.hashrateHeadroom.status)}: {algorithmPlan.densityPlan.hashrateHeadroom.extraHashrate ? formatHashrate(algorithmPlan.densityPlan.hashrateHeadroom.extraHashrate) : "waiting"} / {algorithmPlan.densityPlan.hashrateHeadroom.extraWatts ? `+${formatWatts(algorithmPlan.densityPlan.hashrateHeadroom.extraWatts)}` : "waiting"}
            </small>
          )}
          {algorithmPlan.densityPlan.marginalDecision.status !== "none" && (
            <small className={`algorithm-density-line marginal-${algorithmPlan.densityPlan.marginalDecision.status}`} title={`${algorithmPlan.densityPlan.marginalDecision.summary} ${algorithmPlan.densityPlan.marginalDecision.nextStep}`}>
              MARGINAL {shortStatus(algorithmPlan.densityPlan.marginalDecision.status)}: {algorithmPlan.densityPlan.marginalDecision.extraHashrate ? formatHashrate(algorithmPlan.densityPlan.marginalDecision.extraHashrate) : "waiting"} / {algorithmPlan.densityPlan.marginalDecision.densityRetentionRatio !== null ? `${Math.round(algorithmPlan.densityPlan.marginalDecision.densityRetentionRatio * 100)}% density` : "waiting"}
            </small>
          )}
          <small className="algorithm-readiness-line">READINESS {algorithmPlan.readinessCertificate.readinessScore}%: {algorithmPlan.readinessCertificate.summary}</small>
          <small className={`algorithm-operating-line operate-${hashOperatingPolicy.mode}`} title={`${hashOperatingPolicy.summary} ${hashOperatingPolicy.nextStep} Guardrails: ${hashOperatingPolicy.guardrails.slice(0, 3).join(" ")}`}>
            OPERATE {shortStatus(hashOperatingPolicy.mode)} / {shortStatus(hashOperatingPolicy.action)} / AUTO {hashOperatingPolicy.autoApplyAllowed ? "yes" : "no"}
          </small>
          <small className={`algorithm-kernel-line kernel-${kernelOptimization.mode}`} title={kernelOptimizationTitle}>
            KERNEL {shortStatus(kernelOptimization.mode)} / {kernelGainText}: {kernelCompressionText}
          </small>
          <small className={`algorithm-objective-line objective-${objectiveActionPlan.action}`} title={`${objectiveActionPlan.reason} ${objectiveActionPlan.nextStep}`}>
            OBJECTIVE {shortStatus(objectiveCertificate.status)} / {shortStatus(objectiveActionPlan.action)}: {objectiveActionPlan.summary}
          </small>
          <small className={`algorithm-route-certificate route-${routeCertificate.status}`} title={routeCertificateTitle}>
            ROUTE {shortStatus(routeCertificate.status)} / {shortStatus(routeCertificate.productionMode)} / CLAIM {routeClaimText}: {routeCertificate.summary}
          </small>
          <div className={`algorithm-objective-progress gap-${objectiveCertificate.primaryEvidenceGap}`} title={objectiveProgressTitle} aria-label="Objective progress">
            <div><span>GOAL</span><b>{objectiveCertificate.objectiveProgressScore}%</b></div>
            <div><span>LOW</span><b>{objectiveCertificate.lowPowerProgressScore}%</b></div>
            <div><span>HASH</span><b>{objectiveCertificate.highHashProgressScore}%</b></div>
            <small>GAP {objectiveGapText}</small>
            <div className="algorithm-progress-track" aria-hidden="true"><span style={{ width: `${objectiveCertificate.objectiveProgressScore}%` }} /></div>
          </div>
          <small className="algorithm-research-line" title={`${algorithmPlan.researchReview.nextStep} ${algorithmPlan.researchReview.safetyEnvelope.summary}`}>
            RESEARCH {shortStatus(algorithmPlan.researchReview.primaryProductionIdea.id)}: {algorithmPlan.researchReview.summary}
          </small>
          <small className="algorithm-policy-line" title={`${algorithmPlan.researchPolicy.powerPriority} ${algorithmPlan.researchPolicy.hashratePriority}`}>
            POLICY {algorithmPlan.researchPolicy.deploymentSummary}: {algorithmPlan.researchPolicy.hashratePriority}
          </small>
          <small className={`algorithm-claim-line claim-${hashClaimCertificate.lowestPower.status}`} title={`${hashClaimCertificate.lowestPower.summary} ${hashClaimCertificate.lowestPower.nextStep}`}>
            CLAIM LOW {shortStatus(hashClaimCertificate.lowestPower.status)} / {shortStatus(hashClaimCertificate.lowestPower.scope)}: {lowestPowerClaimText}
          </small>
          <small className={`algorithm-claim-line claim-${hashClaimCertificate.highestHash.status}`} title={highestHashClaimTitle}>
            CLAIM HASH {shortStatus(hashClaimCertificate.highestHash.status)} / {shortStatus(hashClaimCertificate.highestHash.scope)} / {highestHashClaimBasisText}: {highestHashClaimText}
          </small>
          <small className="algorithm-roadmap-line" title={algorithmPlan.evidenceRoadmap.nextStep}>
            ROADMAP {algorithmPlan.evidenceRoadmap.completionScore}%: {algorithmPlan.evidenceRoadmap.summary}
          </small>
          <small className={`algorithm-objective-experiment experiment-stage-${objectiveExperiment.stage}`} title={objectiveExperimentTitle}>
            NEXT EXP {shortStatus(objectiveExperiment.stage)} / {shortStatus(objectiveExperiment.route)}: {objectiveExperiment.targetProfileSummary ?? objectiveExperiment.summary}
          </small>
          <small className={`algorithm-objective-feedback feedback-${objectiveFeedback.status}`} title={objectiveFeedbackTitle}>
            FEEDBACK {shortStatus(objectiveFeedback.status)} / {shortStatus(objectiveFeedback.recommendation)}: {objectiveFeedback.summary}
          </small>
          <small className={`algorithm-runtime-recommendation runtime-${runtimeRecommendation.mode}`} title={runtimeRecommendationTitle}>
            RUNTIME {shortStatus(runtimeRecommendation.mode)} / {runtimeRecoveryText}: {runtimeRecommendation.summary}
          </small>
          <small className={`algorithm-power-envelope envelope-${powerHashEnvelope.mode}`} title={powerHashEnvelopeTitle}>
            ENVELOPE {shortStatus(powerHashEnvelope.mode)} / {powerHashEnvelopeDutyText}: {powerHashEnvelopeHashText} / {powerHashEnvelopeWattsText}
          </small>
          <small className={`algorithm-run-window window-${runWindowPlan.mode}`} title={runWindowPlanTitle}>
            WINDOW {shortStatus(runWindowPlan.mode)} / {runWindowCycleText}: density {runWindowDensityText} / burst {runWindowBurstText} / cool {runWindowCooldownText}
          </small>
          <small className={`algorithm-run-evidence evidence-${runEvidenceReview.status}`} title={runEvidenceTitle}>
            EVIDENCE {shortStatus(runEvidenceReview.status)} / {runEvidenceWindowText}: {runEvidenceDeltaText}
          </small>
          <small className="algorithm-sampling-line" title={algorithmPlan.samplingPlan.nextStep}>
            SAMPLE {shortStatus(algorithmPlan.samplingPlan.primaryTask.id)}: {algorithmPlan.samplingPlan.summary}
          </small>
          <small className={`algorithm-experiment-line experiment-${algorithmExperimentAdvisor.priority}`} title={`${algorithmExperimentAdvisor.nextStep} Evidence: ${algorithmExperimentAdvisor.evidenceToRecord.join(", ")} Stop: ${algorithmExperimentAdvisor.stopConditions.slice(0, 3).join(", ")}`}>
            EXPERIMENT {shortStatus(algorithmExperimentAdvisor.priority)} / {shortStatus(algorithmExperimentAdvisor.focus)}: {algorithmExperimentAdvisor.summary}
          </small>
          <small className={`algorithm-experiment-line confidence-${algorithmExperimentConfidence.status}`} title={`${algorithmExperimentConfidence.nextStep} Missing: ${algorithmExperimentConfidence.missingEvidence.join(", ")} Repeat: ${algorithmExperimentConfidence.evidenceToRepeat.join(", ")}`}>
            CONFIDENCE {algorithmExperimentConfidence.confidenceScore}% / {shortStatus(algorithmExperimentConfidence.status)}: {algorithmExperimentConfidence.summary}
          </small>
          <small className={`algorithm-tuning-line tuning-${algorithmTuningDirective.kind}`} title={algorithmTuningDirective.nextStep}>
            TUNE {efficiencyGoalLabel(tuningSweepPlan.goal)} / {shortStatus(algorithmTuningDirective.kind)}: {algorithmTuningDirective.summary}
          </small>
          <small className={`algorithm-batch-line batch-${hashBatchOptimization.pressure}`} title={`${hashBatchOptimization.nextStep} Guardrails: ${hashBatchOptimization.guardrails.slice(0, 3).join(" ")}`}>
            BATCH {shortStatus(hashBatchOptimization.pressure)} / {shortStatus(hashBatchOptimization.action)}: {hashBatchOptimization.summary}
          </small>
          {algorithmPlan.riskFlags.length > 0 && <small className="algorithm-risk-line">{algorithmPlan.riskFlags.slice(0, 2).join(" / ")}</small>}
        </div>

        <div className="tuning-session-summary" aria-label="Local tuning evidence capture">
          <div><span>SAMPLES</span><b>{storedTuningSampleCount}</b><small>{measuredTuningSampleCount} measured / {tuningReplicationHistory.length} runs</small></div>
          <div><span>ACTIVE</span><b>{activeTuningStep ? activeTuningStep.summary : "Waiting"}</b><small title={tuningAutoSampleGate.summary}>{shortStatus(tuningAutoSampleGate.status)}</small></div>
          <label className="measured-watts-control">
            <span>MEASURED WATTS</span>
            <input disabled={!activeTuningStep} min="0" step="0.1" type="number" value={manualMeasuredWatts} onChange={(event) => setManualMeasuredWatts(event.target.value)} placeholder={activeTuningStep ? formatWatts(activeTuningStep.estimatedWatts) : "Waiting"} />
          </label>
          <button className="secondary-button" disabled={!tuningAutoSampleGate.canCapture} onClick={captureCurrentTuningSample} title={captureTuneTitle} type="button">CAPTURE</button>
          <button className="secondary-button active" disabled={!objectiveTuneCanApply} onClick={applyAlgorithmTuningTarget} title={algorithmTuneTitle} type="button">APPLY TUNE</button>
          <button className="secondary-button active" disabled={!batchApplyGate.canApply} onClick={applyHashBatchOptimizationTarget} title={batchTuneTitle} type="button">APPLY BATCH</button>
          <button className="secondary-button" disabled={!lowestPowerApplyGate.canApply} onClick={() => applyTuningResult(lowestPowerApplyOption, lowestPowerApplyGate)} title={`${lowestPowerApplyGate.summary} ${lowestPowerApplyGate.nextStep}`} type="button">APPLY LOW</button>
          <button className="secondary-button" disabled={!bestEfficiencyApplyGate.canApply} onClick={() => applyTuningResult(bestEfficiencyApplyOption, bestEfficiencyApplyGate)} title={`${bestEfficiencyApplyGate.summary} ${bestEfficiencyApplyGate.nextStep}`} type="button">APPLY EFF</button>
          <button className="secondary-button" disabled={!bestHashrateApplyGate.canApply} onClick={() => applyTuningResult(bestHashrateApplyOption, bestHashrateApplyGate)} title={`${bestHashrateApplyGate.summary} ${bestHashrateApplyGate.nextStep}`} type="button">APPLY HASH</button>
          <button className="secondary-button" disabled={storedTuningSampleCount === 0} onClick={clearTuningEvidence} type="button">CLEAR LOCAL</button>
        </div>

        <div id="settings-diagnostics" className="settings-section-marker">
          <p className="eyebrow">TOOLS</p>
          <strong>Benchmarks and connection diagnostics</strong>
        </div>
        <div className="benchmark-row settings-section-card">
          <div className="settings-tool-actions">
            <button className="secondary-button" disabled={draftConfig.compute_mode === "cpu"} onClick={() => void runGpuBenchmark()} type="button">RUN BENCHMARK</button>
            <button className="secondary-button" onClick={() => void runPoolDiagnostic()} type="button">TEST POOL</button>
          </div>
          {benchmarkResult && (
            <div className="benchmark-result">
              <div><span>Device</span><strong>{benchmarkResult.device_name}</strong></div>
              <div><span>Hashrate</span><strong>{formatHashrate(benchmarkResult.hashrate)}</strong></div>
              <div><span>Intensity</span><strong>{benchmarkResult.gpu_intensity_percent}%</strong></div>
              <p>{benchmarkResult.note}</p>
            </div>
          )}
          {poolDiagnosticResult && (
            <div className="pool-diagnostic-result" aria-label="Pool diagnostic result">
              <div className="pool-diagnostic-summary"><span>{poolDiagnosticResult.pool}</span><strong>{poolDiagnosticResult.summary}</strong></div>
              {poolDiagnosticResult.steps.map((step) => (
                <div className={`pool-diagnostic-step ${step.status}`} key={`${step.name}-${step.status}`}>
                  <span>{step.name}</span><b>{step.status}</b><p>{step.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        </div>

        <div className="panel-actions">
          <span>Choose a mode before starting. Device limits are applied on save.</span>
          <button className="confirm-button" onClick={() => void saveSettings()} type="button">SAVE</button>
        </div>
      </div>
    </section>
  );
}

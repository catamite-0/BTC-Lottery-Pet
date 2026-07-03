import type { HashKernelBenchmarkLike } from "./hashKernelBenchmark.js";

export interface BackendDiagnosticSnapshotBridge {
  algorithmKernelBenchmark: HashKernelBenchmarkLike | null;
}

export const emptyBackendDiagnosticBridge: BackendDiagnosticSnapshotBridge = {
  algorithmKernelBenchmark: null,
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function kernelBenchmarkValue(value: unknown): HashKernelBenchmarkLike | null {
  const record = recordValue(value);
  return record ? record as HashKernelBenchmarkLike : null;
}

export function extractBackendDiagnosticBridge(snapshot: unknown): BackendDiagnosticSnapshotBridge {
  const record = recordValue(snapshot);
  if (!record) {
    return emptyBackendDiagnosticBridge;
  }

  return {
    algorithmKernelBenchmark: kernelBenchmarkValue(
      record.algorithm_kernel_benchmark ?? record.algorithmKernelBenchmark,
    ),
  };
}

export function parseBackendDiagnosticBridge(snapshotText: string | null | undefined): BackendDiagnosticSnapshotBridge {
  if (!snapshotText) {
    return emptyBackendDiagnosticBridge;
  }
  try {
    return extractBackendDiagnosticBridge(JSON.parse(snapshotText));
  } catch {
    return emptyBackendDiagnosticBridge;
  }
}

export function backendDiagnosticBridgeFromKernelBenchmark(
  algorithmKernelBenchmark: HashKernelBenchmarkLike | null | undefined,
): BackendDiagnosticSnapshotBridge {
  return {
    algorithmKernelBenchmark: algorithmKernelBenchmark ?? null,
  };
}

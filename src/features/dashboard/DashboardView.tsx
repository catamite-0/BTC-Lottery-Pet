import type { ReactNode } from "react";
import type { MetricRow } from "../../app/miningDashboardViewModel";
import LogPanel from "./LogPanel";
import MiningControlPanel from "./MiningControlPanel";
import MiningMetricsPanel from "./MiningMetricsPanel";

interface DashboardViewProps {
  petDisplay: ReactNode;
  statusSummary: ReactNode;
  luckMeter: ReactNode;
  controlButton: ReactNode;
  displayedHashrate: string;
  poolStatus: string;
  authStatus: string;
  jobStatus: string;
  lastShare: string;
  metrics: MetricRow[];
  resourceMetrics: MetricRow[];
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
}

export default function DashboardView({
  petDisplay,
  statusSummary,
  luckMeter,
  controlButton,
  displayedHashrate,
  poolStatus,
  authStatus,
  jobStatus,
  lastShare,
  metrics,
  resourceMetrics,
  latestLog,
  openLogs,
  copyLogPath,
}: DashboardViewProps) {
  return (
    <section className="dashboard-view" aria-label="Mining dashboard">
      <section className="dashboard-command-row" aria-label="Mining command center">
        <div className="dashboard-pet-panel">
          {petDisplay}
        </div>
        <MiningControlPanel
          variant="dashboard"
          statusSummary={statusSummary}
          luckMeter={luckMeter}
          controlButton={controlButton}
          displayedHashrate={displayedHashrate}
          poolStatus={poolStatus}
          jobStatus={jobStatus}
        />
      </section>

      <MiningMetricsPanel
        metrics={metrics}
        resourceMetrics={resourceMetrics}
        poolStatus={poolStatus}
        authStatus={authStatus}
        jobStatus={jobStatus}
        lastShare={lastShare}
      />

      <LogPanel
        latestLog={latestLog}
        openLogs={openLogs}
        copyLogPath={copyLogPath}
      />
    </section>
  );
}

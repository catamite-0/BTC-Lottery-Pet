import type { ReactNode } from "react";

interface MiningControlPanelProps {
  variant: "widget" | "dashboard";
  statusSummary: ReactNode;
  luckMeter: ReactNode;
  controlButton: ReactNode;
  displayedHashrate: string;
  poolStatus: string;
  jobStatus: string;
}

export default function MiningControlPanel({
  variant,
  statusSummary,
  luckMeter,
  controlButton,
  displayedHashrate,
  poolStatus,
  jobStatus,
}: MiningControlPanelProps) {
  return (
    <section className={`mining-control-panel ${variant}`} aria-label="Mining controls">
      <div className="control-readout">
        <span>Hashrate</span>
        <strong>{displayedHashrate}</strong>
      </div>
      <div className="control-status-grid">
        {statusSummary}
        {luckMeter}
      </div>
      <div className="control-context">
        <span title={poolStatus}>
          <b>Pool</b>
          {poolStatus}
        </span>
        <span title={jobStatus}>
          <b>Job</b>
          {jobStatus}
        </span>
      </div>
      {controlButton}
    </section>
  );
}

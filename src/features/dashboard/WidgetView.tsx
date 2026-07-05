import type { ReactNode } from "react";
import MiningControlPanel from "./MiningControlPanel";

interface WidgetViewProps {
  petDisplay: ReactNode;
  statusSummary: ReactNode;
  luckMeter: ReactNode;
  controlButton: ReactNode;
  displayedHashrate: string;
  poolStatus: string;
  jobStatus: string;
}

export default function WidgetView({
  petDisplay,
  statusSummary,
  luckMeter,
  controlButton,
  displayedHashrate,
  poolStatus,
  jobStatus,
}: WidgetViewProps) {
  return (
    <section className="widget-view" aria-label="Mining widget">
      <div className="widget-pet-stage">
        {petDisplay}
      </div>
      <MiningControlPanel
        variant="widget"
        statusSummary={statusSummary}
        luckMeter={luckMeter}
        controlButton={controlButton}
        displayedHashrate={displayedHashrate}
        poolStatus={poolStatus}
        jobStatus={jobStatus}
      />
    </section>
  );
}

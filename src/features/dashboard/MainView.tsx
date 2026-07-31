import { useEffect, useRef, type ReactNode } from "react";
import type { MiningDashboardViewModel } from "../../app/miningDashboardViewModel";
import LogPanel from "./LogPanel";

interface MainViewProps {
  petDisplay: ReactNode;
  controlPanel: ReactNode;
  viewModel: MiningDashboardViewModel;
  detailsOpen: boolean;
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
}

export default function MainView({
  petDisplay,
  controlPanel,
  viewModel,
  detailsOpen,
  latestLog,
  openLogs,
  copyLogPath,
}: MainViewProps) {
  const detailsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!detailsOpen) return;
    detailsRef.current?.scrollIntoView({ block: "start" });
    detailsRef.current?.focus({ preventScroll: true });
  }, [detailsOpen]);

  return (
    <section className="main-view" aria-label="Mining overview">
      <section className="main-command-row" aria-label="Mining command center">
        <div className="main-pet-panel">{petDisplay}</div>
        {controlPanel}
      </section>

      <section className="summary-metrics" aria-label="Mining summary">
        {viewModel.summaryMetrics.map(([label, value]) => (
          <article key={label}>
            <p className="label">{label}</p>
            <strong title={value}>{value}</strong>
          </article>
        ))}
      </section>

      {detailsOpen && (
        <section
          aria-label="Mining details"
          className="details-panel"
          id="mining-details"
          ref={detailsRef}
          tabIndex={-1}
        >
          <div className="detail-sections">
            {viewModel.detailSections.map((section) => (
              <section className="detail-section" key={section.title} aria-label={section.title}>
                <p className="label">{section.title}</p>
                <div className="detail-metrics">
                  {section.metrics.map(([label, value]) => (
                    <span key={label}>
                      <b>{label}</b>
                      <em title={value}>{value}</em>
                    </span>
                  ))}
                </div>
              </section>
            ))}
          </div>
          <LogPanel latestLog={latestLog} openLogs={openLogs} copyLogPath={copyLogPath} />
        </section>
      )}
    </section>
  );
}

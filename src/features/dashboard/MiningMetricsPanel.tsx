import type { MetricRow } from "../../app/miningDashboardViewModel";

interface MiningMetricsPanelProps {
  metrics: MetricRow[];
  resourceMetrics: MetricRow[];
  poolStatus: string;
  authStatus: string;
  jobStatus: string;
  lastShare: string;
}

export default function MiningMetricsPanel({
  metrics,
  resourceMetrics,
  poolStatus,
  authStatus,
  jobStatus,
  lastShare,
}: MiningMetricsPanelProps) {
  const primaryMetrics = metrics.slice(0, 4);
  const secondaryMetrics = metrics.slice(4);

  return (
    <section className="dashboard-metrics-panel" aria-label="Mining metrics">
      <section className="dashboard-primary-metrics" aria-label="Primary mining metrics">
        {primaryMetrics.map(([label, value]) => (
          <article key={label}>
            <p className="label">{label}</p>
            <strong title={value}>{value}</strong>
          </article>
        ))}
      </section>

      <section className="dashboard-secondary-metrics" aria-label="Secondary mining metrics">
        {secondaryMetrics.map(([label, value]) => (
          <span key={label}>
            <b>{label}</b>
            {value}
          </span>
        ))}
      </section>

      <section className="dashboard-connection-panel" aria-label="Mining connection status">
        <span>
          <b>POOL</b>
          {poolStatus}
        </span>
        <span>
          <b>AUTH</b>
          {authStatus}
        </span>
        <span>
          <b>JOB</b>
          {jobStatus}
        </span>
        <span>
          <b>LAST SHARE</b>
          {lastShare}
        </span>
      </section>

      <section className="dashboard-resource-panel" aria-label="Resource status">
        {resourceMetrics.map(([label, value]) => (
          <span key={label}>
            <b>{label}</b>
            {value}
          </span>
        ))}
      </section>
    </section>
  );
}

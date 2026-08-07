import type { MetricRow } from "../../app/miningDashboardViewModel";

interface MiningMetricsPanelProps {
  metrics: MetricRow[];
  resourceMetrics: MetricRow[];
  poolStatus: string;
  authStatus: string;
  jobStatus: string;
  lastShare: string;
}

function metricsInGroup(metrics: MetricRow[], group: MetricRow["group"]) {
  return metrics.filter((row) => row.group === group);
}

function MetricList({
  className,
  title,
  metrics,
}: {
  className: string;
  title: string;
  metrics: MetricRow[];
}) {
  return (
    <section className={`${className} metric-list-panel`} aria-label={title}>
      <div className="metric-panel-heading">
        <p className="label">{title}</p>
      </div>
      <div className="metric-list-grid">
        {metrics.map((row) => (
          <span key={row.id}>
            <b>{row.label}</b>
            <em title={row.value}>{row.value}</em>
          </span>
        ))}
      </div>
    </section>
  );
}

export default function MiningMetricsPanel({
  metrics,
  resourceMetrics,
  poolStatus,
  authStatus,
  jobStatus,
  lastShare,
}: MiningMetricsPanelProps) {
  const primaryMetrics = metricsInGroup(metrics, "primary");
  const networkMetrics = metricsInGroup(metrics, "network");
  const sessionMetrics = metricsInGroup(metrics, "session");

  return (
    <section className="dashboard-metrics-panel" aria-label="Mining metrics">
      <section className="dashboard-primary-metrics" aria-label="Primary mining metrics">
        {primaryMetrics.map((row) => (
          <article key={row.id}>
            <p className="label">{row.label}</p>
            <strong title={row.value}>{row.value}</strong>
          </article>
        ))}
      </section>

      <MetricList
        className="dashboard-secondary-metrics dashboard-network-panel"
        title="Network"
        metrics={networkMetrics}
      />

      <MetricList
        className="dashboard-session-panel"
        title="Session"
        metrics={sessionMetrics}
      />

      <section className="dashboard-connection-panel metric-list-panel" aria-label="Mining connection status">
        <div className="metric-panel-heading">
          <p className="label">Connection</p>
        </div>
        <div className="metric-list-grid">
          <span>
            <b>POOL</b>
            <em title={poolStatus}>{poolStatus}</em>
          </span>
          <span>
            <b>AUTH</b>
            <em title={authStatus}>{authStatus}</em>
          </span>
          <span>
            <b>JOB</b>
            <em title={jobStatus}>{jobStatus}</em>
          </span>
          <span>
            <b>LAST SHARE</b>
            <em title={lastShare}>{lastShare}</em>
          </span>
        </div>
      </section>

      <MetricList
        className="dashboard-resource-panel"
        title="System"
        metrics={resourceMetrics}
      />
    </section>
  );
}

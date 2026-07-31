interface LogPanelProps {
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
}

export default function LogPanel({
  latestLog,
  openLogs,
  copyLogPath,
}: LogPanelProps) {
  return (
    <section className="dashboard-log-panel" aria-label="Mining log tools">
      <div className="log-message">
        <span className="log-label">LOG</span>
        <span className="log-text" title={latestLog}>
          {latestLog}
        </span>
      </div>
      <div className="log-actions">
        <button className="mini-button" onClick={() => void openLogs()} type="button">
          Open logs
        </button>
        <button className="mini-button" onClick={() => void copyLogPath()} type="button">
          Copy path
        </button>
      </div>
    </section>
  );
}

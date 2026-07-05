interface LogPanelProps {
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
  saveDiagnostics: () => Promise<void>;
}

export default function LogPanel({
  latestLog,
  openLogs,
  copyLogPath,
  copyDiagnostics,
  saveDiagnostics,
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
          OPEN LOGS
        </button>
        <button className="mini-button" onClick={() => void copyLogPath()} type="button">
          COPY PATH
        </button>
        <button className="mini-button" onClick={() => void copyDiagnostics()} type="button">
          COPY DIAG
        </button>
        <button className="mini-button" onClick={() => void saveDiagnostics()} type="button">
          SAVE DIAG
        </button>
      </div>
    </section>
  );
}

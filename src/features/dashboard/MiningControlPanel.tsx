interface MiningControlPanelProps {
  displayedHashrate: string;
  displayStatus: string;
  statusClassName: string;
  connectionStatus: string;
  controlButtonLabel: string;
  controlDisabled: boolean;
  isMining: boolean;
  onControl: () => void;
}

export default function MiningControlPanel({
  displayedHashrate,
  displayStatus,
  statusClassName,
  connectionStatus,
  controlButtonLabel,
  controlDisabled,
  isMining,
  onControl,
}: MiningControlPanelProps) {
  return (
    <section className="mining-control-panel" aria-label="Mining controls">
      <div className="control-readout">
        <span>Hashrate</span>
        <strong>{displayedHashrate}</strong>
      </div>
      <div className="control-status-grid">
        <div className="status-copy">
          <p className="label">Status</p>
          <p className={`status ${statusClassName}`}>{displayStatus}</p>
        </div>
        <div className="connection-copy">
          <p className="label">Connection</p>
          <p title={connectionStatus}>{connectionStatus}</p>
        </div>
      </div>
      <button
        className={isMining ? "control-button stop" : "control-button start"}
        disabled={controlDisabled}
        onClick={onControl}
        title={controlDisabled ? "Mining command is still running" : undefined}
        type="button"
      >
        {controlButtonLabel}
      </button>
    </section>
  );
}

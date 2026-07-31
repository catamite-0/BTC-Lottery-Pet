interface HeaderProps {
  detailsOpen: boolean;
  toggleDetails: () => void;
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  settingsDisabled: boolean;
  openSettings: () => void;
}

export default function Header({
  detailsOpen,
  toggleDetails,
  alwaysOnTop,
  toggleAlwaysOnTop,
  settingsDisabled,
  openSettings,
}: HeaderProps) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">CPU MINING</p>
        <h1>BTC Lottery Pet</h1>
      </div>
      <div className="header-actions">
        <button
          aria-controls="mining-details"
          aria-expanded={detailsOpen}
          className={`details-button ${detailsOpen ? "active" : ""}`}
          onClick={toggleDetails}
          title={detailsOpen ? "Hide mining details" : "Show mining details"}
          type="button"
        >
          Details
        </button>
        <button
          aria-pressed={alwaysOnTop}
          className={`pin-button ${alwaysOnTop ? "active" : ""}`}
          onClick={toggleAlwaysOnTop}
          title="Toggle always on top"
          type="button"
        >
          {alwaysOnTop ? "Pinned" : "Float"}
        </button>
        <button
          aria-label="Open settings"
          className="settings-button"
          disabled={settingsDisabled}
          onClick={openSettings}
          title={settingsDisabled ? "Stop mining before changing settings" : "Open settings"}
          type="button"
        >
          Settings
        </button>
      </div>
    </header>
  );
}

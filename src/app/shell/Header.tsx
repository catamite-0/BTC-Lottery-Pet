interface HeaderProps {
  displayMode: "compact" | "detail";
  setDisplayMode: React.Dispatch<React.SetStateAction<"compact" | "detail">>;
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  settingsDisabled: boolean;
  openSettings: () => void;
}

export default function Header({
  displayMode,
  setDisplayMode,
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
          aria-label={displayMode === "compact" ? "Switch to dashboard view" : "Switch to widget view"}
          className={`mode-button ${displayMode === "detail" ? "armed" : ""}`}
          onClick={() => setDisplayMode((mode) => (mode === "compact" ? "detail" : "compact"))}
          title={displayMode === "compact" ? "Switch to dashboard view" : "Switch to widget view"}
          type="button"
        >
          {displayMode === "compact" ? "Dashboard" : "Widget"}
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

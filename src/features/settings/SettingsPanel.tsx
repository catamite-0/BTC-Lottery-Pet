import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type SetStateAction,
} from "react";
import type {
  AppConfig,
  PerformancePreset,
  SystemInfo,
} from "../../miningLogic";
import AdvancedSettingsSection from "./AdvancedSettingsSection";
import BasicSettingsSection, {
  poolPresetForHost,
  type PoolPresetId,
} from "./BasicSettingsSection";

interface SettingsPanelProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setShowSettings: (show: boolean) => void;
  saveSettings: () => Promise<void>;
  systemInfo: SystemInfo;
  presetPort: (poolHost: string, currentPort: number) => number;
  threadsForPreset: (
    preset: PerformancePreset,
    systemInfo: SystemInfo,
    customThreads: number,
  ) => number;
  hardwareReady: boolean;
  errorMessage: string | null;
  dismissError: () => void;
}

const settingsSections = [
  { id: "basic", label: "Basic" },
  { id: "advanced", label: "Advanced" },
] as const;

type SettingsSectionId = (typeof settingsSections)[number]["id"];

export default function SettingsPanel({
  draftConfig,
  setDraftConfig,
  setShowSettings,
  saveSettings,
  systemInfo,
  presetPort,
  threadsForPreset,
  hardwareReady,
  errorMessage,
  dismissError,
}: SettingsPanelProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("basic");
  const [selectedPoolPreset, setSelectedPoolPreset] = useState<PoolPresetId>(() =>
    poolPresetForHost(draftConfig.pool_host),
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const inertSiblings = Array.from(dialog.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== dialog)
      .map((element) => ({ element, wasInert: element.hasAttribute("inert") }));
    inertSiblings.forEach(({ element }) => element.setAttribute("inert", ""));

    const focusableElements = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
    )).filter((element) => !element.hasAttribute("hidden") && element.offsetParent !== null);
    const focusFrame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-modal-initial-focus]")?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setShowSettings(false);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements();
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      inertSiblings.forEach(({ element, wasInert }) => {
        if (!wasInert) element.removeAttribute("inert");
      });
      previousFocus?.focus();
    };
  }, [setShowSettings]);

  const handleTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    sectionIndex: number,
  ) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (sectionIndex + 1) % settingsSections.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (sectionIndex - 1 + settingsSections.length) % settingsSections.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = settingsSections.length - 1;
    }
    if (nextIndex === null) return;

    event.preventDefault();
    const nextSection = settingsSections[nextIndex];
    setActiveSection(nextSection.id);
    document.getElementById(`settings-${nextSection.id}-tab`)?.focus();
  };

  return (
    <section
      aria-label="Mining settings"
      aria-modal="true"
      className="overlay"
      ref={dialogRef}
      role="dialog"
    >
      <div className="settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LOCAL CONFIG</p>
            <h2>Mining settings</h2>
          </div>
          <button
            aria-label="Close settings"
            className="close-button"
            data-modal-initial-focus
            onClick={() => setShowSettings(false)}
            type="button"
          >
            X
          </button>
        </div>

        <nav className="settings-section-tabs" aria-label="Settings sections" role="tablist">
          {settingsSections.map((section, sectionIndex) => (
            <button
              aria-controls={`settings-${section.id}`}
              aria-selected={activeSection === section.id}
              className={activeSection === section.id ? "selected" : ""}
              id={`settings-${section.id}-tab`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              onKeyDown={(event) => handleTabKeyDown(event, sectionIndex)}
              role="tab"
              tabIndex={activeSection === section.id ? 0 : -1}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {errorMessage && (
            <button className="settings-error" onClick={dismissError} type="button">
              <span role="alert">{errorMessage}</span>
              <b>Dismiss</b>
            </button>
          )}
          <div className="settings-tabpanels">
            <div
              aria-labelledby="settings-basic-tab"
              className="settings-content"
              hidden={activeSection !== "basic"}
              id="settings-basic"
              role="tabpanel"
            >
              <BasicSettingsSection
                draftConfig={draftConfig}
                selectedPoolPreset={selectedPoolPreset}
                setDraftConfig={setDraftConfig}
                setSelectedPoolPreset={setSelectedPoolPreset}
                systemInfo={systemInfo}
                presetPort={presetPort}
                threadsForPreset={threadsForPreset}
              />
            </div>
            <div
              aria-labelledby="settings-advanced-tab"
              className="settings-content"
              hidden={activeSection !== "advanced"}
              id="settings-advanced"
              role="tabpanel"
            >
              <AdvancedSettingsSection
                draftConfig={draftConfig}
                hardwareReady={hardwareReady}
                markPoolAsCustom={() => setSelectedPoolPreset("custom")}
                setDraftConfig={setDraftConfig}
                systemInfo={systemInfo}
                threadsForPreset={threadsForPreset}
              />
            </div>
          </div>
        </div>

        <div className="panel-actions">
          <span>CPU-only settings are applied before mining starts.</span>
          <button className="confirm-button" onClick={() => void saveSettings()} type="button">SAVE</button>
        </div>
      </div>
    </section>
  );
}

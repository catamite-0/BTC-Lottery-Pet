import type { Dispatch, SetStateAction } from "react";

interface CpuWarningDialogProps {
  setShowCpuWarning: Dispatch<SetStateAction<boolean>>;
  confirmCpuWarning: () => Promise<void>;
}

export default function CpuWarningDialog({
  setShowCpuWarning,
  confirmCpuWarning,
}: CpuWarningDialogProps) {
  return (
    <section
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-label="High CPU warning"
    >
      <div className="warning-card">
        <p className="eyebrow">CPU WARNING</p>
        <h2>High CPU usage</h2>
        <p>High CPU usage may heat your computer. Are you sure you want to continue?</p>
        <div className="panel-actions">
          <button
            className="secondary-button"
            onClick={() => setShowCpuWarning(false)}
            type="button"
          >
            CANCEL
          </button>
          <button
            className="confirm-button"
            onClick={() => void confirmCpuWarning()}
            type="button"
          >
            CONTINUE
          </button>
        </div>
      </div>
    </section>
  );
}

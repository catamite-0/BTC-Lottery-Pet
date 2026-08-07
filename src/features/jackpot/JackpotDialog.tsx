import { jackpotPhaseLabel } from "../../domain/jackpotSequence";
import type { JackpotSequenceSnapshot } from "../../domain/jackpotSequence";
import type { BlockFoundEvent } from "../../contracts/mining";

interface JackpotDialogProps {
  jackpotSequence: JackpotSequenceSnapshot;
  jackpotBlock: BlockFoundEvent;
  formatDifficulty: (difficulty: number) => string;
  openLogs: () => Promise<void>;
  dismissJackpotSequence: () => void;
}

export default function JackpotDialog({
  jackpotSequence,
  jackpotBlock,
  formatDifficulty,
  openLogs,
  dismissJackpotSequence,
}: JackpotDialogProps) {
  const submissionExplanation =
    jackpotBlock.submission_status === "accepted"
      ? "The pool accepted the Stratum submission. This is not independent Bitcoin-network confirmation."
      : jackpotBlock.submission_status === "rejected"
        ? "The pool rejected the submission. The local candidate record is preserved below."
        : "No pool confirmation was received. Do not assume the submission was accepted or rejected.";

  return (
    <section
      className="overlay jackpot-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Block candidate found"
    >
      <div className="jackpot-particles" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="warning-card jackpot-card">
        <p className="eyebrow">{jackpotPhaseLabel(jackpotSequence.phase)}</p>
        <h2>JACKPOT</h2>
        <p>
          Pool submission: <strong>{jackpotBlock.submission_status.toUpperCase()}</strong>
          {jackpotBlock.submission_message ? ` — ${jackpotBlock.submission_message}` : ""}
        </p>
        <p>{submissionExplanation}</p>
        {jackpotBlock.record_saved && jackpotBlock.record_file ? (
          <p>
            Network target met. The candidate was saved as <code>{jackpotBlock.record_file}</code>{" "}
            in the app log folder.
          </p>
        ) : (
          <p role="alert">
            Network target met, but the local candidate record could not be saved. Keep this dialog
            open and copy the details below.
          </p>
        )}
        <dl>
          <div>
            <dt>Job</dt>
            <dd>{jackpotBlock.job_id}</dd>
          </div>
          <div>
            <dt>Nonce</dt>
            <dd>{jackpotBlock.nonce}</dd>
          </div>
          <div>
            <dt>Pool</dt>
            <dd>{jackpotBlock.pool}</dd>
          </div>
          <div>
            <dt>Difficulty</dt>
            <dd>{formatDifficulty(jackpotBlock.difficulty)}</dd>
          </div>
          <div>
            <dt>Timestamp</dt>
            <dd title={jackpotBlock.timestamp}>{jackpotBlock.timestamp}</dd>
          </div>
          <div>
            <dt>Hash</dt>
            <dd title={jackpotBlock.hash}>{jackpotBlock.hash}</dd>
          </div>
        </dl>
        <div className="panel-actions">
          <button className="secondary-button" onClick={() => void openLogs()} type="button">
            OPEN LOGS
          </button>
          <button className="confirm-button" onClick={dismissJackpotSequence} type="button">
            DISMISS
          </button>
        </div>
      </div>
    </section>
  );
}

import { jackpotPhaseLabel } from "../../domain/jackpotSequence";
import type { JackpotSequenceSnapshot } from "../../domain/jackpotSequence";
import type { BlockFoundEvent } from "../../miningLogic";

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
          Network target met. The candidate was saved to a timestamped found_block_*.json file in
          the app log folder.
        </p>
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

mod protocol;
mod state;

pub use protocol::{
    handle_server_message_with_callbacks, handle_server_message_with_logger, pool_response_error,
    read_stratum_line, validate_share_difficulty, write_message, ProtocolEvent, ProtocolState,
    MAX_STRATUM_LINE_BYTES,
};
pub use state::{
    share_matches_current_job, share_matches_valid_previous_job, should_submit_share,
    BestDifficultyTracker, JobTemplate, MiningStats, PendingShareSubmission,
    PendingShareSubmissions, ShareSubmission, SharedMiningState, ValidPreviousJob,
};

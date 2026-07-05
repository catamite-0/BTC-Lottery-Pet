mod protocol;
mod state;

pub use protocol::{
    diagnostic_authorize_result, diagnostic_subscribe_result, handle_server_message_with_callbacks,
    handle_server_message_with_logger, pool_response_error, read_stratum_line,
    read_until_diagnostic_message, validate_share_difficulty, wait_for_diagnostic_job,
    write_message, ProtocolEvent, ProtocolState, MAX_STRATUM_LINE_BYTES,
};
pub use state::{
    share_matches_current_job, share_matches_valid_previous_job, should_submit_share, JobTemplate,
    BestDifficultyTracker, MiningStats, ShareSubmission, SharedMiningState, ValidPreviousJob,
};

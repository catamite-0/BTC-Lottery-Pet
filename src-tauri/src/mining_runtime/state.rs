#[cfg(test)]
pub(crate) use btc_mining_core::{share_matches_current_job, share_matches_valid_previous_job};
pub(crate) use btc_mining_core::{
    should_submit_share, JobTemplate, PendingShareSubmission, PendingShareSubmissions,
    ShareSubmission, SharedMiningState,
};

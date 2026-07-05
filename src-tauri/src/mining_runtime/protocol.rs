pub(crate) use btc_mining_core::{
    diagnostic_authorize_result, diagnostic_subscribe_result, handle_server_message_with_callbacks,
    read_stratum_line, read_until_diagnostic_message, wait_for_diagnostic_job, write_message,
    ProtocolEvent, ProtocolState,
};
#[cfg(test)]
pub(crate) use btc_mining_core::{
    handle_server_message_with_logger, pool_response_error, validate_share_difficulty,
    MAX_STRATUM_LINE_BYTES,
};

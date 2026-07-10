pub(crate) use btc_mining_core::{
    handle_server_message_with_callbacks, read_stratum_line, write_message, ProtocolEvent,
    ProtocolState,
};
#[cfg(test)]
pub(crate) use btc_mining_core::{
    handle_server_message_with_logger, pool_response_error, validate_share_difficulty,
    MAX_STRATUM_LINE_BYTES,
};

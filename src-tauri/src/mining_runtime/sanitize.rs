use crate::mining_protocol::ProtocolEvent;

pub(crate) const MAX_POOL_TEXT_CHARS: usize = 512;
pub(crate) const MIN_REDACTED_SECRET_CHARS: usize = 4;

pub(crate) fn sanitize_pool_text(message: &str, secrets: [&str; 3]) -> String {
    let mut cleaned = message
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();

    for (index, secret) in secrets.into_iter().enumerate() {
        let is_pool_password = index == 2;
        if !secret.is_empty()
            && (is_pool_password || secret.chars().count() >= MIN_REDACTED_SECRET_CHARS)
        {
            cleaned = cleaned.replace(secret, "[redacted]");
        }
    }

    let mut characters = cleaned.chars();
    let mut bounded = characters
        .by_ref()
        .take(MAX_POOL_TEXT_CHARS)
        .collect::<String>();
    if characters.next().is_some() {
        bounded.push('…');
    }
    bounded
}

pub(crate) fn sanitize_protocol_event(event: ProtocolEvent, secrets: [&str; 3]) -> ProtocolEvent {
    match event {
        ProtocolEvent::ConnectionStatusChanged { status, message } => {
            ProtocolEvent::ConnectionStatusChanged {
                status,
                message: sanitize_pool_text(&message, secrets),
            }
        }
        ProtocolEvent::JobReceived { job_id, message } => ProtocolEvent::JobReceived {
            job_id: sanitize_pool_text(&job_id, secrets),
            message: sanitize_pool_text(&message, secrets),
        },
        ProtocolEvent::ShareAccepted {
            request_id,
            message,
        } => ProtocolEvent::ShareAccepted {
            request_id,
            message: sanitize_pool_text(&message, secrets),
        },
        ProtocolEvent::ShareRejected {
            request_id,
            message,
        } => ProtocolEvent::ShareRejected {
            request_id,
            message: sanitize_pool_text(&message, secrets),
        },
    }
}

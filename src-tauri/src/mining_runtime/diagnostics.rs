use std::{
    io::BufReader,
    net::ToSocketAddrs,
    time::{Duration, Instant},
};

use serde_json::{json, Value};

use crate::mining_connection::connect_to_pool;
use crate::mining_protocol::{
    diagnostic_authorize_result, diagnostic_subscribe_result, read_until_diagnostic_message,
    wait_for_diagnostic_job, write_message, ProtocolState,
};
use crate::mining_settings::{PoolDiagnosticReport, PoolDiagnosticSettings, PoolDiagnosticStep};

const DIAGNOSTIC_READ_TIMEOUT: Duration = Duration::from_millis(250);
const DIAGNOSTIC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(8);
const DIAGNOSTIC_JOB_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) fn diagnose_pool_connection(settings: PoolDiagnosticSettings) -> PoolDiagnosticReport {
    let settings = settings.normalized();
    let pool = format!("{}:{}", settings.pool_host, settings.pool_port);
    let mut report = PoolDiagnosticReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        pool: pool.clone(),
        steps: Vec::new(),
        summary: String::new(),
    };

    let validate_start = Instant::now();
    if let Err(error) = settings.validate_basic() {
        report.steps.push(diagnostic_step(
            "CONFIG",
            "failed",
            error.clone(),
            validate_start.elapsed(),
        ));
        report.summary = format!("Configuration check failed: {error}");
        return report;
    }
    report.steps.push(diagnostic_step(
        "CONFIG",
        "ok",
        "Local pool settings look valid.",
        validate_start.elapsed(),
    ));

    let dns_start = Instant::now();
    let socket_addresses = match pool.to_socket_addrs() {
        Ok(addresses) => addresses.collect::<Vec<_>>(),
        Err(error) => {
            report.steps.push(diagnostic_step(
                "DNS",
                "failed",
                format!("DNS failed for {}: {error}", settings.pool_host),
                dns_start.elapsed(),
            ));
            report.summary = "DNS lookup failed for the configured pool.".into();
            return report;
        }
    };
    if socket_addresses.is_empty() {
        report.steps.push(diagnostic_step(
            "DNS",
            "failed",
            format!("No address found for {}", settings.pool_host),
            dns_start.elapsed(),
        ));
        report.summary = "DNS lookup returned no usable address.".into();
        return report;
    }
    report.steps.push(diagnostic_step(
        "DNS",
        "ok",
        format!("Resolved {} address(es).", socket_addresses.len()),
        dns_start.elapsed(),
    ));

    let tcp_start = Instant::now();
    let mut stream = match connect_to_pool(&pool, &socket_addresses) {
        Ok(stream) => stream,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "TCP",
                "failed",
                error.clone(),
                tcp_start.elapsed(),
            ));
            report.summary =
                "TCP connection failed. Check the pool port, firewall, or network.".into();
            return report;
        }
    };
    if let Err(error) = stream.set_read_timeout(Some(DIAGNOSTIC_READ_TIMEOUT)) {
        report.steps.push(diagnostic_step(
            "TCP",
            "failed",
            format!("Connected, but failed to set socket read timeout: {error}"),
            tcp_start.elapsed(),
        ));
        report.summary = "TCP connection setup failed after connecting.".into();
        return report;
    }
    if let Err(error) = stream.set_write_timeout(Some(Duration::from_secs(2))) {
        report.steps.push(diagnostic_step(
            "TCP",
            "failed",
            format!("Connected, but failed to set socket write timeout: {error}"),
            tcp_start.elapsed(),
        ));
        report.summary = "TCP connection setup failed after connecting.".into();
        return report;
    }
    let reader_stream = match stream.try_clone() {
        Ok(stream) => stream,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "TCP",
                "failed",
                format!("Connected, but failed to initialize socket reader: {error}"),
                tcp_start.elapsed(),
            ));
            report.summary = "TCP connection setup failed after connecting.".into();
            return report;
        }
    };
    let mut reader = BufReader::new(reader_stream);
    report.steps.push(diagnostic_step(
        "TCP",
        "ok",
        "Connected to the pool TCP endpoint.",
        tcp_start.elapsed(),
    ));

    let subscribe_start = Instant::now();
    if let Err(error) = write_message(
        &mut stream,
        &json!({
            "id": 1,
            "method": "mining.subscribe",
            "params": [format!("BTC Lottery Pet/{}", env!("CARGO_PKG_VERSION"))]
        }),
    ) {
        report.steps.push(diagnostic_step(
            "SUBSCRIBE",
            "failed",
            error.clone(),
            subscribe_start.elapsed(),
        ));
        report.summary = "Could not send mining.subscribe to the pool.".into();
        return report;
    }
    let subscribe_message =
        match read_until_diagnostic_message(&mut reader, DIAGNOSTIC_RESPONSE_TIMEOUT, |message| {
            message.get("id").and_then(Value::as_u64) == Some(1)
        }) {
            Ok(message) => message,
            Err(error) => {
                report.steps.push(diagnostic_step(
                    "SUBSCRIBE",
                    "failed",
                    error.clone(),
                    subscribe_start.elapsed(),
                ));
                report.summary = "The pool did not complete mining.subscribe.".into();
                return report;
            }
        };
    let (extranonce1, extranonce2_size) = match diagnostic_subscribe_result(&subscribe_message) {
        Ok(result) => result,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "SUBSCRIBE",
                "failed",
                error.clone(),
                subscribe_start.elapsed(),
            ));
            report.summary = error;
            return report;
        }
    };
    report.steps.push(diagnostic_step(
        "SUBSCRIBE",
        "ok",
        "Pool accepted mining.subscribe.",
        subscribe_start.elapsed(),
    ));

    if settings.btc_address.is_empty() {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "skipped",
            "Add a BTC address to test mining.authorize.",
            Duration::ZERO,
        ));
        report.steps.push(diagnostic_step(
            "JOB",
            "skipped",
            "Authorization was skipped, so job delivery was not tested.",
            Duration::ZERO,
        ));
        report.summary = "Network and subscribe checks passed. Add a BTC address to test authorization and job delivery.".into();
        return report;
    }

    let authorize_start = Instant::now();
    if let Err(error) = write_message(
        &mut stream,
        &json!({
            "id": 2,
            "method": "mining.authorize",
            "params": [settings.username(), settings.pool_password()]
        }),
    ) {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "failed",
            error.clone(),
            authorize_start.elapsed(),
        ));
        report.summary = "Could not send mining.authorize to the pool.".into();
        return report;
    }
    let authorize_message =
        match read_until_diagnostic_message(&mut reader, DIAGNOSTIC_RESPONSE_TIMEOUT, |message| {
            message.get("id").and_then(Value::as_u64) == Some(2)
        }) {
            Ok(message) => message,
            Err(error) => {
                report.steps.push(diagnostic_step(
                    "AUTHORIZE",
                    "failed",
                    error.clone(),
                    authorize_start.elapsed(),
                ));
                report.summary = "The pool did not complete mining.authorize.".into();
                return report;
            }
        };
    if let Err(error) = diagnostic_authorize_result(&authorize_message) {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "failed",
            error.clone(),
            authorize_start.elapsed(),
        ));
        report.summary = error;
        return report;
    }
    report.steps.push(diagnostic_step(
        "AUTHORIZE",
        "ok",
        "Pool accepted the configured worker.",
        authorize_start.elapsed(),
    ));

    let job_start = Instant::now();
    let mut protocol = ProtocolState {
        difficulty: 0.001,
        extranonce1: Some(extranonce1),
        extranonce2_size: Some(extranonce2_size),
    };
    match wait_for_diagnostic_job(&mut reader, &mut protocol, DIAGNOSTIC_JOB_TIMEOUT) {
        Ok((job_id, share_difficulty)) => {
            report.steps.push(diagnostic_step(
                "JOB",
                "ok",
                format!(
                    "Received mining.notify job {job_id} at share difficulty {share_difficulty}."
                ),
                job_start.elapsed(),
            ));
            report.summary = "Pool connection diagnostic passed.".into();
        }
        Err(error) => {
            report.steps.push(diagnostic_step(
                "JOB",
                "failed",
                error.clone(),
                job_start.elapsed(),
            ));
            report.summary = "Authorization passed, but no mining job was received.".into();
        }
    }

    report
}

fn diagnostic_step(
    name: &str,
    status: &str,
    message: impl Into<String>,
    duration: Duration,
) -> PoolDiagnosticStep {
    PoolDiagnosticStep {
        name: name.to_owned(),
        status: status.to_owned(),
        message: message.into(),
        duration_ms: duration.as_millis().min(u64::MAX as u128) as u64,
    }
}

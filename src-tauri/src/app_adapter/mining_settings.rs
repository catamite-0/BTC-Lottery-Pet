use std::{str::FromStr, thread};

use bitcoin::{Address, Network};
pub use btc_hash_core::CpuKernelMode;
pub use btc_mining_core::MiningStats;
use serde::{Deserialize, Serialize};

const DEFAULT_POOL_PASSWORD: &str = "x";
const MAX_POOL_PASSWORD_BYTES: usize = 128;

pub(crate) fn selected_cpu_kernel_mode() -> CpuKernelMode {
    CpuKernelMode::Midstate
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealMiningSettings {
    pub pool_host: String,
    pub pool_port: u16,
    #[serde(default)]
    pub pool_password: String,
    pub btc_address: String,
    pub worker_name: String,
    pub cpu_threads: usize,
    pub confirmed_cpu_use: bool,
}

impl RealMiningSettings {
    pub(crate) fn validate(&self) -> Result<(), String> {
        if !self.confirmed_cpu_use {
            return Err("real mining requires an explicit CPU-use confirmation".into());
        }

        if self.pool_host.is_empty()
            || self.pool_host.chars().any(char::is_whitespace)
            || self.pool_host.contains("://")
            || self.pool_host.contains('/')
        {
            return Err("pool host must be a hostname without a URL scheme or path".into());
        }

        if self.pool_port == 0 {
            return Err("pool port must be greater than zero".into());
        }

        validate_pool_password(&self.pool_password)?;
        validate_mainnet_address(self.btc_address.trim())?;

        if self.worker_name.is_empty()
            || self
                .worker_name
                .chars()
                .any(|character| !(character.is_ascii_alphanumeric() || "-_".contains(character)))
        {
            return Err(
                "worker name may contain only letters, numbers, dashes, and underscores".into(),
            );
        }

        let available_threads = thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);

        if self.cpu_threads > available_threads {
            return Err(format!(
                "CPU threads must be between 1 and {available_threads} on this computer"
            ));
        }
        if self.cpu_threads == 0 {
            return Err("CPU threads must be at least 1".into());
        }

        Ok(())
    }

    pub(crate) fn username(&self) -> String {
        format!("{}.{}", self.btc_address.trim(), self.worker_name)
    }

    pub(crate) fn pool_password(&self) -> String {
        normalize_pool_password(&self.pool_password)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolDiagnosticSettings {
    pub pool_host: String,
    pub pool_port: u16,
    #[serde(default)]
    pub pool_password: String,
    pub btc_address: String,
    pub worker_name: String,
}

impl PoolDiagnosticSettings {
    pub(crate) fn normalized(&self) -> Self {
        Self {
            pool_host: self.pool_host.trim().to_owned(),
            pool_port: self.pool_port,
            pool_password: normalize_pool_password(&self.pool_password),
            btc_address: self.btc_address.trim().to_owned(),
            worker_name: self.worker_name.trim().to_owned(),
        }
    }

    pub(crate) fn validate_basic(&self) -> Result<(), String> {
        if self.pool_host.is_empty()
            || self.pool_host.chars().any(char::is_whitespace)
            || self.pool_host.contains("://")
            || self.pool_host.contains('/')
        {
            return Err("pool host must be a hostname without a URL scheme or path".into());
        }

        if self.pool_port == 0 {
            return Err("pool port must be greater than zero".into());
        }

        validate_pool_password(&self.pool_password)?;

        if !self.btc_address.is_empty() {
            validate_mainnet_address(&self.btc_address)?;
        }

        if self.worker_name.is_empty()
            || self
                .worker_name
                .chars()
                .any(|character| !(character.is_ascii_alphanumeric() || "-_".contains(character)))
        {
            return Err(
                "worker name may contain only letters, numbers, dashes, and underscores".into(),
            );
        }

        Ok(())
    }

    pub(crate) fn username(&self) -> String {
        format!("{}.{}", self.btc_address, self.worker_name)
    }

    pub(crate) fn pool_password(&self) -> String {
        normalize_pool_password(&self.pool_password)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PoolDiagnosticStep {
    pub name: String,
    pub status: String,
    pub message: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PoolDiagnosticReport {
    pub generated_at: String,
    pub pool: String,
    pub steps: Vec<PoolDiagnosticStep>,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct FoundBlockEvent {
    pub job_id: String,
    pub nonce: String,
    pub ntime: String,
    pub extranonce2: String,
    pub hash: String,
    pub difficulty: f64,
    pub timestamp: String,
    pub pool: String,
}

fn normalize_pool_password(password: &str) -> String {
    let trimmed = password.trim();
    if trimmed.is_empty() {
        DEFAULT_POOL_PASSWORD.into()
    } else {
        trimmed.to_owned()
    }
}

fn validate_pool_password(password: &str) -> Result<(), String> {
    let normalized = normalize_pool_password(password);
    if normalized.len() > MAX_POOL_PASSWORD_BYTES {
        return Err(format!(
            "pool password must be {MAX_POOL_PASSWORD_BYTES} bytes or fewer"
        ));
    }

    if normalized.chars().any(char::is_control) {
        return Err("pool password cannot contain control characters".into());
    }

    Ok(())
}

pub(crate) fn validate_mainnet_address(value: &str) -> Result<(), String> {
    Address::from_str(value)
        .map_err(|error| format!("invalid BTC address format: {error}"))?
        .require_network(Network::Bitcoin)
        .map_err(|_| "address is not a Bitcoin mainnet address".to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_mining_settings_leave_cpu_kernel_to_backend() {
        let settings: RealMiningSettings = serde_json::from_value(serde_json::json!({
            "poolHost": "public-pool.io",
            "poolPort": 3333,
            "poolPassword": "x",
            "btcAddress": "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
            "workerName": "desk_1",
            "cpuThreads": 1,
            "confirmedCpuUse": true
        }))
        .expect("settings should deserialize without frontend algorithm fields");

        assert_eq!(settings.cpu_threads, 1);
        assert_eq!(selected_cpu_kernel_mode(), CpuKernelMode::Midstate);
    }
}

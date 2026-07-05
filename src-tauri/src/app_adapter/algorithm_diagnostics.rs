use serde::Serialize;

pub(crate) const DIAGNOSTIC_SCHEMA_VERSION: u32 = 3;

const DIAGNOSTIC_MIDSTATE_BENCHMARK_NONCES: u32 = 2048;
const DIAGNOSTIC_MIDSTATE_BENCHMARK_HEADER_HEX: &str = "0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c";

#[derive(Clone, Debug, Serialize)]
pub(crate) struct AlgorithmKernelBenchmark {
    pub(crate) status: String,
    pub(crate) nonce_count: u64,
    pub(crate) full_header_hashrate: f64,
    pub(crate) midstate_hashrate: f64,
    pub(crate) speedup_ratio: f64,
    pub(crate) full_header_duration_micros: u128,
    pub(crate) midstate_duration_micros: u128,
    pub(crate) checksum_hex: String,
    pub(crate) note: String,
}

pub(crate) fn diagnostic_algorithm_kernel_benchmark() -> AlgorithmKernelBenchmark {
    let header = match hex::decode(DIAGNOSTIC_MIDSTATE_BENCHMARK_HEADER_HEX) {
        Ok(header) => header,
        Err(error) => {
            return failed_algorithm_kernel_benchmark(format!(
                "benchmark header decode failed: {error}"
            ))
        }
    };

    match crate::mining_hash::benchmark_header_hash_paths(
        &header,
        DIAGNOSTIC_MIDSTATE_BENCHMARK_NONCES,
    )
    {
        Ok(benchmark) => AlgorithmKernelBenchmark {
            status: "ok".into(),
            nonce_count: benchmark.nonce_count,
            full_header_hashrate: benchmark.full_header_hashrate,
            midstate_hashrate: benchmark.midstate_hashrate,
            speedup_ratio: benchmark.speedup_ratio,
            full_header_duration_micros: benchmark.full_header_duration_micros,
            midstate_duration_micros: benchmark.midstate_duration_micros,
            checksum_hex: format!("{:016x}", benchmark.checksum),
            note: "Fixed-window CPU benchmark; speedup ratio is local machine evidence, not a consensus shortcut.".into(),
        },
        Err(error) => failed_algorithm_kernel_benchmark(error),
    }
}

fn failed_algorithm_kernel_benchmark(error: String) -> AlgorithmKernelBenchmark {
    AlgorithmKernelBenchmark {
        status: "error".into(),
        nonce_count: DIAGNOSTIC_MIDSTATE_BENCHMARK_NONCES as u64,
        full_header_hashrate: 0.0,
        midstate_hashrate: 0.0,
        speedup_ratio: 0.0,
        full_header_duration_micros: 0,
        midstate_duration_micros: 0,
        checksum_hex: String::new(),
        note: error,
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum CpuKernelMode {
    #[default]
    Midstate,
    FullHeader,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeaderWork {
    pub midstate: [u32; 8],
    pub tail: [u32; 3],
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HeaderHashBenchmark {
    pub nonce_count: u64,
    pub full_header_duration_micros: u128,
    pub midstate_duration_micros: u128,
    pub full_header_hashrate: f64,
    pub midstate_hashrate: f64,
    pub speedup_ratio: f64,
    pub checksum: u64,
}

pub trait HashEngine {
    fn hash_words(&mut self, work: &HeaderWork, nonce: u32) -> [u32; 8];
}

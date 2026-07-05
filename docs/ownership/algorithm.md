# Algorithm Ownership

Use this scope for hash correctness, target math, nonce scanning primitives, and CPU benchmark evidence.

Primary paths:

- `src-tauri/crates/btc-hash-core`
- `src-tauri/crates/btc-hash-cpu`
- `src-tauri/src/mining_runtime/kernel.rs`
- Algorithm benchmark fixtures or tests that only validate hash output

Allowed changes:

- HashEngine-facing types and CPU hash implementations
- SHA-256d, midstate, target comparison, nbits, and difficulty math
- CPU benchmark windows and checksum validation

Avoid changing:

- Tauri command contracts
- Stratum connection flow
- React UI components

Required checks:

- `cargo test --manifest-path src-tauri/Cargo.toml -p btc-hash-cpu`
- `cargo test --manifest-path src-tauri/Cargo.toml`

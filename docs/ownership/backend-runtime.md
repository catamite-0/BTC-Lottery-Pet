# Backend Runtime Ownership

Use this scope for Stratum runtime behavior, worker orchestration, logging, and share submission.

Primary paths:

- `src-tauri/crates/btc-mining-core`
- `src-tauri/src/mining_runtime` (`controller`, `stratum_session`, `submissions`, `sanitize`, `workers`, …)
- `src-tauri/src/app_adapter/mining_settings.rs`

Allowed changes:

- Pool connection, Stratum protocol handling, and job state
- CPU worker scheduling and share queue behavior
- Mining logs, found-block persistence, and runtime event emission
- Settings validation that directly affects backend execution

Avoid changing:

- Hash compression internals except through `btc-hash-*`
- React UI layout and styles
- Frontend-only view models unless the runtime contract changes

Required checks:

- `cargo test --manifest-path src-tauri/Cargo.toml`
- `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`

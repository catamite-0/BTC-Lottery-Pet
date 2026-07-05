# Integration Contracts Ownership

Use this scope when frontend and backend payloads, diagnostics, or startup configuration need to change together.

Primary paths:

- `src/contracts`
- `src/platform/tauri`
- `src/app`
- `src/hooks`
- `src-tauri/src/app_adapter`
- `src-tauri/src/lib.rs`

Allowed changes:

- Tauri command request and response shapes
- Diagnostic snapshot schema and frontend diagnostic sections
- Startup config loading, normalization, and app shell wiring
- Cross-layer tests that prove React and Rust agree on contracts

Avoid changing:

- Hash internals without algorithm ownership
- Stratum runtime policy without backend runtime ownership
- Pure visual redesigns without frontend UI ownership

Required checks:

- `npm run test:frontend`
- `npm run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`

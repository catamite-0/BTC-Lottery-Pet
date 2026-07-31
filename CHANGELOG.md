# Changelog

## 0.9.0 - Unreleased

### Changed

- Narrowed the application to explicitly confirmed local CPU mining with the
  optimized reusable-midstate SHA-256d kernel as the only production hash path.
- Made `src-tauri` a Cargo workspace so tests and Clippy cover the app plus the
  `btc-hash-core`, `btc-hash-cpu`, and `btc-mining-core` crates.
- Added disk-only config schema versioning. Legacy 0.8 configurations are
  backed up once before removed fields are migrated out of the active config.
- Preserved the effective CPU thread count of legacy Normal and Turbo settings
  by converting every legacy preset to Custom with its stored count.
- Updated application and installer metadata to `0.9.0`; local and CI gates now
  reject application, changelog, or tag mismatches and generate a SHA-256 file
  alongside the Windows installer.
- Made Settings tabs size themselves from the actual tab count and use a 2x2
  layout in the narrow default window.
- Added a Codex cloud setup and portable verification path with repository
  instructions and pinned Node/Rust toolchains.
- Split read-only pull-request CI from Windows installer production. Tagged
  builds now verify and attest one immutable artifact before creating a draft
  GitHub Release for manual smoke-test approval.

### Removed

- Removed pool diagnostics, diagnostic snapshot export, webhook and heartbeat
  notifications, runtime algorithm recommendations, and the unused full-header
  hash path. Local Windows notifications and block-candidate records remain.
- Removed extra pet profiles from the current prototype and dropped the unused
  `ureq` network dependency.

### Hardened

- Preserved partial Stratum messages across socket timeouts, enforced a
  cumulative 64 KiB cap and five-second absolute deadline, and returned to the
  STOP-aware loop after every incremental socket read.
- Refused to overwrite a config written by a newer schema, and required a
  successful local backup before replacing a broken or legacy config.
- Kept deterministic equivalence coverage between the optimized midstate path
  and standard double SHA-256 across nonce windows and mutated headers.
- Locked local and CI Rust verification to the checked-in workspace lock file.
- Pinned every third-party GitHub Action to a full commit SHA and limited
  release write permission to the final draft-release job.

### Validation

- `npm run check:version`
- `npm audit --omit=dev`
- `npm run test:frontend`
- `npm run build`
- `npm run verify:cloud`
- `cargo test --locked --workspace --manifest-path src-tauri\Cargo.toml`
- `cargo clippy --locked --workspace --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`
- `.\scripts\verify.ps1 -Strict -BuildInstaller`

## 0.8.0 - 2026-07-03

### Changed

- Reworked the settings panel into navigable sections with a fixed
  header/action area and safer small-window scrolling.
- Moved mining engine selection behind a frontend controller hook so `App` no
  longer creates concrete engines directly.
- Split backend hash benchmark diagnostics into a dedicated Rust module while
  keeping Tauri command protocols stable.
- Simplified frontend test execution to auto-discover `test/*.test.mjs` files.

### Hardened

- Preserved local mining behavior: consensus double SHA-256, Stratum flow,
  nonce handling, and share submission remain unchanged.

### Validation

- `npm run test:frontend`
- `npm run build`
- `npm audit --omit=dev`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `cargo test --manifest-path src-tauri\Cargo.toml --no-run`

## 0.7.0 - 2026-06-13

### Added

- GitHub Actions quality gate for frontend tests, frontend build, Rust tests,
  Rust Clippy, and production dependency audit.
- Manual Windows installer artifact workflow for `v*` tags and explicit
  workflow dispatches.
- Release checklist covering installer, browser preview, real mining,
  notification, and diagnostic privacy smoke checks.
- Frontend mining logic tests for config normalization, start validation,
  preset ports, CPU preset bounds, and hashrate formatting.
- Sanitized diagnostic snapshot export with schema version, redaction metadata,
  recent log redaction, and `SAVE DIAG` file output.
- Local mock Stratum pool coverage for subscribe, authorize, job delivery,
  accepted shares, and rejected shares.
- Protocol tests for malformed Stratum JSON, subscribe rejection, authorize
  rejection, and unknown response IDs.

### Changed

- Migrated built-in public pool defaults to `public-pool.io:3333`.

### Hardened

- Real mining rejects pathological share difficulties that would make every
  nonce qualify.
- Pool rejection reasons are surfaced in logs for accepted/rejected share
  accounting and authorization failures.
- Windows notification AppID handling avoids leaking webhook URLs in failure
  logs or payloads.
- Detail diagnostics intentionally exclude BTC address and webhook URL.

### Validation

- `npm run test:frontend`
- `npm run build`
- `cargo test --manifest-path src-tauri\Cargo.toml`
- `cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings`
- `npm audit --omit=dev`
- `npm run tauri:build`

# Changelog

## Unreleased

### Changed

- Narrowed the project to the desktop pet plus explicitly confirmed real CPU
  mining.
- Removed non-CPU compute paths, remote hash planning layers, related settings,
  diagnostics, tests, dependencies, and stale documentation.
- Simplified settings into pet, device summary, pool/CPU runtime, diagnostics,
  and save/reset flows.
- Replaced the previous algorithm evidence dashboard with a small CPU runtime
  snapshot focused on configured threads, observed rate, shares, and active
  hash route.
- Refined Dashboard and Settings presentation with grouped metric panels,
  sentence-case controls, segmented CPU presets, checkbox notification toggles,
  and in-settings pet previews.
- Clarified release documentation for browser preview limits, desktop-only pool
  diagnostics, diagnostic copy/save formats, release-gating commands, and the
  current CPU-only limitation set.

### Hardened

- Real mining command payloads now carry only CPU worker settings and pool
  configuration.
- Backend diagnostics no longer expose removed compute device fields.
- Legacy config keys for removed compute paths are ignored instead of surfaced
  back into active UI or command DTOs.
- CPU hash tests now cover the specialized 80-byte full-header path, midstate
  equivalence, compact `nbits` edge cases, target word comparisons, and
  benchmark window validation.
- Stratum parsing validates job hex fields before worker dispatch and surfaces
  invalid active jobs through logs and an `Invalid Pool Job` runtime event.
- Share submission tracking now records job/nonce metadata, expires unanswered
  submissions after 30 seconds, drains old queued shares on reconnect, and logs
  queue-full drops without unbounded pending state.
- Mining logs are session-scoped on the frontend so stale session log payloads
  are ignored after a newer start.
- Diagnostic save bundles preserve structured frontend `bodyJson` data and can
  include the current frontend dev log.

### Validation

- `npm run test:frontend`
- `npm run build`
- `cargo test --manifest-path src-tauri\Cargo.toml`

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

# CPU-Only Refactor Plan (Historical)

This document records the refactor work that led through the 0.8 series; it is
not the current product or release source of truth. Use `README.md`,
`RELEASE_CHECKLIST.md`, and the current code for 0.9 behavior.

The project remains explicitly confirmed local CPU mining only. References
below to diagnostic export, pool diagnostics, the full-header runtime route,
`TEST POOL`, `COPY DIAG`, or `SAVE DIAG` describe removed pre-0.9 behavior and
must not be treated as active requirements.

## Current Baseline

- Frontend helper tests pass.
- Frontend production build passes.
- Rust mining tests pass.
- Runtime configuration is CPU-only: pool settings, notification settings,
  pet profile, CPU preset, and CPU thread count.
- The Tauri command surface no longer exposes device enumeration or benchmark
  commands for removed compute paths.
- The frontend has one engine path for CPU mining through the Rust backend.
- Real CPU mining events are session-scoped. The frontend ignores stale
  session payloads and session-scoped `mining-log` payloads, and treats
  structured `mining-event` payloads, not log text, as the authoritative runtime
  state source.
- Diagnostics now export app metadata, sanitized config, a CPU kernel benchmark,
  log path, recent log lines, latest connection error, and frontend CPU runtime
  summary. `COPY DIAG` is clipboard troubleshooting text; `SAVE DIAG` writes a
  JSON snapshot or bundle that can include the frontend dev log.

## Completed Scope Narrowing

- Removed inactive backend modules, kernels, dependencies, commands, settings,
  diagnostics, and tests that did not serve the local CPU runtime.
- Removed stale adapter models, dry-run validators, telemetry gates,
  acquisition planning, operating policy layers, and their tests.
- Replaced algorithm dashboard evidence chains with a small CPU runtime
  snapshot that reports configured threads, observed hashrate per thread,
  shares, and active hash route.
- Simplified settings to pet, device summary, pool/CPU runtime, diagnostics,
  and save/reset actions.
- Deleted stale planning docs that pushed future threads back toward removed
  compute routes.
- Added backend session ids, joined stop/start lifecycle handling, structured
  runtime events, and stale-session filtering in the frontend.
- Added CPU hash hardening around the specialized 80-byte full-header path,
  midstate equivalence, compact `nbits` expansion, target word comparison, and
  benchmark window validation.
- Added Stratum/job hardening for hex field validation, invalid active job
  discard events, pending share expiration, reconnect queue draining, and
  queue-full drop logging.
- Reworked Dashboard and Settings presentation into denser grouped panels,
  segmented CPU presets, notification toggles, and pet previews.

## Architecture Boundaries

Frontend:

```text
src/
  app/                  app defaults, dashboard view models, and shell layout
  app/shell/            window shell, header, and top-level UI composition
  features/dashboard/   dashboard and compact widget presentation
  features/settings/    settings panel and focused settings sections
  features/pet/         pet display presentation
  features/mining/      mining-specific UI prompts
  features/jackpot/     block-candidate dialog
  contracts/            DTOs and Tauri command contracts
  domain/               pure mining, pet, probability, and diagnostics helpers
  engines/              CPU mining engine facade
  hooks/                app runtime orchestration
  platform/tauri/       all Tauri invoke wrappers
  pets/                 companion copy and profile data
```

Backend:

```text
src-tauri/crates/
  btc-hash-core/        hash engine trait and shared hash work types
  btc-hash-cpu/         CPU SHA-256d, midstate, target comparison, benchmark
  btc-mining-core/      Stratum protocol, job state, share state, telemetry

src-tauri/src/
  app_adapter/          Tauri config, diagnostics, settings, notifications
  lib.rs                Tauri setup and command registration
  main.rs               native app entry point
  mining_runtime/       Tauri-facing mining session, connection, workers, logs
```

Rules:

1. UI code calls Tauri only through `src/platform/tauri`.
2. Domain modules stay pure: no Tauri, DOM, storage, timers, or network calls.
3. CPU mining starts only from explicit user action in the current session.
4. Legacy config keys for removed compute paths may be ignored while loading,
   but they must not reappear in active DTOs, UI controls, diagnostics, or
   command payloads.
5. Future optimization work targets CPU correctness, CPU throughput, startup
   simplicity, and UI clarity.
6. UI and Tauri command payloads do not choose hash algorithms. The backend
   selects the CPU kernel and reports evidence through diagnostics.

## Remaining Work Plan

### Phase 1: CPU Hot Path

Goal: improve the real mining loop without expanding compute scope.

- Continue benchmarking the `btc-hash-cpu` full-header and midstate paths with
  fixed header fixtures.
- Keep consensus double SHA-256 behavior byte-for-byte identical.
- Further reduce repeated header setup inside worker loops only where tests can
  prove the same candidate hashes.
- Add a small worker-window metric for hashrate per configured CPU thread.
- Keep all pool share submission and block-candidate behavior unchanged.

Exit criteria:

- Rust tests pass.
- Frontend tests pass.
- A before/after benchmark note is recorded in the PR or commit message.
- Hash code remains isolated in `btc-hash-core` and `btc-hash-cpu`.

### Phase 2: Backend Lifecycle Cleanup

Goal: make start/stop behavior easier to reason about before more UI work.

- Introduced an explicit mining session id in the controller state.
- `STOP` now requests shutdown and waits for the worker thread before the
  command returns.
- Older sessions no longer emit authoritative frontend status after a newer
  start because stats, runtime events, logs, and block events carry session ids.
- Pending share submissions now track job/nonce metadata, expire after 30
  seconds, and are bounded by explicit submission budgets.
- Reconnects drain old queued shares and record them as stale drops before a new
  subscribe/authorize cycle.
- Invalid pool jobs are discarded with a log line and `Invalid Pool Job` runtime
  event instead of silently clearing worker state.
- Continue shrinking `miner.rs` toward command orchestration only.
- Keep protocol parsing, job state, share state, and telemetry in
  `btc-mining-core`.

Exit criteria:

- Repeated START/STOP tests cover stale status, queued shares, and worker exit.
- `miner.rs` remains a thin coordinator.
- Rust tests and clippy pass.

### Phase 3: Frontend Structure Cleanup

Goal: keep future UI optimization from tangling runtime state again.

- Keep `App.tsx` as composition and wiring.
- Keep settings actions in `useSettingsActions`.
- Keep mining start/stop in `useMiningSessionControls`.
- Keep diagnostics export in `useAppDiagnosticsActions`.
- Move any large presentational blocks out of `AppShell` before changing
  layout.

Exit criteria:

- `App.tsx` and `AppShell.tsx` stay readable without hidden runtime branches.
- Settings sections remain focused and independently testable.
- Frontend build stays below the previous large-bundle warning threshold.

### Phase 4: Interface Optimization

Goal: make the desktop pet feel simpler, denser, and more trustworthy.

- Rebalance Dashboard around current CPU status, pool state, shares, best
  difficulty, uptime, and logs.
- Make Settings feel like an operational tool: compact controls, clear save
  state, no marketing copy, no dead feature placeholders.
- Improve narrow-window behavior for the settings tabs, action footer, and log
  ticker.
- Tighten color usage so states are visible without turning the interface into
  one dominant hue.
- Verify text fit in the smallest supported window.

Exit criteria:

- Browser preview renders cleanly at the supported minimum size.
- Main workflows are visible without layout overlap: start CPU mining, confirm
  high CPU usage when needed, stop, test pool, save settings, copy diagnostics.
- Frontend tests and build pass.

### Phase 5: Release Hardening

Goal: prepare a clean CPU-only release candidate.

- Run `.\scripts\verify.ps1 -Strict`.
- Build the installer with `.\scripts\verify.ps1 -Strict -BuildInstaller` or
  with `npm run tauri:build` after the strict gate has passed.
- Run the manual release checklist.
- Update `CHANGELOG.md` with validation results, installer path/size, skipped
  checks, and current CPU-only limitations.

Exit criteria:

- Automated checks pass.
- Manual smoke checks are recorded.
- README, release checklist, and code behavior describe the same product.

## Thread Ownership

Use these ownership lines when splitting future work. Detailed scopes live in
`docs/ownership/`.

| Thread | Owns | Avoids |
| --- | --- | --- |
| Algorithm | `src-tauri/crates/btc-hash-*`, hash benchmarks, target math | UI layout, Stratum runtime |
| Backend runtime | `src-tauri/crates/btc-mining-core`, `src-tauri/src/mining_runtime` | React layout, SHA internals |
| Frontend UI | `src/app/shell`, `src/features`, `src/styles.css` | Rust mining behavior |
| Integration contracts | `src/contracts`, `src/platform/tauri`, `src/hooks`, `src-tauri/src/app_adapter`, `src-tauri/src/lib.rs` | Pure visual redesigns or hash internals |
| Documentation / release check | `README.md`, `RELEASE_CHECKLIST.md`, `CHANGELOG.md`, `docs/**`, release validation notes | Product behavior code, uncoordinated runtime or UI changes |

Only one thread should edit these hotspots at a time:

- `src/App.tsx`
- `src/app/shell/AppShell.tsx`
- `src/features/settings/SettingsPanel.tsx`
- `src/styles.css`
- `src-tauri/src/mining_runtime/controller.rs`
- `src-tauri/src/mining_runtime/workers.rs`
- `src-tauri/src/lib.rs`

## Stop Conditions

Pause and re-coordinate if any future change:

- Broadens the runtime beyond explicitly confirmed local CPU mining.
- Adds a placeholder interface for inactive compute routes.
- Makes UI state depend on mining log text.
- Claims browser preview can mine, run active pool diagnostics, open logs, or
  write diagnostics.
- Treats `COPY DIAG` and `SAVE DIAG` as the same artifact format.
- Mixes behavior changes with large file moves.
- Requires two threads to edit the same hotspot file.
- Cannot be validated with the local frontend and Rust checks.

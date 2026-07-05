# Release Checklist

Use this checklist before tagging or distributing a BTC Lottery Pet release.
Automated checks catch build and protocol regressions. Manual checks cover real
desktop behavior that CI cannot safely prove.

## Automated Checks

- [ ] `.\scripts\dev-env.ps1`
- [ ] `.\scripts\verify.ps1 -Strict`
- [ ] `npm ci`
- [ ] `npm audit --omit=dev`
- [ ] `npm run test:frontend`
- [ ] `npm run build`
- [ ] `cargo test --manifest-path src-tauri\Cargo.toml`
- [ ] `cargo clippy --manifest-path src-tauri\Cargo.toml -- -D warnings`
- [ ] `npm run tauri:build`
- [ ] Confirm the NSIS installer exists under
      `src-tauri\target\release\bundle\nsis`.

GitHub Actions runs the fast checks on push and pull request. The installer
artifact job runs for `v*` tags or when the workflow is started manually with
`build_installer=true`.

## Installer Smoke

- [ ] Install the generated `BTC Lottery Pet_<version>_x64-setup.exe` on a
      clean or throwaway Windows profile.
- [ ] Launch from the Start menu.
- [ ] Confirm the packaged app does not open an extra black console window.
- [ ] Confirm the tray icon appears and `Show` restores the window.
- [ ] Confirm closing the window hides it instead of quitting the app.
- [ ] Quit from the tray menu.

## Browser Preview Smoke

- [ ] Run `npm run dev`.
- [ ] Open `http://127.0.0.1:1420`.
- [ ] Confirm the simulation UI renders with no console errors.
- [ ] Open Settings.
- [ ] Save settings with a custom worker and pool preset.
- [ ] Run `TEST POOL` without a BTC address and confirm authorize/job are
      skipped.
- [ ] Switch display modes between compact and detail.

## Real CPU Mining Smoke

Use a BTC mainnet address you control. Plain Stratum v1 is unencrypted, so do
not use a private or sensitive worker label.

- [ ] Eco preset connects to the configured pool.
- [ ] Settings `TEST POOL` passes DNS, TCP, subscribe, authorize, and job
      delivery for the selected pool.
- [ ] Real CPU mining receives a job and updates connection status to `Mining`.
- [ ] `STOP` emits a stopped stats snapshot and hash rate returns to zero.
- [ ] Repeated START/STOP cycles do not leave stale pending shares.
- [ ] Invalid pool host shows a local validation message before startup.
- [ ] Invalid worker name shows a local validation message before startup.
- [ ] Connection loss eventually enters a retrying state and logs the reason.
- [ ] Detail Mode `OPEN LOGS` opens the log folder.
- [ ] Detail Mode `COPY LOG PATH` copies the log folder path.
- [ ] Detail Mode `COPY DIAG` copies valid JSON.

## CPU Runtime Smoke

- [ ] Eco, Normal, Turbo, and Custom presets map to expected CPU thread counts.
- [ ] A custom thread count cannot exceed the detected logical CPU maximum.
- [ ] High CPU warning appears for Turbo or high Custom starts.
- [ ] Detail Mode reports hashrate, accepted/rejected shares, best difficulty,
      uptime, job id, and connection status.
- [ ] Diagnostics report the sanitized CPU runtime summary.

## Notifications Smoke

- [ ] Local Windows toast channel can emit a jackpot notification.
- [ ] Share accepted notifications remain disabled by default.
- [ ] Connection error notifications respect the configured channel.
- [ ] Webhook payloads do not include BTC address or webhook URL.
- [ ] Heartbeat interval `off` sends no heartbeat.
- [ ] Heartbeat interval `30min`, `1h`, or `6h` schedules only one active timer.

## Diagnostic Privacy

- [ ] `COPY DIAG` JSON excludes `btc_address`.
- [ ] `COPY DIAG` JSON excludes `pool_password`.
- [ ] `COPY DIAG` JSON excludes `webhook_url`.
- [ ] Recent log lines redact any configured BTC address.
- [ ] Recent log lines redact any configured pool password.
- [ ] Recent log lines redact any configured webhook URL.
- [ ] Diagnostic JSON includes `diagnostic_schema_version`.
- [ ] Diagnostic JSON includes app version, identifier, log path, and recent
      log lines.

## Release Notes

- [ ] Update `CHANGELOG.md`.
- [ ] Include the installer path and file size in the release notes.
- [ ] State which real CPU mining smoke checks were performed.
- [ ] State any checks that were skipped and why.

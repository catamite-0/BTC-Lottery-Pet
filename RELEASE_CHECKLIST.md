# Release Checklist

Use this checklist before tagging or distributing a BTC Lottery Pet release.
Automated checks catch build and protocol regressions. Manual checks cover real
desktop behavior that CI cannot safely prove.

## Automated Checks

- [ ] `.\scripts\dev-env.ps1`
- [ ] `npm run check:version`
- [ ] `npm ci`
- [ ] `npm run verify:cloud`
- [ ] `.\scripts\verify.ps1 -Strict`
- [ ] Build an unsigned local smoke-test installer with
      `.\scripts\verify.ps1 -Strict -BuildInstaller -DeferInstallerChecksum`
      after the strict gate has passed. Do not treat this one-stage build as a
      production release.
- [ ] For production, follow the two-stage Azure flow: build and sign the inner
      executable, bundle NSIS from it, then sign the final installer.
- [ ] After final installer signing, run
      `.\scripts\verify-installer-signature.ps1 -InstallerPath <installer> -ExpectedSignerSubject "<full certificate subject>"`,
      then run `.\scripts\write-installer-checksums.ps1`. The guard must report
      an embedded signature, matching publisher identity, and trusted timestamp.
- [ ] Confirm the NSIS directory contains exactly the current-version installer
      and its `.sha256` file. The checksum script must fail if stale installer
      or checksum files remain.
- [ ] Verify the generated checksum matches the installer bytes.

For failure isolation, the strict gate covers version and changelog consistency,
`npm audit --omit=dev`, `npm run test:frontend`, `npm run build`,
`cargo test --locked --workspace --manifest-path src-tauri\Cargo.toml`, and
`cargo clippy --locked --workspace --all-targets --manifest-path src-tauri\Cargo.toml -- -D warnings`.

GitHub Actions runs `Windows full gate` on `main` and pull requests. Manually
starting `Windows Release` builds and attests an explicitly named
`UNSIGNED-TEST-ONLY` artifact containing `UNSIGNED-TEST-ONLY.txt`, without
creating a Release. A strict `vX.Y.Z` tag contained in `main` must pass the
embedded, timestamped Authenticode and configured-publisher guard before the
workflow creates a checksum, uploads assets, or creates a draft Release.

## Installer Smoke

- [ ] Install the generated `BTC Lottery Pet_<version>_x64-setup.exe` on a
      clean or throwaway Windows profile.
- [ ] Verify the published or locally generated `.sha256` file matches the
      installer.
- [ ] Confirm the installer, Start menu, main window, and tray icons use the
      current BTC artwork and remain legible at small sizes.
- [ ] Launch from the Start menu.
- [ ] Confirm the packaged app does not open an extra black console window.
- [ ] Confirm the tray icon appears and `Show` restores the window.
- [ ] Confirm closing the window hides it instead of quitting the app.
- [ ] Quit from the tray menu.

## Browser Preview Smoke

- [ ] Run `npm run dev`.
- [ ] Open `http://127.0.0.1:1420`.
- [ ] Confirm the browser-only React UI renders with no console errors.
- [ ] Open Settings.
- [ ] Save settings with a custom worker and pool preset, and confirm the
      browser fallback updates the current view without desktop persistence.
- [ ] Switch display modes between compact and detail.
- [ ] Confirm Dashboard metric groups (`Network`, `Session`, `Connection`,
      `System`) and Settings pet previews render without overlap at narrow
      widths.

## Real CPU Mining Smoke

Use a BTC mainnet address you control. Plain Stratum v1 is unencrypted, so do
not use a private or sensitive worker label.

- [ ] Eco preset connects to the configured pool.
- [ ] Real CPU mining receives a job and updates connection status to `Mining`.
- [ ] `STOP` emits a stopped stats snapshot and hash rate returns to zero.
- [ ] Repeated START/STOP cycles do not leave stale pending shares.
- [ ] Repeated START/STOP cycles do not show old-session log lines after the new
      session starts.
- [ ] Invalid pool host shows a local validation message before startup.
- [ ] Invalid worker name shows a local validation message before startup.
- [ ] Connection loss eventually enters a retrying state and logs the reason.
- [ ] Detail Mode `OPEN LOGS` opens the log folder.
- [ ] Detail Mode `COPY LOG PATH` copies the log folder path.

## CPU Runtime Smoke

- [ ] Eco, Normal, Turbo, and Custom presets map to expected CPU thread counts.
- [ ] A custom thread count cannot exceed the detected logical CPU maximum.
- [ ] High CPU warning appears for Turbo or high Custom starts.
- [ ] Detail Mode reports hashrate, accepted/rejected shares, best difficulty,
      uptime, job id, and connection status.
- [ ] Detail Mode reports stale share drops and queued share drops.

## Notifications Smoke

- [ ] Confirm the automated Rust notification tests pass, including
      `block_found_triggers_local_notification_with_sound`.
- [ ] If a controlled developer jackpot trigger is available, confirm the real
      Windows toast and sound; otherwise record this manual check as skipped.
- [ ] Share accepted notifications remain disabled by default.
- [ ] Connection error notifications respect the local notification toggle.

## Upgrade and Config Migration

- [ ] Start once with a copy of a valid 0.8.0 config that has no
      `config_schema_version`.
- [ ] Confirm `config.pre-schema-1.json` preserves the original legacy JSON.
- [ ] Confirm the active config is rewritten with `config_schema_version: 1`.
- [ ] Confirm legacy Normal and Turbo presets become Custom and preserve their
      stored thread count instead of silently following a new recommendation.
- [ ] Confirm removed webhook and heartbeat fields do not reappear in the active
      config, and legacy `cyber-miner` / `lucky-cat` values normalize to Classic.
- [ ] Treat the backup as sensitive because it can contain the BTC address,
      pool password, and old webhook URL. Delete it manually only after the
      migration has been verified and recovery is no longer needed.
- [ ] Confirm a config with a future schema is left byte-for-byte unchanged and
      the app refuses to load it instead of overwriting it. A normal app window
      may not appear; capture startup stderr/log output when testing this case.

## Release Notes

- [ ] Update `CHANGELOG.md`.
- [ ] Before tagging, replace `Unreleased` in the first changelog release
      heading with the `YYYY-MM-DD` release date.
- [ ] Confirm the tag exactly matches all application version sources.
- [ ] Confirm the GitHub Release assets include the current-version installer
      and matching `.sha256` file.
- [ ] Confirm the release remained a draft throughout asset verification.
- [ ] Verify the GitHub artifact attestation for both release assets.
- [ ] For a release asset, confirm the installer has an embedded Authenticode
      signature with status `Valid`, its publisher subject exactly matches the
      configured Azure signing identity, and a trusted timestamp is present. An
      unsigned manual-run test artifact is never release eligible. Do not
      describe a checksum or GitHub attestation as Windows code signing.
- [ ] Publish the draft manually only after the installer smoke checks pass.
- [ ] Restate that this is a local CPU-only release with plain Stratum v1 TCP
      and no TLS, Stratum v2, proxy, failover, remote control, or browser
      mining support.
- [ ] State which real CPU mining smoke checks were performed.
- [ ] State any checks that were skipped and why.

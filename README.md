# BTC Lottery Pet

BTC Lottery Pet is a small Windows desktop ornament inspired by BTC lottery
miners and NerdMiner-style displays. It is built with Tauri, React,
TypeScript, and Rust.

The app now has a deliberately narrow runtime: explicitly confirmed local CPU
mining only. This project does not promise or guarantee any financial return.

## Features

- 420x560 resizable desktop pet window with a 360x360 minimum size.
- Toggleable Widget and Dashboard views.
- Always-on-top window with a user-controlled `PIN` / `FREE` toggle.
- System tray icon with `Show`, `Hide`, `Open Logs`, and `Quit`.
- CPU-only mining workflow with a warning for high CPU settings.
- User-controlled BTC address, pool host, pool port, worker name, pool
  password hint, and CPU thread selector.
- Single-instance protection per app identifier.
- Rust Stratum v1 client and cancellable SHA-256d CPU hash loop.
- `Stop` control that signals hash workers and waits for backend shutdown to
  finish.
- Jackpot / block-candidate detection when a header hash meets the network
  target from the current Stratum job's `nbits`.
- App log directory file logging with a 1 MiB rotation limit plus timestamped
  `found_block_*.json` files for block candidate events.
- Optional local Windows notifications for jackpot, share accepted, and
  connection error events.

BTC Lottery Pet does not hide its process, enable itself at Windows startup,
accept remote-control commands, or start mining automatically.

It never requests or stores a BTC private key or seed phrase.

## Download

Tagged versions publish a Windows NSIS installer on the GitHub Releases page.
Release assets are built by the repository's Windows workflow from the tagged
source. Until a tagged installer is present, treat the repository as source
code and a release candidate rather than a finished end-user download.

## CPU Mining Warning

CPU mining uses CPU time, electricity, and network bandwidth. Desktop CPU
mining is not competitive with specialized Bitcoin mining hardware and is
extraordinarily unlikely to find a block. Treat the feature as an educational
experiment and desktop lottery display, not an income source.

The Stratum v1 TCP presets are not encrypted. Your public BTC address, worker
name, pool traffic, and IP address are visible to the selected pool and may be
visible to networks between your computer and that pool. Only use pool
operators you trust. The app never asks for or stores a private key or seed
phrase.

The local mining log intentionally omits the pool username because that value
contains your public BTC address.

Solo pool availability, difficulty policies, payout behavior, and
compatibility can change outside this project. Verify the selected pool's
current documentation before mining.

## Supported Pool Presets

The settings panel includes:

| Pool host | Port | Notes |
| --- | ---: | --- |
| `public-pool.io` | `3333` | Default. Shared Public Pool low-difficulty endpoint listed by the NerdMiner project. |
| `pool.nerdminer.io` | `3333` | NerdMiner community pool endpoint. This client can use it as a plain Stratum v1 fallback after you review its current terms and status. |
| `pool.nerdminers.org` | `3333` | Official NerdMiner community pool. Verify compatibility before using this desktop client. |

The presets are convenience defaults, not availability guarantees. The pool
host field remains editable so you can use another trusted Stratum v1 solo pool
after reviewing its documentation.

The default worker username sent to the pool is:

```text
<btc_address>.<worker_name>
```

The Stratum password defaults to `x`. Some pools also accept a password hint
such as `d=1` or `diff=1` to request a lower share difficulty; use the Pool
Password / Hint setting when the pool documents one.

## Technical Scope

The Rust backend owns all real mining work:

1. Open a TCP socket to the configured host and port.
2. Send `mining.subscribe` and `mining.authorize`.
3. Process `mining.set_difficulty`, `mining.set_extranonce`, and
   `mining.notify`.
4. Build the coinbase transaction, Merkle root, and Bitcoin block-header
   candidate.
5. Run SHA-256d nonce loops using no more than the configured CPU thread count.
6. Send qualifying shares with `mining.submit`.
7. Emit UI statistics at most once per second during real mining: hashrate,
   accepted shares, rejected shares, best difficulty, current job ID, and
   connection status.
8. Compare each candidate header hash against the network target derived from
   `nbits`; if it meets that target, emit a local `block-found` event, write a
   timestamped `found_block_*.json` record, and keep the normal share
   submission path active.

The current client is intentionally small. It supports plain Stratum v1 TCP,
not Stratum TLS, Stratum v2, proxy mode, failover pools, remote management, or
profit-switching.

The Rust code is split by responsibility:

- `btc-hash-core` defines shared hash work types and the hash engine trait.
- `btc-hash-cpu` owns CPU SHA-256d, midstate reuse, and target comparison.
- `btc-mining-core` owns Stratum protocol parsing, job/share state, and mining
  telemetry.
- `src-tauri/src/mining_runtime` owns Tauri-facing session orchestration,
  workers, pool connections, logs, and local block-candidate side effects.
- `src-tauri/src/app_adapter` owns Tauri config, settings, and notifications.

These four crates form one Cargo workspace, so `cargo test --workspace` and
`cargo clippy --workspace` cover the hash and protocol crates as well as the
Tauri app.

The frontend is split so UI work can stay in its own lane:

- `src/app/shell` owns the desktop shell and top-level UI composition.
- `src/features` owns dashboard, settings, pet, mining prompt, and jackpot
  presentation.
- `src/contracts`, `src/platform/tauri`, `src/hooks`, and `src/app` own
  cross-layer state and Tauri command integration.

The UI does not choose the hash algorithm. The backend owns the CPU SHA-256d
midstate kernel.

The block-candidate record contains job ID, nonce, ntime, extranonce2, block
hash, best difficulty estimate, timestamp, and pool host/port. It intentionally
does not include the BTC address, private keys, seed phrases, or any remote
control data.

To keep an untrusted or misconfigured pool from consuming unbounded local
resources, the client accumulates partial Stratum fragments across socket
timeouts, caps each complete line at 64 KiB, and rejects a message that is not
finished within five seconds. It keeps at most 128 unanswered share submissions,
expires pending share responses after 30 seconds, and sends at most 16 queued
shares before returning to socket reads. It also
drains old queued shares before reconnecting, records stale/queued share drops,
rejects non-positive and pathologically low share difficulties, validates
Stratum job hex fields before worker dispatch, and discards invalid active jobs
with an `Invalid Pool Job` runtime event.

Mining logs are event-driven rather than hash-driven. The app logs connection,
authorization, job, share, stop, warning, and error events; it does not emit UI
events for every hash or nonce. Mining log payloads carry session IDs, and the
frontend ignores stale session logs after a newer start. When `STOP` is clicked,
the backend logs
`Mining stop requested`, sets the stop signal immediately, stops sending queued
shares once the signal is observed, waits for the Stratum thread and CPU workers
to finish, then emits a zero-hashrate `Stopped` stats snapshot. The frontend
shows the mining control as pending while the stop command is in flight.

Notifications are one-way only. Local Windows notifications can be triggered by
app events, but there is no remote command polling, remote control, or inbound
listener.

## Current Limitations

- Real mining requires the Tauri desktop app. The browser preview can exercise
  layout and settings fallback behavior, but it cannot open TCP sockets, mine,
  open the log folder, or write files.
- Mining is local CPU-only. There are no GPU, ASIC, remote worker, Stratum v2,
  TLS, proxy, failover, or profit-switching paths.
- CPU mining starts only after the user clicks `START`; the app does not mine at
  startup and has no remote-control listener.
- Pool preset availability, difficulty policy, and payout behavior are external
  to this project and must be verified against the pool operator's current
  documentation.

## Configuration

The repository-level [`config.json`](./config.json) contains defaults:

```json
{
  "config_schema_version": 1,
  "btc_address": "",
  "pool_host": "public-pool.io",
  "pool_port": 3333,
  "pool_password": "x",
  "worker_name": "btc-lottery-pet",
  "cpu_threads": 1,
  "performance_preset": "eco",
  "enable_notifications": true,
  "notify_on_jackpot": true,
  "notify_on_share_accepted": false,
  "notify_on_connection_error": true,
  "pet_profile_id": "classic-slot"
}
```

On first launch, the Rust backend copies these values to the app-specific
configuration directory. The schema field belongs to the stored JSON format and
is not part of the frontend settings contract. Existing config files are
normalized when loaded.

`performance_preset` and `cpu_threads` are the enforced real-mining CPU limits.
The default `eco` preset uses one CPU thread.

The first upgrade from a pre-schema 0.8 config writes the untouched original to
`config.pre-schema-1.json` before replacing removed fields. Every legacy Normal
or Turbo preset is migrated to Custom with its stored thread count preserved.
The one-time backup stays in the local app configuration directory and may
contain the BTC address, pool password, and removed webhook settings. After a
successful migration has been verified, the user may delete that backup
manually; the app keeps it by default for recovery.

Configs written by a newer schema are left unchanged and fail closed instead of
being downgraded. Upgrades also preserve existing custom pool selections and
migrate the old `21496` preset port to `3333` for known preset hosts. If a pool
rejects the client after connecting, review the settings panel and switch pools
manually when appropriate.

CPU mining is the only run mode. Mining still begins only after the user clicks
`START`, and high CPU presets require the explicit warning confirmation.

## Performance Presets

The settings panel asks the Rust backend for the computer's available logical
CPU thread count and lets the `CPU THREADS` selector choose any value from `1`
up to that maximum. The presets pick sensible thread counts scaled to the
machine:

| Preset | Real CPU mining threads |
| --- | ---: |
| `Eco` | `1` |
| `Normal` | About half the logical CPU threads, capped at `4` |
| `Turbo` | Logical CPU threads minus one, so the desktop stays responsive |
| `Custom` | User-selected `CPU THREADS` value, up to the logical maximum |

`Turbo` deliberately leaves one logical thread free rather than saturating every
core, because the app is a background desktop ornament and SHA-256d gains little
from the last hyperthread while making the machine hot and sluggish. A `Custom`
value can still use every logical thread if you explicitly choose it.

Starting real CPU mining with `Turbo` or a custom thread count above the backend
recommendation displays:

```text
High CPU usage may heat your computer. Continue?
```

The UI prompt is informational. The Rust backend performs its own normalization
and validation, so an out-of-range thread count cannot bypass the local limit.

## Notifications

Notification settings are local configuration. `Notify on Jackpot` and `Notify
on Connection Error` default to enabled and `Notify on Share Accepted` defaults
to disabled.

Alerts are delivered as local Windows notification-style balloons. Jackpot and
connection warnings also play a short system sound. Notifications are one-way
and local only: there is no webhook, no remote listener, and no network egress
beyond the mining pool connection and the block-height lookups.

## Prerequisites On Windows

Install:

1. [Node.js](https://nodejs.org/)
2. [Rust with the MSVC toolchain](https://www.rust-lang.org/tools/install)
3. [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
4. [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

For Microsoft C++ Build Tools, select the **Desktop development with C++**
workload.

## Install Dependencies

```powershell
npm install
```

## Development Files

The repository keeps source, lockfiles, configuration, tests, scripts, and docs
in Git. Generated outputs such as `dist/`, `.test-dist/`, `src-tauri/target/`,
`node_modules/`, local logs, and temporary release handoff files stay local and
are ignored. The cleanup command also removes the legacy `src-tauri/target-dev/`
cache if it exists from older development builds.

See [`DEVELOPMENT_FILES.md`](./DEVELOPMENT_FILES.md) for the full policy and
cleanup commands.

## App Identity

The project uses one Windows app identity: `BTC Lottery Pet` with identifier
`com.btc-lottery-pet.desktop`. Development runs and packaged installer builds
use the same identity so local testing matches the installed app.

Single-instance protection applies to that identity. If an installed copy is
already running, close it before starting `npm run tauri:dev`; otherwise
Windows may focus the existing app instead of opening the source-run process.

## Tray And Logs

Closing the pet window with `X` hides it to the system tray. It does not start
or stop mining by itself. Use the tray `Show` item or left-click the tray icon
to show the window again. Use `Quit` from the tray menu to exit the app.

The tray `Open Logs` item and the Dashboard `OPEN LOGS` button open the
app-specific log folder. The Dashboard `COPY LOG PATH` button copies that
local log folder path. The regular mining log is `mining.log`; if a block
candidate is detected, the event is also saved as a timestamped
`found_block_*.json` file.

## Run And Build Commands

Use exactly one of these commands for the task at hand:

| Command | Purpose |
| --- | --- |
| `.\scripts\dev-env.ps1` | Prints the Git/Node/npm/Cargo paths detected for this checkout and updates PATH for the script process. |
| `.\scripts\verify.ps1` | Runs the local verification suite, using direct Node fallbacks when npm is not on PATH. Add `-Strict` for release gating and `-BuildInstaller` to include the Tauri installer build. |
| `npm run clean:dev:check` | Previews removal of generated development files without deleting them. |
| `npm run clean:dev` | Removes generated build outputs, Rust/Tauri target caches, local logs, and temporary artifacts. |
| `.\scripts\clean-dev.ps1 -WhatIf` | Direct cleanup preview for shells where npm is not on PATH. |
| `npm run tauri:dev` | Recommended development desktop app. Starts Vite for Tauri and opens one `BTC Lottery Pet` desktop window. |
| `npm run dev` | Browser-only React preview at `http://localhost:1420`. It does not launch Tauri. |
| `npm run test:frontend` | Runs the no-dependency Node unit tests for frontend mining configuration helpers. |
| `npm run tauri:build` | Windows NSIS package build for `BTC Lottery Pet`. |

If a Codex or PowerShell session cannot find `git`, `npm`, or `cargo`, start
with `.\scripts\dev-env.ps1`. The verification script expects dependencies to
already be installed with `npm install` or `npm ci`; it can still run frontend
tests and builds through direct Node entrypoints when `node_modules` is present
and Node is available.

## Continuous Integration

GitHub Actions runs the fast quality gate on push and pull request: application
and changelog version consistency, production dependency audit, frontend helper
tests, frontend build, and locked Rust tests and Clippy with `-D warnings`. The
Windows installer artifact job runs for `v*` tags or when the workflow is
started manually with `build_installer=true`. It uses the same checksum script
as local release verification. Tag builds publish both the NSIS installer and
its `.sha256` file to the corresponding GitHub Release.

Manual workflow runs honor `build_installer=false`; when enabled, they keep the
installer as an Actions artifact and never publish a release, even if a tag ref
was selected for the dispatch.

## License

BTC Lottery Pet is available under the [MIT License](./LICENSE).

Release builds use the Windows GUI subsystem, so the packaged app should not
open an extra black console window next to the pet window. `npm run tauri:dev`
is different: it runs from a development terminal, and that terminal staying
open while the dev app runs is normal.

If you run `npm run dev` and `npm run tauri:dev` at the same time, you may see
a browser preview and a Tauri desktop window. Other common sources of an
apparent second window are an old executable that was not closed or an installed
copy that is still running. The application itself declares only one main Tauri
window.

## Run The Development Desktop App

On Windows, load the Visual Studio developer environment so Rust can find
`link.exe` and the Windows SDK libraries. With the default Build Tools install
path, run:

```powershell
cmd.exe /v:on /d /s /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && set "PATH=%USERPROFILE%\.cargo\bin;!PATH!" && npm run tauri:dev'
```

For a browser-only preview of the React UI:

```powershell
npm run dev
```

Browser previews can exercise the interface and settings UI. CPU mining runs
only inside the Tauri app because the Rust backend owns network and hashing.

## Build The Windows Installer

```powershell
cmd.exe /v:on /d /s /c 'call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" && set "PATH=%USERPROFILE%\.cargo\bin;!PATH!" && npm run tauri:build'
```

Tauri writes the executable to `src-tauri\target\release\btc-lottery-pet.exe`
and the NSIS installer under `src-tauri\target\release\bundle\nsis`. The
generated installer may download Microsoft's WebView2 bootstrapper when the
WebView2 runtime is missing from the target computer.

## Release Candidate Checks

Before each release, verify:

1. `npm ci` installs from the committed lockfile.
2. `.\scripts\verify.ps1 -Strict` passes. This is the local release gate for
   version and changelog consistency, production dependency audit, frontend
   tests, frontend build, and locked Rust tests and Clippy with `-D warnings`.
3. `.\scripts\verify.ps1 -Strict -BuildInstaller` produces the Windows
   executable, NSIS installer, and `.sha256` file. After a direct
   `npm run tauri:build`, run `.\scripts\write-installer-checksums.ps1`.
4. Before creating a tag, replace `Unreleased` in the first `CHANGELOG.md`
   release heading with the release date; the tag gate rejects it otherwise.
5. The release executable uses the Windows GUI subsystem and should not open an
   extra black console window. The development command `npm run tauri:dev` can
   still keep its development terminal open; that is expected.
6. Dashboard `OPEN LOGS` opens the local app log folder and `COPY LOG PATH`
   copies that folder path.
7. Complete the manual checks in [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md)
   before tagging or distributing the installer, and record skipped checks with
   reasons in the release notes.

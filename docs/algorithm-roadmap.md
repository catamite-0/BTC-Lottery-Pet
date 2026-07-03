# BTC Lottery Pet Algorithm Roadmap

## Current Position

The mining core must remain Bitcoin-compatible: proof of work is still double
SHA-256 over the consensus block header. Optimization is limited to work
preparation, local scheduling, power policy, search-space partitioning, and
external-hash routing gates.

Implemented local direction:

- Header midstate path: cache the SHA-256 state for the fixed first 64-byte
  header block and scan nonce-dependent tail work.
- Reusable midstate hasher: avoid rebuilding schedule buffers for each checked
  nonce on CPU verification paths.
- Midstate benchmark gate: compare full-header double SHA-256 against
  `HeaderWork` nonce scanning over a fixed window, validate identical hashes,
  and report the measured H/s ratio without changing mining behavior.
- GPU dispatch density tuning: classify active GPU profiles as underfilled,
  balanced, throttled, or wasteful from dispatch latency, throttle time, share
  waste, thermals, and power evidence.
- Evidence-based profile application: keep tuning changes manual and require
  measured runtime evidence before trusting higher hashrate or lower-power
  claims.
- External-hash reservations: network devices may provide telemetry and dry-run
  validation; direct devices remain reserved until the physical protocol is
  selected and tested.

## Executable Algorithm Contract

As of the route-certificate layer, the app's production algorithm contract is:

- `consensusHashing = double_sha256`: the submitted work remains the Bitcoin 80-byte header target search. No UI, planner, or external adapter may claim a different proof-of-work algorithm.
- `defaultAlgorithm = double_sha256_midstate` only when the midstate/full-header equivalence gate passes. If the gate is unknown or blocked, the certificate reports pending/full-header fallback instead of claiming a speedup.
- The unattended default is the measured useful-hash density lane: lowest stable watts or best useful J/TH under the current evidence, not the raw highest watt profile.
- Highest-hash mode is either a manual burst with measured marginal density, share quality, thermals, and stability, or it stays `partial`, `waiting`, `blocked`, or `dry_run`.
- External hash devices stay telemetry-only or dry-run until unique work leases, stale-result rejection, thermal behavior, accepted share-submission proof, manual release review, and the off-by-default release flag are proven.
- Frontier research may guide experiments, but `frontierClaimAllowed` remains false until stale or undated sources are refreshed. Runtime profile promotion can remain true when it is backed by consensus-safe implementation tests and measured local evidence.

The UI `ROUTE` line and diagnostic `routeCertificate` are the reader-facing proof object. They answer three separate questions: whether a runtime profile can be claimed, whether the full lowest-power plus highest-hash objective can be claimed, and whether a latest-research/frontier claim is allowed.

## Source-Backed Boundaries

- BIP320 reserves version bits for general-purpose mining use and explicitly
  names nonce-exhaustion and version-rolling AsicBoost as example use cases;
  BIP323 is the newer 2026 draft replacement that expands miner nonce space to
  24 nVersion bits for header-only mining. This supports
  version-rolling/search-space expansion, not nonce prediction.
  Sources: https://github.com/bitcoin/bips/blob/master/bip-0320.mediawiki and
  https://bips.dev/323/
- Stratum V2 defines mining jobs as unique subsets of the search space and
  requires servers to avoid overlapping work across devices. Its useful
  optimization path is work assignment, version rolling, nTime, extranonce, and
  extended jobs.
  Source: https://github.com/stratum-mining/sv2-spec
- AsicBoost describes a valid optimization by reusing work across colliding
  block-header candidates and reducing repeated message-schedule work. This is
  compatible with a future external/ASIC path, but must be gated behind protocol
  and work-space validation.
  Source: https://arxiv.org/abs/1604.00575

## Next Algorithm Milestones

1. Restore full Rust verification.
   - `cargo test --manifest-path src-tauri/Cargo.toml` must pass before claiming
     the midstate and share-submission paths are release-ready.
   - If the local target cache causes `can't find crate for tauri`, clean the
     Rust target cache and rerun through the repo verification script.

2. Keep the Rust benchmark gate for the midstate path in release verification.
   - `benchmark_header_hash_paths` compares full-header double SHA-256 vs
     `HeaderWork` midstate scanning over a fixed nonce window.
   - The gate validates identical hashes and reports H/s plus speedup ratio;
     treat the ratio as evidence, not as a machine-independent hard threshold.

3. Promote batch tuning from advisor to measured policy.
   - Keep `APPLY BATCH` manual.
   - Add a minimum sample window before enabling a higher-intensity target.
   - Require share evidence for max-hash claims and measured watts for
     lowest-power claims.

4. Expand search-space planning before external job routing.
   - Track nonce, BIP320/BIP323 version bits, nTime, and extranonce as separate work
     controls.
   - Refuse external high-hash routing if assigned search space is too short or
     overlapping.

5. Keep network and direct external interfaces separate.
   - Network path: telemetry first, dry-run work lease second, real job control
     only after share-submission proof.
   - Direct path: endpoint discovery only until USB/HID/serial/device-path
     protocol and safety envelope are chosen.

## Explicit Non-Goals

- Do not predict winning nonces.
- Do not narrow the nonce range based on historical shares.
- Do not claim data compression reduces valid SHA-256 work.
- Do not enable external real mining merely because telemetry looks efficient.

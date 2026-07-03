# External Hash Interface Roadmap

## Purpose

BTC Lottery Pet should chase the lowest power and highest useful hashrate without changing Bitcoin proof-of-work. The project therefore separates real mining correctness from hardware integration:

- Runtime mining keeps consensus double SHA-256 unchanged.
- Local CPU/GPU engines remain diagnostic and lottery engines.
- Mainline Network and Direct external hash interfaces are sealed and disabled.
- The implementation snapshot is preserved on `codex/external-hash-archive-20260703`.
- Future external hash work must restart from that branch and pass dry-run/release gates before it can be merged.

This file is the engineering contract for future ASIC or external compute support.

## Current Interface Split

| Interface | Current stage | Allowed now | Blocked now | First hardware task |
| --- | --- | --- | --- | --- |
| None | disabled | Local CPU/GPU mining only | External telemetry and work | Choose Network or Direct |
| Network | sealed | Compatibility field only; normalized to disabled in mainline | Telemetry, job control, share submission, real external start() | Restore from archive branch when hardware exists |
| Direct | sealed | Compatibility field only; normalized to disabled in mainline | Telemetry, writes, job control, share submission, real external start() | Restore from archive branch after endpoint/protocol choice |

The Direct path intentionally does not choose a port today. Acceptable endpoint shapes are examples only: `COM7`, `serial://...`, `usb://...`, `hid://...`, or a vendor device path. The chosen port should come from the actual device, firmware, driver, and SDK.
## Current Product Policy

The current app build treats external hash as `local_only` sealed-off infrastructure for the main algorithm route. Network telemetry, Direct endpoint probing, and dry-run work assignment are not exposed by this mainline branch. Compatibility fields load as disabled values so old configs cannot enable external hardware automatically; future work should branch from the archive snapshot and reintroduce only reviewed interfaces.

## Algorithm Boundary

The practical optimization stack is:

1. Reuse invariant block-header work with midstate/tail preparation.
2. Reduce wasted work from stale shares, rejected shares, queue drops, hot profiles, and short unstable samples.
3. Use measured watts and thermal state to select the best useful-hash density profile.
4. Use external ASIC telemetry as an efficiency reference when hardware exists.
5. Use version rolling, extended extranonce, or Stratum V2-style extended jobs only after unique search-space assignment is proven.

The app must not:

- Predict winning nonces for real mining.
- Prune nonce ranges from thermodynamic, ML, or UI signals.
- Claim data compression reduces consensus proof-of-work.
- Let a telemetry-only external device become a MiningEngine.
- Submit shares from Direct or Network adapters before job lifecycle, stale-job rejection, search-space assignment, thermal limits, and pool share submission are proven.

## Network Interface Acceptance Gates

Network starts as read-only telemetry. It may become a dry-run candidate only if all of these are true:

1. Endpoint access is stable.
2. Telemetry schema is parsed and bounded.
3. Hashrate is positive and recent.
4. Power or J/TH telemetry is available for efficiency comparison.
5. Thermal status is cool or warm, not hot, critical, or paused.
6. Search-space planning is sufficient or tight with declared version rolling/extranonce controls.
7. Work leases are unique across workers and do not overlap.
8. Mock leases reject stale, unknown, and expired results before share submission.

Even after those gates, `miningStartAllowed` remains false until manual release review passes and a separate device-specific engine release flag is wired. Release review alone must not enable real external work.

## Direct Interface Acceptance Gates

Direct remains reserved until hardware exists. The first implementation should follow this order:

1. Identify the physical layer: serial, USB, HID, or vendor path.
2. Prove endpoint access with read-only open/identity checks.
3. Document frame boundaries, report IDs, checksums, or control transfer shape.
4. Parse telemetry without writes.
5. Add safety limits for temperature, fan, voltage, and pause state.
6. Add job lifecycle control in a dry-run adapter only.
7. Prove unique search-space assignment with version rolling, extranonce, or equivalent partitioning.
8. Prove stale-job rejection before any pool submission path.
9. Prove share submission with test/dry-run evidence.
10. Keep real mining start disabled until release review passes and a device-specific engine release flag is wired.

## Evidence Required Before "Highest Hash" Claims

A route can be called highest-hash only when the evidence covers useful hashrate, not just raw speed:

- Stable runtime sample duration, target 900 seconds or longer.
- Accepted share evidence, target at least three useful share events.
- Rejected, stale, and queue-dropped shares included in effective hashrate.
- Measured wall power for local profiles or trusted power/J/TH telemetry for external profiles.
- Thermal state remains cool or warm throughout the sample window.
- External workers prove unique work leases, non-overlapping search space, safe lease utilization, and low hash-waste risk.
- External raw telemetry hashrate must be converted into effective work-lease hashrate before it can beat a local highest-hash claim; otherwise the claim records the missing effective work proof.

## Source Anchors

- BIP 320 reserves nVersion bits for general-purpose miner use and describes version rolling/AsicBoost negotiation: https://bips.dev/320/
- BIP 323 is the newer 24 nVersion bit draft replacement for miner nonce space: https://bips.dev/323/
- Stratum V2 mining protocol defines work distribution, unique search-space assignment, standard jobs, extended jobs, and extended extranonce: https://github.com/stratum-mining/sv2-spec/blob/main/05-Mining-Protocol.md
- The January 2026 thermodynamic SHA-256 ASIC paper is hypothesis/preliminary-observation research, not a production nonce-pruning route: https://arxiv.org/abs/2601.01916
- The June 2026 hashprice demand-response paper is operating-cost context, not a hash algorithm improvement: https://arxiv.org/abs/2606.00587

## Implementation Mapping

- `deriveExternalHashInterfaceSpec()` owns the user-facing interface stage.
- `deriveExternalHashCapabilityMatrix()` owns telemetry, power, work partitioning, and search-space gates.
- `deriveExternalHashWorkAdapterPlan()` owns dry-run external work eligibility.
- `assessHashHardwareAcquisition()` owns purchase and hookup triage for Network vs Direct candidates before any hardware exists.
- `assessHashHardwareOperatingEvidence()` owns the hard release proof for real hardware: 900 seconds, trusted wall/device power, cool/warm thermals, noise, share events, low share waste, effective hashrate, and effective J/TH.
- `deriveMiningAlgorithmPlan()` combines local tuning, external telemetry, route advice, and research triage.
- `createMiningAlgorithmDiagnosticSnapshot()` exports the current plan without raw endpoints or pool secrets.

The next hardware milestone is not a new hash algorithm. It is a measured, gated external adapter path that proves the device can add useful hashes without wasting energy or corrupting pool work.
## No-Device Reservation Policy

Until real external hardware is available, the app treats interfaces as reserved contracts rather than implementations:

- Network can be evaluated as read-only telemetry, then later as a dry-run candidate only when a future adapter explicitly declares `hash-engine` capability plus job control, share submission, version rolling, and work partitioning. Dry-run validation may prove job lifecycle, search-space assignment, thermal limits, and stale-result rejection, but accepted share submission remains separate evidence.
- Direct records only the intended physical class: serial, USB, HID, vendor path, or unknown. The concrete port is intentionally deferred until the device, driver, firmware, and SDK are known.
- Hardware acquisition scoring may label a device as a telemetry, dry-run, or manual release candidate, but `miningStartAllowed` stays false in every case.
- Any release candidate still needs a measured operating-evidence sample, endpoint access, unique work assignment, accepted share-submission evidence, manual review, and an explicit off-by-default engine release flag before app-controlled external mining can exist.
- Accepted share-submission evidence must come from the reviewed external adapter on a matching work lease/job/generation with accepted pool timing and pool/share difficulty. Mock results and local proxy submissions remain useful test artifacts but never satisfy the release proof.
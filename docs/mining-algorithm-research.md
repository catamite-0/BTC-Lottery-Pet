# Mining Algorithm Research Notes

## Consensus Boundary

Bitcoin mining is fixed by consensus around an 80-byte block header, double SHA-256-derived header fields, an nBits target, and nonce/header-field variation. The app must not replace this proof-of-work algorithm or pretend that hash prediction can beat uniform search.

Sources:

- Bitcoin Developer Reference, Block Chain: https://developer.bitcoin.org/reference/block_chain.html
- BIP 320, nVersion bits for general purpose use: https://bips.dev/320/
- BIP 323, 24 nVersion bits for miner nonce space: https://bips.dev/323/

## Practical Optimization Stack

1. Precompute and reuse invariant work.
   The useful "only calculate the back half" idea maps to SHA-256 midstate reuse and work partitioning, not skipping consensus hashing. In local CPU/GPU code this means avoiding repeated header setup and keeping work packets cache-friendly. The Rust mining path now centralizes that split through `HeaderWork`: bytes 0..64 become the SHA-256 midstate, bytes 64..76 become the reusable tail words, and bytes 76..80 remain the nonce search space. The fixed-window `benchmark_header_hash_paths` gate verifies that the full-header and midstate paths produce identical hashes before reporting measured H/s and speedup ratio. In ASIC hardware this is the domain of hardware pipeline design and AsicBoost-style message-schedule reuse.

2. Expand the search space without rebuilding jobs too often.
   BIP 320 documents general-purpose nVersion bits and mentions version rolling and AsicBoost use cases. BIP 323 is the 2026 draft replacement that expands miner nVersion nonce space to 24 bits for header-only mining. Stratum V2 standard jobs explicitly include nonce, version rolling bits, and nTime as legal header search space, while extended jobs add extranonce/Merkle-root controlled search-space allocation. The project now models this through a hash search-space planner and capability matrix: nonce-only CPU/GPU work can remain simple, but external ASIC paths must prove version rolling and, at higher hashrates, work partitioning through extended extranonce, SV2 extended jobs, or an equivalent unique-work assignment scheme before they are treated as highest-hash routes.
   The planner now also has a work-lease layer: it estimates per-worker lease seconds after parallel workers divide the available search space, flags overlap risk when multiple external workers share nonce-only work, and reports lease utilization plus hash-waste risk when a high-hash device would exhaust its assigned range too quickly.

3. Reduce wasted work.
   Stale share drops, local queue-full share drops, rejected shares, short unstable samples, and hot profiles all reduce useful hash density. Current project code treats these as share waste and feeds them into tuning, long-run profile score, route advisor, and the route decision card.

4. Move real hashrate to external ASICs when hardware exists.
   CPU/GPU lottery mining is useful for diagnostics and product experience, but modern lowest-watt-per-hash performance requires SHA-256 ASIC telemetry and eventually a validated external adapter.

5. Prefer Stratum V2-compatible future design.
   The Stratum V2 specification includes mining protocol, job declaration, and template distribution components. For this app, that maps to a future adapter gate: job lifecycle, stale-job rejection, thermal limits, and share submission must be proven before an external device can become a real MiningEngine.

Source:

- Stratum V2 Specification: https://github.com/stratum-mining/sv2-spec

## Research Triage

### Actionable

- AsicBoost / version rolling: real mining optimization family, but useful mainly when pool and hardware expose the right controls.
- Midstate reuse: valid local implementation hygiene for CPU/GPU hashing and a normal hardware pipeline assumption for ASICs.
- Stratum V2 / job declaration: relevant architecture direction for future pool/device control and search-space partitioning.
- Telemetry-driven power tuning: immediately useful in this app; this is where the current route decision, long-run score, thermal guard, and external telemetry work belongs.

### Not Actionable Yet

- Quantum SHA-256 mining papers are decision-only risk context for this desktop app, not a deployable low-power route. The June 2026 Quantum Horizon review separates signature risk from proof-of-work mining and still treats Grover-based mining as non-actionable for real miners.
- Thermodynamic/reservoir-computing SHA-256 ASIC ideas are research hypotheses. The 2026 CHIMERA/HRC paper is interesting for telemetry experiments, but it explicitly needs validation and does not provide a production Bitcoin mining speedup.
- ML mining ROI papers are useful for deciding when to buy or operate ASIC hardware, not for predicting winning nonces or changing the proof-of-work search.
- Population/heuristic nonce prediction papers do not change the cryptographic search reality enough to justify replacing sequential or partitioned nonce scanning.

Sources:

- BIP 320 nVersion bits: https://bips.dev/320/
- BIP 323 24 nVersion bits: https://bips.dev/323/
- AsicBoost white paper: https://arxiv.org/abs/1604.00575
- Stratum V2 mining protocol: https://github.com/stratum-mining/sv2-spec/blob/main/05-Mining-Protocol.md
- Toward Thermodynamic Reservoir Computing: Exploring SHA-256 ASICs as Potential Physical Substrates: https://arxiv.org/abs/2601.01916
- Speaking to Silicon: Neural Communication with Bitcoin Mining ASICs: https://arxiv.org/abs/2601.12032
- Lower energy consumption by SHA-256 quantum circuit design: https://arxiv.org/abs/2401.10902
- Quantum Horizon: An evaluation of quantum computing as a threat to Bitcoin and Ethereum: https://arxiv.org/abs/2606.14484
- Inner For-Loop for Speeding Up Blockchain Mining: https://arxiv.org/abs/1906.02770
- Smart Timing for Mining / MineROI-Net: https://arxiv.org/abs/2512.05402

### Verified Source Snapshot, 2026-07-02

- BIP 320 remains the compatibility version-rolling anchor, and BIP 323 is the newer draft replacement that expands miner nVersion nonce space from 16 to 24 bits. In this project both map to `search_space_partitioning`, never to changing the consensus hash.
- Stratum V2 remains the future external-work architecture anchor: standard and extended jobs, share submission messages, job declaration, and template distribution map to dry-run adapter gates before any hardware can become a real `MiningEngine`.
- The January 2026 thermodynamic/reservoir-computing SHA-256 ASIC paper stays offline research. It is interesting as telemetry science, but it does not unlock nonce prediction, work pruning, or production mining speedups.
- The January 2026 Speaking to Silicon / Thermodynamic Probability Filter / Virtual Block Manager claims also stay offline: they require independent mining-work validation and must not inflate effective hashrate or prune nonce ranges.
- The December 2025 MineROI-Net paper belongs in purchase/operation timing. It can inform when to buy or run ASIC hardware, but it does not improve SHA-256 hit probability or local hash density.
- The executable policy is therefore: `runtime` for consensus-safe midstate and measured power tuning, `telemetry` for network ASIC evidence, `dry-run` for version-rolling/SV2-style external work validation, `offline` for lab hypotheses, and `rejected` for nonce prediction or proof-of-work compression claims.

Research sources now carry an explicit safety envelope in code. Each source has an evidence level (`consensus`, `implementation-tested`, `protocol`, `measurement`, `hypothesis`, `economic-model`, `resource-estimate`, or `assumption`) plus a validation gate. Runtime sources can influence local mining only when they are consensus-safe or measured; BIP320/BIP323/SV2 sources stay dry-run until work leases and share accounting pass; thermodynamic/TPF papers stay offline; ROI/hashprice and quantum papers stay decision-only. This keeps the app open to new ideas without letting attractive but unverified papers become nonce pruning, artificial hashrate, or automatic external mining.

## Route Certificate Policy

The executable algorithm policy is now represented by `deriveAlgorithmRouteCertificate` and surfaced in diagnostics plus the Settings UI `ROUTE` line. Treat this certificate as the project's current answer to "what algorithm are we really running?":

- `ready` means local consensus-safe hashing, measured low-power density, and measured manual high-hash headroom are all proven for the current evidence set. It does not automatically mean frontier research claims are fresh.
- `partial` means one side of the objective is usable, usually the low-power density lane, while the high-hash lane is held for marginal density, kernel, cooldown, or evidence reasons.
- `dry_run` means external hashrate is being validated without real external mining start.
- `blocked` means runtime waste, thermals, kernel regression, power evidence, or share quality prevents promotion.
- `runtimeProfileClaimAllowed` and `fullObjectiveClaimAllowed` are deliberately separate from `frontierClaimAllowed`; old but stable consensus/runtime evidence can keep the app usable while newest-paper claims remain blocked pending review.

This is the current advanced-but-safe algorithm stack: consensus double SHA-256, equivalence-tested midstate reuse, measured useful-hash density as the default, manual measured high-hash burst only when it pays, sealed external hash interfaces, and source-freshness review for frontier ideas. Prediction, nonce pruning, and proof-of-work compression remain forbidden for pool-submitted work.

## External Hash Interface Contract

The external hash integration contract is maintained in `docs/external-hash-interface-roadmap.md`. Current product policy sets external hash to `local_only` sealed-off infrastructure for the main algorithm route: Network telemetry and Direct endpoint contracts may remain configured for a separate future hardware workflow, but the active lowest-power/highest-hash algorithm consumes only local CPU/GPU evidence. The implementation snapshot for future Network/Direct work is archived on `codex/external-hash-archive-20260703`; this branch keeps external inputs disabled and feeds local CPU/GPU evidence only.

## Project Direction

The best current path for BTC Lottery Pet is not a new hash algorithm. It is a layered optimizer:

1. Consensus-correct hashing stays untouched.
2. Local CPU/GPU code remains a diagnostics and lottery engine.
3. Tuning captures measured effective hashrate, absolute watts, power evidence, share waste, temperature, sample duration, and highest quality-adjusted hash under a watt budget.
4. Long-run profile score converts those signals into a stable 0-100 profile risk metric.
5. Hash Route Advisor compares lowest-watt, lowest-J/TH, balanced, and highest-hash local profiles against external telemetry history.
6. Route Decision summarizes the safest manual next step while keeping external search-space readiness as a hard gate before external high-hash routing.
7. Future external ASIC adapters stay gated until telemetry, job control, unique search-space assignment, stale-job rejection, thermal behavior, pool share submission, version rolling, and high-hash work partitioning controls are validated or explicitly marked advisory. The project now has a dry-run external work-adapter layer that can assign deterministic mock leases and reject stale results before any real Direct or Network hardware path is allowed to start mining.
8. Algorithm planning is now a pure domain layer. `deriveMiningAlgorithmPlan` combines tuning analysis, external telemetry history, search-space/work-lease readiness, Work Adapter status, and Hash Route Decision into one auditable strategy: collect baseline, local midstate tuning, network telemetry sampling, external dry-run validation, direct protocol reserved, or route monitoring.
9. Algorithm research review is also code now. `deriveAlgorithmResearchReview` classifies new ideas as production, experiment, decision-only, or rejected. Consensus SHA-256, midstate reuse, measured power tuning, and proven version rolling can be routeable; thermodynamic ASIC prediction and TPF/VBM claims stay lab-only; quantum SHA-256 mining and ROI models stay decision-only; predictive nonce pruning and proof-of-work compression stay rejected for real mining.
10. Evidence roadmap closes the loop from research to operation. `deriveAlgorithmEvidenceRoadmap` combines research review, experiment queue, readiness certificate, and density gates into one staged path: consensus guardrail, local power baseline, useful hash density, network telemetry history, search-space leases, external work validation, Direct protocol selection, and research-frontier filtering.
11. Sampling plan turns the roadmap into run instructions. `deriveAlgorithmSamplingPlan` states which evidence to capture next: local 900 second measured-power/share/thermal samples, local power-density frontier probing above the current knee, at least three useful share events, three cool/warm external efficiency samples for route-ready comparison, six usable samples for stable external comparison, and dry-run external work validation before any external mining start.
12. Operating policy turns the plan into a guarded runtime posture. deriveHashOperatingPolicy defaults to measured useful-hash density, allows max-hash only as measured headroom/burst evidence, keeps evidence-poor states in collect_evidence, and keeps external high-hash paths in dry-run until release gates approve measured real hardware operating evidence.

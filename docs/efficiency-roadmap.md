# Mining Efficiency Roadmap

## Hard Boundary

Bitcoin mining cannot switch to a different proof-of-work algorithm. Valid work is
an 80-byte block header hashed with double SHA-256 and compared against the nBits
target. Optimization must therefore target execution, power control, stale-share
reduction, and external device orchestration.

Reference: https://developer.bitcoin.org/reference/block_chain.html

## Research-Backed Algorithm Policy

The current best practical route is not a new proof-of-work algorithm and not a
prediction model. SHA-256 remains a one-way hash function, and Bitcoin consensus
validates double SHA-256 block-header work. That means every valid nonce range is
lottery-like; pruning the search range or "predicting" winners would reduce our
coverage instead of improving the odds.

Safe optimization lanes are therefore:

1. Consensus-preserving execution: reuse the first SHA-256 chunk midstate, keep
   CPU/GPU verification against full-header double SHA-256, and reduce stale or
   duplicate work.
2. Search-space expansion for high-hash devices: BIP320/BIP323 version rolling, bounded
   nTime rolling, and extranonce/work partitioning so workers receive unique
   search space that lasts long enough for their hashrate.
3. External ASIC orchestration: use network telemetry for watts, J/TH,
   temperature, and hashrate; only later allow dry-run work leases and real job
   control after protocol, thermal, stale-job, and share-submission checks pass.
4. Power-aware routing: choose between local lowest-power, max-efficiency,
   balanced, max-hashrate, and external-reference operating points using measured
   watts and share quality rather than raw hashrate alone.

Rejected lanes are also explicit in code now: predictive pruning and proof-of-work
search compression. Data compression is useful for logs, telemetry, or transport,
but it does not reduce the amount of valid SHA-256 work needed to find a share or
block candidate.

`deriveAlgorithmResearchReview` now makes the research filter executable. It
keeps production-safe lanes separate from lab-only hypotheses: AsicBoost/version
rolling can become production only after search-space and work-lease evidence,
Stratum-style extended jobs remain dry-run validation until share submission is
proven, thermodynamic ASIC prediction is telemetry-only lab work, and quantum
mining plus ROI models are decision-only rather than mining-loop optimizers.

The planner now also emits an evidence roadmap that joins the research filter,
experiment queue, readiness certificate, and density gates. The roadmap reports a
single primary phase, completion score, and next action while keeping external
mining start hard-disabled until release-gated hardware validation exists.

A sampling plan now converts that roadmap into concrete run requirements. Local
routes need a 900 second measured-power sample with at least three useful share
events and safe thermals; external network routes need three usable cool/warm
telemetry samples before route-ready comparison and six usable samples before
calling the external history stable. External work control remains dry-run only
until job lifecycle, stale rejection, thermal limits, and share accounting are
validated. A tuning directive then turns the primary sampling task into the next
local profile target or a non-local boundary action: Network telemetry, Direct
reserved port/protocol discovery, external dry-run validation, or research review.

The planner now turns this policy into an experiment queue. It ranks concrete
next steps by readiness and priority: verify consensus midstate reuse, capture a
local baseline, measure local watts, prove share quality, extend the stability
window, keep external ASIC telemetry sealed on the archive branch, review search-space readiness offline,
and finally apply or verify the primary local operating point. A route is not treated
as long-run-ready until the evidence matches the route: measured watts for
low-power choices, proven share counters for useful work, stable thermal/runtime
windows for unattended operation, and unique search-space leases before any
external high-hash worker can be trusted.

Primary references checked July 2, 2026:

- NIST FIPS 180-4 Secure Hash Standard: https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
- BIP320 version bits for general purpose use: https://bips.dev/320/
- BIP323 24 nVersion bits for miner nonce space: https://bips.dev/323/
- Stratum V2 Mining Protocol search-space model: https://raw.githubusercontent.com/stratum-mining/sv2-spec/main/05-Mining-Protocol.md
- AsicBoost paper: https://arxiv.org/abs/1604.00575
- Speaking to Silicon / TPF ASIC claims: https://arxiv.org/abs/2601.12032

## Practical Target Architecture

The desktop app should act as the control and presentation layer:

- local CPU/GPU engines remain useful for simulation, diagnostics, and lottery
  experimentation;
- external ASIC engines provide the only realistic path to lowest watts per hash;
- every engine should report hashrate, accepted/rejected shares, best difficulty,
  power when available, and joules per terahash.

## Priority Work

1. Drop stale share submissions after job changes.
   CPU and GPU workers should tag found shares with the source job generation.
   The Stratum submission loop should submit only shares that still match the
   active job generation and job id. Stale shares dropped before submit should be
   tracked separately from pool accepted/rejected shares so effective hash waste
   is visible without polluting pool-quality accounting.

2. Track efficiency as a first-class metric.
   Use `calculateEfficiencySnapshot` to normalize hashrate and power telemetry
   into H/J and J/TH. Unknown power must remain explicit instead of pretending
   a PC has ASIC-class efficiency.

3. Add an external ASIC engine.
   Start with Bitaxe/ESP-Miner because AxeOS exposes HTTP and websocket APIs:
   `/api/system/info`, `/api/system/asic`, `/api/system/statistics`, and
   `/api/ws/live`.

4. Add three tuning selectors.
   `Lowest Power` should prefer the lowest absolute watt draw for long unattended
   runs. `Max Efficiency` should prefer lower watts per terahash. `Max Hashrate`
   should prefer absolute hashrate while keeping thermal and driver stability
   limits visible.

## Reference Hardware Classes

- Bitaxe Gamma: single BM1370 ASIC, approximately 1.2 TH/s and near 15 J/TH.
  Reference: https://github.com/bitaxeorg/bitaxeGamma
- Avalon Nano 3: home miner with 65 W, 100 W, and 140 W power modes.
  Reference: https://shop.canaan.io/products/avalon-nano-3
- Industrial ASIC firmware often uses autotuning and power limits to optimize
  output under thermal and electrical constraints.
  Reference: https://braiins.com/os-firmware
## Hardware Candidate Scoring

Hardware selection is now treated as a scored input, not as a hardcoded product
list. `assessHashHardwareCandidate` accepts candidate specs such as hashrate,
watts, J/TH, transport kind, telemetry support, job control, share submission,
version rolling, work partitioning, and worker count. It returns a goal-specific
score for `Lowest Power`, `Max Efficiency`, `Balanced`, or `Max Hashrate` plus a
status: `qualified`, `provisional`, `telemetry-only`, `reserved`, or `blocked`.

This keeps the algorithm route current even when product names and market prices
change. A high-TH/s candidate cannot win the highest-hash route if nonce-only
search space is too small; it must prove BIP320/BIP323/SV2 version rolling and, when
needed, extranonce or equivalent work partitioning. Hardware scoring, route
selection, density lanes, and the operating envelope now use
lease-utilization-adjusted effective hashrate and cap high hash-waste risk, so
headline TH/s cannot outrank a lower but actually assignable worker. A low-watt claim cannot win
the lowest-power route without measured watts or reliable power telemetry. Direct
candidates remain `reserved` even when their specs look strong, because endpoint
access and physical protocol framing still need hardware validation. The mining
algorithm plan now carries this assessment as `hardwareCandidate`, and the
settings algorithm card surfaces the status, score, summary, and next validation
step beside readiness and experiment gates.
## Runtime Learning Loop

Efficiency recommendations should prefer live runtime evidence once mining has
been stable long enough to avoid startup noise. CPU, GPU, and hybrid samples feed
back into the local hashrate model, while power remains an explicit estimate
unless the device reports telemetry. External hash telemetry can then be compared
against the learned local profile by joules per terahash.
## Tuning Sweep Layer

The app now has a safe tuning-plan layer that can order CPU, GPU, and hybrid
profiles from a baseline toward lower watt draw, higher efficiency, balanced
operation, or higher throughput. Settings presets map into this goal: `Eco`
prioritizes `lowest_power`, `Normal` uses `balanced`, `Turbo` uses
`max_hashrate`, and `Custom` uses `max_efficiency` as a conservative manual
measurement target. The plan is intentionally read-only until the user applies a
step, so no machine is pushed
to a higher power profile without an explicit action.
The first closed-loop step is manual live sample capture: after a profile is
running long enough to report stable hashrate, the UI can capture that observed
sample and compare best efficiency versus best throughput without restarting the
miner automatically.
Captured samples can now be applied back to the draft configuration as the
lowest-power profile, the best observed efficiency profile, or the highest
observed hashrate profile. This keeps tuning explicit while closing the loop
from measurement to action.
Effective hashrate is now preferred over raw hashrate when selecting tuning
winners. Rejected-share ratio and short sample windows reduce the quality score
so unstable high-throughput samples do not dominate the recommendation.
Tuning sample quality now uses delta share counters between captures, so a later
profile is not penalized or boosted by accepted/rejected shares produced by an
earlier profile in the same mining session. The same delta path now includes
`stale_shares_dropped` and `queued_shares_dropped`, treating rejected shares,
stale-job drops, and local queue-full drops as total share waste. That waste
lowers effective hashrate, stability, quality score, and quality-adjusted joules
per terahash.
The tuning analysis also builds a Pareto frontier from captured samples. A
profile stays on the frontier only when another measured profile does not beat
it on both quality-adjusted effective hashrate and quality-adjusted joules per
terahash. This preserves real tradeoffs while filtering out dominated profiles.
The selector layer now exposes the lowest absolute measured watts for `Lowest
Power`, minimum J/TH for `Max Efficiency`, maximum quality-adjusted effective
hashrate for `Max Hashrate`, and a normalized knee-point score for `Balanced`.
It also has a power-budget selector: given a watt ceiling, it chooses the highest
quality-adjusted hashrate profile that stays under budget while avoiding
long-run `avoid` samples when a stable option also fits. The same selector now
builds a power-budget curve, so the UI can show how quality-adjusted hashrate
improves as the allowed watt ceiling increases. When no explicit watt ceiling is
set, the density planner derives a measured `frontier_knee` budget from the
local Pareto frontier. It only moves to a higher-watt profile while the marginal
hashrate gained per additional watt stays close to the current profile's hash
density, so the app can take cheap hashrate wins without blindly chasing a hot
maximum-hash sample. The density planner now exposes that tradeoff as a marginal
hash decision: `advance` for efficient intentional high-output profiles, `hold`
when extra watts add too little useful hash density, `measure` when evidence is
incomplete, and `cooldown` when thermals or long-run risk block the upgrade.
When that boundary has not been observed yet, the sampling plan emits
`local_power_density_probe` and the tuning directive targets the next profile
above the knee with measured watts, share events, and cool/warm thermals. Max-hash
sampling now follows the marginal decision: only `measure` keeps the high-output
probe active, while `hold`, `advance`, and `cooldown` stop automatic max-hash
sampling and leave the chosen density lane as the default.
Thermal guard scoring now feeds the same quality layer. Samples with hot,
critical, or paused telemetry keep their raw hashrate record, but their
quality-adjusted hashrate is reduced and their quality-adjusted J/TH is worsened
so unstable high-power runs do not win the recommendation.
A long-run profile score now combines the sample quality score with relative
quality-adjusted J/TH into a 0-100 score plus `excellent`, `good`, `watch`, or
`avoid` risk. This keeps the optimization target practical: lowest-power profiles
must also have low share waste, safe thermals, and enough runtime stability before
they look attractive for long unattended mining.
A long-run stability window now separates short probing bursts from samples that
have run long enough to be trusted. Short samples remain useful for exploration,
but Smart Apply prefers profiles that have enough stable runtime, low rejected
share ratio, and safe thermal state.
Auto-sample gating now blocks capture until the active profile has actually run
for its sample window and live hashrate is available. Captured samples use real
elapsed runtime instead of the planned step duration, so early clicks cannot
create a fake full-window sample. Manual capture may still record estimated-watt
samples for exploration, but armed automatic capture waits for measured watts so
unattended evidence does not fill with estimated-power samples. The measured-watt
entry resets when the active tuning profile changes, preventing a previous
profile's wall-power value from being reused on a new operating point. The UI can
arm automatic sample capture, but it only records the current profile; it does
not switch profiles or apply Smart recommendations without an explicit user action.
The apply buttons use the same evidence gate. `APPLY LOW` and `APPLY EFF` require
measured watts, and every apply target must avoid `avoid` risk, have share
evidence, and complete the stability window before it can rewrite the draft
runtime profile.
Share evidence is now a separate quality gate. Samples with no accepted,
rejected, or locally dropped stale share events can still record local hashrate,
but they are treated as unproven for long-run routing until enough share events
show that the profile is actually producing useful pool work.

Power evidence is tracked separately from share evidence. Local CPU/GPU samples
that only use estimated watts are still useful for tuning exploration, but route
selection does not treat them as measured J/TH until telemetry or wall-power data
confirms the watt draw. The tuning capture UI now accepts a manual measured-watts
value. When present, the captured sample is stored as measured power evidence;
when absent, capture still falls back to the planned estimated watts. Switching
tuning steps clears the manual value so a wall-meter reading from one profile is
not accidentally reused for another.

The algorithm plan now also emits a readiness certificate. The certificate turns
raw recommendation state into auditable gates: consensus midstate, measured
power, share quality, stability window, thermal safety, external efficiency
history, search-space lease readiness, external work validation, and Direct
protocol proof. The UI displays the readiness percentage and the first missing
required gate, so a recommendation cannot silently masquerade as a proven
long-run configuration. Diagnostic exports also pass the current preset-derived
goal into the optimization evidence layer, so `Eco`, `Turbo`, and `Custom`
reports focus the primary candidate and next missing evidence on lowest power,
max hashrate, or max efficiency instead of always defaulting to balanced. The
local unattended gate now shares the same thresholds as frontend optimization
evidence: measured watts, at least three share events, low share waste, a stable
15 minute runtime window, and safe thermals. External dry-run can become ready
after telemetry and search-space gates pass, but real external mining remains
false until hardware validation and a release review wire it into the engine
lifecycle.
## External Hash Interface Boundary

External hash support is split into two transports with explicit capabilities:

- `Network` is telemetry-only today. It can read AxeOS/Bitaxe-style hashrate,
  power, temperature, and efficiency data, but it does not submit pool shares or
  take over Stratum job control.
- `Direct` is a reserved transport. The app stores an optional endpoint string
  only as a future physical-interface hint. The current config still accepts the
  legacy `external_hash_direct_port` name, but the value is treated as a generic
  endpoint, not a committed COM-port design. No hash work is routed through it
  until the actual hardware protocol is chosen and tested.

This keeps local CPU/GPU mining, pool submission, and external device telemetry
separate. Future hardware adapters should first declare whether they support
telemetry, power telemetry, job control, share submission, version rolling, and
work partitioning before the UI or engine layer treats them as a dry-run mining
candidate. That declaration still does not make the adapter a real mining
backend: accepted share-submission proof, release review, and the explicit
engine release flag remain separate gates.

The adapter contract is intentionally stricter than the settings form:

1. `Network` endpoints normalize to HTTP telemetry adapters. They can become
   richer telemetry clients first, then job-control clients later, but share
   submission stays local until an adapter explicitly declares that capability.
2. `Direct` endpoints are recorded as serial, USB, HID, path, or unknown shapes.
   They are never engine-eligible while the protocol is reserved. The direct
   protocol plan now turns that shape into a read-only probe recommendation:
   serial starts with an identity handshake, USB starts with descriptor/vendor
   interface discovery, HID starts with report descriptor discovery, and path or
   unknown endpoints stay vendor-specific until the physical protocol is proven.
3. `ExternalHashTransportPlan` now separates transport readiness from mining
   readiness. A network HTTP transport can be telemetry-ready while job control
   and share submission stay false; a direct transport can record a COM, USB,
   HID, or path endpoint while remaining reserved until endpoint access and the
   physical protocol are proven.
4. A future external hash engine must promote the adapter to `hash-engine` only
   after it proves job lifecycle handling, unique search-space assignment,
   stale-job rejection, thermal limits, and share submission against the selected pool.

The UI now derives an external hash capability matrix from the active snapshot:
`Telemetry`, `Power`, `Version Rolling`, `Work Partitioning`, `Job Control`,
and `Share Submit`. A network adapter can be
ready for telemetry and even efficiency comparison while still blocking job
control and share submission. Direct endpoints stay reserved across every
capability until the physical protocol is selected and tested. This matrix is the
engine gate for future external hash work, so telemetry success alone never makes
an adapter mining-engine eligible. It now exposes both search-space readiness and work-lease readiness; the route advisor treats unsafe work leases the same way as unproven version rolling or extranonce partitioning.

A second candidate gate condenses the matrix into `disabled`, `reserved`,
`missing-endpoint`, `telemetry-only`, `blocked`, or `candidate`. It opens only
when the adapter declares telemetry, job control, share submission, and engine
eligibility. Even then it remains a candidate state until job lifecycle,
unique search-space assignment, stale-job rejection, thermal behavior, and pool share-submission validation pass.
Power telemetry is tracked as an efficiency readiness signal, so a future engine
can be technically eligible while still unsuitable for lowest-power routing.
Version rolling and work partitioning are tracked as performance readiness
signals through the hash search-space planner. The planner estimates how long
the assigned nonce, version-rolling, nTime, and extranonce space lasts at the
observed hashrate. A future engine can become a reserved candidate without
version rolling, but it is not treated as a highest-hash route when nonce-only
work would be exhausted too quickly. If BIP320/BIP323/SV2-compatible version rolling is
still too tight for very high hashrate, the matrix now requires `Work
Partitioning`, meaning extended extranonce, SV2 extended jobs, or an equivalent
unique-work assignment scheme before the route can be trusted for maximum hash.

The external engine registry now consumes the candidate gate as a separate
boundary. Telemetry-only and direct-reserved adapters are rejected before they can
appear as `ExternalHashEngine`; a candidate adapter can be listed for future work,
but `start()` remains disabled even after the validation checks pass. Passing the
checklist only marks the adapter as integration-ready. Actual external mining
start remains reserved until real hardware exists, the direct or network protocol
is selected, and a release review wires it through the explicit engine lifecycle.

The validation checklist is intentionally hardware-facing: `Job Lifecycle`,
`Search Space`, `Stale Jobs`, `Thermal Limits`, and `Share Submit`. Version rolling and work
partitioning stay in the capability/advisory layer because they are
high-performance search-space features, not minimum conditions for every external
device. Today these checks document
the required proof points for a future adapter, including proving that assigned
nonce/version/nTime/extranonce ranges are unique and sized for the device hashrate. The work-lease planner makes that proof concrete by estimating per-worker lease seconds after parallel workers divide the available search space and by flagging overlap risk when multiple workers would share nonce-only work. `Network` stays useful for
telemetry sampling; `Direct` stores the future endpoint choice but does not poll,
control jobs, or submit shares until the physical endpoint and protocol are known.

A mock external work-adapter layer now sits between the capability matrix and any
future hardware implementation. It can derive an assignable plan only after the
adapter explicitly declares telemetry, job control, share submission, enough
search space, and a safe work lease. It then creates deterministic per-worker
lease IDs, partition prefixes, expiration windows, and validation evidence for
job lifecycle, search-space assignment, thermal limits, and stale-result
rejection. Accepted share submission stays a separate validation input and is
not fabricated by the mock lease. `deriveExternalHashShareSubmissionValidationInputs` requires an accepted external-adapter proof that matches the active lease, job, generation, timing, and pool/share difficulty; mock and local proxy proofs are warnings, not release evidence. This is intentionally still dry-run infrastructure:
it proves the control boundary without routing real hash work away from the
current CPU/GPU/Stratum engines. The settings panel now surfaces this dry-run
state as `Work Adapter`, including whether work assignment is blocked,
telemetry-only, or assignable, plus the preview lease, worker partition, and
next safety step.

## External Hash Sealed State

Network telemetry sampling, Direct endpoint probing, external history controls, and external work dry-runs are not exposed in this mainline branch. The implementation snapshot is preserved on `codex/external-hash-archive-20260703`; the active app normalizes old external settings back to `none` and feeds empty external evidence into diagnostics. Future hardware work should be revived from the archive branch and reviewed separately before merge.

Local tuning observations now use the same evidence persistence layer. Stored
samples are sanitized, deduplicated by tuning step, and capped before they are
written to browser storage. The app also keeps a bounded replication history so
multiple runs of the same profile can support confidence gates without changing
the latest-by-step tuning view. CLEAR LOCAL removes both the latest samples and
replication history. External hash history controls are not exposed in this mainline branch. No
BTC address, pool password, webhook, or Stratum message is written into this
evidence store.

COPY DIAG now appends a `Frontend Optimization Evidence` section built from
that sanitized store. It reports local sample counts, measured-power evidence,
share-event evidence, external efficiency trend, and the next missing evidence
gate without including the raw external endpoint host or Stratum messages.
External efficiency that is currently degrading stays below `ready` even when the
sample count is high enough, so diagnostics keep asking for stable telemetry
instead of treating a worsening ASIC route as usable. It also marks local operating candidates as `qualified` only when measured watts,
at least three share events, low share waste, a stable 15 minute runtime window,
and a safe thermal state are present; otherwise they stay `provisional` and are
not suitable for unattended mining.
## Hash Route Advisor

The next decision layer compares measured local tuning results against external
telemetry history. It intentionally stays advisory: it can recommend `local`,
`external`, `monitor`, or `waiting`, but it does not start or stop engines. The
advisor requires comparable measured watts, J/TH, and hashrate before declaring a
route winner, prefers a route only when there is a clear power, efficiency, or
throughput edge, and keeps monitoring when the difference is too small or
external efficiency is currently degrading.

The advisor now evaluates four strategy goals instead of one global answer:

- `Lowest Power` selects the lowest measured-watt local tuning sample and compares
  it against external average watts before looking at free throughput.
- `Max Efficiency` selects the most efficient local tuning sample and requires a
  clear J/TH edge before routing away from it.
- `Balanced` preserves the existing 15% efficiency / 2x throughput guardrails
  used by the default route recommendation.
- `Max Hashrate` selects the fastest local tuning sample and allows a wider
  efficiency guard when external telemetry proves a much higher hashrate.

These recommendations are still read-only. They are intended to guide the next
manual action, or a future external hash engine, without automatically changing
mining mode, power profile, pool connection, or job submission behavior. Local
profiles with high share waste are now downgraded in route selection; if external
telemetry is stable and clears the efficiency/throughput guard, the advisor leans
toward verifying external hash instead of applying a waste-heavy local profile.
The advisor also reads the long-run profile score from tuning analysis. A local
profile marked `avoid` cannot win as the local route; it either sends the user to
verify external telemetry when that route clears the guard, or keeps monitoring
when neither route is safe enough. Profiles marked `watch` stay eligible, but
confidence is lowered so the UI treats them as provisional rather than ready for
long unattended mining.

A manual action planner now turns each strategy recommendation into one safe next
step: capture the current local sample, test external telemetry, apply a measured
local profile to draft settings, or keep monitoring. External recommendations
remain telemetry verification only; they do not enable job control, pool routing,
or share submission through external hardware.
A route decision summary now ranks the four strategy recommendations into one
primary next step with a 0-100 decision score. Each route also exposes a shared
score breakdown for power, J/TH efficiency, throughput, long-run risk, readiness,
and telemetry confidence. The final score weights those signals differently for
`Lowest Power`, `Max Efficiency`, `Balanced`, and `Max Hashrate`; it is still
advisory and only feeds UI actions that require a manual click.

`deriveMiningAlgorithmPlan` now wraps the route advisor with the broader mining
algorithm strategy. It keeps the consensus boundary explicit, confirms local
midstate reuse as the safe local optimization path, lists missing local power or
share evidence, and separates `Network` telemetry sampling from `Direct` protocol
reservation and future external dry-run work validation.

## Hash Operating Policy

`deriveHashOperatingPolicy` is the final advisory layer between the algorithm plan and any future automatic profile change. It does not start or stop mining. It classifies the current posture as evidence collection, eco density, balanced density, max-hash burst, external dry-run, or monitor-only. Auto-apply is allowed only for local, long-run-ready density evidence. Max-hash mode is treated as manual burst headroom, not the default, and it is only allowed when measured thermals, share quality, power evidence, and the marginal hash-density decision all clear the upgrade. External ASIC work remains dry-run or telemetry-only until release gates approve real hardware start through measured operating evidence, effective hashrate/J/TH after rejected, stale, and queued share waste, manual review, plus the explicit engine release flag.

## Experiment Advisor

`deriveAlgorithmExperimentAdvisor` sits between the sampling plan and the UI action buttons. It assigns a priority and focus to the current experiment: measured-power baseline, share quality, stability window, power-density knee, max-hash headroom, network telemetry, external dry-run validation, Direct protocol discovery, or research review. It does not start mining or change settings. It only states the target profile or non-local action, expected power/hashrate impact, marginal density status, evidence to record, stop conditions, and blocked risks. For max-hash headroom, the advisor records marginal hashes per watt and density retention, and it blocks high-output apply actions when the marginal decision is `hold` or `cooldown`. The confidence gate follows the same rule: complete repeated samples cannot become claim-ready if the marginal decision says the extra watts are not worth it or the profile needs cooldown.

This keeps the lowest-power/highest-hash workflow evidence-first: local experiments must record hashrate, measured watts, share counters, sample duration, and thermal state; network experiments stay telemetry-only; external work remains dry-run; Direct stays read-only until real hardware identifies the protocol and a reviewed engine flag exists.
## Experiment Confidence

`deriveAlgorithmExperimentConfidence` adds the proof gate after the experiment advisor. It does not start mining, change settings, prune nonce ranges, or route work to external hardware. It reads the current advisor, local tuning analysis, and external telemetry history, then classifies evidence as `missing`, `single_sample`, `replication_needed`, `provisional`, `confident`, or `blocked`.

Local tuning stays conservative: one complete profile sample with measured watts, duration, share evidence, cool/warm thermals, and a stable window is still `replication_needed` before lowest-power or highest-hash claims are promoted. Confidence can move to `confident` only when the bounded local replication history contains two complete independent samples for the same target profile, and `miningStartAllowed` still remains false because this is a claim gate, not an automatic mining-control gate. Network external hash can become `confident` only after six usable non-degrading efficiency samples, and even then `miningStartAllowed` remains false because telemetry evidence is not job control or share submission. Direct remains `blocked` until real hardware proves the physical endpoint and protocol.
`createHashClaimCertificate` now consumes the same marginal hash-density decision before publishing the final highest-hash claim, and local claims require repeated evidence before they become `proven`. A single complete local sample stays `provisional` with a same-profile replication gap; two complete independent same-profile samples are required for local lowest-power or highest-hash claims. A local max-hash sample can stay `provisional` while marginal hashes per watt are still `measure`, becomes `blocked` when the decision is `hold` or `cooldown`, and only keeps a `proven` highest-hash claim when the decision is `advance` or no high-output marginal gate is active. Lowest-power claims remain independent of the marginal gate but still require replication.

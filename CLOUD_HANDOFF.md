# Codex Cloud Handoff

Prepared on 2026-07-31 for the next cloud development session.

## Current status

- The current `main` branch is the source of truth.
- The application version is `0.9.0`, but `CHANGELOG.md` is still marked
  `Unreleased`. This is a release candidate, not a public release.
- The stability/cloud baseline was merged in
  [PR #4](https://github.com/catamite-0/BTC-Lottery-Pet/pull/4).
- The fail-closed Authenticode release baseline was merged in
  [PR #12](https://github.com/catamite-0/BTC-Lottery-Pet/pull/12)
  as `093eb3fd51690eec4e3d25b1fe40c5ae94bbe78b`.

Use the latest `main`, not an old local branch, prototype, installer, or
artifact, as the authoritative implementation.

## Start the first cloud session

1. Check out the latest `main` and confirm the worktree is clean.
2. Read `AGENTS.md` completely.
3. Read `docs/cloud-development.md`.
4. Configure and run the cloud setup command:

   ```bash
   bash scripts/setup-cloud.sh
   ```

5. Establish a clean portable baseline:

   ```bash
   npm run verify:cloud
   ```

6. Make one narrow, stability-focused change per branch and pull request. Never
   push directly to `main`.
7. Wait for the required GitHub `Windows full gate` before merge.

## Non-negotiable decisions

- Stability, correctness, crash recovery, and data durability take priority
  over new features and speculative optimization.
- `classic-slot` is the only built-in pet. Do not add or restore other pets
  until the pet system is explicitly redesigned.
- The optimized local mining implementation is authoritative.
  `btc_hash_cpu::ReusableMidstateHasher`, called through
  `ReusableMidstateHasher::double_sha256_words`, is the only production nonce
  scanner.
- Do not add runtime algorithm selection, fallback hash engines, automatic
  benchmark selection, or a production full-header nonce loop. Generic
  SHA-256d over an 80-byte header is allowed only as a test oracle.
- Preserve configuration, Stratum, share-submission, and candidate-record
  contracts unless a task explicitly changes them.
- UI code invokes Tauri only through `src/platform/tauri`. Domain modules stay
  free of Tauri, DOM, storage, timer, and network dependencies.
- Coordinate Rust and TypeScript whenever a Tauri command or event shape
  changes.
- Treat pool passwords and BTC addresses as sensitive. Never place them in
  logs, errors, screenshots, fixtures, test output, PR descriptions, or agent
  responses. Redact pool-controlled text before logging it.
- Do not weaken configuration backup recovery, future-schema protection,
  atomic writes, candidate finalization, or Stratum connection binding.
- Never commit generated builds, installers, artifacts, logs, `node_modules`,
  `dist`, `.test-dist`, or any Cargo/Tauri `target` directory.

The complete blocker list in `AGENTS.md` is authoritative if this summary ever
becomes stale.

## Verified baseline

The deep audit found no blocking defect in the mining core, Stratum lifecycle,
configuration recovery, candidate persistence, frontend/Tauri contracts, or
release guard.

Evidence completed before this handoff:

- `npm run verify:cloud` passed: frontend 27/27 tests, portable Rust core
  tests, formatting, Clippy, build, and diff checks.
- `.\scripts\verify.ps1 -Strict -BuildInstaller` passed: frontend 27/27
  tests, 98 Rust tests, Clippy, production dependency audit, Tauri, NSIS, and
  checksum validation.
- Installer signature-guard positive, negative, wrong-signer, catalog,
  timestamp-policy, and tamper tests passed.
- A Windows 0.8.0 to 0.9.0 in-place upgrade smoke test preserved the existing
  configuration and created the intended pre-schema backup.
- GitHub Actions run `30613755265` passed `Windows full gate` for PR #12.

This dated evidence is only a baseline. Re-run the applicable gates after every
change.

## Cloud and Windows boundary

| Work | Required owner and evidence |
| --- | --- |
| Frontend and portable mining-core changes | Codex cloud; `npm run verify:cloud` |
| Tauri, config persistence, tray, window, or notification changes | Windows; `.\scripts\verify.ps1 -Strict` |
| Installer or release workflow changes | Windows; `.\scripts\verify.ps1 -Strict -BuildInstaller` |
| NSIS production build | GitHub Actions on Windows |
| Checksum and provenance attestation | GitHub Actions after signature validation |
| Install, upgrade, tray, notification, and uninstall smoke | A real Windows machine |
| Public release decision | Human review of a draft GitHub Release |

The Linux cloud gate does not certify Windows Tauri integration, tray behavior,
notifications, configuration persistence, Authenticode, or NSIS.

## Repository controls snapshot

As of 2026-07-31, the GitHub-hosted controls are:

- `main` requires a pull request, resolved review conversations, and the stable
  `Windows full gate` check.
- Force pushes and branch deletion are blocked.
- `v*` tag creation, update, and deletion are restricted.
- Dependency graph, Dependabot alerts/security updates, Secret Protection, and
  Push Protection are enabled.
- GitHub Actions token permissions default to read-only, and actions are pinned
  to full commit SHAs.

Keep the required job display name `Windows full gate` stable.

## Release and signing boundary

There is no eligible Azure subscription or verified Azure Artifact Signing
identity yet. Do not create paid resources, identities, credentials, or trust
relationships on the owner's behalf.

Until the owner supplies those prerequisites:

- every tagged production release intentionally fails before checksum creation,
  upload, attestation, or Release creation;
- manual runs may produce only clearly marked `UNSIGNED-TEST-ONLY` evidence;
- unsigned installers must not be distributed or described as release-ready.

When Azure Artifact Signing becomes available, use GitHub OIDC and keep this
production order:

1. Build the inner application executable.
2. Sign, timestamp, and verify the inner executable.
3. Build NSIS from the signed executable.
4. Sign, timestamp, and verify the final installer against the exact configured
   publisher subject.
5. Only then generate the checksum, upload, attest, and create a draft Release.
6. Publish only after completing `RELEASE_CHECKLIST.md` on Windows.

See `docs/cloud-development.md` and
`scripts/verify-installer-signature.ps1` for the detailed policy.

## Known follow-ups

Handle these as separate, reviewable pull requests:

1. Refresh and validate
   [PR #10](https://github.com/catamite-0/BTC-Lottery-Pet/pull/10),
   which updates the development/build dependency PostCSS. Merge only after it
   is current with `main` and all gates pass.
2. Refresh and validate
   [PR #11](https://github.com/catamite-0/BTC-Lottery-Pet/pull/11),
   which updates the Tauri-transitive `serde_with`. Merge separately after all
   gates pass.
3. Replace direct dependency `winrt-notification 0.5.1` before any signed
   public release. It pins `windows 0.24.0`, which has a critical advisory.
   Source review found that the current toast path does not register the
   delegate-handler APIs implicated by the advisory; lower current reachability
   does not remove the remediation requirement. Preserve toast and sound
   behavior, then run Windows CI and manual notification smoke tests.
4. Track the Linux-only `glib 0.18.5` advisory through a deliberate future
   Tauri dependency upgrade. Do not destabilize the Windows product with a
   rushed framework migration.
5. Add Azure OIDC signing only after the owner has an eligible subscription and
   completes identity verification. Preserve fail-closed releases until signing
   is verified end to end.

Do not combine these items with pet work or mining-algorithm changes.

## Definition of done

- The change is narrow and consistent with `AGENTS.md`.
- `npm run verify:cloud` passes from a clean checkout.
- Rust and TypeScript command/event shapes remain coordinated.
- No sensitive value or generated output appears in the diff, logs, or PR body.
- The change is reviewed through a pull request.
- `Windows full gate` passes before merge.
- Windows-specific work has the extra gate and manual smoke evidence required
  by `AGENTS.md`.

## Prompt for the next cloud agent

```text
Work from the latest main branch. Read AGENTS.md and CLOUD_HANDOFF.md completely,
then read docs/cloud-development.md. This project is in a stability phase: keep
classic-slot as the only pet and preserve ReusableMidstateHasher as the only
production nonce-scanning path. Run bash scripts/setup-cloud.sh during setup and
npm run verify:cloud before and after changes. Start with one documented
dependency/security follow-up, keep the PR narrow, do not create a tag or
release, and wait for Windows full gate before recommending merge.
```

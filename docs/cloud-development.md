# Cloud Development and Release Ownership

The repository is prepared for Codex cloud development, but Windows packaging
remains on GitHub Actions. This split keeps daily coding and review cloud-first
without pretending that a Linux agent can certify Windows desktop behavior.

## Responsibility split

| Responsibility | Owner | Gate |
| --- | --- | --- |
| Code changes, frontend work, portable mining-core work | Codex cloud | `npm run verify:cloud` |
| Pull-request acceptance and full Tauri integration | GitHub Actions on Windows | `Windows full gate` |
| NSIS installer and checksum | GitHub Actions on Windows | `Windows Release` build job |
| Artifact checksum and provenance | GitHub Actions on Ubuntu | verify and attest job |
| Public release decision | Human reviewer | Draft Release smoke checklist |
| Tray, notification, install/uninstall, and signature smoke | Windows machine | `RELEASE_CHECKLIST.md` |

## Codex cloud environment

Use a repository environment with Node 22.23.1 and Rust 1.97.1. Configure this
setup command:

```bash
bash scripts/setup-cloud.sh
```

The setup phase installs locked frontend dependencies, activates Rust formatting
and Clippy, and fetches the locked Cargo graph while network access is available.
The agent can then work with network access disabled and run:

```bash
npm run verify:cloud
```

The root `AGENTS.md` records project invariants for every cloud task, including
the single-pet freeze and the optimized midstate-only production nonce loop.

The portable gate intentionally tests only the frontend and the three Rust core
crates. It does not attempt a Linux build of the Windows Tauri application.

## GitHub CI

`.github/workflows/ci.yml` runs on pull requests and `main`. It has read-only
repository permissions and executes the full Windows gate. Action dependencies
are pinned to immutable commit SHAs.

The stable required-check name is:

```text
Windows full gate
```

Configure a `main` ruleset to require that check, require pull requests, dismiss
stale approvals, and block force-pushes. Configure a tag ruleset so only trusted
maintainers can create `v*` tags.

## Installer workflow

`.github/workflows/release.yml` has two safe entry paths:

- Manual dispatch builds, verifies, attests, and stores an installer artifact
  whose Actions artifact name ends in `UNSIGNED-TEST-ONLY`. The archive also
  contains `UNSIGNED-TEST-ONLY.txt`, and both exact-file verification and the
  attestation include that marker. Broken, untrusted, or tampered signatures
  still fail. Manual artifacts never create a GitHub Release.
- A strict `vX.Y.Z` tag whose commit is contained in `origin/main` runs the same
  build only after the final installer has a `Valid`, embedded Authenticode
  signature from the configured publisher identity and a trusted timestamp.
  The workflow fails before checksum creation, upload, attestation, or Release
  creation otherwise. A passing tag creates a **draft** GitHub Release from the
  exact downloaded artifact.

Only the final draft-release job receives `contents: write`. The build job is
read-only, and the attestation job does not check out or execute repository
code. A checksum and artifact attestation prove integrity and provenance; they
do not replace Windows Authenticode signing.

Do not publish the draft until the checksum, attestation, signature status, and
manual Windows smoke checks have been reviewed.

## Azure Artifact Signing handoff

The project does not yet have an eligible Azure subscription or verified
Artifact Signing identity. Do not add Azure actions, credentials, or paid
resources until the owner has created an eligible subscription and completed
the required identity verification. Until then, the release guard intentionally
blocks every `v*` release while manual dispatch remains available for explicitly
unsigned test evidence.

When Azure Artifact Signing is ready, use GitHub OIDC and keep the signing key
inside Azure. Set the repository variable `AZURE_ARTIFACT_SIGNING_SUBJECT` to
the exact full `SignerCertificate.Subject` issued for the verified signing
profile. The guard binds releases to this stable identity field instead of a
short-lived leaf-certificate thumbprint; update the variable deliberately if
the verified signing identity changes.

The production order must be:

1. Build the production application executable without creating the NSIS
   bundle.
2. Sign and timestamp the inner application executable, then verify it.
3. Build the NSIS installer from that signed executable.
4. Sign and timestamp the final NSIS installer, then run
   `scripts/verify-installer-signature.ps1` with the exact expected signer
   subject.
5. Generate the `.sha256` file only after the final installer signature is
   complete, then upload, attest, and create the draft Release.

Signing changes executable bytes, so a checksum generated before either final
signing operation is not release evidence.

## Release sequence

This sequence becomes release-enabled only after the Azure signing actions,
OIDC trust, verified signing profile, and repository publisher variable are in
place. Until then, use manual unsigned test artifacts only; tagged releases are
intentionally blocked.

1. Merge a green pull request into `main`.
2. Replace `Unreleased` in the first changelog heading with the release date.
3. Merge that release-preparation pull request after `Windows full gate` passes.
4. Create the exact matching `vX.Y.Z` tag on a commit contained in `main`.
5. Wait for all three `Windows Release` jobs.
6. Download and smoke-test the draft assets on Windows.
7. Publish the draft manually only after the release checklist is complete.

See the official documentation for
[Codex cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environment.md),
[`AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md.md),
and
[GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations).

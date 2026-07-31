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

- Manual dispatch builds, verifies, attests, and stores an installer artifact.
  It never creates a GitHub Release.
- A strict `vX.Y.Z` tag whose commit is contained in `origin/main` runs the same
  build and creates a **draft** GitHub Release from the exact downloaded
  artifact.

Only the final draft-release job receives `contents: write`. The build job is
read-only, and the attestation job does not check out or execute repository
code. A checksum and artifact attestation prove integrity and provenance; they
do not replace Windows Authenticode signing.

Do not publish the draft until the checksum, attestation, signature status, and
manual Windows smoke checks have been reviewed.

## Release sequence

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

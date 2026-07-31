# Repository Instructions

## Priorities

- Stability, correctness, crash recovery, and data durability take priority over
  new features or speculative optimization.
- Keep `classic-slot` as the only built-in pet profile. Do not add or restore
  other pets until the pet system is explicitly redesigned.
- Preserve configuration, Stratum, share-submission, and candidate-record
  contracts unless a task explicitly changes them.

## Mining algorithm invariant

- The only production nonce-scanning implementation is
  `btc_hash_cpu::ReusableMidstateHasher`, called through
  `ReusableMidstateHasher::double_sha256_words` from the mining workers.
- Do not introduce runtime algorithm selection, fallback hash engines,
  automatic benchmark selection, or a production full-header nonce loop.
- Generic SHA-256d over a complete 80-byte header is allowed only in tests as a
  correctness oracle. Generic SHA-256d may still be used for coinbase and Merkle
  construction.
- Hot-path changes must preserve fixed vectors, network/share target decisions,
  nonce coverage, and stop responsiveness. Include benchmark evidence before
  claiming a performance improvement.

## Architecture and privacy

- UI code invokes Tauri only through `src/platform/tauri`.
- Keep domain modules free of Tauri, DOM, storage, timer, and network
  dependencies.
- Coordinate Rust and TypeScript changes whenever a Tauri command or event
  shape changes.
- Treat pool passwords and BTC addresses as sensitive. Never print them in
  logs, errors, screenshots, test output, PR descriptions, or agent responses.
  Use empty values or explicit synthetic fixtures in tests.
- Redact pool-controlled text before logging it. Keep frontend and backend
  password validation aligned.

## Generated files

- Never commit `node_modules/`, `dist/`, `.test-dist/`, `artifacts/`, installers,
  logs, or any Cargo/Tauri `target/` directory.
- GitHub Actions owns release artifacts. Release assets are never committed.

## Codex cloud gate

Use a Linux Codex cloud environment with the repository setup command:

```bash
bash scripts/setup-cloud.sh
```

Run the portable gate with:

```bash
npm run verify:cloud
```

This validates the frontend and portable mining core. It does not certify
Windows Tauri integration, tray behavior, notifications, or the NSIS installer.

## Windows gate

Changes touching Tauri integration, configuration persistence, notifications,
tray/window behavior, or release packaging require:

```powershell
.\scripts\verify.ps1 -Strict
```

Installer or release changes additionally require:

```powershell
.\scripts\verify.ps1 -Strict -BuildInstaller
```

Run NSIS production on a Windows GitHub Actions runner. A release remains a
draft until the generated installer, checksum, attestation, signature status,
and manual Windows smoke checks have been reviewed.

## Review blockers

Block changes that:

- add a production full-header nonce loop or bypass
  `ReusableMidstateHasher`;
- add a pet profile other than `classic-slot`;
- log or emit a pool password or BTC address;
- weaken configuration backup recovery, schema-version protection, or atomic
  writes;
- replay a block candidate across a different Stratum connection;
- mix unsigned installer acceptance with portable cloud checks;
- add generated build output to Git.

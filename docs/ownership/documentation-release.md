# Documentation And Release Check Ownership

Use this scope for CPU-only product documentation, release notes, release
checklists, validation command descriptions, and known limitation handoffs.

Primary paths:

- `README.md`
- `RELEASE_CHECKLIST.md`
- `CHANGELOG.md`
- `docs`

Allowed changes:

- Clarify current CPU-only architecture and thread ownership boundaries.
- Keep validation commands aligned with `package.json`, `scripts`, Cargo, and CI.
- Record release notes, skipped checks, installer evidence, and known
  limitations.
- Fix documentation that contradicts current code after citing the mismatch.

Avoid changing:

- Product behavior code in `src` or `src-tauri` unless the owning thread
  coordinates the behavior change.
- Runtime command contracts, hashing behavior, or UI flows.
- CI or release scripts without coordination with integration ownership.

Required checks:

- For documentation-only edits, review the affected docs against the source
  files that define the claimed behavior.
- For release gating, run `npm ci`, then `.\scripts\verify.ps1 -Strict`.
- For installer release evidence, run `.\scripts\verify.ps1 -Strict -BuildInstaller`
  or `npm run tauri:build` after the strict gate has passed.

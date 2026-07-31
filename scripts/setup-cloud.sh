#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

required_node="$(tr -d '[:space:]' < .node-version)"
actual_node="$(node --version | sed 's/^v//')"
if [[ "$actual_node" != "$required_node" ]]; then
  printf 'warning: expected Node %s, found %s; GitHub CI enforces the exact version\n' \
    "$required_node" "$actual_node" >&2
fi

rustup component add clippy rustfmt
npm ci
cargo fetch --locked --manifest-path src-tauri/Cargo.toml

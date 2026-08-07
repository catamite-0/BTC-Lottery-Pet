# Frontend UI Ownership

Use this scope for visual layout, interaction states, settings ergonomics, and pet/dashboard presentation.

Primary paths:

- `src/app/shell`
- `src/features`
- `src/styles/`
- Frontend view-model tests in `test`

Allowed changes:

- Dashboard, widget, settings, pet, jackpot, and warning UI
- CSS layout, responsive behavior, and display text
- Frontend view-model shaping when backend contracts stay unchanged

Avoid changing:

- Rust mining algorithms
- Stratum runtime behavior
- Tauri command payload shapes unless coordinated with integration ownership

Required checks:

- `npm run test:frontend`
- `npm run build`

# ultradev-dashboard

## 1.4.1

### Patch Changes

- [#30](https://github.com/Berget-Industries/ultradev/pull/30) [`64e8f4f`](https://github.com/Berget-Industries/ultradev/commit/64e8f4f4c3b9aa222cb0ad7bd64a5b62f40eec15) Thanks [@willebergh](https://github.com/willebergh)! - Fix update process to run database migrations and seed after installing dependencies. Fix Prisma 7 config to use `datasource.url` instead of `migrate.url`, and fix seed script to use the PrismaPg adapter pattern.

## 1.4.0

### Minor Changes

- [#24](https://github.com/Berget-Industries/ultradev/pull/24) [`d7e6936`](https://github.com/Berget-Industries/ultradev/commit/d7e693663791996f395b0f61128f59438339dde1) Thanks [@willebergh](https://github.com/willebergh)! - Expand Settings page with 17 new DB-driven settings (worker concurrency, notifications, logging, appearance, feature flags, GitHub filtering), system info panel, import/export, connection tests, and danger zone (reset, clear caches, purge logs, restart services).

## 1.3.0

### Minor Changes

- [#22](https://github.com/Berget-Industries/ultradev/pull/22) [`42f0cb4`](https://github.com/Berget-Industries/ultradev/commit/42f0cb45ba45b79ac66f4c089f45c69814418ae4) Thanks [@willebergh](https://github.com/willebergh)! - Add full-screen update progress page with real-time SSE streaming. When updating, the UI now navigates to a dedicated page showing a 4-step progress indicator (Fetch, Checkout, Install, Restart) with live status updates, server restart detection, and auto-redirect on completion.

## 1.2.0

### Minor Changes

- [#20](https://github.com/Berget-Industries/ultradev/pull/20) [`da5ccad`](https://github.com/Berget-Industries/ultradev/commit/da5ccad0e241e8c0bfadde59f3eab77827b15023) Thanks [@willebergh](https://github.com/willebergh)! - Replace raw SQL with Prisma ORM, add database-driven configuration and editable prompt templates. Includes a new Settings page for managing all config (GitHub, Discord, worker, paths, Claude) and editing worker prompt templates through the UI. Fixes the review timestamp comparison bug (PR [#19](https://github.com/berget-industries/ultradev/issues/19)) by using proper Date→string normalization.

## 1.1.0

### Minor Changes

- [#12](https://github.com/Berget-Industries/ultradev/pull/12) [`c02ed80`](https://github.com/Berget-Industries/ultradev/commit/c02ed8008e61ab022892eeb2751d5f29d38a5abd) Thanks [@willebergh](https://github.com/willebergh)! - Add automatic GitHub releases with changesets for version management. Includes a release workflow that opens a "Version Packages" PR on push to main, and creates GitHub releases when merged.

- [#15](https://github.com/Berget-Industries/ultradev/pull/15) [`f33668e`](https://github.com/Berget-Industries/ultradev/commit/f33668e0d9d6d01e9d4a03ecaa3da63317ebb36b) Thanks [@willebergh](https://github.com/willebergh)! - Add inline version display and one-click update to the header. Shows running version next to the logo, and when an update is available, displays an update button that triggers a self-update (git checkout + pnpm install) and restarts the server via systemd.

### Patch Changes

- [#16](https://github.com/Berget-Industries/ultradev/pull/16) [`569cfc2`](https://github.com/Berget-Industries/ultradev/commit/569cfc2e202b62377c54371d32a97b7038bfe26b) Thanks [@willebergh](https://github.com/willebergh)! - Fix release workflow: use RELEASE_TOKEN secret instead of GITHUB_TOKEN for elevated permissions, and add packageManager field to package.json to fix pnpm setup failure in CI.

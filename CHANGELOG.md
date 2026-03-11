# ultradev-dashboard

## 1.7.0

### Minor Changes

- [#42](https://github.com/Berget-Industries/ultradev/pull/42) [`dbbcc6e`](https://github.com/Berget-Industries/ultradev/commit/dbbcc6ece1be0cac2d348b22268e6590644b0f3f) Thanks [@willebergh](https://github.com/willebergh)! - Fix Discord bot not responding in guild channels based on the messaging whitelist. The bot now checks `discord.trigger_whitelist` for matching channel+author pairs and responds interactively. Separated error watcher watched channels into its own `error_watcher.watched_channels` setting so the two features are independently configurable.

## 1.6.1

### Patch Changes

- [#39](https://github.com/Berget-Industries/ultradev/pull/39) [`d2da9eb`](https://github.com/Berget-Industries/ultradev/commit/d2da9eb30ca90803ca3c599f373cc18d368c261e) Thanks [@willebergh](https://github.com/willebergh)! - Add CodeRabbit configuration to enable automatic review approvals on PRs.

- [#41](https://github.com/Berget-Industries/ultradev/pull/41) [`99f524a`](https://github.com/Berget-Industries/ultradev/commit/99f524a10acdcd11cab118c3d5688b00e32f85ce) Thanks [@Programmeraren1337](https://github.com/Programmeraren1337)! - Replace `prisma db push --skip-generate` with `prisma migrate deploy` in update flow. Adds baseline migration and configures migrations directory in prisma.config.ts. Prevents data loss during upgrades.

## 1.6.0

### Minor Changes

- [#37](https://github.com/Berget-Industries/ultradev/pull/37) [`23481c9`](https://github.com/Berget-Industries/ultradev/commit/23481c99fb6f4f55e89c6ad7c608279909719e5d) Thanks [@willebergh](https://github.com/willebergh)! - Add support for sending Discord notifications to a channel or owner DM. Adds a `discord.notification_channel_id` setting — when set, notifications go to that channel instead of DM-ing the owner. Leave empty to keep the existing owner DM behavior.

## 1.5.0

### Minor Changes

- [#33](https://github.com/Berget-Industries/ultradev/pull/33) [`a0ff46d`](https://github.com/Berget-Industries/ultradev/commit/a0ff46d73ccc3fff6e0e511495a00db38e3547ab) Thanks [@bergetUltraDev](https://github.com/bergetUltraDev)! - Settings page redesign: sidebar navigation splitting each section into its own page, wider max-width container, human-friendly inputs (textareas for comma-separated fields, full-width inputs, vertical stacking). Fix `gh auth status --active` unknown flag error.

### Patch Changes

- [#36](https://github.com/Berget-Industries/ultradev/pull/36) [`7d3379a`](https://github.com/Berget-Industries/ultradev/commit/7d3379a7d1de9dc71f1ce868fc61dcbb50f61027) Thanks [@Programmeraren1337](https://github.com/Programmeraren1337)! - Fix self-update and maintenance mode on macOS by gating systemctl calls behind a Linux platform check and spawning a detached restart process on non-Linux systems

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

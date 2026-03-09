# ultradev-dashboard

## 1.1.0

### Minor Changes

- [#12](https://github.com/Berget-Industries/ultradev/pull/12) [`c02ed80`](https://github.com/Berget-Industries/ultradev/commit/c02ed8008e61ab022892eeb2751d5f29d38a5abd) Thanks [@willebergh](https://github.com/willebergh)! - Add automatic GitHub releases with changesets for version management. Includes a release workflow that opens a "Version Packages" PR on push to main, and creates GitHub releases when merged.

- [#15](https://github.com/Berget-Industries/ultradev/pull/15) [`f33668e`](https://github.com/Berget-Industries/ultradev/commit/f33668e0d9d6d01e9d4a03ecaa3da63317ebb36b) Thanks [@willebergh](https://github.com/willebergh)! - Add inline version display and one-click update to the header. Shows running version next to the logo, and when an update is available, displays an update button that triggers a self-update (git checkout + pnpm install) and restarts the server via systemd.

### Patch Changes

- [#16](https://github.com/Berget-Industries/ultradev/pull/16) [`569cfc2`](https://github.com/Berget-Industries/ultradev/commit/569cfc2e202b62377c54371d32a97b7038bfe26b) Thanks [@willebergh](https://github.com/willebergh)! - Fix release workflow: use RELEASE_TOKEN secret instead of GITHUB_TOKEN for elevated permissions, and add packageManager field to package.json to fix pnpm setup failure in CI.

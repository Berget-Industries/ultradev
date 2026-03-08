# Changesets

This project uses [changesets](https://github.com/changesets/changesets) for version management and changelog generation.

## Adding a changeset

Run `pnpm changeset` to create a new changeset describing your changes. Select the bump type (patch/minor/major) and provide a summary.

## Releasing

Pushing to `main` triggers the release workflow. If there are pending changesets, a "Version Packages" PR is opened automatically. Merging that PR creates a GitHub release with the generated changelog.

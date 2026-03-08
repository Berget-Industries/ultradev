---
"ultradev-dashboard": patch
---

Fix release workflow: use RELEASE_TOKEN secret instead of GITHUB_TOKEN for elevated permissions, and add packageManager field to package.json to fix pnpm setup failure in CI.

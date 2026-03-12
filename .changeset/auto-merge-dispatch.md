---
"ultradev-dashboard": minor
---

Wire up auto-merge as priority 4 in the dispatch loop. When enabled, PRs that are approved, CI passing, and mergeable are automatically squash-merged via `gh pr merge` — no worker spawn needed.

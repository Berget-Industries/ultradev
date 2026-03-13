---
"ultradev-dashboard": minor
---

Replace hardcoded dispatch priority waterfall with intelligent Claude-driven dispatch. After each GitHub sync, a state-diff module detects meaningful changes (new issues, PR review status, CI changes, conflicts) and only triggers dispatch when something actually changed. When multiple actionable items exist, Claude reasons about what to work on next instead of following a fixed if/else cascade. Falls back to static priority order if the Claude call fails.

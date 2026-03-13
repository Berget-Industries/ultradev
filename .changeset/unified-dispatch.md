---
"ultradev-dashboard": minor
---

Unified dispatch — give Claude full plate instead of pre-filtered categories

- Widened sync to fetch issues (assigned + mentioned) and PRs (authored + mentioned + review-requested)
- Removed category pre-filtering: all open items go to Claude's intelligent dispatcher
- Deleted recoverStuckJobs — Claude handles re-work decisions
- Simplified state-diff to hash all open items via Prisma
- Fixed REVIEW_REQUIRED PRs being invisible to dispatch
- Re-open done PRs with new feedback before filtering
- Revalidate PR state before auto-merge

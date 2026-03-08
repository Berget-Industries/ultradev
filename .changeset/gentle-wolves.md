---
"ultradev-dashboard": minor
---

Replace raw SQL with Prisma ORM, add database-driven configuration and editable prompt templates. Includes a new Settings page for managing all config (GitHub, Discord, worker, paths, Claude) and editing worker prompt templates through the UI. Fixes the review timestamp comparison bug (PR #19) by using proper Date→string normalization.

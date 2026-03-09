---
"ultradev-dashboard": minor
---

Replace raw SQL with Prisma ORM, add database-driven configuration and editable prompt templates. Includes a new Settings page for managing all config (GitHub, Discord, worker, paths, Claude) and editing worker prompt templates through the UI. Fixes the review timestamp comparison bug (PR #19) by using proper Date→string normalization.

Expand settings with 17 new DB-driven settings across 6 categories: worker concurrency/timeouts, notifications, logging, appearance, feature flags (auto PR review, self-heal, cron scheduler, auto-merge), and GitHub filtering (auto-assign, labels filter, repos whitelist). Add system info panel, import/export, connection tests, danger zone (reset, clear caches, purge logs, restart services) to the Settings page.

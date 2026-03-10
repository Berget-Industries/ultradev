---
"ultradev-dashboard": patch
---

Replace `prisma db push --skip-generate` with `prisma migrate deploy` in update flow. Adds baseline migration and configures migrations directory in prisma.config.ts. Prevents data loss during upgrades.

---
"ultradev-dashboard": patch
---

Fix update process to run database migrations and seed after installing dependencies. Fix Prisma 7 config to use `datasource.url` instead of `migrate.url`, and fix seed script to use the PrismaPg adapter pattern.

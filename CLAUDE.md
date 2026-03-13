# UltraDev

Autonomous AI developer orchestrator. Polls GitHub for assigned issues, spawns Claude Code workers, creates PRs, handles review feedback, and merges.

## Stack

- TypeScript, Node 22, pnpm
- Vite + React 19 frontend, Express 5 backend
- PostgreSQL via Prisma ORM
- systemd user services

## Workflow Rules (MANDATORY)

### One Issue At A Time

- NEVER start a new issue while any open PR exists (review pending, CI running, conflicts, or auto-mergeable).
- The full lifecycle: branch -> code -> changeset -> push -> PR -> CI green -> CodeRabbit review -> address feedback -> resolve threads -> re-review -> approved -> merge -> verify issue closed -> THEN pick next issue.
- The dispatch system enforces this: issues are blocked when open PRs exist.

### CodeRabbit Review Loop (NEVER skip)

After every push that addresses review feedback:

1. **Resolve ALL review threads** you addressed (both code fixes and nitpick replies)
2. **Comment `@coderabbitai review`** to trigger re-review
3. **Poll for review decision** (`gh pr view <number> --json reviewDecision`) every 60s until APPROVED or new CHANGES_REQUESTED

### Nitpicks vs Real Issues

- CodeRabbit marks everything CHANGES_REQUESTED, even for trivial nitpicks.
- Comments labeled with `Nitpick` or `Trivial`: reply with brief reasoning, resolve the thread. No code change needed.
- Real issues: fix code, push, resolve thread, request re-review.
- You MUST respond to and resolve ALL threads regardless — CodeRabbit won't approve until threads are resolved.

### Changesets (REQUIRED)

- Always include a changeset file when making changes.
- Create `.changeset/<adjective>-<noun>.md` (e.g., `brave-pandas.md`) with the package name and semver bump, matching the `@changesets/cli` naming convention.
- Use `patch` for bug fixes, `minor` for features, `major` for breaking changes.
- Skip only if the repo has no `.changeset/config.json`.

### PR Merge Flow

- When APPROVED + CI green: `gh pr merge --squash --delete-branch --auto`
- After merge, verify the linked issue auto-closed. If not: `gh issue close <number>`

## Development

```bash
pnpm install          # install deps
pnpm dev              # dev server (Vite + Express)
pnpm build            # production build
pnpm typecheck        # tsc --noEmit
```

## Testing

```bash
pnpm test             # run tests if they exist
pnpm typecheck        # type checking
```

## Code Style

- No semicolons (configured in project)
- Single quotes
- 2-space indent
- ES modules (type: "module")
- Prisma for DB access, never raw SQL

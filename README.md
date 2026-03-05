# UltraDev

Autonomous AI developer that works on your GitHub issues. Polls for assigned issues, spawns [Claude Code](https://docs.anthropic.com/en/docs/claude-code) to solve them, creates PRs, responds to review feedback, and tracks everything in a real-time dashboard.

## How it works

UltraDev is a single Node.js process that runs:

- **Issue Poller** — Polls GitHub every 2 min for issues assigned to your bot account
- **PR Poller** — Watches for "Changes Requested" reviews and sends Claude back to fix them
- **Review Poller** — Self-reviews completed work before marking done
- **Worker** — Spawns `claude --print` in the cloned repo to do the actual work
- **Discord Bot** — Sends notifications on task progress (optional)
- **Dashboard** — React UI showing active work, task history, CI checks, open issues

No Docker, no cron jobs. One systemd user service spawning Claude Code as child processes.

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- [GitHub CLI](https://cli.github.com/) (`gh`) installed and authenticated
- A GitHub account for the bot (with issues assigned to it)

## Setup

```bash
git clone https://github.com/Berget-Industries/ultradev.git
cd ultradev
pnpm install
cp .env.example .env
# Edit .env with your values
```

## Configuration

All configuration is via environment variables (`.env` file or system env):

| Variable | Default | Description |
|----------|---------|-------------|
| `ULTRADEV_GITHUB_USERNAME` | `ultradev` | GitHub user that issues get assigned to |
| `ULTRADEV_POLL_INTERVAL_MS` | `120000` | Polling interval in ms (default 2 min) |
| `ULTRADEV_DISCORD_ENABLED` | `true` | Enable Discord notifications |
| `ULTRADEV_DISCORD_TOKEN` | — | Discord bot token |
| `ULTRADEV_DISCORD_CHANNEL_ID` | — | Discord channel ID |
| `ULTRADEV_REPOS_DIR` | `~/ultradev/repos` | Directory for cloned repos |
| `ULTRADEV_LOGS_DIR` | `~/ultradev/logs` | Directory for task logs |
| `ULTRADEV_CLAUDE_COMMAND` | `claude` | Path to Claude CLI |
| `ULTRADEV_CLAUDE_FLAGS` | `--dangerously-skip-permissions` | Comma-separated CLI flags |
| `ULTRADEV_DATA_DIR` | `~/.ultradev` | State, DB, and maintenance files |
| `PORT` | `4800` | Dashboard server port |

## Running

### Development

```bash
pnpm dev
# or
npx tsx src/server/index.ts
```

### Production (systemd)

```bash
# Copy and edit the service file
cp ultradev-dashboard.service ~/.config/systemd/user/
# Update paths in the service file to match your setup

systemctl --user daemon-reload
systemctl --user enable --now ultradev-dashboard.service
```

## Architecture

```
src/
├── client/           # React 19 + Vite dashboard
│   ├── components/   # UI components (shadcn/ui style)
│   └── pages/        # Dashboard, Kanban, Projects, Usage
└── server/
    ├── index.ts      # Express + Vite dev server
    ├── paths.ts      # Shared path constants
    ├── db.ts         # SQLite (better-sqlite3)
    ├── orchestrator/  # Core engine
    │   ├── config.ts         # Env var configuration
    │   ├── github-poller.ts  # Issue polling + worker dispatch
    │   ├── pr-poller.ts      # PR review feedback handling
    │   ├── review-poller.ts  # Self-review of completed work
    │   ├── worker.ts         # Claude Code process spawner
    │   ├── pr-worker.ts      # PR-specific worker
    │   ├── discord-bot.ts    # Discord notifications
    │   ├── state.ts          # JSON state persistence
    │   ├── log-parser.ts     # Stream-json log parsing
    │   └── rate-limit.ts     # API rate limit handling
    └── routes/        # Express API endpoints
```

## How the worker operates

1. Poller finds an assigned issue
2. Clones/updates the repo, creates a branch `ultradev/<owner>_<repo>_<number>`
3. Spawns `claude --dangerously-skip-permissions --print --output-format stream-json` with the issue as prompt
4. Claude reads the codebase, writes code, commits, pushes, creates a PR
5. Claude runs `gh pr checks --watch` to wait for CI
6. If CI fails, Claude fixes and pushes again
7. Dashboard shows real-time progress via SSE (tokens, cost, tool calls, CI status)

If a reviewer requests changes, the PR poller picks it up and sends Claude back to the same branch to address the feedback.

## License

MIT

# UltraDev

Autonomous AI developer. Polls GitHub for assigned issues, spawns Claude Code to solve them, creates PRs, handles review feedback, watches production errors, and reports via Discord DM.

## Quick Start

```bash
git clone https://github.com/Berget-Industries/ultradev.git && cd ultradev && pnpm install && claude -p "Run /preflight and help me fix any issues"
```

Claude will walk you through `.env` setup on first run. Or copy `.env.example` to `.env` and fill it in manually.

## What it does

- **Issue Poller** — Picks up GitHub issues assigned to your bot account, spawns Claude Code to solve them
- **PR Poller** — Detects "Changes Requested" reviews, sends Claude back to fix
- **Error Watcher** — Reads production errors from a Discord channel (webhook/bot), triages and creates GitHub issues
- **Discord DM** — Chat with UltraDev directly, owner-only, with conversation history
- **Dashboard** — Real-time UI at `localhost:4800` (tokens, cost, CI, work queue)

## Config

All via `.env`:

| Variable | Description |
|----------|-------------|
| `ULTRADEV_GITHUB_USERNAME` | GitHub user issues get assigned to |
| `ULTRADEV_DISCORD_TOKEN` | Discord bot token |
| `ULTRADEV_DISCORD_OWNER_USER_ID` | Your Discord user ID (DM access) |
| `ULTRADEV_DISCORD_NOTIFY_CHANNEL_ID` | Channel for status notifications |
| `ULTRADEV_DISCORD_TRIGGER_WHITELIST` | `channelId:authorId` pairs for error watching |
| `ULTRADEV_ERROR_WATCHER_REPO` | Target repo for auto-created issues |
| `ULTRADEV_ERROR_WATCHER_LABELS` | Labels for auto-created issues (default: `production,bug,auto-triaged`) |

See `.env.example` for all options.

## Run

```bash
pnpm dev            # development
```

```bash
# production (systemd)
cp ultradev-dashboard.service ~/.config/systemd/user/
systemctl --user enable --now ultradev-dashboard.service
```

## Requires

Node 22+, [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code), [GitHub CLI](https://cli.github.com/) (`gh`)

## License

MIT

Run a full preflight check to verify UltraDev is ready to work. Check each item below and report a clear PASS/FAIL summary at the end.

## Checks to perform

### 1. Node.js
- Run `node --version` and verify it's 22+

### 2. Claude Code CLI
- Run `claude --version` to confirm it's installed
- If `ULTRADEV_CLAUDE_COMMAND` is set in `.env`, verify that path exists

### 3. GitHub CLI
- Run `gh auth status` to confirm authenticated
- Run `gh api user --jq .login` to get the current user
- Check it matches `ULTRADEV_GITHUB_USERNAME` from `.env`

### 4. Environment
- Check `.env` file exists in the project root
- Verify `ULTRADEV_GITHUB_USERNAME` is set and not the default "ultradev"
- Verify `ULTRADEV_REPOS_DIR` path exists (or can be created)
- Verify `ULTRADEV_LOGS_DIR` path exists (or can be created)
- If `ULTRADEV_DISCORD_ENABLED=true`, verify `ULTRADEV_DISCORD_TOKEN` and `ULTRADEV_DISCORD_OWNER_USER_ID` are set
- If `ULTRADEV_ERROR_WATCHER_ENABLED=true`, verify `ULTRADEV_ERROR_WATCHER_REPO` is set and `ULTRADEV_DISCORD_TRIGGER_WHITELIST` has at least one entry

### 5. Dependencies
- Check `node_modules` exists, if not suggest `pnpm install`

### 6. Git
- Run `git config user.name` and `git config user.email` — verify they're set
- Check if GPG signing is configured (`git config commit.gpgsign`)

### 7. Permissions
- Check if the GitHub user can access at least one repo: `gh repo list --limit 1`

### 8. Service (optional)
- Check if `ultradev-dashboard.service` exists in `~/.config/systemd/user/`
- If it exists, check if it's running: `systemctl --user is-active ultradev-dashboard.service`

### 9. Port
- Check if the configured PORT (default 4800) is available or already in use by ultradev

## Output format

Print results as a checklist:
```
✅ Node.js 22.x
✅ Claude Code CLI v2.x
✅ GitHub CLI authenticated as <username>
❌ .env missing ULTRADEV_DISCORD_TOKEN
...

Result: X/Y checks passed. <Ready to work! | Fix the issues above before starting.>
```

Do NOT fix anything automatically. Only diagnose and report.

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const settings = [
  // --- GitHub ---
  { key: 'github.username', value: 'ultradev', type: 'string', label: 'GitHub Username', description: 'GitHub user to poll for assigned issues', category: 'github' },
  { key: 'github.poll_interval_ms', value: '120000', type: 'number', label: 'Poll Interval (ms)', description: 'How often to sync with GitHub', category: 'github' },
  { key: 'github.auto_assign', value: 'false', type: 'boolean', label: 'Auto-Assign Issues', description: 'Automatically assign synced issues to the configured user', category: 'github' },
  { key: 'github.default_labels', value: '', type: 'string', label: 'Default Labels Filter', description: 'Only sync issues matching these labels (comma-separated, empty = all)', category: 'github' },
  { key: 'github.repos_whitelist', value: '', type: 'string', label: 'Repos Whitelist', description: 'Only sync these repos (comma-separated owner/repo, empty = all)', category: 'github' },

  // --- Discord ---
  { key: 'discord.enabled', value: 'true', type: 'boolean', label: 'Enabled', description: 'Enable Discord bot integration', category: 'discord' },
  { key: 'discord.token', value: '', type: 'secret', label: 'Bot Token', description: 'Discord bot token', category: 'discord' },
  { key: 'discord.owner_user_id', value: '', type: 'string', label: 'Owner User ID', description: 'Discord user ID of the bot owner', category: 'discord' },
  { key: 'discord.notify_channel_id', value: '', type: 'string', label: 'Notify Channel ID', description: 'Channel for notifications', category: 'discord' },
  { key: 'discord.trigger_whitelist', value: '', type: 'string', label: 'Trigger Whitelist', description: 'channelId:authorId pairs (comma-separated)', category: 'discord' },

  // --- Worker ---
  { key: 'error_watcher.enabled', value: 'true', type: 'boolean', label: 'Error Watcher Enabled', description: 'Enable error watcher', category: 'worker' },
  { key: 'error_watcher.interval_ms', value: '43200000', type: 'number', label: 'Error Watcher Interval (ms)', description: 'How often to scan for errors', category: 'worker' },
  { key: 'error_watcher.target_repo', value: '', type: 'string', label: 'Error Watcher Target Repo', description: 'Repo to create issues in (owner/repo)', category: 'worker' },
  { key: 'error_watcher.labels', value: 'production,bug,auto-triaged', type: 'string', label: 'Error Watcher Labels', description: 'Labels for auto-created issues', category: 'worker' },
  { key: 'worker.max_concurrent', value: '1', type: 'number', label: 'Max Concurrent Workers', description: 'Maximum number of parallel Claude workers', category: 'worker' },
  { key: 'worker.default_timeout_ms', value: '1800000', type: 'number', label: 'Default Timeout (ms)', description: 'Default task timeout (30 min default)', category: 'worker' },

  // --- Notifications ---
  { key: 'notifications.enabled', value: 'true', type: 'boolean', label: 'Notifications Enabled', description: 'Master toggle for all notifications', category: 'notifications' },
  { key: 'notifications.discord_on_success', value: 'true', type: 'boolean', label: 'Notify on Success', description: 'Send Discord notification when a task completes successfully', category: 'notifications' },
  { key: 'notifications.discord_on_failure', value: 'true', type: 'boolean', label: 'Notify on Failure', description: 'Send Discord notification when a task fails', category: 'notifications' },

  // --- Paths ---
  { key: 'paths.repos', value: '~/ultradev/repos', type: 'string', label: 'Repos Directory', description: 'Where to clone repositories', category: 'paths' },
  { key: 'paths.logs', value: '~/ultradev/logs', type: 'string', label: 'Logs Directory', description: 'Where to store worker logs', category: 'paths' },

  // --- Claude ---
  { key: 'claude.command', value: 'claude', type: 'string', label: 'Claude Command', description: 'Path to the Claude CLI', category: 'claude' },
  { key: 'claude.flags', value: '--dangerously-skip-permissions', type: 'string', label: 'Claude Flags', description: 'Flags passed to Claude CLI (comma-separated)', category: 'claude' },

  // --- Logging ---
  { key: 'log.level', value: 'info', type: 'string', label: 'Log Level', description: 'Log verbosity: debug, info, warn, error', category: 'logging' },
  { key: 'log.retention_days', value: '30', type: 'number', label: 'Log Retention (days)', description: 'Auto-delete logs older than this many days (0 = never)', category: 'logging' },

  // --- Appearance ---
  { key: 'ui.theme', value: 'dark', type: 'string', label: 'Theme', description: 'UI theme: dark, light, system', category: 'appearance' },
  { key: 'ui.page_size', value: '25', type: 'number', label: 'Default Page Size', description: 'Default number of items per page in tables', category: 'appearance' },

  // --- Feature Flags ---
  { key: 'features.auto_pr_review', value: 'true', type: 'boolean', label: 'Auto PR Review', description: 'Automatically address PR review feedback', category: 'features' },
  { key: 'features.self_heal', value: 'true', type: 'boolean', label: 'Self Heal', description: 'Auto-fix system errors when detected', category: 'features' },
  { key: 'features.cron_scheduler', value: 'true', type: 'boolean', label: 'Cron Scheduler', description: 'Enable the cron job scheduler', category: 'features' },
  { key: 'features.auto_merge', value: 'false', type: 'boolean', label: 'Auto Merge', description: 'Auto-merge PRs after all checks pass and approval received', category: 'features' },
]

const promptTemplates = [
  {
    slug: 'issue-worker',
    name: 'Issue Worker',
    description: 'Prompt for working on GitHub issues',
    maxAttempts: 3,
    timeoutMs: 1800000,
    template: `You are working on issue #{{number}} in {{repo}}.

## Issue: {{title}}

{{body}}

{{comments_section}}

{{resume_context}}## Instructions

1. Read and understand the issue thoroughly.
2. Explore the codebase to understand the relevant code.
3. Implement the fix or feature described in the issue.
4. Make sure the code works — run tests if they exist. Use \`pnpm --filter <package> test\` to run tests.
{{pr_instructions}}

## CRITICAL RULES
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.** Dependencies are already installed. If something appears missing, work around it — do NOT install.
- You are already on the correct branch. Do not create or switch branches.{{existing_pr_rule}}
- Do not ask questions — make reasonable decisions and proceed.`,
  },
  {
    slug: 'pr-review',
    name: 'PR Review',
    description: 'Prompt for addressing PR review feedback',
    maxAttempts: 3,
    timeoutMs: 1800000,
    template: `You are addressing review feedback on PR #{{pr_number}} in {{repo}}.

## Original PR: {{pr_title}}

{{pr_body}}

## Review Feedback

{{review_feedback}}

{{inline_comments}}

## Branch Setup

You are on branch \`{{pr_branch}}\`. This is the PR branch.
The PR merges \`{{pr_branch}}\` into \`{{base_ref}}\`.

## Instructions

1. Read and understand ALL the review feedback carefully.
2. Explore the relevant code to understand context.
3. Make the requested changes on this branch (\`{{pr_branch}}\`).
4. Run tests if they exist. Use \`pnpm --filter <package> test\` to run tests.
5. Commit your changes with a clear message describing what review feedback you addressed.
6. Push your commits to origin: \`git push origin {{pr_branch}}\`
7. The existing PR will be updated automatically. Do NOT create a new PR.
8. After pushing, wait for CI checks to complete: \`gh pr checks {{pr_number}} --repo {{repo}} --watch\`
   If any check fails, read the failure logs, fix the issue, commit, and push again. Repeat until CI is green.

## CRITICAL RULES
- Do NOT create a new branch. Stay on \`{{pr_branch}}\`.
- Do NOT create a new pull request. Just push to the existing branch.
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.** Dependencies are already installed.
- Do not ask questions — make reasonable decisions and proceed.`,
  },
  {
    slug: 'conflict-resolver',
    name: 'Conflict Resolver',
    description: 'Prompt for resolving merge conflicts',
    maxAttempts: 2,
    timeoutMs: 900000,
    template: `You are resolving merge conflicts on PR #{{pr_number}} in {{repo}}.

## PR: {{pr_title}}

## Situation
This PR's branch \`{{head_ref}}\` has merge conflicts with \`{{base_ref}}\`.
The base branch has moved ahead and some files conflict.

## Instructions

1. First, understand the current state:
   \`\`\`
   git log --oneline -5
   git log --oneline origin/{{base_ref}}..HEAD
   \`\`\`

2. Rebase onto the latest base branch:
   \`\`\`
   git rebase origin/{{base_ref}}
   \`\`\`

3. If there are conflicts:
   - Read each conflicting file carefully
   - Understand the intent of BOTH sides (the PR changes AND the base branch changes)
   - Resolve conflicts preserving the intent of both changes
   - \`git add <resolved files>\` then \`git rebase --continue\`

4. After the rebase is complete:
   - Make sure the code compiles/builds if applicable
   - Run tests if they exist: \`pnpm --filter <package> test\`
   - Force push: \`git push origin {{head_ref}} --force-with-lease\`

5. After pushing, verify CI passes: \`gh pr checks {{pr_number}} --repo {{repo}} --watch\`
   If any check fails, fix and push again.

## CRITICAL RULES
- Stay on branch \`{{head_ref}}\`. Do NOT create new branches.
- Do NOT create a new PR. The existing PR will update automatically.
- **NEVER run \`pnpm install\`, \`pnpm add\`, \`npm install\`, or any dependency installation command.**
- Use \`--force-with-lease\` (not \`--force\`) when pushing the rebase.
- Do not ask questions — make reasonable decisions and proceed.
- When resolving conflicts, preserve the intent of BOTH sides. Do not drop changes.`,
  },
  {
    slug: 'error-triage',
    name: 'Error Triage',
    description: 'Prompt for analyzing production errors and creating issues',
    maxAttempts: 1,
    timeoutMs: 300000,
    template: `You are UltraDev's error triage system. Analyze these production error messages from Discord and create GitHub issues for actionable problems.

## Target repo: {{target_repo}}

## Errors to analyze:

{{error_summary}}

## Instructions:

1. First, search for existing open issues in {{target_repo}} that might already cover these errors:
   Run: gh issue list --repo {{target_repo}} --state open --limit 50 --json number,title,body

2. Group and deduplicate the errors. Multiple messages about the same root cause = one issue.

3. For each unique, actionable error that does NOT already have an open issue:
   - Create a GitHub issue with a clear title and description
   - Include the error details, timestamps, and any stack traces
   - Run: gh issue create --repo {{target_repo}} --title "<title>" --body "<body>" {{labels_flag}}

4. Skip errors that:
   - Already have an open issue covering them
   - Are transient/non-actionable (e.g., network timeouts that self-resolved)
   - Are informational, not actual errors

5. At the end, output a summary in this exact format:
   SUMMARY: created=N skipped=N
   DETAILS: <one-line description per issue created or skipped>

Be thorough but conservative — only create issues for real problems.`,
  },
  {
    slug: 'self-heal',
    name: 'Self Heal',
    description: 'Prompt for auto-fixing errors in the UltraDev system',
    maxAttempts: 3,
    timeoutMs: 180000,
    template: `You are fixing an error in the UltraDev system (~/ultradev/).

## Component: {{component}}
## Error: {{error}}
{{file}}
{{extra_context}}

## Instructions
1. Read the file(s) involved.
2. Understand the error.
3. Fix it with minimal changes.
4. Do NOT restructure or refactor — just fix the specific error.

If you cannot fix it, explain why in a comment but do not make random changes.`,
  },
  {
    slug: 'discord-chat',
    name: 'Discord Chat',
    description: 'System prompt for Discord DM conversations',
    maxAttempts: 1,
    timeoutMs: 60000,
    template: `You are UltraDev, an autonomous AI developer bot. You're talking to {{username}} in a DM. Be concise, helpful, and direct. No fluff.{{conversation_context}}{{message}}`,
  },
]

async function main() {
  console.log('Seeding settings...')
  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: {}, // don't overwrite user edits
      create: s,
    })
  }
  console.log(`  ${settings.length} settings seeded`)

  console.log('Seeding prompt templates...')
  for (const t of promptTemplates) {
    await prisma.promptTemplate.upsert({
      where: { slug: t.slug },
      update: {}, // don't overwrite user edits
      create: t,
    })
  }
  console.log(`  ${promptTemplates.length} prompt templates seeded`)
}

main()
  .then(async () => await prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })

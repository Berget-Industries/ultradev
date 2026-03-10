/** Shared default settings — used by both seed.ts and the reset endpoint. */
export const defaultSettings = [
  // --- GitHub ---
  { key: 'github.username', value: 'ultradev', type: 'string', label: 'GitHub Username', description: 'GitHub user to poll for assigned issues', category: 'github' },
  { key: 'github.poll_interval_ms', value: '120000', type: 'number', label: 'Poll Interval', description: 'How often to sync with GitHub', category: 'github' },
  { key: 'github.auto_assign', value: 'false', type: 'boolean', label: 'Auto-Assign Issues', description: 'Automatically assign synced issues to the configured user', category: 'github' },
  { key: 'github.default_labels', value: '', type: 'string', label: 'Default Labels Filter', description: 'Only sync issues matching these labels (comma-separated, empty = all)', category: 'github' },

  // --- Discord ---
  { key: 'discord.enabled', value: 'true', type: 'boolean', label: 'Enabled', description: 'Enable Discord bot integration', category: 'discord' },
  { key: 'discord.token', value: '', type: 'secret', label: 'Bot Token', description: 'Discord bot token', category: 'discord' },
  { key: 'discord.owner_user_id', value: '', type: 'string', label: 'Owner User ID', description: 'Discord user ID of the bot owner', category: 'discord' },
  { key: 'discord.trigger_whitelist', value: '', type: 'string', label: 'Messaging Whitelist', description: 'Channel+user pairs the bot responds to interactively (channelId:authorId, comma-separated)', category: 'discord' },
  { key: 'discord.notifications_enabled', value: 'true', type: 'boolean', label: 'Notifications Enabled', description: 'Master toggle for all notifications', category: 'discord' },
  { key: 'discord.notify_on_success', value: 'true', type: 'boolean', label: 'Notify on Success', description: 'Send Discord notification when a task completes successfully', category: 'discord' },
  { key: 'discord.notify_on_failure', value: 'true', type: 'boolean', label: 'Notify on Failure', description: 'Send Discord notification when a task fails', category: 'discord' },
  { key: 'discord.notification_channel_id', value: '', type: 'string', label: 'Notification Channel ID', description: 'Discord channel ID to send notifications to. Leave empty to DM the owner instead.', category: 'discord' },

  // --- Worker ---
  { key: 'error_watcher.enabled', value: 'true', type: 'boolean', label: 'Error Watcher Enabled', description: 'Enable error watcher', category: 'worker' },
  { key: 'error_watcher.interval_ms', value: '43200000', type: 'number', label: 'Error Watcher Interval', description: 'How often to scan for errors', category: 'worker' },
  { key: 'error_watcher.target_repo', value: '', type: 'string', label: 'Error Watcher Target Repo', description: 'Repo to create issues in (owner/repo)', category: 'worker' },
  { key: 'error_watcher.labels', value: 'production,bug,auto-triaged', type: 'string', label: 'Error Watcher Labels', description: 'Labels for auto-created issues', category: 'worker' },
  { key: 'error_watcher.watched_channels', value: '', type: 'string', label: 'Watched Channels', description: 'Discord channels to scan for errors (channelId:authorId pairs, comma-separated)', category: 'worker' },
  { key: 'worker.max_concurrent', value: '1', type: 'number', label: 'Max Concurrent Workers', description: 'Maximum number of parallel Claude workers', category: 'worker' },
  { key: 'worker.default_timeout_ms', value: '1800000', type: 'number', label: 'Default Timeout', description: 'Default task timeout (30 min default)', category: 'worker' },

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

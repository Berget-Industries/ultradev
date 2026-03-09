import type { Project } from '@prisma/client'
import type { Config } from '../orchestrator/config.js'

/**
 * Resolved per-project config — project overrides take precedence, then global defaults.
 */
export interface ProjectConfig {
  workerTimeoutMs: number
  defaultLabels: string[]
  maxAttempts: number
  notifyOnSuccess: boolean
  notifyOnFailure: boolean
  errorWatcherEnabled: boolean
  errorWatcherChannel: string | null
  errorWatcherLabels: string[]
}

/**
 * Resolve config for a project, falling back to global settings for any null fields.
 */
export function resolveProjectConfig(project: Project, global: Config): ProjectConfig {
  return {
    workerTimeoutMs: project.workerTimeoutMs ?? global.worker.defaultTimeoutMs,
    defaultLabels: project.defaultLabels
      ? project.defaultLabels.split(',').map(s => s.trim()).filter(Boolean)
      : global.github.defaultLabels,
    maxAttempts: project.maxAttempts ?? 3,
    notifyOnSuccess: project.notifyOnSuccess ?? global.notifications.discordOnSuccess,
    notifyOnFailure: project.notifyOnFailure ?? global.notifications.discordOnFailure,
    errorWatcherEnabled: project.errorWatcherEnabled,
    errorWatcherChannel: project.errorWatcherChannel,
    errorWatcherLabels: project.errorWatcherLabels
      ? project.errorWatcherLabels.split(',').map(s => s.trim()).filter(Boolean)
      : global.errorWatcher.labels,
  }
}

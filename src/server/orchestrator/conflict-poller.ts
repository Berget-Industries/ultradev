import { setIssueState } from './state.js'
import { spawnConflictWorker } from './conflict-worker.js'
import { notify } from './notifier.js'
import type { Config } from './config.js'
import type { GithubPr } from '@prisma/client'
import type { ProjectConfig } from '../lib/project-config.js'

export async function handleConflict(pr: GithubPr, config: Config, logFile: string, attempt: number, projectConfig?: ProjectConfig) {
  const key = `conflict:${pr.repo}#${pr.number}`
  const shouldNotifySuccess = projectConfig?.notifyOnSuccess ?? true
  const shouldNotifyFailure = projectConfig?.notifyOnFailure ?? true

  try {
    const result = await spawnConflictWorker(
      pr.repo,
      { number: pr.number, title: pr.title, url: `https://github.com/${pr.repo}/pull/${pr.number}` },
      pr.headRef,
      pr.baseRef,
      config,
      logFile
    )

    if (result.success) {
      setIssueState(key, { status: 'done', prUrl: result.prUrl, logFile: result.logFile })
      if (shouldNotifySuccess) notify(`✅ **${pr.repo}#${pr.number}** — Merge conflicts resolved and pushed`)
    } else if (result.partial) {
      setIssueState(key, { status: 'failed', error: result.error, madeProgress: true, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`⏸️ **${pr.repo}#${pr.number}** — Partial conflict resolution, will retry`)
    } else {
      setIssueState(key, { status: 'failed', error: result.error, logFile: result.logFile })
      if (shouldNotifyFailure) notify(`❌ **${pr.repo}#${pr.number}** — Conflict resolution failed (attempt ${attempt}): ${result.error}`)
    }
  } catch (err: any) {
    setIssueState(key, { status: 'failed', error: err.message, logFile })
    if (shouldNotifyFailure) notify(`❌ **${pr.repo}#${pr.number}** — Error: ${err.message}`)
  }
}


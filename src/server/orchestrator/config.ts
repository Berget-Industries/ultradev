import { join } from 'path'

const HOME = process.env.HOME || '/home/' + (process.env.USER || 'user')

export interface Config {
  github: {
    username: string
    pollIntervalMs: number
  }
  discord: {
    enabled: boolean
    channelId: string | null
    token: string | null
  }
  paths: {
    repos: string
    logs: string
  }
  claude: {
    command: string
    flags: string[]
  }
}

export function loadConfig(): Config {
  const flags = process.env.ULTRADEV_CLAUDE_FLAGS
    ? process.env.ULTRADEV_CLAUDE_FLAGS.split(',').map(f => f.trim())
    : ['--dangerously-skip-permissions']

  return {
    github: {
      username: process.env.ULTRADEV_GITHUB_USERNAME || 'ultradev',
      pollIntervalMs: parseInt(process.env.ULTRADEV_POLL_INTERVAL_MS || '120000', 10),
    },
    discord: {
      enabled: process.env.ULTRADEV_DISCORD_ENABLED !== 'false',
      token: process.env.ULTRADEV_DISCORD_TOKEN || null,
      channelId: process.env.ULTRADEV_DISCORD_CHANNEL_ID || null,
    },
    paths: {
      repos: process.env.ULTRADEV_REPOS_DIR || join(HOME, 'ultradev', 'repos'),
      logs: process.env.ULTRADEV_LOGS_DIR || join(HOME, 'ultradev', 'logs'),
    },
    claude: {
      command: process.env.ULTRADEV_CLAUDE_COMMAND || 'claude',
      flags,
    },
  }
}

// Runtime override for poll interval (used by dashboard API)
let runtimePollIntervalMs: number | null = null

export function setRuntimePollInterval(ms: number) {
  runtimePollIntervalMs = ms
}

export function getRuntimePollInterval(): number | null {
  return runtimePollIntervalMs
}

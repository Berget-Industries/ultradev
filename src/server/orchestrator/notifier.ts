import { logActivity } from './activity-log.js'

export type NotifyTarget =
  | { type: 'ownerDm' }
  | { type: 'channel'; channelId: string }

export async function notify(message: string, target?: NotifyTarget) {
  console.log(`[notify] ${message}`)
  logActivity('notify', message)

  // Lazy imports to avoid circular dependency with discord-bot / config
  const { dmOwner, sendToChannel } = await import('./discord-bot.js')
  const { loadConfig } = await import('./config.js')

  const config = loadConfig()
  const resolved = target
    ?? (config.discord.notificationChannelId
      ? { type: 'channel' as const, channelId: config.discord.notificationChannelId }
      : { type: 'ownerDm' as const })

  if (resolved.type === 'channel') {
    await sendToChannel(resolved.channelId, message)
  } else {
    await dmOwner(message)
  }
}

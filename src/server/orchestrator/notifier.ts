import type { Client, TextChannel } from 'discord.js'

let discordClient: Client | null = null
let channelId: string | null = null

export function setDiscordClient(client: Client, chId: string) {
  discordClient = client
  channelId = chId
}

export async function notify(message: string) {
  console.log(`[notify] ${message}`)

  if (!discordClient || !channelId) return

  try {
    const channel = await discordClient.channels.fetch(channelId)
    if (channel) await (channel as TextChannel).send(message)
  } catch (err: any) {
    console.error('[notify] Discord send failed:', err.message)
  }
}

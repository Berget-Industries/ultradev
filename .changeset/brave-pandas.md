---
"ultradev-dashboard": minor
---

Fix Discord bot not responding in guild channels based on the messaging whitelist. The bot now checks `discord.trigger_whitelist` for matching channel+author pairs and responds interactively. Separated error watcher watched channels into its own `error_watcher.watched_channels` setting so the two features are independently configurable.

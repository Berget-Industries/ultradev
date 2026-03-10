---
"ultradev-dashboard": patch
---

Fix self-update and maintenance mode on macOS by gating systemctl calls behind a Linux platform check and spawning a detached restart process on non-Linux systems

#!/bin/bash
export PATH="/Users/bene/.pi/agent/bin:/Users/bene/bin:/Users/bene/.local/bin:/Users/bene/.bun/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOME="/Users/bene"
cd /Users/bene/Dev-Source-NoBackup/TeleCodex
exec /opt/homebrew/bin/node dist/index.js

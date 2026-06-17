#!/bin/zsh
set -euo pipefail

cd /Users/eric/Documents/SlimWeb-MCP

set -a
source /Users/eric/Documents/webless/.env
set +a

export MCP_SESSION_SECRET="$(
  node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('/Users/eric/Documents/webless/.config/config.json','utf8')); process.stdout.write(c.MCP_SESSION_SECRET || '')"
)"
export WEBLESS_MCP_SECRET="$(
  node -e "const fs=require('fs'); const c=JSON.parse(fs.readFileSync('/Users/eric/Documents/webless/.config/config.json','utf8')); process.stdout.write(c.WEBLESS_MCP_SECRET || '')"
)"
# Use a second Laravel dev server for MCP callbacks. SlimAI runs through :8000,
# and php artisan serve is single-process enough that callbacks to the same
# server can deadlock while the original SlimAI request waits for MCP.
export WEBLESS_APP_BASE_URL="http://127.0.0.1:8001"
export WEBLESS_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export WEBLESS_STORAGE_DRIVER="local"
export WEBLESS_STORAGE_ROOT="/Users/eric/Documents/webless/storage/app/private"
# Keep this in sync with webless/.config/config.json SLIMWEB_MCP_BASE_URL.
export PUBLIC_BASE_URL="http://127.0.0.1:19091"
export HOST="127.0.0.1"
export PORT="19091"

exec npm start

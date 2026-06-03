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
export WEBLESS_APP_BASE_URL="http://127.0.0.1:8001"
export WEBLESS_PUBLIC_BASE_URL="http://127.0.0.1:8000"
export PUBLIC_BASE_URL="http://127.0.0.1:8080"
export HOST="127.0.0.1"
export PORT="8080"

exec npm start

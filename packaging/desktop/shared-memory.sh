#!/bin/bash
# 管理 DSH BOT App 的共享记忆（离线操作，会先退出 App）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME/Library/Application Support/DSH BOT/host-home"
NODE="${DSHBOT_NODE:-/tmp/dshbin/node-real}"
CLI="$ROOT/build/runtime/node_modules/deepseekbot/dist/deepseekbot.mjs"
[ -x "$NODE" ] || NODE="$(command -v node || true)"
[ -f "$CLI" ] || { echo "找不到 CLI：$CLI" >&2; exit 1; }
osascript -e 'tell application "DSH BOT" to quit' >/dev/null 2>&1 || true
pkill -f "Applications/DSH BOT.app/Contents/MacOS" >/dev/null 2>&1 || true
sleep 2
export PATH="$(dirname "$NODE"):/tmp/dshbin:$PATH"
"$NODE" "$CLI" shared-memory "$@" --home "$HOME_DIR"
osascript -e 'tell application "Finder" to open POSIX file "/Applications/DSH BOT.app"' >/dev/null 2>&1 || true

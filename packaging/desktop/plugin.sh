#!/bin/bash
# 在 DSH BOT（Electron 版）自己的 profile 里装/卸插件，不触碰 ~/.dsh
set -euo pipefail
APP_HOME="$HOME/Library/Application Support/DSH BOT/host-home"
PROFILE="${DSHBOT_PROFILE:-app}"
NODE="${DSHBOT_NODE:-$(command -v node || true)}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DSH_BIN="$ROOT/build/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js"
[ -x "$NODE" ] || NODE="/tmp/dshbin/node-real"
[ -f "$DSH_BIN" ] || { echo "找不到 dsh CLI：$DSH_BIN" >&2; exit 1; }
pgrep -f "DSH BOT.app/Contents/MacOS" >/dev/null 2>&1 && echo "提示：DSH BOT 正在运行，装/卸完成后重启 App 才生效。" >&2
export PATH="$(dirname "$NODE"):/tmp/dshbin:$PATH"
exec env DSH_HOME="$APP_HOME" PATH="$PATH" "$NODE" "$DSH_BIN" plugin --profile "$PROFILE" "$@"

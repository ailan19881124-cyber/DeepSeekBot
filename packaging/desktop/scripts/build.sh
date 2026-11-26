#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f build/runtime/profile/package.json || ! -f build/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js ]]; then
  node scripts/prepare-runtime.mjs
fi
exec pnpm exec electron-builder --mac --arm64 --publish never

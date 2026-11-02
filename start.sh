#!/usr/bin/env bash
# Quick dev launcher — runs the bare Node server (no Electron wrapper).
# Useful for `tail -f`-style debugging. For production use, run the
# packaged .app instead, or `npm run dev:electron` for the windowed
# dev experience.
set -euo pipefail
cd "$(dirname "$0")"
exec node server/server.js "$@"

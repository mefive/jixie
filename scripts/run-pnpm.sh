#!/bin/sh
set -eu

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# GUI-launched tools may inherit NVM_BIN without including it in PATH. Prefer that project-ready
# Node installation before any bundled fallback package manager.
if [ -n "${NVM_BIN:-}" ] && [ -x "$NVM_BIN/node" ]; then
  PATH="$NVM_BIN:$PATH"
  export PATH
fi

EXPECTED="$(node -p "require('./package.json').packageManager.split('@').pop()")"
ACTUAL="$(pnpm --version)"

if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Expected pnpm $EXPECTED, but resolved pnpm $ACTUAL."
  echo "PATH=$PATH"
  exit 1
fi

exec pnpm "$@"

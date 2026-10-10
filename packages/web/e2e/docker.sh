#!/usr/bin/env bash
# Runs the end-to-end tests in the Playwright Linux image that CI uses, so screenshots match CI's exactly.
# Arguments go to `playwright test`, e.g. `npm run e2e:docker -- --update-snapshots` to remake the baselines.
# The workspace's node_modules folders are covered by container-only volumes: the Linux install never touches the host's.
set -euo pipefail
root="$(cd "$(dirname "$0")/../../.." && pwd)"
version="$(node -p "require('$root/node_modules/@playwright/test/package.json').version")"
exec docker run --rm --ipc=host \
  -v "$root":/work \
  -v /work/node_modules -v /work/packages/web/node_modules -v /work/packages/engine/node_modules \
  -w /work/packages/web \
  "mcr.microsoft.com/playwright:v$version-noble" \
  bash -c 'npm ci --no-audit --no-fund --loglevel=error && npx playwright test "$@"' -- "$@"

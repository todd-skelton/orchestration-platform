#!/usr/bin/env bash
set -eu
# ISS-164: the Windows parent stays attached. stdout is exclusively the private
# request/reply protocol (status lines and native-db requests); replies arrive
# on stdin. Diagnostics and pnpm banners go to supervisor.log, and every
# protocol line is also appended there so the log still ends in `idle`.
# TASK_ROOT is overridable so a local test can exercise this path with fakes.
TASK_ROOT="${TASK_ROOT:-/root/orchestration-m1}"
CONFIG="${1:-$TASK_ROOT/loop.json}"
# One log per config, including Chase Sets runs under orchestration-m2.
LOG="$(cd "$(dirname "$CONFIG")" && pwd)/supervisor.log"
HOST=$(ip route | awk '/default/{print $3; exit}')
export CODEX_PROVIDER_BASE_URL="http://$HOST:8317/v1"
# This is also the auth.command configured in the executor's Codex home.
export CODEX_PROVIDER_AUTH_COMMAND="$TASK_ROOT/pool-key.sh"
# ISS-162: read-only pool status consulted before each worker launch.
export CODEX_POOL_STATUS_URL="http://$HOST:8318/api/status"
sed -i "s#http://[0-9.]*:8317/v1#$CODEX_PROVIDER_BASE_URL#" "$TASK_ROOT/codex-home/config.toml"
export PATH="$TASK_ROOT/tools/git/bin:$TASK_ROOT/tools/node-v24.15.0-linux-x64/bin:$TASK_ROOT/tools/cli/node_modules/.bin:$TASK_ROOT/tools/gh_2.93.0_linux_amd64/bin:/usr/local/bin:/usr/bin:/bin"
export CODEX_HOME="$TASK_ROOT/codex-home"
export npm_execpath="$TASK_ROOT/tools/cli/node_modules/pnpm/bin/pnpm.cjs"
cd "$TASK_ROOT/repo"
exec 2>>"$LOG"
# ISS-129: the supervisor waits for the authenticated models probe before each
# worker, so an outage at startup gets the same bounded wait and learning note.
# The supervisor inherits this stdin; a parent that goes away ends the stream.
set -o pipefail
pnpm --silent loop:supervise "$CONFIG" | tee -a "$LOG"

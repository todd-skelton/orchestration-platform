#!/usr/bin/env bash
set -eu
TASK_ROOT=/root/orchestration-m1
CONFIG="${1:-$TASK_ROOT/loop.json}"
# One log per config, including Chase Sets runs under orchestration-m2.
LOG="$(cd "$(dirname "$CONFIG")" && pwd)/supervisor.log"
if [ "${LOOP_DETACHED:-}" != "1" ]; then
  HOST=$(ip route | awk '/default/{print $3; exit}')
  export CODEX_PROVIDER_BASE_URL="http://$HOST:8317/v1"
  # This is also the auth.command configured in the executor's Codex home.
  export CODEX_PROVIDER_AUTH_COMMAND="$TASK_ROOT/pool-key.sh"
  # ISS-162: read-only pool status consulted before each worker launch.
  export CODEX_POOL_STATUS_URL="http://$HOST:8318/api/status"
  sed -i "s#http://[0-9.]*:8317/v1#$CODEX_PROVIDER_BASE_URL#" "$TASK_ROOT/codex-home/config.toml"
  # ISS-129: the supervisor waits for the authenticated models probe before each
  # worker, so an outage at startup gets the same bounded wait and learning note.
  LOOP_DETACHED=1 setsid nohup bash "$0" "$CONFIG" </dev/null >>"$LOG" 2>&1 &
  pid=$!
  disown "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ "$(ps -o sid= -p "$pid" 2>/dev/null | tr -d ' ')" = "$pid" ] && break
    sleep 0.5
  done
  echo "loop started in background (pid $pid) with $CONFIG; log: $LOG"
  exit 0
fi
export PATH="$TASK_ROOT/tools/git/bin:$TASK_ROOT/tools/node-v24.15.0-linux-x64/bin:$TASK_ROOT/tools/cli/node_modules/.bin:$TASK_ROOT/tools/gh_2.93.0_linux_amd64/bin:/usr/local/bin:/usr/bin:/bin"
export CODEX_HOME="$TASK_ROOT/codex-home"
export npm_execpath="$TASK_ROOT/tools/cli/node_modules/pnpm/bin/pnpm.cjs"
cd "$TASK_ROOT/repo"
exec pnpm loop:supervise "$CONFIG"

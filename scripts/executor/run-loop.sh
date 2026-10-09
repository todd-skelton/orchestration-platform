#!/usr/bin/env bash
set -eu
# ISS-164: the Windows parent stays attached. stdout is exclusively the private
# request/reply protocol (status lines and native-db requests); replies arrive
# on stdin. Diagnostics and pnpm banners go to supervisor.log, and every
# protocol line is also appended there so the log still ends in `idle`.
# TASK_ROOT is overridable so a local test can exercise this path with fakes.
TASK_ROOT="${TASK_ROOT:-/root/orchestration-m1}"
CONFIG="${1:-$TASK_ROOT/loop.json}"
# ISS-219: everything above this exec is a shell builtin or parameter expansion,
# so no run subprocess exists before the wrapper has entered its own cgroup-v2
# leaf and published the invocation binding. The wrapper then runs the attached
# body below as its first child with inherited stdio.
SELF="${BASH_SOURCE[0]}"
[[ "$SELF" == */* ]] || SELF="./$SELF"
exec "$TASK_ROOT/tools/node-v24.15.0-linux-x64/bin/node" "${SELF%/*}/../dogfood/process-ownership.mjs" "$CONFIG" "$SELF"

# ISS-219 ATTACHED BODY
# The wrapper starts this body only after enrollment and publication, as
# `bash -c <body> <launcher> <config>`; nothing above it runs here.
set -eu
TASK_ROOT="${TASK_ROOT:-/root/orchestration-m1}"
CONFIG="$1"
# One log per config, including Chase Sets runs under orchestration-m2.
LOG="$(cd "$(dirname "$CONFIG")" && pwd)/supervisor.log"
NODE="$TASK_ROOT/tools/node-v24.15.0-linux-x64/bin/node"
RUN=$("$NODE" -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1])).run)' "$CONFIG")
protocol() {
  "$NODE" -e 'process.stdout.write(JSON.stringify({status:process.argv[1],run:process.argv[2],observedAt:new Date().toISOString(),...(process.argv[3] ? JSON.parse(process.argv[3]) : {})})+"\n")' "$1" "$RUN" "${2:-}" | tee -a "$LOG"
}
exec 9>"$TASK_ROOT/executor.lock"
lock_shared() {
  if ! flock -s -w 600 9; then
    protocol executor-busy
    exit 1
  fi
  if [[ -e "$TASK_ROOT/executor-install.json" ]]; then
    protocol executor-install-failed
    exit 1
  fi
}
lock_shared
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
shopt -s lastpipe
while true; do
  SHA=""
  set +e
  # The body alone owns fd 9. Neither pipeline processes nor their descendants
  # may retain the shared lock after this supervisor exits (ISS-250).
  pnpm --silent loop:supervise "$CONFIG" 9>&- | tee -a "$LOG" 9>&- | {
    while IFS= read -r line; do
      printf '%s\n' "$line"
      if [[ "$line" =~ ^\{\"status\":\"upgrade-ready\",\"sha\":\"([a-f0-9]{40})\" ]]; then
        SHA="${BASH_REMATCH[1]}"
      fi
    done
  } 9>&-
  results=("${PIPESTATUS[@]}")
  set -e
  for code in "${results[@]}"; do
    if [[ "$code" != 0 ]]; then exit "$code"; fi
  done
  [[ -n "$SHA" ]] || exit 0
  flock -u 9
  if ! flock -xn 9; then
    protocol upgrade-deferred "{\"sha\":\"$SHA\",\"reason\":\"upgrade-deferred:$SHA:executor-busy\"}"
    export ORCHESTRATION_UPGRADE_DEFERRED_SHA="$SHA"
    lock_shared
    continue
  fi
  # A peer may have finished an installation while this body released its lock.
  if [[ -e "$TASK_ROOT/executor-install.json" ]]; then
    protocol executor-install-failed
    exit 1
  fi
  FROM=$(git rev-parse HEAD)
  if [[ "$FROM" == "$SHA" ]]; then
    lock_shared
    continue
  fi
  if ! git merge-base --is-ancestor "$FROM" "$SHA"; then
    protocol upgrade-deferred "{\"sha\":\"$SHA\",\"reason\":\"upgrade-deferred:not-fast-forward\"}"
    export ORCHESTRATION_UPGRADE_DEFERRED_SHA="$SHA"
    lock_shared
    continue
  fi
  CHANGED=$(git diff --no-renames --name-only "$FROM" "$SHA" -- scripts/executor/ scripts/dogfood/process-ownership.mjs package.json pnpm-lock.yaml)
  if [[ -n "$CHANGED" ]]; then
    protocol upgrade-requires-restart
    exit 1
  fi
  install_state() {
    "$NODE" -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({state:process.argv[2],from:process.argv[3],to:process.argv[4],at:new Date().toISOString(),...(process.argv[5]?{step:process.argv[5]}:{})})+"\n",{flush:true})' "$TASK_ROOT/executor-install.json" "$1" "$FROM" "$SHA" "${2:-}"
  }
  failed() {
    install_state failed "$1" || true
    protocol executor-install-failed
    exit 1
  }
  install_state installing || { protocol executor-install-failed; exit 1; }
  git merge --ff-only "$SHA" >>"$LOG" 2>&1 || failed merge
  pnpm install --frozen-lockfile >>"$LOG" 2>&1 || failed install
  PORCELAIN=$(git status --porcelain) || failed porcelain
  [[ -z "$PORCELAIN" ]] || failed porcelain
  rm "$TASK_ROOT/executor-install.json" || failed clear-state
  protocol executor-upgraded "{\"from\":\"$FROM\",\"to\":\"$SHA\"}"
  lock_shared
done

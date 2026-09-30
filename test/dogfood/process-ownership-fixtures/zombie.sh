#!/bin/sh
# A real zombie behind pipe barriers: this parent never waits for its child.
# $1 pipes directory. The child reports its PID, holds fd 3 on the life pipe
# (EOF there is the kernel's exit barrier), then exits on release; the parent
# exits only when released, so no timing sleep is involved.
set -eu
address=$1
sh -c 'exec 3>"$1/zombie-life"; printf "%s\n" "$$" > "$1/zombie-child"; read _ < "$1/zombie-release"' sh "$address" </dev/null >/dev/null 2>&1 &
printf '%s\n' "$$" > "$address/zombie-parent"
read _ < "$address/zombie-parent-release"
